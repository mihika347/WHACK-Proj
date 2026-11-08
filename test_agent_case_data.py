import json
import subprocess
import unittest
from unittest.mock import patch
from agent_case_data import decode_cases
from targeted_test_agent import generate_isolated


class DataTests(unittest.TestCase):
    def test_literal_json_and_fences(self):
        self.assertEqual(decode_cases('```json\n{"numbers":[0,-1]}\n```')[0]['numbers'], [0,-1])

    def test_bounded_shorthand_from_real_failure(self):
        value, mode = decode_cases('{"numbers":[i for i in range(70)],"target":10**6}')
        self.assertEqual(value['numbers'], list(range(70)))
        self.assertEqual(value['target'], 1000000)
        self.assertEqual(mode, 'bounded_data')
        self.assertEqual(decode_cases('{"numbers":[0]*64 + [-1,1],"target":0}')[0]['numbers'], [0]*64+[-1,1])
        self.assertEqual(decode_cases('{"numbers":list(range(-3,4)),"target":0}')[0]['numbers'], list(range(-3,4)))

    def test_rejects_code_and_oversized_expressions(self):
        for text in ['{"numbers":__import__("os").getcwd()}', '{"numbers":open("secret")}',
                     '{"numbers":[0]*1000000000}', '{"numbers":[i for i in range(10000000)]}',
                     '{"numbers":[10**1000000]}', '{"numbers":[x for x in range(3) if x]}']:
            with self.assertRaises((ValueError, SyntaxError)):
                decode_cases(text)

    def test_worker_hard_timeout_is_clear(self):
        with patch('targeted_test_agent.subprocess.run', side_effect=subprocess.TimeoutExpired('worker', 1)):
            with self.assertRaisesRegex(RuntimeError, 'exceeded'):
                generate_isolated('original.py', 'output/stage_1.py')


if __name__ == '__main__':
    unittest.main()
