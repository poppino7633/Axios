
console.log("[Axios] Extension loaded!");

function extractJob() {
  const main =
    document.querySelector("main") ??
    document.body;

  const description = document.querySelector(
    ".jobs-show-main-description"
  )?.textContent?.trim();



  return {
    url: window.location.href,
    title: document.title,
    text: description,
  };
}

console.log("[Axios] Job:", extractJob());

