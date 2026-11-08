import json
import io
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import gpu_runtime

SETTINGS = {'enabled': True, 'identifier': 'whack-nvidia', 'model_key': 'openai/gpt-oss-20b',
            'gpu_offload': '0.5', 'context_length': 8192, 'parallel': 1,
            'cuda_runtime': 'llama.cpp-nvidia-cuda@1'}


class GpuTests(unittest.TestCase):
    def test_windows_console_handles_unicode_cli_output(self):
        buffer = io.BytesIO()
        stream = io.TextIOWrapper(buffer, encoding='cp1252', write_through=True)
        with patch.object(gpu_runtime.sys, 'stdout', stream):
            gpu_runtime.console('✓ model loaded')
        self.assertIn(b'model loaded', buffer.getvalue())

    def test_disabled_does_not_touch_runtime(self):
        with patch.object(gpu_runtime, 'run_lms') as call:
            self.assertIsNone(gpu_runtime.ensure_model({'enabled': False}))
            call.assert_not_called()

    def test_existing_dedicated_model_is_reused(self):
        with patch.object(gpu_runtime, 'run_lms', return_value=json.dumps([{'identifier': 'whack-nvidia'}])) as call:
            self.assertEqual(gpu_runtime.ensure_model(SETTINGS), 'whack-nvidia')
            self.assertEqual(call.call_count, 1)

    def test_load_uses_cuda_and_does_not_unload_other_models(self):
        calls = []
        def fake(args):
            calls.append(args)
            if args == ['ps', '--json']:
                return json.dumps([{'identifier': 'other', 'modelKey': 'other-model', 'status': 'idle'}])
            if args == ['runtime', 'ls']:
                return 'llama.cpp-nvidia-cuda@1 ✓'
            return 'loaded'
        with patch.object(gpu_runtime, 'run_lms', side_effect=fake):
            gpu_runtime.ensure_model(SETTINGS)
        self.assertFalse(any(args[0] == 'unload' for args in calls))
        load = next(args for args in calls if args[0] == 'load')
        self.assertIn('0.5', load)
        self.assertEqual(load[load.index('--parallel') + 1], '1')

    def test_busy_model_is_not_unloaded(self):
        def fake(args):
            if args == ['ps', '--json']:
                return json.dumps([{'identifier': 'old', 'modelKey': SETTINGS['model_key'], 'status': 'generating'}])
            return 'llama.cpp-nvidia-cuda@1 ✓'
        with patch.object(gpu_runtime, 'run_lms', side_effect=fake) as call:
            with self.assertRaisesRegex(RuntimeError, 'active requests'):
                gpu_runtime.ensure_model(SETTINGS)
            self.assertFalse(any(c.args[0][0] == 'unload' for c in call.call_args_list))


if __name__ == '__main__':
    unittest.main()
