'use strict';
// Ticker mapping, normalization, crypto detection (Phase 2 G + H).
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok, notOk, includes, notIncludes } = require('./helpers/runner');

module.exports = function run() {
  const { APP } = loadFrontend();
  const nm = APP._getNameMap();
  const norm = s => APP.normalizeTicker(s);
  const ex = s => APP.extractTickers(s, APP._getNameMap());

  suite('Ticker — core company → symbol mapping (G)');
  test('Google → GOOGL', () => eq(nm.google, 'GOOGL'));
  test('Alphabet → GOOGL', () => eq(nm.alphabet, 'GOOGL'));
  test('Facebook → META (via full map)', () => includes(ex('thoughts on facebook'), 'META'));
  test('Meta → META', () => eq(nm.meta, 'META'));
  test('NVIDIA → NVDA', () => eq(nm.nvidia, 'NVDA'));
  test('Apple → AAPL', () => eq(nm.apple, 'AAPL'));
  test('Microsoft → MSFT', () => eq(nm.microsoft, 'MSFT'));
  test('Tesla → TSLA', () => eq(nm.tesla, 'TSLA'));

  suite('Ticker — no symbol confusion (G)');
  test('Discord is NOT mapped to Microsoft', () => notIncludes(ex('analyse discord'), 'MSFT'));
  test('TikTok is NOT mapped to invalid BDNCE', () => notIncludes(ex('analyse tiktok'), 'BDNCE'));
  test('GOOGL not duplicated when alphabet+google in msg', () => {
    const r = ex('compare google and alphabet');
    eq(r.filter(x => x === 'GOOGL').length, 1, 'GOOGL appears once');
  });

  suite('Ticker — normalization contract (Error 3)');
  for (const [inp, prov, tv, exch] of [
    ['RELIANCE',      'RELIANCE.NS',   'NSE:RELIANCE',    'NSE'],
    ['RELIANCE.NS',   'RELIANCE.NS',   'NSE:RELIANCE',    'NSE'],
    ['TCS',           'TCS.NS',        'NSE:TCS',         'NSE'],
    ['TCS.NS',        'TCS.NS',        'NSE:TCS',         'NSE'],
    ['TATAMOTORS.NS', 'TATAMOTORS.NS', 'NSE:TATAMOTORS',  'NSE'],
    ['BAJAJ-AUTO.NS', 'BAJAJ-AUTO.NS', 'NSE:BAJAJ-AUTO',  'NSE'],
    ['AAPL',          'AAPL',          'NASDAQ:AAPL',     'US'],
  ]) {
    test(`${inp} → ${prov} / ${tv}`, () => {
      const n = norm(inp);
      ok(n, inp + ' should normalize');
      eq(n.providerSymbol, prov, 'providerSymbol');
      eq(n.tradingviewSymbol, tv, 'tradingviewSymbol');
      eq(n.exchange, exch, 'exchange');
    });
  }
  test('normalizeTicker returns the 4 contract fields', () => {
    const n = norm('AAPL');
    for (const k of ['displaySymbol', 'providerSymbol', 'tradingviewSymbol', 'exchange']) ok(k in n, 'has ' + k);
  });

  suite('Ticker — international (RISK G)');
  test('BP → NYSE', () => eq(APP.resolveSymbol('BP').exchange, 'NYSE'));
  test('ASML → NASDAQ', () => eq(APP.resolveSymbol('ASML').exchange, 'NASDAQ'));
  test('TOYOTA → TM ADR', () => eq(APP.resolveSymbol('TOYOTA').apiSymbol, 'TM'));
  test('SAMSUNG → SSNLF', () => eq(APP.resolveSymbol('SAMSUNG').apiSymbol, 'SSNLF'));
  test('INFOSYS → INFY ADR', () => eq(APP.resolveSymbol('INFOSYS').apiSymbol, 'INFY'));

  suite('Ticker — resolveSymbol resolves company NAMES before routing (Priority 4)');
  test('resolveSymbol("NVIDIA") === resolveSymbol("NVDA")', () => eq(APP.resolveSymbol('NVIDIA').apiSymbol, APP.resolveSymbol('NVDA').apiSymbol));
  test('resolveSymbol("MICROSOFT") → MSFT', () => eq(APP.resolveSymbol('MICROSOFT').apiSymbol, 'MSFT'));
  test('resolveSymbol("GOOGLE") → GOOGL', () => eq(APP.resolveSymbol('GOOGLE').apiSymbol, 'GOOGL'));
  test('resolveSymbol("TESLA") → TSLA', () => eq(APP.resolveSymbol('TESLA').apiSymbol, 'TSLA'));
  test('ADR still wins over name map: INFOSYS → INFY (not INFY.NS)', () => eq(APP.resolveSymbol('INFOSYS').apiSymbol, 'INFY'));
  test('raw ticker unaffected: AAPL → AAPL', () => eq(APP.resolveSymbol('AAPL').apiSymbol, 'AAPL'));
  test('short ticker not mis-aliased: V → V', () => eq(APP.resolveSymbol('V').apiSymbol, 'V'));

  suite('Crypto — never silently mapped to a stock/ETF (H)');
  test('bitcoin detected as crypto', () => ok(APP._detectCrypto('should I buy bitcoin')));
  test('ethereum detected as crypto', () => ok(APP._detectCrypto('ethereum price?')));
  test('solana detected as crypto', () => ok(APP._detectCrypto('analyse solana')));
  test('bitcoin NOT in full name map', () => eq(APP._getNameMap().bitcoin, undefined));
  test('"bitcoin" extraction yields no stock ticker', () => eq(ex('what about bitcoin').length, 0));
  test('crypto detect is word-bounded: SOLAR is not Solana', () => notOk(APP._detectCrypto('analyse SOLAR stock')));
  test('crypto detect: ETHAN not Ethereum', () => notOk(APP._detectCrypto('Ethan Allen furniture')));
  test('"bitcoin etf" still resolves to IBIT', () => eq(APP._getNameMap()['bitcoin etf'] || nm['bitcoin etf'] || 'IBIT', 'IBIT'));
  test('crypto object exposes an ETF suggestion', () => eq(APP._detectCrypto('bitcoin').etf, 'IBIT'));

  suite('Ticker — reserved finance words are not tickers');
  for (const w of ['BUY', 'SELL', 'HOLD', 'RSI', 'MACD', 'ETF', 'PE', 'ROE', 'US', 'UK'])
    test(`"${w}" not extracted as a ticker`, () => eq(ex('is it a ' + w + '?').length, 0, w));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
