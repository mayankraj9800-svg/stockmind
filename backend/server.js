'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const logger    = require('./src/utils/logger');
const apiRoutes = require('./src/routes/api');

const PORT = parseInt(process.env.PORT || '3001', 10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'null')
  .split(',').map(o => o.trim()).filter(Boolean);

// ── EXPRESS ───────────────────────────────────────────────────────────────────
const app = express();

// CORS
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin === 'null' || origin.includes('localhost') || origin.includes('127.0.0.1'))
      return callback(null, true);
    if (ALLOWED_ORIGINS.some(o => origin.includes(o.replace('https://', '').replace('http://', ''))))
      return callback(null, true);
    logger.warn(`Blocked CORS from: ${origin}`);
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

// ── GROQ PROXY ────────────────────────────────────────────────────────────────
// Proxies AI requests so the frontend never calls api.groq.com directly.
// The user's Groq key is forwarded from the x-groq-key header — never stored.
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
    const axios = require('axios');
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
  } catch (e) {
    const status  = e.response?.status  || 500;
    const message = e.response?.data?.error?.message || e.message || 'Groq request failed';
    logger.error('Groq proxy error', { status, message });
    res.status(status).json({ success: false, error: { message, code: status } });
  }
});

// Routes
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

// Start
app.listen(PORT, () => {
  logger.info('══════════════════════════════════════════════');
  logger.info('  StockMind AI Pro — Backend v3.0');
  logger.info(`  Listening on http://localhost:${PORT}`);
  logger.info('  Mode: USER-KEY — no keys stored server-side');
  logger.info('  Features: caching · validation · confidence scoring');
  logger.info('══════════════════════════════════════════════');
});
