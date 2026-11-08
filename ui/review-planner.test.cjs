const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({
  escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  route: (_, candidate) => `#review/${candidate.id}`,
});
vm.runInContext(fs.readFileSync(`${__dirname}/review-planner.js`, 'utf8'), context);
const candidate = (id, score, start, remove, lines = [id]) => ({
  id, title: id, stats: { stage_score: score }, patches: [{ start, remove, lines }],
});

test('finds the best compatible combination rather than choosing the best single stage', () => {
  const a = candidate('a', 10, 2, 8);
  const b = candidate('b', 6, 2, 2);
  const c = candidate('c', 6, 7, 2);
  const plan = context.planReview([a, b, c]);
  assert.equal(plan.score, 12);
  assert.deepEqual(Array.from(plan.best, item => item.id), ['b', 'c']);
  assert.equal(plan.exact, true);
  assert.equal(context.planReview([a, b, c], new Set(['b'])).best[0].id, 'a');
});

test('matches merge semantics for insertion boundaries, shared edits and overlap', () => {
  const replace = candidate('replace', 5, 2, 4);
  assert.equal(context.reviewConflicts(replace, candidate('boundary', 4, 2, 0)), false);
  assert.equal(context.reviewConflicts(replace, candidate('inside', 4, 3, 0)), true);
  assert.equal(context.reviewConflicts(replace, candidate('after', 4, 6, 1)), false);
  const insertion = candidate('insert', 4, 2, 0);
  assert.equal(context.reviewConflicts(insertion, candidate('different', 4, 2, 0)), true);
  const duplicate = candidate('copy', 4, 2, 4, ['replace']);
  assert.equal(context.reviewConflicts(replace, duplicate), false);
  assert.equal(context.planReview([replace, duplicate]).best.length, 1);
});

test('approval conflicts and hypothetical ranking are visible with escaped titles', () => {
  const a = candidate('<a>', 10, 2, 4);
  const b = candidate('b', 6, 3, 2);
  const html = context.reviewPlanningPanel([a, b], [a, b]);
  assert.match(html, /Approved edits overlap/);
  assert.match(html, /Estimated ranking; build to measure speed/);
  assert.match(html, /&lt;a&gt;/);
  assert.equal(context.approvedEditsConflict([a, b]), true);
  assert.equal(context.approvedEditsConflict([a]), false);
});

test('large plans are labelled approximate and missing evidence is not scored', () => {
  assert.equal(context.planReview([{ id: 'missing', patches: [] }]).best.length, 0);
  const many = Array.from({ length: 23 }, (_, i) => candidate(String(i), 5, i + 1, 1));
  const plan = context.planReview(many);
  assert.equal(plan.exact, false);
  assert.equal(plan.best.length, 23);
});

test('clickable score explains saved components and distinguishes legacy fallback', () => {
  const a = candidate('measured', 83.2, 2, 1);
  a.stats.agent_status = 'used';
  a.stats.score_breakdown = { correctness: 20, speed_benefit: 39.5492, worst_case: 20,
    consistency: 3.6533, mean_gain_percent: 378.431148, worst_slowdown_percent: 0, variance_pp_squared: 432209.2276 };
  const html = context.reviewPlanningPanel([a], []);
  assert.match(html, /<details class="score-explanation"><summary><strong>83.2 points/);
  assert.match(html, /378.43/);
  assert.match(html, /432,209.23/);
  assert.match(html, /39.55 \/ 50/);
  assert.match(html, /summary → score_breakdown/);
  delete a.stats.stage_score;
  a.stats.median_speedup = 2.95;
  assert.match(context.reviewScoreExplanation(a), /Legacy fallback/);
  assert.doesNotMatch(context.reviewScoreExplanation(a), /39.55/);
});
