# Axios AI server: API reference

The AI server runs on one laptop. The extension calls it over the wifi network. Every endpoint takes JSON and returns JSON.

## Connection

| | |
|---|---|
| **Base URL** | `http://<server laptop IP>:8765`. The server prints this at startup (`URL for the extension: ...`). Currently `http://10.200.20.64:8765`. |
| **Auth** | Every request except `GET /health` must send the header `X-Axios-Token: <team token>`. Get the token privately from whoever runs the server. Never commit it. |
| **Content type** | Send `Content-Type: application/json` with every POST. |
| **CORS** | Requests from any origin are allowed, and the `X-Axios-Token` header is allowed in preflight. |
| **Manifest** | Add `"http://10.200.20.64:8765/*"` to `host_permissions` in `extension/manifest.json`. In Firefox the user may have to grant it under *about:addons → Axios → Permissions*. |
| **Speed** | `/profile`, `/rate` and `/guide` wait on the AI model and take **about 20–40 s**. Show a loading state and don't set short timeouts. |

Quick connectivity check from any laptop on the wifi:

```bash
curl http://10.200.20.64:8765/health
```

If it hangs, the wifi blocks traffic between laptops. Use a phone hotspot for both laptops (the IP will change).

## Typical flow

1. The user fills in their needs, then call **`POST /profile`** once. The server condenses the needs and saves them.
2. On a job page, get the job object from `content.js`, then call **`POST /rate`**.
3. When the user asks for help applying, call **`POST /guide`** with the same job object.

`/rate` and `/guide` use the saved profile automatically. If no profile has been saved yet, they return an error (see [Errors](#errors)).

---

## `GET /health`

Checks the server is up. **No token needed.**

**Response `200`**
```json
{
  "status": "ok",
  "provider": "gemini",
  "model": "gemini-flash-latest",
  "profile_saved": true
}
```
`profile_saved` is `false` until `POST /profile` has succeeded at least once.

---

## `POST /profile`

Turns the user's free-form description of their disabilities, difficulties and requirements into a short list of needs, saves it on the server, and returns it. Posting again **replaces** the saved profile. There is one profile per server.

**Request body:** any JSON object. The field names are free; these are the suggested ones:
```json
{
  "disabilities": "I have chronic lower back pain from a herniated disc, and mild hearing loss in my left ear.",
  "difficulties": "I can't stand for more than an hour or so, and lifting anything heavy makes it way worse.",
  "requirements": "I need to be able to sit most of the day and change position sometimes.",
  "extras": "I also have physiotherapy twice a week in the mornings so flexible hours would be great."
}
```

**Response `200`**
```json
{
  "needs": [
    "predominantly seated work",
    "no prolonged standing (maximum 1 hour)",
    "ability to change positions periodically",
    "no heavy lifting"
  ],
  "preferences": [
    "quiet work environment",
    "flexible working hours for morning physiotherapy appointments"
  ],
  "language": "English"
}
```

| Field | Type | Meaning |
|---|---|---|
| `needs` | string[] | Hard requirements and limitations |
| `preferences` | string[] | Nice-to-haves |
| `language` | string | Language the user wrote in. `/rate` and `/guide` answer in this language. |

## `GET /profile`

Returns the saved profile (same shape as above), or `404` with `{"error": "no saved profile ..."}` if there isn't one.

---

## `POST /rate`

Rates how well a job fits the saved profile, describes the work conditions, and flags vague job descriptions.

**Request body:** the job object from `extension/content.js`. Every field is passed to the AI, so extra fields help. `description` matters most.
```json
{
  "url": "https://www.ejobs.ro/user/locuri-de-munca/...",
  "title": "Junior Python Developer",
  "company": "Example SRL",
  "location": "București",
  "salary": null,
  "workMode": "Hibrid",
  "employmentType": "Full time",
  "careerLevel": "Entry-Level",
  "description": "We are looking for a Junior Python Developer ..."
}
```

**Response `200`**
```json
{
  "rating": 8,
  "rating_explanation": "Software development is seated, computer-based work ... kept at 8 because schedule flexibility is not mentioned.",
  "work_conditions": [
    { "condition": "Hybrid work model (2 days per week in Bucharest office)", "source": "stated" },
    { "condition": "Predominantly seated position", "source": "typical" }
  ],
  "compatible_with_needs": ["No heavy lifting: standard software work involves no physical loads."],
  "conflicts_with_needs": [],
  "unknown_for_needs": ["Flexible working hours: the posting does not mention schedule flexibility."],
  "vague": true,
  "vague_details": ["Missing compensation/salary details"],
  "source_url": "https://www.ejobs.ro/user/locuri-de-munca/..."
}
```

| Field | Type | Meaning |
|---|---|---|
| `rating` | integer 1–10 or `null` | 10 = clearly compatible, 1 = clearly incompatible. Always clamped to 1–10. `null` only if the model returned garbage. |
| `rating_explanation` | string | Why this rating |
| `work_conditions` | `{condition, source}[]` | `source` is `"stated"` (in the posting) or `"typical"` (inferred from the job type, e.g. construction means heavy labour). Show these differently in the UI. |
| `compatible_with_needs` | string[] | Needs the job appears to meet, with the reason |
| `conflicts_with_needs` | string[] | Needs the job appears to break, with the reason |
| `unknown_for_needs` | string[] | Needs the posting says nothing about |
| `vague` | boolean | `true` if the posting uses empty phrases ("salariu motivant", "loc de muncă plăcut", ...) or leaves out basics. Also forced to `true` if `description` is under 300 characters. |
| `vague_details` | string[] | The vague phrases quoted, or the missing information |
| `source_url` | string | Copied from the request's `url` |

---

## `POST /guide`

Builds an application guide for the job, tailored to the saved profile.

**Request body:** the same job object as `/rate`.

**Response `200`**
```json
{
  "application_steps": ["Update and tailor your CV ...", "Submit your application through eJobs ...", "..."],
  "documents_to_prepare": ["CV in English (PDF)", "GitHub / portfolio link"],
  "attire": "Smart casual (neat shirt or blouse, comfortable trousers or dark jeans) ...",
  "unspoken_rules": ["English fluency is taken seriously in Bucharest tech companies ..."],
  "interview_tips": ["Prepare explanations of REST principles ..."],
  "accommodation_advice": ["Wait until the final HR stage or the offer before requesting schedule adjustments ..."],
  "questions_to_ask_employer": ["How flexible are daily working hours around core hours?"],
  "source_url": "https://www.ejobs.ro/user/locuri-de-munca/..."
}
```

| Field | Type |
|---|---|
| `application_steps` | string[], in order |
| `documents_to_prepare` | string[] |
| `attire` | string |
| `unspoken_rules` | string[] |
| `interview_tips` | string[] |
| `accommodation_advice` | string[] |
| `questions_to_ask_employer` | string[] |
| `source_url` | string |

---

## Errors

Every error has the same shape:
```json
{ "error": "human-readable message" }
```

| Status | When |
|---|---|
| `400` | Body is not valid JSON, no profile is saved yet (on `/rate` or `/guide`), or the server's AI config is wrong |
| `401` | `X-Axios-Token` header missing or wrong |
| `404` | Unknown endpoint, or `GET /profile` with no saved profile |
| `500` | Unexpected server bug. Tell the person running the server. |
| `502` | The AI provider failed (overloaded or rate-limited) even after retries. Safe to retry later. |

> **Always check for `error` in the body, even on `200`.** If the AI replies with something that isn't valid JSON, the server still returns `200`, with `{"error": "model did not return valid JSON", "raw": "...", "source_url": "..."}`. Show an error and offer a retry.

---

## Example: calling it from `background.js`

```js
const AXIOS_SERVER = "http://10.200.20.64:8765";
const AXIOS_TOKEN = "<team token>"; // don't commit the real value

async function axios(path, body) {
  const res = await fetch(`${AXIOS_SERVER}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Axios-Token": AXIOS_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// usage
const job = await browser.tabs.sendMessage(tab.id, { type: "GET_JOB_DATA" });
const rating = await axios("/rate", job);      // ~20-40 s
const guide = await axios("/guide", job);      // on demand
await axios("/profile", { disabilities: "...", difficulties: "...", requirements: "...", extras: "..." });
```

## Testing from a terminal

```bash
TOKEN=<team token>
URL=http://10.200.20.64:8765
curl $URL/health
curl -X POST $URL/profile -H "X-Axios-Token: $TOKEN" -d @example_user.json
curl -X POST $URL/rate    -H "X-Axios-Token: $TOKEN" -d @example_job.json
curl -X POST $URL/guide   -H "X-Axios-Token: $TOKEN" -d @example_job.json
```
(`example_user.json` and `example_job.json` are in `ai interface/`.)
