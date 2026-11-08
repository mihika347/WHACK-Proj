"""Produce genuine correctness failures from deliberately faulty candidates."""
from pathlib import Path
import json

from correctness_test import run
from test_utils import ROOT, save_json

SCENARIOS = {
    "stage_1.py": ("Correct control", True),
    "stage_2.py": ("Duplicate matches lost", False),
    "stage_3.py": ("Matching zeros excluded", False),
    "stage_4.py": ("Last element skipped", False),
    "stage_5.py": ("Input list mutated", False),
    "stage_6.py": ("Every result one too large", False),
}


def run_demo(project_dir=None):
    root = Path(project_dir) if project_dir is not None else ROOT / "examples/failure_demo"
    # Reuse the production evaluator, statistics, and UI export. No fabricated
    # outcomes and no model calls: the source files contain intentional bugs.
    report = run(use_agent=False, project_dir=root)
    summaries = []
    verified = True
    for entry in report["candidates"]:
        label, should_pass = SCENARIOS[entry["file"]]
        stats = entry.get("statistics", {})
        observed_as_expected = entry["status"] == ("pass" if should_pass else "fail")
        verified = verified and observed_as_expected
        failures = entry["failures"]
        numeric_failures = [failure for failure in failures
                            if type(failure["expected"]["value"]) in (int, float)
                            and type(failure["actual"]["value"]) in (int, float)]
        worst = max(numeric_failures, key=lambda f: abs(f["actual"]["value"] - f["expected"]["value"]), default=None)
        worst_error = abs(worst["actual"]["value"] - worst["expected"]["value"]) if worst else 0
        summary = {"file": entry["file"], "scenario": label, "status": entry["status"],
                   "verified_expected_outcome": observed_as_expected,
                   "pass_rate_percent": stats.get("pass_rate_percent"),
                   "outcome_variance": stats.get("outcome_statistics", {}).get("population_variance"),
                   "numeric_error_statistics": stats.get("numeric_error_statistics"),
                   "smallest_failing_input": entry.get("smallest_failing_input"),
                   "worst_observed_absolute_numeric_error": worst_error,
                   "first_counterexample": failures[0] if failures else None,
                   "worst_numeric_counterexample": worst}
        summaries.append(summary)
        print(f"{label}: {summary['pass_rate_percent']:.1f}% passed; "
              f"outcome variance={summary['outcome_variance']:.4f}; worst absolute error={worst_error}")
    save_json(root / "reports/demo_summary.json", {
        "is_deliberately_faulty_demo": True, "run_id": report["run_id"],
        "all_expected_outcomes_verified": verified, "scenarios": summaries,
        "notes": ["Failures are intentional and measured against the baseline, not fabricated.",
                  "Worst means worst observed in this finite suite, not a bound for arbitrary lists.",
                  "Input-mutation bugs can fail correctness while numeric error stays zero.",
                  "An always-wrong candidate has zero pass/fail variance and 0% pass rate.",
                  "Agent generation is explicitly disabled for this reproducible fixture demo."]})
    ui_path = root / "reports/ui_results.json"
    ui = json.loads(ui_path.read_text(encoding="utf-8"))
    ui["is_deliberately_faulty_demo"] = True
    ui["demo_scenarios"] = {name: label for name, (label, _) in SCENARIOS.items()}
    save_json(ui_path, ui)
    return verified


if __name__ == "__main__":
    # Exit zero means the demo detected every intended bug, not that faulty code passed.
    raise SystemExit(0 if run_demo() else 1)
