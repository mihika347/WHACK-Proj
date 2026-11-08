"""Bounded deletion-based reduction of a failing integer-list input."""
import time


def reduce_failure(failure, observe_pair, max_evaluations=200, time_limit=10):
    original = failure["case"]
    numbers = list(original["numbers"])
    required = {key for key in failure["expected"] if failure["expected"][key] != failure["actual"][key]}
    best_old, best_new = failure["expected"], failure["actual"]
    evaluations, exhausted = 0, False
    start = time.monotonic()

    def still_fails(values):
        nonlocal evaluations, exhausted, best_old, best_new
        if evaluations >= max_evaluations or time.monotonic() - start >= time_limit:
            exhausted = True
            return False
        evaluations += 1
        old, new = observe_pair({**original, "numbers": values})
        differences = {key for key in old if old[key] != new[key]}
        if required <= differences:
            best_old, best_new = old, new
            return True
        return False

    width = max(1, len(numbers) // 2)
    while numbers and width >= 1 and not exhausted:
        index = 0
        while index < len(numbers) and not exhausted:
            trial = numbers[:index] + numbers[index + width:]
            if still_fails(trial):
                numbers = trial
                index = 0
            else:
                index += width
        if width == 1:
            break
        width = max(1, width // 2)
    return {"case": {**original, "numbers": numbers}, "expected": best_old, "actual": best_new,
            "original_input_size": len(original["numbers"]), "input_size": len(numbers),
            "evaluations": evaluations, "budget_exhausted": exhausted,
            "single_deletion_minimal": not exhausted,
            "method": "Deletion-only reduction of the shortest observed failure, keeping target and mismatch fields; not a global minimum guarantee."}
