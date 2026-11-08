
from openai import OpenAI
from pathlib import Path
import json
import ast
import re

# ==========================================
# CONFIGURATION
# ==========================================

INPUT_FILE = Path("original.py")
OUTPUT_DIR = Path("output")

client = OpenAI(
    base_url="http://localhost:1234/v1",
    api_key="lm-studio",
    timeout=600.0
)

OUTPUT_DIR.mkdir(exist_ok=True)

# ==========================================
# READ ORIGINAL CODE
# ==========================================

original_code = INPUT_FILE.read_text(encoding="utf-8")

# Detect the model running in LM Studio
models = client.models.list()

if not models.data:
    raise RuntimeError("No model available in LM Studio.")

model_id = models.data[0].id

print(f"Using model: {model_id}")

# ==========================================
# CREATE THE PROMPT
# ==========================================

system_prompt = """
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

user_prompt = f"""
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

# ==========================================
# CALL LM STUDIO API
# ==========================================

print("Asking AI to optimise code...")

from full_stage_generation import generate_result

try:
    result = generate_result(
        client, model_id, original_code, system_prompt, user_prompt, OUTPUT_DIR
    )
except KeyboardInterrupt:
    print("\nGeneration cancelled. Existing output files were not changed.")
    raise SystemExit(130)

# ==========================================
# SAVE EACH INDEPENDENT STAGE
# ==========================================

for stage in result["stages"]:

    stage_number = int(stage["stage"])
    stage_code = stage["code"]

    # Basic Python syntax check
    ast.parse(stage_code)

    filename = OUTPUT_DIR / f"stage_{stage_number}.py"
    filename.write_text(stage_code, encoding="utf-8")

    print(f"\nStage {stage_number}: {stage['name']}")
    print(stage["explanation"])
    print(f"Saved: {filename}")

# ==========================================
# SAVE FINAL OPTIMISED CODE
# ==========================================

final_code = result["final_code"]

ast.parse(final_code)

final_file = OUTPUT_DIR / "final_optimised.py"
final_file.write_text(final_code, encoding="utf-8")

# Save explanations and overlap details
report_file = OUTPUT_DIR / "report.json"
report_file.write_text(
    json.dumps(result, indent=2),
    encoding="utf-8"
)

print("\n=================================")
print("Optimisation generation complete!")
print("=================================")

print(f"Stages created: {len(result['stages'])}")
print(f"Final code: {final_file}")
print(f"Report: {report_file}")
print("\nIMPORTANT: These are proposed optimisations.")
print("Run correctness tests and benchmarks before acceptance.")
