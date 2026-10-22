console.log("[Axios] Background loaded");

browser.action.onClicked.addListener(async (tab) => {
  console.log("[Axios] Target tab:", tab.url);

  if (!tab.id || !tab.url?.startsWith("https://www.ejobs.ro/")) {
    console.error("[Axios] Open an eJobs page first");
    return;
  }

  try {
    const job = await browser.tabs.sendMessage(tab.id, {
      type: "GET_JOB_DATA"
    });

    console.log("[Axios] Job:", JSON.stringify(job, null, 2));
  } catch (error) {
    console.error("[Axios] Messaging failed:", error);
  }
});
