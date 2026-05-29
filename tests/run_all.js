'use strict';
// Master test runner — runs every suite, prints a combined summary, exits 1 on failure.
const { summary } = require('./helpers/runner');

const suites = [
  './backend_tests',
  './ticker_tests',
  './memory_tests',
  './routing_tests',
  './comparison_tests',
  './portfolio_tests',
  './risk_tests',
  './scanner_tests',
  './system_tests',
  './context_tests',
  './portfolio_engine_tests',
  './watchlist_tests',
  './etf_tests',
  './index_tests',
];

(async () => {
  for (const s of suites) {
    const fn = require(s);
    await Promise.resolve(fn());
  }
  const passed = summary();
  process.exit(passed ? 0 : 1);
})();
