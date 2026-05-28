'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const axios     = require('axios');
const logger    = require('./src/utils/logger');
const apiRoutes = require('./src/routes/api');

const PORT = parseInt(process.env.PORT || '3001', 10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'null')
  .split(',').map(o => o.trim()).filter(Boolean);

// ── EXPRESS ───────────────────────────────────────────────────────────────────
const app = express();

// CORS — allow Netlify, localhost, and any origin in ALLOWED_ORIGINS
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1'))
      return callback(null, true);
    // Always allow any netlify.app subdomain
    if (origin.includes('netlify.app'))
      return callback(null, true);
    if (ALLOWED_ORIGINS.length > 0 &&
        ALLOWED_ORIGINS.some(o => origin.includes(o.replace(/https?:\/\//, ''))))
      return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods:          ['GET', 'POST', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization', 'x-finnhub-key', 'x-groq-key'],
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '1mb' }));

// Rate limiting — 300 req / 15 min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { message: 'Too many requests', code: 429 } },
}));

// Request logger
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Extract Finnhub key from header
app.use((req, _res, next) => {
  req.finnhubKey = req.headers['x-finnhub-key'] || '';
  next();
});

// ── SIMPLE IN-MEMORY CANDLE CACHE (TTL: 10 minutes) ──────────────────────────
const candleCache = new Map();
const CANDLE_TTL  = 10 * 60 * 1000; // 10 minutes

function getCachedCandles(key) {
  const entry = candleCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CANDLE_TTL) { candleCache.delete(key); return null; }
  return entry.data;
}

function setCachedCandles(key, data) {
  candleCache.set(key, { data, ts: Date.now() });
}

// ── YAHOO FINANCE HEADERS (required to avoid 401/403) ────────────────────────
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com',
};

// ── NORMALIZE YAHOO CANDLE RESPONSE ──────────────────────────────────────────
function normalizeYahooCandles(data) {
  try {
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quote      = result.indicators?.quote?.[0] || {};
    const opens      = quote.open   || [];
    const highs      = quote.high   || [];
    const lows       = quote.low    || [];
    const closes     = quote.close  || [];
    const volumes    = quote.volume || [];

    if (!timestamps.length || !closes.length) return null;

    // Filter out null/NaN values (Yahoo sometimes has gaps)
    const valid = timestamps.reduce((acc, t, i) => {
      if (t && closes[i] != null && !isNaN(closes[i]) && closes[i] > 0) {
        acc.t.push(t);
        acc.o.push(opens[i]  || closes[i]);
        acc.h.push(highs[i]  || closes[i]);
        acc.l.push(lows[i]   || closes[i]);
        acc.c.push(closes[i]);
        acc.v.push(volumes[i] || 0);
      }
      return acc;
    }, { t:[], o:[], h:[], l:[], c:[], v:[] });

    if (valid.c.length < 5) return null; // Not enough data points

    return { s: 'ok', t: valid.t, o: valid.o, h: valid.h, l: valid.l, c: valid.c, v: valid.v };
  } catch(e) {
    return null;
  }
}

// ── YAHOO CANDLES PROXY ───────────────────────────────────────────────────────
// GET /api/yahoo-candles/:symbol?days=220
app.get('/api/yahoo-candles/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  const days   = parseInt(req.query.days || '220', 10);

  if (!symbol) {
    return res.status(400).json({ success: false, error: { message: 'Symbol required', code: 400 } });
  }

  // Check cache
  const cacheKey = `candles:${symbol}:${days}`;
  const cached = getCachedCandles(cacheKey);
  if (cached) {
    return res.json({ success: true, data: cached, source: 'cache' });
  }

  // Determine Yahoo interval and range
  const range    = days <= 30 ? '1mo' : days <= 90 ? '3mo' : days <= 180 ? '6mo' : '1y';
  const interval = '1d';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const response = await axios.get(url, {
      headers: YAHOO_HEADERS,
      timeout: 10000,
    });

    const candles = normalizeYahooCandles(response.data);
    if (!candles) {
      return res.status(404).json({ success: false, error: { message: `No candle data for ${symbol}`, code: 404 } });
    }

    setCachedCandles(cacheKey, candles);
    res.json({ success: true, data: candles, source: 'yahoo' });

  } catch(e) {
    const status  = e.response?.status || 500;
    const message = `Yahoo candles failed for ${symbol}: ${e.message}`;
    logger.error(message);
    res.status(status).json({ success: false, error: { message, code: status } });
  }
});

// ── YAHOO QUOTE PROXY ─────────────────────────────────────────────────────────
// GET /api/yahoo-quote/:symbol  — fallback quote for international stocks
app.get('/api/yahoo-quote/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  if (!symbol) {
    return res.status(400).json({ success: false, error: { message: 'Symbol required', code: 400 } });
  }

  // Check cache (short TTL for quotes — 30 seconds)
  const cacheKey = `quote:${symbol}`;
  const cached   = getCachedCandles(cacheKey); // reuses same cache map, different key prefix
  if (cached) return res.json({ success: true, data: cached, source: 'cache' });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const response = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 8000 });

    const result = response.data?.chart?.result?.[0];
    if (!result) {
      return res.status(404).json({ success: false, error: { message: `No quote data for ${symbol}`, code: 404 } });
    }

    const meta = result.meta || {};
    const quote = {
      c:  meta.regularMarketPrice           || 0,
      pc: meta.chartPreviousClose           || meta.regularMarketPreviousClose || 0,
      o:  meta.regularMarketOpen            || 0,
      h:  meta.regularMarketDayHigh         || 0,
      l:  meta.regularMarketDayLow          || 0,
      t:  meta.regularMarketTime            || Math.floor(Date.now() / 1000),
    };
    quote.d  = quote.c - quote.pc;
    quote.dp = quote.pc > 0 ? ((quote.c - quote.pc) / quote.pc * 100) : 0;

    if (!quote.c || quote.c === 0) {
      return res.status(404).json({ success: false, error: { message: `Empty quote for ${symbol}`, code: 404 } });
    }

    // Short TTL for quotes
    candleCache.set(cacheKey, { data: quote, ts: Date.now() - (CANDLE_TTL - 30000) });
    res.json({ success: true, data: quote, source: 'yahoo' });

  } catch(e) {
    const status  = e.response?.status || 500;
    const message = `Yahoo quote failed for ${symbol}: ${e.message}`;
    logger.error(message);
    res.status(status).json({ success: false, error: { message, code: status } });
  }
});

// ── GROQ PROXY ────────────────────────────────────────────────────────────────
app.post('/api/groq', async (req, res) => {
  const groqKey = req.headers['x-groq-key'] || '';
  if (!groqKey) {
    return res.status(400).json({ success: false, error: { message: 'Missing Groq key', code: 400 } });
  }

  const { model, messages, max_tokens, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: { message: 'Invalid request body', code: 400 } });
  }

  try {
    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model:       model       || 'llama-3.3-70b-versatile',
        messages,
        max_tokens:  max_tokens  || 1200,
        temperature: temperature ?? 0.65,
      },
      {
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type':  'application/json',
        },
        timeout: 30000,
      }
    );
    res.json({ success: true, data: groqRes.data });
  } catch(e) {
    const status  = e.response?.status  || 500;
    const message = e.response?.data?.error?.message || e.message || 'Groq request failed';
    logger.error('Groq proxy error', { status, message });
    res.status(status).json({ success: false, error: { message, code: status } });
  }
});

// ── MAIN API ROUTES (Finnhub) ─────────────────────────────────────────────────
app.use('/api', apiRoutes);
app.get('/health', (req, res) => res.redirect('/api/health'));

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: `Not found: ${req.method} ${req.path}`, code: 404 } });
});

// Global error handler
app.use((error, req, res, _next) => {
  if (error.message?.startsWith('CORS:'))
    return res.status(403).json({ success: false, error: { message: error.message, code: 403 } });
  logger.error('Unhandled error', { message: error.message, stack: error.stack });
  res.status(500).json({ success: false, error: { message: 'Internal server error', code: 500 } });
});

// ── STARTUP ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info('══════════════════════════════════════════════');
  logger.info('  StockMind AI Pro — Backend v4.0');
  logger.info(`  Listening on http://localhost:${PORT}`);
  logger.info('  Candle providers: Yahoo Finance (primary) + Finnhub (fallback)');
  logger.info('  Groq proxy: enabled');
  logger.info('══════════════════════════════════════════════');
});
