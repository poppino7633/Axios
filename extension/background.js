
const AXIOS_SERVER = "http://10.200.20.64:8765";

// Temporary development setup.
// Set the token locally; do not commit a real token.
async function getToken() {
  const { axiosToken } = await browser.storage.local.get("axiosToken");

  if (!axiosToken) {
    throw new Error("Axios server token is not configured");
  }

  return axiosToken;
}

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

browser.runtime.onMessage.addListener(async (message) => {
  switch (message.type) {
    case "SAVE_PROFILE":
      return axiosRequest("/profile", message.profile);

    case "GET_PROFILE":
      return axiosRequest("/profile");

    case "RATE_JOB":
      return axiosRequest("/rate", message.job);

    case "GUIDE_JOB":
      return axiosRequest("/guide", message.job);

    default:
      return undefined;
  }
});



async function testAPI() {
  try {
    // 1. Test server connectivity
    const response = await fetch("http://10.200.20.64:8765/health");
    const health = await response.json();

    console.log("[Axios] Server health:", health);

    // 2. Test authentication and retrieve saved profile
    if (health.profile_saved) {
      const profile = await axiosRequest("/profile");
      console.log("[Axios] Saved profile:", profile);
    } else {
      console.log("[Axios] No profile saved yet");
    }

  } catch (error) {
    console.error("[Axios] API test failed:", error);
  }
}

testAPI();

