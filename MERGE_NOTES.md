# Ui_NAV → main integration

Starting revisions: `main` at `9cb26ee` and `Ui_NAV` at `384282a`. An existing merge of main into Ui_NAV was completed, then main was advanced to the integrated merge commit. Both parent histories are retained; no reset, rebase, or force push is needed.

## Preserved from main

- Browser-local project files: creation, import, editing, rename/delete, and persistence.
- Deep Dive navigation and uploaded/generated test-case inspection.
- Expand/collapse controls for source and details panes.
- Final-build improvement summary.
- Bounded smallest-counterexample reduction, correctness by input size, and worst-slowdown evidence.

## Preserved from Ui_NAV

- CUDA model-loading profile, generation batching, and large demo baseline.
- Opt-in targeted test agent, bounded case decoder, and checkpointed deterministic testing.
- Speed-change variance, percentage improvements, worst relative performance, and slowest absolute workload.
- Stage scores, user-defined thresholds, key-stage lists, and searchable review-stage exports.
- Measured-results dashboard, JSON loading/downloads, and report charts/tables.

## Conflict decisions

- `#tests` (also `#measured-results`) opens saved measured reports. `#deep-dive/tests/...` opens the separate test-case workspace. They no longer collide or hide one another. Measured reports remain accessible when a custom source file is active.
- The statistics/export schema contains both variance/scoring fields and the input-size, reduced-failure, and worst-slowdown fields. Mean percentage improvement remains available specifically for scoring; legacy raw timing means are not restored.
- Agent generation remains disabled by default as most recently requested. Explicit `--with-agent` is retained.
- Competing generated runs were not spliced together. Exact original datasets from both branches are preserved in `merge_archives/`; current reports and the UI test-case bundle are regenerated against the active large-demo baseline and stage manifest.
- The final summary remains an illustrative demo feature; it does not silently attach saved reports from a different run to browser-local projects.

## Validation

- Python regression suite, including failure reduction and GPU configuration mocks.
- Node report-adapter/controller tests and integrated UI routing/editor/final-summary smoke tests.
- Full deterministic correctness + speed pipeline for the current stage manifest, without model requests.
- Intentional failure demo: correct control passes; all five deliberately faulty implementations are detected.
- JSON/manifest/source-hash consistency, JavaScript syntax, conflict-marker scan, and whitespace checks.

Results: **59 Python regression tests passed, 10 Node UI tests passed, and all 11 current correctness/benchmark candidates passed**. The deliberate failure demo detected all five bugs and produced reduced reproducers. Active correctness, speed, and UI reports share one run ID and match the current baseline/candidate hashes.

The merge is local. No remote push is performed.
