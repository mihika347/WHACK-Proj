/* Measured reports stay separate from the illustrative workflow and approvals. */
(() => {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const median = values => {
    const sorted = values.filter(finite).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return !sorted.length ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const variance = values => {
    if (!values.length) return null;
    const centre = values.reduce((total, value) => total + value, 0) / values.length;
    return values.reduce((total, value) => total + (value - centre) ** 2, 0) / values.length;
  };
  const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const number = (value, digits = 1) => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'Not measured';
  const percent = value => finite(value) ? `${value > 0 ? '+' : ''}${number(value)}%` : 'Not measured';
  const ratioPercent = ratio => finite(ratio) && ratio > 0 ? (ratio - 1) * 100 : null;
  const timeSaved = ratio => finite(ratio) && ratio > 0 ? (1 - 1 / ratio) * 100 : null;
  const stageLabel = name => name === 'final_optimised.py' ? 'Final version' : name.replace(/^stage_(\d+)\.py$/, 'Stage $1');
  const normalise = data => {
    if (!data || !Array.isArray(data.summary) || !data.summary.length || !data.charts ||
        !data.summary.every(row => typeof row.stage === 'string')) throw new Error('Choose an exported ui_results.json containing a summary and charts.');
    const workloads = Array.isArray(data.charts.speed_by_workload) ? data.charts.speed_by_workload : [];
    const summary = data.summary.map(row => {
      const measured = workloads.filter(test => test.stage === row.stage && finite(test.speedup) && test.speedup > 0);
      const ratio = measured.length ? median(measured.map(test => test.speedup)) : finite(row.median_speedup) ? row.median_speedup : null;
      return { ...row, median_speedup: ratio, speed_increase_percent: ratioPercent(ratio), execution_time_reduction_percent: timeSaved(ratio),
        speed_change_variance_pp_squared: measured.length ? variance(measured.map(test => ratioPercent(test.speedup))) : null,
        correctness_change_variance: row.correctness_change_variance ?? row.numeric_error_population_variance ?? null };
    });
    return { ...data, summary, charts: { ...data.charts, speed_by_workload: workloads } };
  };
  const sizeSeries = (data, stage) => {
    const tests = data.charts.speed_by_workload.filter(row => row.stage === stage && finite(row.speedup) && row.speedup > 0);
    const sizes = [...new Set(tests.map(row => row.input_size))].filter(finite).sort((a, b) => a - b);
    return sizes.map(size => ({ input_size: size, speed_increase_percent: ratioPercent(median(tests.filter(row => row.input_size === size).map(row => row.speedup))) }));
  };
  const worstWorkload = (data, stage) => {
    const tests = data.charts.speed_by_workload.filter(row => row.stage === stage && finite(row.speedup) && row.speedup > 0);
    if (!tests.length) return null;
    const worst = tests.reduce((a, b) => a.speedup < b.speedup ? a : b);
    return { ...worst, slowdown_percent: Math.max(0, (1 / worst.speedup - 1) * 100) };
  };
  const selectByThreshold = (data, threshold) => {
    if (!finite(threshold) || threshold < 0 || threshold > 100) throw new Error('Threshold must be between 0 and 100.');
    const summary = data.summary.map(row => {
      const stage = /^stage_\d+\.py$/.test(row.stage);
      const eligible = row.correctness_status === 'pass' && row.speed_status === 'pass' && finite(row.stage_score)
        && row.total_cases > 0 && row.passed_cases === row.total_cases && row.failed_cases === 0
        && ['used', 'disabled'].includes(row.agent_status);
      const above = finite(row.stage_score) && row.stage_score > threshold;
      return { ...row, selection_eligible: eligible, meets_score_threshold: above, is_key_stage: stage && eligible && above,
        selection_reason: !stage ? 'Comparison only.' : !eligible ? 'Blocked: correctness failed or evidence is incomplete.'
          : !above ? `Score ${row.stage_score.toFixed(2)} is not strictly above ${threshold}.` : `Score above ${threshold}; checks passed.` };
    });
    return { ...data, summary, score_threshold: threshold, scoring_policy: { ...data.scoring_policy, score_threshold: threshold },
      key_stages: summary.filter(row => row.is_key_stage).map(row => row.stage),
      review_stages: summary.filter(row => /^stage_\d+\.py$/.test(row.stage) && !row.is_key_stage),
      stage_ranking: summary.filter(row => finite(row.rank)).sort((a, b) => a.rank - b.rank) };
  };
  // These helpers also run in Node for data-contract tests without a browser.
  if (typeof module !== 'undefined' && module.exports) module.exports = { median, normalise, sizeSeries, worstWorkload, escape, selectByThreshold };
  if (typeof document === 'undefined') return;

  const el = id => document.getElementById(id);
  let report = null;
  let detail = null;
  let started = false;
  let requestId = 0;
  let sourceLabel = '';
  let downloadUrl;
  let reviewUrl;
  let customThreshold = false;
  const sources = { latest: '../reports/', failure: '../examples/failure_demo/reports/' };
  const status = (value, tone = '') => `<span class="badge ${tone}">${escape(value ?? 'Not measured')}</span>`;
  const tone = value => value === 'pass' ? 'success' : ['fail', 'error'].includes(value) ? 'rejected' : '';
  const table = (caption, headers, rows) => `<div class="report-table-wrap" tabindex="0" role="region" aria-label="${escape(caption)}"><table class="report-table"><caption>${escape(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">No measurements available.</td></tr>`}</tbody></table></div>`;
  const row = cells => `<tr>${cells.map((cell, index) => index === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`;
  const metric = (label, value, note) => `<div class="report-metric"><dt>${escape(label)}</dt><dd>${escape(value)}</dd><p>${escape(note)}</p></div>`;
  const panel = (title, body, note = '') => `<section class="panel report-panel"><h2>${escape(title)}</h2>${note ? `<p class="chart-note">${escape(note)}</p>` : ''}${body}</section>`;

  function barChart(rows, field, label, percentScale = false) {
    const values = rows.map(item => item[field]).filter(finite);
    if (!values.length) return '<p class="report-empty">No measurements to graph. Run the speed test after correctness passes.</p>';
    const low = Math.min(0, ...values), high = percentScale ? 100 : Math.max(0, ...values);
    const span = high - low || 1;
    const zero = -low / span * 100;
    return `<ul class="report-bars" aria-label="${escape(label)}">${rows.map(item => {
      const value = item[field];
      const start = finite(value) ? Math.min(zero, (value - low) / span * 100) : zero;
      const width = finite(value) ? Math.abs(value) / span * 100 : 0;
      return `<li><span class="report-bar-label">${escape(stageLabel(item.stage))}</span><div class="report-bar-track" aria-hidden="true"><i class="report-zero" style="left:${zero}%"></i><span class="${value < 0 ? 'negative' : ''}" style="left:${start}%;width:${width}%"></span></div><strong>${finite(value) ? `${number(value)}%` : 'Not measured'}</strong></li>`;
    }).join('')}</ul>`;
  }

  function sizeChart(series) {
    if (!series.length) return '<p class="report-empty">Speed by input size is not available for this candidate.</p>';
    const width = 640, height = 235, left = 65, right = 24, top = 20, bottom = 40;
    const values = series.map(item => item.speed_increase_percent);
    const low = Math.min(0, ...values), high = Math.max(1, ...values) * 1.1;
    const x = i => left + (width - left - right) * (series.length === 1 ? .5 : i / (series.length - 1));
    const y = value => top + (high - value) / (high - low || 1) * (height - top - bottom);
    const ticks = [low, (low + high) / 2, high];
    return `<svg class="size-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Percentage speed increase by list size. Exact measurements appear in the table below.">
      ${ticks.map(value => `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" class="chart-grid"/><text x="${left - 9}" y="${y(value) + 4}" text-anchor="end">${number(value, 0)}%</text>`).join('')}
      <line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" class="chart-baseline"/>
      <polyline points="${series.map((item, i) => `${x(i)},${y(item.speed_increase_percent)}`).join(' ')}" fill="none" class="chart-line"/>
      ${series.map((item, i) => `<circle cx="${x(i)}" cy="${y(item.speed_increase_percent)}" r="5"><title>${item.input_size} items: ${percent(item.speed_increase_percent)}</title></circle><text x="${x(i)}" y="${height - 12}" text-anchor="middle">${number(item.input_size, 0)}</text>`).join('')}</svg>`;
  }

  function failurePanel(candidate) {
    const saved = (report.charts.smallest_failing_inputs ?? []).find(row => row.stage === candidate.stage)?.smallest_failing_input;
    const failure = saved?.reduced ?? saved?.smallest_observed;
    const legacy = detail?.candidates?.find(row => row.file === candidate.stage)?.failures;
    const fallback = legacy?.length ? legacy.reduce((a, b) => a.case.numbers.length <= b.case.numbers.length ? a : b) : null;
    const selected = failure ?? fallback;
    if (!selected) return panel('Failing input', `<p>${candidate.correctness_status === 'pass' ? 'No differences observed in this suite.' : 'No counterexample was included in this export. Open the detailed correctness report for errors or timeouts.'}</p>`);
    const test = selected.case;
    return panel(saved?.reduced ? 'Reduced failing input' : 'Smallest observed failing input',
      `<pre class="report-code"><code>${escape(JSON.stringify({ numbers: test.numbers, target: test.target }, null, 2))}</code></pre>
       <dl class="failure-values"><div><dt>Expected output</dt><dd>${escape(JSON.stringify(selected.expected.value))}</dd></div><div><dt>Candidate output</dt><dd>${escape(JSON.stringify(selected.actual.value))}</dd></div></dl>
       <p>${escape(Object.keys(selected.expected).filter(key => JSON.stringify(selected.expected[key]) !== JSON.stringify(selected.actual[key])).join(', '))} differed.</p>`,
      saved?.reduced ? 'Deletion-reduced reproducer; not a guaranteed globally smallest input.' : 'Shortest failing list included in the saved report; no new reduction is run in the browser.');
  }

  function renderReport() {
    if (!report) return;
    const thresholdText = el('score-threshold').value.trim();
    if (!thresholdText || !finite(Number(thresholdText)) || Number(thresholdText) < 0 || Number(thresholdText) > 100) return;
    report = selectByThreshold(report, Number(el('score-threshold').value));
    const query = el('review-search').value.trim().toLowerCase();
    const review = report.review_stages.filter(row => `${row.stage} ${row.correctness_status} ${row.selection_reason}`.toLowerCase().includes(query));
    const candidate = report.summary.find(item => item.stage === el('report-candidate').value) ?? report.summary[0];
    const tests = report.charts.speed_by_workload.filter(item => item.stage === candidate.stage);
    const series = sizeSeries(report, candidate.stage);
    const worst = worstWorkload(report, candidate.stage);
    const groups = (report.charts.correctness_by_source ?? []).filter(item => item.stage === candidate.stage);
    const categories = (report.charts.correctness_by_category ?? []).filter(item => item.stage === candidate.stage);
    const isDemo = el('report-set').value === 'failure' || report.is_deliberately_faulty_demo;
    const date = new Date(report.generated_at);
    el('report-content').innerHTML = `
      <div class="report-provenance inset"><div><strong>${isDemo ? 'Intentional failure demonstration' : 'Saved test run'}</strong><p>${escape(sourceLabel)} · ${Number.isNaN(date.getTime()) ? 'Date unavailable' : escape(date.toLocaleString())}</p><p>Run ${escape(report.run_id)} · ${escape(report.summary.length)} candidates</p></div><a id="download-report" class="button secondary" download="test-results.json">Download JSON</a></div>
      ${report.complete === false ? `<p class="inset report-warning">Partial run: ${escape((report.pending_candidates ?? []).length)} candidates still pending. These are checkpointed results, not a completed run.</p>` : ''}
      ${panel('Stage ranking & key changes', table('Explainable stage scores', ['Rank', 'Stage', 'Score / 100', 'Mean gain', 'Worst slowdown', 'Selection'], [...report.summary].filter(row => row.is_key_stage || row.stage === 'final_optimised.py').sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).map(item => row([
        finite(item.rank) ? number(item.rank, 0) : '—', escape(stageLabel(item.stage)), number(item.stage_score, 2),
        percent(item.mean_speed_increase_percent), finite(item.score_breakdown?.worst_slowdown_percent) ? `${number(item.score_breakdown.worst_slowdown_percent)}%` : 'Not measured',
        item.is_key_stage ? status('Key stage', 'success') : item.stage === 'final_optimised.py' ? 'Comparison only' : item.selection_eligible ? 'Eligible' : finite(item.stage_score) ? 'Review / blocked' : 'Needs evidence']))),
        `Key stages must score strictly above ${report.score_threshold}/100 and pass checks. No top-three limit. Final code is comparison only; no code is automatically applied.`)}
      ${panel(`Review stages (${review.length} of ${report.review_stages.length})`, `<p><a id="download-review" class="button secondary" download="review_stages.json">Download review list</a></p>` + table('Stages below the threshold or blocked from selection', ['Stage', 'Score', 'Reason'], review.map(item => row([
        `<button type="button" class="report-select-link" data-report-candidate="${escape(item.stage)}">${escape(stageLabel(item.stage))}</button>`, number(item.stage_score, 2), escape(item.selection_reason)]))),
        'Use “Search review stages” above to filter this separate list. Browser threshold changes update this view and downloads; use --score-threshold when exporting to save the split on disk.')}
      ${isDemo ? '<p class="inset report-warning">These candidates deliberately contain mistakes. This dataset demonstrates the validator and is separate from your real optimisation run.</p>' : ''}
      ${candidate.identical_to ? `<p class="inset">${escape(stageLabel(candidate.stage))} has identical source to ${escape(stageLabel(candidate.identical_to))}. Differences in measured speed are timing variation.</p>` : ''}
      <dl class="report-metrics">${metric('Correctness', finite(candidate.pass_rate_percent) ? `${number(candidate.pass_rate_percent)}%` : 'Not measured', `${number(candidate.passed_cases, 0)} / ${number(candidate.total_cases, 0)} cases passed`)}
        ${metric('Speed increase', percent(candidate.speed_increase_percent), 'Median of per-workload speedup ratios')}
        ${metric('Variance of speed change', finite(candidate.speed_change_variance_pp_squared) ? `${number(candidate.speed_change_variance_pp_squared, 2)} pp²` : 'Not measured', 'Variation across workload percentage changes')}
        ${metric('Worst observed speed change', worst ? percent(ratioPercent(worst.speedup)) : 'Not measured', worst ? worst.workload : 'No benchmark results')}</dl>
      <div class="report-graph-grid">${panel('Correctness across candidates', barChart(report.summary, 'pass_rate_percent', 'Pass percentage by candidate', true), 'Cases that match all observed behaviour. Read alongside the status and agent coverage below.')}
        ${panel('Speed across candidates', barChart(report.summary, 'speed_increase_percent', 'Percentage speed increase by candidate'), 'Positive is faster; negative is slower. Missing measurements are never plotted as zero.')}</div>
      ${panel('Candidate results', table('Measured correctness and performance', ['Candidate', 'Correctness', 'Passed / total', 'Agent', 'Speed status', 'Speed increase', 'Speed-change variance (pp²)', 'Output-change variance'], report.summary.map(item => row([
        `<button type="button" class="report-select-link" data-report-candidate="${escape(item.stage)}">${escape(stageLabel(item.stage))}</button>`, status(item.correctness_status, tone(item.correctness_status)), `${number(item.passed_cases, 0)} / ${number(item.total_cases, 0)}`, escape(item.agent_status ?? 'Unknown'), status(item.speed_status, tone(item.speed_status)), percent(item.speed_increase_percent), number(item.speed_change_variance_pp_squared, 2), number(item.correctness_change_variance, 4)]))))}
      ${typeof correctnessChart === 'function' ? panel('Selected code correctness', correctnessChart(candidate)) : ''}
      ${typeof measuredCharts === 'function' ? measuredCharts({ stats: candidate, workloads: tests, sizes: series.map(item => ({ ...item, median_speedup: 1 + item.speed_increase_percent / 100 })) }) : ''}
      <h2 class="candidate-heading">${escape(stageLabel(candidate.stage))} <span>${escape(candidate.stage)}</span></h2>
      ${panel('Why this score?', `<p><strong>${number(candidate.stage_score, 2)} / 100</strong></p><p>${escape((candidate.score_reasons ?? ['Generate fresh reports to calculate stage scores.']).join(' '))}</p>
        ${table('Score components', ['Component', 'Points'], Object.entries(candidate.score_breakdown ?? {}).filter(([key]) => ['correctness', 'speed_benefit', 'worst_case', 'consistency'].includes(key)).map(([key, value]) => row([escape(key.replaceAll('_', ' ')), number(value, 2)])))}`,
        '20 correctness points + up to 50 speed-benefit points + 20 worst-case points + 10 consistency points. Incorrect stages receive only 0–19 points and cannot be selected.')}
      <div class="report-graph-grid">${panel('Speed by input size', sizeChart(series) + table('Median percentage speed increase by list size', ['List size', 'Speed increase'], series.map(item => row([number(item.input_size, 0), percent(item.speed_increase_percent)]))), 'Each point gives equal weight to workloads of that size. Horizontal spacing is categorical.')}
        ${panel('Correctness by test source', table('Coverage and correctness by source', ['Source', 'Passed', 'Failed', 'Pass rate'], groups.map(group => row([escape(group.name.replaceAll('_', ' ')), number(group.passed, 0), number(group.failed, 0), finite(group.pass_rate_percent) ? `${number(group.pass_rate_percent)}%` : 'Not measured']))), 'Compare the shared suite for like-for-like candidate coverage. Targeted suites can differ.')}</div>
      <div class="report-graph-grid">${failurePanel(candidate)}${panel('Worst observed performance', worst ? `<p><strong>${escape(worst.workload)}</strong> · ${number(worst.input_size, 0)} items</p><dl class="failure-values"><div><dt>Baseline median</dt><dd>${number(worst.baseline_median_us, 3)} µs</dd></div><div><dt>Candidate median</dt><dd>${number(worst.median_us, 3)} µs</dd></div></dl><p>${worst.slowdown_percent > 0 ? `${number(worst.slowdown_percent)}% longer execution time.` : 'All workloads were at least as fast as the baseline. This is the least-improved workload.'}</p>` : '<p>Not measured. Incorrect candidates are excluded from benchmarks.</p>', 'Worst observed in this finite suite, not a universal worst-case bound.')}</div>
      ${panel('Input-category coverage', table('Correctness by category', ['Category', 'Passed', 'Failed', 'Pass rate'], categories.map(group => row([escape(group.name.replaceAll('_', ' ')), number(group.passed, 0), number(group.failed, 0), finite(group.pass_rate_percent) ? `${number(group.pass_rate_percent)}%` : 'Not measured']))))}
      ${panel('Workload timing details', `<details><summary>Show ${tests.length} workloads and timing variability</summary>${table('Per-workload timing measurements', ['Workload', 'Size', 'Baseline µs', 'Candidate µs', 'Std dev µs', 'Variance µs²', 'Speed increase'], tests.map(test => row([escape(test.workload), number(test.input_size, 0), number(test.baseline_median_us, 3), number(test.median_us, 3), number(test.standard_deviation_us, 3), number(test.population_variance_us_squared, 4), percent(ratioPercent(test.speedup))])))}</details>`, 'Median execution time per call. Variability is across batch timing samples; it is not a confidence interval.')}
      ${candidate.slowest_observed_workload ? panel('Slowest observed runtime', `<p>${escape(candidate.slowest_observed_workload.workload)} · ${number(candidate.slowest_observed_workload.input_size, 0)} items</p><p><strong>${number(candidate.slowest_observed_workload.candidate_median_seconds * 1e6, 3)} µs</strong> median per call; maximum sampled batch-average time ${number(candidate.slowest_observed_workload.maximum_sample_seconds * 1e6, 3)} µs.</p>`) : ''}
      <p class="chart-note">Output-change variance measures candidate minus original numeric outputs. Zero variance can also mean a constant wrong answer; read it alongside pass/fail status. Speed-change variance measures workload sensitivity in percentage-points squared, not timing noise. Worst means worst observed in this finite suite.</p>`;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    el('download-report').href = downloadUrl;
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    reviewUrl = URL.createObjectURL(new Blob([JSON.stringify({run_id: report.run_id, score_threshold: report.score_threshold, stages: report.review_stages}, null, 2)], {type: 'application/json'}));
    el('download-review').href = reviewUrl;
  }

  function accept(data, label, details = null) {
    report = normalise(data);
    if (!customThreshold) el('score-threshold').value = String(report.score_threshold ?? 70);
    detail = details;
    sourceLabel = label;
    const selected = el('report-candidate').value;
    el('report-candidate').innerHTML = report.summary.map(item => `<option value="${escape(item.stage)}">${escape(stageLabel(item.stage))}</option>`).join('');
    if (report.summary.some(item => item.stage === selected)) el('report-candidate').value = selected;
    el('report-candidate').disabled = false;
    el('report-status').textContent = 'Reports loaded. Select a candidate to inspect its evidence.';
    renderReport();
  }

  async function load() {
    const id = ++requestId;
    const base = sources[el('report-set').value];
    el('report-status').textContent = 'Loading saved test results…';
    el('report-content').innerHTML = '';
    el('report-candidate').disabled = true;
    report = null;
    try {
      const response = await fetch(`${base}ui_results.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Report request failed (${response.status}).`);
      const data = await response.json();
      let details = null;
      if (!(data.charts?.smallest_failing_inputs) && data.summary?.some(item => item.correctness_status === 'fail')) {
        try {
          const raw = await fetch(`${base}correctness_report.json`, { cache: 'no-store' });
          if (raw.ok) {
            const parsed = await raw.json();
            if (parsed.run_id === data.run_id) details = parsed;
          }
        } catch { /* Summary and charts are usable without the optional detailed report. */ }
      }
      if (id === requestId) accept(data, `${base}ui_results.json`, details);
    } catch (error) {
      if (id !== requestId) return;
      el('report-status').textContent = 'Could not load saved results.';
      el('report-content').innerHTML = panel('Open your test reports', `<p>${escape(error.message)}</p><p>Serve the project root with <code>python -m http.server 8000</code>, then open <code>http://localhost:8000/ui/#tests</code>. Generate results with <code>python speed_test.py</code>, or use “Open results JSON” above to load a local export.</p>`);
    }
  }
  el('report-set').addEventListener('change', load);
  el('reload-report').addEventListener('click', load);
  el('report-candidate').addEventListener('change', renderReport);
  el('score-threshold').addEventListener('input', () => {
    const text = el('score-threshold').value.trim();
    const value = Number(text);
    if (!text || !finite(value) || value < 0 || value > 100) {
      el('report-status').textContent = 'Enter a score threshold between 0 and 100.';
      return;
    }
    customThreshold = true;
    el('report-status').textContent = `Key stages must score strictly above ${value}.`;
    renderReport();
  });
  el('review-search').addEventListener('input', renderReport);
  el('report-content').addEventListener('click', event => {
    const button = event.target.closest('[data-report-candidate]');
    if (button) { el('report-candidate').value = button.dataset.reportCandidate; renderReport(); }
  });
  el('report-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const id = ++requestId;
    try { const data = JSON.parse(await file.text()); if (id === requestId) accept(data, file.name); }
    catch (error) { if (id === requestId) el('report-status').textContent = `Could not open report: ${error.message}`; }
    event.target.value = '';
  });
  window.testResults = { show() { if (!started) { started = true; load(); } } };
})();
