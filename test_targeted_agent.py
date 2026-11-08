"""Check context isolation, generated-data validation, caching, and execution."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import correctness_test
from targeted_test_agent import generate, validate_response
from test_utils import ROOT, isolated, save_json


def response_cases():
    return {"analysis": "Deduplication may lose repeated occurrences", "cases": [
        {"name": f"duplicates_{n}", "numbers": [2] * n, "target": 2,
         "reason": "set removes duplicate matches"} for n in range(1, 9)]}


class AgentTests(unittest.TestCase):
    def test_validation_rejects_non_integer_and_executable_inputs(self):
        for invalid in [True, 1.5, "1", "__import__('os')", None]:
            value = response_cases()
            value["cases"][0]["numbers"] = [invalid]
            with self.assertRaises(ValueError):
                validate_response(value)
        value = response_cases()
        value["cases"][0]["target"] = True
        with self.assertRaises(ValueError):
            validate_response(value)

    def test_rejects_missing_reasons_and_duplicate_only_suites(self):
        value = response_cases()
        value["cases"][0].pop("reason")
        with self.assertRaises(ValueError):
            validate_response(value)
        value = response_cases()
        value["cases"] = [value["cases"][0]] * 8
        with self.assertRaises(ValueError):
            validate_response(value)

    def test_fresh_context_cache_invalidation_and_real_counterexample(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            original, candidate = root / "original.py", root / "stage.py"
            original.write_text("def count_matches(numbers, target):\n    return numbers.count(target)\n", encoding="utf-8")
            candidate.write_text("def count_matches(numbers, target):\n    return list(set(numbers)).count(target)\n", encoding="utf-8")
            calls = []
            def fake(method, route, body=None):
                calls.append((method, route, body))
                if route == "/models":
                    return {"data": [{"id": "independent-reviewer"}]}
                messages = body["messages"]
                self.assertEqual([m["role"] for m in messages], ["system", "user"])
                self.assertEqual(json.loads(messages[1]["content"]), {
                    "original_code": original.read_text(encoding="utf-8"),
                    "candidate_code": candidate.read_text(encoding="utf-8")})
                return {"choices": [{"message": {"content": json.dumps(response_cases())}}]}
            result = generate(original, candidate, request_fn=fake, cache_dir=root / "cache")
            self.assertFalse(result["cached"])
            count = len(calls)
            cached = generate(original, candidate, request_fn=fake, cache_dir=root / "cache")
            self.assertTrue(cached["cached"])
            self.assertEqual(cached["cases"], result["cases"])
            self.assertEqual(len(calls), count)
            final = root / "final.py"
            final.write_text(candidate.read_text(encoding="utf-8"), encoding="utf-8")
            self.assertTrue(generate(original, final, request_fn=fake, cache_dir=root / "cache")["cached"])
            self.assertEqual(len(calls), count)
            suite = root / "cases.json"
            save_json(suite, result["cases"])
            old, new = isolated(original, suite, "correctness"), isolated(candidate, suite, "correctness")
            self.assertNotEqual(old["observations"], new["observations"])
            candidate.write_text(candidate.read_text(encoding="utf-8") + "\n# changed\n", encoding="utf-8")
            self.assertNotEqual(result["fingerprint"], generate(original, candidate, request_fn=fake, cache_dir=root / "cache")["fingerprint"])

    def test_agent_failure_is_not_reported_as_a_pass(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            original, candidate = root / "original.py", root / "stage.py"
            code = "def count_matches(numbers, target):\n    return numbers.count(target)\n"
            original.write_text(code, encoding="utf-8")
            candidate.write_text(code, encoding="utf-8")
            with patch.object(correctness_test, "ROOT", root), patch.object(correctness_test, "candidates", return_value=[candidate]), patch.object(correctness_test, "generate", side_effect=ValueError("invalid JSON")):
                report = correctness_test.run(use_agent=True)
            entry = report["candidates"][0]
            self.assertEqual(entry["status"], "error")
            self.assertEqual(entry["agent_status"], "error")
            self.assertEqual(entry["agent_cases"], 0)

    def test_interrupt_preserves_completed_stage_checkpoint(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            original = root / 'original.py'
            first, second = root / 'stage_1.py', root / 'stage_2.py'
            code = 'def count_matches(numbers, target):\n    return numbers.count(target)\n'
            for path in [original, first, second]:
                path.write_text(code, encoding='utf-8')
            with patch.object(correctness_test, 'ROOT', root), patch.object(correctness_test, 'candidates', return_value=[first, second]), patch.object(correctness_test, 'generate', side_effect=[response_cases(), KeyboardInterrupt()]):
                with self.assertRaises(KeyboardInterrupt):
                    correctness_test.run(use_agent=True)
            saved = json.loads((root / 'reports/correctness_report.json').read_text())
            self.assertFalse(saved['complete'])
            self.assertEqual(saved['pending_candidates'], ['stage_2.py'])
            self.assertEqual(saved['candidates'][0]['status'], 'pass')

    def test_unsupported_schema_and_invalid_json_retry_with_fresh_context(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            original, candidate = root / "original.py", root / "stage.py"
            for path in (original, candidate):
                path.write_text("def count_matches(numbers, target):\n    return numbers.count(target)\n", encoding="utf-8")
            requests = []
            def fake(method, route, body=None):
                if route == "/models":
                    return {"data": [{"id": "reviewer"}]}
                requests.append(body)
                self.assertEqual(len(body["messages"]), 2)
                if len(requests) == 1:
                    raise RuntimeError("LM Studio HTTP 400: failed to parse grammar")
                if len(requests) == 2:
                    return {"choices": [{"message": {"content": "invalid response marker"}}]}
                self.assertNotIn("invalid response marker", str(body["messages"]))
                return {"choices": [{"message": {"content": json.dumps(response_cases())}}]}
            with patch('targeted_test_agent.STRUCTURED_OUTPUT', True):
                result = generate(original, candidate, request_fn=fake, cache_dir=root / "cache")
            self.assertEqual(len(requests), 3)
            self.assertIn("response_format", requests[0])
            self.assertNotIn("response_format", requests[1])
            self.assertFalse(result["structured_output"])
            self.assertEqual(len(result["generation_errors"]), 2)

    def test_default_run_never_calls_agent(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            original, candidate = root / 'original.py', root / 'stage_1.py'
            for path in [original, candidate]:
                path.write_text('def count_matches(numbers, target):\n    return numbers.count(target)\n', encoding='utf-8')
            with patch.object(correctness_test, 'ROOT', root), patch.object(correctness_test, 'candidates', return_value=[candidate]), patch.object(correctness_test, 'generate', side_effect=AssertionError('Agent should not run')) as agent:
                report = correctness_test.run()
                agent.assert_not_called()
            self.assertEqual(report['candidates'][0]['status'], 'pass')
            self.assertEqual(report['candidates'][0]['agent_status'], 'disabled')


if __name__ == "__main__":
    unittest.main()
