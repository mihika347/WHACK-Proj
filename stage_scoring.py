"""Explainable prioritisation heuristic, not a probability of correctness."""
import math
import statistics

POLICY = {
    "version": 2, "default_score_threshold": 70,
    "description": "Correct measured stages: 20 correctness + up to 50 benefit + 20 worst-case + 10 consistency points. Incorrect stages: 0–19 points. Missing evidence: unscored.",
    "benefit": "50 * max(mean_gain, 0) / (max(mean_gain, 0) + 100)",
    "worst_case": "20 / (1 + worst_runtime_slowdown_percent / 20)",
    "consistency": "10 / (1 + sqrt(speed_change_variance) / max(abs(mean_gain), 25))",
    "incorrect": "19 * passed_cases / total_cases; never selectable",
    "key_stages": "Every verified stage scoring strictly above the user threshold; no top-N limit. Failed or incomplete stages go to review. Final code is comparison only.",
}


def validate_threshold(value):
    if isinstance(value, bool):
        raise ValueError('Score threshold must be a finite number from 0 to 100')
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError('Score threshold must be a finite number from 0 to 100')
    return value


def select_stages(rows, threshold=70):
    threshold = validate_threshold(threshold)
    for row in rows:
        row['is_key_stage'] = False
        score = row.get('stage_score')
        row['meets_score_threshold'] = score is not None and score > threshold
        if not row['stage'].startswith('stage_') or not row['stage'].endswith('.py'):
            row['selection_reason'] = 'Final/comparison output; not an independent stage.'
        elif not row.get('selection_eligible'):
            row['selection_reason'] = 'Blocked: correctness failed or evidence is incomplete.'
        elif not row['meets_score_threshold']:
            row['selection_reason'] = f'Score {score:.2f} is not strictly above {threshold:g}.'
        else:
            row['is_key_stage'] = True
            row['selection_reason'] = f'Score {score:.2f} is above {threshold:g} and checks passed.'
    return rows


def score_stages(rows, workloads, threshold=70):
    threshold = validate_threshold(threshold)
    for row in rows:
        tests = [test for test in workloads if test["stage"] == row["stage"] and isinstance(test.get("speedup"), (int, float))
                 and math.isfinite(test["speedup"]) and test["speedup"] > 0]
        gains = [(test["speedup"] - 1) * 100 for test in tests]
        mean = statistics.mean(gains) if gains else None
        variance = statistics.pvariance(gains) if gains else None
        slowdown = max(0, (1 / min(test["speedup"] for test in tests) - 1) * 100) if tests else None
        row.update(mean_speed_increase_percent=mean, stage_score=None, rank=None, is_key_stage=False,
                   selection_eligible=False, score_breakdown={}, score_reasons=[])
        total, passed = row.get("total_cases"), row.get("passed_cases")
        failed = row.get("failed_cases")
        if (row.get("correctness_status") == "fail" or (isinstance(failed, int) and failed > 0)) and total and passed is not None:
            row["stage_score"] = round(19 * passed / total, 2)
            row["score_breakdown"] = {"correctness": row["stage_score"], "performance": None}
            row["score_reasons"] = [f"{failed} correctness failures; blocked from selection. Performance is not assumed."]
        elif row.get("correctness_status") != "pass" or row.get("agent_status") in (None, "error") or not total or passed != total or failed != 0:
            row["score_reasons"] = ["Incomplete correctness evidence; unscored."]
        elif row.get("speed_status") != "pass" or not gains:
            row["score_reasons"] = ["No verified benchmark evidence; unscored."]
        else:
            benefit = 50 * max(mean, 0) / (max(mean, 0) + 100)
            worst_points = 20 / (1 + slowdown / 20)
            consistency = 10 / (1 + math.sqrt(variance) / max(abs(mean), 25))
            row["stage_score"] = round(20 + benefit + worst_points + consistency, 2)
            row["score_breakdown"] = {"correctness": 20, "speed_benefit": round(benefit, 4),
                                      "worst_case": round(worst_points, 4), "consistency": round(consistency, 4),
                                      "mean_gain_percent": mean, "worst_slowdown_percent": slowdown,
                                      "variance_pp_squared": variance}
            row["selection_eligible"] = True
            row["score_reasons"] = [f"Mean speed gain {mean:.1f}%; worst runtime slowdown {slowdown:.1f}%; variance {variance:.2f} pp²."]
            if row.get("agent_status") == "disabled":
                row["score_reasons"].append("Agent coverage explicitly disabled; score covers deterministic tests only.")
    # Do not select the same source twice. Final code remains a separately
    # measured comparison rather than a proposed independent stage.
    stages = [row for row in rows if row["stage"].startswith("stage_") and row["stage"].endswith(".py")]
    ordered = sorted((r for r in stages if r["stage_score"] is not None), key=lambda r: (-r["stage_score"], r["stage"]))
    for rank, row in enumerate(ordered, 1):
        row["rank"] = rank
    return select_stages(rows, threshold)
