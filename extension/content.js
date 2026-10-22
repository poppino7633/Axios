
const AXIOS_MIN_DESCRIPTION_LENGTH = 80;

function cleanText(value) {
  if (value == null) return null;

  const text = String(value)
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function textFromHTML(html) {
  if (!html) return null;

  const container = document.createElement("div");
  container.innerHTML = String(html);

  container.querySelectorAll(
    "script, style, noscript, svg"
  ).forEach(element => element.remove());

  return cleanText(container.textContent);
}

function firstText(selectors, root = document) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);

    if (!element) continue;

    const text = cleanText(element.innerText || element.textContent);

    if (text) return text;
  }

  return null;
}

function firstDescription(selectors) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);

    for (const element of elements) {
      const text = cleanText(
        element.innerText || element.textContent
      );

      if (text && text.length >= AXIOS_MIN_DESCRIPTION_LENGTH) {
        return text;
      }
    }
  }

  return null;
}

function emptyJob() {
  return {
    url: window.location.href,
    title: null,
    company: null,
    location: null,
    salary: null,
    workMode: null,
    employmentType: null,
    careerLevel: null,
    description: null
  };
}

function normalizeJob(job) {
  const result = emptyJob();

  for (const key of Object.keys(result)) {
    if (key === "url") {
      result.url = job.url || window.location.href;
    } else {
      result[key] = cleanText(job[key]);
    }
  }

  return result;
}

// --------------------------------------------------
// JSON-LD JOB POSTING EXTRACTION
// --------------------------------------------------

function findJobPosting(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, seen);
      if (found) return found;
    }

    return null;
  }

  const types = Array.isArray(value["@type"])
    ? value["@type"]
    : [value["@type"]];

  if (types.some(type =>
    typeof type === "string" &&
    (type === "JobPosting" || type.endsWith("/JobPosting"))
  )) {
    return value;
  }

  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    if (value[key]) {
      const found = findJobPosting(value[key], seen);
      if (found) return found;
    }
  }

  return null;
}

function formatLocation(location) {
  if (!location) return null;

  if (Array.isArray(location)) {
    return cleanText(
      location.map(formatLocation).filter(Boolean).join("; ")
    );
  }

  if (typeof location === "string") {
    return cleanText(location);
  }

  const address = location.address || location;

  if (typeof address === "string") {
    return cleanText(address);
  }

  return cleanText([
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.addressCountry
  ].filter(Boolean).join(", "));
}

function formatSalary(salary) {
  if (!salary) return null;

  if (typeof salary === "string" || typeof salary === "number") {
    return String(salary);
  }

  const value = salary.value || salary;

  if (typeof value === "string" || typeof value === "number") {
    return cleanText(`${value} ${salary.currency || ""}`);
  }

  const range = [
    value.minValue,
    value.maxValue
  ].filter(v => v != null).join(" - ");

  return cleanText([
    range || value.value,
    salary.currency,
    value.unitText
  ].filter(Boolean).join(" "));
}

function extractJSONLDJob() {
  const scripts = document.querySelectorAll(
    'script[type="application/ld+json"]'
  );

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const posting = findJobPosting(data);

      if (!posting) continue;

      const organization = posting.hiringOrganization;

      const job = normalizeJob({
        url: window.location.href,
        title: posting.title || posting.name,
        company: typeof organization === "string"
          ? organization
          : organization?.name,
        location: formatLocation(posting.jobLocation),
        salary: formatSalary(posting.baseSalary),
        workMode: posting.jobLocationType,
        employmentType: Array.isArray(posting.employmentType)
          ? posting.employmentType.join(", ")
          : posting.employmentType,
        careerLevel: posting.experienceRequirements?.name ||
          posting.experienceRequirements,
        description: textFromHTML(posting.description)
      });

      if (job.title && job.description) {
        return job;
      }
    } catch (error) {
      console.debug("[Axios] JSON-LD parsing failed:", error);
    }
  }

  return null;
}

// --------------------------------------------------
// SITE-SPECIFIC EXTRACTION
// --------------------------------------------------

function extractEJobs() {
  return normalizeJob({
    title: firstText([
      "h1",
      '[class*="job-title"]',
      '[class*="jobTitle"]'
    ]),
    company: firstText([
      '[class*="company-name"]',
      '[class*="companyName"]',
      '[data-testid*="company"]'
    ]),
    location: firstText([
      '[class*="job-location"]',
      '[class*="location"]'
    ]),
    salary: firstText([
      '[class*="salary"]'
    ]),
    workMode: firstText([
      '[class*="work-mode"]'
    ]),
    employmentType: firstText([
      '[class*="employment-type"]'
    ]),
    careerLevel: firstText([
      '[class*="career-level"]'
    ]),
    description: firstDescription([
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[id*="job-description"]',
      "main article"
    ])
  });
}

function extractLinkedIn() {
  return normalizeJob({
    title: firstText([
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      ".top-card-layout__title",
      "h1"
    ]),
    company: firstText([
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".topcard__org-name-link"
    ]),
    location: firstText([
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__bullet",
      ".topcard__flavor--bullet"
    ]),
    description: firstDescription([
      "#job-details",
      ".jobs-description__content",
      ".jobs-box__html-content",
      ".show-more-less-html__markup",
      ".description__text"
    ])
  });
}

function extractBestJobs() {
  return normalizeJob({
    title: firstText([
      "h1",
      '[class*="job-title"]',
      '[class*="jobTitle"]'
    ]),
    company: firstText([
      '[class*="company-name"]',
      '[class*="companyName"]'
    ]),
    location: firstText([
      '[class*="location"]'
    ]),
    salary: firstText([
      '[class*="salary"]'
    ]),
    description: firstDescription([
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="description"]',
      "main article"
    ])
  });
}

// --------------------------------------------------
// GENERIC EXTRACTION
// --------------------------------------------------

function extractGenericJob() {
  return normalizeJob({
    title: firstText([
      "h1",
      '[data-testid="job-title"]',
      '[class*="job-title"]',
      '[class*="jobTitle"]'
    ]),
    company: firstText([
      '[data-testid="company-name"]',
      '[class*="company-name"]',
      '[class*="companyName"]'
    ]),
    location: firstText([
      '[data-testid="job-location"]',
      '[class*="job-location"]'
    ]),
    salary: firstText([
      '[data-testid="salary"]',
      '[class*="salary"]'
    ]),
    description: firstDescription([
      '[data-testid="job-description"]',
      '[id*="job-description"]',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[itemprop="description"]',
      "main article"
    ])
  });
}

// --------------------------------------------------
// EXTRACTION DISPATCHER
// --------------------------------------------------

function extractJob() {
  const hostname = window.location.hostname.toLowerCase();

  // Prefer structured data where available.
  const structured = extractJSONLDJob();

  if (structured) {
    console.log("[Axios] Extracted structured JobPosting");
    return structured;
  }

  let job = null;

  if (hostname === "ejobs.ro" || hostname.endsWith(".ejobs.ro")) {
    job = extractEJobs();
  } else if (
    hostname === "linkedin.com" ||
    hostname.endsWith(".linkedin.com")
  ) {
    job = extractLinkedIn();
  } else if (
    hostname === "bestjobs.eu" ||
    hostname.endsWith(".bestjobs.eu") ||
    hostname === "bestjobs.ro" ||
    hostname.endsWith(".bestjobs.ro")
  ) {
    job = extractBestJobs();
  }

  // Fall back to generic extraction.
  if (!job?.title || !job?.description) {
    const generic = extractGenericJob();

    if (!job) {
      job = generic;
    } else {
      for (const key of Object.keys(job)) {
        if (!job[key] && generic[key]) {
          job[key] = generic[key];
        }
      }
    }
  }

  if (
    !job?.title ||
    !job?.description ||
    job.description.length < AXIOS_MIN_DESCRIPTION_LENGTH
  ) {
    console.warn("[Axios] No valid job listing detected");
    return null;
  }

  console.log("[Axios] Extracted job:", job);
  return job;
}

// --------------------------------------------------
// EXTENSION MESSAGING
// --------------------------------------------------

browser.runtime.onMessage.addListener(message => {
  if (message.type === "GET_JOB_DATA") {
    return Promise.resolve(extractJob());
  }

  return undefined;
});

