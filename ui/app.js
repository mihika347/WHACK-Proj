const icons = {
  pipeline: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v7a2 2 0 0 0 2 2h7"/>',
  file: '<path d="M7 3h7l5 5v13H5V3zm7 0v6h5M8 13h8m-8 4h8"/>',
  tests: '<path d="M9 3h6m-5 0v6l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 14h8"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  spark: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  bars: '<path d="M5 20v-5m7 5V9m7 11V4" stroke-width="3"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  person: '<circle cx="12" cy="7" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>',
  flag: '<path d="M5 22V3m0 1c6-5 8 5 15 0v12c-7 5-9-5-15 0"/>',
  review: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
};

const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

const byId = (id) => document.getElementById(id);
const { candidates, evidence } = demoRun;
const recommended = candidates.filter((candidate) => candidate.outcome === 'recommended');
const storageKey = `fastforward:${demoRun.id}:decisions`;
const verdicts = { approved: 'Approved', rejected: 'Rejected', pending: 'Pending' };
const decisions = readDecisions();
let finalBuild;

const stages = {
  original: { title: 'Original Code', icon: 'file', tone: 'blue', view: 'overview' },
  tests: { title: 'Test Cases', icon: 'tests', tone: 'violet', view: 'tests' },
  generated: { title: 'AI Generated Changes', icon: 'spark', tone: 'violet', view: 'results' },
  correctness: { title: 'Correctness Check', icon: 'check', tone: 'muted', view: 'results' },
  performance: { title: 'Performance Evaluation', icon: 'bars', tone: 'gold', view: 'review' },
  value: { title: 'Value Assessment', icon: 'star', tone: 'blue', view: 'results' },
  human: { title: 'Human Review', icon: 'person', tone: 'violet', view: 'approve' },
  final: { title: 'Final Code', icon: 'flag', tone: 'muted', view: 'final' },
};
const stageOrder = Object.keys(stages);
const pipelineStages = ['original', 'value', 'human', 'final'];
const deepDiveStages = ['tests', 'generated', 'correctness', 'performance'];
const candidateStages = ['generated', 'correctness', 'performance', 'value'];

function readDecisions() {
  const saved = new Map();
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey)) ?? {};
    for (const candidate of recommended) {
      const decision = stored[candidate.id];
      if (decision === 'approved' || decision === 'rejected') {
        saved.set(candidate.id, decision);
      }
    }
  } catch {
    // Storage may be unavailable in local-file or private browsing contexts.
  }
  return saved;
}

function saveDecision(candidate, decision) {
  decisions.set(candidate.id, decision);
  finalBuild = undefined;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(decisions)));
  } catch {
    // Decisions remain available in memory for this page.
  }
}

function route(stage, candidate = recommended[0], view = stages[stage].view) {
  const section = deepDiveStages.includes(stage) ? 'deep-dive/' : '';
  return `#${section}${stage}/${view}/${candidate.id}`;
}

function stageCandidates(stage) {
  return candidates.filter((candidate) =>
    !candidate.filteredAt || stageOrder.indexOf(candidate.filteredAt) >= stageOrder.indexOf(stage),
  );
}

function readRoute() {
  if (location.hash === '#tests' || location.hash === '#measured-results') return { view: 'measured', candidate: recommended[0] };
  const parts = location.hash.slice(1).split('/');
  const isDeepDive = parts[0] === 'deep-dive';
  if (isDeepDive) parts.shift();
  let [stage, view, id] = parts;
  if (isDeepDive && !deepDiveStages.includes(stage)) stage = 'tests';
  // Step 1 approval links used the Performance stage.
  if (stage === 'performance' && view === 'approve') stage = 'human';
  if (!stageOrder.includes(stage)) return { view: 'pipeline', candidate: recommended[0] };
  const inCandidateStage = candidateStages.includes(stage);
  const eligible = inCandidateStage ? stageCandidates(stage) : recommended;
  return {
    stage,
    view: inCandidateStage && ['results', 'review'].includes(view) ? view : stages[stage].view,
    candidate: eligible.find((candidate) => candidate.id === id) ?? recommended[0],
  };
}

function renderNavigation({ stage, view, candidate }) {
  const candidateStage = candidateStages.includes(stage) ? stage : 'performance';
  const items = [
    { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', href: '#pipeline' },
    { id: 'measured', label: 'Test results', icon: 'bars', href: '#tests' },
    { id: 'tests', label: 'Test cases', icon: 'tests', href: route('tests', candidate) },
    { id: 'results', label: 'Results', icon: 'bars', href: route(candidateStage, candidate, 'results') },
    { id: 'review', label: 'Review', icon: 'review', href: route(candidateStage, candidate, 'review') },
    { id: 'approve', label: 'Approve', icon: 'check', href: route('human', candidate) },
    { id: 'final', label: 'Final', icon: 'flag', href: route('final', candidate) },
  ];
  const link = (item) => `<a href="${item.href}" ${view === item.id ? 'aria-current="page"' : ''}>
    ${icon(item.icon)}<span>${item.label}</span></a>`;
  byId('navigation').innerHTML = `<p class="nav-label">Workspace</p>${items.map(link).join('')}`;
}

function stageSummary(stage) {
  const file = activeProjectFile();
  if (file && !file.demo) {
    return stage === 'original' ? file.name : stage === 'tests' ? 'Upload tests for this file' : 'Awaiting optimisation';
  }
  const entered = stageCandidates(stage).length;
  const removed = candidates.filter((candidate) => candidate.filteredAt === stage).length;
  switch (stage) {
    case 'original': return `Baseline · ${formatMs(evidence.baseline.mean)} mean`;
    case 'generated': return `${candidates.length} changes proposed`;
    case 'value': return `${removed} filtered · ${recommended.length} recommended`;
    case 'human': return `${decisions.size} of ${recommended.length} decided`;
    case 'final': return finalBuild ? buildLabels[finalBuild.status] : 'Build from approved changes';
    default: return `${removed} filtered · ${entered - removed} passed`;
  }
}

function stageCard(stage, title, summary) {
  const { icon: iconName, tone } = stages[stage];
  return `<li><a class="stage-card tone-${tone}" href="${route(stage)}">
    <span class="stage-icon">${icon(iconName)}</span>
    <span class="stage-copy"><strong>${title}</strong><small id="${stage}-stage-summary">${summary}</small></span>
    <span class="stage-end" aria-hidden="true">→</span>
  </a></li>`;
}

function renderPipeline({ stage: activeStage, candidate }) {
  byId('pipeline-stages').innerHTML = pipelineStages.map((stage) =>
    stageCard(stage, stages[stage].title, stageSummary(stage)),
  ).join('');
  byId('deep-dive-cards').innerHTML = [
    stageCard('tests', stages.tests.title, 'AI-generated cases and your uploads'),
    stageCard('generated', stages.generated.title, stageSummary('generated')),
    stageCard('correctness', 'Evaluation', 'Correctness and performance results'),
  ].join('');

  const isDeepDive = deepDiveStages.includes(activeStage);
  const menuStages = isDeepDive ? deepDiveStages : pipelineStages;
  byId('deep-dive-label').hidden = !isDeepDive;
  byId('workspace-stage-menu').setAttribute('aria-label', isDeepDive ? 'Deep Dive' : 'Pipeline stages');
  const strip = byId('workspace-stages');
  strip.innerHTML = menuStages.map((stage, index) => `
    <li><a href="${route(stage, candidate)}" ${stage === activeStage ? 'aria-current="step"' : ''}>
      <span class="stage-step" aria-hidden="true">${index + 1}</span><span>${stages[stage].title}</span>
    </a></li>`).join('');
  const activeLink = strip.querySelector('[aria-current="step"]');
  if (activeLink && strip.scrollWidth > strip.clientWidth) {
    const offset = activeLink.getBoundingClientRect().left - strip.getBoundingClientRect().left;
    strip.scrollLeft += offset - (strip.clientWidth - activeLink.offsetWidth) / 2;
  }

  byId('run-summary').innerHTML = `
    <p class="eyebrow">Run ${demoRun.id}</p>
    <h2>Ready for review</h2>
    <p>Inspect the changes that passed and see why the others were filtered.</p>
    <dl class="run-counts">
      <div><dt>Proposed</dt><dd>${candidates.length}</dd></div>
      <div><dt>Recommended</dt><dd>${recommended.length}</dd></div>
      <div><dt>Filtered</dt><dd>${candidates.length - recommended.length}</dd></div>
    </dl>
    <div class="demo-note">${icon('file')}<div><strong>${demoRun.filename}</strong>
      <p>${demoRun.inputDomain}. Timing and correctness figures are illustrative.</p></div></div>
    <a class="button primary" href="#tests">View measured test results <span aria-hidden="true">→</span></a>
    <a class="button secondary" href="${route('performance')}">Explore demo workflow</a>`;
}

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function highlightPython(line) {
  return escapeHtml(line).replace(
    /\b(def|for|in|if|not|return)\b|\b(\d+)\b|\b([a-z_]\w*)(?=\()/g,
    (token, keyword, number) => `<span class="syntax-${keyword ? 'keyword' : number ? 'number' : 'call'}">${token}</span>`,
  );
}

let displayedCode;

function codeRow(line, before, after, kind = 'context', sign = '') {
  return `<div class="code-line ${kind}">
    <span class="line-number" aria-hidden="true">${before}</span>
    <span class="line-number" aria-hidden="true">${after}</span>
    <span class="line-sign">${sign}</span><code>${highlightPython(line)}</code>
  </div>`;
}

function renderCode({ stage, candidate }) {
  const isFinal = stage === 'final';
  const hasFinalDiff = isFinal && finalBuild?.status === 'verified';
  if (isFinal && !hasFinalDiff) {
    displayedCode = undefined;
    byId('source-file').textContent = demoRun.filename;
    byId('diff-toolbar').textContent = finalBuild?.status === 'pending' ? 'Building final code…' : 'No final code available';
    byId('source-diff').replaceChildren();
    byId('source-diff').setAttribute('aria-label', 'Final code');
    byId('code-footer').textContent = finalBuild?.status === 'failed'
      ? 'Resolve conflicting approvals to generate final code.' : 'Final code includes all compatible approved changes.';
    return;
  }
  const isBaseline = stage === 'original' || (isFinal && !hasFinalDiff);
  const codeId = hasFinalDiff ? finalBuild : isBaseline ? 'baseline' : candidate.id;
  if (displayedCode === codeId) return;
  displayedCode = codeId;

  const applied = hasFinalDiff ? finalBuild.applied : isBaseline ? [] : [candidate];
  const title = hasFinalDiff ? 'Final code · all approved changes' : isBaseline ? 'Original source' : 'Candidate diff';
  const baseline = demoRun.baseline;
  const rows = [];
  let before = 0;
  let after = 0;
  let added = 0;
  let removed = 0;
  for (const { patch } of applied) {
    while (before < patch.start - 1) {
      rows.push(codeRow(baseline[before], before + 1, after + 1));
      before += 1;
      after += 1;
    }
    for (let i = 0; i < patch.remove; i += 1) {
      if (!hasFinalDiff) rows.push(codeRow(baseline[before], before + 1, '', 'removed', '−'));
      before += 1;
    }
    for (const line of patch.lines) {
      rows.push(codeRow(line, '', after + 1, 'added', '+'));
      after += 1;
    }
    removed += patch.remove;
    added += patch.lines.length;
  }
  while (before < baseline.length) {
    rows.push(codeRow(baseline[before], before + 1, isBaseline ? '' : after + 1));
    before += 1;
    after += 1;
  }
  byId('source-file').textContent = demoRun.filename;
  byId('diff-toolbar').innerHTML = `<strong>${title}</strong>${isBaseline ? '' :
    `<span><span class="added-text">+${added}</span> <span class="removed-text">−${removed}</span></span>`}`;
  const diff = byId('source-diff');
  diff.setAttribute('aria-label', title);
  diff.innerHTML = rows.join('');
  diff.scrollTop = 0;
  diff.scrollLeft = 0;
  byId('code-footer').textContent = hasFinalDiff
    ? `${applied.length} approved ${applied.length === 1 ? 'change' : 'changes'} used in this build`
    : isBaseline ? demoRun.inputDomain : candidate.title;
}

function formatMs(ms) {
  return `${ms.toFixed(2)} ms`;
}

function performance(timing) {
  const percentage = (1 - timing.mean / evidence.baseline.mean) * 100;
  if (percentage === 0) return 'Same mean runtime';
  return `${Math.abs(percentage).toFixed(1)}% ${percentage > 0 ? 'faster' : 'slower'}`;
}

function badge(label, tone = '') {
  return `<span class="badge ${tone}">${label}</span>`;
}

function detailHeader(stage, title, description, status = '') {
  return `<div class="detail-header">
    <div class="label-row"><span class="eyebrow">${stages[stage].title}</span>${status}</div>
    <h1 id="view-title" tabindex="-1">${title}</h1>
    <p>${description}</p>
  </div>`;
}

function timingPanel(timing, label) {
  const baseline = evidence.baseline;
  const maximum = Math.max(baseline.mean, timing.mean);
  const bar = (label, value, className) => `
    <div class="metric-row"><span>${label}</span>
      <div class="metric-track" aria-hidden="true"><span class="${className}" style="width:${value / maximum * 100}%"></span></div>
      <strong>${formatMs(value)}</strong>
    </div>`;
  return `<section class="inset timing">
    <div class="label-row"><h2>${icon('bars')} Mean runtime</h2>
      ${badge(performance(timing), timing.mean <= baseline.mean ? 'success' : 'warning')}</div>
    ${bar('Baseline', baseline.mean, 'baseline-bar')}
    ${bar(label, timing.mean, 'candidate-bar')}
    <table class="timing-table">
      <thead><tr><th scope="col">Runtime</th><th scope="col">Baseline</th><th scope="col">${label}</th></tr></thead>
      <tbody>
        <tr><th scope="row">Median</th><td>${formatMs(baseline.median)}</td><td>${formatMs(timing.median)}</td></tr>
        <tr><th scope="row">Worst observed</th><td>${formatMs(baseline.worst)}</td><td>${formatMs(timing.worst)}</td></tr>
      </tbody>
    </table>
    <p>${evidence.samples} fixture runs across ${evidence.inputTypes}</p>
  </section>`;
}

function baselineView() {
  const { mean, median, worst } = evidence.baseline;
  return `${detailHeader('original', 'Baseline source', demoRun.inputDomain + '.')}
    <section class="inset"><h2>Baseline runtime</h2><p>${evidence.samples} fixture runs across ${evidence.inputTypes}.</p></section>
    <dl class="run-counts">
      <div><dt>Mean</dt><dd>${formatMs(mean)}</dd></div>
      <div><dt>Median</dt><dd>${formatMs(median)}</dd></div>
      <div><dt>Worst observed</dt><dd>${formatMs(worst)}</dd></div>
    </dl>
    <section class="inset"><h2>Correctness reference</h2><p>Each change is compared with the original function on ${evidence.cases} fixture inputs.</p></section>
    <div class="actions"><a class="button primary" href="${route('value')}">See value assessment</a></div>`;
}

function assessment(stage, candidate) {
  if (stage === 'generated') return { label: 'Proposed', reason: candidate.description };
  if (candidate.filteredAt === stage) return { label: 'Filtered', tone: 'warning', reason: candidate.reason };
  if (stage === 'correctness') {
    return { label: 'Passed', tone: 'success', reason: `All ${evidence.cases} fixture outputs matched the baseline.` };
  }
  if (stage === 'performance') {
    return { label: 'Passed', tone: 'success', reason: `Mean runtime was ${performance(candidate.timing)}.` };
  }
  return { label: 'Recommended', tone: 'success', reason: candidate.reason };
}

function reviewView(stage, candidate) {
  const result = assessment(stage, candidate);
  const showCorrectness = stage !== 'generated';
  const showTiming = stage === 'performance' || stage === 'value';
  const failure = stage === 'correctness' ? candidate.failure : undefined;
  const decision = decisions.get(candidate.id) ?? 'pending';
  const canDecide = showTiming && candidate.outcome === 'recommended';
  return `${detailHeader(stage, candidate.title, candidate.description, badge(result.label, result.tone))}
    ${['correctness', 'performance'].includes(stage) ? measuredLink() : ''}
    <div class="${showCorrectness ? 'evidence-grid' : ''}">
      <section class="inset"><h2>Why it matters</h2><p>${candidate.rationale}</p></section>
      ${showCorrectness ? `<section class="inset"><h2>Correctness</h2>
        <strong class="${failure ? 'removed-text' : 'correctness'}">${candidate.matched} / ${evidence.cases}</strong><p>Fixture outputs matched</p></section>` : ''}
    </div>
    ${failure ? `<section class="inset"><h2>Example failing input</h2>
      <p><code>count_matches(${JSON.stringify(failure.numbers)}, ${failure.target})</code></p>
      <p>Expected <strong>${failure.expected}</strong> · Returned <strong>${failure.actual}</strong></p>
    </section>` : ''}
    ${showTiming ? timingPanel(candidate.timing, 'Candidate') : ''}
    ${showCorrectness ? `<section class="inset selection">
      <h2>${result.label === 'Filtered' ? 'Why it was filtered' : 'Why it advanced'}</h2><p>${result.reason}</p>
    </section>` : ''}
    <div class="actions">
      <a class="button secondary" href="${route(stage, candidate, 'results')}">See stage results</a>
      ${canDecide ? `<button class="button secondary" type="button" data-decision="rejected" aria-pressed="${decision === 'rejected'}">Reject change</button>
        <button class="button primary" type="button" data-decision="approved" aria-pressed="${decision === 'approved'}">Approve change ${icon('check')}</button>` : ''}
    </div>`;
}

function measuredLink() {
  return '<aside class="inset measured-link"><strong>This view uses illustrative workflow data.</strong><p><a href="#tests">Open measured correctness and speed reports →</a></p></aside>';
}

function resultsView(stage, selected) {
  const titles = {
    generated: 'Proposed changes',
    correctness: 'Correctness results',
    performance: 'Candidate results',
    value: 'Value assessment results',
  };
  const description = stage === 'value'
    ? `${stageSummary(stage)} · ${evidence.minimumImprovement}% minimum mean improvement`
    : stageSummary(stage);
  return `${detailHeader(stage, titles[stage], description)}
    ${['correctness', 'performance'].includes(stage) ? measuredLink() : ''}
    <ul class="candidate-list">${stageCandidates(stage).map((candidate) => {
      const result = assessment(stage, candidate);
      return `<li><a class="candidate-row inset" href="${route(stage, candidate, 'review')}">
        <div><strong>${candidate.title}</strong><p>${result.reason}</p></div>
        <div class="row-meta">${badge(result.label, result.tone)}${candidate === selected ? '<small>Diff shown</small>' : ''}</div>
      </a></li>`;
    }).join('')}</ul>`;
}

function approvedCandidates() {
  return recommended.filter((candidate) => decisions.get(candidate.id) === 'approved');
}

function queueView() {
  const approved = approvedCandidates().length;
  const generating = finalBuild?.status === 'pending';
  return `${detailHeader('human', 'Approval queue', `${decisions.size} of ${recommended.length} decided. Select a change to revisit its evidence or update your decision.`)}
    <dl class="run-counts queue-counts">
      <div><dt>Approved</dt><dd>${approved}</dd></div>
      <div><dt>Rejected</dt><dd>${decisions.size - approved}</dd></div>
      <div><dt>Pending</dt><dd>${recommended.length - decisions.size}</dd></div>
    </dl>
    <ul class="candidate-list">${recommended.map((candidate) => {
      const decision = decisions.get(candidate.id) ?? 'pending';
      return `<li><a class="candidate-row inset" href="${route('value', candidate, 'review')}">
        <div><strong>${candidate.title}</strong><p>View diff and evidence</p></div>
        ${badge(verdicts[decision], decision)}
      </a></li>`;
    }).join('')}</ul>
    <section class="inset selection"><h2>Generate optimised code</h2>
      <p>${approved ? `The next build will use ${approved} approved ${approved === 1 ? 'change' : 'changes'}.` : 'Approve a change to enable generation.'}</p>
    </section>
    <div class="actions"><button class="button primary" type="button" id="generate-build" ${!approved || generating ? 'disabled' : ''}>
      ${generating ? 'Verifying…' : 'Generate optimised code'}</button></div>`;
}

const buildLabels = { pending: 'Verification pending', verified: 'Verified', failed: 'Build failed' };

function approvalKey(selected) {
  return selected.map((candidate) => candidate.id).join('+');
}

function generateBuild() {
  const selected = approvedCandidates();
  if (!selected.length || finalBuild?.status === 'pending') return;
  finalBuild = { status: 'pending', selected };
  const pendingBuild = finalBuild;
  location.hash = route('final');

  window.setTimeout(() => {
    if (finalBuild !== pendingBuild) return;
    // Insertions at a replacement boundary can be applied before the replacement.
    const applied = [...selected].sort((a, b) =>
      a.patch.start - b.patch.start || a.patch.remove - b.patch.remove,
    );
    const overlap = applied.findIndex(({ patch }, index) => {
      const previous = applied[index - 1]?.patch;
      return previous && patch.start < previous.start + previous.remove;
    });
    finalBuild = overlap >= 0
      ? { status: 'failed', selected, conflict: applied.slice(overlap - 1, overlap + 1) }
      : { status: 'verified', selected, applied, timing: demoRun.finalTimings[approvalKey(selected)] };
    renderBuildUpdate();
  }, 900);
}

function finalImprovementSummary(timing) {
  const metrics = [
    ['mean', 'Mean runtime'],
    ['median', 'Median runtime'],
    ['worst', 'Worst observed runtime'],
  ];
  return `<h2 id="final-improvement-title">Improvement summary</h2>
    <p>Final code compared with the original using demo timings.</p>
    <dl class="run-counts improvement-stats">${metrics.map(([metric, label]) => {
      const saved = evidence.baseline[metric] - timing[metric];
      const tone = saved > 0 ? 'success' : saved < 0 ? 'warning' : '';
      const percentage = (100 * Math.abs(saved) / evidence.baseline[metric]).toFixed(1);
      const change = saved === 0 ? 'Same runtime' :
        `<span aria-hidden="true">${saved > 0 ? '↑' : '↓'}</span> ${percentage}%<span class="visually-hidden"> ${saved > 0 ? 'faster' : 'slower'}</span>`;
      const delta = saved === 0 ? 'No time difference' : `${formatMs(Math.abs(saved))} ${saved > 0 ? 'saved' : 'added'}`;
      return `<div><dt>${label}</dt><dd>${badge(change, tone)}<small>${delta}</small></dd></div>`;
    }).join('')}</dl>`;
}

function finalView() {
  const queueLink = `<div class="actions"><a class="button secondary" href="${route('human')}">Open approval queue</a></div>`;
  if (!finalBuild) {
    return `${detailHeader('final', 'Ready to generate', 'Generate a demo build from the changes you approve.')}${queueLink}`;
  }

  const { status, selected, conflict, timing } = finalBuild;
  const statusTone = { pending: '', verified: 'success', failed: 'rejected' }[status];
  const message = {
    pending: 'Applying approved patches and checking the combined code.',
    verified: 'The combined code matched the baseline on all fixture inputs.',
    failed: 'Two approved patches change the same original lines. Choose one of them and generate again.',
  }[status];
  const approvalsChanged = approvalKey(selected) !== approvalKey(approvedCandidates());
  return `${detailHeader('final', 'Final build', message, badge(buildLabels[status], statusTone))}
    ${approvalsChanged ? '<p class="inset build-note">Your approvals changed. This build uses the selection listed below.</p>' : ''}
    <section class="inset"><h2>${status === 'verified' ? 'Approvals used' : 'Build selection'}</h2>
      <ul class="build-selection">${selected.map((candidate) => `<li>${candidate.title}</li>`).join('')}</ul>
    </section>
    ${status === 'failed' ? `<section class="inset selection"><h2>Patch conflict</h2>
      <p>Affected changes</p>
      <ul class="build-selection">${conflict.map((candidate) => `<li><a href="${route('value', candidate, 'review')}">${candidate.title}</a></li>`).join('')}</ul>
    </section>` : ''}
    ${status === 'verified' ? `<section class="inset"><h2>Combined correctness</h2>
      <strong class="correctness">${evidence.cases} / ${evidence.cases}</strong><p>Fixture outputs matched</p></section>
      ${timingPanel(timing, 'Final')}` : ''}
    ${queueLink}`;
}

function renderBuildUpdate() {
  const state = readRoute();
  if (state.view === 'final' || state.view === 'approve') {
    const restoreHeading = document.activeElement === byId('view-title');
    render();
    if (restoreHeading) byId('view-title').focus({ preventScroll: true });
  } else {
    byId('final-stage-summary').textContent = stageSummary('final');
  }
}

function setSplitLayout(layout) {
  const detailsOnly = layout === 'details-only';
  const codeCollapsed = layout === 'code-collapsed';
  const detailsCollapsed = layout === 'details-collapsed';
  const codeVisible = !detailsOnly && !codeCollapsed;
  const atTestCases = readRoute().view === 'tests';

  split.dataset.layout = layout;
  byId('code-pane').hidden = !codeVisible;
  byId('details-pane').hidden = detailsCollapsed;
  byId('split-rail').hidden = detailsOnly;
  divider.hidden = layout !== 'split';
  splitLeft.hidden = codeCollapsed;
  splitRight.hidden = detailsCollapsed;
  splitLeft.title = detailsCollapsed ? 'Expand details pane' : 'Collapse code pane';
  splitRight.title = codeCollapsed ? 'Expand code pane' : 'Collapse details pane';
  splitLeft.setAttribute('aria-label', splitLeft.title);
  splitRight.setAttribute('aria-label', splitRight.title);
  splitLeft.setAttribute('aria-controls', detailsCollapsed ? 'details-pane' : 'code-pane');
  splitRight.setAttribute('aria-controls', codeCollapsed ? 'code-pane' : 'details-pane');
  splitLeft.setAttribute('aria-expanded', String(!detailsCollapsed));
  splitRight.setAttribute('aria-expanded', String(!codeCollapsed));

  byId('test-case-code-close').hidden = !atTestCases || !codeVisible;
  const showCode = atTestCases ? byId('test-case-show-code') : null;
  if (showCode) {
    showCode.setAttribute('aria-expanded', String(codeVisible));
    showCode.textContent = codeVisible ? 'Hide code' : 'Show code';
  }
}

function render(focusHeading = false) {
  renderFileList();
  const initialState = readRoute();
  if (initialState.view === 'measured') {
    byId('pipeline-home').hidden = true;
    byId('workspace').hidden = true;
    byId('measured-results').hidden = false;
    byId('final-improvement').hidden = true;
    document.querySelector('.demo-badge').hidden = false;
    document.querySelector('.demo-badge').innerHTML = '<span class="dot"></span> Saved reports';
    renderNavigation(initialState);
    window.testResults.show();
    if (focusHeading) byId('measured-title').focus({preventScroll: true});
    return;
  }
  byId('measured-results').hidden = true;
  byId('final-improvement').hidden = true;
  if (renderProjectFile(focusHeading)) return;
  byId('file-editor').hidden = true;
  byId('source-diff').hidden = false;
  document.querySelector('.code-header .label').textContent = 'Python';
  const state = readRoute();
  if (state.stage === 'final' && !finalBuild && approvedCandidates().length) generateBuild();
  const atHome = state.view === 'pipeline';
  const atTestCases = state.view === 'tests';
  document.querySelector('.demo-badge').innerHTML = '<span class="dot"></span> Demo run';
  byId('pipeline-home').hidden = !atHome;
  byId('workspace').hidden = atHome;
  if (focusHeading || !split.dataset.layout) setSplitLayout(atTestCases ? 'details-only' : 'split');
  renderNavigation(state);
  renderPipeline(state);

  if (!atHome) {
    if (!atTestCases) renderCode(state);
    const content = byId('details-content');
    switch (state.view) {
      case 'overview': content.innerHTML = baselineView(); break;
      case 'tests': content.innerHTML = testCasesView(); break;
      case 'results': content.innerHTML = resultsView(state.stage, state.candidate); break;
      case 'approve': content.innerHTML = queueView(); break;
      case 'final': content.innerHTML = finalView(); break;
      default: content.innerHTML = reviewView(state.stage, state.candidate);
    }
    const liveStatus = byId('build-status');
    const status = state.view === 'final' && finalBuild ? buildLabels[finalBuild.status] : '';
    if (liveStatus.textContent !== status) liveStatus.textContent = status;
  }
  const showImprovement = state.view === 'final' && finalBuild?.status === 'verified';
  const improvement = byId('final-improvement');
  improvement.hidden = !showImprovement;
  improvement.innerHTML = showImprovement ? finalImprovementSummary(finalBuild.timing) : '';

  if (focusHeading) {
    window.scrollTo(0, 0);
    byId(atHome ? 'home-title' : 'view-title').focus({ preventScroll: true });
  }
}

byId('details-content').addEventListener('click', (event) => {
  if (handleTestCaseClick(event)) return;
  if (event.target.closest('#generate-build')) {
    generateBuild();
    return;
  }
  const button = event.target.closest('button[data-decision]');
  if (!button) return;
  const { stage, view, candidate } = readRoute();
  if (view !== 'review' || !['performance', 'value'].includes(stage) || candidate.outcome !== 'recommended') return;
  saveDecision(candidate, button.dataset.decision);
  location.hash = route('human', candidate);
});

byId('details-content').addEventListener('change', uploadTestCases);

byId('test-case-code-close').addEventListener('click', () => {
  setSplitLayout('code-collapsed');
  splitRight.focus();
});

const split = byId('workspace-split');
const divider = byId('split-divider');
const splitLeft = byId('split-left');
const splitRight = byId('split-right');
const minSplit = Number(divider.getAttribute('aria-valuemin'));
const maxSplit = Number(divider.getAttribute('aria-valuemax'));
let dragOffset = 0;

function moveSplit(collapsedLayout, nextControl) {
  const layout = split.dataset.layout === 'split' ? collapsedLayout : 'split';
  setSplitLayout(layout);
  const focusTarget = nextControl.getClientRects().length
    ? nextControl
    : byId('test-case-show-code') ?? byId('view-title');
  focusTarget.focus();
}

splitLeft.addEventListener('click', () => moveSplit('code-collapsed', splitRight));
splitRight.addEventListener('click', () => moveSplit('details-collapsed', splitLeft));

function resizeSourcePane(percent) {
  const width = Math.max(minSplit, Math.min(maxSplit, Math.round(percent)));
  split.style.setProperty('--split-position', `${width}%`);
  divider.setAttribute('aria-valuenow', String(width));
}

divider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  const bounds = divider.getBoundingClientRect();
  dragOffset = event.clientX - (bounds.left + bounds.width / 2);
  divider.setPointerCapture(event.pointerId);
  split.classList.add('resizing');
});
divider.addEventListener('pointermove', (event) => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const { left, width } = split.getBoundingClientRect();
  resizeSourcePane(100 * (event.clientX - left - dragOffset) / width);
});
divider.addEventListener('lostpointercapture', () => split.classList.remove('resizing'));
divider.addEventListener('keydown', (event) => {
  const current = Number(divider.getAttribute('aria-valuenow'));
  const widths = { ArrowLeft: current - 3, ArrowRight: current + 3, Home: minSplit, End: maxSplit };
  if (!Object.hasOwn(widths, event.key)) return;
  event.preventDefault();
  resizeSourcePane(widths[event.key]);
});

const visitedPages = [];
const undoNavigation = byId('undo-navigation');
window.addEventListener('hashchange', (event) => {
  visitedPages.push(new URL(event.oldURL).hash || '#pipeline');
  undoNavigation.disabled = false;
  render(true);
});
undoNavigation.addEventListener('click', () => {
  if (!visitedPages.length) return;
  // Replace the route so undo does not add the page being left back to the stack.
  history.replaceState(history.state, '', visitedPages.pop());
  undoNavigation.disabled = visitedPages.length === 0;
  render(true);
});
render();
