"""Regression checks for the evaluator itself; no LM Studio dependency."""
from pathlib import Path
import tempfile
import unittest
from test_utils import ROOT, correctness_cases, isolated, observe, save_json, speed_cases, targeted_cases


class HarnessTests(unittest.TestCase):
    def test_reproducible_integer_lists(self):
        self.assertEqual(correctness_cases(), correctness_cases())
        self.assertEqual(speed_cases(), speed_cases())
        for test in correctness_cases() + speed_cases():
            self.assertIsInstance(test["numbers"], list)
            self.assertTrue(all(type(n) is int for n in test["numbers"]))

    def test_change_targeting(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            original, modified = Path(folder) / "old.py", Path(folder) / "new.py"
            original.write_text("def count_matches(numbers, target):\n    return sum(1 for n in numbers if n == target)\n", encoding="utf-8")
            modified.write_text("def count_matches(numbers, target):\n    return list(set(numbers)).count(target)\n", encoding="utf-8")
            result = targeted_cases(original, modified)
            self.assertIn("deduplication", result["rules"])
            self.assertIn("list_count_replacement", result["rules"])
            self.assertTrue(any(c["numbers"] == [2] * 100 for c in result["cases"]))

    def test_wrong_counts_and_input_mutation(self):
        test = {"numbers": [3, 1, 3], "target": 3}
        reference = observe(lambda ns, t: ns.count(t), test)
        self.assertNotEqual(reference, observe(lambda ns, t: list(set(ns)).count(t), test))
        def mutated(numbers, target):
            numbers.sort()
            return numbers.count(target)
        self.assertNotEqual(reference, observe(mutated, test))
        self.assertEqual(test["numbers"], [3, 1, 3])

    def test_output_and_exceptions(self):
        def noisy(numbers, target):
            print("unexpected")
            return 0
        test = {"numbers": [], "target": 0}
        self.assertNotEqual(observe(lambda ns, t: 0, test), observe(noisy, test))
        self.assertEqual(observe(lambda ns, t: 1 / 0, test)["exception"]["type"], "ZeroDivisionError")

    def test_worker_errors_and_timeout(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            program, suite = Path(folder) / "program.py", Path(folder) / "suite.json"
            save_json(suite, [{"name": "empty", "numbers": [], "target": 0}])
            program.write_text("def count_matches(numbers, target):\n    while True: pass\n", encoding="utf-8")
            self.assertIn("exceeded", isolated(program, suite, "correctness", timeout=1)["error"])
            program.write_text("raise RuntimeError('import failed')\n", encoding="utf-8")
            self.assertIn("import failed", isolated(program, suite, "correctness")["error"])


if __name__ == "__main__":
    unittest.main()
