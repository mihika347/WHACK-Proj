const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { median, normalise, sizeSeries, worstWorkload, escape, selectByThreshold } = require('./test-results.js');
const root = path.resolve(__dirname, '..');
const readReport = folder => JSON.parse(fs.readFileSync(path.join(root, folder, 'ui_results.json'), 'utf8'));

test('uses medians and leaves missing measurements missing', () => {
  assert.equal(median([4, 1, 2]), 2);
  assert.equal(median([]), null);
  const data = normalise({ summary: [{ stage: 'wrong.py', speed_status: 'skipped', speed_increase_percent: 99 }], charts: {} });
  assert.equal(data.summary[0].speed_increase_percent, null);
  assert.equal(worstWorkload(data, 'wrong.py'), null);
  assert.throws(() => normalise({ summary: [], charts: {} }));
});

test('threshold splits strictly, has no top-three limit, and blocks incorrect code', () => {
  const good = {correctness_status: 'pass', speed_status: 'pass', total_cases: 10,
    passed_cases: 10, failed_cases: 0, agent_status: 'used', stage_score: 75};
  const data = {summary: [1,2,3,4].map(i => ({...good, stage: `stage_${i}.py`}))};
  data.summary.push({...good, stage: 'stage_5.py', correctness_status: 'fail', failed_cases: 1});
  assert.equal(selectByThreshold(data, 75).key_stages.length, 0);
  assert.equal(selectByThreshold(data, 74).key_stages.length, 4);
  assert.equal(selectByThreshold(data, 0).review_stages[0].stage, 'stage_5.py');
  assert.throws(() => selectByThreshold(data, NaN));
});

test('derives size groups and worst relative slowdown from actual workloads', () => {
  const data = normalise({ summary: [{ stage: 'a.py' }], charts: { speed_by_workload: [
    { stage: 'a.py', workload: 'large', input_size: 1000, speedup: .5 },
    { stage: 'a.py', workload: 'small', input_size: 100, speedup: 2 },
    { stage: 'a.py', workload: 'small2', input_size: 100, speedup: 4 },
  ] } });
  assert.deepEqual(sizeSeries(data, 'a.py'), [
    { input_size: 100, speed_increase_percent: 200 },
    { input_size: 1000, speed_increase_percent: -50 },
  ]);
  assert.equal(worstWorkload(data, 'a.py').slowdown_percent, 100);
  assert.equal(data.summary[0].speed_increase_percent, 100);
});

test('current and deliberate failure exports obey the display contract', () => {
  const latest = normalise(readReport('reports'));
  for (const row of latest.summary) {
    if (row.speed_status === 'pass') {
      assert.ok(Number.isFinite(row.speed_increase_percent));
      assert.deepEqual(sizeSeries(latest, row.stage).map(point => point.input_size), [100, 1000, 10000]);
    }
  }
  const failure = normalise(readReport('examples/failure_demo/reports'));
  assert.ok(failure.summary.some(row => row.correctness_status === 'fail'));
  assert.ok(failure.summary.every(row => row.speed_increase_percent === null));
  assert.equal(escape('<img src="x">'), '&lt;img src=&quot;x&quot;&gt;');
});

// Exercise the real rendering/controller code with a small DOM double. No
// generated expected statistics or network/model calls are needed here.
function harness(fetch) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'report-set' ? 'latest' : '', innerHTML: '', textContent: '',
      handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
    return elements.get(id);
  };
  const context = { document: { getElementById: element }, window: {}, fetch, Blob,
    URL: { createObjectURL: () => 'blob:report', revokeObjectURL() {} }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'test-results.js'), 'utf8'), context);
  return { context, element, flush: () => new Promise(resolve => setImmediate(resolve)) };
}

test('renders latest report, switches to failures, and selects a failing candidate', async () => {
  const h = harness(async url => {
    const location = url.includes('failure_demo') ? 'examples/failure_demo/reports' : 'reports';
    const filename = url.endsWith('correctness_report.json') ? 'correctness_report.json' : 'ui_results.json';
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, location, filename), 'utf8')) };
  });
  h.context.window.testResults.show();
  await h.flush();
  assert.match(h.element('report-content').innerHTML, /Speed by input size/);
  assert.match(h.element('report-content').innerHTML, /Output-change variance/);
  assert.match(h.element('report-content').innerHTML, /Stage ranking &amp; key changes/);
  assert.match(h.element('report-content').innerHTML, /Why this score/);
  h.element('report-set').value = 'failure';
  await h.element('report-set').handlers.change();
  h.element('report-candidate').value = 'stage_2.py';
  h.element('report-candidate').handlers.change();
  assert.match(h.element('report-content').innerHTML, /Intentional failure demonstration/);
  assert.match(h.element('report-content').innerHTML, /Expected output/);
  assert.match(h.element('report-content').innerHTML, /numbers/);
});

test('reports missing files with recovery instructions', async () => {
  const h = harness(async () => ({ ok: false, status: 404 }));
  h.context.window.testResults.show();
  await h.flush();
  assert.match(h.element('report-content').innerHTML, /http.server/);
  assert.match(h.element('report-status').textContent, /Could not load/);
});

test('a slow earlier request cannot replace the newly selected report', async () => {
  let finishFirst;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const h = harness(async url => url.includes('failure_demo')
    ? { ok: true, json: async () => readReport('examples/failure_demo/reports') }
    : first);
  h.context.window.testResults.show();
  h.element('report-set').value = 'failure';
  // New exports avoid optional correctness fetches in this race test.
  const demo = readReport('examples/failure_demo/reports');
  demo.charts.smallest_failing_inputs ??= [];
  h.context.fetch = async url => url.includes('failure_demo') ? { ok: true, json: async () => demo } : first;
  await h.element('report-set').handlers.change();
  finishFirst({ ok: true, json: async () => readReport('reports') });
  await h.flush();
  assert.match(h.element('report-content').innerHTML, /Intentional failure demonstration/);
});
