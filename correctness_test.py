"""Generate shared and independently agent-targeted correctness cases."""
import argparse
from datetime import datetime, timezone
import uuid
from pathlib import Path
from test_utils import ROOT, SEED, FUNCTION_NAME, candidates, correctness_cases, isolated, save_json, targeted_cases, source_hash
from targeted_test_agent import generate
from result_stats import correctness_statistics, numeric_error


def smallest_counterexample(baseline, path, failures, request_path, *, project_dir=ROOT):
    if not failures:
        return None
    smallest = min(failures, key=lambda failure: len(failure["case"]["numbers"]))
    save_json(request_path, {"baseline": str(baseline.resolve()), "failure": smallest})
    reduced = isolated(path, request_path, "shrink", timeout=15, project_dir=project_dir)
    return {"smallest_observed": smallest, "reduced": reduced if "error" not in reduced else None,
            "reduction_error": reduced.get("error")}


def run(use_agent=True, refresh_agent=False, seed=SEED, project_dir=None):
    root = Path(project_dir) if project_dir is not None else ROOT
    baseline = root / "original.py"
    common = correctness_cases(seed)
    report = {"schema_version": 3, "run_id": str(uuid.uuid4()),
              "generated_at": datetime.now(timezone.utc).isoformat(),
              "seed": seed, "function": FUNCTION_NAME, "baseline": baseline.name,
              "baseline_sha256": source_hash(baseline), "candidates": [],
              "statistics_notes": {"outcomes": "1 = matches original on every observed field; 0 = differs. Population variance across cases, not proof of correctness or a probability estimate.",
                                   "numeric_error": "Candidate return value minus original return value for finite numeric outputs without exceptions; other cases excluded. Numeric agreement alone does not imply behavioural agreement."}}
    files = candidates(root) if project_dir is not None else candidates()
    if not files:
        raise RuntimeError("No generated candidate files found in output/")
    suites = {"seed": seed, "shared_cases": common, "targeted": {}}
    for path in files:
        try:
            targeted = targeted_cases(baseline, path)
        except (SyntaxError, UnicodeError, OSError) as exc:
            report["candidates"].append({"file": path.name, "status": "error", "error": str(exc), "failures": []})
            print(f"{path.name}: error ({exc})")
            continue
        suites["targeted"][path.name] = targeted
        agent, agent_error = None, None
        if use_agent:
            try:
                print(f"{path.name}: requesting independent targeted cases (or matching cache)...", flush=True)
                agent = generate(baseline, path, refresh=refresh_agent, cache_dir=root / "tests/agent_cases")
                suites["targeted"][path.name]["agent"] = agent
            except Exception as exc:
                agent_error = f"{type(exc).__name__}: {exc}"
                suites["targeted"][path.name]["agent_error"] = agent_error
                print(f"{path.name}: test agent failed: {agent_error}", flush=True)
        agent_cases = agent["cases"] if agent else []
        cases = [{**test, "source": "shared", "category": test["category"]} for test in common]
        cases += [{**test, "source": "exhaustive" if test["name"].startswith("exhaustive_") else "rule_targeted",
                   "category": "exhaustive_short_lists" if test["name"].startswith("exhaustive_") else "rule_targeted"}
                  for test in targeted["cases"]]
        cases += [{**test, "source": "agent", "category": "agent_targeted"} for test in agent_cases]
        suite_path = root / "tests" / f"{path.stem}_correctness_cases.json"
        save_json(suite_path, cases)
        expected = isolated(baseline, suite_path, "correctness", project_dir=root)
        actual = isolated(path, suite_path, "correctness", project_dir=root)
        entry = {"file": path.name, "source_sha256": source_hash(path),
                 "smallest_failing_input": None,
                 "shared_cases": len(common), "targeted_cases": len(targeted["cases"]),
                 "agent_cases": len(agent_cases), "agent_status": "error" if agent_error else "used" if agent else "disabled",
                 "agent_error": agent_error,
                 "targeting_rules": targeted["rules"], "total": len(cases), "failures": []}
        if "error" in expected or "error" in actual:
            entry.update(status="error", baseline_error=expected.get("error"), candidate_error=actual.get("error"))
        else:
            if len(expected["observations"]) != len(cases) or len(actual["observations"]) != len(cases):
                raise RuntimeError("Worker returned an incomplete set of correctness observations")
            rows = []
            for index, (test, old, new) in enumerate(zip(cases, expected["observations"], actual["observations"])):
                rows.append({"case_index": index, "name": test["name"], "source": test["source"],
                             "category": test["category"], "input_size": len(test["numbers"]),
                             "passed": old == new, "numeric_error": numeric_error(old, new),
                             "mismatch_fields": [field for field in old if old[field] != new[field]]})
                if old != new:
                    entry["failures"].append({"case": test, "expected": old, "actual": new})
            entry.update(status="fail" if entry["failures"] else "pass", passed=len(cases) - len(entry["failures"]))
            entry.update(statistics=correctness_statistics(rows), case_results=rows)
            if entry["failures"]:
                entry["smallest_failing_input"] = smallest_counterexample(
                    baseline, path, entry["failures"], root / "tests" / f"{path.stem}_shrink_request.json",
                    project_dir=root)
            if agent_error and entry["status"] == "pass":
                entry["status"] = "error"
        report["candidates"].append(entry)
        print(f"{path.name}: {entry['status']} ({len(entry['failures'])} differences, {len(cases)} cases)")
    save_json(root / "tests/correctness_cases.json", suites)
    save_json(root / "reports/correctness_report.json", report)
    # A correctness-only run must not present old speed measurements as current.
    from export_results import export
    export(report, output_dir=root / "reports")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Explicitly use deterministic tests only; no agent request")
    parser.add_argument("--refresh-agent", action="store_true", help="Regenerate agent cases instead of reusing matching caches")
    parser.add_argument("--seed", type=int, default=SEED, help="Seed for reproducible random correctness inputs")
    args = parser.parse_args()
    if args.offline and args.refresh_agent:
        parser.error("--offline and --refresh-agent cannot be combined")
    result = run(use_agent=not args.offline, refresh_agent=args.refresh_agent, seed=args.seed)
    raise SystemExit(0 if all(c["status"] == "pass" for c in result["candidates"]) else 1)
