"""Export matching reports as JSON chart series and simple CSV tables."""
import argparse
import csv
import json
from pathlib import Path

from result_stats import speed_statistics
from test_utils import ROOT, save_json


def write_csv(path, rows, fields):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def export(correctness, speed=None, output_dir=None):
    if speed is not None and speed["run_id"] != correctness["run_id"]:
        raise ValueError("Correctness and speed reports belong to different runs; rerun speed_test.py")
    destination = Path(output_dir) if output_dir is not None else ROOT / "reports"
    destination.mkdir(parents=True, exist_ok=True)
    speed_entries = {entry["file"]: entry for entry in speed["candidates"]} if speed else {}
    summary, workloads, case_rows, category_rows, source_rows, size_rows = [], [], [], [], [], []
    seen_hashes = {}
    for candidate in correctness["candidates"]:
        name = candidate["file"]
        stats = candidate.get("statistics", {})
        error_stats = stats.get("numeric_error_statistics", {})
        timing = speed_entries.get(name, {})
        timing_stats = timing.get("statistics", {})
        digest = candidate.get("source_sha256")
        identical_to = seen_hashes.get(digest) if digest else None
        if digest:
            seen_hashes.setdefault(digest, name)
        row = {"stage": name, "source_sha256": digest, "identical_to": identical_to,
               "correctness_status": candidate["status"], "speed_status": timing.get("status", "not_run"),
               "agent_status": candidate.get("agent_status"),
               "total_cases": candidate.get("total"), "passed_cases": stats.get("passed"), "failed_cases": stats.get("failed"),
               "pass_rate_percent": stats.get("pass_rate_percent"),
               "pass_mean": stats.get("outcome_statistics", {}).get("mean"),
               "pass_population_variance": stats.get("outcome_statistics", {}).get("population_variance"),
               "numeric_error_mean": error_stats.get("mean"),
               "numeric_error_population_variance": error_stats.get("population_variance"),
               "mean_absolute_error": error_stats.get("mean_absolute_error"),
               "mean_squared_error": error_stats.get("mean_squared_error"),
               "root_mean_squared_error": error_stats.get("root_mean_squared_error"),
               "geometric_mean_speedup": timing_stats.get("geometric_mean_speedup"),
               "speed_increase_percent": timing_stats.get("speed_increase_percent"),
               "execution_time_reduction_percent": timing_stats.get("execution_time_reduction_percent"),
               "mean_workload_median_us": timing_stats.get("workload_median_seconds", {}).get("mean", 0) * 1e6 if timing_stats else None}
        summary.append(row)
        case_rows.extend({"stage": name, **case} for case in candidate.get("case_results", []))
        category_rows.extend({"stage": name, **group} for group in stats.get("by_category", []))
        source_rows.extend({"stage": name, **group} for group in stats.get("by_source", []))
        if timing.get("status") == "pass":
            baseline = {t["name"]: t for t in speed["baseline"]["timings"]}
            for test in timing["timings"]:
                distribution = test["timing_statistics_seconds"]
                workloads.append({"stage": name, "workload": test["name"], "input_size": test["size"],
                                  "baseline_median_us": baseline[test["name"]]["median_seconds"] * 1e6,
                                  "median_us": test["median_seconds"] * 1e6,
                                  "mean_us": distribution["mean"] * 1e6,
                                  "population_variance_us_squared": distribution["population_variance"] * 1e12,
                                  "standard_deviation_us": distribution["standard_deviation"] * 1e6,
                                  "min_us": distribution["min"] * 1e6, "max_us": distribution["max"] * 1e6,
                                  "p05_us": distribution["p05"] * 1e6, "p95_us": distribution["p95"] * 1e6,
                                  "sample_count": distribution["count"],
                                  "samples_us": [sample * 1e6 for sample in test["samples_seconds"]],
                                  "speedup": test["speedup"], "speed_increase_percent": test["speed_increase_percent"],
                                  "execution_time_reduction_percent": test["execution_time_reduction_percent"]})
            for size in sorted({test["size"] for test in timing["timings"]}):
                size_rows.append({"stage": name, "input_size": size,
                                  **speed_statistics([test for test in timing["timings"] if test["size"] == size])})
    data = {"schema_version": 1, "run_id": correctness["run_id"], "generated_at": correctness["generated_at"],
            "has_speed_results": speed is not None, "seed": correctness["seed"],
            "baseline_sha256": correctness["baseline_sha256"],
            "environment": {"python": speed.get("python"), "platform": speed.get("platform")} if speed else None,
            "definitions": {
                "speed_increase_percent": "100 * (baseline_time / candidate_time - 1); negative means slower",
                "execution_time_reduction_percent": "100 * (1 - candidate_time / baseline_time); negative means longer execution",
                "aggregate_speed": "Equal-workload geometric mean of median speedup ratios; not total elapsed time",
                "pass_population_variance": "Population variance of case outcomes (pass=1, fail=0), p*(1-p); not a correctness guarantee",
                "numeric_error": "Candidate minus baseline scalar return value; exceptions and non-finite/non-numeric outputs excluded",
                "timing_variance": "Population variance of per-call batch timing samples; UI units are microseconds squared",
                "p05_p95": "Interpolated empirical timing percentiles, not confidence bounds",
                "missing_values": "null means not measured or not applicable; do not plot missing values as zero",
                "correctness_groups": "Candidate-specific suites differ; use the shared source group for like-for-like comparisons",
                "duplicate_code": "identical_to marks byte-identical code; measured speed differences between those files are noise",
                "coverage": "Case counts include repeated inputs across coverage sources; passing finite tests does not prove equivalence"},
            "summary": summary, "charts": {
                "speed_comparison": [{"stage": r["stage"], "speed_increase_percent": r["speed_increase_percent"],
                                      "execution_time_reduction_percent": r["execution_time_reduction_percent"]} for r in summary],
                "correctness_comparison": [{"stage": r["stage"], "pass_rate_percent": r["pass_rate_percent"],
                                            "pass_population_variance": r["pass_population_variance"],
                                            "mean_absolute_error": r["mean_absolute_error"]} for r in summary],
                "correctness_by_category": category_rows, "correctness_by_source": source_rows,
                "speed_by_input_size": size_rows, "speed_by_workload": workloads},
            "correctness_case_results": case_rows}
    save_json(destination / "ui_results.json", data)
    summary_fields = list(summary[0]) if summary else ["stage"]
    write_csv(destination / "summary.csv", summary, summary_fields)
    write_csv(destination / "speed_workloads.csv", workloads, ["stage", "workload", "input_size", "baseline_median_us",
              "median_us", "mean_us", "population_variance_us_squared", "standard_deviation_us", "p05_us", "p95_us",
              "sample_count", "speedup", "speed_increase_percent", "execution_time_reduction_percent"])
    write_csv(destination / "correctness_cases.csv", case_rows,
              ["stage", "case_index", "name", "source", "category", "input_size", "passed", "numeric_error", "mismatch_fields"])
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--correctness-only", action="store_true", help="Export without loading a speed report")
    args = parser.parse_args()
    correctness = json.loads((ROOT / "reports/correctness_report.json").read_text(encoding="utf-8"))
    speed = None if args.correctness_only else json.loads((ROOT / "reports/speed_report.json").read_text(encoding="utf-8"))
    export(correctness, speed)
    print("Wrote reports/ui_results.json and CSV tables")
