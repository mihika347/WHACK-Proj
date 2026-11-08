# WHACK: AI Code Optimisation

The integrated UI includes both browser-local project/file editing and Deep Dive test-case uploads, plus the measured-results dashboard. Use `#tests` (or `#measured-results`) for saved reports and `#deep-dive/tests/...` for the separate test-case workspace. See [merge notes](MERGE_NOTES.md) for the preserved features, conflict decisions, test results, and archived pre-merge datasets.

## NVIDIA GPU profile

The pre-GPU project is preserved at Git commit `b4c507cf1a7205a8338358ef576c6ea26b42ac64` and in `backups/pre-nvidia-gpu-b4c507c.zip`. `backups/lmstudio-before-gpu.json` records the previous loaded-model metadata. Backups and local benchmark timings are excluded from Git.

`api_call1.py` now uses the dedicated LM Studio model identifier `whack-nvidia` through `gpu_runtime.py`. An already loaded profile is reused; otherwise the helper selects the installed CUDA runtime and loads the model using `gpu_runtime.json`. Only an idle instance of the same model is unloaded; other models and active requests are not interrupted. LM Studio must be running. There are no Torch/CUDA dependencies in the Python code: the actual GPU inference runs in LM Studio.

The detected machine has an NVIDIA RTX 4060 Laptop GPU with 8 GB VRAM. Its GPT-OSS 20B MXFP4 model is approximately 12.1 GB on disk, so full GPU offload is not assumed. The configured profile uses 50% GPU offload, 8,192 context tokens, and one prediction at a time. LM Studio estimated 6.85 GiB VRAM for this profile. This preserves the existing model and context while avoiding four concurrent prediction slots that this sequential pipeline does not use. Available memory and achievable speed depend on other applications; lower `gpu_offload` if model loading runs out of memory.

```powershell
# Inspect CUDA hardware and estimate memory without changing placement:
python gpu_runtime.py

# Explicitly reapply the GPU loading profile to an idle model:
python gpu_runtime.py --apply

# Normal project command (reuses/loads that profile automatically):
python api_call1.py

# Optional small local inference timing check:
python gpu_benchmark.py --label after
```

`gpu_benchmark_results.json` records two warm-start end-to-end completion-token timing samples per label. It is a small diagnostic, not a guarantee for real stage-generation workloads. The benchmark uses a generic numeric prompt and does not modify source programs, stages, scores, or test reports. Ordinary Python correctness/speed benchmarks remain CPU tests. To bypass automatic GPU model management, set `enabled` to `false` in `gpu_runtime.json`; this does not unload a model already running in LM Studio. The pre-change code can also be restored from the snapshot. CUDA runtimes and offload are configured using the [LM Studio CLI](https://lmstudio.ai/docs/cli/local-models/load).

The initial local check measured 16.35 completion tokens/second before and 18.24 after (11.6% faster), with two measured samples per profile after warmup. GPU memory use after loading was approximately 6.1 GiB. Treat this as a small observed improvement, not a promised percentage for every prompt. The same model weights and context length were retained, and the API-visible NVIDIA identifier was verified without regenerating project stages.

For a larger end-to-end demonstration, see [the large integer-list demo](examples/large_demo/README.md). It keeps the current input/function/output types, contains 14 distinct optimisation opportunities, and includes an independently checked reference implementation.

A Python prototype that uses a locally hosted LM Studio model to propose speed optimisations while preserving the original program's output and behaviour. Each change is saved as an independent stage for review and comparison against the original.

## Goals and current status

Given Python code to optimise, the intended workflow is to:

1. Generate independent optimisation stages.
2. Output correctness and performance statistics for each stage.
3. Highlight key stages for human review, including failures and conflicting changes.
4. Produce code using compatible combinations of selected stages.

Stage generation, a model-proposed final version, automated correctness testing, and measured speed reports are implemented. Review prioritisation and arbitrary stage selection are planned.

## Project structure

```text
WHACK-Proj/
|-- README.md
|-- original.py              # Input program and untouched comparison baseline
|-- api_call1.py             # LM Studio optimisation generator
|-- api_call2.py             # Empty placeholder
`-- output/                  # Generated example artifacts
    |-- stage_1.py
    |-- stage_2.py
    |-- stage_3.py
    |-- final_optimised.py
    `-- report.json
```

The referenced design conversation calls the generator `optimiser.py`; its actual filename here is `api_call1.py`. `main.py` is no longer the entry point.

The current `original.py` defines `count_matches(numbers, target)` and prints `3` for its example input. Replace it with the program you want to optimise and preserve that baseline throughout evaluation.

## Setup and usage

Requirements: Python 3, the Python `openai` package, and LM Studio serving a loaded model through its OpenAI-compatible API.

From the project root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install openai
```

Load a model in LM Studio and start its local API server. The script uses these settings:

| Setting | Value |
| --- | --- |
| Input file | `original.py` |
| Output directory | `output/` |
| API base URL | `http://localhost:1234/v1` |
| Client API key | `lm-studio` |
| Request timeout | 600 seconds |
| Model | First entry returned by `client.models.list()` |
| Temperature | `0.2` |

Edit the configuration in `api_call1.py` if your input file or server differs. Paths are relative to the working directory. Run from the project root:

```powershell
python api_call1.py
```

The generator preserves the original full-program output format. For inputs up to 3,000 characters it first uses the original single-response JSON request. Larger inputs use a short stage catalogue followed by one complete independent program per request, then a complete final program. This avoids repeating every full program in one oversized response. Smaller requests also fall back to this approach if the bulk response is invalid or truncated. Each stage still starts from the exact original, and the public output/report schema remains `stages` plus `final_code`.

Model responses and finish reasons are saved in `output/generation_*.json`. Every request has at most two attempts, prints its stage progress, and detects output-limit truncation explicitly. The entire result is syntax/schema-validated before the entry point replaces any stage files. Failed generation leaves previous stage/report files untouched; it does not publish a partial manifest. Existing `raw_response.txt` files are diagnostics from the previous implementation. For connection failures, check that LM Studio is serving a loaded model at the configured address.

Repeated runs overwrite matching output filenames. Old stage files can remain if a later response contains fewer stages. Test runners now select only stages listed in the latest `output/report.json`, verify their contents match the report, and ignore older files. When no manifest exists, they discover standalone `stage_*.py` files instead.

## Independent stages and report

Each stage is requested to contain the complete original program with exactly one optimisation applied. Stage 2 starts from the original rather than including Stage 1. The prompt asks the model to preserve signatures and observable behaviour, minimise unrelated edits, explain possible speed improvements, identify overlaps, and combine compatible changes in a final version.

`output/report.json` stores the full response in this format:

```json
{
  "stages": [
    {
      "stage": 1,
      "name": "Optimisation name",
      "explanation": "Why this may improve speed",
      "code": "Complete Python program with this change only",
      "overlaps_with": []
    }
  ],
  "final_code": "Complete Python program with compatible optimisations"
}
```

Earlier example runs proposed `list.count`, a generator expression with `sum`, and a local alias for `target`. The latest response proposes only `list.count`, and the final version is identical to that stage. Older stage files remain for reference but are excluded from the current test run. Model explanations and overlap metadata require review; measured performance is stored separately in the test reports.

Syntax checks do not establish correctness, speed, independence, or compatibility. The script does not execute generated code or benchmark it. The model chooses the final version; an interface for combining arbitrary user-selected stages is not implemented.

## Testing design discussed so far

The repository includes `test_utils.py`, `speed_test.py`, `correctness_test.py`, and an independent LM Studio test-generation agent in `targeted_test_agent.py`. **Agent-generated targeted cases are disabled by default during development.** Normal test commands make no model calls and use the varied boundary, seeded random, exhaustive, and deterministic rule-targeted cases immediately. Reports record `agent_status: disabled` rather than claiming agent coverage. The agent implementation and caches remain available for opt-in development.

```powershell
python correctness_test.py
python speed_test.py
python -m unittest test_harness test_targeted_agent test_result_stats test_failure_reduction -v
```

The speed runner first regenerates correctness checks, then verifies the benchmark inputs too. Failed candidates are skipped. Both runners exit with a nonzero status if a candidate fails, errors, or is skipped. Paths resolve relative to the scripts rather than the terminal's working directory.

The current function adapter calls `count_matches(numbers, target)`. To test a different program, change `FUNCTION_NAME` and the calls in `observe` and `worker` in `test_utils.py` to match its signature. Inputs are integer lists; each case also records the scalar target needed by this example.

Correctness reports compare return values and types, exceptions and messages, input mutation, stdout, and stderr. Candidates run in separate processes with a 60-second limit per candidate batch. This is process isolation, not a security sandbox; run trusted code only. Import-time output is suppressed, and filesystem effects and arbitrary global state are outside the comparison.

Targeted coverage now has two layers. The independent agent reads the actual original and candidate source and creates new inputs for the changes it identifies. The existing deterministic syntax-tree rules remain as extra coverage for `list.count`, comprehensions, target aliases, deduplication, sorting, and changed comparisons. Every candidate also receives exhaustive lists of length 0–4 over `[-1, 0, 1]` with four targets, plus shared boundary and seeded random cases. Passing finite tests is evidence of equivalence on those inputs, not a proof for every input.

### Independent targeted-test agent

Each candidate gets a fresh chat-completion request containing just a test-designer system instruction and a user message with the original and candidate source code. The agent receives no optimiser conversation, optimiser prompt, `output/report.json`, stage explanations, other stages, or previous agent messages. It can use the same loaded model with a fresh context, or a different model selected through `TEST_AGENT_MODEL`.

The agent now requests eight short distinct concrete cases and a concise analysis (8–60 cases are accepted). Each case needs an integer list, an integer target, and a change-specific reason. Plain JSON is the default because the local GPT-OSS runtime rejects schema-constrained generation; set `TEST_AGENT_STRUCTURED_OUTPUT=1` only if your server supports it. There are at most three generation requests per candidate, including fresh-context retries with validation feedback.

If the model writes numeric shorthand instead of literal JSON, a bounded data decoder can expand integer arithmetic, short list repetition/concatenation, `range`, `list(range(...))`, and simple single-range list comprehensions. It uses an explicit AST interpreter, never `eval`, `exec`, imports, attributes, arbitrary calls, or generated test programs. Arrays are limited to 2,000 items, arithmetic to 4,096-bit integers, powers to exponent 1,000 with a size bound, and response size/node counts are capped. Unsupported expressions, floats, booleans, missing reasons, and duplicate-only suites are rejected. Expanded cases are saved as ordinary JSON integer lists. This handles responses such as `[i for i in range(70)]` without executing model code. Expected outputs still come from running the original program.

Validated cases, reasons, the source hashes, model ID, and exact request messages are saved under `tests/agent_cases/`. A source-and-prompt fingerprint prevents reusing cases after either program or the instructions change. Identical source pairs can share cached cases even when filenames differ, such as a stage and an identical final version. The configured endpoint and requested model are also part of the cache key. With automatic model selection, a matching cache is deliberately reused even if the server's loaded model changes; use `--refresh-agent` to request fresh cases.

```powershell
# Regenerate independent cases, ignoring matching caches:
python correctness_test.py --with-agent --refresh-agent

# Normal fast development runs (no LM Studio calls):
python correctness_test.py
python speed_test.py --score-threshold 70

# Opt in to independent agent-generated cases later:
python correctness_test.py --with-agent
python speed_test.py --with-agent --score-threshold 70

# Optional agent settings (PowerShell):
$env:LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
$env:TEST_AGENT_MODEL = "openai/gpt-oss-20b"
$env:TEST_AGENT_TIMEOUT = "120"
$env:TEST_AGENT_TOTAL_TIMEOUT = "150"
```

The default endpoint is the same local LM Studio server used by the optimiser, with its first non-embedding model selected unless overridden. Individual HTTP requests time out after 120 seconds. Agent generation runs in a separate worker with a hard 150-second total limit per candidate, including all retries; configure this using `TEST_AGENT_TOTAL_TIMEOUT`. If generation or validation fails, deterministic tests still run and their `observed_status` is recorded, but the overall entry remains an error because requested agent coverage is missing. Failure diagnostics are concise, with full invalid responses saved to disk. `--offline` explicitly disables model calls and records deterministic-only coverage; it does not claim agent validation.

Correctness results and UI exports are checkpointed after every completed stage. Interrupted runs have `complete: false` and list `pending_candidates`; the UI identifies them as partial. Ctrl+C cancels cleanly without a traceback and keeps completed results. Agent-enabled reruns reuse validated cached cases. `--offline` remains a compatible explicit alias for the default deterministic-only mode. `--refresh-agent` requires `--with-agent`; `--offline` cannot be combined with `--with-agent`.

The current agent contract is specifically `count_matches(numbers, target)`. Adapt its prompt as well as the execution adapter when changing the function contract.

Timing uses three warmup calls and seven samples per workload, with repeated calls per sample and fresh input copies prepared outside the measured interval. Reports include sample timings, medians, percentage speed increases, variance of those changes, and worst observed speed. A speedup below 1 means a slowdown. Small timing differences can be noise; results depend on the machine and current load.

### Shared speed-test batch

Generate a fixed, reproducible input suite before evaluating optimisations. Run the original, every independent stage, and the final version against the same inputs for fair comparisons.

- Use fixed random seeds and varied input distributions.
- Cover increasing list sizes; the proposed toolkit uses 100, 1,000, and 10,000 elements.
- Use repeated timings and report runtime and speedup relative to the original for each workload.
- Accept performance results only after correctness checks pass.

### Correctness batch

Compare each candidate with the original using boundary cases, reproducible random cases, and targeted cases based on that stage's changes. Report pass/fail results and counterexamples where behaviour differs. The proposed toolkit mostly uses lists of 0–200 elements for this batch.

The starting input constraint discussed is lists of integers. Floating-point support would require policies for precision, NaN, and infinity. Useful integer cases include:

| Category | Examples |
| --- | --- |
| Empty and singleton | `[]`, `[5]` |
| Positive and negative | `[1, 4, 7]`, `[-10, -5, -1]` |
| Mixed signs and zeros | `[-8, 4, 0, -2, 9]` |
| All zeros or identical | `[0, 0, 0]`, `[7, 7, 7]` |
| Many duplicates | `[1, 2, 2, 3, 3, 3]` |
| Ascending and descending | `[1, 2, 3, 4]`, `[4, 3, 2, 1]` |
| Nearly sorted | `[1, 2, 5, 4, 3, 6]` |
| Alternating signs and extremes | `[-1, 1, -2, 2]`, `[-1000000, 1000000]` |
| Large integers | `[10**20, -10**20, 10**30]` |
| Random integers | Seeded lists across several sizes and value ranges |

The generators respect the current `count_matches(numbers, target)` signature and vary `target`, including absent and repeated values.

Generated testing artifacts (recreated on each run):

```text
test_utils.py                  # Function configuration and shared helpers
speed_test.py                  # Shared benchmark inputs and runner
correctness_test.py            # General and stage-specific comparisons
targeted_test_agent.py          # Independent source-to-test-case agent
tests/agent_cases/              # Validated agent cases and request provenance
tests/speed_cases.json
tests/correctness_cases.json
reports/speed_report.json
reports/correctness_report.json
```

Each candidate also has a combined shared-and-targeted suite in `tests/<candidate>_correctness_cases.json`. Reports contain concrete counterexamples when behaviour differs. `test_harness.py` checks that the evaluator detects wrong counts, input mutation, printed output, exceptions, worker errors, and timeouts.

## Statistics and results for a UI

Run `python speed_test.py` to generate a matching set of correctness, speed, and UI reports. Agent cases are reused when matching caches exist. `python correctness_test.py` also exports correctness-only UI data; speed values are null until the next full speed run, so the UI cannot accidentally display old timings as part of a new run. Each report records a run ID and source hashes.

```text
reports/ui_results.json          # UI summary, chart series, and per-case correctness data
reports/summary.csv              # One row per candidate
reports/speed_workloads.csv      # Timing statistics and percentages for each workload
reports/correctness_cases.csv    # Individual outcomes, numeric errors, and mismatch fields
```

Correctness statistics include pass/fail counts, pass percentage, population variance, and category/source breakdowns. The primary `change_variance` measures the population variance of candidate minus original numeric outputs. The separate pass/fail outcome variance uses `p * (1 - p)`. These are descriptive statistics over the executed cases, not a proof of correctness or an estimate that a future input will pass. Counts can include repeated inputs across coverage sources.

For finite numeric return values, the numeric error is `candidate - original`. Reports include its variance, median, and maximum absolute error. A constant wrong difference also has zero variance, so pass/fail status must always accompany it. Non-numeric values, exceptions, and errors too large for finite statistics are excluded from numeric-error statistics and counted separately. Full behaviour comparison still covers those cases. Correct numeric output with unexpected input mutation or printed output still fails correctness.

Speed reports focus on `speed_increase_percent`, `speed_change_variance_pp_squared`, and `worst_observed_speed`. Speed-change variance is the population variance of the workload percentage speed increases, measured in percentage-points squared. It measures how the benefit varies across workloads, not timing noise. Per-workload timing variance and percentiles remain available as supporting detail: they describe seven per-call batch-average timing samples and are not confidence intervals. Raw timing units are seconds and seconds squared; UI timing units are microseconds and microseconds squared.

Two separate percentage metrics avoid ambiguity:

| Metric | Formula | Example at 2x speedup |
| --- | --- | --- |
| Speed increase | `100 * (baseline_time / candidate_time - 1)` | 100% faster |
| Execution time reduction | `100 * (1 - candidate_time / baseline_time)` | 50% less time |

Negative values mean a slowdown or longer execution, respectively. Aggregate percentages are derived from the median of workload speedup ratios. They are not total runtime reductions for an application. Mean metrics are no longer exported. `worst_observed_speed` records the lowest speed increase, the workload and exact input, and baseline/candidate median runtimes. It remains positive if every workload improved. `slowest_observed_workload` separately records the largest candidate median runtime and its maximum sampled per-call batch-average time; this can be a different workload. Both are worst observed in this finite suite, not theoretical worst-case guarantees. Incorrect candidates have null speed results. Identical code files are marked with `identical_to` in the UI summary.

`ui_results.json` includes these chart-ready arrays:

| JSON field | Suggested presentation |
| --- | --- |
| `summary` | Candidate cards or summary table |
| `charts.speed_comparison` | Percentage speed increase / time reduction bars |
| `charts.correctness_comparison` | Pass-rate bars, output-change variance, maximum absolute error |
| `charts.correctness_by_source` | Shared, rule-targeted, exhaustive, and agent coverage |
| `charts.correctness_by_category` | Pass/fail breakdown by input category |
| `charts.speed_by_input_size` | Percentage speed improvement by list size |
| `charts.correctness_by_input_size` | Pass/fail results for each observed list size |
| `charts.smallest_failing_inputs` | Small observed and reduced failure reproducers |
| `charts.worst_observed_slowdowns` | Slowest relative workloads and their inputs |
| `charts.speed_by_workload` | Baseline vs candidate timings, raw samples, and variability |
| `correctness_case_results` | Per-case outcomes and numeric-error scatter plot |

Fields that were not measured are `null`, not zero. Candidate-specific correctness suites can differ; compare the `shared` source group when comparing stages on identical correctness inputs. Summary status and agent status must be shown alongside statistics so missing agent coverage is not mistaken for a complete pass.

Copy `reports/ui_results.json` into your UI's public assets as `results.json`, or expose it through your backend. For example:

```javascript
const results = await fetch('/results.json').then(response => {
  if (!response.ok) throw new Error('Could not load test results');
  return response.json();
});
const speedBars = results.charts.speed_comparison.map(row => ({
  label: row.stage,
  value: row.speed_increase_percent
}));
```

To regenerate exports from existing matching reports without running tests, use `python export_results.py`. This rejects mismatched run IDs. `python export_results.py --correctness-only` intentionally exports no speed data. To vary the reproducible random correctness inputs, run `python speed_test.py --seed 42`; the speed workloads remain fixed for fair comparisons. Reports are overwritten on each run, so save copies when collecting runs for later comparison.

## Deliberately faulty correctness demo

Run a reproducible failure scenario with:

```powershell
python failure_demo.py
```

This runs the production correctness evaluator against a separate baseline and six fixture candidates in `examples/failure_demo/`. Stage 1 is a correct control. Stages 2–6 intentionally lose duplicate matches, exclude matching zeros, skip the last item, mutate the input by sorting it, and add one to every result. Real `original.py`, optimisation outputs, and normal reports are unaffected. The demo uses deterministic shared, rule-targeted, and exhaustive cases, with agent generation disabled.

Read `examples/failure_demo/reports/demo_summary.json` for pass rates, variance, numeric-error statistics, first counterexamples, and the worst observed absolute numeric error with its input. The standard correctness report, chart-ready `ui_results.json`, and CSV tables are written in that same demo reports folder. The UI JSON is explicitly marked as a deliberately faulty demo. No speed results are generated for these broken candidates.

A successful demo exits with code 0 when the control passes and every intentional bug is detected; this does not mean the broken candidates passed. The worst observed error is limited to the executed cases. Input mutation can fail correctness even with zero numeric error. An always-wrong candidate illustrates that zero pass/fail variance alone does not mean correctness.

## Remaining work

- Extend the function adapter and change-targeting rules for other optimisation problems.
- Add stronger execution sandboxing if accepting untrusted programs.
- Highlight failures and conflicts for human review in a dedicated interface.
- Support selected compatible stage combinations and revalidate the resulting programs.
- Strengthen response-schema and compatibility validation beyond JSON parsing and syntax checks.

# FastForward

## UI demo

Open [`ui/index.html`](ui/index.html) in a browser. The page uses plain HTML, CSS, and JavaScript and runs without a build or backend.

1. Open any pipeline stage, or choose a card under **Deep Dive** to explore Test Cases, AI Generated Changes, or Evaluation. Evaluation opens Correctness Check, with Performance Evaluation in the next tab.
2. Drag the divider to resize the source and detail panes, or use the keyboard arrows while the divider is focused. Use **<** or **>** beside the divider to collapse a pane, then use the remaining arrow to restore the split. On small screens the panes stack.
3. Approve a recommended change and choose **Generate optimised code** in the approval queue. Final shows the build selection, combined diff, and demo verification.
4. To try a failed build, approve both **Use the built-in list count** and **Count a list of matches**, then generate again. Final identifies the overlapping patches. Reject either change and rebuild to recover.

Timing and correctness figures are illustrative. Decisions persist for the browser tab's session. Final build results last until reload.

### Measured test results

The sidebar's **Test results** view and the home page's **View measured test results** button open the actual saved reports. Correctness and Performance demo pages also link to this view. The demo approvals and source diffs remain illustrative; measured reports have their own run ID, timestamp, candidate selector, and source label.

Serve the repository root so the UI can retrieve the report files:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/ui/#tests`. Use **Latest test run** for `reports/ui_results.json` or **Intentional failure demo** for `examples/failure_demo/reports/ui_results.json`. **Reload reports** reads updated exports after running the Python tests. **Open results JSON** also supports opening a local export when the page is opened directly from disk.

The view includes candidate pass-rate and percentage-speed graphs, speed by input size, status/agent/variance tables, category/source correctness breakdowns, failing inputs, worst observed performance, and expandable per-workload median timings and variability. Missing speed results are shown as unmeasured, and byte-identical candidates are flagged. When available, deletion-reduced failures are displayed; older exports use the shortest observed failure from a matching detailed correctness report. The UI does not run tests or perform minimisation itself.

Both older and newer report schemas are supported. Displayed speed summaries and size groups use the median of the exported workload speedup ratios; no mean metrics are displayed in the measured results view. UI graphs have labelled table equivalents, and wide tables scroll independently on narrow screens.

Check the report adapter and rendering with `node --test ui/test-results.test.cjs`.

### Stage scores and key stages

`python speed_test.py` now scores stages after validation and measurement. `python export_results.py` also scores existing matching reports without re-running benchmarks. The UI shows a ranked stage table, the top key stages, and the selected candidate's score components and reasons. Scores and rankings are exported in `ui_results.json`, `summary.csv`, and `speed_report.json`. The final combined version is scored as a comparison but not ranked as another independent stage.

The policy is a configurable, versioned heuristic in `stage_scoring.py`, not a probability or a guarantee of correctness. It reintroduces **mean percentage improvement specifically for scoring**: every benchmark workload has equal weight. Existing median summaries remain available.

For stages passing all observed correctness and benchmark checks, the 0–100 score is:

| Component | Points | Calculation |
| --- | --- | --- |
| Correctness | 20 | All observed cases passed |
| Mean speed benefit | Up to 50 | `50 * max(mean_gain, 0) / (max(mean_gain, 0) + 100)` |
| Worst observed slowdown | Up to 20 | `20 / (1 + worst_runtime_slowdown_percent / 20)` |
| Consistency | Up to 10 | `10 / (1 + sqrt(variance_pp_squared) / max(abs(mean_gain), 25))` |

Using standard deviation relative to the typical benefit avoids directly subtracting variance with squared units. It still penalises sensitivity across workloads; it is not a measure of timing confidence. Incorrect stages receive only `19 * pass_fraction` points and cannot be selected, so speed never compensates for incorrect outputs. Performance is not fabricated for those stages. Incomplete checks or absent timings give a null score rather than zero. Explicit offline runs can be scored but are labelled as having deterministic coverage only.

Key stages now use a **user-entered score threshold**, replacing the top-three rule. Every verified stage scoring **strictly above** the threshold is marked `is_key_stage`; equality goes to review. The default threshold is 70, the valid range is 0–100, and there is no stage-count limit. Incorrect or incomplete stages remain blocked at every threshold. Worst-case and variance penalties remain in the score rather than imposing a second performance cutoff. The final version remains comparison-only. Stage files with identical source can both meet the threshold; check duplicate-source notices and compatibility before combining them.

```powershell
# Apply a cutoff to existing results without rerunning tests:
python export_results.py --score-threshold 80

# Run fresh tests and apply the cutoff:
python speed_test.py --score-threshold 80
```

The non-key independent stages are exported to `reports/review_stages.json` and `reports/review_stages.csv`, with scores, statuses, reasons, and source-file references in the JSON. No source files are moved or deleted. The full report still retains every result. In the UI, edit **Key-stage score threshold** to update the key list and the separate **Review stages** section immediately; filter that list using **Search review stages** and download it separately. Browser changes affect the view and downloads, not files on disk; use the export command to persist the same threshold. Selection is a recommendation only; it does not combine changes, guarantee compatibility, or modify final code. Test with `python -m unittest test_stage_scoring -v`.
# Live UI optimisation and approved builds

The approval queue shows conflicts by original source line and highlights a
compatible combination ranked by the sum of existing individual stage scores.
Rejected stages are excluded. For up to 22 eligible proposals, the planner finds
the highest-scoring compatible set; larger runs use a labelled greedy approximation.
This score is a review aid, not a predicted combined speedup. Identical edits are
counted once, but shared work and runtime interactions can still affect the result.
Build and benchmark the selected combination to establish its actual performance.
Generation is disabled while the approved selection contains overlapping edits.

Start LM Studio's local server on port 1234 with a chat model loaded, then run:

```powershell
python ui/serve.py --port 8000
```

Open http://127.0.0.1:8000 (the root URL). A generic static HTTP server cannot
provide the optimisation API. Create or import a `.py` file containing
`count_matches(numbers, target)`, open Original Code and select Run optimisation.
Each run uses its own `.fastforward-runs` directory; it does not overwrite the
project's original source or saved benchmark reports.

After correctness checks and benchmarking finish, review each recommended diff,
tick the verification checkbox and approve the changes you want. Generate
optimised code combines only that selection with the run's original source.
Overlapping edits are reported as conflicts. The combined program is checked and
benchmarked again before a verified Python download becomes available. The final
summary uses these combined-program measurements. Removing verification removes
that change's approval. Only run Python source you trust locally.

The live generator uses the existing compact-stage generator and the configured
LM Studio model (preferring the loaded `whack-nvidia` identifier). It does not
reload the GPU model. Live UI runs enable AI-generated change-specific tests alongside
deterministic cases. The Test Cases page labels each AI case and its targeted change.
Final builds reuse the approved changes’ test suites. CLI tests remain opt-in with --with-agent.
