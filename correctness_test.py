"""Generate shared and independently agent-targeted correctness cases."""
import argparse
from datetime import datetime, timezone
import uuid
from pathlib import Path
from test_utils import ROOT, SEED, FUNCTION_NAME, candidates, correctness_cases, isolated, save_json, targeted_cases, source_hash
from targeted_test_agent import generate_isolated as generate, TOTAL_TIMEOUT
from result_stats import correctness_statistics, numeric_error


def run(use_agent=False, refresh_agent=False, seed=SEED, project_dir=None):
    if refresh_agent and not use_agent:
        raise ValueError('Refreshing agent cases requires use_agent=True')
    if not use_agent:
        print('Agent-generated cases disabled for development. Use --with-agent to enable them.', flush=True)
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
    report['complete'] = False
    def checkpoint():
        report['pending_candidates'] = [p.name for p in files if p.name not in {c['file'] for c in report['candidates']}]
        save_json(root / 'tests/correctness_cases.json', suites)
        save_json(root / 'reports/correctness_report.json', report)
        from export_results import export
        export(report, output_dir=root / 'reports')
    checkpoint()
    for path in files:
        try:
            targeted = targeted_cases(baseline, path)
        except (SyntaxError, UnicodeError, OSError) as exc:
            report["candidates"].append({"file": path.name, "status": "error", "error": str(exc), "failures": []})
            print(f"{path.name}: error ({exc})")
            checkpoint()
            continue
        suites["targeted"][path.name] = targeted
        agent, agent_error = None, None
        if use_agent:
            try:
                print(f"{path.name}: independent targeted cases (cache or up to {TOTAL_TIMEOUT:g}s)...", flush=True)
                agent = generate(baseline, path, refresh=refresh_agent)
                suites["targeted"][path.name]["agent"] = agent
            except Exception as exc:
                agent_error = f"{type(exc).__name__}: {exc}"[:600]
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
        expected = isolated(baseline, suite_path, "correctness")
        actual = isolated(path, suite_path, "correctness")
        entry = {"file": path.name, "source_sha256": source_hash(path),
                 "change_variance": None,
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
            entry["change_variance"] = entry["statistics"]["change_variance"]
            entry['observed_status'] = entry['status']
            if agent_error and entry["status"] == "pass":
                entry["status"] = "error"
        report["candidates"].append(entry)
        print(f"{path.name}: {entry['status']} ({len(entry['failures'])} differences, {len(cases)} cases)")
        print(f"  Output-change variance: {entry['change_variance']} (candidate output minus original)")
        if agent_error:
            print(f"  Observed checks: {entry.get('observed_status', 'error')}; agent coverage unavailable. Not accepted as fully validated.")
        checkpoint()
    report['complete'] = True
    checkpoint()
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Explicitly use deterministic tests only; no agent request")
    parser.add_argument('--with-agent', action='store_true', help='Opt in to LLM-generated targeted cases (disabled by default)')
    parser.add_argument("--refresh-agent", action="store_true", help="Regenerate agent cases instead of reusing matching caches")
    parser.add_argument("--seed", type=int, default=SEED, help="Seed for reproducible random correctness inputs")
    args = parser.parse_args()
    if args.offline and args.with_agent:
        parser.error('--offline and --with-agent cannot be combined')
    if args.refresh_agent and not args.with_agent:
        parser.error('--refresh-agent requires --with-agent')
    try:
        result = run(use_agent=args.with_agent, refresh_agent=args.refresh_agent, seed=args.seed)
    except KeyboardInterrupt:
        print('\nCancelled. Completed stage results are saved in reports/correctness_report.json. Rerun to reuse cached agent cases, or use --offline.')
        raise SystemExit(130)
    raise SystemExit(0 if all(c["status"] == "pass" for c in result["candidates"]) else 1)
