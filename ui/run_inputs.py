"""Validate uploaded cases and combine reviewed source edits."""

from hashlib import sha256
import json


def read_source(path, digest):
    raw = path.read_bytes()
    # Git can translate checkout line endings in the bundled saved runs.
    source = raw.replace(b"\r\n", b"\n")
    hashes = {sha256(data).hexdigest() for data in (raw, source, source.replace(b"\n", b"\r\n"))}
    if digest not in hashes:
        raise ValueError(f"{path.name} does not match the evaluated source.")
    return raw.decode("utf-8")


def uploaded_cases(uploads):
    if not isinstance(uploads, list):
        raise ValueError("Uploads must be a list of JSON files.")
    cases = []
    for upload in uploads:
        if not isinstance(upload, str) or len(upload.encode("utf-8")) > 1024 * 1024:
            raise ValueError("Each uploaded test file must be JSON and at most 1 MB.")
        try:
            data = json.loads(upload)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid test case JSON on line {error.lineno}.") from error
        batch = data.get("cases") if isinstance(data, dict) else data
        if not isinstance(batch, list) or not batch:
            raise ValueError('Include at least one case in a JSON list or a "cases" array.')
        if len(cases) + len(batch) > 1000:
            raise ValueError("Upload at most 1,000 test cases per submission.")
        for index, case in enumerate(batch, 1):
            numbers = case.get("numbers") if isinstance(case, dict) else None
            if (not isinstance(numbers, list) or len(numbers) > 10000
                    or any(type(value) is not int for value in numbers) or type(case.get("target")) is not int):
                raise ValueError(f"Case {index} needs an integer target and a list of at most 10,000 integers.")
            if "expected" in case and type(case["expected"]) is not int:
                raise ValueError(f"Case {index} needs an integer expected count.")
            name, reason = case.get("name"), case.get("reason")
            item = {"numbers": numbers, "target": case["target"], "source": "uploaded", "category": "uploaded",
                    "name": name.strip() if isinstance(name, str) and name.strip() else f"Uploaded case {index}",
                    "reason": reason.strip() if isinstance(reason, str) else ""}
            if "expected" in case:
                item["expected"] = case["expected"]
            cases.append(item)
    return cases


class PatchConflict(ValueError):
    def __init__(self, first, second):
        super().__init__(f"{first['title']} and {second['title']} edit overlapping lines.")
        self.candidates = [first["id"], second["id"]]


def source_lines(source):
    return source.replace("\r\n", "\n").split("\n")


def merge_approved(original, selected):
    edits = []
    for candidate in selected:
        for patch in candidate["patches"]:
            start = patch["start"] - 1
            edit = (start, start + patch["remove"], patch["lines"])
            edits.append((*edit, candidate))
    edits.sort(key=lambda edit: edit[:2])
    lines = source_lines(original)
    result = []
    cursor = 0
    previous = None
    for start, end, added, candidate in edits:
        if previous and (start, end, added) == previous[:3]:
            continue
        if previous and (start < cursor or start == end == previous[0] == previous[1]):
            raise PatchConflict(previous[3], candidate)
        result.extend(lines[cursor:start])
        result.extend(added)
        cursor = end
        previous = (start, end, added, candidate)
    result.extend(lines[cursor:])
    return "\n".join(result)
