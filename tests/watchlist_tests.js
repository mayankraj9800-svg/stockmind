'use strict';
// WatchlistEngine tests (Phase 3).
const path = require('path');
const WL = require(path.join(__dirname, '..', 'frontend', 'engines', 'watchlistEngine.js'));
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  suite('Watchlist — theme detection');
  test('"AI stocks" → ai', () => eq(WL.detectTheme('create a watchlist of AI stocks'), 'ai'));
  test('"cybersecurity" → cybersecurity', () => eq(WL.detectTheme('best cybersecurity stocks'), 'cybersecurity'));
  test('"cloud computing" → cloud', () => eq(WL.detectTheme('cloud computing names'), 'cloud'));
  test('"semiconductor" → semiconductors', () => eq(WL.detectTheme('semiconductor leaders'), 'semiconductors'));
  test('"dividend" → dividend', () => eq(WL.detectTheme('dividend stocks list'), 'dividend'));
  test('"indian" → indian', () => eq(WL.detectTheme('top indian stocks'), 'indian'));
  test('"global growth" → global-growth', () => eq(WL.detectTheme('global growth stocks'), 'global-growth'));
  test('no theme → null', () => eq(WL.detectTheme('what is the weather'), null));

  suite('Watchlist — build returns required fields');
  for (const theme of WL.SUPPORTED_THEMES) {
    const w = WL.build(theme);
    test(`${theme}: returns items`, () => ok(w && w.items.length > 0));
    test(`${theme}: each item has ticker/company/sector/reason`, () =>
      ok(w.items.every(i => i.ticker && i.company && i.sector && i.reason)));
  }

  suite('Watchlist — region coverage (US / India / International)');
  const ai = WL.build('ai');
  test('AI list spans multiple regions', () => ok(ai.regions.length >= 2));
  test('AI includes a US name', () => ok(ai.items.some(i => i.region === 'US')));
  test('AI includes an Indian name', () => ok(ai.items.some(i => i.region === 'India')));
  test('AI includes an International name', () => ok(ai.items.some(i => i.region === 'International')));

  suite('Watchlist — region filter');
  const usOnly = WL.build('ai', { region: 'US' });
  test('US filter returns only US', () => ok(usOnly.items.every(i => i.region === 'US')));
  const inOnly = WL.build('dividend', { region: 'India' });
  test('India filter returns only India', () => ok(inOnly.items.every(i => i.region === 'India')));

  suite('Watchlist — size limit + dedupe correctness');
  const cap = WL.build('semiconductors', { limit: 3 });
  test('respects limit', () => eq(cap.items.length, 3));
  test('no duplicate tickers', () => { const t = WL.build('ai').items.map(i => i.ticker); eq(t.length, new Set(t).size); });

  suite('Watchlist — invalid theme & disclaimer');
  test('unknown theme → null', () => eq(WL.build('nonsense-theme'), null));
  test('carries research disclaimer', () => ok(/research|not a recommendation/i.test(WL.build('ai').disclaimer)));

  suite('Watchlist — Indian tickers are .NS');
  test('indian theme uses .NS symbols', () => ok(WL.build('indian').items.every(i => /\.NS$/.test(i.ticker))));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
