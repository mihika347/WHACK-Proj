"""Explicit descriptive statistics and chart data; no third-party dependencies."""
import math
import statistics


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def describe(values):
    """Population variance across supplied observations; empty statistics are null."""
    values = list(values)
    fields = ("median", "population_variance", "standard_deviation", "min", "max", "p05", "p95", "iqr")
    if not values:
        return {"count": 0, **dict.fromkeys(fields)}
    variance = statistics.pvariance(values)
    return {"count": len(values), "median": statistics.median(values),
            "population_variance": variance, "standard_deviation": math.sqrt(variance),
            "min": min(values), "max": max(values), "p05": percentile(values, .05),
            "p95": percentile(values, .95), "iqr": percentile(values, .75) - percentile(values, .25)}


def pass_statistics(rows):
    outcomes = [int(row["passed"]) for row in rows]
    return {"total": len(outcomes), "passed": sum(outcomes), "failed": len(outcomes) - sum(outcomes),
            "pass_rate_percent": 100 * sum(outcomes) / len(outcomes) if outcomes else None,
            "outcome_statistics": describe(outcomes)}


def numeric_error(expected, actual):
    """Only normal, finite scalar outputs with no exceptions enter error statistics."""
    if expected["exception"] is not None or actual["exception"] is not None:
        return None
    old, new = expected["value"], actual["value"]
    if type(old) not in (int, float) or type(new) not in (int, float):
        return None
    try:
        error = float(new - old)
        return error if math.isfinite(error) and math.isfinite(error * error) else None
    except (OverflowError, ValueError):
        return None


def correctness_statistics(rows):
    errors = [row["numeric_error"] for row in rows if row["numeric_error"] is not None]
    groups = {}
    for field in ("source", "category"):
        groups[field] = [{"name": name, **pass_statistics([row for row in rows if row[field] == name])}
                         for name in sorted({row[field] for row in rows})]
    return {**pass_statistics(rows), "numeric_error_statistics": {
        **describe(errors), "excluded_cases": len(rows) - len(errors),
        "max_absolute_error": max(map(abs, errors), default=None)},
        "by_source": groups["source"], "by_category": groups["category"],
        "by_input_size": [{"input_size": size, **pass_statistics([r for r in rows if r.get("input_size") == size])}
                          for size in sorted({r["input_size"] for r in rows if "input_size" in r})]}


def speed_percentages(speedup):
    return {"speed_increase_percent": (speedup - 1) * 100,
            "execution_time_reduction_percent": (1 - 1 / speedup) * 100}


def speed_statistics(timings):
    ratios = [t["speedup"] for t in timings]
    median_speedup = statistics.median(ratios)
    worst = min(timings, key=lambda t: t["speedup"])
    slowdown = max(0, (1 / worst["speedup"] - 1) * 100)
    return {"workload_count": len(timings), "median_speedup": median_speedup,
            **speed_percentages(median_speedup),
            "worst_observed_slowdown": {
                "workload": worst.get("name"), "input_size": worst.get("size"),
                "speedup": worst["speedup"], "slowdown_percent": slowdown,
                "is_slowdown": worst["speedup"] < 1,
                "candidate_median_seconds": worst["median_seconds"],
                "baseline_median_seconds": worst["median_seconds"] * worst["speedup"]},
            "workload_median_seconds": describe(t["median_seconds"] for t in timings),
            "workload_speed_increase_percent": describe(t["speed_increase_percent"] for t in timings),
            "faster_workloads": sum(r > 1 for r in ratios), "slower_workloads": sum(r < 1 for r in ratios),
            "equal_workloads": sum(r == 1 for r in ratios)}
