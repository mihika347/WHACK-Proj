import unittest

from ui.run_inputs import PatchConflict, merge_approved, uploaded_cases


def candidate(name, start, remove, lines):
    return {"id": name, "title": name, "patches": [{"start": start, "remove": remove, "lines": lines}]}


class RunInputTests(unittest.TestCase):
    def test_build_uses_original_coordinates_and_keeps_unedited_lines(self):
        first = candidate("first", 1, 1, ["new A", "extra"])
        second = candidate("second", 3, 1, ["new C"])
        self.assertEqual(merge_approved("A\nB\nC\n", [second, first]), "new A\nextra\nB\nnew C\n")

    def test_distinct_overlapping_edits_raise_with_both_candidates(self):
        first = candidate("first", 1, 2, ["new A"])
        second = candidate("second", 2, 1, ["new B"])
        with self.assertRaises(PatchConflict) as error:
            merge_approved("A\nB\nC", [first, second])
        self.assertEqual(error.exception.candidates, ["first", "second"])

    def test_shared_edit_is_applied_once(self):
        first = candidate("first", 1, 0, ["new"])
        second = candidate("second", 1, 0, ["new"])
        self.assertEqual(merge_approved("A\n", [first, second]), "new\nA\n")

    def test_upload_keeps_large_integers_and_rejects_non_integer_types(self):
        cases = uploaded_cases(['{"cases":[{"numbers":[9007199254740993],"target":9007199254740993,"expected":1}]}'])
        self.assertEqual(cases[0]["numbers"], [9007199254740993])
        self.assertEqual(cases[0]["source"], "uploaded")
        for value in ("true", "1.0", '"1"'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                uploaded_cases([f'[{{"numbers":[{value}],"target":1}}]'])
