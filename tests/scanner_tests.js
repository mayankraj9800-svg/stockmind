'use strict';
// Scanner engine (Phase 2 I) + batch request limits.
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  const { APP, ApiClient } = loadFrontend();

  suite('Scanner — routing & region');
  test('"run AI scan" → SCANNER', () => eq(APP.classifyIntent('run AI scan').mode, 'SCANNER'));
  test('"best Indian stocks" → SCANNER/IN', () => {
    const i = APP.classifyIntent('best indian stocks to buy now');
    eq(i.mode, 'SCANNER'); eq(i.region, 'IN');
  });
  test('explicit ticker suppresses scanner', () => eq(APP.classifyIntent('show me AAPL').mode, 'SINGLE_STOCK'));

  suite('Scanner — never fabricates indicators (I)');
  // Scanner cells compute technicals from quote only; without candles RSI/MACD
  // must be null (rendered as N/A), never invented.
  const t = APP.computeTechnicals(null, { c: 100, dp: 1 }, null);
  test('scanner technicals: RSI null without candles', () => eq(t.rsi, null));
  test('scanner technicals: MACD null without candles', () => eq(t.macd, null));
  test('scanner technicals: rsiNote carries NO fabricated RSI number', () => notOk(/RSI\s*\d/i.test(t.rsiNote || '')));

  suite('Scanner — batch quote chunking respects ≤30 limit (Error / RISK A)');
  // Patch _post to capture chunk sizes (no network).
  const sizes = [];
  ApiClient._post = async (path, body) => { sizes.push(body.symbols.length); return body.symbols.map(s => ({ symbol: s, quote: { c: 1, dp: 0 } })); };

  return (async () => {
    const big = Array.from({ length: 110 }, (_, i) => 'SYM' + i);
    const res = await ApiClient.batchQuotes(big);
    test('110 symbols → all results returned', () => eq(res.length, 110));
    test('every chunk ≤ 30 (backend limit)', () => ok(Math.max(...sizes) <= 30));
    test('every chunk ≤ 25 (safety margin)', () => ok(Math.max(...sizes) <= 25));
    test('chunks reassembled in order', () => eq(res[0].symbol, 'SYM0'));

    const dupes = await ApiClient.batchQuotes(['AAPL', 'AAPL', 'MSFT', 'AAPL']);
    test('duplicate symbols de-duplicated before request', () => eq(dupes.length, 2));

    const empty = await ApiClient.batchQuotes([]);
    test('empty list → empty result, no request', () => eq(empty.length, 0));
  })();
};

if (require.main === module) { Promise.resolve(module.exports()).then(() => require('./helpers/runner').summary()); }
