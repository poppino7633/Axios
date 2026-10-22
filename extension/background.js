
const AXIOS_SERVER = "http://10.200.20.64:8765";

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

async function getToken() {
  const { axiosToken } = await browser.storage.local.get("axiosToken");

  if (!axiosToken) {
    throw new Error("Axios server token is not configured");
  }

  return axiosToken;
}

// --------------------------------------------------
// HTTP API
// --------------------------------------------------

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

// --------------------------------------------------
// RESULT CACHE
// --------------------------------------------------

const CACHE_STORAGE_KEY = "resultCache";
const CACHE_MAX_ENTRIES = 50;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inFlight = new Map();

let cacheWrites = Promise.resolve();

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));

  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function cacheKey(kind, job, profile) {
  if (!job?.url) {
    throw new Error("Invalid job: missing URL");
  }

  const url = new URL(job.url);

  // Remove query parameters and fragments.
  const page = `${url.origin}${url.pathname}`;

  const hash = await sha256({
    job: {
      ...job,
      url: page
    },
    profile
  });

  return `${kind}:${page}:${hash}`;
}

async function readCache(key) {
  const {
    [CACHE_STORAGE_KEY]: cache = {}
  } = await browser.storage.local.get(CACHE_STORAGE_KEY);

  const entry = cache[key];

  if (!entry) return null;

  if (Date.now() - entry.savedAt >= CACHE_TTL_MS) {
    return null;
  }

  return entry.result;
}

function writeCache(key, result) {
  cacheWrites = cacheWrites.then(async () => {
    const {
      [CACHE_STORAGE_KEY]: cache = {}
    } = await browser.storage.local.get(CACHE_STORAGE_KEY);

    cache[key] = {
      result,
      savedAt: Date.now()
    };

    const now = Date.now();

    const kept = Object.entries(cache)
      .filter(([, entry]) =>
        now - entry.savedAt < CACHE_TTL_MS
      )
      .sort(([, a], [, b]) =>
        b.savedAt - a.savedAt
      )
      .slice(0, CACHE_MAX_ENTRIES);

    await browser.storage.local.set({
      [CACHE_STORAGE_KEY]: Object.fromEntries(kept)
    });
  }).catch(error => {
    console.error("[Axios] Cache write failed:", error);
  });

  return cacheWrites;
}

function clearCache() {
  cacheWrites = cacheWrites.then(() =>
    browser.storage.local.remove(CACHE_STORAGE_KEY)
  );

  return cacheWrites;
}

// --------------------------------------------------
// CACHED REQUESTS
// --------------------------------------------------

async function cachedRequest(
  kind,
  path,
  job,
  profile,
  refresh = false
) {
  const key = await cacheKey(kind, job, profile);

  if (!refresh) {
    const cached = await readCache(key);

    if (cached) {
      console.log(`[Axios] Cache hit: ${kind}`);
      return cached;
    }
  }

  if (inFlight.has(key)) {
    console.log(`[Axios] Reusing pending request: ${kind}`);
    return inFlight.get(key);
  }

  const request = axiosRequest(path, {
    job,
    profile
  })
    .then(async result => {
      await writeCache(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);

  return request;
}

// --------------------------------------------------
// REACT UI MESSAGE HANDLERS
// --------------------------------------------------

browser.runtime.onMessage.addListener(async message => {
  switch (message.type) {
    case "SAVE_PROFILE": {
      const profile = await axiosRequest(
        "/profile",
        message.profile
      );

      await browser.storage.local.set({ profile });
      await clearCache();

      return profile;
    }

    case "GET_PROFILE": {
      const { profile } = await browser.storage.local.get(
        "profile"
      );

      return profile ?? null;
    }

    case "RATE_JOB":
    case "GUIDE_JOB": {
      if (!message.job?.url || !message.job?.description) {
        throw new Error("No valid job listing found");
      }

      const { profile } = await browser.storage.local.get(
        "profile"
      );

      if (!profile) {
        throw new Error(
          "Create an accessibility profile first"
        );
      }

      const isRating = message.type === "RATE_JOB";

      const kind = isRating ? "rate" : "guide";
      const path = isRating ? "/rate" : "/guide";

      return cachedRequest(
        kind,
        path,
        message.job,
        profile,
        message.refresh === true
      );
    }

    default:
      return undefined;
  }
});

