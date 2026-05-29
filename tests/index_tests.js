'use strict';
// Index support tests (Phase 5).
const path = require('path');
const IR = require(path.join(__dirname, '..', 'frontend', 'engines', 'indexRouter.js'));
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  suite('Index — alias recognition');
  const cases = [
    ['the S&P 500 today', 'S&P 500'],
    ['how is the nasdaq 100 doing', 'Nasdaq-100'],
    ['dow jones level', 'Dow Jones'],
    ['nifty 50 analysis', 'Nifty 50'],
    ['sensex today', 'Sensex'],
    ['nifty next 50', 'Nifty Next 50'],
  ];
  for (const [text, name] of cases)
    test(`"${text}" → ${name}`, () => eq(IR.matchIndex(text).name, name));
  test('plain stock text → no index', () => eq(IR.matchIndex('analyse AAPL'), null));

  suite('Index — region + proxy mapping');
  test('S&P 500 region US, proxy SPY', () => { const i = IR.matchIndex('s&p 500'); eq(i.region, 'US'); eq(i.proxyETF, 'SPY'); });
  test('Nasdaq-100 proxy QQQ', () => eq(IR.matchIndex('nasdaq 100').proxyETF, 'QQQ'));
  test('Nifty 50 region IN', () => eq(IR.matchIndex('nifty 50').region, 'IN'));
  test('Sensex has no ETF proxy (handled descriptively)', () => eq(IR.matchIndex('sensex').proxyETF, null));

  suite('Index — comparison handled separately from stocks');
  const cmp = IR.classify('Compare Nifty 50, Sensex and Nifty Next 50');
  test('multi-index compare → index-compare kind', () => eq(cmp.kind, 'index-compare'));
  test('captures all 3 indices', () => eq(cmp.indices.length, 3));
  const cmp2 = IR.classify('S&P 500 vs Nasdaq 100');
  test('"S&P 500 vs Nasdaq 100" → index-compare', () => eq(cmp2.kind, 'index-compare'));

  suite('Index — single index vs stock classification');
  test('single index → index kind', () => eq(IR.classify('how is the nifty 50 doing').kind, 'index'));
  test('ETF beats stock in classify', () => eq(IR.classify('SPY analysis').kind, 'etf'));
  test('plain ticker → stock', () => eq(IR.classify('analyse TSLA').kind, 'stock'));

  suite('Index — registry completeness');
  test('all required indices supported', () => {
    for (const n of ['S&P 500','Nasdaq-100','Dow Jones','Nifty 50','Sensex','Nifty Next 50']) ok(IR.SUPPORTED_INDICES.includes(n), n);
  });
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
