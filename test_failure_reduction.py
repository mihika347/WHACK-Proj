"""Counterexample reduction and meaningful worst-workload reporting."""
import unittest
from shrink_failure import reduce_failure
from test_utils import observe
from result_stats import correctness_statistics, speed_statistics, speed_percentages


class ReductionTests(unittest.TestCase):
    def reduction(self, numbers, target, wrong, **options):
        correct = lambda ns, t: ns.count(t)
        case = {"numbers": numbers, "target": target}
        pair = lambda test: (observe(correct, test), observe(wrong, test))
        old, new = pair(case)
        return reduce_failure({"case": case, "expected": old, "actual": new}, pair, **options)

    def test_duplicate_bug_shrinks_to_two_matches(self):
        result = self.reduction([9] * 50 + [1, 2], 9, lambda ns, t: list(set(ns)).count(t))
        self.assertEqual(result["case"]["numbers"], [9, 9])
        self.assertEqual(result["case"]["target"], 9)
        self.assertTrue(result["single_deletion_minimal"])
        self.assertNotEqual(result["expected"], result["actual"])

    def test_always_wrong_can_fail_on_empty_input(self):
        result = self.reduction([1, 2, 3], 2, lambda ns, t: ns.count(t) + 1)
        self.assertEqual(result["case"]["numbers"], [])

    def test_input_mutation_preserves_failure_type(self):
        def wrong(ns, t):
            ns.sort()
            return ns.count(t)
        result = self.reduction([3, 2, 1], 1, wrong)
        self.assertEqual(result["input_size"], 2)
        self.assertEqual(result["expected"]["value"], result["actual"]["value"])
        self.assertNotEqual(result["expected"]["numbers_after"], result["actual"]["numbers_after"])

    def test_budget_does_not_claim_minimality(self):
        result = self.reduction([1, 1], 1, lambda ns, t: 0, max_evaluations=0)
        self.assertTrue(result["budget_exhausted"])
        self.assertFalse(result["single_deletion_minimal"])
        self.assertEqual(result["input_size"], 2)

    def test_worst_slowdown_and_no_slowdown(self):
        def timing(name, ratio):
            return {"name": name, "size": 100, "speedup": ratio, "median_seconds": 1 / ratio, **speed_percentages(ratio)}
        worst = speed_statistics([timing("fast", 4), timing("slow", .25)])["worst_observed_slowdown"]
        self.assertEqual(worst["workload"], "slow")
        self.assertEqual(worst["slowdown_percent"], 300)
        self.assertTrue(worst["is_slowdown"])
        worst = speed_statistics([timing("fast", 4)])["worst_observed_slowdown"]
        self.assertEqual(worst["slowdown_percent"], 0)
        self.assertFalse(worst["is_slowdown"])

    def test_correctness_by_exact_input_size(self):
        rows = [{"input_size": size, "passed": passed, "numeric_error": 0,
                 "source": "shared", "category": "test"} for size, passed in [(0, True), (2, False), (2, True)]]
        groups = correctness_statistics(rows)["by_input_size"]
        self.assertEqual(groups[0]["pass_rate_percent"], 100)
        self.assertEqual(groups[1]["pass_rate_percent"], 50)


if __name__ == "__main__":
    unittest.main()
