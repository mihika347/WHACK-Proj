"""Serve FastForward and the saved evaluation runs over local HTTP."""

import argparse
from difflib import SequenceMatcher
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from export_test_cases import case_key, display_case
from run_inputs import PatchConflict, read_source, source_lines, uploaded_cases
from run_jobs import RunBusyError, RunJobs


UI = Path(__file__).resolve().parent
ROOT = UI.parent
RUNS = {"latest": ROOT, "failure-demo": ROOT / "examples/failure_demo"}
jobs = RunJobs()
MINIMUM_TIME_REDUCTION = 5
CASE_SOURCES = {
    "uploaded": "Uploaded",
    "agent": "AI-generated cases",
    "shared": "Shared cases",
    "rule_targeted": "Rule-targeted cases",
    "exhaustive": "Exhaustive cases",
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def describe_failure(failure):
    example = failure["reduced"] or failure["smallest_observed"]
    expected, actual = example["expected"], example["actual"]
    return {
        "case": display_case(example["case"]),
        "reduced": failure["reduced"] is not None,
        "differences": [
            {"field": field, "expected": json.dumps(value), "actual": json.dumps(actual[field])}
            for field, value in expected.items() if value != actual[field]
        ],
    }


def test_case_data(root, candidates, results):
    by_id = {candidate["id"]: candidate for candidate in candidates}
    correctness = {source: {} for source in CASE_SOURCES}
    case_files = {}
    outcomes = {category: {"passed": 0, "failed": 0} for category in ("correctness", "speed")}
    for row in results["correctness_case_results"]:
        stage = row["stage"]
        if stage not in by_id:
            continue
        if stage not in case_files:
            case_files[stage] = read_json(root / "tests" / f"{Path(stage).stem}_correctness_cases.json")
        case = case_files[stage][row["case_index"]]
        if (case["name"], case["source"], case["category"], len(case["numbers"])) != (
            row["name"], row["source"], row["category"], row["input_size"]
        ):
            raise ValueError(f"The saved test cases for {stage} do not match the evaluation")
        group = correctness[row["source"]]
        key = (*case_key(case), case.get('target_stage', stage), case.get('target_sha256', '')) if row['source'] == 'agent' else case_key(case)
        if key not in group:
            group[key] = display_case(case)
            if row['source'] == 'agent':
                target = case.get('target_stage', stage)
                group[key]['aiGenerated'] = True
                group[key]['targetChange'] = by_id.get(target, {}).get('title', target)
                group[key]['targetStage'] = target
            if row["source"] == "uploaded":
                group[key]["uploaded"] = True
        if "baseline_value" in row:
            group[key]["baselineValue"] = row["baseline_value"]
        outcomes["correctness"]["passed" if row["passed"] else "failed"] += 1
        if not row["passed"]:
            group[key].setdefault("failedIn", []).append(by_id[stage]["title"])

    speed = {}
    if results["has_speed_results"]:
        suite = {case["name"]: case for case in read_json(root / "tests/speed_cases.json")}
        for candidate in candidates:
            for row in candidate["workloads"]:
                case = suite[row["workload"]]
                if row["input_size"] != len(case["numbers"]):
                    raise ValueError("The saved benchmark inputs do not match the evaluation")
                group = speed.setdefault(row["input_size"], {})
                if row["workload"] not in group:
                    group[row["workload"]] = display_case(case)
                slower = row["speedup"] < 1
                outcomes["speed"]["failed" if slower else "passed"] += 1
                if slower:
                    group[row["workload"]].setdefault("failedIn", []).append(candidate["title"])
    return {
        "outcomes": outcomes,
        "correctness": [{"sources": [CASE_SOURCES[source]], "cases": list(group.values())}
                        for source, group in correctness.items() if group],
        "speed": [{"sources": [f"{size:,} input values"], "cases": list(speed[size].values())}
                  for size in sorted(speed)],
    }


def saved_run(root, filename="original.py", *, final_only=False):
    results = read_json(root / "reports/ui_results.json")
    if results["schema_version"] not in {2, 4}:
        raise ValueError("The saved results use an unsupported schema")
    baseline = source_lines(read_source(root / "original.py", results["baseline_sha256"]))
    manifest = root / "output/report.json"
    proposals = {f"stage_{stage['stage']}.py": stage for stage in read_json(manifest)["stages"]} if manifest.exists() else {}
    if (root / "proposals.json").exists():
        proposals = read_json(root / "proposals.json")
    scenarios = results.get("demo_scenarios", {})
    charts = results["charts"]
    candidates = []
    for stats in results["summary"]:
        stage = stats["stage"]
        is_final = stage == "final_optimised.py"
        if final_only != is_final:
            continue
        if not is_final and not re.fullmatch(r"stage_[1-9][0-9]*\.py", stage):
            raise ValueError("The report contains an invalid stage filename")
        source = read_source(root / "output" / stage, stats["source_sha256"])
        proposal = proposals.get(stage, {})
        if manifest.exists() and source.replace("\r\n", "\n") != proposal.get("code"):
            raise ValueError(f"{stage} does not match the optimisation report")
        lines = source_lines(source)
        patches = [{"start": start + 1, "remove": end - start, "lines": lines[first:last]}
                   for tag, start, end, first, last in SequenceMatcher(None, baseline, lines).get_opcodes()
                   if tag != "equal"]
        failure = next(row["smallest_failing_input"] for row in charts["smallest_failing_inputs"] if row["stage"] == stage)
        slowdown = next(row["worst_observed_slowdown"] for row in charts["worst_observed_slowdowns"] if row["stage"] == stage)
        verified = stats["correctness_status"] == "pass" and stats["speed_status"] == "pass"
        reduction = stats["execution_time_reduction_percent"]
        candidate = {
            "id": stage,
            "title": proposal.get("name", scenarios.get(stage, stage)),
            "description": proposal.get("explanation", "Deliberate test fixture." if stage in scenarios else ""),
            "patches": patches,
            "stats": stats,
            "recommended": bool(patches and verified and reduction is not None and reduction >= MINIMUM_TIME_REDUCTION),
            "expectedMismatches": sum(row["stage"] == stage and "baseline_value" in row
                                      for row in results["correctness_case_results"]),
            "failure": describe_failure(failure) if failure else None,
            "slowdown": {**slowdown, "input": display_case(slowdown["input"])} if slowdown and slowdown["is_slowdown"] else None,
            "workloads": [row for row in charts["speed_by_workload"] if row["stage"] == stage],
            "sizes": [row for row in charts["speed_by_input_size"] if row["stage"] == stage],
        }
        if final_only:
            return {**candidate, "code": source, "verified": verified}
        candidates.append(candidate)
    if final_only:
        raise ValueError("The final build has no evaluation results.")
    return {
        "id": results["run_id"], "filename": filename, "baseline": baseline,
        "baseline_sha256": results["baseline_sha256"], "seed": results["seed"],
        "candidates": candidates, "tests": test_case_data(root, candidates, results),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=UI, **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path.startswith("/api/saved-runs/"):
                root = RUNS.get(path.removeprefix("/api/saved-runs/"))
                if root is None:
                    return self.send_error(HTTPStatus.NOT_FOUND)
                return self.send_json(HTTPStatus.OK, saved_run(root))
            match = re.fullmatch(r"/api/runs/([0-9a-f]{32})", path)
            if match:
                try:
                    root, job = jobs.get(match[1])
                except FileNotFoundError:
                    return self.send_json(HTTPStatus.NOT_FOUND, {"error": "This run was not found on the local server."})
                if job["status"] == "completed":
                    if job.get("kind") == "build":
                        job["build"] = saved_run(root, job["filename"], final_only=True)
                    else:
                        job["run"] = saved_run(root, job["filename"])
                return self.send_json(HTTPStatus.OK, job)
        except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
            return self.send_json(HTTPStatus.CONFLICT, {"error": f"Run files are missing or inconsistent. {error}"})
        return super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in {"/api/runs", "/api/runs/recheck", "/api/runs/build"}:
            return self.send_error(HTTPStatus.NOT_FOUND)
        port = self.server.server_port
        host = self.headers.get("Host")
        # Only our local UI may start a job that executes Python source.
        if host not in {f"127.0.0.1:{port}", f"localhost:{port}"} or self.headers.get("Origin") != f"http://{host}":
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Open FastForward on the local server to start a run."})
        if self.headers.get_content_type() != "application/json":
            return self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "Expected a JSON request."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8 * 1024 * 1024:
                raise ValueError("Request must be between 1 byte and 8 MB.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            uploads = uploaded_cases(data.get("uploads", []))
            if path == "/api/runs":
                job = jobs.start(data.get("filename"), data.get("source"), uploads)
            else:
                root, run = self.parent_run(data.get("parent"))
                if data.get("run_id") != run["id"]:
                    raise ValueError("The run changed. Reload its results and try again.")
                kind = path.rsplit("/", 1)[1]
                job = jobs.followup(root, run, kind, uploads, data.get("selection"))
        except PatchConflict as error:
            return self.send_json(HTTPStatus.CONFLICT, {"error": str(error), "conflicts": error.candidates})
        except (ValueError, RecursionError) as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RunBusyError as error:
            return self.send_json(HTTPStatus.CONFLICT, {"error": str(error)})
        except (OSError, RuntimeError, KeyError, IndexError, TypeError):
            return self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Could not start the optimisation run."})
        return self.send_json(HTTPStatus.ACCEPTED, job)

    def parent_run(self, key):
        if isinstance(key, str) and key in RUNS:
            return RUNS[key], saved_run(RUNS[key])
        match = re.fullmatch(r"live:([0-9a-f]{32})", key) if isinstance(key, str) else None
        if match:
            try:
                root, job = jobs.get(match[1])
            except FileNotFoundError as error:
                raise ValueError("Choose a completed run.") from error
            if job["status"] == "completed" and job.get("kind") != "build":
                return root, saved_run(root, job["filename"])
        raise ValueError("Choose a completed run.")

    def send_json(self, status, data):
        body = json.dumps(data, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except ConnectionError:
            # The browser may leave the page while the response is streaming.
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"FastForward: http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever()
