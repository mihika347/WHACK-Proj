"""Run the existing optimisation and evaluation pipeline in isolated directories."""

import ast
import json
from pathlib import Path
import sys
from threading import Lock, Thread
from urllib.error import URLError
from uuid import uuid4

from export_test_cases import case_key
from run_inputs import merge_approved, read_source

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api_call1 import generate
from correctness_test import run as check_correctness
from speed_test import benchmark
from test_utils import FUNCTION_NAME, SEED, save_json


def validate_source(name, source):
    if (not isinstance(name, str) or not name.lower().endswith(".py")
            or len(name) > 100 or any(char in name for char in "/\\")
            or any(ord(char) < 32 for char in name)):
        raise ValueError("Choose a Python (.py) file.")
    if not isinstance(source, str) or not source.strip() or len(source.encode("utf-8")) > 1024 * 1024:
        raise ValueError("The Python source must be non-empty and at most 1 MB.")
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        raise ValueError(f"Python syntax error on line {error.lineno}: {error.msg}") from error
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == FUNCTION_NAME:
            if (len(node.args.posonlyargs) + len(node.args.args) == 2
                    and all(default is not None for default in node.args.kw_defaults)):
                return
    raise ValueError("This evaluator requires a top-level count_matches(numbers, target) function.")


class RunBusyError(RuntimeError):
    pass


class RunJobs:
    def __init__(self, directory=ROOT / ".fastforward-runs"):
        self.directory = Path(directory).resolve()
        self.lock = Lock()
        self.active = None

    def start(self, name, source, uploads):
        validate_source(name, source)
        return self.submit(name, source, uploads=uploads)

    def followup(self, root, run, kind, uploads, selection):
        candidates = run["candidates"]
        if kind == "build":
            if not isinstance(selection, list) or not selection or not all(isinstance(key, str) for key in selection):
                raise ValueError("Approve at least one change before building.")
            by_key = {f"{item['id']}:{item['stats']['source_sha256']}": item for item in candidates}
            if len(set(selection)) != len(selection) or any(key not in by_key for key in selection):
                raise ValueError("The approved changes do not match this run.")
            candidates = [by_key[key] for key in selection]
            if any(not item["recommended"] for item in candidates):
                raise ValueError("Only recommended changes can be built.")
        if not candidates:
            raise ValueError("This run has no candidates to evaluate.")
        original = read_source(root / "original.py", run["baseline_sha256"])
        suites = {}
        for candidate in candidates:
            stage = candidate["id"]
            path = root / "tests" / f"{Path(stage).stem}_correctness_cases.json"
            suites[stage] = {"cases": json.loads(path.read_text(encoding="utf-8")),
                             "agent_status": candidate["stats"]["agent_status"]}
        if kind == "build":
            merged = merge_approved(original, candidates)
            try:
                ast.parse(merged)
            except SyntaxError as error:
                raise ValueError(f"The approved edits produce invalid Python on line {error.lineno}: {error.msg}") from error
            cases = {(case["source"], case_key(case)): case
                     for suite in suites.values() for case in suite["cases"]}
            suites = {"final_optimised.py": {"cases": list(cases.values()),
                                           "agent_status": "used" if any(key[0] == "agent" for key in cases) else "disabled"}}
            sources = {"final_optimised.py": merged}
        else:
            sources = {item["id"]: read_source(root / "output" / item["id"], item["stats"]["source_sha256"])
                       for item in candidates}
        proposals = {item["id"]: {"name": item["title"], "explanation": item["description"]} for item in candidates}
        return self.submit(run["filename"], original, kind=kind, uploads=uploads, sources=sources,
                           suites=suites, proposals=proposals, seed=run["seed"], parent_id=run["id"],
                           selection=selection if kind == "build" else None)

    def submit(self, name, source, *, kind="run", uploads=(), sources=None, suites=None,
               proposals=None, seed=SEED, parent_id=None, selection=None):
        with self.lock:
            if self.active is not None:
                raise RunBusyError("An optimisation run is already in progress.")
            job = {"id": uuid4().hex, "filename": name, "kind": kind,
                   "status": "generating" if kind == "run" else "correctness"}
            if parent_id:
                job["parent_run_id"] = parent_id
            if selection:
                job["selection"] = selection
            root = self.directory / job["id"]
            root.mkdir(parents=True)
            (root / "original.py").write_bytes(source.encode("utf-8"))
            if sources:
                (root / "output").mkdir()
                for filename, code in sources.items():
                    (root / "output" / filename).write_bytes(code.encode("utf-8"))
                save_json(root / "proposals.json", proposals)
            save_json(root / "job.json", job)
            self.active = job["id"]
            try:
                Thread(target=self.execute, args=(root, job, uploads, suites, seed), daemon=True).start()
            except RuntimeError:
                self.active = None
                raise
        return job

    def get(self, job_id):
        root = self.directory / job_id
        with self.lock:
            job = json.loads((root / "job.json").read_text(encoding="utf-8"))
            if job["status"] not in {"completed", "failed"} and self.active != job_id:
                job.update(status="failed", error="The server stopped before this run finished. Start a new run.")
        return root, job

    def execute(self, root, job, uploads, suites, seed):
        def update(status, **details):
            with self.lock:
                save_json(root / "job.json", {**job, "status": status, **details})
                if status in {"completed", "failed"}:
                    self.active = None

        phase = "generation"
        try:
            if job["kind"] == "run":
                generate(root)
            phase = "correctness checks"
            update("correctness")
            correctness = check_correctness(project_dir=root, seed=seed, uploads=uploads, saved_suites=suites)
            phase = "benchmarking"
            update("benchmarking")
            benchmark(correctness, project_dir=root)
            update("completed")
        except Exception as error:
            message = str(error) or type(error).__name__
            if isinstance(error, URLError):
                message = "Could not reach LM Studio. Start its local API server with a model loaded."
            try:
                update("failed", error=f"Stopped during {phase}. {message[:600]}")
            finally:
                # Release the slot if writing the failure status also failed.
                with self.lock:
                    if self.active == job["id"]:
                        self.active = None
