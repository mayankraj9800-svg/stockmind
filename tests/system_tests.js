'use strict';
// SYSTEM TESTS — validate StockMind's strict fundamental validation.
// Pass criteria: verified data is returned & displayed, OR missing data is
// detected and analysis is blocked. The system must NEVER surface an invalid,
// inferred, or fabricated fundamental.
const path = require('path');
const v = require(path.join(__dirname, '..', 'backend', 'src', 'services', 'metricsValidator'));
const { suite, test, eq, ok, notOk } = require('./helpers/runner');

module.exports = function run() {
  suite('System — isValidMetric rejects all non-numbers');
  test('null → invalid',       () => notOk(v.isValidMetric(null)));
  test('undefined → invalid',  () => notOk(v.isValidMetric(undefined)));
  test('NaN → invalid',        () => notOk(v.isValidMetric(NaN)));
  test('Infinity → invalid',   () => notOk(v.isValidMetric(Infinity)));
  test('empty string → invalid', () => notOk(v.isValidMetric('')));
  test('non-numeric string → invalid', () => notOk(v.isValidMetric('N/A')));
  test('boolean → invalid',    () => notOk(v.isValidMetric(true)));
  test('0 → valid (real value)', () => ok(v.isValidMetric(0)));
  test('28.5 → valid',         () => ok(v.isValidMetric(28.5)));
  test('numeric string "12.1" → valid', () => ok(v.isValidMetric('12.1')));

  suite('System — full US metrics: verified data displayed');
  const full = { peTTM: 28.4, epsTTM: 6.1, roeTTM: 31.2, roaTTM: 12, grossMarginTTM: 44,
                 netProfitMarginTTM: 25, revenueGrowthTTMYoy: 8, pbAnnual: 12, psTTM: 7,
                 beta: 1.1, '52WeekHigh': 200, '52WeekLow': 120, dividendYieldIndicatedAnnual: 0.5,
                 'totalDebt/totalEquityAnnual': 1.2, peNormalizedAnnual: 27 };
  const rFull = v.validateMetrics(full, { symbol: 'AAPL' });
  test('PE present & validated', () => eq(rFull.validated['PE'], 28.4));
  test('ROE present & validated', () => eq(rFull.validated['ROE'], 31.2));
  test('nothing missing for full set', () => eq(rFull.missing.length, 0));
  test('fundamental analysis permitted', () => ok(rFull.canAnalyseFundamentals));

  suite('System — empty metrics (NSE-style): analysis blocked, nothing invented');
  const rEmpty = v.validateMetrics({}, { symbol: 'RELIANCE.NS' });
  test('no validated metrics', () => eq(Object.keys(rEmpty.validated).length, 0));
  test('all required fields reported missing', () => ok(rEmpty.missing.length >= 15));
  test('fundamental analysis BLOCKED', () => notOk(rEmpty.canAnalyseFundamentals));
  test('never fabricates a value (all null in coverage)', () => ok(rEmpty.coverage.every(c => c.value === null)));

  suite('System — partial/dirty metrics: only valid fields pass');
  const dirty = { peTTM: 22, roeTTM: null, roaTTM: NaN, grossMarginTTM: 'N/A',
                  netProfitMarginTTM: undefined, beta: 0.9, epsTTM: Infinity };
  const rDirty = v.validateMetrics(dirty, { symbol: 'XYZ' });
  test('valid PE kept', () => eq(rDirty.validated['PE'], 22));
  test('valid Beta kept', () => eq(rDirty.validated['Beta'], 0.9));
  test('null ROE blocked', () => ok(rDirty.missing.includes('ROE')));
  test('NaN ROA blocked', () => ok(rDirty.missing.includes('ROA')));
  test('string Gross Margin blocked', () => ok(rDirty.missing.includes('Gross Margin')));
  test('undefined Net Margin blocked', () => ok(rDirty.missing.includes('Net Margin')));
  test('Infinity EPS blocked', () => ok(rDirty.missing.includes('EPS')));

  suite('System — bank coverage includes NPA fields (always Missing on free tier)');
  const rBank = v.validateMetrics({ peTTM: 18 }, { symbol: 'HDFCBANK', profile: { finnhubIndustry: 'Banks' } });
  test('Gross NPA tracked as a required bank field', () => ok(rBank.coverage.some(c => c.label === 'Gross NPA')));
  test('Net NPA reported missing (not invented)', () => ok(rBank.missing.includes('Net NPA')));
  test('NIM reported missing', () => ok(rBank.missing.includes('NIM')));
  test('non-bank does NOT add NPA fields', () => {
    const r = v.validateMetrics({ peTTM: 18 }, { symbol: 'AAPL', profile: { finnhubIndustry: 'Technology' } });
    notOk(r.coverage.some(c => c.label === 'Net NPA'));
  });

  suite('System — blocked metrics are logged (req 7)');
  test('logBlocked emits METRICS_BLOCKED with symbol + blocked list', () => {
    const calls = [];
    const fakeLogger = { warn: (msg, meta) => calls.push({ msg, meta }) };
    v.logBlocked(fakeLogger, 'RELIANCE.NS', ['ROE', 'ROA', 'Net NPA']);
    eq(calls.length, 1);
    eq(calls[0].msg, 'METRICS_BLOCKED');
    eq(calls[0].meta.symbol, 'RELIANCE.NS');
    eq(calls[0].meta.count, 3);
    ok(calls[0].meta.blocked.includes('Net NPA'));
  });
  test('logBlocked no-ops when nothing missing', () => {
    let n = 0; v.logBlocked({ warn: () => n++ }, 'AAPL', []); eq(n, 0);
  });

  suite('System — coverage report format matches spec');
  const rep = v.formatCoverageReport('HDFC Bank', v.validateMetrics({ peTTM: 18 }, { symbol: 'HDFCBANK', profile: { finnhubIndustry: 'Banks' } }).coverage);
  test('report starts with symbol', () => ok(rep.startsWith('HDFC Bank')));
  test('report has Coverage: header', () => ok(/Coverage:/.test(rep)));
  test('report shows PE: Available', () => ok(/PE: Available/.test(rep)));
  test('report shows a Missing field', () => ok(/: Missing/.test(rep)));
};

if (require.main === module) { module.exports(); require('./helpers/runner').summary(); }
