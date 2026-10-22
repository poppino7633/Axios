
const AXIOS_SERVER = "http://10.200.20.64:8765";

// Authentication
async function getToken() {
  const { axiosToken } = await browser.storage.local.get("axiosToken");

  if (!axiosToken) {
    throw new Error("Axios server token is not configured");
  }

  return axiosToken;
}

// HTTP helper
async function axiosRequest(path, body = null) {
  const token = await getToken();

  const response = await fetch(`${AXIOS_SERVER}${path}`, {
    method: body === null ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Axios-Token": token
    },
    body: body === null ? undefined : JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }

  return data;
}

// Result cache
// /rate and /guide results are kept in storage.local, keyed by the job's content and the profile,
// so reopening the popup on the same job is instant and doesn't call the AI again. A changed
// posting or a new profile gives a new key, so stale results are never returned.
const CACHE_STORAGE_KEY = "resultCache";
const CACHE_MAX_ENTRIES = 50;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inFlight = new Map();          // key -> pending request, so duplicate clicks share one call
let cacheWrites = Promise.resolve(); // serializes read-modify-write of the cache

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

async function cacheKey(kind, job, profile) {
  // ignore ?query and #hash (tracking params) so the same posting maps to the same entry
  const url = new URL(job.url);
  const page = `${url.origin}${url.pathname}`;
  return `${kind}:${page}:${await sha256({ job: { ...job, url: page }, profile })}`;
}

async function readCache(key) {
  const { [CACHE_STORAGE_KEY]: cache = {} } = await browser.storage.local.get(CACHE_STORAGE_KEY);
  const entry = cache[key];
  return entry && Date.now() - entry.savedAt < CACHE_TTL_MS ? entry.result : null;
}

function writeCache(key, result) {
  cacheWrites = cacheWrites.then(async () => {
    const { [CACHE_STORAGE_KEY]: cache = {} } = await browser.storage.local.get(CACHE_STORAGE_KEY);
    cache[key] = { result, savedAt: Date.now() };

    // drop expired entries, then keep only the newest CACHE_MAX_ENTRIES
    const now = Date.now();
    const kept = Object.entries(cache)
      .filter(([, entry]) => now - entry.savedAt < CACHE_TTL_MS)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, CACHE_MAX_ENTRIES);

    await browser.storage.local.set({ [CACHE_STORAGE_KEY]: Object.fromEntries(kept) });
  }).catch(error => console.error("[Axios] Cache write failed:", error));
  return cacheWrites;
}

function clearCache() {
  cacheWrites = cacheWrites.then(() => browser.storage.local.remove(CACHE_STORAGE_KEY));
  return cacheWrites;
}

// Returns the cached result when there is one (unless refresh is set); otherwise calls the server once.
async function cachedRequest(kind, path, job, profile, refresh = false) {
  const key = await cacheKey(kind, job, profile);

  if (!refresh) {
    const cached = await readCache(key);
    if (cached) return cached;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const request = axiosRequest(path, { job, profile })
    .then(async result => {
      await writeCache(key, result); // errors throw above and are never cached
      return result;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

// React UI message handlers
browser.runtime.onMessage.addListener(async (message) => {
  switch (message.type) {
    case "SAVE_PROFILE": {
      const profile = await axiosRequest("/profile", message.profile);
      await browser.storage.local.set({ profile });
      await clearCache(); // results were for the old profile
      return profile;
    }

    case "GET_PROFILE": {
      const { profile } = await browser.storage.local.get("profile");
      return profile ?? null;
    }

    case "RATE_JOB":
    case "GUIDE_JOB": {
      const { profile } = await browser.storage.local.get("profile");

      if (!profile) {
        throw new Error("Create an accessibility profile first");
      }

      const [kind, path] =
        message.type === "RATE_JOB" ? ["rate", "/rate"] : ["guide", "/guide"];

      // message.refresh = true skips the cache (e.g. a "re-analyse" button)
      return cachedRequest(kind, path, message.job, profile, message.refresh === true);
    }

    default:
      return undefined;
  }
});

// --------------------------------------------------
// TEMPORARY TEST: MOCK PROFILE + REAL EJOB LISTING
// --------------------------------------------------

const mockUser = {
  disabilities: "Chronic lower back pain and mild hearing loss",
  difficulties:
    "Cannot stand for more than one hour and cannot lift heavy objects",
  requirements:
    "Predominantly seated work, ability to change positions periodically",
  extras:
    "Prefer a quiet workplace and flexible working hours for physiotherapy appointments"
};

async function testJobRating() {
  try {
    console.log("[Axios] Starting rating test...");

    // 1. Find an open eJobs tab
    const tabs = await browser.tabs.query({
      url: "https://www.ejobs.ro/*"
    });

    if (tabs.length === 0) {
      throw new Error("No eJobs tab found");
    }

    const tab = tabs.find(t => t.active) ?? tabs[0];

    // 2. Extract REAL job data
    const job = await browser.tabs.sendMessage(tab.id, {
      type: "GET_JOB_DATA"
    });

    if (!job?.description) {
      throw new Error("Failed to extract job description");
    }

    console.log("[Axios] Extracted job:", job);

    // 3. Generate mock accessibility profile
    console.log("[Axios] Generating accessibility profile...");

    const profile = await axiosRequest("/profile", mockUser);

    await browser.storage.local.set({ profile });

    console.log("[Axios] Processed profile:", profile);

    // 4. Rate REAL job using mock profile
    console.log("[Axios] Requesting AI rating...");

    console.time("[Axios] Rating duration");

    const result = await axiosRequest("/rate", {
      job,
      profile
    });

    console.timeEnd("[Axios] Rating duration");

    // 5. Log results
    console.log("==================================");
    console.log("[Axios] JOB RATING RESULT");
    console.log("==================================");

    console.log("Job:", job.title);
    console.log("Company:", job.company);
    console.log("Rating:", result.rating, "/ 10");
    console.log("Explanation:", result.rating_explanation);

    console.log("Compatible needs:", result.compatible_with_needs);
    console.log("Conflicting needs:", result.conflicts_with_needs);
    console.log("Unknown needs:", result.unknown_for_needs);

    console.log("Work conditions:", result.work_conditions);
    console.log("Vague description:", result.vague);
    console.log("Vague details:", result.vague_details);

    console.log("Full result:", result);

  } catch (error) {
    console.error("[Axios] Rating test failed:", error);
  }
}


