// Compatibility uses original-source coordinates, matching run_inputs.merge_approved.
function reviewEdits(candidate) {
  return candidate.patches ?? (candidate.patch ? [candidate.patch] : []);
}

function reviewConflicts(first, second) {
  const edits = [first, second].flatMap(candidate => reviewEdits(candidate).map(patch => ({ ...patch, owner: candidate.id })))
    .sort((a, b) => a.start - b.start || a.remove - b.remove);
  let previous;
  let end = 0;
  for (const edit of edits) {
    if (previous && edit.start === previous.start && edit.remove === previous.remove && JSON.stringify(edit.lines) === JSON.stringify(previous.lines)) continue;
    if (previous && (edit.start < end || edit.start === previous.start && edit.remove === 0 && previous.remove === 0)) {
      if (previous.owner !== edit.owner) return true;
    }
    end = edit.start + edit.remove;
    previous = edit;
  }
  return false;
}

function reviewWeight(candidate) {
  if (Number.isFinite(candidate.stats?.stage_score)) return Math.max(0, candidate.stats.stage_score);
  const ratio = candidate.stats?.median_speedup;
  if (Number.isFinite(ratio) && ratio > 0) return Math.max(0, 100 * (1 - 1 / ratio));
  const baseline = typeof demoRun !== 'undefined' ? demoRun.evidence.baseline.median : undefined;
  return Number.isFinite(candidate.timing?.median) && baseline > 0
    ? Math.max(0, 100 * (1 - candidate.timing.median / baseline)) : 0;
}

function planReview(candidates, rejected = new Set()) {
  const conflicts = new Map(candidates.map(candidate => [candidate.id,
    candidates.filter(other => other !== candidate && reviewConflicts(candidate, other))]));
  const eligible = candidates.filter(candidate => !rejected.has(candidate.id) && reviewWeight(candidate) > 0)
    .sort((a, b) => reviewWeight(b) - reviewWeight(a) || a.id.localeCompare(b.id));
  // Identical patches offer the same edit, so count their benefit only once.
  const duplicate = (first, second) => JSON.stringify(reviewEdits(first)) === JSON.stringify(reviewEdits(second));
  const compatible = (candidate, selected) => selected.every(other => !conflicts.get(candidate.id).includes(other) && !duplicate(candidate, other));
  let best = [];
  let score = 0;
  const exact = eligible.length <= 22;
  if (exact) {
    const remaining = Array(eligible.length + 1).fill(0);
    for (let i = eligible.length - 1; i >= 0; i--) remaining[i] = remaining[i + 1] + reviewWeight(eligible[i]);
    const search = (index, selected, total) => {
      if (total > score) { score = total; best = [...selected]; }
      if (index === eligible.length || total + remaining[index] <= score) return;
      const candidate = eligible[index];
      if (compatible(candidate, selected)) search(index + 1, [...selected, candidate], total + reviewWeight(candidate));
      search(index + 1, selected, total);
    };
    search(0, [], 0);
  } else {
    for (const candidate of eligible) if (compatible(candidate, best)) best.push(candidate);
    score = best.reduce((sum, candidate) => sum + reviewWeight(candidate), 0);
  }
  return { conflicts, best, score, exact };
}

function reviewScoreExplanation(candidate) {
  const stats = candidate.stats ?? {};
  const breakdown = stats.score_breakdown;
  const number = value => Number.isFinite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : 'Unavailable';
  const sourceLink = `<a href="${route('performance', candidate, 'review')}">View workload measurements</a>`;
  let body;
  if (Number.isFinite(stats.stage_score) && breakdown && Number.isFinite(breakdown.mean_gain_percent)) {
    const gain = breakdown.mean_gain_percent;
    const slowdown = breakdown.worst_slowdown_percent;
    const variance = breakdown.variance_pp_squared;
    body = `<p>Mean speed increase <strong>${number(gain)}%</strong> · Worst slowdown <strong>${number(slowdown)}%</strong> · Variance <strong>${number(variance)} pp²</strong></p>
      <div class="review-compatibility-table"><table class="timing-table"><thead><tr><th scope="col">Component</th><th scope="col">Calculation</th><th scope="col">Points</th></tr></thead><tbody>
      <tr><th scope="row">Correctness</th><td>All checks passed; coverage complete for this run</td><td>${number(breakdown.correctness)} / 20</td></tr>
      <tr><th scope="row">Speed benefit</th><td>50 × max(${number(gain)}, 0) / (max(${number(gain)}, 0) + 100)</td><td>${number(breakdown.speed_benefit)} / 50</td></tr>
      <tr><th scope="row">Worst case</th><td>20 / (1 + ${number(slowdown)} / 20)</td><td>${number(breakdown.worst_case)} / 20</td></tr>
      <tr><th scope="row">Consistency</th><td>10 / (1 + √${number(variance)} / max(|${number(gain)}|, 25))</td><td>${number(breakdown.consistency)} / 10</td></tr>
      </tbody></table></div>
      <p>Source: saved benchmark medians for each workload. Speed increase = 100 × (original / candidate − 1); mean and variance are across those increases. Worst slowdown is the largest runtime increase, floored at 0. Correctness comes from the saved test results${stats.agent_status === 'disabled' ? ' (AI tests disabled for this run)' : ''}.</p>
      <p>Stored in <code>ui_results.json → summary → score_breakdown</code>. Displayed values are rounded. ${sourceLink}.</p>`;
  } else if (Number.isFinite(stats.stage_score)) {
    body = `<p>Saved stage score: ${number(stats.stage_score)} / 100. This report does not contain its calculation breakdown. Re-run evaluation to obtain it.</p>`;
  } else if (Number.isFinite(stats.median_speedup) && stats.median_speedup > 0) {
    body = `<p>Legacy fallback: max(0, 100 × (1 − 1 / ${number(stats.median_speedup)})) = ${number(reviewWeight(candidate))} points.</p>
      <p>Source: saved median speedup. This is runtime reduction, not the full correctness / worst-case / consistency score. ${sourceLink}.</p>`;
  } else {
    body = '<p>Demo fallback: max(0, 100 × (1 − candidate median runtime / original median runtime)). Source: illustrative demo timings, not a measured stage score.</p>';
  }
  return `<section class="score-stage"><h3>${escapeHtml(candidate.title)} · ${number(reviewWeight(candidate))} points</h3>${body}</section>`;
}

function reviewPlanningPanel(candidates, approved, rejected = new Set()) {
  const plan = planReview(candidates, rejected);
  const selectedConflicts = approved.flatMap((candidate, index) => approved.slice(index + 1)
    .filter(other => plan.conflicts.get(candidate.id)?.includes(other)).map(other => [candidate, other]));
  const link = candidate => `<a href="${route('value', candidate, 'review')}">${escapeHtml(candidate.title)}</a>`;
  return `<section class="inset review-planner"><h2>${plan.exact ? 'Top-scoring combination' : 'Top suggested combination'}</h2>
    ${plan.best.length ? `<ul class="combination-chips">${plan.best.map(candidate => `<li>${link(candidate)}</li>`).join('')}</ul>
    <details class="score-explanation"><summary><strong>${plan.score.toFixed(1)} points</strong> <span>· How is this calculated?</span></summary>
      <p>Combination total = ${plan.best.map(candidate => reviewWeight(candidate).toFixed(2)).join(' + ')} = ${plan.score.toFixed(2)} points. A ranking, not a combined speedup.</p>
      ${plan.best.map(reviewScoreExplanation).join('')}
    </details><p>${plan.exact ? '' : 'Approximate search · '}Estimated ranking; build to measure speed.</p>` : '<p>No eligible combination available.</p>'}
    ${selectedConflicts.length ? '<p class="review-conflict" role="status">Approved edits overlap. Choose one alternative.</p>' : ''}
    </section>`;
}

function reviewStatus(candidate, approved, decision = 'pending') {
  return approved.some(other => other.id !== candidate.id && reviewConflicts(candidate, other)) ? 'conflicting' : decision;
}

function approvedEditsConflict(candidates) {
  return candidates.some((candidate, index) => candidates.slice(index + 1).some(other => reviewConflicts(candidate, other)));
}
