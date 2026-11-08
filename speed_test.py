"""Benchmark identical fixed workloads after regenerating correctness checks."""
import argparse
import platform
import sys
from correctness_test import run as check_correctness
from test_utils import ROOT, SEED, candidates, isolated, save_json, speed_cases
from result_stats import speed_percentages, speed_statistics
from export_results import export, attach_scores
from stage_scoring import validate_threshold


def run(use_agent=True, refresh_agent=False, seed=SEED, score_threshold=70):
    score_threshold = validate_threshold(score_threshold)
    correctness = check_correctness(use_agent=use_agent, refresh_agent=refresh_agent, seed=seed)
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
              "summary": "Median percentage speed increase, population variance of percentage changes across workloads, and worst observed speed.",
              "baseline": reference, "candidates": []}
    for path in candidates():
        entry = {"file": path.name, "speed_increase_percent": None,
                 "speed_change_variance_pp_squared": None, "worst_observed_speed": None}
        if path.name not in eligible:
            entry.update(status="skipped", reason="Correctness suite did not pass")
        else:
            actual = isolated(path, suite_path, "correctness")
            if "error" in actual or actual.get("observations") != expected["observations"]:
                entry.update(status="skipped", reason="Benchmark-input correctness check failed", error=actual.get("error"))
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
                    stats = entry["statistics"]
                    for field in ("speed_increase_percent", "mean_speed_increase_percent", "speed_change_variance_pp_squared", "worst_observed_speed", "slowest_observed_workload"):
                        entry[field] = stats[field]
                    for field in ("worst_observed_speed", "slowest_observed_workload"):
                        entry[field]["input"] = next(test for test in suite if test["name"] == entry[field]["workload"])
        report["candidates"].append(entry)
        if "statistics" in entry:
            stats = entry["statistics"]
            worst = stats['worst_observed_speed']
            print(f"{path.name}: {entry['status']} | speed increase {stats['speed_increase_percent']:+.1f}% | "
                  f"change variance {stats['speed_change_variance_pp_squared']:.2f} pp^2")
            print(f"  Worst observed speed: {worst['speed_increase_percent']:+.1f}% on {worst['workload']}; "
                  f"{worst['candidate_median_seconds'] * 1e6:.3f} us per call")
        else:
            print(f"{path.name}: {entry['status']}")
    save_json(ROOT / "reports/speed_report.json", report)
    ui = export(correctness, report, score_threshold=score_threshold)
    attach_scores(report, ui)
    save_json(ROOT / "reports/speed_report.json", report)
    for stage in ui["stage_ranking"]:
        print(f"  Rank {stage['rank']}: {stage['stage']} = {stage['stage_score']:.2f}/100" + (" [KEY STAGE]" if stage["is_key_stage"] else ""))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Run deterministic correctness tests without the agent")
    parser.add_argument("--refresh-agent", action="store_true", help="Regenerate agent correctness cases")
    parser.add_argument("--seed", type=int, default=SEED, help="Random correctness seed; benchmark inputs remain fixed")
    parser.add_argument('--score-threshold', type=validate_threshold, default=70)
    args = parser.parse_args()
    if args.offline and args.refresh_agent:
        parser.error("--offline and --refresh-agent cannot be combined")
    result = run(use_agent=not args.offline, refresh_agent=args.refresh_agent, seed=args.seed, score_threshold=args.score_threshold)
    raise SystemExit(0 if all(c["status"] == "pass" for c in result["candidates"]) else 1)
