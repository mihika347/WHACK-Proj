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
  const context = vm.createContext({console, location: {hash: '#pipeline'},
    document: {getElementById: element, querySelector: element, createElement: tag => element(`created-${tag}-${Math.random()}`)},
    window: {addEventListener() {}, scrollTo() {}, setTimeout, testResults: {show() {shown++;}}},
    sessionStorage: storage, localStorage: storage, crypto: {randomUUID: () => 'new-file-id'},
    FileReader: class {}, setTimeout, clearTimeout});
  for (const file of ['demo.js', 'statistics-charts.js', 'test-case-data.js', 'test-cases.js', 'files.js', 'app.js']) {
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
