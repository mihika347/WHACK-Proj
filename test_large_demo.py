"""Verify the large demo against a separately written implementation."""
import itertools
from pathlib import Path
import unittest

from test_utils import ROOT, correctness_cases, load_function, observe, speed_cases


class LargeDemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        folder = ROOT / 'examples/large_demo'
        cls.baseline = staticmethod(load_function(folder / 'original.py'))
        cls.reference = staticmethod(load_function(folder / 'optimised_reference.py'))

    def test_known_outputs(self):
        for numbers, target, expected in [([], 0, 0), ([0], 0, 104), ([1], 1, 111), ([0, 0], 0, 265)]:
            self.assertEqual(self.baseline(numbers, target), expected)
            self.assertEqual(self.reference(numbers, target), expected)

    def test_shared_random_boundary_and_speed_inputs(self):
        for case in correctness_cases() + speed_cases():
            with self.subTest(name=case['name']):
                old, new = observe(self.baseline, case), observe(self.reference, case)
                self.assertEqual(old, new)
                self.assertIsNone(old['exception'])
                self.assertEqual(old['value_type'], 'int')
                self.assertEqual(old['numbers_after'], case['numbers'])

    def test_exhaustive_short_lists(self):
        for size in range(5):
            for values in itertools.product([-1, 0, 1], repeat=size):
                for target in [-2, -1, 0, 1, 2]:
                    numbers = list(values)
                    self.assertEqual(self.baseline(numbers, target), self.reference(numbers, target))

    def test_sample_boundary_and_full_list_effects(self):
        for size in [7, 8, 9, 63, 64, 65, 128]:
            for numbers in ([0] * size, [3] * size, list(range(-size, size))):
                self.assertEqual(self.baseline(numbers, 0), self.reference(numbers, 0))
        before = self.baseline([1] * 64 + [2], 7)
        after = self.baseline([1] * 64 + [3], 7)
        self.assertNotEqual(before, after)


if __name__ == '__main__':
    unittest.main()
