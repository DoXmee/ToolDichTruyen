{
// This classic content script is deliberately constrained to the fixed
// XSZJ/爱下电子书 routes below. It never accepts selector/script input and never
// touches verification UI, CAPTCHA, or Turnstile. The sole page action is the
// fixed IXDZS "show all catalog" control, needed to expose the site's own
// complete chapter list before it is read.
const XSZJ_HOSTS = new Set(["xszj.org", "www.xszj.org"]);
const IXDZS_HOSTS = new Set(["ixdzs8.com", "www.ixdzs8.com"]);
const HEARTBEAT_PORT_NAME = "huli-heartbeat";
const MAX_SNAPSHOT_BYTES = 1_900_000;
let heartbeatPort;
let heartbeatReconnects = 0;

function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (
    url.href.length > 2_048
    || url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
  ) {
    throw new TypeError("Unsafe XSZJ/爱下电子书 URL.");
  }
  const labels = host.split(".");
  const brand = labels[0] === "www" || labels[0] === "m" ? labels[1] : labels[0];
  const isXszjHost = XSZJ_HOSTS.has(host) || brand === "xszj";
  const isIxdzsHost = IXDZS_HOSTS.has(host) || brand === "ixdzs8";
  if (!isXszjHost && !isIxdzsHost) throw new TypeError("Unsafe XSZJ/爱下电子书 URL.");

  const path = url.pathname.replace(/\/{2,}/gu, "/");
  const rawPage = url.searchParams.get("page");
  const page = typeof rawPage === "string" && /^\d+$/u.test(rawPage)
    ? Number.parseInt(rawPage, 10)
    : undefined;
  if (isXszjHost) {
    const book = /^\/b\/(\d+)\/?$/u.exec(path);
    const catalog = /^\/b\/(\d+)\/cs\/(\d+)\/?$/u.exec(path);
    const chapter = /^\/b\/(\d+)\/c\/(\d+)\/?$/u.exec(path);
    const origin = XSZJ_HOSTS.has(host) ? "https://xszj.org" : `https://${host}`;
    if (book?.[1]) return `${origin}/b/${book[1]}`;
    if (catalog?.[1] && catalog[2]) return `${origin}/b/${catalog[1]}/cs/${catalog[2]}`;
    if (chapter?.[1] && chapter[2]) {
      const suffix = Number.isSafeInteger(page) && page > 1 ? `?page=${page}` : "";
      return `${origin}/b/${chapter[1]}/c/${chapter[2]}${suffix}`;
    }
  } else {
    const book = /^\/read\/(\d+)\/?$/u.exec(path);
    const chapter = /^\/read\/(\d+)\/p(\d+)\.html\/?$/u.exec(path);
    const origin = IXDZS_HOSTS.has(host) ? "https://ixdzs8.com" : `https://${host}`;
    if (book?.[1]) return `${origin}/read/${book[1]}/`;
    if (chapter?.[1] && chapter[2]) return `${origin}/read/${chapter[1]}/p${chapter[2]}.html`;
  }
  throw new TypeError("Unsupported XSZJ/爱下电子书 path.");
}
function isSupportedCurrentPage() {
  try {
    normalizeUrl(location.href);
    return true;
  } catch {
    return false;
  }
}

function connectHeartbeat() {
  if (heartbeatPort || heartbeatReconnects >= 3 || !isSupportedCurrentPage()) return;
  heartbeatReconnects += 1;
  try {
    const port = chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME });
    heartbeatPort = port;
    port.onDisconnect.addListener(() => {
      if (heartbeatPort === port) heartbeatPort = undefined;
      setTimeout(connectHeartbeat, 100);
    });
  } catch {
    setTimeout(connectHeartbeat, 100);
  }
}

const NOISE_SELECTOR = [
  "script", "style", "noscript", "iframe", "ins", "figure",
  ".ad", ".ads", ".advert", ".advertisement", "[id^=ad_]", "[class^=ad-]", "[class*= ad-]",
].join(",");
const BLOCK_SELECTOR = "p,div,li,blockquote,pre,section,article";

function normalizeText(raw) {
  return String(raw ?? "").normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v ]+\n/gu, "\n")
    .replace(/\n[\t\f\v ]+/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function textOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return normalizeText(clone.textContent ?? "");
}

function storyTextOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll(NOISE_SELECTOR).forEach((node) => node.remove());
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  clone.querySelectorAll(BLOCK_SELECTOR).forEach((block) => {
    block.before("\n");
    block.after("\n");
  });
  return normalizeText(clone.textContent ?? "");
}

function isVisibleChallengeControl(element) {
  if (!element || element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

function challengeState() {
  const interactive = Array.from(document.querySelectorAll(
    'iframe[src*="challenges.cloudflare.com"],.cf-turnstile,.cf-turnstile button,.cf-turnstile input[type="checkbox"]',
  )).some(isVisibleChallengeControl);
  if (interactive) return "interactive";
  const text = `${document.title}\n${textOf(document.body)}`;
  return /Just a moment|Checking your browser|Verify you are human|cf-chl-|Cloudflare Ray ID/iu.test(text)
    ? "passive"
    : "none";
}

function scopes(element) {
  const found = new Set();
  let current = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    if (current.id) found.add(`#${current.id}`);
    for (const name of current.classList ?? []) found.add(`.${name}`);
  }
  return [...found].slice(0, 32);
}

function safeLinks() {
  return Array.from(document.querySelectorAll("a[href]"), (anchor) => {
    try {
      return {
        href: normalizeUrl(anchor.href),
        text: textOf(anchor).replace(/\s+/gu, " ").trim(),
        scopes: scopes(anchor),
      };
    } catch {
      return undefined;
    }
  }).filter(Boolean).slice(0, 20_000);
}

function isIxdzsBook(url) {
  try {
    const parsed = new URL(url);
    const labels = parsed.hostname.toLowerCase().split(".");
    const brand = labels[0] === "www" || labels[0] === "m" ? labels[1] : labels[0];
    return brand === "ixdzs8" && /^\/read\/\d+\/$/u.test(parsed.pathname);
  } catch {
    return false;
  }
}

function visible(element) {
  if (!element || element.hasAttribute("hidden")) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * IXDZS initially renders only a short catalog slice. This is intentionally
 * not a generic click facility: it acts only on one exact, visible in-page
 * control on an allow-listed book URL and waits for the chapter link count to
 * increase. A failure leaves the page untouched beyond that site-native action
 * and the caller receives the normal snapshot rather than a guessed catalog.
 */
async function expandIxdzsCatalog(requestedUrl) {
  if (!isIxdzsBook(requestedUrl)) return;
  const trigger = document.querySelector("li.catalog-all");
  if (!visible(trigger)) return;
  const before = document.querySelectorAll(".u-chapter a[href]").length;
  if (!before) return;
  trigger.click();
  await new Promise((resolve) => {
    const timeout = setTimeout(done, 8_000);
    const observer = new MutationObserver(() => {
      if (document.querySelectorAll(".u-chapter a[href]").length > before) done();
    });
    function done() {
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.querySelectorAll(".u-chapter a[href]").length > before) done();
  });
}

async function collect(requestedUrl) {
  const requested = normalizeUrl(requestedUrl);
  const current = normalizeUrl(location.href);
  if (requested !== current) throw new Error("The paired XSZJ page is no longer the requested URL.");
  await expandIxdzsCatalog(requested);

  const elements = {};
  for (const selector of ["h1", ".bookname", "#content", "article.page-content"]) {
    const extractor = selector === "#content" || selector === "article.page-content" ? storyTextOf : textOf;
    const values = Array.from(document.querySelectorAll(selector)).map(extractor).filter(Boolean).slice(0, 5_000);
    if (values.length) elements[selector] = values;
  }
  let canonicalUrl;
  try { canonicalUrl = normalizeUrl(document.querySelector('link[rel="canonical"]')?.href); } catch { /* omit */ }
  const snapshot = {
    requestedUrl: requested,
    url: current,
    status: 200,
    title: String(document.title ?? "").normalize("NFC").slice(0, 1_000),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    charset: String(document.characterSet || "UTF-8").slice(0, 32),
    htmlLanguage: String(document.documentElement.lang || "").slice(0, 64),
    bodyText: textOf(document.body),
    elements,
    links: safeLinks(),
    fontFamilies: [],
    fontUrls: [],
    fontHashes: [],
    challenge: challengeState(),
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("Page snapshot exceeds the safe 1.9 MB envelope.");
  }
  return snapshot;
}

if (isSupportedCurrentPage()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "collect-snapshot") return false;
    void collect(message.requestedUrl).then(
      (snapshot) => sendResponse({ ok: true, snapshot }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "XSZJ snapshot failed." }),
    );
    return true;
  });

  connectHeartbeat();
}
}
