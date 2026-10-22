"""Provider-agnostic LLM calls for Axios.

Everything is configured from `ai interface/.env`; switching provider or model never needs a code change:

    AI_PROVIDER=gemini                 # see PROVIDERS below
    AI_MODEL=gemini-3.5-flash          # optional, each provider has a default
    AI_FALLBACK_MODELS=a,b             # optional, tried in order when the model is overloaded
    AI_API_KEY=...                     # optional, otherwise the provider's own variable is used
                                       # (GEMINI_API_KEY, OPENAI_API_KEY, HF_TOKEN, ...), so several
                                       # keys can live in .env side by side
    AI_BASE_URL=...                    # optional, overrides the provider's endpoint
    AI_THINKING=minimal                # optional, how much the model thinks before answering; empty = model default
                                       #   gemini: thinkingLevel (minimal/low/medium/high)
                                       #   anthropic: effort (low/medium/high/xhigh/max)
    AI_MODEL_PROFILE=... AI_MODEL_RATE=... AI_MODEL_GUIDE=...
                                       # optional, a different model for one operation (same provider)
    AI_THINKING_PROFILE=... AI_THINKING_RATE=... AI_THINKING_GUIDE=...
                                       # optional, a different thinking level for one operation

Supported providers:
    gemini      Google AI Studio (native API, no extra packages)
    anthropic   Claude (official `anthropic` SDK: pip install -r requirements.txt)
    openai, huggingface, groq, openrouter, mistral, deepseek, ollama, lmstudio
                anything speaking the OpenAI /chat/completions format; for an unlisted one use
                AI_PROVIDER=openai_compatible with AI_BASE_URL and AI_API_KEY.

To add a new API style, write a function `(config, system_prompt, user_text, model, schema=None) -> str`
and register it in PROVIDERS. `schema` is the JSON schema the reply must follow; a style that can enforce
it server-side should (anthropic does), the others rely on the prompt and their JSON mode.
"""

import functools
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

RETRYABLE_STATUS = {429, 500, 502, 503, 504, 529}  # 529 = Anthropic "overloaded"
TIMEOUT_SECONDS = 120
MAX_TOKENS = 8192
TEMPERATURE = 0.2


def load_dotenv(path=Path(__file__).with_name(".env")):
    """Load KEY=value lines from `ai interface/.env` into the environment.

    A key set later in the file overrides an earlier one; real env vars take priority over the file.
    """
    if not path.exists():
        return
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.split(" #")[0].strip().strip('"').strip("'")
    for key, value in values.items():
        os.environ.setdefault(key, value)


load_dotenv()


class ProviderError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status

    @property
    def retryable(self):
        return self.status in RETRYABLE_STATUS or self.status is None


def _post_json(url, headers, payload, provider):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise ProviderError(f"{provider} API error {e.code}: {detail}", status=e.code) from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise ProviderError(f"{provider} API unreachable: {e}") from e


# --- API styles ---------------------------------------------------------------

def _gemini(config, system_prompt, user_text, model, schema=None):
    generation_config = {
        "temperature": TEMPERATURE,
        "maxOutputTokens": MAX_TOKENS,
        "responseMimeType": "application/json",
    }
    if config["thinking"]:
        generation_config["thinkingConfig"] = {"thinkingLevel": config["thinking"]}
    body = _post_json(
        f"{config['base_url']}/models/{model}:generateContent",
        {"x-goog-api-key": config["api_key"]},
        {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "generationConfig": generation_config,
        },
        config["name"],
    )
    candidates = body.get("candidates") or []
    if not candidates:
        raise ProviderError(f"{config['name']} API error: no response ({body.get('promptFeedback', body)})", status=400)
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


@functools.lru_cache(maxsize=4)
def _anthropic_client(api_key, base_url):
    import anthropic
    # complete() does the retrying and model fallback, so the SDK's own retries are off
    return anthropic.Anthropic(api_key=api_key, base_url=base_url, timeout=TIMEOUT_SECONDS, max_retries=0)


def _anthropic(config, system_prompt, user_text, model, schema=None):
    try:
        import anthropic
    except ImportError:
        raise ProviderError("AI_PROVIDER=anthropic needs the 'anthropic' package: "
                            "pip install -r requirements.txt (in the project's .venv)", status=400)

    output_config = {}
    if config["thinking"]:
        output_config["effort"] = config["thinking"]
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}  # reply is guaranteed to match
    extra = {"output_config": output_config} if output_config else {}
    try:
        response = _anthropic_client(config["api_key"], config["base_url"]).messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": user_text}],
            **extra,
        )
    except anthropic.APIStatusError as e:
        raise ProviderError(f"{config['name']} API error {e.status_code}: {e.message}", status=e.status_code) from e
    except anthropic.APIConnectionError as e:
        raise ProviderError(f"{config['name']} API unreachable: {e}") from e

    if response.stop_reason == "refusal":
        raise ProviderError(f"{config['name']} declined the request ({response.stop_details})", status=400)
    return "".join(block.text for block in response.content if block.type == "text")


def _openai_compatible(config, system_prompt, user_text, model, schema=None):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }
    if config.get("json_mode"):
        payload["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {config['api_key']}"} if config["api_key"] else {}
    body = _post_json(f"{config['base_url']}/chat/completions", headers, payload, config["name"])
    return body["choices"][0]["message"]["content"] or ""


# --- provider registry --------------------------------------------------------
# style: which function above talks to it; key_env: where its key is read from when AI_API_KEY is unset;
# json_mode: whether it accepts response_format=json_object; model: default when AI_MODEL is unset.

PROVIDERS = {
    "gemini": {
        "style": _gemini, "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "key_env": "GEMINI_API_KEY", "model": "gemini-3.5-flash", "thinking": "minimal",
        "fallback_models": "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
    },
    "anthropic": {
        "style": _anthropic, "base_url": "https://api.anthropic.com",
        "key_env": "ANTHROPIC_API_KEY", "model": "claude-haiku-5-5", "thinking": "low",
    },
    "openai": {
        "style": _openai_compatible, "base_url": "https://api.openai.com/v1",
        "key_env": "OPENAI_API_KEY", "json_mode": True,
    },
    "huggingface": {
        "style": _openai_compatible, "base_url": "https://router.huggingface.co/v1",
        "key_env": "HF_TOKEN", "model": "openai/gpt-oss-120b",
    },
    "groq": {
        "style": _openai_compatible, "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY", "json_mode": True, "model": "openai/gpt-oss-120b",
    },
    "openrouter": {
        "style": _openai_compatible, "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
    },
    "mistral": {
        "style": _openai_compatible, "base_url": "https://api.mistral.ai/v1",
        "key_env": "MISTRAL_API_KEY", "json_mode": True,
    },
    "deepseek": {
        "style": _openai_compatible, "base_url": "https://api.deepseek.com/v1",
        "key_env": "DEEPSEEK_API_KEY", "json_mode": True,
    },
    "ollama": {  # local, no key needed
        "style": _openai_compatible, "base_url": "http://localhost:11434/v1",
        "key_env": None, "json_mode": True,
    },
    "lmstudio": {  # local, no key needed
        "style": _openai_compatible, "base_url": "http://localhost:1234/v1",
        "key_env": None,
    },
    "openai_compatible": {  # anything else: set AI_BASE_URL, AI_API_KEY and AI_MODEL
        "style": _openai_compatible, "base_url": None, "key_env": None,
    },
}


def get_config():
    """Resolve the active provider settings from the environment."""
    name = os.environ.get("AI_PROVIDER", "gemini").strip().lower()
    if name not in PROVIDERS:
        raise ProviderError(f"unknown AI_PROVIDER '{name}'; choose one of: {', '.join(PROVIDERS)}", status=400)
    preset = PROVIDERS[name]

    config = {
        "name": name,
        "style": preset["style"],
        "json_mode": preset.get("json_mode", False),
        "base_url": (os.environ.get("AI_BASE_URL") or preset["base_url"] or "").rstrip("/"),
        "api_key": os.environ.get("AI_API_KEY") or (os.environ.get(preset["key_env"]) if preset["key_env"] else None),
        "model": os.environ.get("AI_MODEL") or preset.get("model"),
        "thinking": os.environ.get("AI_THINKING", preset.get("thinking", "")).strip(),
        "fallback_models": [m.strip() for m in os.environ.get("AI_FALLBACK_MODELS", preset.get("fallback_models", "")).split(",") if m.strip()],
    }
    if not config["base_url"]:
        raise ProviderError(f"AI_BASE_URL is required for provider '{name}'", status=400)
    if preset["key_env"] and not config["api_key"]:
        raise ProviderError(f"no API key for '{name}': set {preset['key_env']} or AI_API_KEY in 'ai interface/.env'", status=400)
    return config


def describe():
    """Short summary of the active provider for logs / health checks (never includes the key)."""
    name = os.environ.get("AI_PROVIDER", "gemini").strip().lower()
    preset = PROVIDERS.get(name, {})
    return {"provider": name, "model": os.environ.get("AI_MODEL") or preset.get("model")}


def complete(system_prompt, user_text, model=None, task=None, schema=None):
    """Send one system + user message and return the reply text.

    `task` (e.g. "rate") picks up AI_MODEL_<TASK> / AI_THINKING_<TASK> from .env when set, so one
    operation can use a different model or thinking level than the rest.

    Retries temporary failures (rate limits, overload) and then moves on to AI_FALLBACK_MODELS.
    A model that does not exist (404) or is out of quota (429) is skipped straight away.
    """
    config = get_config()
    if task and f"AI_THINKING_{task.upper()}" in os.environ:
        config["thinking"] = os.environ[f"AI_THINKING_{task.upper()}"].strip()
    model = model or (task and os.environ.get(f"AI_MODEL_{task.upper()}")) or config["model"]
    if not model:
        raise ProviderError(f"no default model for '{config['name']}'; set AI_MODEL in 'ai interface/.env'", status=400)

    last_error = None
    for m in [model] + [f for f in config["fallback_models"] if f != model]:
        for attempt in range(2):
            try:
                return config["style"](config, system_prompt, user_text, m, schema=schema)
            except ProviderError as e:
                last_error = ProviderError(f"{e} (model: {m})", status=e.status)
                if e.status in (404, 429):  # model gone / quota used up: go straight to the next model
                    break
                if not e.retryable:
                    raise last_error from e
                time.sleep(1 + attempt * 2)
    raise last_error
