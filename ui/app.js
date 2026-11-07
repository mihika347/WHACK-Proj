const icons = {
  pipeline: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v7a2 2 0 0 0 2 2h7"/>',
  file: '<path d="M7 3h7l5 5v13H5V3zm7 0v6h5M8 13h8m-8 4h8"/>',
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
const filtered = candidates.length - recommended.length;
const storageKey = `fastforward:${demoRun.id}:decisions`;
const verdicts = { approved: 'Approved', rejected: 'Rejected', pending: 'Pending' };
const decisions = readDecisions();

const views = [
  { id: 'results', label: 'Results', icon: 'bars' },
  { id: 'review', label: 'Review', icon: 'review' },
  { id: 'approve', label: 'Approve', icon: 'check' },
];

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
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(decisions)));
  } catch {
    // Decisions remain available in memory for this page.
  }
}

function route(view, candidate = recommended[0]) {
  return `#performance/${view}/${candidate.id}`;
}

function readRoute() {
  const [stage, view, id] = location.hash.slice(1).split('/');
  if (stage !== 'performance') return { view: 'pipeline', candidate: recommended[0] };
  return {
    view: views.some((item) => item.id === view) ? view : 'review',
    candidate: candidates.find((item) => item.id === id) ?? recommended[0],
  };
}

function renderNavigation({ view, candidate }) {
  const items = [
    { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', href: '#pipeline' },
    ...views.map((item) => ({ ...item, href: route(item.id, candidate) })),
  ];
  const link = (item) => `<a href="${item.href}" ${view === item.id ? 'aria-current="page"' : ''}>
    ${icon(item.icon)}<span>${item.label}</span></a>`;
  byId('navigation').innerHTML = `<p class="nav-label">Workspace</p>${items.map(link).join('')}
    <span class="nav-disabled" aria-disabled="true">${icon('flag')}<span>Final</span></span>`;
  byId('workspace-views').innerHTML = views.map((item) => link({
    ...item, href: route(item.id, candidate),
  })).join('');
}

function renderPipeline({ view, candidate }) {
  const reviewed = decisions.size;
  const stages = [
    { title: 'Original Code', icon: 'file', tone: 'blue', note: `Baseline · ${evidence.baselineMs.toFixed(2)} ms mean` },
    { title: 'AI Generated Changes', icon: 'spark', tone: 'violet', note: `${candidates.length} changes proposed` },
    { title: 'Correctness Check', icon: 'check', tone: 'green', note: `${candidates.length} passed · ${evidence.cases} cases each` },
    { title: 'Performance Evaluation', icon: 'bars', tone: 'gold', note: `${filtered} filtered · ${recommended.length} remains`, href: route('review'), active: view !== 'pipeline' && view !== 'approve' },
    { title: 'Value Assessment', icon: 'star', tone: 'blue', note: `${recommended.length} recommended for review` },
    { title: 'Human Review', icon: 'person', tone: 'violet', note: `${reviewed} of ${recommended.length} decided`, href: route('approve', candidate), active: view === 'approve' },
    { title: 'Final Code', icon: 'flag', tone: 'muted', note: 'Generation is outside this demo' },
  ];
  byId('pipeline-stages').innerHTML = stages.map((stage, index) => {
    const content = `<span class="stage-icon">${icon(stage.icon)}</span>
      <span class="stage-copy"><strong>${stage.title}</strong><small>${stage.note}</small></span>
      <span class="stage-end" aria-hidden="true">${stage.href ? '→' : String(index + 1).padStart(2, '0')}</span>`;
    const className = `stage-card tone-${stage.tone}`;
    return `<li>${stage.href
      ? `<a class="${className}" href="${stage.href}">${content}</a>`
      : `<div class="${className}">${content}</div>`}</li>`;
  }).join('');

  byId('workspace-stages').innerHTML = stages.map((stage, index) => {
    const content = `<span class="stage-step">${index + 1}</span><span>${stage.title}</span>`;
    return `<li>${stage.href
      ? `<a href="${stage.href}" ${stage.active ? 'aria-current="step"' : ''}>${content}</a>`
      : `<span class="stage-static">${content}</span>`}</li>`;
  }).join('');

  byId('run-summary').innerHTML = `
    <p class="eyebrow">Run ${demoRun.id}</p>
    <h2>Ready for review</h2>
    <p>Inspect the changes that passed and see why the others were filtered.</p>
    <dl class="run-counts">
      <div><dt>Proposed</dt><dd>${candidates.length}</dd></div>
      <div><dt>Recommended</dt><dd>${recommended.length}</dd></div>
      <div><dt>Filtered</dt><dd>${filtered}</dd></div>
    </dl>
    <div class="demo-note">${icon('file')}<div><strong>${demoRun.filename}</strong>
      <p>${demoRun.inputDomain}. Timing and correctness figures are illustrative.</p></div></div>
    <a class="button primary" href="${route('review')}">Open Performance <span aria-hidden="true">→</span></a>`;
}

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function highlightPython(line) {
  return escapeHtml(line).replace(
    /\b(def|for|in|if|return)\b|\b(\d+)\b|\b([a-z_]\w*)(?=\()/g,
    (token, keyword, number) => `<span class="syntax-${keyword ? 'keyword' : number ? 'number' : 'call'}">${token}</span>`,
  );
}

let displayedCandidate;

function renderCode(candidate) {
  if (displayedCandidate === candidate.id) return;
  displayedCandidate = candidate.id;
  const { start, remove, lines } = candidate.patch;
  const baseline = demoRun.baseline;
  const offset = start - 1;
  const row = (line, before, after, kind, sign = '') => `
    <div class="code-line ${kind}">
      <span class="line-number" aria-hidden="true">${before}</span>
      <span class="line-number" aria-hidden="true">${after}</span>
      <span class="line-sign">${sign}</span><code>${highlightPython(line)}</code>
    </div>`;

  byId('source-file').textContent = demoRun.filename;
  byId('diff-toolbar').innerHTML = `<strong>Candidate diff</strong>
    <span><span class="added-text">+${lines.length}</span> <span class="removed-text">−${remove}</span></span>`;
  const diff = byId('source-diff');
  diff.innerHTML = [
    ...baseline.slice(0, offset).map((line, i) => row(line, i + 1, i + 1, 'context')),
    ...baseline.slice(offset, offset + remove).map((line, i) => row(line, start + i, '', 'removed', '−')),
    ...lines.map((line, i) => row(line, '', start + i, 'added', '+')),
    ...baseline.slice(offset + remove).map((line, i) => row(line, start + remove + i, start + lines.length + i, 'context')),
  ].join('');
  diff.scrollTop = 0;
  diff.scrollLeft = 0;
  byId('code-footer').textContent = `Original lines ${start}–${start + remove - 1} · ${candidate.title}`;
}

function performance(candidate) {
  const percentage = (1 - candidate.meanMs / evidence.baselineMs) * 100;
  return `${Math.abs(percentage).toFixed(1)}% ${percentage >= 0 ? 'faster' : 'slower'}`;
}

function outcomeBadge(candidate) {
  return candidate.outcome === 'recommended'
    ? '<span class="badge success">Recommended</span>'
    : '<span class="badge warning">Filtered</span>';
}

function reviewView(candidate) {
  const decision = decisions.get(candidate.id) ?? 'pending';
  const maximum = Math.max(evidence.baselineMs, candidate.meanMs);
  const bar = (label, value, className) => `
    <div class="metric-row"><span>${label}</span>
      <div class="metric-track" aria-hidden="true"><span class="${className}" style="width:${value / maximum * 100}%"></span></div>
      <strong>${value.toFixed(2)} ms</strong>
    </div>`;
  const actions = candidate.outcome === 'recommended'
    ? `<div class="actions">
        <button class="button secondary" type="button" data-decision="rejected" aria-pressed="${decision === 'rejected'}">Reject change</button>
        <button class="button primary" type="button" data-decision="approved" aria-pressed="${decision === 'approved'}">Approve change ${icon('check')}</button>
      </div>`
    : `<div class="actions"><a class="button secondary" href="${route('results', candidate)}">See all results</a></div>`;

  return `<div class="detail-header">
      <div class="label-row"><span class="eyebrow">Performance evaluation</span>${outcomeBadge(candidate)}</div>
      <h1 id="view-title" tabindex="-1">${candidate.title}</h1>
      <p>${candidate.description}</p>
    </div>
    <div class="evidence-grid">
      <section class="inset"><h2>Why it matters</h2><p>${candidate.rationale}</p></section>
      <section class="inset"><h2>Correctness</h2><strong class="correctness">${candidate.matched} / ${evidence.cases}</strong><p>Fixture outputs matched</p></section>
    </div>
    <section class="inset timing">
      <div class="label-row"><h2>${icon('bars')} Mean runtime</h2>
        <span class="badge ${candidate.outcome === 'recommended' ? 'success' : 'warning'}">${performance(candidate)}</span></div>
      ${bar('Baseline', evidence.baselineMs, 'baseline-bar')}
      ${bar('Candidate', candidate.meanMs, 'candidate-bar')}
      <p>${evidence.samples} fixture runs across ${evidence.inputTypes}</p>
    </section>
    <section class="inset selection"><h2>${candidate.outcome === 'recommended' ? 'Why it was recommended' : 'Why it was filtered'}</h2>
      <p>${candidate.reason}</p></section>
    ${actions}`;
}

function resultsView() {
  return `<div class="detail-header">
      <p class="eyebrow">Performance evaluation</p>
      <h1 id="view-title" tabindex="-1">Candidate results</h1>
      <p>${candidates.length} evaluated · ${recommended.length} recommended · ${filtered} filtered</p>
    </div>
    <ul class="candidate-list">${candidates.map((candidate) => `<li>
      <a class="candidate-row inset" href="${route('review', candidate)}">
        <div><strong>${candidate.title}</strong><p>${candidate.reason}</p></div>
        <div class="row-meta">${outcomeBadge(candidate)}<small>${performance(candidate)}</small></div>
      </a>
    </li>`).join('')}</ul>`;
}

function queueView() {
  const approved = [...decisions.values()].filter((decision) => decision === 'approved').length;
  return `<div class="detail-header">
      <p class="eyebrow">Human review</p>
      <h1 id="view-title" tabindex="-1">Approval queue</h1>
      <p>${decisions.size} of ${recommended.length} decided. Select a change to revisit its evidence or update your decision.</p>
    </div>
    <dl class="run-counts queue-counts">
      <div><dt>Approved</dt><dd>${approved}</dd></div>
      <div><dt>Rejected</dt><dd>${decisions.size - approved}</dd></div>
      <div><dt>Pending</dt><dd>${recommended.length - decisions.size}</dd></div>
    </dl>
    <ul class="candidate-list">${recommended.map((candidate) => {
      const decision = decisions.get(candidate.id) ?? 'pending';
      return `<li><a class="candidate-row inset" href="${route('review', candidate)}">
        <div><strong>${candidate.title}</strong><p>View diff and evidence</p></div>
        <span class="badge ${decision}">${verdicts[decision]}</span>
      </a></li>`;
    }).join('')}</ul>`;
}

function render(focusHeading = false) {
  const state = readRoute();
  const atHome = state.view === 'pipeline';
  byId('pipeline-home').hidden = !atHome;
  byId('workspace').hidden = atHome;
  renderNavigation(state);
  renderPipeline(state);

  if (!atHome) {
    renderCode(state.candidate);
    const content = byId('details-content');
    switch (state.view) {
      case 'results': content.innerHTML = resultsView(); break;
      case 'approve': content.innerHTML = queueView(); break;
      default: content.innerHTML = reviewView(state.candidate);
    }
  }
  if (focusHeading) {
    window.scrollTo(0, 0);
    byId(atHome ? 'home-title' : 'view-title').focus({ preventScroll: true });
  }
}

byId('details-content').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-decision]');
  if (!button) return;
  const { view, candidate } = readRoute();
  if (view !== 'review' || candidate.outcome !== 'recommended') return;
  saveDecision(candidate, button.dataset.decision);
  location.hash = route('approve', candidate);
});

window.addEventListener('hashchange', () => render(true));
render();
