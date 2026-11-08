// Charts retain visible numeric labels so colour is never the only evidence.
function runtimeBars(rows, unit) {
  const valid = rows.filter((row) => Number.isFinite(row.original) && row.original > 0 && Number.isFinite(row.final) && row.final >= 0);
  if (!valid.length) return '<p>No comparable runtime measurements available.</p>';
  const maximum = Math.max(...valid.flatMap((row) => [row.original, row.final]));
  return `<div class="runtime-chart"><p class="chart-legend"><span>Original</span><span>Optimised</span></p>${valid.map((row) => `
    <div class="chart-group"><strong>${escapeHtml(row.label)}</strong>${[['Original', row.original], ['Optimised', row.final]].map(([label, value], index) => `
      <div class="chart-row"><span>${label}</span><div class="chart-track" aria-hidden="true"><i class="chart-bar ${index ? 'optimised' : ''}" style="width:${100 * value / maximum}%"></i></div><b>${value.toFixed(2)} ${unit}</b></div>`).join('')}</div>`).join('')}</div>`;
}

function correctnessChart(stats) {
  const total = stats.total_cases;
  const passed = stats.passed_cases;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(passed) || passed < 0 || passed > total) return '<p>No completed correctness measurements available.</p>';
  const percentage = 100 * passed / total;
  return `<div class="correctness-chart"><div class="correctness-track" aria-hidden="true"><i style="width:${percentage}%"></i></div>
    <p><strong>${passed.toLocaleString()} passed</strong> · ${(total - passed).toLocaleString()} did not pass · ${percentage.toFixed(1)}% pass rate</p>
    <p>Passing these cases is evidence of correctness for the tested inputs.</p></div>`;
}

function measuredCharts(result) {
  const workloads = (result.workloads ?? []).filter((row) => Number.isFinite(row.baseline_median_us) && row.baseline_median_us > 0 && Number.isFinite(row.median_us) && row.median_us > 0);
  const sizes = (result.sizes ?? []).filter((row) => Number.isFinite(row.median_speedup) && row.median_speedup > 0);
  if (result.stats.speed_status !== 'pass' || !workloads.length) return '';
  const ratios = workloads.map((row) => row.baseline_median_us / row.median_us);
  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  const variance = ratios.reduce((sum, value) => sum + (value - average) ** 2, 0) / ratios.length;
  const worst = Math.min(...ratios);
  const worstRuntimeChange = (1 / worst - 1) * 100;
  return `<div class="statistics-grid"><section class="inset"><h3>Speed by input size</h3>
    <p>Each pair compares equal work. Original runtime is normalised to 100; shorter is better.</p>
    ${runtimeBars(sizes.map((row) => ({ label: `${row.input_size.toLocaleString()} input values · ${row.median_speedup.toFixed(2)}× speedup`, original: 100, final: 100 / row.median_speedup })), 'relative units')}
    </section><section class="inset"><h3>Consistency and worst case</h3>
    <dl class="run-counts"><div><dt>Speedup variance</dt><dd>${variance.toFixed(3)} ×²</dd></div>
    <div><dt>Observed speedup range</dt><dd>${worst.toFixed(2)}× – ${Math.max(...ratios).toFixed(2)}×</dd></div>
    <div><dt>Worst workload runtime</dt><dd>${Math.abs(worstRuntimeChange).toFixed(1)}% ${worstRuntimeChange > 0 ? 'longer' : 'shorter'}</dd></div></dl>
    <p>Population variance across workload median speedup ratios: lower means more consistent gains. Worst case is the worst measured workload, not a guarantee for every input.</p>
    </section></div>`;
}
