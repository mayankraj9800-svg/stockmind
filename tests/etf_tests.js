'use strict';
// ETF support tests (Phase 4).
const path = require('path');
const IR = require(path.join(__dirname, '..', 'frontend', 'engines', 'indexRouter.js'));
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  suite('ETF — recognition');
  for (const sym of ['SPY','QQQ','VTI','VOO','SCHD','DIA','IWM'])
    test(`${sym} recognised as ETF`, () => ok(IR.isETF(sym)));
  test('AAPL is NOT an ETF', () => notOk(IR.isETF('AAPL')));
  test('RELIANCE.NS is NOT an ETF', () => notOk(IR.isETF('RELIANCE.NS')));
  test('lowercase qqq recognised', () => ok(IR.isETF('qqq')));

  suite('ETF — metadata fields present');
  for (const sym of ['SPY','QQQ','SCHD','DIA','IWM']) {
    const e = IR.getETF(sym);
    test(`${sym} has expenseRatio`, () => ok(typeof e.expenseRatio === 'number'));
    test(`${sym} has yield`, () => ok(typeof e.yield === 'number'));
    test(`${sym} has tracks (holdings/index)`, () => ok(!!e.tracks));
    test(`${sym} has topSectors (sector allocation)`, () => ok(Array.isArray(e.topSectors) && e.topSectors.length));
    test(`${sym} has risk profile`, () => ok(!!e.risk));
  }

  suite('ETF — classification routes ETFs away from company analysis');
  test('"analyse SPY" classified as etf (not stock)', () => eq(IR.classify('analyse SPY').kind, 'etf'));
  test('etf classification returns the registry entry', () => eq(IR.classify('what about QQQ').etf.symbol, 'QQQ'));
  test('"analyse AAPL" classified as stock', () => eq(IR.classify('analyse AAPL').kind, 'stock'));

  suite('ETF — sensible reference values');
  test('VOO cheaper than SPY (expense ratio)', () => ok(IR.getETF('VOO').expenseRatio < IR.getETF('SPY').expenseRatio));
  test('SCHD yields more than QQQ', () => ok(IR.getETF('SCHD').yield > IR.getETF('QQQ').yield));
  test('IWM (small-cap) marked higher risk', () => ok(/high/i.test(IR.getETF('IWM').risk)));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
