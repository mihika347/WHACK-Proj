import ast
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from optimisation_generator import generate, materialise
from test_utils import ROOT

SOURCE = '"""Demo."""\nfrom __future__ import annotations\n\ndef total(numbers):\n    answer = 0\n    for n in numbers:\n        answer += n\n    return answer\n\ndef count_matches(numbers, target):\n    return sum(1 for n in numbers if n == target)\n'


def stage(number=1, function='total', replacement='def total(numbers):\n    return sum(numbers)\n', imports=None):
    return {'stage': number, 'name': 'Optimise ' + function, 'explanation': 'Reduce Python loop overhead',
            'function': function, 'replacement': replacement, 'imports': imports or []}


class GeneratorTests(unittest.TestCase):
    def test_compact_definition_in_function_field(self):
        proposal = stage()
        proposal['function'] = proposal.pop('replacement')
        result = materialise(SOURCE, {'stages': [proposal]})
        self.assertEqual(result['stages'][0]['function'], 'total')

    def test_compact_definition_with_import_and_module_name_metadata(self):
        proposal = stage()
        proposal.pop('replacement')
        proposal['function'] = 'from itertools import accumulate\n\ndef total(numbers):\n    return sum(numbers)\n'
        proposal['imports'] = ['itertools']
        result = materialise(SOURCE, {'stages': [proposal]})
        self.assertIn('from itertools import accumulate', result['final_code'])

    def test_independent_programs_and_combined_disjoint_edits(self):
        result = materialise(SOURCE, {'stages': [stage(), stage(2, 'count_matches', 'def count_matches(numbers, target):\n    return numbers.count(target)\n')]})
        self.assertIn('answer = 0', result['stages'][1]['code'])
        self.assertIn('sum(1 for n in numbers', result['stages'][0]['code'])
        self.assertNotIn('answer = 0', result['final_code'])
        scope = {}
        exec(result['final_code'], scope)
        self.assertEqual(scope['total']([1, 2, -1]), 2)
        self.assertEqual(scope['count_matches']([0, 0, 1], 0), 2)

    def test_alternatives_are_flagged_not_stacked(self):
        result = materialise(SOURCE, {'stages': [stage(), stage(2, replacement='def total(numbers):\n    return sum(n for n in numbers)\n')]})
        self.assertEqual(result['stages'][0]['overlaps_with'], [2])
        self.assertEqual(result['combined_stages'], [1])

    def test_imports_preserve_docstring_future_and_reject_executable_statements(self):
        result = materialise(SOURCE, {'stages': [stage(imports=['import math'])]})
        tree = ast.parse(result['final_code'])
        self.assertIsInstance(tree.body[0], ast.Expr)
        self.assertEqual(tree.body[1].module, '__future__')
        with self.assertRaises(ValueError):
            materialise(SOURCE, {'stages': [stage(imports=['print("bad")'])]})
        with self.assertRaises(ValueError):
            materialise(SOURCE, {'stages': [stage(imports=['import math as total'])]})

    def test_signature_change_is_rejected(self):
        with self.assertRaises(ValueError):
            materialise(SOURCE, {'stages': [stage(replacement='def total(numbers, extra):\n    return sum(numbers)\n')]})

    def test_truncated_response_retries_and_records_finish_reason(self):
        replies = iter([SimpleNamespace(finish_reason='length', message=SimpleNamespace(content='{"stages":[')),
                        SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content=json.dumps({'stages': [stage()]})))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(choices=[next(replies)]))))
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            result = generate(client, 'mock-model', SOURCE, folder)
            self.assertEqual(len(result['stages']), 1)
            self.assertEqual(json.loads((Path(folder) / 'generation_attempt_1.json').read_text())['finish_reason'], 'length')
            self.assertTrue((Path(folder) / 'report.json').exists())

    def test_invalid_generation_does_not_overwrite_existing_files(self):
        reply = SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content='invalid'))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: reply)))
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            path = Path(folder) / 'stage_1.py'
            path.write_text('previous stage', encoding='utf-8')
            with self.assertRaises(RuntimeError):
                generate(client, 'mock-model', SOURCE, folder, attempts=1)
            self.assertEqual(path.read_text(), 'previous stage')


if __name__ == '__main__':
    unittest.main()
