const testCaseStorageKey = `fastforward:${demoRun.id}:uploaded-test-cases`;
const uploadedTestSuites = readUploadedTestSuites();
const testCategories = {
  speed: { title: 'Speed', icon: 'bars', description: 'Each benchmark measurement is compared with the baseline for its workload' },
  correctness: { title: 'Correctness', icon: 'check', description: 'Shared, targeted, AI-generated, and uploaded cases' },
};

function readUploadedTestSuites() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(testCaseStorageKey));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function renderTestSuites(suites, category) {
  const isSpeed = category === 'speed';
  const showingCode = !byId('test-case-code-close').hidden;
  const codeButton = `<button class="button secondary" id="test-case-show-code" type="button" aria-controls="code-pane" aria-expanded="${showingCode}">
    ${showingCode ? 'Hide code' : 'Show code'}</button>`;
  if (!suites.length) return `<div class="test-suite-heading"><p>No saved cases in this category.</p>${codeButton}</div>`;
  return suites.map((suite, index) => `
    <section class="test-suite">
      <div class="test-suite-heading">
        <h3 class="test-suite-header">
          ${escapeHtml(suite.sources.join(' · '))}
          <span class="badge">${suite.cases.length} ${suite.cases.length === 1 ? 'case' : 'cases'}</span>
        </h3>
        ${index === 0 ? codeButton : ''}
      </div>
      <ul class="test-case-list">${suite.cases.map((test) => `
        <li>
          <strong>${escapeHtml(test.name)}</strong>
          ${test.failedIn ? badge(isSpeed ? 'Slower' : 'Failed', 'rejected') : ''}
          <code class="test-case-input">${escapeHtml(test.input)}</code>
          ${test.failedIn ? `<p>${isSpeed ? 'Slower than baseline in' : 'Failed in'} ${escapeHtml(test.failedIn.join(', '))}</p>` : ''}
          ${test.expected === undefined ? '' : `<p>Expected count <code>${escapeHtml(test.expected)}</code></p>`}
          ${test.reason ? `<p>${escapeHtml(test.reason)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </section>`).join('');
}

function testCategorySuites(category) {
  if (category === 'speed') return testCaseData.speed;
  return [
    ...uploadedTestSuites.map((suite) => ({ ...suite, sources: ['Uploaded', ...suite.sources] })),
    ...testCaseData.correctness,
  ];
}

function testCategoryCount(category) {
  const count = testCategorySuites(category).reduce((total, suite) => total + suite.cases.length, 0);
  return `${count.toLocaleString()} ${count === 1 ? 'case' : 'cases'}`;
}

function testPercentage(share) {
  return share > 0 && share < 0.01 ? '&lt;0.01%' : `${Number(share.toFixed(2))}%`;
}

function testCategoryOutcomeLabel(category) {
  const { passed, failed } = testCaseData.outcomes[category];
  const label = category === 'speed' ? 'of measurements slower' : 'failed';
  return failed ? ` <span class="test-failure-rate">(${testPercentage(100 * failed / (passed + failed))} ${label})</span>` : '';
}

function failuresFirst(suites, category) {
  const failures = [];
  const remaining = [];
  for (const suite of suites) {
    const cases = [];
    for (const test of suite.cases) {
      if (test.failedIn) failures.push(test);
      else cases.push(test);
    }
    if (cases.length) remaining.push({ ...suite, cases });
  }
  if (failures.length) {
    const heading = category === 'speed' ? 'Slower than baseline' : 'Failed cases';
    remaining.unshift({ sources: [heading], cases: failures });
  }
  return remaining;
}

function testCasesView() {
  const { passed, failed } = testCaseData.outcomes.correctness;
  const total = passed + failed;
  const passShare = total ? 100 * passed / total : 0;
  const failShare = total ? 100 * failed / total : 0;
  const percent = (share) => total ? testPercentage(share) : '—';
  return `<div class="test-page-header">
      <div class="inset">
        ${detailHeader('tests', 'Test Cases', 'Browse the saved test cases.')}
      </div>
      <section class="inset test-upload-box" aria-labelledby="test-upload-title">
        <h2 id="test-upload-title">Upload your own test cases</h2>
        <button class="button primary" id="test-case-upload" type="button">
          ${icon('upload')} Upload test cases
        </button>
        <input id="test-case-file" type="file" accept=".json,application/json" hidden>
        <p id="test-case-upload-status" role="status"></p>
      </section>
    </div>
    <section class="inset test-outcomes" id="test-case-overview" aria-labelledby="correctness-outcomes-title">
      <h2 id="correctness-outcomes-title">Correctness check results</h2>
      <div class="test-outcome-pair">
        <div class="test-outcome passed"><span>Passed</span><strong>${percent(passShare)}</strong><small>${passed.toLocaleString()} checks</small></div>
        <div class="test-outcome failed"><span>Failed</span><strong>${percent(failShare)}</strong><small>${failed.toLocaleString()} checks</small></div>
      </div>
      <div class="test-outcome-bar" aria-hidden="true">
        <span class="passed-bar" style="width:${passShare}%"></span><span class="failed-bar" style="width:${failShare}%"></span>
      </div>
      <p>${total.toLocaleString()} completed correctness checks</p>
    </section>
    <button class="button secondary test-category-back" id="test-category-back" type="button" hidden>← Back to categories</button>
    <div class="test-categories" id="test-categories" role="group" aria-label="Test case categories">
      ${Object.entries(testCategories).map(([key, category]) => `
        <button class="test-category-button" type="button" data-test-category="${key}" aria-expanded="false" aria-controls="test-category-results">
          <span class="test-category-icon">${icon(category.icon)}</span>
          <span><strong>${category.title}</strong>${testCategoryOutcomeLabel(key)}<small>${category.description}</small></span>
          <span class="badge">${testCategoryCount(key)}</span>
        </button>`).join('')}
    </div>
    <section class="test-category-scroll" id="test-category-results" tabindex="0" aria-label="Test cases" hidden></section>`;
}

function showTestCategory(category) {
  const buttons = [...byId('test-categories').querySelectorAll('button[data-test-category]')];
  const previous = buttons.find((button) => button.getAttribute('aria-expanded') === 'true');
  const selected = buttons.find((button) => button.dataset.testCategory === category);
  const start = selected?.getBoundingClientRect();
  for (const button of buttons) {
    button.hidden = Boolean(selected && button !== selected);
    button.setAttribute('aria-expanded', String(button === selected));
  }
  byId('test-case-overview').hidden = Boolean(selected);
  byId('test-category-back').hidden = !selected;
  const results = byId('test-category-results');
  results.hidden = !selected;
  if (!selected) {
    setTestCaseCodeVisible(false);
    results.replaceChildren();
    previous?.focus();
    return;
  }

  results.setAttribute('aria-label', `${testCategories[category].title} test cases`);
  const suites = failuresFirst(testCategorySuites(category), category);
  results.innerHTML = renderTestSuites(suites, category);
  results.scrollTop = 0;
  selected.scrollIntoView({ block: 'nearest' });
  const end = selected.getBoundingClientRect();
  if (start.width && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    selected.animate([
      { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px) scaleX(${start.width / end.width})` },
      { transform: 'none' },
    ], { duration: 260, easing: 'ease-out' });
  }
  selected.focus({ preventScroll: true });
}

function setTestCaseCodeVisible(visible) {
  setSplitLayout(visible ? 'split' : 'details-only');
  if (visible) renderCode({ stage: 'original' });
}

function handleTestCaseClick(event) {
  if (event.target.closest('#test-case-upload')) {
    byId('test-case-file').click();
    return true;
  }
  if (event.target.closest('#test-category-back')) {
    showTestCategory();
    return true;
  }
  const codeButton = event.target.closest('#test-case-show-code');
  if (codeButton) {
    const opening = codeButton.getAttribute('aria-expanded') !== 'true';
    setTestCaseCodeVisible(opening);
    if (opening) byId('test-case-code-close').focus();
    return true;
  }
  const button = event.target.closest('button[data-test-category]');
  if (!button) return false;
  showTestCategory(button.getAttribute('aria-expanded') === 'true' ? undefined : button.dataset.testCategory);
  return true;
}

function parseTestCases(text) {
  let data;
  try {
    data = JSON.parse(text, (_key, value, context) => {
      // Recover integer literals before the browser rounds them to a double.
      if (typeof value !== 'number' || !context?.source) return value;
      return /^-?\d+$/.test(context.source) ? BigInt(context.source) : NaN;
    });
  } catch {
    throw new Error('Choose a file with valid JSON.');
  }
  const cases = Array.isArray(data) ? data : data?.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('Include at least one case in a JSON list or a "cases" array.');
  }
  const isInteger = (value) => typeof value === 'bigint' || Number.isSafeInteger(value);
  return cases.map((test, index) => {
    const label = `Case ${index + 1}`;
    if (!Array.isArray(test?.numbers) || !test.numbers.every(isInteger) || !isInteger(test.target)) {
      throw new Error(`${label} needs an integer list named "numbers" and an integer "target".`);
    }
    if (test.expected !== undefined && !isInteger(test.expected)) {
      throw new Error(`${label} needs an integer "expected" count when provided.`);
    }
    return {
      name: typeof test.name === 'string' && test.name.trim() ? test.name.trim() : label,
      input: `count_matches([${test.numbers.join(', ')}], ${test.target})`,
      reason: typeof test.reason === 'string' ? test.reason.trim() : '',
      expected: test.expected === undefined ? undefined : String(test.expected),
    };
  });
}

async function uploadTestCases(event) {
  const input = event.target;
  if (input.id !== 'test-case-file' || !input.files.length) return;
  const file = input.files[0];
  input.value = '';
  let message;
  let error = false;
  try {
    const cases = parseTestCases(await file.text());
    uploadedTestSuites.push({ sources: [file.name], cases });
    message = `Added ${cases.length} test ${cases.length === 1 ? 'case' : 'cases'}.`;
    try {
      sessionStorage.setItem(testCaseStorageKey, JSON.stringify(uploadedTestSuites));
    } catch {
      message += ' This upload is available until reload.';
    }
    const count = byId('test-categories')?.querySelector('[data-test-category="correctness"] .badge');
    if (count) {
      count.textContent = testCategoryCount('correctness');
      showTestCategory('correctness');
    }
  } catch (failure) {
    message = failure.message;
    error = true;
  }
  const status = byId('test-case-upload-status');
  if (status) {
    status.textContent = message;
    status.classList.toggle('removed-text', error);
  }
}
