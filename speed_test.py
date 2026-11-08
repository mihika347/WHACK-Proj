"""Benchmark identical fixed workloads after regenerating correctness checks."""
import argparse
import platform
import sys
from correctness_test import run as check_correctness, smallest_counterexample
from test_utils import ROOT, SEED, candidates, isolated, save_json, speed_cases
from result_stats import speed_percentages, speed_statistics
from export_results import export


def run(use_agent=True, refresh_agent=False, seed=SEED, correctness_report=None):
    correctness = correctness_report if correctness_report is not None else check_correctness(
        use_agent=use_agent, refresh_agent=refresh_agent, seed=seed)
    eligible = {c["file"] for c in correctness["candidates"] if c["status"] == "pass"}
    suite = speed_cases()
    suite_path = ROOT / "tests/speed_cases.json"
    save_json(suite_path, suite)
    baseline = ROOT / "original.py"
    expected = isolated(baseline, suite_path, "correctness")
    reference = isolated(baseline, suite_path, "speed")
    if "error" in expected or "error" in reference:
        raise RuntimeError(f"Baseline failed: {expected.get('error') or reference.get('error')}")
    report = {"schema_version": 3, "run_id": correctness["run_id"], "generated_at": correctness["generated_at"],
              "correctness_seed": seed, "seed": SEED, "python": sys.version, "platform": platform.platform(),
              "baseline_sha256": correctness["baseline_sha256"],
              "clock": "perf_counter_ns", "warmup_calls": 3, "samples": 7,
              "summary": "Median of per-workload median speedup ratios; each workload has equal weight.",
              "baseline": reference, "candidates": []}
    for path in candidates():
        correct_entry = next(c for c in correctness["candidates"] if c["file"] == path.name)
        entry = {"file": path.name, "smallest_failing_input": correct_entry.get("smallest_failing_input"),
                 "speed_by_input_size": [], "worst_observed_slowdown": None}
        if path.name not in eligible:
            entry.update(status="skipped", reason="Correctness suite did not pass")
        else:
            actual = isolated(path, suite_path, "correctness")
            if "error" in actual or actual.get("observations") != expected["observations"]:
                entry.update(status="skipped", reason="Benchmark-input correctness check failed", error=actual.get("error"))
                if "observations" in actual:
                    failures = [{"case": test, "expected": old, "actual": new}
                                for test, old, new in zip(suite, expected["observations"], actual["observations"])
                                if old != new]
                    entry["smallest_failing_input"] = smallest_counterexample(
                        baseline, path, failures, ROOT / "tests" / f"{path.stem}_benchmark_shrink_request.json")
            else:
                measured = isolated(path, suite_path, "speed")
                if "error" in measured:
                    entry.update(status="error", error=measured["error"])
                else:
                    for old, new in zip(reference["timings"], measured["timings"]):
                        new["speedup"] = old["median_seconds"] / new["median_seconds"]
                        new.update(speed_percentages(new["speedup"]))
                    entry.update(status="pass", timings=measured["timings"],
                                 statistics=speed_statistics(measured["timings"]))
                    entry["median_speedup"] = entry["statistics"]["median_speedup"]
                    worst = entry["statistics"]["worst_observed_slowdown"]
                    worst["input"] = next(test for test in suite if test["name"] == worst["workload"])
                    entry["worst_observed_slowdown"] = worst
                    entry["speed_by_input_size"] = [
                        {"input_size": size, **speed_statistics([t for t in measured["timings"] if t["size"] == size])}
                        for size in sorted({t["size"] for t in measured["timings"]})]
        report["candidates"].append(entry)
        if "statistics" in entry:
            stats = entry["statistics"]
            print(f"{path.name}: {entry['status']} ({entry['median_speedup']:.2f}x median; "
                  f"{stats['speed_increase_percent']:+.1f}% speed; "
                  f"{stats['execution_time_reduction_percent']:+.1f}% time saved)")
            for group in entry["speed_by_input_size"]:
                print(f"  size {group['input_size']}: {group['speed_increase_percent']:+.1f}% speed")
            print(f"  worst observed slowdown: {entry['worst_observed_slowdown']['slowdown_percent']:.1f}%")
        else:
            print(f"{path.name}: {entry['status']}")
    save_json(ROOT / "reports/speed_report.json", report)
    export(correctness, report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Run deterministic correctness tests without the agent")
    parser.add_argument("--refresh-agent", action="store_true", help="Regenerate agent correctness cases")
    parser.add_argument("--seed", type=int, default=SEED, help="Random correctness seed; benchmark inputs remain fixed")
    args = parser.parse_args()
    if args.offline and args.refresh_agent:
        parser.error("--offline and --refresh-agent cannot be combined")
    result = run(use_agent=not args.offline, refresh_agent=args.refresh_agent, seed=args.seed)
    raise SystemExit(0 if all(c["status"] == "pass" for c in result["candidates"]) else 1)
