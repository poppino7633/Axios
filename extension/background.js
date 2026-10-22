
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

// React UI message handlers
browser.runtime.onMessage.addListener(async (message) => {
  switch (message.type) {
    case "SAVE_PROFILE": {
      const profile = await axiosRequest("/profile", message.profile);
      await browser.storage.local.set({ profile });
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

      const path =
        message.type === "RATE_JOB" ? "/rate" : "/guide";

      return axiosRequest(path, {
        job: message.job,
        profile
      });
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

// Run automatically when background.js starts
testJobRating();

