"""Statistical formulas, failed candidates, and UI export consistency."""
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from export_results import export
from result_stats import correctness_statistics, describe, numeric_error, speed_percentages, speed_statistics
import test_utils


def rows(outcomes, errors):
    return [{"passed": outcome, "numeric_error": error, "source": "shared", "category": "duplicates"}
            for outcome, error in zip(outcomes, errors)]


class StatisticsTests(unittest.TestCase):
    def test_known_distribution_and_empty_values(self):
        summary = describe([1, 2, 3, 4])
        self.assertNotIn("mean", summary)
        self.assertEqual(summary["median"], 2.5)
        self.assertEqual(summary["population_variance"], 1.25)
        self.assertEqual(summary["standard_deviation"], math.sqrt(1.25))
        self.assertEqual(describe([])["median"], None)

    def test_mixed_correctness_and_numeric_errors(self):
        result = correctness_statistics(rows([True, False, True, False], [0, -2, 0, 2]))
        self.assertEqual(result["pass_rate_percent"], 50)
        self.assertNotIn("mean", result["outcome_statistics"])
        self.assertEqual(result["outcome_statistics"]["population_variance"], .25)
        numeric = result["numeric_error_statistics"]
        self.assertEqual(numeric["median"], 0)
        self.assertEqual(numeric["population_variance"], 2)
        self.assertEqual(numeric["max_absolute_error"], 2)
        self.assertEqual(result["by_source"][0]["failed"], 2)

    def test_all_pass_and_all_fail_both_have_zero_outcome_variance(self):
        for outcome, rate in [(True, 100), (False, 0)]:
            result = correctness_statistics(rows([outcome] * 3, [None] * 3))
            self.assertEqual(result["outcome_statistics"]["population_variance"], 0)
            self.assertEqual(result["pass_rate_percent"], rate)
            self.assertIsNone(result["numeric_error_statistics"]["max_absolute_error"])

    def test_percentage_speed_and_time_are_different(self):
        self.assertEqual(speed_percentages(2), {"speed_increase_percent": 100, "execution_time_reduction_percent": 50})
        self.assertEqual(speed_percentages(.5), {"speed_increase_percent": -50, "execution_time_reduction_percent": -100})
        timings = [{"speedup": n, "median_seconds": 1 / n, **speed_percentages(n)} for n in [2, .5]]
        self.assertEqual(speed_statistics(timings)["median_speedup"], 1.25)
        self.assertEqual(speed_statistics(timings)["worst_observed_slowdown"]["slowdown_percent"], 100)

    def test_numeric_errors_exclude_exceptions_booleans_and_nonfinite_values(self):
        observation = {"exception": None, "value": 4}
        for value in [True, "4", float("inf")]:
            self.assertIsNone(numeric_error(observation, {"exception": None, "value": value}))
        self.assertIsNone(numeric_error(observation, {"exception": "ValueError", "value": 4}))

    def test_export_missing_speed_is_null_and_reports_must_match(self):
        report = {"run_id": "one", "generated_at": "2026-11-08T00:00:00+00:00", "seed": 1,
                  "baseline_sha256": "baseline", "candidates": [
                      {"file": "bad.py", "status": "error", "agent_status": "error"}]}
        with tempfile.TemporaryDirectory(dir=test_utils.ROOT) as folder:
            data = export(report, output_dir=folder)
            self.assertIsNone(data["summary"][0]["speed_increase_percent"])
            self.assertIsNone(data["summary"][0]["pass_rate_percent"])
            self.assertFalse(data["has_speed_results"])
            self.assertTrue((Path(folder) / "summary.csv").exists())
            with self.assertRaises(ValueError):
                export(report, {"run_id": "two"}, output_dir=folder)

    def test_successful_export_units_and_identical_code_marker(self):
        correctness = {"run_id": "one", "generated_at": "2026-11-08T00:00:00+00:00", "seed": 1,
                       "baseline_sha256": "baseline", "candidates": []}
        timing = {"name": "random_100_present", "size": 100, "median_seconds": 2e-6,
                  "samples_seconds": [1e-6, 3e-6], "timing_statistics_seconds": describe([1e-6, 3e-6]),
                  "speedup": 2, **speed_percentages(2)}
        speed = {"run_id": "one", "baseline": {"timings": [{"name": timing["name"], "median_seconds": 4e-6}]},
                 "candidates": []}
        for name in ["stage_1.py", "final.py"]:
            correctness["candidates"].append({"file": name, "source_sha256": "same-code", "status": "pass",
                                               "statistics": correctness_statistics(rows([True], [0]))})
            speed["candidates"].append({"file": name, "status": "pass", "statistics": speed_statistics([timing]),
                                        "timings": [timing]})
        with tempfile.TemporaryDirectory(dir=test_utils.ROOT) as folder:
            data = export(correctness, speed, output_dir=folder)
            sample = data["charts"]["speed_by_workload"][0]
            self.assertEqual(sample["median_us"], 2)
            self.assertAlmostEqual(sample["population_variance_us_squared"], 1)
            self.assertEqual(sample["speed_increase_percent"], 100)
            self.assertEqual(sample["execution_time_reduction_percent"], 50)
            self.assertEqual(data["summary"][1]["identical_to"], "stage_1.py")
            def check_no_means(value):
                if isinstance(value, dict):
                    for key, item in value.items():
                        self.assertNotIn("mean", key)
                        check_no_means(item)
                elif isinstance(value, list):
                    for item in value:
                        check_no_means(item)
            check_no_means(data)

    def test_manifest_excludes_old_stages_and_rejects_mismatched_code(self):
        with tempfile.TemporaryDirectory(dir=test_utils.ROOT) as folder:
            root = Path(folder)
            (root / "output").mkdir()
            for name in ["stage_1.py", "stage_2.py", "final_optimised.py"]:
                (root / "output" / name).write_text("x = 1\n", encoding="utf-8")
            test_utils.save_json(root / "output/report.json", {
                "stages": [{"stage": 1, "code": "x = 1\n"}], "final_code": "x = 1\n"})
            with patch.object(test_utils, "ROOT", root):
                self.assertEqual([p.name for p in test_utils.candidates()], ["stage_1.py", "final_optimised.py"])
                (root / "output/stage_1.py").write_text("x = 2\n", encoding="utf-8")
                with self.assertRaises(ValueError):
                    test_utils.candidates()


if __name__ == "__main__":
    unittest.main()
