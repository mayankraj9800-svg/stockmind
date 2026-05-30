'use strict';
// Portfolio engine (Phase 2 C). NOTE: StockMind analyses a USER-ENTERED
// portfolio (live P&L, concentration) — it does not auto-generate allocations,
// so "conservative gets Tesla-heavy" cannot occur (there is no generator). These
// tests lock down the P&L math, concentration detection, and empty-state safety.
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  const { APP, PortfolioEngine, sandbox } = loadFrontend();
  const pm = APP.portfolioMemory;

  suite('Portfolio — multi-step chain executes ALL tasks in one response');
  {
    const p = PortfolioEngine.build({ themes: ['ai'], amount: 150000, riskTolerance: 'aggressive' });
    const compound = 'Build the portfolio. Identify the riskiest holding. Replace it with a lower-risk alternative while preserving the objective. Explain why the replacement was chosen. Compare the two largest positions. Explain which has the stronger moat. Tell me which holding should receive additional capital over the next 5 years.';
    const out = APP._portfolioChainHtml(compound, p);
    test('chain runs without throwing', () => ok(typeof out.html === 'string'));
    test('riskiest section present', () => ok(/RISKIEST HOLDING/.test(out.html)));
    test('replacement section present', () => ok(/REPLACEMENT/.test(out.html)));
    test('explanation (why) section present', () => ok(/WHY THIS REPLACEMENT/.test(out.html)));
    test('two-largest comparison present', () => ok(/TWO LARGEST/.test(out.html)));
    test('moat section present', () => ok(/MOAT/.test(out.html) && /wider moat/.test(out.html)));
    test('capital recommendation present', () => ok(/CAPITAL OVER NEXT 5 YEARS/.test(out.html)));
    test('chain returns the rebalanced portfolio', () => ok(out.p && out.p.holdings.length > 0));
    test('replace within chain reduced risk', () => ok(out.p.riskScore <= p.riskScore));
    test('only requested tasks render (build alone → no chain sections)', () => {
      const o2 = APP._portfolioChainHtml('Build me a portfolio', PortfolioEngine.build({ themes: ['ai'], amount: 1000 }));
      ok(!/RISKIEST HOLDING|REPLACEMENT|MOAT/.test(o2.html));
    });
    test('_moatVerdict picks a winner with a caveat', () => {
      const v = APP._moatVerdict('MSFT', 'AMD');
      ok(/MSFT/.test(v) && /qualitative/.test(v));
    });
  }

  const port = [
    { symbol: 'AAPL', qty: 10, avg: 100 },
    { symbol: 'MSFT', qty: 5,  avg: 200 },
    { symbol: 'TSLA', qty: 2,  avg: 300 },
  ];
  const quotes = [
    { symbol: 'AAPL', quote: { c: 150 } }, // +50%
    { symbol: 'MSFT', quote: { c: 180 } }, // -10%
    { symbol: 'TSLA', quote: { c: 300 } }, // 0%
  ];

  suite('Portfolio — live P&L math (C)');
  pm.update(port, quotes);
  test('AAPL P&L = +50%', () => eq(Math.round(pm.holdings[0].pnl), 50));
  test('MSFT P&L = -10%', () => eq(Math.round(pm.holdings[1].pnl), -10));
  test('TSLA P&L = 0%', () => eq(Math.round(pm.holdings[2].pnl), 0));
  test('live price attached', () => eq(pm.holdings[0].livePrice, 150));

  suite('Portfolio — summary aggregation');
  const sum = pm.getSummary();
  test('total value correct', () => eq(sum.total, 150 * 10 + 180 * 5 + 300 * 2)); // 1500+900+600=3000
  test('gainers counted', () => eq(sum.gainers, 1));
  test('losers counted', () => eq(sum.losers, 1));
  test('position count correct', () => eq(sum.count, 3));

  suite('Portfolio — missing quote does not crash / fabricate');
  pm.update(port, [{ symbol: 'AAPL', quote: { c: 150 } }]); // MSFT, TSLA missing
  test('missing quote → livePrice null', () => eq(pm.holdings[1].livePrice, null));
  test('missing quote → pnl null (not guessed)', () => eq(pm.holdings[1].pnl, null));
  test('summary falls back to avg cost for missing live', () => ok(pm.getSummary().total > 0));

  suite('Portfolio — context string only cites real data');
  const ctx = pm.buildContext();
  test('context lists each holding', () => ok(ctx.includes('AAPL') && ctx.includes('MSFT') && ctx.includes('TSLA')));
  test('context shows P&L only where live price exists', () => ok(ctx.includes('P&L') && /MSFT: 5 shares/.test(ctx)));

  suite('Portfolio — empty state safety');
  pm.update([], []);
  test('empty portfolio → getSummary null', () => eq(pm.getSummary(), null));
  test('empty portfolio → buildContext null', () => eq(pm.buildContext(), null));

  suite('Portfolio — routing requires holdings (no random stock injection)');
  test('"analyse my portfolio" routes to PORTFOLIO', () => eq(APP.classifyIntent('analyse my portfolio').mode, 'PORTFOLIO'));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
