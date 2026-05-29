'use strict';
// DATA COVERAGE TESTS — validate PROVIDER coverage (Finnhub), not StockMind.
// Pass criterion: the required fundamental field EXISTS in the Finnhub response.
// A "fail" here = a provider gap to track for future upgrades (expected for NSE).
//
// Network + a Finnhub key are required. Set FH_KEY (and optionally BACKEND, default
// http://localhost:3001/api). Without FH_KEY the suite SKIPS (does not fail CI).
const path = require('path');
const v = require(path.join(__dirname, '..', 'backend', 'src', 'services', 'metricsValidator'));
const { suite, test, ok, summary } = require('./helpers/runner');

const BE  = process.env.BACKEND || 'http://localhost:3001/api';
const KEY = process.env.FH_KEY;
const SYMBOLS = (process.env.COVERAGE_SYMBOLS || 'AAPL,MSFT,RELIANCE.NS,HDFCBANK.NS,TCS.NS,INFY.NS').split(',');

async function getMetrics(sym) {
  const r = await fetch(`${BE}/metrics/${encodeURIComponent(sym)}`, { headers: { 'x-finnhub-key': KEY } });
  const j = await r.json();
  // Distinguish a real provider gap (success + empty) from an auth/rate-limit
  // failure — otherwise an invalid key looks like "0% provider coverage".
  if (!j.success) {
    const e = new Error(j.error?.message || 'metrics fetch failed');
    e.fetchFailed = true; throw e;
  }
  return j.data || {};
}

module.exports = async function run() {
  if (!KEY) {
    suite('Data Coverage — SKIPPED (no FH_KEY env)');
    console.log('  ⚠ set FH_KEY (and run the backend) to validate live Finnhub coverage.');
    return;
  }
  console.log('\n╔══════════════ PROVIDER COVERAGE REPORT (Finnhub) ══════════════╗');
  for (const sym of SYMBOLS) {
    let metrics = {};
    try {
      metrics = await getMetrics(sym.trim());
    } catch (e) {
      console.log(`\n${sym.trim()}\n  ⚠ COVERAGE UNKNOWN — provider fetch failed (${e.message}). Not a provider gap; check key/limit.`);
      continue; // do not report auth/rate-limit failure as 0% provider coverage
    }
    const isBank = /BANK|HDFC|ICICI|SBIN|AXIS|KOTAK/i.test(sym);
    const res = v.validateMetrics(metrics, { symbol: sym.trim(), profile: isBank ? { finnhubIndustry: 'Banks' } : null });
    console.log('\n' + v.formatCoverageReport(sym.trim(), res.coverage));
    console.log(`  → ${res.availableCount}/${res.totalCount} fields available · fundamentals ${res.canAnalyseFundamentals ? 'PERMITTED' : 'BLOCKED'}`);

    // Per-field provider-coverage assertions (these surface gaps; NSE expected to miss many).
    suite(`Provider coverage — ${sym.trim()}`);
    for (const c of res.coverage) {
      test(`${c.label} present in Finnhub response`, () => ok(c.status === 'Available', 'provider missing ' + c.label));
    }
  }
  console.log('\n╚════════════════════════════════════════════════════════════════╝');
};

if (require.main === module) {
  module.exports().then(() => {
    const passed = summary();
    console.log('\nNote: failures above are PROVIDER coverage gaps (data Finnhub does not supply),');
    console.log('not StockMind bugs. They guide future provider upgrades.');
    process.exit(0); // never fail CI on provider gaps
  });
}
