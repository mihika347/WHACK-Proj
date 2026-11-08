const savedRunFiles = location.protocol === 'file:' ? [] : [
  { id: 'saved:latest', name: 'Saved optimisation run', savedRun: 'latest' },
  { id: 'saved:failure-demo', name: 'Saved failure demo', savedRun: 'failure-demo' },
];
const savedRuns = new Map();
const savedReviews = new Map();
const sourceSubmissions = new WeakMap();
const minimumTimeReduction = 5;
const runProgress = {
  generating: 'Generating optimisation proposals…',
  correctness: 'Running correctness checks…',
  benchmarking: 'Benchmarking the candidates…',
};

function savedValue({ stats, patches, recommended: eligible }) {
  const { correctness_status: correctness, speed_status: speed, execution_time_reduction_percent: reduction } = stats;
  if (correctness !== 'pass') {
    const reason = { fail: 'A correctness check failed.', error: 'Correctness evaluation ended with an error.' };
    return { reason: reason[correctness] ?? 'Correctness checks are incomplete.' };
  }
  if (speed !== 'pass') {
    return { reason: savedAssessment('performance', { stats }).reason };
  }
  if (!Number.isFinite(reduction)) return { reason: 'No execution-time reduction was measured.' };
  if (!patches.length) return { reason: 'The source is identical to the original.' };
  const recommended = eligible ?? reduction >= minimumTimeReduction;
  const measured = reduction < 0 ? `${Math.abs(reduction).toFixed(2)}% longer execution time`
    : `${reduction.toFixed(2)}% lower execution time`;
  return { recommended, reason: recommended
    ? `Passed correctness checks and measured ${measured}.`
    : `Measured ${measured}. The minimum reduction is ${minimumTimeReduction}%.` };
}

function savedCandidateKey(candidate) {
  return `${candidate.id}:${candidate.stats.source_sha256}`;
}

function savedReview(run) {
  if (!savedReviews.has(run.id)) {
    const key = `fastforward:${run.id}:decisions`;
    const eligible = run.candidates.filter((candidate) => savedValue(candidate).recommended);
    savedReviews.set(run.id, { key, eligible, decisions: readDecisions(key, eligible, savedCandidateKey) });
  }
  return savedReviews.get(run.id);
}

function activeSavedRun() {
  return savedRuns.get(activeProjectFile()?.savedRun)?.run;
}

function loadSavedRun(file) {
  const key = file.savedRun;
  if (savedRuns.has(key)) return;
  const state = {};
  savedRuns.set(key, state);
  refreshSavedRun(file, state);
}

async function refreshSavedRun(file, state) {
  const key = file.savedRun;
  const live = key.startsWith('live:');
  const previous = state.status;
  try {
    const response = await fetch(live ? `/api/runs/${key.slice(5)}` : `/api/saved-runs/${key}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the saved run.');
    if (live) {
      state.status = result.status;
      state.run = result.run;
      state.error = result.error;
      if (Object.hasOwn(runProgress, state.status)) setTimeout(() => refreshSavedRun(file, state), 1000);
    } else {
      state.run = result;
    }
  } catch {
    state.error = 'Could not load the run. Check that the local FastForward server is running.';
  }
  if (activeProjectFile() === file && (state.run || state.error || previous !== state.status)) {
    render(Boolean(state.run));
  }
}

function savedRunStatus(file) {
  const state = savedRuns.get(file.savedRun);
  if (!state?.error) return `<p role="status">${runProgress[state?.status] ?? 'Loading run…'}</p>`;
  return `<p role="status">${escapeHtml(state.error)}</p>
    ${state.status === 'failed' ? '<p>Select the source file to start a new run.</p>' :
    '<button type="button" class="button secondary" data-retry-saved-run>Retry</button>'}`;
}

function runSourceControl(file) {
  if (location.protocol === 'file:') return '<p>Open FastForward through its local server to run an optimisation.</p>';
  if (!file.name.toLowerCase().endsWith('.py')) return '<p>Select a Python (.py) file to run an optimisation.</p>';
  const state = sourceSubmissions.get(file);
  return `<section class="inset selection"><h2>Run optimisation</h2>
    <p>Use trusted Python source with a <code>count_matches(numbers, target)</code> function and a model loaded in LM Studio.</p>
    <div class="actions"><button type="button" class="button primary" data-start-run ${state?.pending ? 'disabled' : ''}>Run optimisation</button></div>
    ${state?.error ? `<p role="status">${escapeHtml(state.error)}</p>` : state?.pending ? '<p role="status">Starting run…</p>' : ''}
    </section>`;
}

async function startSourceRun(file) {
  if (sourceSubmissions.get(file)?.pending) return;
  const state = { pending: true };
  sourceSubmissions.set(file, state);
  render();
  try {
    const job = await requestRun('/api/runs', {
      filename: file.name,
      source: file.content,
      uploads: (file.testSuites ?? []).map((suite) => suite.text ?? JSON.stringify(suite.cases)),
    });
    sourceSubmissions.delete(file);
    addProjectRun(job, file);
  } catch (error) {
    state.pending = false;
    state.error = error.message;
    if (activeProjectFile() === file) render();
  }
}

async function requestRun(path, data) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const job = await response.json().catch(() => null);
  if (!response.ok || !job?.id) {
    const error = new Error(job?.error || 'Could not start. Check that the current FastForward server is running.');
    error.conflicts = job?.conflicts;
    throw error;
  }
  return job;
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-start-run]')) {
    startSourceRun(activeProjectFile());
    return;
  }
  if (!event.target.closest('[data-retry-saved-run]')) return;
  const file = activeProjectFile();
  savedRuns.delete(file.savedRun);
  loadSavedRun(file);
  render(true);
});

function savedRunSummary(file, run) {
  if (!run) return `<h2>${escapeHtml(file.name)}</h2>${savedRunStatus(file)}`;
  const { eligible } = savedReview(run);
  return `<p class="eyebrow saved-run-id">Run ${escapeHtml(run.id)}</p>
    <h2>${escapeHtml(file.name)}</h2><p>${escapeHtml(run.filename)}</p>
    <dl class="run-counts"><div><dt>Changes</dt><dd>${run.candidates.length}</dd></div>
      <div><dt>Recommended</dt><dd>${eligible.length}</dd></div>
      <div><dt>Filtered</dt><dd>${run.candidates.length - eligible.length}</dd></div></dl>`;
}

function savedStageSummary(stage, run) {
  if (!run) return 'Saved evaluation';
  switch (stage) {
    case 'original': return run.filename;
    case 'generated': return `${run.candidates.length} saved changes`;
    case 'correctness': return 'Measured correctness checks';
    case 'performance': return 'Benchmarks by workload and input size';
    case 'value': return `${savedReview(run).eligible.length} recommended`;
    case 'human': {
      const { eligible, decisions } = savedReview(run);
      return `${decisions.size} of ${eligible.length} decided`;
    }
    case 'final': return savedBuildLabel(savedBuildState(run)) ?? 'Build from approved changes';
    default: return 'Saved evaluation';
  }
}

function savedAssessment(stage, { stats, description }) {
  if (stage === 'generated') return { label: 'Saved change', reason: description };
  if (stage === 'correctness') {
    const labels = { pass: 'Passed', fail: 'Failed', error: 'Evaluation error' };
    const { correctness_status: status, passed_cases: passed, failed_cases: failed } = stats;
    return {
      label: labels[status] ?? 'Not run',
      tone: status === 'pass' ? 'success' : 'warning',
      reason: passed == null ? 'No completed correctness checks.' : `${passed} passed · ${failed} failed`,
    };
  }
  const measured = stats.speed_status === 'pass';
  return {
    label: measured ? 'Measured' : 'Not measured',
    tone: measured ? 'success' : '',
    reason: measured ? `${stats.median_speedup.toFixed(2)}× median speedup` : {
      skipped: 'Benchmarking skipped because a correctness check did not pass.',
      error: 'The benchmark encountered an error.',
    }[stats.speed_status] ?? 'No benchmarks were run for this change.',
  };
}

function savedApprovalQueue(run) {
  const { eligible, decisions } = savedReview(run);
  const approved = [...decisions.values()].filter((value) => value === 'approved').length;
  return `${detailHeader('human', 'Approval queue', 'Select a recommended change to review its evidence or update your decision.')}
    <dl class="run-counts queue-counts">
      <div><dt>Approved</dt><dd>${approved}</dd></div>
      <div><dt>Rejected</dt><dd>${decisions.size - approved}</dd></div>
      <div><dt>Pending</dt><dd>${eligible.length - decisions.size}</dd></div>
    </dl>
    ${eligible.length ? `<ul class="candidate-list">${eligible.map((candidate) => {
      const decision = decisions.get(savedCandidateKey(candidate)) ?? 'pending';
      return `<li><a class="candidate-row inset" href="${route('value', candidate, 'review')}">
        <div><strong>${escapeHtml(candidate.title)}</strong><p>View diff and evidence</p></div>
        ${badge(verdicts[decision], decision)}
      </a></li>`;
    }).join('')}</ul>` : '<p>No changes met the recommendation criteria for this run.</p>'}
    <div class="actions">${savedBuildButton(run)}<a class="button secondary" href="${route('value')}">See value assessment</a></div>`;
}

function savedCandidateAssessment(stage, candidate) {
  if (stage !== 'value') return savedAssessment(stage, candidate);
  const { recommended, reason } = savedValue(candidate);
  return { label: recommended ? 'Recommended' : 'Filtered', tone: recommended ? 'success' : 'warning', reason };
}

function savedCorrectness(candidate) {
  const { stats, failure } = candidate;
  const coverage = { used: 'AI-generated cases included', disabled: 'AI test generation disabled', error: 'AI test generation failed' };
  const assessment = savedAssessment('correctness', candidate);
  return `<section class="inset"><h2>Correctness check results</h2>
      <p>${assessment.reason}${stats.pass_rate_percent == null ? '' : ` · ${testPercentage(stats.pass_rate_percent)} passed`}</p>
      ${coverage[stats.agent_status] ? `<p>${coverage[stats.agent_status]}</p>` : ''}
      ${candidate.expectedMismatches ? `<p>${candidate.expectedMismatches} uploaded expectations differed from the original.</p>` : ''}
    </section>
    ${failure ? `<section class="inset"><h2>Smallest failing input</h2>
      <p>${failure.reduced ? 'Reduced counterexample' : 'Shortest observed counterexample'}</p>
      <code class="test-case-input">${escapeHtml(failure.case.input)}</code>
      <table class="timing-table saved-evidence-table"><thead><tr><th scope="col">Mismatch</th><th scope="col">Original</th><th scope="col">Candidate</th></tr></thead>
        <tbody>${failure.differences.map(({ field, expected, actual }) => `<tr><th scope="row">${escapeHtml(field)}</th>
          <td>${escapeHtml(expected)}</td><td>${escapeHtml(actual)}</td></tr>`).join('')}</tbody></table>
    </section>` : ''}`;
}

function savedPerformance(candidate) {
  const { stats, workloads, sizes, slowdown } = candidate;
  if (stats.speed_status !== 'pass') {
    return `<section class="inset"><h2>Not measured</h2><p>${savedAssessment('performance', candidate).reason}</p></section>`;
  }
  const signedPercent = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  const micros = (value) => `${value.toFixed(2)} µs`;
  return `<section class="inset"><h2>Measured performance</h2>
      <dl class="run-counts saved-performance-stats">
        <div><dt>Median speedup</dt><dd>${stats.median_speedup.toFixed(2)}×</dd></div>
        <div><dt>Execution time reduction</dt><dd>${signedPercent(stats.execution_time_reduction_percent)}</dd></div>
      </dl><p>Summary uses the median of the workload speedup ratios.</p>
    </section>
    <section class="inset"><h2>Speed by input size</h2>
      <table class="timing-table"><thead><tr><th scope="col">Input values</th><th scope="col">Workloads</th><th scope="col">Median speedup</th></tr></thead>
        <tbody>${sizes.map((row) => `<tr><th scope="row">${row.input_size.toLocaleString()}</th><td>${row.workload_count}</td>
          <td>${row.median_speedup.toFixed(2)}×</td></tr>`).join('')}</tbody></table>
    </section>
    <section class="inset"><h2>Worst observed slowdown</h2>
      ${slowdown ? `<p>${signedPercent(slowdown.slowdown_percent)} runtime on ${escapeHtml(slowdown.input.name)}</p>
        <code class="test-case-input">${escapeHtml(slowdown.input.input)}</code>` : '<p>No measured workload was slower than the original.</p>'}
    </section>
    <section class="inset"><h2>Median runtime by workload</h2>
      <table class="timing-table saved-evidence-table"><thead><tr><th scope="col">Workload</th><th scope="col">Original</th><th scope="col">Candidate</th></tr></thead>
        <tbody>${workloads.map((row) => `<tr><th scope="row">${escapeHtml(row.workload)}</th>
          <td>${micros(row.baseline_median_us)}</td><td>${micros(row.median_us)}</td></tr>`).join('')}</tbody></table>
    </section>`;
}

function savedRunView(file, run, { stage, view, candidate }) {
  if (!run) return `${detailHeader(stage, escapeHtml(file.name), '')}${savedRunStatus(file)}`;
  if (stage === 'tests') return testCasesView();
  if (stage === 'original') {
    return `${detailHeader(stage, 'Baseline source', 'Every saved change was evaluated against this original source.')}
      <section class="inset"><h2>${escapeHtml(run.filename)}</h2><p class="saved-run-id">Run ${escapeHtml(run.id)}</p></section>
      <div class="actions"><a class="button primary" href="${route('generated')}">See saved changes</a></div>`;
  }
  if (stage === 'human') return savedApprovalQueue(run);
  if (stage === 'final') return savedFinalView(run);
  const isValue = stage === 'value';
  const rule = `Changes must pass correctness checks and reduce measured execution time by at least ${minimumTimeReduction}%.`;
  if (view === 'review' && candidate) {
    const result = savedCandidateAssessment(stage, candidate);
    const showCorrectness = stage === 'correctness' || isValue;
    const showPerformance = stage === 'performance' || isValue;
    const decision = savedReview(run).decisions.get(savedCandidateKey(candidate));
    return `${detailHeader(stage, escapeHtml(candidate.title), escapeHtml(candidate.description), badge(result.label, result.tone))}
      ${isValue ? `<section class="inset"><h2>Why this change was ${result.label.toLowerCase()}</h2><p>${escapeHtml(result.reason)}</p><p>${rule}</p></section>` : ''}
      ${isValue && result.label === 'Recommended' ? `<div class="actions">${decisionButtons(decision)}</div>` : ''}
      ${showCorrectness ? savedCorrectness(candidate) : ''}
      ${showPerformance ? savedPerformance(candidate) : ''}
      <div class="actions"><a class="button secondary" href="${route(stage, candidate, 'results')}">See stage results</a></div>`;
  }
  const title = { generated: 'Saved changes', correctness: 'Correctness check results', performance: 'Performance results', value: 'Value assessment results' }[stage];
  return `${detailHeader(stage, title, isValue ? rule : 'Choose a change to inspect its diff and evidence.')}
    ${run.candidates.length ? '' : '<p>No optimisation changes were proposed for this run.</p>'}
    <ul class="candidate-list">${run.candidates.map((item) => {
      const result = savedCandidateAssessment(stage, item);
      return `<li><a class="candidate-row inset" href="${route(stage, item, 'review')}">
        <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(result.reason)}</p></div>
        <div class="row-meta">${badge(result.label, result.tone)}${item === candidate ? '<small>Diff shown</small>' : ''}</div>
      </a></li>`;
    }).join('')}</ul>`;
}
