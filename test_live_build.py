"""Exercise isolated UI evaluation and approved-only build assembly offline."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent / 'ui'))
from run_jobs import RunJobs
from serve import saved_run
from test_utils import save_json


class LiveBuildTests(unittest.TestCase):
    def test_run_then_build_only_selected_candidate(self):
        original = 'def count_matches(numbers, target):\n    return sum(1 for number in numbers if number == target)\n'
        replacement = 'def count_matches(numbers, target):\n    return numbers.count(target)\n'

        def fake_generation(root):
            (root / 'output').mkdir()
            (root / 'output/stage_1.py').write_text(replacement, encoding='utf-8')
            (root / 'output/final_optimised.py').write_text(replacement, encoding='utf-8')
            save_json(root / 'output/report.json', {'final_code': replacement, 'stages': [
                {'stage': 1, 'name': 'Built-in count', 'explanation': 'Use list.count', 'code': replacement}]})

        suite = [{'name': 'duplicates', 'numbers': [1, 2, 1], 'target': 1, 'category': 'short'}]
        with tempfile.TemporaryDirectory() as directory, patch('run_jobs.Thread'), patch('run_jobs.generate', fake_generation), patch('speed_test.speed_cases', return_value=suite), patch('correctness_test.generate', return_value={'cases': [{'name': 'ai_duplicates', 'numbers': [1, 1, 2], 'target': 1}]}):
            jobs = RunJobs(directory)
            job = jobs.start('custom.py', original, [])
            root = Path(directory) / job['id']
            jobs.execute(root, job, [], None, 42)
            _, status = jobs.get(job['id'])
            self.assertEqual(status['status'], 'completed', status.get('error'))
            run = saved_run(root, 'custom.py')
            self.assertEqual(len(run['candidates']), 1)
            candidate = run['candidates'][0]
            self.assertEqual(candidate['stats']['correctness_status'], 'pass')
            self.assertEqual(candidate['stats']['agent_status'], 'used')
            ai_cases = [case for suite in run['tests']['correctness'] for case in suite['cases'] if case.get('aiGenerated')]
            self.assertTrue(ai_cases)
            self.assertEqual(ai_cases[0]['targetChange'], 'Built-in count')
            # Acceptance is covered independently; timing noise must not make this test flaky.
            candidate['recommended'] = True
            selection = [f"{candidate['id']}:{candidate['stats']['source_sha256']}"]
            build = jobs.followup(root, run, 'build', [], selection)
            build_root = Path(directory) / build['id']
            self.assertEqual((build_root / 'output/final_optimised.py').read_text(), replacement)
            jobs.execute(build_root, build, [], {
                'final_optimised.py': {'cases': json.loads((root / 'tests/stage_1_correctness_cases.json').read_text()), 'agent_status': 'disabled'}}, 42)
            _, status = jobs.get(build['id'])
            self.assertEqual(status['status'], 'completed', status.get('error'))
            result = saved_run(build_root, 'custom.py', final_only=True)
            self.assertTrue(result['verified'])
            self.assertEqual(result['code'], replacement)
            with self.assertRaises(ValueError):
                jobs.followup(root, run, 'build', [], ['stage_1.py:stale-hash'])
