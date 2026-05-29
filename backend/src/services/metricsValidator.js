'use strict';
/**
 * Strict fundamental-metric validation layer.
 * ════════════════════════════════════════════
 * A metric is only ever surfaced if it EXISTS and passes validation. We never
 * estimate, infer, derive, approximate, or generate a missing fundamental.
 *
 * Used by the analysis pipeline so that NSE (and any thin-coverage) stocks
 * cannot have fabricated fundamentals — missing fields are blocked and logged.
 */

// ── FIELD DEFINITIONS ─────────────────────────────────────────────────────────
// canonical label → the Finnhub metric key it maps to.
const FUNDAMENTAL_FIELDS = [
  { label: 'PE',              key: 'peTTM' },
  { label: 'PE (annual)',     key: 'peNormalizedAnnual' },
  { label: 'EPS',             key: 'epsTTM' },
  { label: 'Revenue Growth',  key: 'revenueGrowthTTMYoy' },
  { label: 'Gross Margin',    key: 'grossMarginTTM' },
  { label: 'Net Margin',      key: 'netProfitMarginTTM' },
  { label: 'ROE',             key: 'roeTTM' },
  { label: 'ROA',             key: 'roaTTM' },
  { label: 'Debt/Equity',     key: 'totalDebt/totalEquityAnnual' },
  { label: 'P/B',             key: 'pbAnnual' },
  { label: 'P/S',             key: 'psTTM' },
  { label: 'Beta',            key: 'beta' },
  { label: '52W High',        key: '52WeekHigh' },
  { label: '52W Low',         key: '52WeekLow' },
  { label: 'Dividend Yield',  key: 'dividendYieldIndicatedAnnual' },
];

// Bank-specific fundamentals. Finnhub's free /stock/metric does NOT provide
// these — they are intentionally listed so coverage reports surface the gap
// (and so the LLM is told never to discuss them when missing).
const BANK_FIELDS = [
  { label: 'Gross NPA',  key: 'grossNpaRatio' },
  { label: 'Net NPA',    key: 'netNpaRatio' },
  { label: 'CASA Ratio', key: 'casaRatio' },
  { label: 'NIM',        key: 'netInterestMargin' },
  { label: 'CAR',        key: 'capitalAdequacyRatio' },
];

// ── CORE VALIDATION ───────────────────────────────────────────────────────────
/**
 * A value is valid only if it exists, is a finite number, and is not NaN.
 * Strings, null, undefined, NaN, Infinity → invalid.
 */
function isValidMetric(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return false;
  // Empty/whitespace strings coerce to 0 via Number() — reject them explicitly.
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return false; // catches NaN, Infinity, non-numeric
  return true;
}

/** Reason a value failed validation (for logging). */
function invalidReason(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(Number(v))) return 'non-finite';
  return 'invalid';
}

/** Is this symbol/profile a bank (to include bank-specific coverage)? */
function isBank(symbol, profile) {
  const ind = (profile && profile.finnhubIndustry) || '';
  return /bank/i.test(ind) || /BANK\b/i.test(symbol || '');
}

/**
 * Build a coverage report for the required fields.
 * @returns [{ label, key, status:'Available'|'Missing', value }]
 */
function buildCoverage(metrics, { symbol, profile } = {}) {
  const m = metrics || {};
  const fields = [...FUNDAMENTAL_FIELDS];
  if (isBank(symbol, profile)) fields.push(...BANK_FIELDS);
  return fields.map(({ label, key }) => {
    const raw = m[key];
    const ok = isValidMetric(raw);
    return { label, key, status: ok ? 'Available' : 'Missing', value: ok ? Number(raw) : null };
  });
}

/**
 * Return ONLY validated fundamentals plus the list of blocked (missing) ones.
 * @returns { validated: {label:value}, missing: [label], coverage: [...] }
 */
function validateMetrics(metrics, opts = {}) {
  const coverage = buildCoverage(metrics, opts);
  const validated = {};
  const missing = [];
  for (const c of coverage) {
    if (c.status === 'Available') validated[c.label] = c.value;
    else missing.push(c.label);
  }
  const availableCount = coverage.length - missing.length;
  return {
    validated,
    missing,
    coverage,
    availableCount,
    totalCount: coverage.length,
    // Fundamental analysis is only permitted with a meaningful core of data.
    canAnalyseFundamentals: availableCount >= 3,
  };
}

/** One-line coverage summary string, e.g. "PE: Available · ROE: Missing · …" */
function coverageSummary(coverage) {
  return coverage.map(c => `${c.label}: ${c.status}`).join('\n');
}

/** Human-readable provider coverage report (matches the spec's example). */
function formatCoverageReport(symbol, coverage) {
  return `${symbol}\nCoverage:\n` + coverage.map(c => `  ${c.label}: ${c.status}`).join('\n');
}

/**
 * Log every blocked (missing) metric so provider-coverage gaps are tracked for
 * future provider upgrades. `logger` is the winston instance (optional).
 */
function logBlocked(logger, symbol, missing) {
  if (!logger || !missing || !missing.length) return;
  logger.warn('METRICS_BLOCKED', { symbol, blocked: missing, count: missing.length });
}

module.exports = {
  FUNDAMENTAL_FIELDS, BANK_FIELDS,
  isValidMetric, invalidReason, isBank,
  buildCoverage, validateMetrics, coverageSummary,
  formatCoverageReport, logBlocked,
};
