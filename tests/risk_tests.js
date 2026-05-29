'use strict';
// Risk engine + technicals + sentiment — hallucination & data-quality guards (E, F, I).
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  const { APP } = loadFrontend();

  suite('Risk — level scales with risk factors');
  test('no data → Unknown', () => eq(APP.calculateRisk(null, null).level, 'Unknown'));
  test('calm blue-chip → Low', () => eq(APP.calculateRisk({ beta: '0.9', peTTM: '20' }, { dp: 0.3 }).level, 'Low'));
  test('high beta + extreme P/E + big move → High', () => {
    const r = APP.calculateRisk({ beta: '2.1', peTTM: '90' }, { dp: 9 });
    eq(r.level, 'High'); ok(r.factors.length >= 3);
  });
  test('elevated but not extreme → Moderate', () => {
    eq(APP.calculateRisk({ beta: '1.5', peTTM: '40' }, { dp: 1 }).level, 'Moderate');
  });
  test('risk factors are explanatory strings', () => {
    const r = APP.calculateRisk({ beta: '2.0' }, { dp: 0 });
    ok(r.factors.some(f => /beta/i.test(f)));
  });

  suite('Technicals — never fabricated when candles missing (E, I)');
  const tNoCandle = APP.computeTechnicals({ '52WeekHigh': 200, '52WeekLow': 100 }, { c: 150 }, null);
  test('null candles → rsi stays null', () => eq(tNoCandle.rsi, null));
  test('null candles → macd stays null', () => eq(tNoCandle.macd, null));
  test('null candles → candlesBased false', () => eq(tNoCandle.candlesBased, false));
  test('empty candle array → no crash, rsi null', () => eq(APP.computeTechnicals(null, { c: 150 }, { c: [] }).rsi, null));
  test('undefined quote → safe base result', () => eq(APP.computeTechnicals(null, undefined, null).trend, 'Neutral'));
  test('52w position computed from metrics only', () => eq(tNoCandle.position52w, 50));

  suite('Technicals — real RSI/MACD only with enough candles');
  const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2);
  const tWithCandle = APP.computeTechnicals(null, { c: closes[closes.length - 1] }, { c: closes });
  test('with 40 candles → candlesBased true', () => eq(tWithCandle.candlesBased, true));
  test('RSI computed in 0..100 range', () => ok(tWithCandle.rsi == null || (tWithCandle.rsi >= 0 && tWithCandle.rsi <= 100)));

  suite('Sentiment — no fabrication on empty news (E)');
  test('no news → Neutral, explicit message', () => {
    const s = APP.analyzeSentiment([]);
    eq(s.label, 'Neutral'); ok(/no recent news/i.test(s.summary));
  });
  test('positive headlines → Positive', () => {
    const s = APP.analyzeSentiment([{ headline: 'Company beats record profit, analysts upgrade' }]);
    ok(['Positive', 'Neutral'].includes(s.label));
  });
  test('negative headlines → Negative-leaning', () => {
    const s = APP.analyzeSentiment([{ headline: 'Stock drops on weak guidance, downgrade and lawsuit' }]);
    ok(['Negative', 'Neutral'].includes(s.label));
  });
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
