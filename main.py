from openai import OpenAI

# Connect to LM Studio
client = OpenAI(
    base_url="http://localhost:1234/v1",
    api_key="lm-studio",
    timeout=120.0
)

# Automatically identify your local model
models = client.models.list()

if not models.data:
    raise RuntimeError("No models available in LM Studio")

model_id = models.data[0].id
print("Using model:", model_id)

# Original code that we want to optimise
original_code = """
def count_matches(numbers, target):
    count = 0
    for number in numbers:
        if number == target:
            count += 1
    return count
"""

# Prompt for your research agent
prompt = f"""
You are an expert Python performance optimisation researcher.

Here is the original Python code:

{original_code}

Your task:

1. Identify three DISTINCT potential optimisations.
2. Explain why each might improve performance.
3. For each optimisation, provide the FULL Python code
   with ONLY that optimisation applied to the original.
4. Do not combine optimisations.
5. Preserve the original function's behaviour.
6. Identify which optimisations might overlap.
7. Do not claim any speed improvement without benchmarking.

Format your response clearly as:
- Stage 1
- Stage 2
- Stage 3
"""

# Send prompt to the locally loaded model
response = client.chat.completions.create(
    model=model_id,
    messages=[
        {
            "role": "system",
            "content": "You are a precise Python code optimisation agent."
        },
        {
            "role": "user",
            "content": prompt
        }
    ],
    temperature=0.2
)

print("\n=== AI OPTIMISATION RESPONSE ===\n")
print(response.choices[0].message.content)
