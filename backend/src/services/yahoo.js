'use strict';
/**
 * Yahoo Finance quote fallback — used when Finnhub has no coverage (e.g. NSE
 * .NS symbols return 403 on the free tier). Pure provider-routing resilience;
 * no fundamentals are invented here.
 */
const axios = require('axios');

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com',
};

/** Pure: normalize a Yahoo chart `meta` block → quote or null. Testable offline. */
function normalizeYahooMeta(meta) {
  if (!meta) return null;
  const c  = meta.regularMarketPrice;
  const pc = meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? 0;
  if (!Number.isFinite(c) || c <= 0) return null;
  return {
    c, pc,
    o: meta.regularMarketOpen ?? 0,
    h: meta.regularMarketDayHigh ?? 0,
    l: meta.regularMarketDayLow ?? 0,
    t: meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
    d:  c - pc,
    dp: pc > 0 ? ((c - pc) / pc) * 100 : 0,
    _provider: 'yahoo',
  };
}

/** Fetch a normalized quote ({c,pc,o,h,l,t,d,dp,_provider}) or null. */
async function getYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 8000 });
    return normalizeYahooMeta(res.data?.chart?.result?.[0]?.meta);
  } catch (_) {
    return null;
  }
}

module.exports = { getYahooQuote, normalizeYahooMeta, YAHOO_HEADERS };
