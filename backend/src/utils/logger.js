'use strict';
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `[${timestamp}] ${level.toUpperCase()} ${message}${metaStr}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// ── STRUCTURED DOMAIN LOGGING ────────────────────────────────────────────────
// Every event clearly identifies provider / ticker / endpoint / reason so that
// candle failures, provider switches, Groq failures and normalization failures
// are all greppable in production logs.
logger.candleFailure = ({ provider, ticker, endpoint, reason }) =>
  logger.warn('CANDLE_FETCH_FAILED', { provider, ticker, endpoint, reason });

logger.providerSwitch = ({ from, to, ticker, reason }) =>
  logger.info('PROVIDER_SWITCH', { from, to, ticker, reason });

logger.groqFailure = ({ endpoint, reason, status }) =>
  logger.error('GROQ_FAILED', { endpoint, reason, status });

logger.normalizationFailure = ({ ticker, reason }) =>
  logger.warn('NORMALIZATION_FAILED', { ticker, reason });

module.exports = logger;
