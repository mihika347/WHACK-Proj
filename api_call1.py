
"""Generate independent optimisation proposals with LM Studio."""

from pathlib import Path
import json
import ast
import re

from targeted_test_agent import request_json
from test_utils import save_json

SYSTEM_PROMPT = """
You are an expert Python code optimisation researcher.

Your objective is to optimise Python code for execution speed
while preserving the original program's required behaviour.

An optimisation STAGE is defined as ONE distinct optimisation
applied independently to the ORIGINAL code and minimize changes to the code that are outside the scope of optimisation.

IMPORTANT RULES:

1. Every stage must start from the exact original code.
2. Apply ONLY ONE optimisation per stage.
3. Each stage must contain the COMPLETE runnable Python program.
4. Do not apply Stage 1 when constructing Stage 2.
5. Preserve the original function signatures, inputs,
   outputs and observable behaviour.
6. Stages may modify overlapping lines of code but must be able to work together.
7. Explain why each change might improve performance.
8. Identify potential conflicts between stages.
9. Produce a final version combining compatible optimisations.
10. Do not claim that a stage is faster without benchmark evidence.
11. If an optimisation changes behaviour, do not include it.
12. return all possible stages in the code

Return ONLY valid JSON with this structure:

{
  "stages": [
    {
      "stage": [number],
      "name": "Optimisation name",
      "explanation": "Why this may improve speed",
      "code": "Complete Python code with only this optimisation",
      "overlaps_with": []
    }
  ],
  "final_code": "Complete Python code with combined optimisations"
}

Do not include Markdown code fences or text outside the JSON.
"""

USER_PROMPT = """
Please optimise the code in this file for speed
whilst keeping its output and behaviour the same.

For each distinct change that could contribute to improved
speed, provide what the COMPLETE code would look like with
ONLY that change applied to the original code.

Label each change as a separate stage.

Each stage must be independently applicable to the original.

ORIGINAL CODE:

```python
{original_code}
```
"""

def generate(project_dir="."):
    root = Path(project_dir)
    original = (root / "original.py").read_text(encoding="utf-8")
    models = request_json("GET", "/models").get("data", [])
    if not models:
        raise RuntimeError("Load a model in LM Studio and start its local server.")
    model = models[0]["id"]
    print(f"Asking {model} to propose optimisations...", flush=True)
    response = request_json("POST", "/chat/completions", {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT.format(original_code=original)},
        ],
        "temperature": 0.2,
    }, timeout=600)
    result_text = response["choices"][0]["message"]["content"]
    if not result_text:
        raise RuntimeError("Model returned an empty response.")
    result_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", result_text.strip())
    try:
        result = json.loads(result_text)
    except json.JSONDecodeError as error:
        (root / "raw_response.txt").write_text(result_text, encoding="utf-8")
        raise ValueError("Model returned invalid JSON. Response saved to raw_response.txt.") from error

    stages = result["stages"]
    if not isinstance(stages, list):
        raise ValueError("Model response must contain a list of stages.")
    seen = set()
    for stage in stages:
        number = stage["stage"]
        if type(number) is not int or number < 1 or number in seen:
            raise ValueError("Model response must use unique positive stage numbers.")
        if not all(isinstance(stage[field], str) for field in ("name", "explanation", "code")):
            raise ValueError("Each stage must contain a name, explanation, and Python source.")
        seen.add(number)
        stage["code"] = stage["code"].replace("\r\n", "\n")
        ast.parse(stage["code"])
    result["final_code"] = result["final_code"].replace("\r\n", "\n")
    ast.parse(result["final_code"])

    output = root / "output"
    output.mkdir(exist_ok=True)
    for stage in stages:
        filename = output / f"stage_{stage['stage']}.py"
        filename.write_text(stage["code"], encoding="utf-8")
        print(f"Stage {stage['stage']}: {stage['name']}\n{stage['explanation']}\nSaved: {filename}")
    (output / "final_optimised.py").write_text(result["final_code"], encoding="utf-8")
    save_json(output / "report.json", result)
    print(f"Saved {len(stages)} proposed changes to {output}.")
    return result


if __name__ == "__main__":
    generate()
