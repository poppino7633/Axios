"""Axios AI interface.

Three operations, each JSON in -> JSON out, backed by a free Hugging Face hosted model:

  1. profile  - takes the user's description of their disabilities / difficulties / requirements
                (plus a free-text "extras" box), trims it to a concise list of needs and saves it
                locally. The saved profile is used as context for the other two operations.
  2. rate     - takes a job listing (shape produced by content.js: {"url", "title", "text"}) and
                returns a 1-10 suitability rating, the work conditions, and a flag if the
                description is too vague to judge.
  3. guide    - takes a job listing and returns an application guide: process, attire,
                unspoken rules and tips, tailored to the user's needs.

Usage:
    put HF_TOKEN=hf_... in ai interface/.env (see .env.example)
    python main.py profile user.json
    python main.py rate job.json [-o out.json]
    python main.py guide job.json [-o out.json]
    cat job.json | python main.py rate
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


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

HF_API_URL = "https://router.huggingface.co/v1/chat/completions"
DEFAULT_MODEL = os.environ.get("HF_MODEL", "openai/gpt-oss-120b")
PROFILE_PATH = Path(os.environ.get("AXIOS_PROFILE", Path(__file__).with_name("profile.json")))

# Descriptions shorter than this are flagged as vague regardless of what the model says.
MIN_DESCRIPTION_CHARS = 300

PROFILE_PROMPT = """You turn a person's description of their disabilities, difficulties and workplace requirements
into a concise list of concrete needs that can be checked against a job posting.
Rules:
- Remove filler, repetition and emotional framing; keep every actual need or limitation.
- Each need is one short, specific phrase (e.g. "no heavy lifting", "wheelchair-accessible workplace",
  "flexible hours for medical appointments").
- Do not invent needs the person did not state or clearly imply.
- Write in the same language the person used.
Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "needs": [string],          // concise list of needs / limitations
  "preferences": [string],    // things they would like but are not strict requirements
  "language": string          // language the person wrote in, e.g. "Romanian"
}"""

RATE_PROMPT = """You assess how suitable a job posting is for a specific person.

The person's needs:
{profile}

Rules:
- Base everything on the posting text. You may add conditions that are inherent to the type of job
  (e.g. construction work involves heavy physical labour, a call-centre job involves long phone calls),
  but mark those as "typical" rather than "stated". Never invent specifics such as salary, schedule,
  location, benefits or equipment that the posting does not mention.
- If the posting relies on vague phrases instead of facts (e.g. "salariu motivant", "loc de muncă plăcut",
  "echipă tânără și dinamică", "competitive salary") or omits basic information (schedule, location,
  physical demands, pay), set "vague" to true and list what is vague or missing.
- The rating is 1-10: 10 = clearly compatible with every need, 1 = clearly incompatible.
  When information is missing, do not assume the best or the worst; keep the rating moderate and say why.
- Write all text in {language}.

Respond with ONLY a JSON object, no prose, no markdown fences:
{{
  "rating": integer,                  // 1-10
  "rating_explanation": string,
  "work_conditions": [
    {{"condition": string, "source": "stated" | "typical"}}
  ],
  "compatible_with_needs": [string],  // needs this job appears to satisfy, and why
  "conflicts_with_needs": [string],   // needs this job appears to violate, and why
  "unknown_for_needs": [string],      // needs the posting gives no information about
  "vague": boolean,
  "vague_details": [string]           // vague phrases quoted from the posting / missing information
}}"""

GUIDE_PROMPT = """You help a specific person apply for a job.

The person's needs:
{profile}

Write a practical application guide for the job posting you receive.
Rules:
- Be specific to this job, this industry and the country of the posting (default: Romania).
- Cover the typical application process, appropriate attire for the interview, unspoken rules and etiquette,
  and other helpful tips.
- Include advice on whether, when and how to discuss the person's needs or request accommodations,
  given the person's needs above. Mention relevant rights only if you are confident they apply.
- Do not invent facts about the employer that are not in the posting.
- Write all text in {language}.

Respond with ONLY a JSON object, no prose, no markdown fences:
{{
  "application_steps": [string],      // ordered steps, from preparing the CV to following up
  "documents_to_prepare": [string],
  "attire": string,
  "unspoken_rules": [string],
  "interview_tips": [string],
  "accommodation_advice": [string],
  "questions_to_ask_employer": [string]  // questions that clarify things relevant to the person's needs
}}"""


def call_hf(messages, model=DEFAULT_MODEL, max_tokens=4000, temperature=0.2):
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN environment variable is not set")

    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode("utf-8")

    req = urllib.request.Request(
        HF_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Hugging Face API error {e.code}: {e.read().decode('utf-8', 'replace')}") from e

    return body["choices"][0]["message"]["content"]


def extract_json(text):
    """Pull the first JSON object out of the model's reply (models sometimes wrap it in ``` fences)."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def ask(system_prompt, user_content, model=DEFAULT_MODEL):
    """Send one request and return the parsed JSON reply, or an error object if parsing fails."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
    ]
    reply = call_hf(messages, model=model)
    try:
        return extract_json(reply)
    except json.JSONDecodeError:
        return {"error": "model did not return valid JSON", "raw": reply}


# --- 1. profile -------------------------------------------------------------

def build_profile(user_input, model=DEFAULT_MODEL, path=PROFILE_PATH):
    """Condense the user's free-form input into a list of needs and save it to `path`."""
    profile = ask(PROFILE_PROMPT, user_input, model=model)
    if "error" not in profile:
        Path(path).write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return profile


def load_profile(path=PROFILE_PATH):
    path = Path(path)
    if not path.exists():
        raise RuntimeError(f"no saved profile at {path}; run the 'profile' command first")
    return json.loads(path.read_text(encoding="utf-8"))


def profile_prefix(profile):
    lines = [f"- {n}" for n in profile.get("needs", [])]
    lines += [f"- (preference) {p}" for p in profile.get("preferences", [])]
    return "\n".join(lines) or "- (no specific needs given)"


# --- 2. rate ----------------------------------------------------------------

def rate_job(job, profile=None, model=DEFAULT_MODEL):
    """Rate a job listing against the user's needs and describe its work conditions."""
    profile = profile or load_profile()
    prompt = RATE_PROMPT.format(profile=profile_prefix(profile), language=profile.get("language", "Romanian"))
    result = ask(prompt, job, model=model)
    if "error" in result:
        result["source_url"] = job.get("url")
        return result

    try:
        result["rating"] = max(1, min(10, int(result.get("rating", 5))))
    except (TypeError, ValueError):
        result["rating"] = None

    description = (job.get("text") or "").strip()
    if len(description) < MIN_DESCRIPTION_CHARS:
        result["vague"] = True
        result.setdefault("vague_details", []).append(
            f"description is very short ({len(description)} characters)"
        )

    result["source_url"] = job.get("url")
    return result


# --- 3. guide ---------------------------------------------------------------

def application_guide(job, profile=None, model=DEFAULT_MODEL):
    """Produce an application guide for a job listing, tailored to the user's needs."""
    profile = profile or load_profile()
    prompt = GUIDE_PROMPT.format(profile=profile_prefix(profile), language=profile.get("language", "Romanian"))
    result = ask(prompt, job, model=model)
    result["source_url"] = job.get("url")
    return result


# --- CLI --------------------------------------------------------------------

COMMANDS = {
    "profile": build_profile,
    "rate": rate_job,
    "guide": application_guide,
}


def main():
    parser = argparse.ArgumentParser(description="Axios AI interface (Hugging Face backed).")
    parser.add_argument("command", choices=COMMANDS, help="operation to run")
    parser.add_argument("input", nargs="?", help="input JSON file (default: stdin)")
    parser.add_argument("-o", "--output", help="output JSON file (default: stdout)")
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL, help=f"HF model id (default: {DEFAULT_MODEL})")
    args = parser.parse_args()

    if args.input:
        with open(args.input, encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    result = COMMANDS[args.command](data, model=args.model)
    out = json.dumps(result, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out + "\n")
    else:
        print(out)


if __name__ == "__main__":
    main()
