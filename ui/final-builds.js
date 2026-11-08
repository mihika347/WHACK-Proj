const savedBuilds = new Map();
const buildProgress = {
  starting: 'Combining approved changes…',
  correctness: 'Checking the combined code…',
  benchmarking: 'Benchmarking the combined code…',
};

function savedApproved(run) {
  const { eligible, decisions } = savedReview(run);
  return eligible.filter((candidate) => decisions.get(savedCandidateKey(candidate)) === 'approved' && savedReview(run).verified.has(savedCandidateKey(candidate)));
}

function savedBuildKey(runId, selection) {
  return `fastforward:${runId}:build:${[...selection].sort().join(',')}`;
}

function savedBuildState(run) {
  if (!run) return undefined;
  const selected = savedApproved(run);
  if (!selected.length) return undefined;
  const key = savedBuildKey(run.id, selected.map(savedCandidateKey));
  if (!savedBuilds.has(key)) {
    let id;
    try {
      id = sessionStorage.getItem(key);
    } catch { /* Builds are still available in memory. */ }
    const state = id ? { id, status: 'starting' } : undefined;
    savedBuilds.set(key, state);
    if (state) refreshSavedBuild(run, key, state);
  }
  return savedBuilds.get(key);
}

function updateSavedBuildView(run, key, state) {
  if (activeSavedRun() !== run || savedBuildKey(run.id, savedApproved(run).map(savedCandidateKey)) !== key) return;
  const { view } = readRoute();
  if (view === 'final' || view === 'approve') render();
  else byId('final-stage-summary').textContent = savedBuildLabel(state);
}

async function refreshSavedBuild(run, key, state) {
  const previous = state.status;
  try {
    const response = await fetch(`/api/runs/${state.id}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Could not load the build.');
    if (job.kind !== 'build' || savedBuildKey(job.parent_run_id, job.selection ?? []) !== key) {
      throw new Error('This build does not match the approved changes.');
    }
    state.status = job.status;
    state.error = job.error;
    state.result = job.build;
    if (Object.hasOwn(buildProgress, state.status)) {
      setTimeout(() => refreshSavedBuild(run, key, state), 1000);
    }
  } catch (error) {
    state.status = 'failed';
    state.error = error.message;
  }
  if (previous !== state.status) updateSavedBuildView(run, key, state);
}

async function startSavedBuild(run) {
  const selected = savedApproved(run);
  if (!selected.length || buildProgress[savedBuildState(run)?.status]) return;
  const selection = selected.map(savedCandidateKey);
  const key = savedBuildKey(run.id, selection);
  const state = { status: 'starting' };
  savedBuilds.set(key, state);
  const destination = route('final');
  if (location.hash !== destination) location.hash = destination;
  else render();
  try {
    const job = await requestRun('/api/runs/build', {
      parent: activeProjectFile().savedRun, run_id: run.id, selection,
    });
    state.id = job.id;
    try {
      sessionStorage.setItem(key, job.id);
    } catch { /* Builds are still available in memory. */ }
    refreshSavedBuild(run, key, state);
  } catch (error) {
    state.status = 'failed';
    state.error = error.message;
    state.conflicts = error.conflicts;
    updateSavedBuildView(run, key, state);
  }
}

function savedBuildLabel(state) {
  if (!state) return undefined;
  if (state.conflicts) return 'Patch conflict';
  if (state.status === 'failed') return 'Build failed';
  if (state.result) return state.result.verified ? 'Verified' : 'Verification failed';
  return 'Verification pending';
}

function savedBuildButton(run) {
  const pending = buildProgress[savedBuildState(run)?.status];
  const enabled = savedApproved(run).length && !pending && !approvedEditsConflict(savedApproved(run));
  return `<button id="generate-build" type="button" class="button primary" ${enabled ? '' : 'disabled'}>
    ${pending ? 'Building…' : 'Generate optimised code'}</button>`;
}

function savedFinalView(run) {
  const selected = savedApproved(run);
  const state = savedBuildState(run);
  const result = state?.result;
  const label = savedBuildLabel(state);
  const conflicts = selected.filter((candidate) => state?.conflicts?.includes(candidate.id));
  return `${detailHeader('final', 'Final Code', buildProgress[state?.status] ??
    (selected.length ? 'Combined from the changes approved for this run.' : 'Approve a recommended change to start a build.'),
    label ? badge(label, result?.verified ? 'success' : 'warning') : '')}
    ${selected.length ? `<section class="inset selection"><h2>Approved changes</h2>
      <ul class="build-selection">${selected.map((candidate) => `<li><a href="${route('value', candidate, 'review')}">${escapeHtml(candidate.title)}</a></li>`).join('')}</ul>
    </section>` : ''}
    ${state?.error ? `<section class="inset"><h2>${conflicts.length ? 'Overlapping edits' : 'Build error'}</h2>
      <p>${escapeHtml(state.error)}</p>${conflicts.length ? '<p>Reject one of the conflicting changes and build again.</p>' : ''}
    </section>` : ''}
    ${result ? savedCorrectness(result) + savedPerformance(result) : ''}
    <div class="actions">
      ${result?.verified ? '<button id="download-final-code" class="button primary" type="button">Download Python file</button>' : savedBuildButton(run)}
      <a class="button secondary" href="${route('human')}">Open approval queue</a>
    </div>`;
}

function downloadSavedBuild(run) {
  const result = savedBuildState(run)?.result;
  if (!result?.verified) return;
  const url = URL.createObjectURL(new Blob([result.code], { type: 'text/x-python;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${run.filename.replace(/\.py$/i, '')}_optimised.py`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function savedImprovementSummary(result) {
  const stats = result.stats;
  const speedup = stats.median_speedup;
  const reduction = stats.execution_time_reduction_percent;
  const direction = (value) => value > 0 ? '↑ ' : value < 0 ? '↓ ' : '';
  return `<h2 id="final-improvement-title">Improvement summary</h2>
    <p>Final code measured against the original on the same workloads.</p>
    <dl class="run-counts improvement-stats">
      <div><dt>Median speedup</dt><dd>${badge(direction(speedup - 1) + speedup.toFixed(2) + '×', speedup >= 1 ? 'success' : 'warning')}</dd></div>
      <div><dt>Execution time reduction</dt><dd>${badge(direction(reduction) + Math.abs(reduction).toFixed(1) + '%', reduction >= 0 ? 'success' : 'warning')}</dd></div>
      <div><dt>Correctness checks passed</dt><dd>${badge(`${stats.passed_cases} / ${stats.total_cases}`, 'success')}</dd></div>
    </dl>
    <section class="inset summary-correctness"><h3>Correctness coverage</h3>${correctnessChart(stats)}</section>
    ${measuredCharts(result)}`;
}
