const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function appHarness() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: '', textContent: '', value: '', hidden: false, children: [], dataset: {},
      scrollWidth: 0, clientWidth: 1000, scrollLeft: 0, style: {setProperty() {}},
      classList: {add() {}, remove() {}, toggle() {}},
      attrs: {'aria-valuemin': '30', 'aria-valuemax': '65', 'aria-valuenow': '48'},
      addEventListener() {}, replaceChildren(...nodes) {this.children = nodes;}, append(...nodes) {this.children.push(...nodes);},
      setAttribute(key, value) {this.attrs[key] = value;}, getAttribute(key) {return this.attrs[key];},
      querySelector() {return null;}, querySelectorAll() {return [];}, focus() {},
      getClientRects() {return [1];}, getBoundingClientRect() {return {left: 0, width: 1000};},
    });
    return elements.get(id);
  }
  let shown = 0;
  const storage = {getItem() {return null;}, setItem() {}};
  const context = vm.createContext({console, location: {hash: '#pipeline', protocol: 'file:'},
    document: {addEventListener() {}, getElementById: element, querySelector: element, createElement: tag => element(`created-${tag}-${Math.random()}`)},
    window: {addEventListener() {}, scrollTo() {}, setTimeout, testResults: {show() {shown++;}}},
    sessionStorage: storage, localStorage: storage, crypto: {randomUUID: () => 'new-file-id'},
    FileReader: class {}, setTimeout, clearTimeout});
  for (const file of ['demo.js', 'statistics-charts.js', 'review-planner.js', 'test-case-data.js', 'test-cases.js', 'saved-runs.js', 'final-builds.js', 'files.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, {filename: file});
  }
  const navigate = hash => {context.location.hash = hash; vm.runInContext('render(true)', context);};
  return {context, element, navigate, shown: () => shown};
}

test('measured dashboard and deep-dive test cases keep separate routes', () => {
  const h = appHarness();
  h.navigate('#tests');
  assert.equal(h.element('measured-results').hidden, false);
  assert.equal(h.element('workspace').hidden, true);
  assert.equal(h.shown(), 1);
  h.navigate('#deep-dive/tests/tests/list-count');
  assert.equal(h.element('measured-results').hidden, true);
  assert.equal(h.element('workspace').hidden, false);
  assert.match(h.element('details-content').innerHTML, /Test cases/i);
  assert.equal(h.element('workspace-split').dataset.layout, 'details-only');
});

test('custom source editor and saved reports both remain accessible', () => {
  const h = appHarness();
  vm.runInContext("addProjectFile('custom.py', 'print(42)')", h.context);
  h.navigate('#original/overview/list-count');
  assert.equal(h.element('file-editor').hidden, false);
  assert.equal(h.element('file-editor').value, 'print(42)');
  h.navigate('#deep-dive/tests/tests/list-count');
  assert.match(h.element('details-content').innerHTML, /Upload test cases/);
  h.navigate('#tests');
  assert.equal(h.element('measured-results').hidden, false);
  assert.equal(h.element('workspace').hidden, true);
});

test('final summary and deep-dive navigation survive the merge', () => {
  const h = appHarness();
  assert.match(h.element('deep-dive-cards').innerHTML, /deep-dive\/tests/);
  vm.runInContext("saveDecision(recommended[0], 'approved'); finalBuild = {status:'verified',selected:[recommended[0]],applied:[recommended[0]],timing:demoRun.finalTimings['list-count']}", h.context);
  h.navigate('#final/final/list-count');
  assert.equal(h.element('final-improvement').hidden, false);
  assert.ok(h.element('final-improvement').innerHTML.length > 0);
});

test('only verified and approved changes enter the generated source', async () => {
  const h = appHarness();
  vm.runInContext("saveDecision(recommended[1], 'approved'); verifyChange(recommended[0], true); saveDecision(recommended[0], 'approved'); verifyChange(recommended[2], true); generateBuild()", h.context);
  h.navigate('#final/final/list-count');
  assert.match(h.element('diff-toolbar').textContent, /Building final code/);
  await new Promise(resolve => setTimeout(resolve, 950));
  const code = vm.runInContext('finalBuild.code', h.context);
  assert.equal(code, 'def count_matches(numbers, target):\n    return numbers.count(target)\n');
  assert.match(h.element('details-content').innerHTML, /Download Python file/);
  vm.runInContext('verifyChange(recommended[0], false)', h.context);
  assert.equal(vm.runInContext('finalBuild', h.context), undefined);
  assert.equal(vm.runInContext('approvedCandidates().length', h.context), 0);
});

test('compatible boundary edits combine while overlapping approvals are blocked', async () => {
  const h = appHarness();
  vm.runInContext("for (const i of [0, 2]) { verifyChange(recommended[i], true); saveDecision(recommended[i], 'approved'); } generateBuild()", h.context);
  h.navigate('#final/final/list-count');
  await new Promise(resolve => setTimeout(resolve, 950));
  assert.match(vm.runInContext('finalBuild.code', h.context), /if not numbers:\n        return 0\n    return numbers.count/);
  vm.runInContext("verifyChange(recommended[1], true); decisions.set(recommended[1].id, 'approved'); generateBuild()", h.context);
  await new Promise(resolve => setTimeout(resolve, 950));
  assert.equal(vm.runInContext('finalBuild.status', h.context), 'failed');
  assert.equal(vm.runInContext('finalBuild.code', h.context), undefined);
});

test('live build selection requires verification and approval for the same source hash', () => {
  const h = appHarness();
  vm.runInContext(`
    globalThis.liveRun = { id: 'live-test', candidates: [
      {id: 'stage_1.py', patches: [{start:2,remove:1,lines:['    return numbers.count(target)']}],
       stats: {source_sha256:'hash-a',correctness_status:'pass',speed_status:'pass',execution_time_reduction_percent:20}},
      {id: 'stage_2.py', patches: [{start:2,remove:0,lines:['    # unapproved']}],
       stats: {source_sha256:'hash-b',correctness_status:'pass',speed_status:'pass',execution_time_reduction_percent:10}}
    ]};
    savedReview(liveRun).decisions.set('stage_1.py:hash-a', 'approved');
  `, h.context);
  assert.equal(vm.runInContext('savedApproved(liveRun).length', h.context), 0);
  vm.runInContext("verifySavedChange(liveRun, 'stage_1.py', true)", h.context);
  assert.equal(vm.runInContext('savedApproved(liveRun).length', h.context), 1);
  vm.runInContext("verifySavedChange(liveRun, 'stage_1.py', false)", h.context);
  assert.equal(vm.runInContext('savedApproved(liveRun).length', h.context), 0);
});

test('approval queue explains conflicts before generation', () => {
  const h = appHarness();
  vm.runInContext("for (const i of [0,1]) { verifyChange(recommended[i], true); decisions.set(recommended[i].id, 'approved'); }", h.context);
  h.navigate('#human/approve/list-count');
  const html = h.element('details-content').innerHTML;
  assert.match(html, /Approved edits overlap/);
  assert.match(html, /Top-scoring combination/);
  assert.match(html, /id="generate-build" disabled/);
});

test('approving an alternative replaces the old approval and labels conflicts', () => {
  const h = appHarness();
  vm.runInContext("verifyChange(recommended[0], true); saveDecision(recommended[0], 'approved')", h.context);
  h.navigate('#human/approve/list-count');
  assert.match(h.element('details-content').innerHTML, /Conflicting/);
  assert.doesNotMatch(h.element('details-content').innerHTML, /Conflicts in the original source/);
  vm.runInContext("verifyChange(recommended[1], true); saveDecision(recommended[1], 'approved')", h.context);
  assert.equal(vm.runInContext('approvedCandidates().length', h.context), 1);
  assert.equal(vm.runInContext('approvedCandidates()[0].id', h.context), 'collect-matches');
  assert.equal(vm.runInContext("reviewStatus(recommended[0], approvedCandidates(), 'pending')", h.context), 'conflicting');
  vm.runInContext("saveDecision(recommended[1], 'rejected')", h.context);
  assert.equal(vm.runInContext("reviewStatus(recommended[0], approvedCandidates(), 'pending')", h.context), 'pending');
});

test('sidebar shows pipeline stages and deep dive with the active stage highlighted', () => {
  const h = appHarness();
  h.navigate('#value/results/list-count');
  const html = h.element('navigation').innerHTML;
  for (const label of ['Optimisation pipeline', 'Original Code', 'Value Assessment', 'Human Review', 'Final Code', 'Deep Dive', 'Test Cases', 'AI Generated Changes', 'Correctness Check', 'Evaluation']) assert.ok(html.includes(label));
  assert.match(html, /href="#value\/results\/list-count" aria-current="page"/);
  assert.doesNotMatch(html, /<span>(Pipeline|Test results|Results|Review|Approve|Final)<\/span>/);
  h.navigate('#deep-dive/performance/review/list-count');
  assert.match(h.element('navigation').innerHTML, /href="#deep-dive\/performance\/review\/list-count" aria-current="page"/);
});
