(() => {
  // Prevent duplicate listeners when the popup reinjects the script.
  if (globalThis.__axiosContentLoaded) return;
  globalThis.__axiosContentLoaded = true;

  const AXIOS_MIN_DESCRIPTION_LENGTH = 80;
  const AXIOS_MAX_DESCRIPTION_LENGTH = 12000;

  // --------------------------------------------------
  // TEXT HELPERS
  // --------------------------------------------------

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
      const elements = root.querySelectorAll(selector);

      for (const element of elements) {
        const text = cleanText(
          element.innerText || element.textContent
        );

        if (text) return text;
      }
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
        ".job-details-jobs-unified-top-card__job-title h1",
        "[class*='job-title']",
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
        ".jobs-description__content .jobs-box__html-content",
        ".jobs-show-main-description__section",
        ".jobs-description-content__text",
        ".jobs-description__container",
        ".jobs-search__job-details--container #job-details",
        "[data-testid='job-details']",
        "[class*='job-details-module__description']",
        ".jobs-description",
        "[class*='jobs-description']",
        ".jobs-box__html-content",
        ".show-more-less-html__markup",
        ".description__text"
      ])
    });
  }

  function extractBestJobs() {
    const title = firstText([
      'h2 a[href*="/job/"]',
      'h2 a[href*="/loc-de-munca/"]',
      "h2",
      "h1"
    ]);

    const company = firstText([
      'h3 a[href*="/company-profile/"]',
      'a[href*="/company-profile/"]',
      '[class*="company-name"]',
      '[class*="companyName"]'
    ]);

    const description = firstDescription([
      ".job-description",
      ".prose.job-description",
      '[class*="job-description"]',
      '[class*="jobDescription"]'
    ]);

    const heading = document.querySelector(
      'h2 a[href*="/job/"], h2 a[href*="/loc-de-munca/"]'
    )?.closest("h2");

    const header = heading?.parentElement;

    let location = null;
    let salary = null;

    if (header) {
      const headerText = cleanText(header.innerText);

      const salaryMatch = headerText?.match(
        /(?:confidential salary|salariu confidențial|[\d.,]+\s*(?:lei|ron|eur|€))/i
      );

      salary = salaryMatch?.[0] || null;

      const buttons = header.querySelectorAll("button");

      for (const button of buttons) {
        const text = cleanText(button.innerText);

        if (
          text &&
          /București|Bucuresti|România|Romania|Cluj|Iași|Iasi|Timișoara|Timisoara|Brașov|Brasov|Constanța|Constanta/i.test(text)
        ) {
          location = text;
          break;
        }
      }
    }

    return normalizeJob({
      title,
      company,
      location,
      salary,
      description
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
        '[class*="description"]',
        '[class*="Description"]',
        '[data-testid*="description"]',
        "main article",
        "article"
      ])
    });
  }

  // --------------------------------------------------
  // EXTRACTION DISPATCHER
  // --------------------------------------------------

  function extractJob() {
    const hostname = window.location.hostname.toLowerCase();

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
      !job?.description ||
      job.description.length < AXIOS_MIN_DESCRIPTION_LENGTH
    ) {
      const candidates = [
        "[role='main'] section",
        "main section",
        "[role='main'] article",
        "main article",
        "[class*='job-detail']",
        "[class*='jobDetail']",
        "[class*='job-description']",
        "[class*='jobDescription']"
      ];

      const fallback = firstDescription(candidates);
      if (fallback) job.description = fallback;
    }

    if (
      !job?.title ||
      !job?.description ||
      job.description.length < AXIOS_MIN_DESCRIPTION_LENGTH
    ) {
      console.warn("[Axios] No valid job listing detected", {
        url: location.href,
        title: job?.title,
        descriptionLength: job?.description?.length ?? 0
      });

      return null;
    }

    job.description = job.description.slice(
      0,
      AXIOS_MAX_DESCRIPTION_LENGTH
    );

    console.log("[Axios] Extracted job:", job);
    return job;
  }

  async function extractJobWithRetry() {
    let job = extractJob();
    if (job) return job;

    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 350));
      job = extractJob();
      if (job) return job;
    }

    return null;
  }

  // --------------------------------------------------
  // SEARCH RESULT SCREENING (eJobs)
  // --------------------------------------------------

  const SEARCH_SELECTORS = {
    card: ".job-card",
    title: ".job-card-content-middle__title a",
    company: ".job-card-content-middle__info--darker a"
  };

  const SCREEN_LABELS = {
    1: "Potential conflict",
    2: "Uncertain",
    3: "No obvious conflict"
  };

  const SCREEN_STYLES = {
    1: {
      background: "#ffe5e5",
      color: "#8f2020",
      border: "1px solid #f3aaaa"
    },
    2: {
      background: "#fff1cf",
      color: "#795300",
      border: "1px solid #ebce83"
    },
    3: {
      background: "#dff4e7",
      color: "#17643a",
      border: "1px solid #9dd7b2"
    }
  };

  let screenTimer = null;
  let screenRunning = false;
  let screenRequestedAgain = false;
  let lastScreenSignature = null;
  let lastScreenProfile = null;
  let lastScreenRatings = null;
  let lastScreenElements = [];
  let lastScreenJobs = [];

  function isEJobsSite() {
    const hostname = location.hostname.toLowerCase();

    return hostname === "ejobs.ro" ||
      hostname.endsWith(".ejobs.ro");
  }

  function extractSearchJobs() {
    const jobs = [];
    const elements = [];

    const cards = document.querySelectorAll(
      SEARCH_SELECTORS.card
    );

    for (const card of cards) {
      const titleElement = card.querySelector(
        SEARCH_SELECTORS.title
      );

      const companyElement = card.querySelector(
        SEARCH_SELECTORS.company
      );

      if (!titleElement || !companyElement) continue;

      const title = cleanText(titleElement.textContent);
      const company = cleanText(companyElement.textContent);

      if (!title || !company) continue;

      jobs.push({ title, company });
      elements.push(titleElement);
    }

    return { jobs, elements };
  }

  function removeScreenBadges() {
    document.querySelectorAll(".axios-screen-badge")
      .forEach(badge => badge.remove());
  }

  function createScreenBadge(rating) {
    const badge = document.createElement("span");
    const style = SCREEN_STYLES[rating];

    badge.className = "axios-screen-badge";
    badge.dataset.axiosRating = String(rating);

    badge.textContent = `Axios: ${SCREEN_LABELS[rating]}`;

    badge.setAttribute(
      "aria-label",
      `Axios preliminary accessibility screening: ${SCREEN_LABELS[rating]}`
    );

    badge.title =
      "Preliminary screening based only on job title and company. " +
      "Open the job for a detailed assessment.";

    Object.assign(badge.style, {
      display: "inline-block",
      verticalAlign: "middle",
      marginLeft: "8px",
      marginTop: "4px",
      padding: "4px 8px",
      borderRadius: "6px",
      fontSize: "12px",
      lineHeight: "1.4",
      fontWeight: "600",
      whiteSpace: "normal",
      ...style
    });

    return badge;
  }

  function injectScreenRatings(elements, ratings) {
    if (elements.length !== ratings.length) {
      console.error(
        "[Axios] Rating count does not match job count"
      );
      return;
    }

    for (let i = 0; i < ratings.length; i++) {
      const titleElement = elements[i];
      const rating = ratings[i];

      if (!titleElement?.isConnected) continue;
      if (![1, 2, 3].includes(rating)) continue;

      const heading = titleElement.closest(
        ".job-card-content-middle__title"
      );

      if (!heading) continue;

      heading.querySelectorAll(".axios-screen-badge")
        .forEach(badge => badge.remove());

      const badge = createScreenBadge(rating);
      heading.appendChild(badge);
    }
  }

  function showScreenLoading(elements) {
    for (const titleElement of elements) {
      if (!titleElement?.isConnected) continue;

      const heading = titleElement.closest(
        ".job-card-content-middle__title"
      );

      if (!heading) continue;

      heading.querySelectorAll(".axios-screen-badge")
        .forEach(badge => badge.remove());

      const badge = document.createElement("span");
      badge.className = "axios-screen-badge";
      badge.textContent = "Axios: analyzing…";
      badge.setAttribute("role", "status");

      Object.assign(badge.style, {
        display: "inline-block",
        marginLeft: "8px",
        padding: "4px 8px",
        borderRadius: "6px",
        background: "#ece7f7",
        color: "#49336d",
        fontSize: "12px",
        fontWeight: "600"
      });

      heading.appendChild(badge);
    }
  }

  function screenSignature(jobs) {
    return JSON.stringify(jobs);
  }

  async function runSearchScreening() {
    if (!isEJobsSite()) return;

    if (screenRunning) {
      screenRequestedAgain = true;
      return;
    }

    screenRunning = true;

    try {
      const { jobs, elements } = extractSearchJobs();

      if (jobs.length === 0) {
        lastScreenSignature = null;
        lastScreenRatings = null;
        lastScreenElements = [];
        lastScreenJobs = [];
        return;
      }

      const { profile } = await browser.storage.local.get("profile");

      if (!profile) {
        removeScreenBadges();
        lastScreenSignature = null;
        lastScreenProfile = null;
        lastScreenRatings = null;
        return;
      }

      const signature = screenSignature(jobs);
      const profileSignature = JSON.stringify(profile);

      // If the same jobs were already screened, just restore
      // badges on DOM elements replaced by eJobs.
      if (
        signature === lastScreenSignature &&
        profileSignature === lastScreenProfile &&
        lastScreenRatings
      ) {
        injectScreenRatings(elements, lastScreenRatings);
        lastScreenElements = elements;
        return;
      }

      showScreenLoading(elements);

      console.log("[Axios] Screening jobs:", jobs);

      const ratings = await browser.runtime.sendMessage({
        type: "SCREEN_JOBS",
        jobs
      });

      if (
        !Array.isArray(ratings) ||
        ratings.length !== jobs.length
      ) {
        throw new Error("Invalid screening response");
      }

      // eJobs may have changed the results while the API
      // request was running. Do not attach old scores to
      // a different set of jobs.
      const current = extractSearchJobs();

      if (
        screenSignature(current.jobs) !== signature
      ) {
        screenRequestedAgain = true;
        return;
      }

      lastScreenSignature = signature;
      lastScreenProfile = profileSignature;
      lastScreenRatings = ratings;
      lastScreenJobs = jobs;
      lastScreenElements = current.elements;

      injectScreenRatings(current.elements, ratings);

      console.log("[Axios] Screening complete:", ratings);
    } catch (error) {
      console.error("[Axios] Screening failed:", error);
      removeScreenBadges();
      lastScreenSignature = null;
      lastScreenRatings = null;
    } finally {
      screenRunning = false;

      if (screenRequestedAgain) {
        screenRequestedAgain = false;
        scheduleSearchScreening();
      }
    }
  }

  function scheduleSearchScreening() {
    if (!isEJobsSite()) return;

    clearTimeout(screenTimer);

    screenTimer = setTimeout(() => {
      runSearchScreening();
    }, 500);
  }

  function initializeSearchScreening() {
    if (!isEJobsSite()) return;

    scheduleSearchScreening();

    const observer = new MutationObserver(mutations => {
      // Ignore changes consisting exclusively of our badges.
      const relevant = mutations.some(mutation => {
        if (mutation.type !== "childList") return false;

        const changedNodes = [
          ...mutation.addedNodes,
          ...mutation.removedNodes
        ];

        return changedNodes.some(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) {
            return false;
          }

          if (node.classList?.contains("axios-screen-badge")) {
            return false;
          }

          // Re-screen only when job cards or their content change.
          return (
            node.matches?.(
              ".job-card, .job-card-content, " +
              ".job-card-content-middle, " +
              ".job-card-content-middle__title, " +
              ".job-card-content-middle__info--darker"
            ) ||
            node.querySelector?.(".job-card") !== null ||
            node.closest?.(".job-card") !== null
          );
        });
      });

      if (relevant) {
        scheduleSearchScreening();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    browser.storage.onChanged.addListener(
      (changes, areaName) => {
        if (
          areaName === "local" &&
          Object.prototype.hasOwnProperty.call(
            changes,
            "profile"
          )
        ) {
          lastScreenSignature = null;
          lastScreenProfile = null;
          lastScreenRatings = null;
          scheduleSearchScreening();
        }
      }
    );
  }

  // --------------------------------------------------
  // EXTENSION MESSAGING
  // --------------------------------------------------

  browser.runtime.onMessage.addListener(message => {
    if (message.type === "GET_JOB_DATA") {
      return extractJobWithRetry();
    }

    if (message.type === "GET_SEARCH_JOBS") {
      return Promise.resolve(extractSearchJobs().jobs);
    }

    if (message.type === "REFRESH_SEARCH_SCREENING") {
      lastScreenSignature = null;
      lastScreenRatings = null;
      scheduleSearchScreening();

      return Promise.resolve({ success: true });
    }

    return undefined;
  });

  // --------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeSearchScreening,
      { once: true }
    );
  } else {
    initializeSearchScreening();
  }
})();
