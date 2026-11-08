"""Generate proposals in an isolated UI run using the existing LM Studio model."""
import json
from pathlib import Path


def generate(root):
    from openai import OpenAI
    from optimisation_generator import generate as generate_stages

    settings_path = Path(__file__).resolve().parent.parent / 'gpu_runtime.json'
    settings = json.loads(settings_path.read_text(encoding='utf-8')) if settings_path.exists() else {}
    client = OpenAI(base_url=settings.get('base_url', 'http://localhost:1234/v1'),
                    api_key='lm-studio', timeout=600.0, max_retries=0)
    models = [model.id for model in client.models.list().data if 'embedding' not in model.id.lower()]
    if not models:
        raise RuntimeError('Load a chat model in LM Studio before starting optimisation.')
    preferred = settings.get('identifier')
    model = preferred if preferred in models else models[0]
    return generate_stages(client, model, (root / 'original.py').read_text(encoding='utf-8'), root / 'output')
