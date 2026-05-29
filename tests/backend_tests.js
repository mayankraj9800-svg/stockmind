'use strict';
// Backend unit tests — symbol normalization, quote validation, confidence.
const path = require('path');
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

const finnhub  = require(path.join(__dirname, '..', 'backend', 'src', 'services', 'finnhub'));
const aiEngine = require(path.join(__dirname, '..', 'backend', 'src', 'services', 'aiEngine'));

module.exports = function run() {
  suite('Backend — normalizeTicker (Error 3: RELIANCE.NS 400)');
  test('RELIANCE.NS accepted (was rejected by 10-char cap)', () => eq(finnhub.normalizeTicker('RELIANCE.NS'), 'RELIANCE.NS'));
  test('TATAMOTORS.NS accepted', () => eq(finnhub.normalizeTicker('TATAMOTORS.NS'), 'TATAMOTORS.NS'));
  test('BAJAJ-AUTO.NS accepted', () => eq(finnhub.normalizeTicker('BAJAJ-AUTO.NS'), 'BAJAJ-AUTO.NS'));
  test('lowercase + spaces normalized', () => eq(finnhub.normalizeTicker('  reliance.ns '), 'RELIANCE.NS'));
  test('AAPL passes through', () => eq(finnhub.normalizeTicker('AAPL'), 'AAPL'));
  test('empty → null', () => eq(finnhub.normalizeTicker(''), null));
  test('non-string → null', () => eq(finnhub.normalizeTicker(null), null));
  test('absurdly long → null', () => eq(finnhub.normalizeTicker('A'.repeat(40)), null));

  suite('Backend — validateQuote (Phase 2 F: data quality)');
  const now = Math.floor(Date.now() / 1000);
  test('valid fresh quote → valid, high/medium', () => {
    const v = finnhub.validateQuote({ c: 150, pc: 148, h: 151, l: 147, o: 149, t: now }, 'AAPL');
    ok(v.valid); ok(['high', 'medium'].includes(v.reliability));
  });
  test('zero price → invalid / low', () => {
    const v = finnhub.validateQuote({ c: 0, pc: 0, t: now }, 'XXX');
    ok(!v.valid || v.reliability === 'low'); ok(v.issues.length > 0);
  });
  test('high < low → flags inconsistency', () => {
    const v = finnhub.validateQuote({ c: 100, pc: 99, h: 90, l: 110, t: now }, 'XXX');
    ok(v.issues.some(i => /high/i.test(i) || /low/i.test(i)));
  });
  test('missing timestamp → flagged', () => {
    const v = finnhub.validateQuote({ c: 100, pc: 99, h: 101, l: 98 }, 'XXX');
    ok(v.issues.some(i => /timestamp/i.test(i)));
  });
  test('stale (2-day-old) quote → penalised', () => {
    const v = finnhub.validateQuote({ c: 100, pc: 99, h: 101, l: 98, t: now - 2 * 86400 }, 'XXX');
    ok(v.score < 100);
  });
  test('suspiciously huge price → flagged', () => {
    const v = finnhub.validateQuote({ c: 5_000_000, pc: 4_900_000, h: 5_100_000, l: 4_800_000, t: now }, 'XXX');
    ok(v.issues.some(i => /high/i.test(i)));
  });
  test('null quote → not valid', () => notOk(finnhub.validateQuote(null, 'XXX').valid));

  suite('Backend — aiEngine.calculateConfidence (hallucination guard E)');
  test('no data → low confidence, cannot analyse', () => {
    const c = aiEngine.calculateConfidence({ quote: null, profile: null, metrics: null, news: [] });
    ok(c.score < 40); notOk(c.canAnalyse);
  });
  test('full data → higher confidence', () => {
    const c = aiEngine.calculateConfidence({
      quote: { c: 150, _meta: { reliability: 'high', freshness: 'live' } },
      profile: { name: 'Apple' },
      metrics: { peNormalizedAnnual: 28, revenueGrowthTTMYoy: 8, epsNormalizedAnnual: 6, '52WeekHigh': 200, marketCapitalization: 3e6 },
      news: [{}, {}, {}],
    });
    ok(c.score >= 50);
  });
  test('missing-data confidence includes a disclaimer', () => {
    const c = aiEngine.calculateConfidence({ quote: { c: 1, _meta: {} }, profile: null, metrics: null, news: [] });
    ok(c.disclaimer);
  });
  test('confidence score never exceeds 100', () => {
    const c = aiEngine.calculateConfidence({
      quote: { c: 1, _meta: { reliability: 'high', freshness: 'live' } },
      profile: { name: 'X' },
      metrics: { peNormalizedAnnual: 1, revenueGrowthTTMYoy: 1, epsNormalizedAnnual: 1, '52WeekHigh': 1, marketCapitalization: 1 },
      news: Array(20).fill({}),
    });
    ok(c.score <= 100);
  });
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
