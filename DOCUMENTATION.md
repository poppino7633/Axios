# Axios: how it all works

Axios is a Firefox extension that helps people with disabilities judge job postings. The user describes their needs once. After that:

- **On any job page**, the popup rates how well the job fits them (1–10), lists the work conditions, flags vague postings, and can write an application guide tailored to their needs.
- **On eJobs search results**, every job card gets a quick badge (*Potential conflict* / *Uncertain* / *No obvious conflict*), based only on its title and company.

This document describes the `main` branch as of `63deba9` (PR #20, which merged `experimental`). For the exact request and response shapes of the AI server, see [`ai interface/API.md`](ai%20interface/API.md).

---

## 1. Architecture at a glance

```
 ┌───────────────────────────────── Firefox ──────────────────────────────────┐
 │                                                                            │
 │  Job page (any site)                    Extension popup (React, UI/)       │
 │  ┌──────────────────────────┐           ┌──────────────────────────────┐   │
 │  │ content.js               │◄─GET_JOB──│ App.jsx / OnboardingQuiz     │   │
 │  │ • extracts one job       │──job obj─►│ tabs: Profile, Analysis,     │   │
 │  │ • on eJobs search pages: │   _DATA   │       Guide                  │   │
 │  │   badges on job cards    │           └──────────────┬───────────────┘   │
 │  └────────────┬─────────────┘                          │                   │
 │               │ SCREEN_JOBS          SAVE_PROFILE / GET_PROFILE /          │
 │               │                      RATE_JOB / GUIDE_JOB                  │
 │               ▼                                        ▼                   │
 │  ┌──────────────────────────────────────────────────────────────────────┐  │
 │  │ background.js: token, profile storage, result cache (50 / 7 days)    │  │
 │  └──────────────────────────────────┬───────────────────────────────────┘  │
 └─────────────────────────────────────┼──────────────────────────────────────┘
                                       │ HTTP + X-Axios-Token
                                       │ over Tailscale (100.114.26.88:8765)
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │ AI server (ai interface/, Python)       │
                    │ server.py    → HTTP routes              │
                    │ main.py      → prompts, schemas, repair │
                    │ providers.py → LLM calls, retries,      │
                    │                fallback models          │
                    └────────────────────┬────────────────────┘
                                         ▼
                      Claude / Gemini / any OpenAI-format API
```

**Key design choice: the server stores nothing.** The condensed profile lives in the extension (`browser.storage.local`) and is sent with every request. The server is a stateless translator between JSON and the LLM.

### Repository layout

| Path | What it is | Owner |
|---|---|---|
| `ai interface/` | Python AI server: `server.py`, `main.py`, `providers.py`, `API.md`, example inputs | Rares |
| `extension/` | Extension shell: `manifest.json`, `background.js`, `content.js`, icons | Popino |
| `UI/` | React + Vite popup. Its build copies `extension/` in and outputs the loadable extension to `UI/dist/` | Mihnea |
| `.gitignore` | Ignores `.env`, `dist`, `node_modules`, `__pycache__`, `ai interface/profile.json` | |

---

## 2. End-to-end flows

### 2.1 Creating a profile (once)

1. The user fills in the form in the **Profile Settings** tab (`OnboardingQuiz.jsx`): work mode, physical-access checkboxes, communication checkboxes, workplace adjustments, and a free-text box.
2. The form maps the choices to a Romanian payload `{ disabilities, difficulties, requirements, extras }` (see 4.3) and sends `SAVE_PROFILE` to `background.js`.
3. `background.js` POSTs the payload to **`/profile`**. The server asks the LLM to compress it into `{ needs[], preferences[], language }`.
4. `background.js` stores the result as `profile` in `browser.storage.local` and **clears the result cache**, since old results were made for the old profile.
5. Any open eJobs search page notices the profile change (`storage.onChanged`) and re-screens its job cards.
6. The popup switches to the **Job Analysis** tab and rates the current page, if it has a job.

### 2.2 Rating a job (every time the popup opens)

1. `App.jsx` sends `GET_PROFILE`. If a profile exists, the popup opens directly on **Job Analysis**.
2. It sends `GET_JOB_DATA` to the active tab's `content.js`. If the content script isn't there (the tab was open before the extension loaded), the popup injects `content.js` with `scripting.executeScript` and tries again.
3. `content.js` extracts the job (see 3.2) and returns a job object, or `null` when the page isn't a job listing.
4. With both a profile and a job, the popup sends `RATE_JOB`. `background.js` checks its cache, and on a miss POSTs `{ job, profile }` to **`/rate`**.
5. The popup shows a score banner, the explanation, a vague-posting warning, detected work conditions ("Menționat" = stated, "Inferat" = typical) and conflicts with needs.

### 2.3 Application guide (on demand)

When the user clicks **"Generează Ghid de Aplicare & Interviu"**, the popup sends `GUIDE_JOB`. `background.js` POSTs to **`/guide`** (cached the same way), and the popup opens the **Application Guide** tab.

### 2.4 Screening eJobs search results (automatic)

1. On any `ejobs.ro` page, `content.js` collects every `.job-card` that has both a title and a company link.
2. If a profile exists, it shows an **"Axios: analyzing…"** badge on each card and sends `SCREEN_JOBS { jobs: [{title, company}, ...] }` to `background.js`.
3. `background.js` checks the cache, and on a miss POSTs `{ jobs, profile }` to **`/screen`**. It gets back one rating per job, `[1|2|3, ...]`.
4. `content.js` replaces the loading badges with the results: 🟥 **1 Potential conflict**, 🟨 **2 Uncertain**, 🟩 **3 No obvious conflict**. Hovering a badge explains that it's a preliminary screening based only on title and company.
5. A `MutationObserver` watches for job cards being added or changed (pagination, filters, infinite scroll) and re-screens with a 500 ms debounce (see 3.2 for the details).

---

## 3. The extension (`extension/`)

### 3.1 `manifest.json`

- **Manifest V3, Firefox-style.** The background is `"background": { "scripts": [...] }` (an event page, not a Chrome service worker), and `background.js` and `content.js` use the `browser.*` namespace. As written, the extension runs in **Firefox only**.
- **Permissions:** `tabs`, `storage`, `activeTab`, `scripting`. `host_permissions` contains only the AI server, `http://100.114.26.88:8765/*`.
- **CSP:** `connect-src 'self' http://100.114.26.88:8765`, so extension pages can only reach the AI server.
- **Content script:** `content.js` is injected on every `http(s)` page at `document_idle`.
- **Popup:** `index.html`, which the UI build produces.

### 3.2 `content.js`

A guard (`globalThis.__axiosContentLoaded`) stops the script from running twice when the popup re-injects it.

#### Single-job extraction (`GET_JOB_DATA`)

Returns a job object whose text fields are whitespace-normalized; missing ones are `null`:

```js
{ url, title, company, location, salary, workMode, employmentType, careerLevel, description }
```

The pipeline, in order:

1. **JSON-LD (preferred).** Looks for a schema.org `JobPosting` in every `<script type="application/ld+json">`, searching through `@graph`, `mainEntity` and `itemListElement`. It formats `jobLocation` (addresses or lists of them), `baseSalary` (single values or min–max ranges plus currency and unit) and the HTML description, with scripts, styles and SVGs stripped. Used only if it has both a title and a description.
2. **Site-specific selectors**, chosen by hostname:
   - `ejobs.ro`: `h1` and `[class*=job-title]`, company, location, salary, work mode, employment type, career level, description.
   - `linkedin.com`: the unified top-card classes, plus many description containers (`#job-details`, `.jobs-description__content`, ...).
   - `bestjobs.eu` / `bestjobs.ro`: the title comes from `h2`, the company from the `/company-profile/` link, and salary and location are parsed from the header text with a regex (lei/RON/EUR, a list of Romanian cities).
3. **Generic fallback.** Common `data-testid`, `class*=` and `itemprop` patterns, used for any field the site-specific pass left empty.
4. **Last-resort description.** If the description is still under 80 characters, it tries `main section`, `main article`, `[class*=job-detail]` and similar. It deliberately never scrapes the whole page, because navigation and sidebar text would pollute the AI input.
5. **Validation.** It returns `null` unless there is a title and a description of at least **80 characters**, and it truncates the description to **12,000 characters**.

Because LinkedIn and BestJobs render job details asynchronously, `extractJobWithRetry()` makes up to **9 attempts, 350 ms apart** (~3 s).

#### Search-result screening (eJobs only)

| Piece | Behaviour |
|---|---|
| `extractSearchJobs()` | Reads every `.job-card`. The title comes from `.job-card-content-middle__title a`, the company from `.job-card-content-middle__info--darker a`. Cards missing either are skipped. Returns `{ jobs, elements }`, where `elements` are the title links, in the same order as `jobs`. |
| `runSearchScreening()` | Runs only on `ejobs.ro`, only one at a time (a request that arrives mid-run sets `screenRequestedAgain`), and only with a stored profile (with no profile, existing badges are removed). It skips the request when the job list and the profile are unchanged and just puts the badges back, since eJobs re-renders cards. After the response, it **re-reads the cards**: if they changed during the request, it discards the ratings and screens again, so old scores never land on different jobs. On any error, it removes the badges. |
| Badges | Each badge is a `<span class="axios-screen-badge">` appended to the card's title heading, styled inline (red, amber or green), with an `aria-label` and a hover `title`. |
| Triggers | Runs on page load, then on a `MutationObserver` over `document.body` that reacts only to job-card nodes and ignores its own badges (500 ms debounce), and on `storage.onChanged` for `profile`. |
| Messages | `GET_SEARCH_JOBS` returns the extracted `{title, company}` list. `REFRESH_SEARCH_SCREENING` forgets the last result and re-screens. Nothing sends either of them yet (see 9). |

### 3.3 `background.js`: server access, storage and cache

**Server address:** `const AXIOS_SERVER = "http://100.114.26.88:8765"`.

**Auth:** every request sends `X-Axios-Token`, read from `browser.storage.local` key **`axiosToken`**. No code sets that key; it has to be set by hand (see 7.2). Without it, every call fails with *"Axios server token is not configured"*.

**`axiosRequest(path, body)`** sends a GET when there is no body, otherwise a POST of the JSON. It throws when the HTTP status isn't OK **or** the body contains `error`. The server can return `200` with an `error` field when the model's JSON is unusable, so this check matters.

**Message handlers** (`browser.runtime.onMessage`):

| Message | From | Does |
|---|---|---|
| `SAVE_PROFILE { profile }` | popup | POST `/profile`, store the result as `profile`, clear the cache, return the profile |
| `GET_PROFILE` | popup | Return the stored profile or `null` |
| `RATE_JOB { job, refresh? }` | popup | Require `job.url`, `job.description` and a stored profile, then make a cached POST to `/rate` |
| `GUIDE_JOB { job, refresh? }` | popup | Same as above, for `/guide` |
| `SCREEN_JOBS { jobs }` | content.js | Require a stored profile. Reduce each job to `{title, company}`, then make a cached POST to `/screen`. Reject the response unless it is a list of exactly `jobs.length` ratings, each 1, 2 or 3. An empty list returns `[]` without calling the server. |

**Result cache** (shared by all three AI operations):
- **Keys:**
  - `/rate` and `/guide`: `"<rate|guide>:<origin+path>:<sha256(job with query/hash stripped from url + profile)>"`. The same page with the same content and the same profile is a hit.
  - `/screen`: `"screen:<sha256(jobs + profile)>"`. The same list of jobs with the same profile is a hit.
  - Any change to the job text, the job list or the profile is a miss.
- **Stored** in `browser.storage.local` under `resultCache`, with a **7-day TTL** and a cap of **50 entries** total (newest kept).
- **Writes are serialized** through one promise chain (`cacheWrites`), so concurrent writes don't overwrite each other.
- **In-flight de-duplication:** an identical request already in progress is reused instead of sent twice.
- `refresh: true` skips the cache lookup for rate and guide. The UI doesn't send it yet.

---

## 4. The popup UI (`UI/`)

### 4.1 Build and how it becomes the extension

- **Stack:** React 19 + Vite 8, plain CSS, ESLint (flat config).
- **`vite.config.js`** sets `publicDir: "../extension"`. `npm run build` therefore copies the whole `extension/` folder (manifest, `background.js`, `content.js`, icons) into `UI/dist/`, next to the built `index.html` and the JS/CSS bundles. **`UI/dist/` is the folder you load into Firefox.** `base: "./"` keeps asset paths relative so they resolve inside the extension.
- `UI/dist/` is git-ignored, so every developer has to build it locally. Any change to `extension/` (for example the screening feature) only reaches the browser after a rebuild.

### 4.2 Files

| File | Role |
|---|---|
| `main.jsx` | Mounts `<App/>`. When running as the extension popup, it adds `class="popup"` to `<html>`, which fixes the window at **605×465 px**. Opened in a tab or on the dev server, the app fills the window. |
| `App.jsx` | Loads the profile and job when the popup opens, runs the analysis, and renders the three tabs, the loading state and error banners. |
| `OnboardingQuiz.jsx` | The profile form (see 4.3). |
| `Icon.jsx` | Inlines SVGs from `src/assets/icons/` (via `import.meta.glob ... ?raw`) so they inherit `currentColor` and adapt to high-contrast mode. Decorative unless given a `label`. |
| `mockData.js` | Fake `/rate` and `/guide` results, shown on the Vite dev server (`npm run dev`) where no extension API exists. |
| `App.css`, `index.css` | Layout, popup sizing, high-contrast theme, OpenDyslexic `@font-face`. Light theme only. |

### 4.3 How the form becomes a `/profile` request

| Form section | Sent as |
|---|---|
| Work mode tile (Exclusive Remote / Hybrid / Nu contează), **default: remote** | `disabilities: "Regim de lucru preferat: <remote\|hybrid\|nu_conteaza>."` |
| Ramp, elevator, adapted restroom, parking | `difficulties: "nevoie de rampă acces, ..."`, or `"Fără restricții fizice severe."` |
| Communication options + adjustable desk, chair, monitors, visual assistant | `requirements: "<option> \| <option> ..."`, or `"Fără cerințe specifice."` |
| Free text | `extras`, or `"Niciuna"` |

The texts are in Romanian, so the profile's `language` comes out as Romanian and `/rate` and `/guide` answer in Romanian.

### 4.4 Accessibility features of the popup itself

- **High Contrast** and **Dyslexia Font** (OpenDyslexic, bundled) toggles. They are saved in the popup's `localStorage` (`axios.highContrast`, `axios.dyslexiaFont`).
- Monochrome inline SVG icons that follow the text colour, `aria-pressed` on toggles, and `aria-hidden` on decorative icons.

### 4.5 What each tab renders

| Tab | Fields used |
|---|---|
| Job Analysis | `rating` (banner: **≥ 7** `COMPATIBLE`, **4–6** `PARTIAL_MATCH`, **1–3** `INCOMPATIBLE`, missing → `UNRATED`; the circle shows `rating × 10 %`), `rating_explanation`, `vague` + `vague_details`, `work_conditions`, `compatible_with_needs` (if present), `conflicts_with_needs` |
| Application Guide | `application_steps`, `attire` (rendered as one paragraph), `documents_to_prepare` (if present), `questions_to_ask_employer` |

---

## 5. The AI server (`ai interface/`)

Pure standard-library Python, except the optional `anthropic` SDK (`requirements.txt`) needed when `AI_PROVIDER=anthropic`. The project venv is at the repo root, `.venv/`.

### 5.1 `server.py`: HTTP layer

- A `ThreadingHTTPServer` (one thread per request) with one `Handler` class.
- **Routes:**

  | Route | Handler |
  |---|---|
  | `GET /health` | `{"status": "ok", "provider", "model"}`, no token needed |
  | `POST /profile` | `main.build_profile(body)` |
  | `POST /rate` | `main.rate_job(body.job, body.profile)` |
  | `POST /guide` | `main.application_guide(body.job, body.profile)` |
  | `POST /screen` | `main.screen_jobs(body.jobs, body.profile)`; responds with a **JSON list**, not an object |

  `with_job_and_profile()` and `with_jobs_and_profile()` check the body shape and adapt it to the function signature.
- **Auth:** when bound to anything other than loopback, the server **refuses to start** unless `AXIOS_TOKEN` is set and isn't the `.env.example` placeholder. Tokens are compared with `hmac.compare_digest`, which is constant-time. Loopback (`127.0.0.1`) runs skip auth, for local testing.
- **CORS:** `Access-Control-Allow-Origin: *`, the token header is allowed, and `Access-Control-Allow-Private-Network: true` lets Chrome pages reach a private-network server.
- **Error mapping:**

  | Status | When |
  |---|---|
  | `400` | Body isn't a JSON object, the request shape is wrong, or a config error (`RuntimeError`) |
  | `502` | A `RuntimeError` carrying a provider status of 429 or higher (rate limit or overload after all retries) |
  | `500` | Any other exception |
  | `200` + `error` | The model's reply wasn't valid JSON |

- **Startup line:** `URL for the extension: http://<address>:<port>`. With `--host 0.0.0.0` this shows the LAN address, not the Tailscale one. Start with `--host 100.114.26.88` to bind to and print the Tailscale IP.

### 5.2 `main.py`: the four operations

Every operation follows the same pattern: **system prompt → user JSON → `providers.complete()` with a JSON schema → `extract_json()` → repair into the documented shape.**

- `ask()` sends the request and parses the reply. `extract_json()` strips ```` ``` ```` fences and falls back to the outermost `{…}`. If parsing fails, it returns `{"error": ..., "raw": ...}` instead of raising.
- **Schemas** (`PROFILE_SCHEMA`, `RATE_SCHEMA`, `GUIDE_SCHEMA`, `SCREEN_SCHEMA`) are strict: every property is required and `additionalProperties` is false. Claude enforces them server-side. For other providers, the Python repair code makes sure the extension still gets the right shape.

| Operation | Input | Prompt highlights | Repair / post-processing |
|---|---|---|---|
| **`build_profile`** | Any JSON (the form payload) | Compress into 2–6-word workplace conditions. Keep numbers. Keep the person's meaning. Turn help requests into needs. Drop medical detail. Needs vs preferences. **Any mention of remote work becomes the need "remote work only"**, even when phrased as a wish. Write in the user's language. | `needs` and `preferences` become clean string lists. `language` defaults to `"Romanian"`. |
| **`rate_job`** | job + profile | Always list conditions typical for the job type as `"typical"`. Everything else must be `"stated"` in the posting, never invented. Buzzwords go to `vague_details`. Missing info keeps the rating moderate. At most 5 conditions. | `rating` is clamped to 1–10 (`null` if unparseable). An invalid `source` becomes `"typical"`. **`vague` is forced to `true` if the description is under 300 characters.** `source_url` is added. |
| **`application_guide`** | job + profile | Always `application_steps` (4–6) and `questions_to_ask_employer` (≤ 3). Plus only the 2–4 of seven optional sections this person needs: `travel_and_access`, `interview_format`, `sensory_comfort`, `attire`, `etiquette`, `disclosure`, `schedule_and_health` (each a list of 2–4 steps). Romania by default. Rights only in general terms, no law citations. | A fixed key order. Unused or empty sections become `null`. `source_url` is added. |
| **`screen_jobs`** *(experimental)* | list of jobs + profile | Only `title` and `company` are sent. A very forgiving filter: **1** only when the core of the work is impossible for the person (physical demands they can't meet, or on-site-only work for someone who needs remote). **3** when nothing clashes. **2** for everything else, including poor-but-possible fits and unclear titles. "When in doubt between 1 and 2, choose 2." Preferences never cause a fail. Missing info never causes a fail. | An empty list returns `[]` without calling the model. Exactly one rating per job: missing or invalid entries become **2**, extras are dropped. |

`profile_prefix()` turns the profile into the `Needs: ...` / `Preferences: ...` text that rate, guide and screen put in their prompts. **Profiles stored before the remote rule existed are handled here:** any preference matching `remote | from home | wfh | home office | de acasă | la distanță | telemuncă` is removed from preferences and added as the need "remote work only". `check_profile()` rejects a missing or malformed profile with a 400.

**CLI:** the same operations run without the server, which is handy for prompt tuning:

```bash
python main.py profile example_user.json -o profile.json
python main.py rate   example_job.json  --profile profile.json
python main.py guide  example_job.json  --profile profile.json [-m <model>]
python main.py screen example_jobs.json --profile profile.json
```

### 5.3 `providers.py`: the LLM abstraction

- **`load_dotenv()`** reads `ai interface/.env` when imported. Real environment variables win over the file; later lines in the file win over earlier ones; inline ` # comments` are stripped.
- **Three API styles:**
  - `_gemini`: native `generateContent` REST, JSON MIME type, `thinkingLevel`; thought parts are dropped.
  - `_anthropic`: the official SDK with `output_config.format = json_schema`, which guarantees the shape, and `effort` taken from `AI_THINKING`. The SDK's own retries are off. Refusals raise an error.
  - `_openai_compatible`: `/chat/completions`, with `response_format: json_object` where supported.
- **Registry (`PROVIDERS`):** gemini, anthropic, openai, huggingface, groq, openrouter, mistral, deepseek, ollama, lmstudio and `openai_compatible`. Each entry has a base URL, the key variable, JSON-mode support, and a default model and thinking level.
- **`complete()`:**
  - Per-task overrides: `AI_MODEL_<TASK>` and `AI_THINKING_<TASK>` (task = `profile`, `rate`, `guide` or `screen`).
  - Each model gets **2 attempts** with backoff (1 s, then 3 s) on retryable errors: 429/5xx/529 or network errors.
  - It then moves through **`AI_FALLBACK_MODELS`** in order.
  - A **404** (model doesn't exist) or **429** (quota) skips straight to the next model.
  - Non-retryable errors (e.g. 400/401) are raised immediately.
- Fixed settings: 120 s timeout, 8192 max output tokens, temperature 0.2.

---

## 6. Configuration (`ai interface/.env`)

Copy `.env.example` to `.env`; the real `.env` is git-ignored.

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `gemini` (default), `anthropic`, `openai`, ... (see 5.3) |
| `<PROVIDER>_API_KEY` / `HF_TOKEN` | The key for the chosen provider. Several can sit side by side; `AI_API_KEY` overrides them. |
| `AI_MODEL` | Model id. Defaults to the provider's default. |
| `AI_FALLBACK_MODELS` | Comma-separated models on the same provider, tried when the main one is overloaded |
| `AI_THINKING` | Gemini `minimal/low/medium/high`, Anthropic `low/.../max`. Empty = model default. |
| `AI_MODEL_<TASK>`, `AI_THINKING_<TASK>` | Per-operation overrides, e.g. `AI_THINKING_GUIDE=medium`, `AI_MODEL_GUIDE=claude-sonnet-5-5` |
| `AI_BASE_URL` | Custom endpoint; required for `openai_compatible` |
| `AXIOS_HOST`, `AXIOS_PORT` | Bind address (default `0.0.0.0`) and port (default `8765`) |
| `AXIOS_TOKEN` | Shared team secret, required for any non-loopback host |

The current `.env` uses **`anthropic` with `claude-haiku-5-5`**.

---

## 7. Running it

### 7.1 AI server (on the server laptop)

```bash
cd "ai interface"
../.venv/bin/pip install -r requirements.txt         # once, only needed for the anthropic provider
../.venv/bin/python server.py --host 100.114.26.88   # Tailscale only
# or: ../.venv/bin/python server.py                  # all interfaces (wifi + Tailscale)
curl http://100.114.26.88:8765/health
```

Teammates must be connected to the same Tailscale network.

### 7.2 Extension (on each teammate's laptop)

```bash
cd UI && npm install && npm run build      # produces UI/dist/
```

1. In Firefox, open `about:debugging` → *This Firefox* → **Load Temporary Add-on** and pick `UI/dist/manifest.json`.
2. If Firefox asks, grant the host permission under *about:addons → Axios → Permissions*.
3. **Set the team token once.** In `about:debugging`, click *Inspect* on Axios and run this in its console:
   ```js
   browser.storage.local.set({ axiosToken: "<team token>" })
   ```
4. Create a profile in the popup. Then open a job page and click the Axios icon, or open an eJobs search page to see the badges.

Temporary add-ons are removed when Firefox restarts, and changes to `extension/` or `UI/src/` only show up after `npm run build` and a reload.

### 7.3 UI-only development

`cd UI && npm run dev` serves the popup at `localhost:5173` with mock data and no extension or server needed.

### 7.4 Testing the server from a terminal

`ai interface/API.md` → *Testing from a terminal*. For screening without the server:

```bash
cd "ai interface" && ../.venv/bin/python main.py screen example_jobs.json --profile profile.json
# → [3, 1, 2, 2, 3]
```

---

## 8. Branches

| Branch | Purpose |
|---|---|
| `main` | Integrated version (this document) |
| `ai-interface`, `extension`, `UI` | Each owner's working branch |
| `integration` | Where the branches are merged and tested together before `main` |
| `experimental` | Where `/screen` was built. Merged into `main` with PR #20 together with the extension's search-result screening ("Added big list feature"). |

---

## 9. Known gaps and mismatches

I found these while reading the code. None of them breaks the main rate flow, but they are worth knowing about.

1. **The guide tab doesn't match the `/guide` response.**
   - The popup renders `attire` inside one `<p>`, but the server sends a list or `null`. A list shows up as run-together sentences, and `null` leaves an empty "Ținută Recomandată" card.
   - It expects `documents_to_prepare`, which the server never sends.
   - It never shows `travel_and_access`, `interview_format`, `sensory_comfort`, `etiquette`, `disclosure` or `schedule_and_health`, which are most of the tailored content.
   - `mockData.js` uses an older response shape, which hides this on the dev server.
2. **`compatible_with_needs` is never sent.** The analysis tab has a "Cerințe Îndeplinite" card for it, but `/rate` doesn't return it, so the card never appears.
3. **The work mode defaults to "Exclusive Remote".** A user who never touches that tile sends "Regim de lucru preferat: remote". Because remote is now always a hard need, that user gets "remote work only": every on-site job fails the search screening, and `/rate` judges against it too. Defaulting to *Nu contează*, or requiring an explicit choice, would avoid that.
4. **Nothing sets `axiosToken`.** It has to be set by hand in the console (7.2). The popup has no field for it and no clear message when it's missing. On search pages, a missing token just removes the badges silently (the error only shows in the page console).
5. **Search screening covers eJobs only.** LinkedIn and BestJobs search results get no badges.
6. **The screening badges are in English** ("Potential conflict", "Uncertain", "No obvious conflict"), while the popup is in Romanian.
7. **`GET_SEARCH_JOBS` and `REFRESH_SEARCH_SCREENING` are handled but never sent.** There's no "re-screen" control in the UI.
8. **Screening results share the 50-entry cache with rate and guide.** Browsing many search pages can push recent job analyses out of the cache.
9. **Firefox only.** `background.scripts` and the `browser.*` namespace don't work in Chrome. The popup uses `chrome.*`, which Firefox also supports.
10. **The loading texts say "20–40 seconds"**, but real calls take about 3–7 s.
11. **The form doesn't pre-fill.** `OnboardingQuiz` receives `initialProfile` but ignores it, so editing a profile means filling in the form again from scratch.
12. **Two different "short description" limits.** The extension accepts descriptions of 80 characters or more, but the server marks anything under 300 characters as vague.
13. **There is no "refresh analysis" button.** `background.js` supports `refresh: true` to bypass the cache, but the UI never sends it.
