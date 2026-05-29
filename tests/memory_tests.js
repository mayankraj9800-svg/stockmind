'use strict';
// Memory & follow-up resolution (Phase 2 A + J).
const { loadFrontend } = require('./helpers/loadFrontend');
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  const { APP } = loadFrontend();
  const mem = APP.memory;

  const fresh = () => { mem.clear(); };

  suite('Memory — follow-up detection (A)');
  fresh(); mem.setEntity('TSLA', 'Tesla', null, { quote: { c: 200 } });
  test('"what are its risks?" is a follow-up', () => ok(mem.isFollowUp('what are its risks?')));
  test('"tell me more" is a follow-up', () => ok(mem.isFollowUp('tell me more')));
  test('"is it a BUY or SELL?" is STILL a follow-up (caps words ignored)', () => ok(mem.isFollowUp('is it a BUY or SELL?')));
  test('"how is its RSI?" is a follow-up (RSI not a new ticker)', () => ok(mem.isFollowUp('how is its RSI?')));
  test('"what about its PE and ROE?" is a follow-up', () => ok(mem.isFollowUp('what about its PE and ROE?')));
  test('"should I hold it?" is a follow-up', () => ok(mem.isFollowUp('should I hold it?')));

  suite('Memory — new ticker breaks follow-up (no contamination)');
  test('"analyse NVDA" is NOT a follow-up (real new ticker)', () => notOk(mem.isFollowUp('analyse NVDA')));
  test('"what about AAPL" is NOT a follow-up', () => notOk(mem.isFollowUp('what about AAPL')));
  test('"how about microsoft" is NOT a follow-up (company name)', () => notOk(mem.isFollowUp('how about microsoft')));

  suite('Memory — entity recall (A)');
  fresh(); mem.setEntity('TSLA', 'Tesla', { finnhubIndustry: 'Auto' }, { quote: { c: 250 } });
  test('activeTicker retained', () => eq(mem.activeTicker, 'TSLA'));
  test('activeEntity retained', () => eq(mem.activeEntity, 'Tesla'));
  test('context summary mentions Tesla + TSLA', () => {
    const s = mem.getContextSummary();
    ok(s.includes('Tesla') && s.includes('TSLA'), 'summary: ' + s);
  });
  test('switching entity replaces, never merges', () => {
    mem.setEntity('AAPL', 'Apple', null, { quote: { c: 190 } });
    eq(mem.activeTicker, 'AAPL'); eq(mem.activeEntity, 'Apple');
  });

  suite('Memory — single-stock clears stale comparison (no drift)');
  fresh(); mem.setComparison(['AAPL', 'MSFT']);
  test('comparison set', () => eq(mem.activeComparison, ['AAPL', 'MSFT']));
  test('setEntity clears comparison', () => { mem.setEntity('TSLA', 'Tesla', null, {}); eq(mem.activeComparison, null); });

  suite('Memory — rolling conversation window');
  fresh();
  for (let i = 0; i < 10; i++) mem.addTurn('user', 'message ' + i);
  test('window capped at 6 turns', () => eq(mem.conversationTurns.length, 6));
  test('window keeps the most recent', () => ok(mem.conversationTurns[5].content.includes('9')));
  test('turn content truncated to 400 chars', () => { mem.addTurn('user', 'x'.repeat(1000)); ok(mem.conversationTurns.slice(-1)[0].content.length <= 400); });

  suite('Memory — clear() resets everything');
  mem.setEntity('NVDA', 'Nvidia', null, {}); mem.setComparison(['A', 'B']); mem.clear();
  test('activeTicker null after clear', () => eq(mem.activeTicker, null));
  test('activeComparison null after clear', () => eq(mem.activeComparison, null));
  test('turns empty after clear', () => eq(mem.conversationTurns.length, 0));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
