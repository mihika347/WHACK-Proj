const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({
  escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
});
vm.runInContext(fs.readFileSync(`${__dirname}/statistics-charts.js`, 'utf8'), context);

test('correctness shows partial failures and leaves missing data unavailable', () => {
  assert.match(context.correctnessChart({ total_cases: 10, passed_cases: 8 }), /2 did not pass · 80.0%/);
  assert.match(context.correctnessChart({}), /No completed/);
});

test('charts preserve slowdowns, calculate variance, and escape workload labels', () => {
  const html = context.measuredCharts({
    stats: { speed_status: 'pass' },
    workloads: [{ baseline_median_us: 10, median_us: 20 }, { baseline_median_us: 10, median_us: 5 }],
    sizes: [{ input_size: 10, median_speedup: 0.5 }],
  });
  assert.match(html, /0.563 ×²/);
  assert.match(html, /100.0% longer/);
  assert.match(html, /200.00 relative units/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(context.runtimeBars([{ label: '<script>', original: 10, final: 5 }], 'ms'), /&lt;script&gt;/);
});

test('unmeasured and empty results do not invent performance charts', () => {
  assert.equal(context.measuredCharts({ stats: { speed_status: 'error' } }), '');
  assert.equal(context.measuredCharts({ stats: { speed_status: 'pass' }, workloads: [] }), '');
});
