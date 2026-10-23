"""Axios AI interface.

Four operations, each JSON in -> JSON out, backed by whichever LLM provider is set in .env
(see providers.py):

  1. profile  - takes the user's description of their disabilities / difficulties / requirements
                (plus a free-text "extras" box) and trims it to a concise list of needs. Nothing is
                stored here: the extension keeps the profile and sends it with every job request.
  2. rate     - takes a job listing (shape produced by extension/content.js: {"url", "title", "description", ...})
                plus the profile, and returns a 1-10 suitability rating, the work conditions, and a
                flag if the description is too vague to judge.
  3. guide    - takes a job listing plus the profile and returns a short step-by-step application
                guide; only the sections this person needs are filled, the rest are null.
  4. screen   - (experimental) takes a list of {"title", "company"} pairs plus the profile and makes a
                quick, lenient first-pass guess per job: 1 = fail, 2 = not confident, 3 = pass.
                Returns a list of ratings in the same order as the jobs.

Every reply is checked against a JSON schema: Claude enforces it server-side, and the shape checks
below repair anything another provider gets wrong, so the extension always gets the documented shape.

Usage:
    configure the provider and key in ai interface/.env (see .env.example)
    python main.py profile user.json -o profile.json
    python main.py rate job.json --profile profile.json [-o out.json]
    python main.py guide job.json --profile profile.json [-o out.json]
    python main.py screen jobs.json --profile profile.json [-o out.json]
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

PROFILE_PROMPT = """Compress a person's description of their disabilities, difficulties and requirements into the
shortest list of workplace needs that can be checked against a job posting.
Rules:
- Each item is a short workplace condition (2-6 words), not a diagnosis (e.g. "no heavy lifting",
  "mostly seated work", "can change position", "commute max 30 min").
- Merge only items that say the same thing ("can't stand long" + "needs to sit" = "mostly seated work").
  Keep every distinct limitation or request, and keep numbers and limits exactly.
- Keep the person's meaning: "not on the phone all day" is "limited phone work", not "no phone calls".
- Also keep help they ask for with applying, as a need (e.g. "unsure what to wear" = "interview attire
  guidance", "doesn't know how to act" = "interview etiquette guidance").
- Drop filler, feelings, medical detail and anything irrelevant to a job.
- needs = what they need or cannot do; preferences = what they "would like" or "prefer", plus skills.
- Do not invent needs. Write items in the person's language; "language" is its English name (e.g. "Romanian").
Respond with ONLY this JSON:
{"needs": [string], "preferences": [string], "language": string}"""

RATE_PROMPT = """Rate how suitable this job posting is for a person with these needs:
{profile}

Rules:
- Always list the conditions inherent to the job title/type, marked "typical" (e.g. "muncitor" or
  construction = heavy physical labour, standing; call centre = long phone calls), and judge the needs
  against them too. Everything else must come from the posting ("stated"); never invent salary,
  schedule, location or benefits.
- work_conditions are concrete facts about the work (tasks, hours, place, physical demands), never
  buzzwords: "salariu motivant", "loc de muncă plăcut", "echipă dinamică" go only in vague_details.
- Vague phrases instead of facts ("salariu motivant", "loc de muncă plăcut", ...) or missing basics
  (pay, schedule, location, physical demands) mean "vague": true.
- Rating 1-10 (10 = fits every need). Missing information keeps it moderate, not high or low.
- Be brief: short phrases, at most 5 work conditions. Write in {language}.

Respond with ONLY this JSON:
{{
  "rating": integer,
  "rating_explanation": string,       // 1-2 sentences
  "work_conditions": [{{"condition": string, "source": "stated" | "typical"}}],
  "conflicts_with_needs": [string],   // needs this job violates
  "vague": boolean,
  "vague_details": [string]           // vague phrases quoted, or missing information
}}"""

# Optional guide sections, in display order. The ones a person doesn't need come back as null.
GUIDE_SECTIONS = [
    "travel_and_access",      # getting to the interview, step-free venue, accessible room
    "interview_format",       # communication format, written/remote options, assistive tools
    "sensory_comfort",        # noise, light, breaks around the interview
    "attire",                 # what to wear
    "etiquette",              # what to expect, unspoken rules, small talk
    "disclosure",             # whether/when/how to mention needs and ask for adjustments
    "schedule_and_health",    # timing, breaks, medical appointments, energy
]

GUIDE_PROMPT = """Write a short, step-by-step application guide for this job posting, for a person with:
{profile}

Fill only the sections this person actually needs (usually 2-4) and set every other section to null.
For example: reduced mobility -> travel_and_access; neurodivergence / anxiety -> etiquette, attire,
sensory_comfort, interview_format; hearing or vision -> interview_format; chronic illness / pain ->
schedule_and_health, disclosure. Use attire for someone with only physical needs only if the job itself
has a dress expectation worth knowing.

Rules:
- Every step is one short, clear instruction (max ~15 words), in the order the person does it.
- Be specific to this job and country (default: Romania). Don't invent facts about the employer.
- Rights only in general terms ("you can ask for flexible hours"); never cite laws, articles or amounts.
- Write in {language}.

Respond with ONLY this JSON (each section: 2-4 steps, or null):
{{
  "application_steps": [string],         // 4-6 steps, from preparing the CV to following up
  "travel_and_access": [string] | null,
  "interview_format": [string] | null,
  "sensory_comfort": [string] | null,
  "attire": [string] | null,
  "etiquette": [string] | null,
  "disclosure": [string] | null,
  "schedule_and_health": [string] | null,
  "questions_to_ask_employer": [string]  // max 3, about this person's needs
}}"""

SCREEN_PROMPT = """Make a quick first-pass guess, from the title and company only, of whether each job could
suit a person with these needs:
{profile}

Rate each job:
- 1 = fail: the kind of work itself clearly clashes with a need (e.g. reduced mobility -> warehouse,
  construction, courier or other blue-collar physical work; hearing loss -> call centre).
- 3 = pass: nothing about this kind of work clashes with any need.
- 2 = not confident: the title is unclear, or it depends on details a title doesn't show.
This is a very lenient filter: only fail a job when the clash is obvious. Never fail it for missing
information (salary, schedule, location).

The input is a JSON list of jobs. Return exactly one rating per job, in the same order.
Respond with ONLY this JSON:
{{"ratings": [integer]}}"""

# Rating used for a job the model skipped or rated with something other than 1-3.
SCREEN_UNSURE = 2


# JSON schemas for the replies (enforced by providers that support it, e.g. Claude).
STRINGS = {"type": "array", "items": {"type": "string"}}
STRINGS_OR_NULL = {"anyOf": [STRINGS, {"type": "null"}]}


def object_schema(properties):
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


PROFILE_SCHEMA = object_schema({"needs": STRINGS, "preferences": STRINGS, "language": {"type": "string"}})

RATE_SCHEMA = object_schema({
    "rating": {"type": "integer", "enum": list(range(1, 11))},
    "rating_explanation": {"type": "string"},
    "work_conditions": {"type": "array", "items": object_schema({
        "condition": {"type": "string"},
        "source": {"type": "string", "enum": ["stated", "typical"]},
    })},
    "conflicts_with_needs": STRINGS,
    "vague": {"type": "boolean"},
    "vague_details": STRINGS,
})

SCREEN_SCHEMA = object_schema({
    "ratings": {"type": "array", "items": {"type": "integer", "enum": [1, 2, 3]}},
})

GUIDE_SCHEMA = object_schema({
    "application_steps": STRINGS,
    **{section: STRINGS_OR_NULL for section in GUIDE_SECTIONS},
    "questions_to_ask_employer": STRINGS,
})


def string_list(value):
    """A list of non-empty strings, whatever the model actually sent."""
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, (str, int, float)) and str(item).strip()]


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


def ask(system_prompt, user_content, model=None, task=None, schema=None):
    """Send one request and return the parsed JSON object, or an error object if there isn't one."""
    reply = providers.complete(system_prompt, json.dumps(user_content, ensure_ascii=False),
                               model=model, task=task, schema=schema)
    try:
        result = extract_json(reply)
    except json.JSONDecodeError:
        return {"error": "model did not return valid JSON", "raw": reply}
    if not isinstance(result, dict):
        return {"error": "model did not return a JSON object", "raw": reply}
    return result


# --- 1. profile -------------------------------------------------------------

def build_profile(user_input, model=None):
    """Condense the user's free-form input into a list of needs. The caller stores the result."""
    result = ask(PROFILE_PROMPT, user_input, model=model, task="profile", schema=PROFILE_SCHEMA)
    if "error" in result:
        return result
    language = result.get("language")
    return {
        "needs": string_list(result.get("needs")),
        "preferences": string_list(result.get("preferences")),
        "language": language.strip() if isinstance(language, str) and language.strip() else "Romanian",
    }


def check_profile(profile):
    if not isinstance(profile, dict) or not isinstance(profile.get("needs"), list):
        raise RuntimeError('profile must be the object returned by /profile, e.g. {"needs": [...], "preferences": [...], "language": "..."}')


def profile_prefix(profile):
    needs = "; ".join(profile.get("needs", [])) or "none given"
    preferences = "; ".join(profile.get("preferences", []))
    return f"Needs: {needs}" + (f"\nPreferences: {preferences}" if preferences else "")


# --- 2. rate ----------------------------------------------------------------

def rate_job(job, profile, model=None):
    """Rate a job listing against the user's needs and describe its work conditions."""
    check_profile(profile)
    prompt = RATE_PROMPT.format(profile=profile_prefix(profile), language=profile.get("language", "Romanian"))
    result = ask(prompt, job, model=model, task="rate", schema=RATE_SCHEMA)
    if "error" in result:
        result["source_url"] = job.get("url")
        return result

    try:
        rating = max(1, min(10, int(result.get("rating"))))
    except (TypeError, ValueError):
        rating = None
    explanation = result.get("rating_explanation")
    result = {
        "rating": rating,
        "rating_explanation": explanation if isinstance(explanation, str) else "",
        "work_conditions": [
            {"condition": str(c["condition"]), "source": c.get("source") if c.get("source") in ("stated", "typical") else "typical"}
            for c in result.get("work_conditions") or [] if isinstance(c, dict) and c.get("condition")
        ],
        "conflicts_with_needs": string_list(result.get("conflicts_with_needs")),
        "vague": result.get("vague") is True,
        "vague_details": string_list(result.get("vague_details")),
    }

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
    result = ask(prompt, job, model=model, task="guide", schema=GUIDE_SCHEMA)
    if "error" not in result:
        # fixed shape in display order; unused or empty sections are null
        result = {
            "application_steps": string_list(result.get("application_steps")),
            **{section: string_list(result.get(section)) or None for section in GUIDE_SECTIONS},
            "questions_to_ask_employer": string_list(result.get("questions_to_ask_employer")),
        }
    result["source_url"] = job.get("url")
    return result


# --- 4. screen (experimental) ----------------------------------------------

def screen_jobs(jobs, profile, model=None):
    """Quick 1-3 pass/fail guess per job from its title and company; returns ratings in input order."""
    check_profile(profile)
    if not isinstance(jobs, list) or not all(isinstance(job, dict) for job in jobs):
        raise RuntimeError('jobs must be a list of objects, e.g. [{"title": "...", "company": "..."}]')
    if not jobs:
        return []
    listing = [{"title": job.get("title"), "company": job.get("company")} for job in jobs]
    prompt = SCREEN_PROMPT.format(profile=profile_prefix(profile))
    result = ask(prompt, listing, model=model, task="screen", schema=SCREEN_SCHEMA)
    if "error" in result:
        return result

    ratings = result.get("ratings") if isinstance(result.get("ratings"), list) else []
    # one rating per job, whatever count the model sent
    ratings = (ratings + [SCREEN_UNSURE] * len(jobs))[:len(jobs)]
    return [r if r in (1, 2, 3) and not isinstance(r, bool) else SCREEN_UNSURE for r in ratings]


# --- CLI --------------------------------------------------------------------

COMMANDS = {
    "profile": build_profile,
    "rate": rate_job,
    "guide": application_guide,
    "screen": screen_jobs,
}


def main():
    parser = argparse.ArgumentParser(description="Axios AI interface.")
    parser.add_argument("command", choices=COMMANDS, help="operation to run")
    parser.add_argument("input", nargs="?", help="input JSON file (default: stdin)")
    parser.add_argument("-o", "--output", help="output JSON file (default: stdout)")
    parser.add_argument("-p", "--profile", help="profile JSON file (output of the 'profile' command); required for rate/guide/screen")
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
