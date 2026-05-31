'use strict';
// Comparison context preservation (Phase 2 D).
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  const { APP } = loadFrontend();
  const mem = APP.memory;

  suite('Comparison — both tickers preserved across follow-up (D)');
  mem.clear();
  mem.setComparison(['AAPL', 'MSFT']);
  test('comparison stores both tickers', () => eq(mem.activeComparison, ['AAPL', 'MSFT']));
  test('"which has a stronger moat?" is a comparison follow-up', () => ok(mem.isComparisonFollowUp('which has a stronger moat?')));
  test('"which is safer?" is a comparison follow-up', () => ok(mem.isComparisonFollowUp('which is safer?')));
  test('"compare them on valuation" is a comparison follow-up', () => ok(mem.isComparisonFollowUp('compare them on valuation')));
  test('classifyIntent routes the follow-up back to COMPARE', () => {
    const i = APP.classifyIntent('which has a stronger moat?');
    eq(i.mode, 'COMPARE'); ok(i.followUp);
  });

  suite('Comparison — no random substitution');
  test('follow-up introducing a NEW ticker is NOT a compare follow-up', () => notOk(mem.isComparisonFollowUp('what about NVDA?')));
  test('with no active comparison, follow-up returns false', () => { mem.clear(); notOk(mem.isComparisonFollowUp('which is safer?')); });

  suite('Comparison — setComparison validation');
  test('rejects single ticker (needs >=2)', () => { mem.setComparison(['AAPL']); eq(mem.activeComparison, null); });
  test('accepts 3-way comparison', () => { mem.setComparison(['AAPL', 'MSFT', 'GOOGL']); eq(mem.activeComparison.length, 3); });

  suite('Comparison — prompt focuses on the follow-up question & only these tickers');
  const stocks = [
    { symbol: 'AAPL', quote: { c: 190, dp: 1 }, profile: { name: 'Apple' }, metrics: null, technicals: {}, risk: { level: 'Low' } },
    { symbol: 'MSFT', quote: { c: 410, dp: 0.5 }, profile: { name: 'Microsoft' }, metrics: null, technicals: {}, risk: { level: 'Low' } },
  ];
  const p = APP.buildComparePromptV2(stocks, 'which has a stronger moat?');
  test('prompt includes the user question', () => ok(p.includes('stronger moat')));
  test('prompt constrains to the named companies only', () => ok(/only discuss/i.test(p)));
  test('prompt names both AAPL and MSFT', () => ok(p.includes('AAPL') && p.includes('MSFT')));
  test('prompt without question still valid (standard compare)', () => {
    const p2 = APP.buildComparePromptV2(stocks);
    ok(p2.includes('AAPL') && p2.includes('MSFT') && !/USER'S SPECIFIC QUESTION/.test(p2));
  });
  test('missing metrics shown as N/A, never fabricated', () => ok(p.includes('N/A')));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
