'use strict';

const axios  = require('axios');
const cache  = require('./cache');
const logger = require('../utils/logger');

const FINNHUB_BASE    = process.env.FINNHUB_BASE_URL  || 'https://finnhub.io/api/v1';
const TIMEOUT_MS      = parseInt(process.env.FINNHUB_TIMEOUT_MS || '8000', 10);
const MAX_RETRIES     = parseInt(process.env.FINNHUB_RETRIES    || '2',    10);
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

// ── SANITY BOUNDS — reject obviously wrong prices ────────────────────────────
const SANITY = {
  minPrice:  0.001,
  maxPrice:  1_000_000,
  maxChange: 99, // max % change in a single day
};

// ── LOW-LEVEL FETCH ───────────────────────────────────────────────────────────
async function fhGet(finnhubKey, path, params = {}) {
  if (!finnhubKey) throw Object.assign(new Error('No Finnhub API key provided'), { status: 401 });

  const client = axios.create({
    baseURL: FINNHUB_BASE,
    timeout: TIMEOUT_MS,
    params:  { token: finnhubKey },
  });

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      logger.warn(`Retrying Finnhub ${path} (attempt ${attempt + 1})`);
    }
    try {
      const res = await client.get(path, { params });
      return res.data;
    } catch (e) {
      lastErr = e;
      const status = e.response?.status;
      if (status && status >= 400 && status < 500) break;
    }
  }

  const status  = lastErr?.response?.status;
  const message = lastErr?.response?.data?.error || lastErr?.message || 'Finnhub request failed';
  const error   = new Error(message);
  error.status  = status || 502;
  throw error;
}

// ── DATA VALIDATION ───────────────────────────────────────────────────────────

/**
 * Validate a quote object. Returns { valid, issues[], reliability }
 * reliability: 'high' | 'medium' | 'low'
 */
function validateQuote(quote, symbol) {
  const issues = [];
  let score = 100;

  if (!quote || typeof quote !== 'object') {
    return { valid: false, issues: ['No data returned'], reliability: 'none' };
  }

  const { c, h, l, o, pc, t } = quote;

  // Price existence
  if (!c || c === 0)  { issues.push('Current price is zero or missing'); score -= 50; }
  if (!pc || pc === 0){ issues.push('Previous close missing'); score -= 20; }

  // Sanity bounds
  if (c < SANITY.minPrice) { issues.push(`Price $${c} is suspiciously low`); score -= 30; }
  if (c > SANITY.maxPrice) { issues.push(`Price $${c} is suspiciously high`); score -= 30; }

  // OHLC consistency
  if (h && l && h < l) { issues.push('High is less than Low — data error'); score -= 40; }
  if (c && h && c > h * 1.01) { issues.push('Current above daily high — data inconsistency'); score -= 20; }
  if (c && l && c < l * 0.99) { issues.push('Current below daily low — data inconsistency'); score -= 20; }

  // Staleness check
  const freshness = validateFreshness(t);
  if (!freshness.fresh) {
    issues.push(freshness.message);
    score -= freshness.penalty;
  }

  // Daily change sanity
  if (pc && c) {
    const changePct = Math.abs((c - pc) / pc * 100);
    if (changePct > SANITY.maxChange) {
      issues.push(`${changePct.toFixed(1)}% daily change is extreme — verify manually`);
      score -= 20;
    }
  }

  const reliability = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  return {
    valid: score > 30,
    issues,
    reliability,
    score: Math.max(0, score),
    freshness: freshness.label,
    timestamp: t ? new Date(t * 1000).toISOString() : null,
  };
}

/**
 * Check if a Unix timestamp is fresh enough for analysis.
 */
function validateFreshness(unixTimestamp) {
  if (!unixTimestamp) {
    return { fresh: false, label: 'unknown', message: 'No timestamp on data', penalty: 15 };
  }

  const dataAge   = Date.now() - (unixTimestamp * 1000);
  const ageMinutes = Math.floor(dataAge / 60000);

  // Markets close — weekend/after-hours data can be old but still valid
  if (dataAge < 5 * 60 * 1000)    return { fresh: true,  label: 'live',    message: '',                               penalty: 0  };
  if (dataAge < 60 * 60 * 1000)   return { fresh: true,  label: 'recent',  message: `Data is ${ageMinutes}m old`,     penalty: 5  };
  if (dataAge < 24 * 60 * 60 * 1000) return { fresh: true, label: 'delayed', message: `Data is ${ageMinutes}m old — market may be closed`, penalty: 10 };

  return { fresh: false, label: 'stale', message: `Data is ${Math.floor(ageMinutes/60)}h old — use with caution`, penalty: 25 };
}

/**
 * Normalize a ticker symbol — uppercase, strip whitespace.
 *
 * Accepts exchange-suffixed symbols such as RELIANCE.NS, TATAMOTORS.NS,
 * VODAFONE.L and BSE symbols like 500325.BO. The previous 10-char cap rejected
 * valid symbols (e.g. "RELIANCE.NS" = 11 chars) and produced spurious 400s.
 */
function normalizeTicker(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    logger.normalizationFailure({ ticker: symbol, reason: 'not a string' });
    return null;
  }
  // Keep letters, digits, dot, dash; collapse internal whitespace.
  const clean = symbol.trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9.\-]/g, '');
  // Base (before any exchange suffix) is what Finnhub limits; allow up to 20
  // chars total to cover "TATAMOTORS.NS" (13), "BAJAJ-AUTO.NS" (13), etc.
  if (clean.length < 1 || clean.length > 20) {
    logger.normalizationFailure({ ticker: symbol, reason: `length ${clean.length} out of bounds` });
    return null;
  }
  return clean;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

async function getQuote(finnhubKey, symbol) {
  const sym = normalizeTicker(symbol);
  if (!sym) throw Object.assign(new Error(`Invalid symbol: ${symbol}`), { status: 400 });

  const cacheKey = `${finnhubKey.slice(-8)}_${sym}`;
  const cached = cache.get('quote', cacheKey);
  if (cached) return cached;

  const data       = await fhGet(finnhubKey, '/quote', { symbol: sym });
  const validation = validateQuote(data, sym);

  if (!validation.valid) {
    throw Object.assign(
      new Error(`Data quality too low for ${sym}: ${validation.issues.join(', ')}`),
      { status: 422, issues: validation.issues }
    );
  }

  const result = { ...data, symbol: sym, _meta: validation };
  if (data.c) cache.set('quote', cacheKey, result);
  return result;
}

async function getProfile(finnhubKey, symbol) {
  const sym = normalizeTicker(symbol);
  if (!sym) throw Object.assign(new Error(`Invalid symbol: ${symbol}`), { status: 400 });

  const cacheKey = `${finnhubKey.slice(-8)}_${sym}`;
  const cached = cache.get('profile', cacheKey);
  if (cached) return cached;

  const data = await fhGet(finnhubKey, '/stock/profile2', { symbol: sym });
  if (!data || !data.name) throw Object.assign(new Error(`No profile found for ${sym}`), { status: 404 });

  cache.set('profile', cacheKey, data);
  return data;
}

async function getMetrics(finnhubKey, symbol) {
  const sym = normalizeTicker(symbol);
  if (!sym) throw Object.assign(new Error(`Invalid symbol: ${symbol}`), { status: 400 });

  const cacheKey = `${finnhubKey.slice(-8)}_${sym}`;
  const cached = cache.get('metrics', cacheKey);
  if (cached) return cached;

  const data = await fhGet(finnhubKey, '/stock/metric', { symbol: sym, metric: 'all' });
  const metrics = data?.metric || {};
  cache.set('metrics', cacheKey, metrics);
  return metrics;
}

async function getNews(finnhubKey, symbol) {
  const sym = normalizeTicker(symbol);
  if (!sym) throw Object.assign(new Error(`Invalid symbol: ${symbol}`), { status: 400 });

  const cacheKey = `${finnhubKey.slice(-8)}_${sym}`;
  const cached = cache.get('news', cacheKey);
  if (cached) return cached;

  const to   = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];
  const data = await fhGet(finnhubKey, '/company-news', { symbol: sym, from, to });
  const news = Array.isArray(data) ? data.slice(0, 15) : [];
  cache.set('news', cacheKey, news);
  return news;
}

async function getCandles(finnhubKey, symbol, resolution = 'D', from, to) {
  const sym = normalizeTicker(symbol);
  if (!sym) throw Object.assign(new Error(`Invalid symbol: ${symbol}`), { status: 400 });

  const toTs   = to   || Math.floor(Date.now() / 1000);
  const fromTs = from || (toTs - 365 * 86400);

  const cacheKey = `${finnhubKey.slice(-8)}_${sym}_${resolution}`;
  const cached = cache.get('candles', cacheKey);
  if (cached) return cached;

  // NOTE: Finnhub free tier returns 403 ("You don't have access to this
  // resource") for /stock/candle. This path is kept only as a last resort —
  // the frontend uses Yahoo (primary) + TwelveData (fallback) for candles.
  let data;
  try {
    data = await fhGet(finnhubKey, '/stock/candle', { symbol: sym, resolution, from: fromTs, to: toTs });
  } catch (e) {
    logger.candleFailure({ provider: 'finnhub', ticker: sym, endpoint: '/stock/candle', reason: e.message });
    throw e;
  }
  if (!data || data.s === 'no_data') {
    logger.candleFailure({ provider: 'finnhub', ticker: sym, endpoint: '/stock/candle', reason: 'no_data' });
    throw Object.assign(new Error(`No candle data for ${sym}`), { status: 404 });
  }

  cache.set('candles', cacheKey, data);
  return data;
}

async function searchSymbol(finnhubKey, query) {
  const cacheKey = `search_${query.toLowerCase().slice(0, 20)}`;
  const cached = cache.get('search', cacheKey);
  if (cached) return cached;

  const data = await fhGet(finnhubKey, '/search', { q: query });
  const results = (data?.result || [])
    .filter(r => r.type === 'Common Stock' && !r.symbol.includes('.'))
    .slice(0, 8)
    .map(r => ({ symbol: r.symbol, name: r.description, type: r.type }));

  cache.set('search', cacheKey, results);
  return results;
}

/**
 * Aggregate all data for a symbol for AI analysis.
 * Returns structured object with reliability metadata.
 */
async function getFullAnalysisData(finnhubKey, symbol) {
  const sym = normalizeTicker(symbol);
  if (!sym) throw Object.assign(new Error(`Invalid symbol: ${symbol}`), { status: 400 });

  const [quote, profile, metrics, news] = await Promise.allSettled([
    getQuote(finnhubKey, sym),
    getProfile(finnhubKey, sym),
    getMetrics(finnhubKey, sym),
    getNews(finnhubKey, sym),
  ]);

  const result = {
    symbol: sym,
    timestamp: new Date().toISOString(),
    quote:   quote.status   === 'fulfilled' ? quote.value   : null,
    profile: profile.status === 'fulfilled' ? profile.value : null,
    metrics: metrics.status === 'fulfilled' ? metrics.value : null,
    news:    news.status    === 'fulfilled' ? news.value    : [],
    errors:  [],
  };

  if (quote.status   === 'rejected') result.errors.push(`Quote: ${quote.reason?.message}`);
  if (profile.status === 'rejected') result.errors.push(`Profile: ${profile.reason?.message}`);
  if (metrics.status === 'rejected') result.errors.push(`Metrics: ${metrics.reason?.message}`);

  // Calculate overall data quality score
  let qualityScore = 0;
  if (result.quote)   qualityScore += 40;
  if (result.profile) qualityScore += 20;
  if (result.metrics && Object.keys(result.metrics).length > 5) qualityScore += 30;
  if (result.news && result.news.length > 0) qualityScore += 10;

  result.dataQuality = {
    score: qualityScore,
    label: qualityScore >= 80 ? 'high' : qualityScore >= 50 ? 'medium' : 'low',
    canAnalyse: qualityScore >= 40,
  };

  return result;
}

async function batchQuotes(finnhubKey, symbols) {
  const clean = symbols
    .map(s => normalizeTicker(s))
    .filter(Boolean)
    .slice(0, 30);

  const results = await Promise.allSettled(
    clean.map(sym => getQuote(finnhubKey, sym).then(q => ({ symbol: sym, quote: q })))
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { symbol: clean[i], quote: null, error: r.reason?.message }
  );
}

module.exports = {
  getQuote, getProfile, getMetrics, getNews,
  getCandles, searchSymbol, getFullAnalysisData,
  batchQuotes, normalizeTicker, validateQuote,
};
