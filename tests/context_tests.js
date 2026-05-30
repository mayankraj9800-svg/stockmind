'use strict';
// Conversation memory engine tests (Phase 1).
const path = require('path');
const CC = require(path.join(__dirname, '..', 'frontend', 'engines', 'conversationContext.js'));
const { suite, test, eq, ok, notOk } = require('./helpers/runner');
const reserved = t => ['BUY','SELL','HOLD','RSI','PE','ETF','US','UK','AI','NPA'].includes(t);

module.exports = function run() {
  suite('Context — single stock recall ("its risks" never drifts)');
  CC.clear(); CC.setStock('TSLA', 'Tesla');
  test('lastPrimarySymbol stored', () => eq(CC.lastPrimarySymbol, 'TSLA'));
  test('"What are its risks?" → single-followup on TSLA', () => {
    const r = CC.resolveReference('What are its biggest risks?', { reservedCaps: reserved });
    eq(r.kind, 'single-followup'); eq(r.symbol, 'TSLA');
  });
  test('"is it a BUY or SELL?" still resolves to TSLA (caps ignored)', () => {
    eq(CC.resolveReference('is it a BUY or SELL right now?', { reservedCaps: reserved }).symbol, 'TSLA');
  });
  test('new ticker breaks single-followup', () => {
    eq(CC.resolveReference('what about NVDA?', { reservedCaps: reserved }).kind, 'none');
  });

  suite('Context — comparison recall');
  CC.clear(); CC.setComparison(['MSFT', 'GOOGL']);
  test('comparison stored', () => eq(CC.lastComparison, ['MSFT', 'GOOGL']));
  test('"which has a stronger moat?" → comparison-followup', () => {
    const r = CC.resolveReference('which company has the stronger moat?', { reservedCaps: reserved });
    eq(r.kind, 'comparison-followup'); eq(r.symbols, ['MSFT', 'GOOGL']);
  });
  test('"which one is safer?" → comparison-followup', () => eq(CC.resolveReference('which one is safer?', { reservedCaps: reserved }).kind, 'comparison-followup'));
  test('single stock clears comparison', () => { CC.setStock('AAPL'); eq(CC.lastComparison, null); });

  suite('Context — portfolio recall');
  CC.clear(); CC.setPortfolio({ holdings: [{ symbol: 'NVDA' }], riskScore: 80 });
  test('"which holding is riskiest?" → portfolio-followup', () => eq(CC.resolveReference('which holding is the riskiest?').kind, 'portfolio-followup'));
  test('"replace it with something safer" → portfolio-followup', () => eq(CC.resolveReference('replace it with something safer').kind, 'portfolio-followup'));
  test('"how much safer is the new portfolio?" → portfolio-followup', () => eq(CC.resolveReference('how much safer is the new portfolio?').kind, 'portfolio-followup'));

  suite('Context — watchlist recall');
  CC.clear(); CC.setWatchlist({ theme: 'ai', items: [{ ticker: 'NVDA' }] });
  test('"which one has the highest upside?" → watchlist-followup', () => eq(CC.resolveReference('which one has the highest upside?', { reservedCaps: reserved }).kind, 'watchlist-followup'));

  suite('Context — user profile extraction');
  test('age parsed', () => eq(CC.extractProfile('I am 60 years old and risk-averse').age, 60));
  test('conservative risk parsed', () => eq(CC.extractProfile('I am 60 years old and risk-averse').riskTolerance, 'conservative'));
  test('aggressive risk parsed', () => eq(CC.extractProfile('28, moderately aggressive, into AI').riskTolerance, 'aggressive'));
  test('income preference parsed', () => eq(CC.extractProfile('I want dividend income').income, true));
  test('country IN parsed', () => eq(CC.extractProfile('build an indian portfolio with ₹10,00,000').country, 'IN'));
  test('long horizon parsed', () => eq(CC.extractProfile('I want to retire early, 10+ years').horizon, 'long'));
  test('profile persists via setProfile', () => { CC.clear(); CC.setProfile({ age: 35, riskTolerance: 'moderate' }); eq(CC.lastUserProfile.age, 35); });
  test('setProfile merges (does not wipe)', () => { CC.setProfile({ country: 'US' }); eq(CC.lastUserProfile.age, 35); eq(CC.lastUserProfile.country, 'US'); });

  suite('Context — active-topic isolation (no bleed / wrong-context)');
  test('portfolio→stock: "which is riskiest?" does NOT bleed to portfolio', () => {
    CC.clear(); CC.setPortfolio({ holdings: [{ symbol: 'NVDA' }] }); CC.setStock('AAPL', 'Apple');
    notOk(CC.resolveReference('which one is the riskiest?', { reservedCaps: reserved }).kind === 'portfolio-followup');
    eq(CC.lastPortfolio, null, 'stale portfolio cleared on topic switch');
  });
  test('comparison→portfolio: "which is safer?" does NOT bleed to comparison', () => {
    CC.clear(); CC.setComparison(['MSFT', 'GOOGL']); CC.setPortfolio({ holdings: [{ symbol: 'V' }] });
    eq(CC.resolveReference('which holding is safer?').kind, 'portfolio-followup');
    eq(CC.lastComparison, null);
  });
  test('stock→comparison clears single-stock topic', () => {
    CC.clear(); CC.setStock('TSLA'); CC.setComparison(['TSLA', 'NVDA']);
    eq(CC.activeTopic, 'comparison');
  });
  test('activeTopic reflects most recent action', () => {
    CC.clear(); CC.setStock('AAPL'); eq(CC.activeTopic, 'stock');
    CC.setWatchlist({ theme: 'ai', items: [] }); eq(CC.activeTopic, 'watchlist');
    eq(CC.lastPrimarySymbol, null, 'stock symbol cleared when switching to watchlist');
  });

  suite('Context — "which …" follow-ups stay on the active stock');
  test('"which risk concerns you the most?" is a follow-up (not a new search)', () => ok(CC.isFollowUp('which risk concerns you the most?')));
  test('after stock, "which risk …" resolves to that stock', () => {
    CC.clear(); CC.setStock('TSLA', 'Tesla');
    eq(CC.resolveReference('which risk concerns you the most?', { reservedCaps: reserved }).symbol, 'TSLA');
  });
  test('portfolio→ "which one should receive additional capital?" stays portfolio (no drift)', () => {
    CC.clear(); CC.setPortfolio({ holdings: [{ symbol: 'NVDA', weight: 30, riskTier: 5 }] });
    eq(CC.resolveReference('which one should receive additional capital?').kind, 'portfolio-followup');
  });

  suite('Context — reasoning follow-up beats asset lookup (decision memory)');
  CC.clear();
  CC.setPortfolio({ type: 'aggressive', riskScore: 83, holdings: [{ symbol: 'SCHD', weight: 20, riskTier: 2 }] });
  CC.setObjective('ai / technology');
  CC.addDecision({ type: 'replace', removed: 'NVDA', added: 'SCHD', reason: 'highest risk tier', objective: 'ai / technology', objectivePreserved: false, alternatives: ['MSFT', 'GOOGL', 'AMZN'], riskBefore: 83, riskAfter: 68 });
  test('"Why did you replace NVIDIA with SCHD?" → portfolio-reasoning (NOT etf lookup)', () => {
    const r = CC.resolveReference('Why did you replace NVIDIA with SCHD instead of another AI or cloud company?', { reservedCaps: reserved });
    eq(r.kind, 'portfolio-reasoning');
  });
  test('reasoning carries the stored decision', () => {
    const r = CC.resolveReference('why that choice?', { reservedCaps: reserved });
    eq(r.decision.removed, 'NVDA'); eq(r.decision.added, 'SCHD');
    ok(r.decision.alternatives.includes('MSFT')); eq(r.decision.objectivePreserved, false);
  });
  test('"explain the change" → portfolio-reasoning', () => eq(CC.resolveReference('explain the change', { reservedCaps: reserved }).kind, 'portfolio-reasoning'));
  test('decisionHistory retains the decision', () => ok(CC.decisionHistory.some(d => d.removed === 'NVDA')));
  test('a genuine "analyse SCHD" lookup is NOT a reasoning follow-up', () => {
    // no reasoning words → must fall through to asset lookup
    notOk(CC.resolveReference('analyse SCHD', { reservedCaps: reserved }).kind === 'portfolio-reasoning');
  });
  test('switching to a stock clears the decision', () => { CC.setStock('AAPL'); eq(CC.lastDecision, null); });
  test('IMPERATIVE "Replace it with a safer alternative" is NOT reasoning (it is an action)', () => {
    CC.clear(); CC.setPortfolio({ type: 'ai', holdings: [{ symbol: 'NVDA', weight: 30, riskTier: 5 }] });
    notOk(CC.resolveReference('Replace it with a safer alternative while preserving the AI/cloud objective.').kind === 'portfolio-reasoning');
  });
  test('"Replace it…" resolves to portfolio-followup (action)', () => {
    CC.clear(); CC.setPortfolio({ type: 'ai', holdings: [{ symbol: 'NVDA', weight: 30, riskTier: 5 }] });
    eq(CC.resolveReference('Replace it with a safer alternative.').kind, 'portfolio-followup');
  });
  test('"Why did you replace NVIDIA with SCHD?" IS reasoning (past-tense question)', () => {
    CC.clear(); CC.setPortfolio({ type: 'ai', holdings: [{ symbol: 'SCHD' }] });
    CC.addDecision({ type: 'replace', removed: 'NVDA', added: 'SCHD', alternatives: ['MSFT'] });
    eq(CC.resolveReference('Why did you replace NVIDIA with SCHD?', { reservedCaps: reserved }).kind, 'portfolio-reasoning');
  });

  suite('Context — scanner memory (Priority 7)');
  CC.clear(); CC.setScanner({ bull: [{ sym: 'AAPL', note: '+2%' }], momentum: [{ sym: 'NVDA', note: 'breakout' }], aiPicks: [{ sym: 'NVDA' }], volatile: [], bear: [] });
  test('scanner stored + activeTopic=scanner', () => { ok(CC.lastScanner); eq(CC.activeTopic, 'scanner'); });
  test('"which has the best setup?" → scanner-followup', () => eq(CC.resolveReference('which has the best setup?', { reservedCaps: reserved }).kind, 'scanner-followup'));
  test('"which is safest?" → scanner-followup', () => eq(CC.resolveReference('which one is safest?', { reservedCaps: reserved }).kind, 'scanner-followup'));
  test('new ticker breaks scanner-followup', () => eq(CC.resolveReference('what about TSLA?', { reservedCaps: reserved }).kind, 'none'));
  test('analyzing a stock clears scanner', () => { CC.setStock('AAPL'); eq(CC.lastScanner, null); });

  suite('Context — turns + clear');
  CC.clear();
  for (let i = 0; i < 12; i++) CC.addTurn('user', 'msg ' + i);
  test('turns capped at 8', () => eq(CC.turns.length, 8));
  test('clear resets everything', () => { CC.clear(); eq(CC.lastPrimarySymbol, null); eq(CC.lastPortfolio, null); eq(CC.turns.length, 0); });
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
