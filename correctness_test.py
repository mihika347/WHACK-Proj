"""Generate shared and independently agent-targeted correctness cases."""
import argparse
from test_utils import ROOT, SEED, FUNCTION_NAME, candidates, correctness_cases, isolated, save_json, targeted_cases
from targeted_test_agent import generate


def run(use_agent=True, refresh_agent=False):
    baseline = ROOT / "original.py"
    common = correctness_cases()
    report = {"seed": SEED, "function": FUNCTION_NAME, "baseline": baseline.name, "candidates": []}
    files = candidates()
    if not files:
        raise RuntimeError("No generated candidate files found in output/")
    suites = {"seed": SEED, "shared_cases": common, "targeted": {}}
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
                agent = generate(baseline, path, refresh=refresh_agent)
                suites["targeted"][path.name]["agent"] = agent
            except Exception as exc:
                agent_error = f"{type(exc).__name__}: {exc}"
                suites["targeted"][path.name]["agent_error"] = agent_error
                print(f"{path.name}: test agent failed: {agent_error}", flush=True)
        agent_cases = agent["cases"] if agent else []
        cases = common + targeted["cases"] + agent_cases
        suite_path = ROOT / "tests" / f"{path.stem}_correctness_cases.json"
        save_json(suite_path, cases)
        expected = isolated(baseline, suite_path, "correctness")
        actual = isolated(path, suite_path, "correctness")
        entry = {"file": path.name, "shared_cases": len(common), "targeted_cases": len(targeted["cases"]),
                 "agent_cases": len(agent_cases), "agent_status": "error" if agent_error else "used" if agent else "disabled",
                 "agent_error": agent_error,
                 "targeting_rules": targeted["rules"], "total": len(cases), "failures": []}
        if "error" in expected or "error" in actual:
            entry.update(status="error", baseline_error=expected.get("error"), candidate_error=actual.get("error"))
        else:
            for test, old, new in zip(cases, expected["observations"], actual["observations"]):
                if old != new:
                    entry["failures"].append({"case": test, "expected": old, "actual": new})
            entry.update(status="fail" if entry["failures"] else "pass", passed=len(cases) - len(entry["failures"]))
            if agent_error and entry["status"] == "pass":
                entry["status"] = "error"
        report["candidates"].append(entry)
        print(f"{path.name}: {entry['status']} ({len(entry['failures'])} differences, {len(cases)} cases)")
    save_json(ROOT / "tests/correctness_cases.json", suites)
    save_json(ROOT / "reports/correctness_report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Explicitly use deterministic tests only; no agent request")
    parser.add_argument("--refresh-agent", action="store_true", help="Regenerate agent cases instead of reusing matching caches")
    args = parser.parse_args()
    if args.offline and args.refresh_agent:
        parser.error("--offline and --refresh-agent cannot be combined")
    result = run(use_agent=not args.offline, refresh_agent=args.refresh_agent)
    raise SystemExit(0 if all(c["status"] == "pass" for c in result["candidates"]) else 1)
