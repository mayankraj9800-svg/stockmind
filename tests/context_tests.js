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

  suite('Context — turns + clear');
  CC.clear();
  for (let i = 0; i < 12; i++) CC.addTurn('user', 'msg ' + i);
  test('turns capped at 8', () => eq(CC.turns.length, 8));
  test('clear resets everything', () => { CC.clear(); eq(CC.lastPrimarySymbol, null); eq(CC.lastPortfolio, null); eq(CC.turns.length, 0); });
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
