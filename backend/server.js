'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express   = require('express');
const cors      = require('cors');
const axios     = require('axios');
const rateLimit = require('express-rate-limit');

const PORT         = parseInt(process.env.PORT || '3001', 10);
const FINNHUB_BASE = process.env.FINNHUB_BASE_URL  || 'https://finnhub.io/api/v1';
const TIMEOUT_MS   = parseInt(process.env.FINNHUB_TIMEOUT_MS || '8000', 10);
const MAX_RETRIES  = parseInt(process.env.FINNHUB_RETRIES    || '2',    10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'null')
  .split(',').map(o => o.trim()).filter(Boolean);

// ── HELPERS ──────────────────────────────────────────────────────────────────
const ok  = (res, data)               => res.json({ success: true,  data });
const err = (res, message, code = 500) => res.status(code).json({
  success: false, error: { message, code },
});

/**
 * Call Finnhub using the API key supplied by the caller in the
 * x-finnhub-key request header. Key is NEVER stored server-side.
 */
async function fhGet(finnhubKey, path, params = {}) {
  if (!finnhubKey) throw Object.assign(new Error('No Finnhub key provided'), { status: 401 });

  const client = axios.create({
    baseURL: FINNHUB_BASE,
    timeout: TIMEOUT_MS,
    params:  { token: finnhubKey },
  });

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
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

// ── EXPRESS APP ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // Allow any localhost port (covers :3000, :5500, :8080, file://, etc.)
    if (origin === 'null' || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    // Allow configured origins (for production)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods:          ['GET', 'POST', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization', 'x-finnhub-key'],
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '1mb' }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { message: 'Too many requests', code: 429 } },
}));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── MIDDLEWARE: extract Finnhub key from header ───────────────────────────────
app.use((req, _res, next) => {
  req.finnhubKey = req.headers['x-finnhub-key'] || '';
  next();
});

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Health check — validates the caller's Finnhub key
app.get(['/health', '/api/health'], async (req, res) => {
  const t0 = Date.now();
  try {
    const data = await fhGet(req.finnhubKey, '/quote', { symbol: 'AAPL' });
    return ok(res, {
      status:     'ok',
      finnhub:    'connected',
      latencyMs:  Date.now() - t0,
      aapl_price: data?.c ?? null,
      timestamp:  new Date().toISOString(),
    });
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Symbol search — resolve company name to ticker
app.get(['/search/:query', '/api/search/:query'], async (req, res) => {
  const query = req.params.query.trim();
  if (!query) return err(res, 'Query required', 400);
  try {
    const data = await fhGet(req.finnhubKey, '/search', { q: query });
    const results = (data?.result || [])
      .filter(r => r.type === 'Common Stock' && !r.symbol.includes('.'))
      .slice(0, 5)
      .map(r => ({ symbol: r.symbol, name: r.description }));
    return ok(res, results);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Live quote
app.get(['/quote/:symbol', '/api/quote/:symbol'], async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  if (!symbol || symbol.length > 10) return err(res, 'Invalid symbol', 400);
  try {
    const data = await fhGet(req.finnhubKey, '/quote', { symbol });
    if (!data || data.c === 0) return err(res, `No data for ${symbol}`, 404);
    return ok(res, data);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Company profile
app.get(['/profile/:symbol', '/api/profile/:symbol'], async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const data = await fhGet(req.finnhubKey, '/stock/profile2', { symbol });
    if (!data || !data.name) return err(res, `No profile for ${symbol}`, 404);
    return ok(res, data);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Company news
app.get(['/news/:symbol', '/api/news/:symbol'], async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const to     = new Date().toISOString().split('T')[0];
  const from   = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];
  try {
    const data = await fhGet(req.finnhubKey, '/company-news', { symbol, from, to });
    return ok(res, Array.isArray(data) ? data.slice(0, 20) : []);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Candle data
app.get(['/candles/:symbol', '/api/candles/:symbol'], async (req, res) => {
  const symbol     = req.params.symbol.toUpperCase().trim();
  const resolution = req.query.resolution || 'D';
  const to         = req.query.to   || Math.floor(Date.now() / 1000);
  const from       = req.query.from || (to - 365 * 86400);
  try {
    const data = await fhGet(req.finnhubKey, '/stock/candle', { symbol, resolution, from, to });
    if (!data || data.s === 'no_data') return err(res, `No candle data for ${symbol}`, 404);
    return ok(res, data);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Key financial metrics
app.get(['/metrics/:symbol', '/api/metrics/:symbol'], async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const data = await fhGet(req.finnhubKey, '/stock/metric', { symbol, metric: 'all' });
    return ok(res, data?.metric ?? {});
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// Batch quotes
app.post(['/batch/quotes', '/api/batch/quotes'], async (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || symbols.length === 0)
    return err(res, 'Body must be { symbols: string[] }', 400);
  if (symbols.length > 30) return err(res, 'Max 30 symbols per batch', 400);

  const clean = symbols.map(s => String(s).toUpperCase().trim()).filter(s => s.length <= 10);
  const results = await Promise.allSettled(
    clean.map(symbol =>
      fhGet(req.finnhubKey, '/quote', { symbol })
        .then(data => ({ symbol, quote: data?.c ? data : null }))
    )
  );
  return ok(res, results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { symbol: clean[i], quote: null, error: r.reason?.message || 'failed' }
  ));
});

// 404
app.use((req, res) => err(res, `Not found: ${req.method} ${req.path}`, 404));

// Error handler
app.use((error, req, res, _next) => {
  if (error.message?.startsWith('CORS:'))
    return res.status(403).json({ success: false, error: { message: error.message, code: 403 } });
  console.error('[Unhandled]', error);
  err(res, error.message || 'Internal server error', 500);
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   StockMind AI Pro — Backend Proxy v2.0          ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║   Listening on  http://localhost:${PORT}             ║`);
  console.log('  ║   Mode: USER-KEY — no API keys stored here       ║');
  console.log('  ║   Finnhub key passed per-request via header      ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║   Endpoints:                                      ║');
  console.log('  ║   GET  /api/health                                ║');
  console.log('  ║   GET  /api/search/:query                         ║');
  console.log('  ║   GET  /api/quote/:symbol                         ║');
  console.log('  ║   GET  /api/profile/:symbol                       ║');
  console.log('  ║   GET  /api/news/:symbol                          ║');
  console.log('  ║   GET  /api/candles/:symbol                       ║');
  console.log('  ║   GET  /api/metrics/:symbol                       ║');
  console.log('  ║   POST /api/batch/quotes                          ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});
