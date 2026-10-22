"""Axios AI interface.

Three operations, each JSON in -> JSON out, backed by whichever LLM provider is set in .env
(see providers.py; currently Google AI Studio / Gemini):

  1. profile  - takes the user's description of their disabilities / difficulties / requirements
                (plus a free-text "extras" box) and trims it to a concise list of needs. Nothing is
                stored here: the extension keeps the profile and sends it with every job request.
  2. rate     - takes a job listing (shape produced by extension/content.js: {"url", "title", "description", ...})
                plus the profile, and returns a 1-10 suitability rating, the work conditions, and a
                flag if the description is too vague to judge.
  3. guide    - takes a job listing plus the profile and returns an application guide: process,
                attire, unspoken rules and tips, tailored to the user's needs.

Usage:
    configure the provider and key in ai interface/.env (see .env.example)
    python main.py profile user.json -o profile.json
    python main.py rate job.json --profile profile.json [-o out.json]
    python main.py guide job.json --profile profile.json [-o out.json]
    cat job.json | python main.py rate --profile profile.json
"""

import argparse
import json
import os
import re
import sys

import providers  # also loads ai interface/.env


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


def extract_json(text):
    """Pull the first JSON object out of the model's reply (models sometimes wrap it in ``` fences)."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def ask(system_prompt, user_content, model=None):
    """Send one request and return the parsed JSON reply, or an error object if parsing fails."""
    reply = providers.complete(system_prompt, json.dumps(user_content, ensure_ascii=False), model=model)
    try:
        return extract_json(reply)
    except json.JSONDecodeError:
        return {"error": "model did not return valid JSON", "raw": reply}


# --- 1. profile -------------------------------------------------------------

def build_profile(user_input, model=None):
    """Condense the user's free-form input into a list of needs. The caller stores the result."""
    return ask(PROFILE_PROMPT, user_input, model=model)


def check_profile(profile):
    if not isinstance(profile, dict) or not isinstance(profile.get("needs"), list):
        raise RuntimeError('profile must be the object returned by /profile, e.g. {"needs": [...], "preferences": [...], "language": "..."}')


def profile_prefix(profile):
    lines = [f"- {n}" for n in profile.get("needs", [])]
    lines += [f"- (preference) {p}" for p in profile.get("preferences", [])]
    return "\n".join(lines) or "- (no specific needs given)"


# --- 2. rate ----------------------------------------------------------------

def rate_job(job, profile, model=None):
    """Rate a job listing against the user's needs and describe its work conditions."""
    check_profile(profile)
    prompt = RATE_PROMPT.format(profile=profile_prefix(profile), language=profile.get("language", "Romanian"))
    result = ask(prompt, job, model=model)
    if "error" in result:
        result["source_url"] = job.get("url")
        return result

    try:
        result["rating"] = max(1, min(10, int(result.get("rating", 5))))
    except (TypeError, ValueError):
        result["rating"] = None

    description = (job.get("description") or job.get("text") or "").strip()
    if len(description) < MIN_DESCRIPTION_CHARS:
        result["vague"] = True
        result.setdefault("vague_details", []).append(
            f"description is very short ({len(description)} characters)"
        )

    result["source_url"] = job.get("url")
    return result


# --- 3. guide ---------------------------------------------------------------

def application_guide(job, profile, model=None):
    """Produce an application guide for a job listing, tailored to the user's needs."""
    check_profile(profile)
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
    parser = argparse.ArgumentParser(description="Axios AI interface.")
    parser.add_argument("command", choices=COMMANDS, help="operation to run")
    parser.add_argument("input", nargs="?", help="input JSON file (default: stdin)")
    parser.add_argument("-o", "--output", help="output JSON file (default: stdout)")
    parser.add_argument("-p", "--profile", help="profile JSON file (output of the 'profile' command); required for rate/guide")
    parser.add_argument("-m", "--model", help="override AI_MODEL from .env for this run")
    args = parser.parse_args()
    if args.command != "profile" and not args.profile:
        parser.error(f"'{args.command}' needs --profile")

    if args.input:
        with open(args.input, encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    if args.command == "profile":
        result = build_profile(data, model=args.model)
    else:
        with open(args.profile, encoding="utf-8") as f:
            profile = json.load(f)
        result = COMMANDS[args.command](data, profile, model=args.model)
    out = json.dumps(result, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out + "\n")
    else:
        print(out)


if __name__ == "__main__":
    main()
