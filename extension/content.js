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


// Long pages are cut so the AI request stays fast and cheap
const MAX_DESCRIPTION_CHARS = 8000;

function cleanText(text) {
  const clean = text?.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, MAX_DESCRIPTION_CHARS) : null;
}

// schema.org JobPosting (JSON-LD): most job boards publish it for Google Jobs
function findJobPosting(node) {
  if (!node || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }

  const type = node["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
    return node;
  }

  return findJobPosting(node["@graph"]);
}

function extractJobPosting() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const posting = findJobPosting(JSON.parse(script.textContent));
      if (posting) return posting;
    } catch {
      // invalid JSON-LD on the page; try the next block
    }
  }
  return null;
}

function jobFromPosting(posting) {
  // description is HTML; DOMParser reads it without running any scripts
  const descriptionDoc = new DOMParser()
    .parseFromString(posting.description ?? "", "text/html");
  descriptionDoc.querySelectorAll("script, style").forEach(el => el.remove());
  // keep a gap between paragraphs / list items so their words don't run together
  descriptionDoc.querySelectorAll("p, li, br, div, h1, h2, h3, h4, h5, h6, tr")
    .forEach(el => el.append(" "));
  const description = descriptionDoc.body.textContent;

  const place = [posting.jobLocation].flat()[0]?.address;
  // baseSalary.value is either a number or a QuantitativeValue {value | minValue/maxValue, unitText}
  const pay = posting.baseSalary?.value;
  const amounts = typeof pay === "object" && pay !== null
    ? [pay.minValue ?? pay.value, pay.maxValue]
    : [pay];
  const amountText = amounts.filter(v => v != null && v !== "").join(" - ");
  const salaryText = amountText
    ? `${amountText} ${posting.baseSalary.currency ?? ""} ${pay?.unitText ?? ""}`
    : null;

  return {
    url: window.location.href,
    title: cleanText(posting.title),
    company: cleanText(posting.hiringOrganization?.name),
    location: cleanText([place?.addressLocality, place?.addressCountry?.name ?? place?.addressCountry]
      .filter(v => typeof v === "string").join(", ")),
    salary: cleanText(salaryText),
    workMode: posting.jobLocationType === "TELECOMMUTE" ? "Remote" : null,
    employmentType: cleanText([posting.employmentType].flat().join(", ")),
    careerLevel: null,
    description: cleanText(description)
  };
}

// Any other page: main heading + the main content area's text
function jobFromPage() {
  const main =
    document.querySelector("main, article, [role='main']") ?? document.body;

  return {
    url: window.location.href,
    title: cleanText(document.querySelector("h1")?.textContent) ?? cleanText(document.title),
    company: null,
    location: null,
    salary: null,
    workMode: null,
    employmentType: null,
    careerLevel: null,
    description: cleanText(main?.innerText)
  };
}

function extractJob() {
  const isEjobs = document.querySelector(".jobs-show-main-description__section");

  if (!isEjobs) {
    const posting = extractJobPosting();
    return posting ? jobFromPosting(posting) : jobFromPage();
  }

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

browser.runtime.onMessage.addListener((message) => {
  console.log("[Axios] Received message:", message);

  if (message.type === "GET_JOB_DATA") {
    return Promise.resolve(extractJob());
  }
});

