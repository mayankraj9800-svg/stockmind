'use strict';

const express  = require('express');
const router   = express.Router();
const finnhub  = require('../services/finnhub');
const aiEngine = require('../services/aiEngine');
const logger   = require('../utils/logger');

// ── RESPONSE HELPERS ──────────────────────────────────────────────────────────
const ok  = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const err = (res, message, code = 500, details = {}) =>
  res.status(code).json({ success: false, error: { message, code, ...details } });

// ── HEALTH ────────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const t0 = Date.now();
  try {
    const quote = await finnhub.getQuote(req.finnhubKey, 'AAPL');
    return ok(res, {
      status:     'ok',
      finnhub:    'connected',
      latencyMs:  Date.now() - t0,
      aapl_price: quote?.c ?? null,
      timestamp:  new Date().toISOString(),
    });
  } catch (e) {
    return err(res, `Finnhub: ${e.message}`, e.status || 502);
  }
});

// ── SYMBOL SEARCH ─────────────────────────────────────────────────────────────
router.get('/search/:query', async (req, res) => {
  try {
    const results = await finnhub.searchSymbol(req.finnhubKey, req.params.query.trim());
    return ok(res, results);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── LIVE QUOTE ────────────────────────────────────────────────────────────────
router.get('/quote/:symbol', async (req, res) => {
  try {
    const quote = await finnhub.getQuote(req.finnhubKey, req.params.symbol);
    return ok(res, quote, { reliability: quote._meta?.reliability, freshness: quote._meta?.freshness });
  } catch (e) {
    return err(res, e.message, e.status || 502, { issues: e.issues });
  }
});

// ── COMPANY PROFILE ───────────────────────────────────────────────────────────
router.get('/profile/:symbol', async (req, res) => {
  try {
    const profile = await finnhub.getProfile(req.finnhubKey, req.params.symbol);
    return ok(res, profile);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── FINANCIAL METRICS ─────────────────────────────────────────────────────────
router.get('/metrics/:symbol', async (req, res) => {
  try {
    const metrics = await finnhub.getMetrics(req.finnhubKey, req.params.symbol);
    return ok(res, metrics);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── NEWS ──────────────────────────────────────────────────────────────────────
router.get('/news/:symbol', async (req, res) => {
  try {
    const news = await finnhub.getNews(req.finnhubKey, req.params.symbol);
    return ok(res, news);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── CANDLES ───────────────────────────────────────────────────────────────────
router.get('/candles/:symbol', async (req, res) => {
  try {
    const data = await finnhub.getCandles(
      req.finnhubKey,
      req.params.symbol,
      req.query.resolution || 'D',
      req.query.from ? parseInt(req.query.from) : undefined,
      req.query.to   ? parseInt(req.query.to)   : undefined,
    );
    return ok(res, data);
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── BATCH QUOTES ──────────────────────────────────────────────────────────────
router.post('/batch/quotes', async (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || !symbols.length)
    return err(res, 'Body must be { symbols: string[] }', 400);
  if (symbols.length > 30)
    return err(res, 'Max 30 symbols per batch', 400);
  try {
    const results = await finnhub.batchQuotes(req.finnhubKey, symbols);
    return ok(res, results);
  } catch (e) {
    return err(res, e.message, 502);
  }
});

// ── FULL ANALYSIS DATA (all-in-one for AI) ────────────────────────────────────
router.get('/analyse/:symbol', async (req, res) => {
  try {
    const data       = await finnhub.getFullAnalysisData(req.finnhubKey, req.params.symbol);
    const confidence = aiEngine.calculateConfidence(data);

    // ── STRICT FUNDAMENTAL VALIDATION ──────────────────────────────────────
    // Only validated fundamentals are exposed; missing ones are blocked +
    // logged so the LLM can never discuss/estimate them.
    const validator = require('../services/metricsValidator');
    const v = validator.validateMetrics(data.metrics, { symbol: data.symbol, profile: data.profile });
    validator.logBlocked(logger, data.symbol, v.missing);

    return ok(res, {
      ...data,
      confidence,
      validatedMetrics:        v.validated,            // {label: number} — safe to display
      missingMetrics:          v.missing,              // [label] — never discuss/estimate
      coverage:                v.coverage,             // [{label,key,status,value}]
      canAnalyseFundamentals:  v.canAnalyseFundamentals,
      coverageSummary:         { available: v.availableCount, total: v.totalCount },
    });
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── PROVIDER COVERAGE REPORT (per symbol) ─────────────────────────────────────
// GET /api/coverage/:symbol — validates provider coverage of required fields.
router.get('/coverage/:symbol', async (req, res) => {
  try {
    const validator = require('../services/metricsValidator');
    const metrics = await finnhub.getMetrics(req.finnhubKey, req.params.symbol);
    let profile = null;
    try { profile = await finnhub.getProfile(req.finnhubKey, req.params.symbol); } catch (_) {}
    const v = validator.validateMetrics(metrics, { symbol: req.params.symbol, profile });
    validator.logBlocked(logger, req.params.symbol, v.missing);
    return ok(res, {
      symbol: req.params.symbol,
      coverage: v.coverage,
      report: validator.formatCoverageReport(req.params.symbol, v.coverage),
      available: v.availableCount,
      total: v.totalCount,
      canAnalyseFundamentals: v.canAnalyseFundamentals,
    });
  } catch (e) {
    return err(res, e.message, e.status || 502);
  }
});

// ── CACHE STATS (internal) ────────────────────────────────────────────────────
router.get('/cache/stats', (req, res) => {
  const cache = require('../services/cache');
  return ok(res, cache.stats());
});

module.exports = router;
