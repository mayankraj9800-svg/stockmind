'use strict';
// Intent routing (Phase 2 B). Verifies queries route to the correct engine.
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok } = require('./helpers/runner');

module.exports = function run() {
  const { APP } = loadFrontend();
  const mode = m => APP.classifyIntent(m).mode;

  suite('Routing — SINGLE_STOCK analysis');
  for (const q of ['Analyse AAPL', 'analyze tesla', 'how is NVDA doing', 'thoughts on MSFT', 'should I buy AMD'])
    test(`"${q}" → SINGLE_STOCK`, () => eq(mode(q), 'SINGLE_STOCK'));

  suite('Routing — SCANNER (lists, not specific tickers)');
  for (const q of [
    'show me the best AI stocks',
    'top dividend stocks',
    'find oversold stocks',
    'recommend growth stocks',
    'run an AI scan',
    'list momentum stocks',
  ]) test(`"${q}" → SCANNER`, () => eq(mode(q), 'SCANNER'));
  test('Indian scanner sets region IN', () => eq(APP.classifyIntent('best nifty stocks to buy').region, 'IN'));

  suite('Routing — PORTFOLIO (user holdings, not scanner)');
  for (const q of ['analyse my portfolio', 'review my holdings', 'rebalance my portfolio', 'my positions overview'])
    test(`"${q}" → PORTFOLIO`, () => eq(mode(q), 'PORTFOLIO'));
  test('"build me a portfolio" → PORTFOLIO_BUILD (honest, no fake allocations)', () => eq(mode('build me a portfolio'), 'PORTFOLIO_BUILD'));
  test('"build a $100k portfolio using AAPL and MSFT" → PORTFOLIO_BUILD w/ named tickers', () => {
    const i = APP.classifyIntent('build a $100,000 portfolio using AAPL and MSFT');
    eq(i.mode, 'PORTFOLIO_BUILD'); ok(i.namedTickers.length >= 2);
  });
  test('theme scan still works: "best dividend stocks" → SCANNER', () => eq(mode('show me the best dividend stocks'), 'SCANNER'));

  suite('Routing — WATCHLIST');
  test('"create a watchlist of AI stocks" → WATCHLIST', () => eq(mode('create a watchlist of AI stocks'), 'WATCHLIST'));
  test('"build a watchlist" → WATCHLIST (not PORTFOLIO_BUILD)', () => eq(mode('build a watchlist of 10 cloud stocks'), 'WATCHLIST'));
  test('"watchlist of cybersecurity stocks" → WATCHLIST', () => eq(mode('show me a watchlist of cybersecurity stocks'), 'WATCHLIST'));

  suite('Routing — COMPARE (not analysis/scanner)');
  for (const q of ['compare AAPL and MSFT', 'AAPL vs MSFT', 'GOOGL versus META', 'compare nvidia and amd'])
    test(`"${q}" → COMPARE`, () => eq(mode(q), 'COMPARE'));
  test('"compare top stocks" (no real tickers) → SCANNER not COMPARE', () => eq(mode('compare the best stocks'), 'SCANNER'));

  suite('Routing — SWING');
  test('"swing trade setup for AAPL" → SWING', () => eq(mode('swing trade setup for AAPL'), 'SWING'));
  test('"entry and exit for TSLA" → SWING', () => eq(mode('entry and exit points for TSLA'), 'SWING'));

  suite('Routing — no cross-wiring (the bug matrix)');
  test('Portfolio request does NOT route to SCANNER', () => eq(mode('analyse my portfolio'), 'PORTFOLIO'));
  test('Comparison request does NOT route to SINGLE_STOCK', () => eq(mode('compare AAPL and MSFT'), 'COMPARE'));
  test('Analysis request does NOT route to SCANNER', () => eq(mode('analyse AAPL'), 'SINGLE_STOCK'));
  test('Scanner request does NOT route to PORTFOLIO', () => eq(mode('show me the best stocks'), 'SCANNER'));

  suite('Routing — region words are not tickers');
  test('"best US stocks" → SCANNER (US ignored)', () => eq(mode('best US stocks'), 'SCANNER'));
  test('"top UK dividend stocks" → SCANNER region UK', () => eq(APP.classifyIntent('top UK dividend stocks').region, 'UK'));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
