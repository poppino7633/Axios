
console.log("[Axios] Extension loaded!");


function extractSummary(title) {
  const label = document.querySelector(
    `.jobs-show-main-summaries__summary-prop[title="${title}"]`
  );

  const row = label?.closest(
    ".jobs-show-main-summaries__summary"
  );

  return row?.querySelector(
    ".jobs-show-main-summaries__summary-value"
  )?.textContent?.trim() ?? null;
}



function extractJob() {
  const description = document.querySelector(
    ".jobs-show-main-description__section"
  )?.textContent?.trim() ?? null;

  const title = document.querySelector(
    ".jobs-show-main-header__infos-title"
  )?.textContent?.trim() ?? null;

  const company = document.querySelector(
    ".jobs-show-side-company__infos-title"
  )?.textContent?.trim() ?? null;

  return {
    url: window.location.href,
    title,
    company,
    location: extractSummary("Oraș de lucru"),
    salary: extractSummary("Salariu"),
    workMode: extractSummary("Mod de lucru"),
    employmentType: extractSummary("Tipul job-ului"),
    careerLevel: extractSummary("Nivel carieră"),
    description
  };
}

console.log("[Axios] Job:", extractJob());

