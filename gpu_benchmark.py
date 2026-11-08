"""Small local inference timing check; never runs or changes optimiser stages."""
import argparse
import json
from pathlib import Path
import statistics
import time
import urllib.request

from gpu_runtime import config


def measure(model, label):
    settings = config()
    samples = []
    for index in range(3):
        payload = {'model': model, 'messages': [{'role': 'user', 'content': 'Write the positive integers from 1 to 100, one per line. Do not explain.'}],
                   'temperature': 0, 'max_tokens': 16 if index == 0 else 128}
        request = urllib.request.Request(settings['base_url'] + '/chat/completions', data=json.dumps(payload).encode(),
                                         headers={'Content-Type': 'application/json', 'Authorization': 'Bearer lm-studio'})
        start = time.perf_counter()
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)
        elapsed = time.perf_counter() - start
        if index:
            tokens = result.get('usage', {}).get('completion_tokens')
            if not tokens:
                raise RuntimeError('Model did not report completion token usage')
            samples.append({'seconds': elapsed, 'completion_tokens': tokens, 'tokens_per_second': tokens / elapsed})
    measurement = {'model': model, 'samples': samples, 'median_tokens_per_second': statistics.median(s['tokens_per_second'] for s in samples),
                   'note': 'Two warm-start samples, end-to-end completion tokens/s including prompt processing. Not a guarantee for real code generation.'}
    path = Path(__file__).resolve().parent / 'gpu_benchmark_results.json'
    data = json.loads(path.read_text()) if path.exists() else {}
    data[label] = measurement
    path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print(json.dumps({label: measurement}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default=config()['identifier'])
    parser.add_argument('--label', default='after')
    args = parser.parse_args()
    measure(args.model, args.label)
