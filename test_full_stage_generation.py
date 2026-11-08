import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from full_stage_generation import generate_result, validate_result
from test_utils import ROOT, candidates


def response(text, finish='stop'):
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish, message=SimpleNamespace(content=text))])


class FullStageTests(unittest.TestCase):
    def client(self, responses):
        self.calls = []
        replies = iter(responses)
        def create(**kwargs):
            self.calls.append(kwargs)
            return next(replies)
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    def test_small_program_preserves_original_single_call_schema(self):
        code = 'def count_matches(numbers, target):\n    return numbers.count(target)\n'
        result = {'stages': [{'stage': 1, 'name': 'Count', 'explanation': 'Use built-in', 'code': code, 'overlaps_with': []}], 'final_code': code}
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            actual = generate_result(self.client([response(json.dumps(result))]), 'model', code, 'system', 'user', folder)
        self.assertEqual(actual, result)
        self.assertEqual(len(self.calls), 1)

    def test_large_program_generates_ten_full_independent_stages(self):
        original = 'def count_matches(numbers, target):\n    return sum(1 for n in numbers if n == target)\n'
        original += '\n'.join(f'def helper_{i}(numbers):\n    return sum(numbers) + {i}\n' for i in range(10))
        plan = {'stages': [{'stage': i+1, 'name': f'Change {i+1}', 'explanation': f'Improve helper_{i}', 'overlaps_with': []} for i in range(10)]}
        stage_codes = [original.replace(f'return sum(numbers) + {i}\n', f'return {i} + sum(numbers)\n') for i in range(10)]
        client = self.client([response(json.dumps(plan))] + [response(code) for code in stage_codes] + [response(stage_codes[0])])
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            out = Path(folder) / 'output'
            result = generate_result(client, 'model', original, 'system', 'user', out, large_input_chars=0)
            self.assertEqual(len(result['stages']), 10)
            self.assertEqual(len(self.calls), 12)
            for stage, expected in zip(result['stages'], stage_codes):
                self.assertEqual(stage['code'], expected.strip())
                (out / f"stage_{stage['stage']}.py").write_text(stage['code'], encoding='utf-8')
            (out / 'final_optimised.py').write_text(result['final_code'], encoding='utf-8')
            (out / 'report.json').write_text(json.dumps(result), encoding='utf-8')
            self.assertEqual(len(candidates(Path(folder))), 11)

    def test_truncated_response_retries_without_overwriting_outputs(self):
        code = 'def count_matches(numbers, target):\n    return 0\n'
        client = self.client([response('{"stages":[', 'length'), response('{"stages":[', 'length'), response('invalid'), response('invalid')])
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            path = Path(folder) / 'report.json'
            path.write_text('old report', encoding='utf-8')
            with self.assertRaises(RuntimeError):
                generate_result(client, 'model', code, 'system', 'user', folder)
            self.assertEqual(path.read_text(), 'old report')

    def test_invalid_last_stage_prevents_result_publication(self):
        with self.assertRaises(SyntaxError):
            validate_result({'stages': [{'stage': 1, 'name': 'x', 'explanation': 'x', 'code': 'def broken('}], 'final_code': 'x = 1'})


if __name__ == '__main__':
    unittest.main()
