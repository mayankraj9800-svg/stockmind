'use strict';
/** Minimal zero-dependency test runner with assertion helpers. */
let _suite = '';
const results = { pass: 0, fail: 0, failures: [] };

function suite(name) { _suite = name; console.log('\n── ' + name + ' ──'); }

function test(desc, fn) {
  try {
    fn();
    results.pass++;
    console.log('  ✓ ' + desc);
  } catch (e) {
    results.fail++;
    results.failures.push({ suite: _suite, desc, msg: e.message });
    console.log('  ✗ ' + desc + '  → ' + e.message);
  }
}

function eq(actual, expected, note) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((note ? note + ': ' : '') + 'expected ' + e + ' got ' + a);
}
function ok(cond, note) { if (!cond) throw new Error(note || 'expected truthy'); }
function notOk(cond, note) { if (cond) throw new Error(note || 'expected falsy'); }
function includes(arr, val, note) {
  if (!Array.isArray(arr) || !arr.includes(val))
    throw new Error((note || 'array') + ' expected to include ' + JSON.stringify(val) + ' got ' + JSON.stringify(arr));
}
function notIncludes(arr, val, note) {
  if (Array.isArray(arr) && arr.includes(val))
    throw new Error((note || 'array') + ' should NOT include ' + JSON.stringify(val) + ' got ' + JSON.stringify(arr));
}

function summary() {
  const total = results.pass + results.fail;
  console.log('\n══════════════════════════════════════');
  console.log(`  TOTAL: ${total}  PASS: ${results.pass}  FAIL: ${results.fail}`);
  if (results.failures.length) {
    console.log('  Failures:');
    for (const f of results.failures) console.log(`   - [${f.suite}] ${f.desc}: ${f.msg}`);
  }
  console.log('══════════════════════════════════════');
  return results.fail === 0;
}

module.exports = { suite, test, eq, ok, notOk, includes, notIncludes, summary, results };
