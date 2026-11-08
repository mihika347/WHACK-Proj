const testCaseStorageKey = `fastforward:${demoRun.id}:uploaded-test-cases`;
const uploadedTestSuites = readUploadedTestSuites();
const agentTestCount = agentTestCases.reduce((total, suite) => total + suite.cases.length, 0);

function readUploadedTestSuites() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(testCaseStorageKey));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function renderTestSuites(suites, openIndex) {
  return suites.map((suite, index) => `
    <details class="test-suite" ${index === openIndex ? 'open' : ''}>
      <summary>
        <strong>${escapeHtml(suite.sources.join(' · '))}</strong>
        <span class="badge">${suite.cases.length} ${suite.cases.length === 1 ? 'case' : 'cases'}</span>
      </summary>
      <ul class="test-case-list">${suite.cases.map((test) => `
        <li>
          <strong>${escapeHtml(test.name)}</strong>
          <code class="test-case-input">${escapeHtml(test.input)}</code>
          ${test.expected === undefined ? '' : `<p>Expected count <code>${escapeHtml(test.expected)}</code></p>`}
          ${test.reason ? `<p>${escapeHtml(test.reason)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </details>`).join('');
}

function renderUploadedTestSuites() {
  return uploadedTestSuites.length
    ? renderTestSuites(uploadedTestSuites, uploadedTestSuites.length - 1)
    : '<p>No uploaded cases yet.</p>';
}

function testCasesView() {
  return `${detailHeader('tests', 'Test cases', 'Review inputs for count_matches and add your own cases.')}
    <section class="inset test-case-section">
      <h2>Your test cases</h2>
      <label class="test-upload-label" for="test-case-file">Upload test cases</label>
      <input class="test-case-file" id="test-case-file" type="file" accept=".json,application/json" aria-describedby="test-case-format">
      <p id="test-case-format">Choose a JSON file with a list of cases. Each case needs an integer list named <code>numbers</code> and an integer <code>target</code>.</p>
      <p id="test-case-upload-status" role="status"></p>
      <div class="test-suite-list" id="uploaded-test-cases">${renderUploadedTestSuites()}</div>
    </section>
    <section class="inset test-case-section">
      <h2>AI-generated test cases</h2>
      <p>${agentTestCount} cases from the saved correctness run, grouped by source.</p>
      <div class="test-suite-list">${agentTestCases.length
        ? renderTestSuites(agentTestCases, 0)
        : '<p>No AI-generated cases are available in the saved run.</p>'}</div>
    </section>
    <div class="actions"><a class="button primary" href="${route('generated')}">See proposed changes</a></div>`;
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
    const list = byId('uploaded-test-cases');
    if (list) list.innerHTML = renderUploadedTestSuites();
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
