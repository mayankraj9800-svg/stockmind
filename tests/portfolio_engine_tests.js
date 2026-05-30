'use strict';
// PortfolioEngine tests (Phase 2). Allocations MUST equal exactly 100%.
const path = require('path');
const PE = require(path.join(__dirname, '..', 'frontend', 'engines', 'portfolioEngine.js'));
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

const sum = p => p.holdings.reduce((s, h) => s + h.weight, 0);

module.exports = function run() {
  suite('Portfolio — allocations always sum to exactly 100%');
  const cases = [
    { type: 'retirement', amount: 100000, age: 65, riskTolerance: 'conservative' },
    { type: 'aggressive', amount: 75000, age: 28, riskTolerance: 'aggressive' },
    { type: 'dividend', amount: 100000, income: true },
    { type: 'ai', amount: 50000, age: 35, riskTolerance: 'aggressive' },
    { type: 'balanced', amount: 250000, age: 40, riskTolerance: 'moderate' },
    { type: 'growth', amount: 10000, age: 30 },
    { type: 'conservative', amount: 100000, age: 70 },
    { type: 'global', amount: 200000, age: 45 },
    { country: 'IN', amount: 1000000, age: 35, riskTolerance: 'moderate' },
    { country: 'IN', type: 'dividend', amount: 1000000 },
  ];
  for (const c of cases) {
    const p = PE.build(c);
    test(`${c.country || 'US'}/${p.type} sums to 100`, () => eq(sum(p), 100));
    test(`${c.country || 'US'}/${p.type} totalWeight field = 100`, () => eq(p.totalWeight, 100));
  }

  suite('Portfolio — dollar/rupee allocation matches weights');
  const p1 = PE.build({ type: 'balanced', amount: 100000, age: 40 });
  test('amounts sum ≈ investment (±rounding)', () => ok(Math.abs(p1.holdings.reduce((s, h) => s + h.amount, 0) - 100000) <= p1.holdings.length));
  test('each holding amount = weight% of total', () => ok(p1.holdings.every(h => Math.abs(h.amount - h.weight / 100 * 100000) <= 1)));
  const pIN = PE.build({ country: 'IN', amount: 1000000, age: 35 });
  test('Indian portfolio uses ₹ currency', () => eq(pIN.currency, '₹'));
  test('Indian holdings are .NS tickers', () => ok(pIN.holdings.every(h => /\.NS$/.test(h.symbol) || /BEES/.test(h.symbol))));

  suite('Portfolio — risk matches profile');
  const cons = PE.build({ type: 'conservative', amount: 100000, age: 70 });
  const aggr = PE.build({ type: 'aggressive', amount: 100000, age: 28, riskTolerance: 'aggressive' });
  test('conservative risk score < aggressive', () => ok(cons.riskScore < aggr.riskScore));
  test('conservative labelled Low/Conservative', () => ok(['Low', 'Conservative'].includes(cons.riskLabel)));
  test('aggressive labelled Moderate/High', () => ok(['Moderate', 'High'].includes(aggr.riskLabel)));
  test('conservative has NO speculative (tier-5) holding', () => notOk(cons.holdings.some(h => h.riskTier >= 5)));
  test('conservative max single weight ≤ 40 (no over-concentration)', () => ok(cons.holdings.every(h => h.weight <= 40)));

  suite('Portfolio — age influences allocation');
  const young = PE.build({ type: 'growth', amount: 100000, age: 28 });
  const old   = PE.build({ type: 'growth', amount: 100000, age: 68 });
  test('older investor gets more defensive (lower risk score)', () => ok(old.riskScore < young.riskScore));
  test('older investor gets a fixed-income/defensive sleeve', () => ok(old.holdings.some(h => h.riskTier <= 1 || /BND|BEES/.test(h.symbol))));

  suite('Portfolio — retirement vs growth differ');
  const ret = PE.build({ type: 'retirement', amount: 100000, age: 65 });
  const gro = PE.build({ type: 'growth', amount: 100000, age: 30 });
  test('retirement yields more than growth', () => ok(ret.expectedYield > gro.expectedYield));
  test('retirement is lower risk than growth', () => ok(ret.riskScore < gro.riskScore));
  test('retirement emphasises dividends/bonds', () => ok(ret.holdings.some(h => /SCHD|VYM|BND|O\b/.test(h.symbol))));

  suite('Portfolio — dividend portfolio realistic yield');
  const div = PE.build({ type: 'dividend', amount: 100000 });
  test('dividend yield between 2% and 7%', () => ok(div.expectedYield >= 2 && div.expectedYield <= 7));
  test('annual income = amount × yield', () => eq(div.annualIncome, Math.round(100000 * div.expectedYield / 100)));

  suite('Portfolio — sector exposure sums to 100');
  const secSum = Object.values(p1.sectorExposure).reduce((s, w) => s + w, 0);
  test('sector exposure totals 100', () => eq(secSum, 100));

  suite('Portfolio — riskiest holding + safer replacement');
  const ai = PE.build({ type: 'ai', amount: 100000, age: 30, riskTolerance: 'aggressive' });
  const worst = PE.riskiestHolding(ai);
  test('riskiest is a tier-5 holding', () => eq(worst.riskTier, 5));
  const safer = PE.replaceRiskiest(ai);
  test('replacement still sums to 100', () => eq(sum(safer), 100));
  test('replacement lowers risk score', () => ok(safer.riskScore < ai.riskScore));
  test('riskReduction is positive', () => ok(safer.riskReduction > 0));
  test('riskiest symbol removed', () => notOk(safer.holdings.some(h => h.symbol === worst.symbol) && worst.symbol !== safer.added));
  test('reports removed + added', () => ok(safer.removed && safer.added));

  suite('Portfolio — recession commentary present & type-appropriate');
  test('aggressive recession note mentions drawdown/sensitivity', () => ok(/recession|drawdown|sensitive/i.test(ai.recession)));
  test('retirement recession note mentions defensive/income', () => ok(/defensive|income|cushion/i.test(ret.recession)));

  suite('Portfolio — theme/profile inference');
  test('"AI" theme → ai type', () => eq(PE.build({ themes: ['AI'], amount: 1000 }).type, 'ai'));
  test('age 65 + conservative → retirement', () => eq(PE.pickType({ age: 65, riskTolerance: 'conservative' }), 'retirement'));
  test('income flag → dividend', () => eq(PE.pickType({ income: true }), 'dividend'));
  test('aggressive → aggressive', () => eq(PE.pickType({ riskTolerance: 'aggressive' }), 'aggressive'));

  suite('Portfolio — disclaimer (no fake live data claim)');
  test('every portfolio carries a model disclaimer', () => ok(/model|estimate|not financial advice/i.test(p1.disclaimer)));

  suite('Portfolio — theme-preserving replacement (preserveTheme)');
  const aiPort = PE.build({ themes: ['ai'], amount: 100000 });
  test('default replace lowers risk', () => ok(PE.replaceRiskiest(aiPort).riskReduction > 0));
  test('preserveTheme swaps for a LOWER-risk tech name (not a dividend ETF)', () => {
    const r = PE.replaceRiskiest(aiPort, { preserveTheme: true });
    ok(r.added !== 'SCHD', 'should not fall back to SCHD when a theme-safe swap exists');
    ok(/MSFT|GOOGL|AMZN|AVGO/.test(r.added), 'theme-preserving swap got: ' + r.added);
    ok(r.riskReduction > 0, 'still reduces risk');
  });
  test('themed portfolio preserves objective by DEFAULT (no opts) — Priority 3', () => {
    const r = PE.replaceRiskiest(aiPort); // no opts
    eq(r.objectivePreserved, true); ok(r.added !== 'SCHD');
  });
  test('explicit defensive opt-out → generic safe swap allowed', () => {
    const r = PE.replaceRiskiest(aiPort, { preserveTheme: false });
    eq(r.objectivePreserved, false);
  });
  test('engine reports objectivePreserved flag', () => ok('objectivePreserved' in PE.replaceRiskiest(aiPort)));

  suite('Portfolio — explicit type keyword honoured');
  test('type:retirement → retirement (low risk)', () => { const p = PE.build({ type: 'retirement', amount: 100000 }); eq(p.type, 'retirement'); ok(p.riskScore < 50); });
  test('type:aggressive → aggressive', () => eq(PE.build({ type: 'aggressive', amount: 1000 }).type, 'aggressive'));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
