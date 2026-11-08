"""Shared deterministic integer-list suites and isolated test execution."""
import argparse
import ast
import contextlib
import copy
import difflib
import importlib.util
import io
import json
import hashlib
from pathlib import Path
import random
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
FUNCTION_NAME = "count_matches"
SEED = 20261107


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def source_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def candidates(project_dir=None):
    root = Path(project_dir) if project_dir is not None else ROOT
    manifest = root / "output/report.json"
    if manifest.exists():
        report = json.loads(manifest.read_text(encoding="utf-8"))
        selected = []
        seen = set()
        for stage in report["stages"]:
            number = stage["stage"]
            if type(number) is not int or number < 1 or number in seen:
                raise ValueError("report.json must contain distinct positive integer stage IDs")
            seen.add(number)
            path = root / "output" / f"stage_{number}.py"
            if path.read_text(encoding="utf-8") != stage["code"]:
                raise ValueError(f"{path.name} does not match the latest report; regenerate the stages")
            selected.append(path)
        final = root / "output/final_optimised.py"
        if final.read_text(encoding="utf-8") != report["final_code"]:
            raise ValueError("Final code does not match the latest report; regenerate the stages")
        return selected + [final]
    # Standalone candidate files are supported when no generator manifest exists.
    stages = list((root / "output").glob("stage_*.py"))
    stages.sort(key=lambda p: (int(p.stem.split("_")[-1]) if p.stem.split("_")[-1].isdigit() else sys.maxsize, p.name))
    final = root / "output/final_optimised.py"
    return stages + ([final] if final.exists() else [])


def case(name, numbers, target):
    return {"name": name, "numbers": numbers, "target": target}


def correctness_cases(seed=SEED):
    rng = random.Random(seed)
    lists = [[], [0], [1], [-1], [1, 2, 3, 4], [-4, -3, -2, -1],
             [-8, 4, 0, -2, 9], [0] * 40, [7] * 40,
             [1, 2, 2, 3, 3, 3], list(range(-30, 31)), list(range(30, -31, -1)),
             [1, 2, 5, 4, 3, 6], [-1, 1, -2, 2] * 12,
             [-10**6, 10**6] * 20, [10**100, -10**100, 0, 10**100]]
    result = []
    categories = ["empty", "singleton_zero", "singleton_positive", "singleton_negative", "positive",
                  "negative", "mixed_signs", "all_zeros", "identical", "duplicates", "ascending",
                  "descending", "nearly_sorted", "alternating_signs", "alternating_extremes", "large_integers"]
    for i, numbers in enumerate(lists):
        targets = list(dict.fromkeys([0, -1, 1, 7, 999999, *numbers[:2], *numbers[-2:]]))
        result.extend({**case(f"boundary_{i}_target_{j}", numbers, target), "category": categories[i]}
                      for j, target in enumerate(targets))
    for i in range(300):
        size = rng.choice([0, 1, 2, 3, 10, 31, 100, 200])
        bound = rng.choice([1, 3, 100, 10**6, 10**30])
        numbers = [rng.randint(-bound, bound) for _ in range(size)]
        if i % 4 == 0:
            numbers.sort(reverse=bool(i % 8))
        target = rng.choice(numbers) if numbers and i % 2 else rng.randint(-bound, bound)
        result.append({**case(f"random_{i}", numbers, target), "category": "seeded_random"})
    return result


def targeted_cases(original_path, candidate_path):
    """Use structural changes, not model explanations, to select adversarial cases."""
    before = original_path.read_text(encoding="utf-8")
    after = candidate_path.read_text(encoding="utf-8")
    old_nodes = {ast.dump(n) for n in ast.walk(ast.parse(before))}
    added = [n for n in ast.walk(ast.parse(after)) if ast.dump(n) not in old_nodes]
    rules, tests = [], []

    def add(rule, values):
        rules.append(rule)
        tests.extend(case(f"targeted_{rule}_{i}", numbers, target) for i, (numbers, target) in enumerate(values))

    if any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "count" for n in added):
        add("list_count_replacement", [([], 0), ([4] * 200, 4), ([4] * 200, -4),
            ([5, 0, 5, -5, 5], 5), ([10**100, 10**100, -10**100], 10**100)])
    if any(isinstance(n, (ast.GeneratorExp, ast.ListComp)) for n in added):
        add("comprehension_filter_and_aggregation", [([], 0), ([0] * 100, 0),
            ([-3, -3, 1, 0], -3), ([2] * 150, 2), ([1, 2, 3], 8), ([9, 1, 9], 9)])
    if any(isinstance(n, ast.Assign) and isinstance(n.value, ast.Name) and n.value.id == "target" for n in added):
        add("target_alias_binding", [([0, 1, 0], 0), ([-7, 1, -7], -7),
            ([10**100, 1, 10**100], 10**100), ([1, 2], 3)])
    if any(isinstance(n, (ast.Set, ast.SetComp)) or isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "set" for n in added):
        add("deduplication", [([2] * 100, 2), ([1, 2, 1, 2, 1], 1)])
    if any(isinstance(n, ast.Call) and (isinstance(n.func, ast.Name) and n.func.id == "sorted" or isinstance(n.func, ast.Attribute) and n.func.attr == "sort") for n in added):
        add("sorting_and_mutation", [([3, 1, 2, 1], 1), ([4, 3, 2, 1], 3)])
    if any(isinstance(n, (ast.Compare, ast.If, ast.IfExp)) for n in added):
        add("comparison_boundaries", [([-1, 0, 1], t) for t in [-2, -1, 0, 1, 2]])
    # Every changed candidate gets exhaustive short lists to catch interactions
    # even when its transformation has no specialised rule above.
    import itertools
    for length in range(5):
        for values in itertools.product([-1, 0, 1], repeat=length):
            tests.extend(case(f"exhaustive_{length}_{values}_{target}", list(values), target) for target in [-1, 0, 1, 2])
    return {"rules": rules, "fallback": "Exhaustive lists of length 0–4 over {-1, 0, 1}; targets -1, 0, 1, 2.",
            "diff": "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile=original_path.name, tofile=candidate_path.name)),
            "cases": tests}


def speed_cases():
    rng = random.Random(SEED)
    result = []
    for size in [100, 1000, 10000]:
        patterns = {"random": [rng.randint(-1000, 1000) for _ in range(size)],
                    "duplicates": [rng.randint(-2, 2) for _ in range(size)],
                    "zeros": [0] * size, "identical": [7] * size,
                    "ascending": list(range(size)), "descending": list(range(size, 0, -1)),
                    "alternating": [-10**6, 10**6] * (size // 2),
                    "large_integers": [rng.choice([-10**100, 0, 10**100]) for _ in range(size)]}
        for name, numbers in patterns.items():
            for label, target in [("present", numbers[size // 2]), ("absent", 10**101)]:
                result.append(case(f"{name}_{size}_{label}", numbers, target))
    return result


def load_function(path):
    spec = importlib.util.spec_from_file_location("tested_program", path)
    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return getattr(module, FUNCTION_NAME)


def observe(function, test):
    numbers = copy.deepcopy(test["numbers"])
    out, err = io.StringIO(), io.StringIO()
    value, exception = None, None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            value = function(numbers, test["target"])
        except Exception as exc:
            exception = {"type": type(exc).__name__, "message": str(exc)}
    return {"value": value, "value_type": type(value).__name__, "exception": exception,
            "numbers_after": numbers, "stdout": out.getvalue(), "stderr": err.getvalue()}


def isolated(path, suite_path, mode, timeout=60, *, project_dir=ROOT):
    try:
        process = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker", str(Path(path).resolve()),
                                  str(Path(suite_path).resolve()), mode], capture_output=True, text=True,
                                 timeout=timeout, cwd=project_dir)
        if process.returncode:
            return {"error": process.stderr[-4000:] or f"Exit code {process.returncode}"}
        return json.loads(process.stdout)
    except subprocess.TimeoutExpired:
        return {"error": f"Execution exceeded {timeout} seconds"}
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}


def worker(path, suite_path, mode):
    from result_stats import describe
    function = load_function(path)
    tests = json.loads(Path(suite_path).read_text(encoding="utf-8"))
    if mode == "shrink":
        from shrink_failure import reduce_failure
        baseline = load_function(tests["baseline"])
        return reduce_failure(tests["failure"], lambda test: (observe(baseline, test), observe(function, test)))
    if mode == "correctness":
        return {"observations": [observe(function, test) for test in tests]}
    timings = []
    for test in tests:
        # Input copying is outside the timed interval; every call receives a fresh list.
        for _ in range(3):
            function(list(test["numbers"]), test["target"])
        samples = []
        repetitions = max(5, min(200, 100000 // max(1, len(test["numbers"]))))
        for _ in range(7):
            inputs = [list(test["numbers"]) for _ in range(repetitions)]
            start = time.perf_counter_ns()
            for numbers in inputs:
                function(numbers, test["target"])
            samples.append((time.perf_counter_ns() - start) / repetitions / 1e9)
        timings.append({"name": test["name"], "size": len(test["numbers"]),
                        "median_seconds": statistics.median(samples), "samples_seconds": samples,
                        "timing_statistics_seconds": describe(samples),
                        "calls_per_sample": repetitions})
    return {"timings": timings}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", nargs=3, required=True)
    args = parser.parse_args()
    # Keep candidate output separate from the JSON transport.
    transport = sys.stdout
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        result = worker(*args.worker)
    print(json.dumps(result, allow_nan=False), file=transport)
