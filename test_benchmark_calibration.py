import unittest
from test_utils import benchmark_repetitions


class BenchmarkCalibrationTests(unittest.TestCase):
    def test_expensive_calls_are_not_repeated_in_large_batches(self):
        self.assertEqual(benchmark_repetitions(0.1), 1)
        self.assertEqual(benchmark_repetitions(0.001), 5)

    def test_fast_calls_keep_bounded_batches(self):
        self.assertEqual(benchmark_repetitions(0.000001), 200)
        self.assertEqual(benchmark_repetitions(0), 200)
