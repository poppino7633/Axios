"""Provider-agnostic LLM calls for Axios.

Everything is configured from `ai interface/.env`; switching provider or model never needs a code change:

    AI_PROVIDER=gemini                 # see PROVIDERS below
    AI_MODEL=gemini-flash-latest       # optional, each provider has a default
    AI_FALLBACK_MODELS=a,b             # optional, tried in order when the model is overloaded
    AI_API_KEY=...                     # optional, otherwise the provider's own variable is used
                                       # (GEMINI_API_KEY, OPENAI_API_KEY, HF_TOKEN, ...), so several
                                       # keys can live in .env side by side
    AI_BASE_URL=...                    # optional, overrides the provider's endpoint

Supported providers:
    gemini      Google AI Studio (native API)
    anthropic   Claude (native API)
    openai, huggingface, groq, openrouter, mistral, deepseek, ollama, lmstudio
                anything speaking the OpenAI /chat/completions format; for an unlisted one use
                AI_PROVIDER=openai_compatible with AI_BASE_URL and AI_API_KEY.

To add a new API style, write a function `(config, system_prompt, user_text, model) -> str` and
register it in PROVIDERS.
"""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
TIMEOUT_SECONDS = 120
MAX_TOKENS = 8192
TEMPERATURE = 0.2


def load_dotenv(path=Path(__file__).with_name(".env")):
    """Load KEY=value lines from `ai interface/.env` into the environment (real env vars take priority)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


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

def _gemini(config, system_prompt, user_text, model):
    body = _post_json(
        f"{config['base_url']}/models/{model}:generateContent",
        {"x-goog-api-key": config["api_key"]},
        {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "generationConfig": {
                "temperature": TEMPERATURE,
                "maxOutputTokens": MAX_TOKENS,
                "responseMimeType": "application/json",
            },
        },
        config["name"],
    )
    candidates = body.get("candidates") or []
    if not candidates:
        raise ProviderError(f"{config['name']} API error: no response ({body.get('promptFeedback', body)})", status=400)
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


def _anthropic(config, system_prompt, user_text, model):
    body = _post_json(
        f"{config['base_url']}/messages",
        {"x-api-key": config["api_key"], "anthropic-version": "2023-06-01"},
        {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_text}],
        },
        config["name"],
    )
    return "".join(block.get("text", "") for block in body.get("content", []) if block.get("type") == "text")


def _openai_compatible(config, system_prompt, user_text, model):
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
        "key_env": "GEMINI_API_KEY", "model": "gemini-flash-latest",
        "fallback_models": "gemini-flash-lite-latest,gemini-2.5-flash",
    },
    "anthropic": {
        "style": _anthropic, "base_url": "https://api.anthropic.com/v1",
        "key_env": "ANTHROPIC_API_KEY", "model": "claude-haiku-5-5",
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


def complete(system_prompt, user_text, model=None):
    """Send one system + user message and return the reply text.

    Retries temporary failures (rate limits, overload) and then moves on to AI_FALLBACK_MODELS.
    """
    config = get_config()
    model = model or config["model"]
    if not model:
        raise ProviderError(f"no default model for '{config['name']}'; set AI_MODEL in 'ai interface/.env'", status=400)

    last_error = None
    for m in [model] + [f for f in config["fallback_models"] if f != model]:
        for attempt in range(2):
            try:
                return config["style"](config, system_prompt, user_text, m)
            except ProviderError as e:
                last_error = ProviderError(f"{e} (model: {m})", status=e.status)
                if not e.retryable:
                    raise last_error from e
                time.sleep(1 + attempt * 2)
    raise last_error
