# FastForward

FastForward helps developers review AI-generated Python optimisations using correctness tests, performance measurements and human approval. It identifies conflicting edits, suggests a compatible combination, and builds a downloadable version containing only verified-and-approved changes.

This is a local prototype. It currently evaluates a top-level `count_matches(numbers, target)` function with a list of Python integers and an integer target. The function name is required by the adapter; its behaviour is defined by the original code, not inferred from its name.

## Quick start

You need Python 3, Node.js for frontend tests, and [LM Studio](https://lmstudio.ai/) with a downloaded chat model. The current local setup uses GPT-OSS-20B; another suitable model may work but can produce different results.

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install openai
```

1. Open LM Studio and load your chat model.
2. Under **Developer**, start the local API server on port **1234**.
3. Check the connection:

```powershell
Invoke-RestMethod http://localhost:1234/v1/models
```

4. Start the FastForward backend:

```powershell
python ui/serve.py --port 8000
```

5. Open [FastForward](http://127.0.0.1:8000) and leave the terminal running.

Use the root URL, not `/ui/`. Opening HTML directly or running a generic static HTTP server does not provide the live optimisation API. After Python backend changes, stop the server with **Ctrl+C** and restart it; refreshing the browser alone does not reload Python.

If `python` resolves to a Windows Store alias, use your installed Python executable or activate the virtual environment. A GPU is optional: inference runs inside LM Studio, while correctness checks and benchmarks run on the CPU.

## Demo workflow

1. **Original Code:** create or import a `.py` file, then select **Run optimisation**. Use trusted code containing `count_matches(numbers, target)`.
2. **AI Generated Changes:** inspect independent proposals and source diffs. Every stage starts from the original, rather than accumulating previous stages.
3. **Test Cases / Correctness Check:** inspect the input suites, results and counterexamples. AI-generated cases are labelled **AI-generated · change-specific** with the change they target.
4. **Evaluation / Value Assessment:** compare measured performance. Live recommendations require passing correctness and benchmark checks, a source change, and at least **5% median execution-time reduction**.
5. **Human Review:** inspect the top-scoring compatible combination. Tick a change's verification checkbox before approving it. Changes overlapping an approval show **Conflicting**. Approving an alternative replaces conflicting approvals; removing verification removes its approval.
6. **Final Code:** select **Generate optimised code**. The backend merges only approved edits into the run's original source, then checks and benchmarks the combined program again. Download becomes available after verification passes.

The sidebar groups Original Code, Value Assessment, Human Review and Final Code under **Optimisation pipeline**. **Deep Dive** contains Test Cases, AI Generated Changes, Correctness Check and Evaluation. **Undo last step** returns to the previous visited page.

For a larger example, import [the integer-list analysis demo](examples/large_demo/original.py). It has 14 optimisation opportunities and an [independently tested reference](examples/large_demo/optimised_reference.py). Its output is an integer analysis score, not simply a match count. The model may propose fewer stages, conflicting alternatives or changes that do not meet the performance threshold.

The bundled browser demo uses illustrative evidence. **Saved optimisation run**, **Saved failure demo** and live **Run · ...** entries contain evaluated results. Use a completed run when presenting so a live model response does not consume the demo time.

## How generation and testing work

### Optimisation proposals

The live backend uses `optimisation_generator.py` through `ui/live_generation.py`. It requests compact function replacements and assembles complete independent programs. It validates function signatures, decorators, annotations and imports before evaluation. Responses and generation diagnostics are saved in each run's output directory.

The CLI entry point `api_call1.py` is a separate generation path using `full_stage_generation.py`; it can request complete programs in batches. Its diagnostic filenames and retry policy differ from the live generator. Neither a valid syntax check nor a model explanation establishes correctness or speed.

### Correctness

For each candidate, the evaluator combines:

- Shared boundary inputs and 300 reproducible random cases.
- Exhaustive lists of length 0–4 over `{-1, 0, 1}` with targets `-1, 0, 1, 2` (484 cases).
- AST-based rules targeting actual changes, such as deduplication, sorting or list counting.
- Independent AI-targeted inputs and optional uploaded cases.

The AI test designer receives the original and candidate code, without the optimiser's conversation. It proposes inputs and reasons, not trusted expected outputs. Python compares actual return values and types, exceptions and messages, input mutation, stdout and stderr. Failure reduction searches for a smaller counterexample; it does not guarantee a globally smallest one.

**Live UI runs enable AI-targeted generation. CLI test commands are deterministic-only unless `--with-agent` is supplied.** AI cases are cached against source and prompt fingerprints. Requests normally aim for eight distinct cases; 8–60 validated cases are accepted. The default request timeout is 120 seconds, with a 150-second total worker limit per candidate. Failed AI coverage is reported separately; passing deterministic cases does not convert that run into a fully accepted pass. Use **Retry AI-targeted tests** on affected saved results.

Final builds reuse the selected changes' suites and rerun the combined code against the original. Passing finite tests is evidence of preserved behaviour on those inputs, not proof for every input or proof that the original implementation is correct.

### Performance

The fixed benchmark has 48 workloads: eight input patterns at sizes 100, 1,000 and 10,000, each with present/absent targets. Baseline and candidate receive identical inputs. Benchmark inputs are checked for correctness before performance results are accepted.

Timing uses three calibration calls and seven samples per workload. Adaptive batches aim for about 5 ms, with 1–200 calls per sample. Input copying is outside the timed interval. Reports retain raw samples and medians.

| Measurement | Meaning |
| --- | --- |
| Speedup | Original median runtime / candidate median runtime |
| Speed increase | `100 × (speedup − 1)` |
| Execution-time reduction | `100 × (1 − 1 / speedup)` |
| Speed-change variance | Population variance of workload speed increases, in percentage-points squared |
| Worst slowdown | Largest observed relative runtime increase, floored at zero for scoring |

Median summaries and the mean percentage improvement used in scoring are different aggregates. Variance across workloads describes consistency of benefit, not confidence in a timing estimate. The worst observed workload is not a theoretical worst-case guarantee. Combined performance is measured again because individual gains do not necessarily add together.

## Scores and compatible combinations

Click the **points** value in Human Review for the measurements, formulas and source of each component.

For a candidate with complete passing correctness and benchmark evidence:

| Component | Maximum | Formula |
| --- | --- | --- |
| Correctness | 20 | 20 when all required checks pass |
| Speed benefit | 50 | `50 × max(g, 0) / (max(g, 0) + 100)` |
| Worst case | 20 | `20 / (1 + s / 20)` |
| Consistency | 10 | `10 / (1 + sqrt(v) / max(abs(g), 25))` |

Here `g` is mean workload speed increase (%), `s` is worst runtime slowdown (%), and `v` is variance of workload speed increases (pp²). These are a ranking heuristic, not a probability of correctness. Detected incorrect candidates receive at most 19 points and cannot be selected; incomplete evidence is unscored. Explicit deterministic-only runs can be scored with their coverage labelled.

The combination planner maximises the sum of individual scores over compatible, non-rejected candidates. It searches exactly for up to 22 eligible candidates and uses a labelled greedy approximation above that. Identical patch sets are counted once. Partial shared work and runtime interactions can still overstate benefit. It is a **highest-scoring suggestion**, not a measured fastest combination, and never approves changes automatically.

Older reports without stage scores use a runtime-reduction fallback; the expandable explanation identifies it. Demo timings are also labelled as illustrative.

The separate saved-report dashboard supports a user-entered key-stage threshold (default 70, strictly greater than the cutoff). This threshold controls report ranking, not the live approval queue's 5% runtime-reduction recommendation rule. The dashboard remains accessible at `#tests`; the sidebar now uses pipeline stages.

## Run data and project structure

Live jobs write to `.fastforward-runs/<job-id>/`, keeping the submitted original, proposals, test suites, job status and reports together. They do not overwrite the repository baseline. Browser files persist in local storage; review decisions and verification use session storage. Keep the server's run directories if you want to reopen their results.

```text
ui/serve.py                 Local HTTP server and API
ui/run_jobs.py              Isolated optimisation, recheck and build jobs
ui/run_inputs.py            Source validation and approved-edit merging
ui/live_generation.py       LM Studio connection for live proposals
ui/app.js                   Pipeline navigation and demo workflow
ui/saved-runs.js            Live/saved results and approvals
ui/final-builds.js          Combined build status and downloads
ui/review-planner.js        Compatibility planning and score explanations
optimisation_generator.py   Compact independent-stage generation
correctness_test.py         Behaviour comparison and test suites
speed_test.py               Benchmarks and report generation
stage_scoring.py            Versioned score policy
export_results.py           JSON/CSV exports
reports/                    Repository CLI reports
examples/                   Large example and deliberate failure demo
```

Each evaluated run includes `reports/ui_results.json`, `correctness_report.json`, `speed_report.json` when available, and CSV exports. Reports record run IDs and source hashes. Missing measurements are null, not zero. Candidate-specific correctness suites differ; use shared cases for like-for-like coverage comparisons.

## Development commands

Run these from the repository root:

```powershell
# Repository baseline → generated stages → deterministic evaluation
python api_call1.py
python correctness_test.py
python speed_test.py --score-threshold 70

# Include independent AI-generated targeted cases
python speed_test.py --with-agent --score-threshold 70
python correctness_test.py --with-agent --refresh-agent

# Re-export matching reports or change the saved-report threshold
python export_results.py --score-threshold 80

# Deliberately faulty, separate correctness demonstration
python failure_demo.py

# Regression tests (model responses are mocked in automated tests)
python -m unittest discover -p "test_*.py" -q
node --test ui/app-integration.test.cjs ui/review-planner.test.cjs ui/statistics-charts.test.cjs ui/test-results.test.cjs
```

CLI generation writes `output/report.json` and independent stage files. Evaluators use the manifest and source hashes to avoid accidentally testing leftover stages. A model-generated `output/final_optimised.py` is a proposal; the UI's approved build is separately assembled and revalidated.

Optional AI-test settings in PowerShell:

```powershell
$env:LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
$env:TEST_AGENT_MODEL = "openai/gpt-oss-20b"
$env:TEST_AGENT_TIMEOUT = "120"
$env:TEST_AGENT_TOTAL_TIMEOUT = "150"
```

The live optimiser uses `gpu_runtime.json` for its endpoint and prefers its loaded model identifier, currently `whack-nvidia`. It does not reload the model. The test agent uses the environment settings above or the first non-embedding model. To explicitly apply the configured local GPU profile, use `python gpu_runtime.py --apply`. Hardware-specific settings are optional and may need adjustment for your machine. See [merge notes](MERGE_NOTES.md) for historical integration details.

## Troubleshooting and limitations

- **Connection refused:** start LM Studio's API server on 1234 and the FastForward backend on 8000. They are different servers.
- **An old error remains visible:** saved runs retain their recorded outcomes. Restart the backend after code changes and start a new run or use the applicable retry control.
- **Slow AI testing:** candidates are evaluated sequentially, each potentially waiting up to 150 seconds for AI cases. HTTP polling messages indicate the UI is connected, not that a stage has finished. One optimisation/build job is accepted at a time.
- **Execution exceeded 60 seconds:** a worker has exceeded the whole-batch timeout. This can happen to a slow baseline as well as a broken candidate. The limit is per worker invocation, not per input. Reduce demonstration workload complexity or adjust the worker policy before running slower programs.
- **No recommended changes:** inspect correctness, AI coverage and measured reduction. Proposals do not guarantee useful speedups.
- **Conflicting changes:** choose an alternative. Non-overlapping source edits can still interact semantically, so the final build must pass evaluation.

Workers are separate processes, **not a security sandbox**. Run trusted source only. Filesystem effects and arbitrary global state are outside the behaviour comparison. The prototype requires the current integer-list function contract; other languages, signatures, floating-point policies and stronger execution isolation remain future work.
