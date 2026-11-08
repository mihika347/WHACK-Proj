"""LM Studio CUDA setup; Python test workloads remain ordinary CPU programs."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def console(text):
    encoding = sys.stdout.encoding or 'utf-8'
    print(str(text).encode(encoding, errors='replace').decode(encoding), flush=True)


def config():
    return json.loads((ROOT / 'gpu_runtime.json').read_text(encoding='utf-8'))


def run_lms(args):
    executable = shutil.which('lms') or str(Path.home() / '.lmstudio/bin/lms.exe')
    response = subprocess.run([executable, *args], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=240)
    if response.returncode:
        raise RuntimeError('LM Studio: ' + (response.stderr.strip() or response.stdout.strip()))
    return response.stdout.strip()


def ensure_model(settings=None, reload=False):
    settings = settings or config()
    if not settings.get('enabled'):
        return None
    loaded = json.loads(run_lms(['ps', '--json']))
    current = next((m for m in loaded if m.get('identifier') == settings['identifier']), None)
    if current and not reload:
        print(f"Using configured GPU model: {settings['identifier']}", flush=True)
        return settings['identifier']
    # A CPU-only runtime must not silently masquerade as GPU acceleration.
    runtimes = run_lms(['runtime', 'ls'])
    if settings['cuda_runtime'] not in runtimes:
        raise RuntimeError('Configured CUDA runtime is not installed. Check lms runtime ls and gpu_runtime.json.')
    selected = [line for line in runtimes.splitlines() if '✓' in line]
    if not any('cuda' in line.lower() for line in selected):
        run_lms(['runtime', 'select', settings['cuda_runtime']])
    # Only unload the same model, and only when idle. Other models are untouched.
    for model in loaded:
        if model.get('modelKey') == settings['model_key'] or model.get('identifier') == settings['identifier']:
            if model.get('status') != 'idle' or model.get('queued', 0):
                raise RuntimeError('Model has active requests; finish them before applying GPU settings.')
            run_lms(['unload', model['identifier']])
    print(f"Loading NVIDIA profile: {settings['gpu_offload']} GPU offload, {settings['parallel']} prediction at a time...", flush=True)
    loaded_message = run_lms(['load', settings['model_key'], '--gpu', str(settings['gpu_offload']),
                   '--context-length', str(settings['context_length']), '--parallel', str(settings['parallel']),
                   '--identifier', settings['identifier'], '--yes'])
    console(loaded_message)
    return settings['identifier']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Load/reload the idle model with this CUDA profile')
    args = parser.parse_args()
    settings = config()
    if args.apply:
        ensure_model(settings, reload=True)
        console(run_lms(['server', 'start', '--port', '1234', '--bind', '127.0.0.1']))
    else:
        console(run_lms(['runtime', 'survey', '--json']))
        console(run_lms(['load', settings['model_key'], '--estimate-only', '--gpu', settings['gpu_offload'],
                       '--context-length', str(settings['context_length']), '--parallel', str(settings['parallel'])]))
