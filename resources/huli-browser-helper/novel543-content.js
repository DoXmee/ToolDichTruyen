{
// Strict Novel543 snapshot reader. It never clicks CAPTCHA/Turnstile or runs caller-provided code.
const NOVEL543_HOSTS = new Set(["novel543.com", "www.novel543.com"]);
const HEARTBEAT_PORT_NAME = "huli-heartbeat";
const MAX_SNAPSHOT_BYTES = 1_900_000;
let heartbeatPort;
let heartbeatReconnects = 0;

function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const labels = host.split(".");
  const brand = labels[0] === "www" || labels[0] === "m" ? labels[1] : labels[0];
  if (url.href.length > 2_048 || url.protocol !== "https:" || url.port || url.username || url.password || (!NOVEL543_HOSTS.has(host) && brand !== "novel543")) {
    throw new TypeError("Unsafe Novel543 URL.");
  }
  const origin = NOVEL543_HOSTS.has(host) ? "https://www.novel543.com" : `https://${labels[0] === "www" ? host : `www.${host}`}`;
  const path = url.pathname.replace(/\/{2,}/gu, "/");
  const book = /^\/(\d{6,20})\/?$/u.exec(path);
  const catalog = /^\/(\d{6,20})\/dir\/?$/u.exec(path);
  const chapter = /^\/(\d{6,20})\/(\d+_\d+)(?:_(\d+))?\.html$/u.exec(path);
  if (book?.[1]) return `${origin}/${book[1]}/`;
  if (catalog?.[1]) return `${origin}/${catalog[1]}/dir`;
  if (chapter?.[1] && chapter[2]) {
    const part = chapter[3] && Number.parseInt(chapter[3], 10) > 1 ? `_${Number.parseInt(chapter[3], 10)}` : "";
    return `${origin}/${chapter[1]}/${chapter[2]}${part}.html`;
  }
  throw new TypeError("Unsupported Novel543 path.");
}
function isSupportedCurrentPage() { try { normalizeUrl(location.href); return true; } catch { return false; } }
function connectHeartbeat() {
  if (heartbeatPort || heartbeatReconnects >= 3 || !isSupportedCurrentPage()) return;
  heartbeatReconnects += 1;
  try {
    const port = chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME });
    heartbeatPort = port;
    port.onDisconnect.addListener(() => { if (heartbeatPort === port) heartbeatPort = undefined; setTimeout(connectHeartbeat, 100); });
  } catch { setTimeout(connectHeartbeat, 100); }
}

const STORY_NOISE_SELECTOR = [
  "script", "style", "noscript", "iframe", "ins", ".adBlock", ".gadBlock", ".clickforceads",
  "#teadunit", "[id^=cfadif]", ".div-onead", ".pf", ".onead", ".foot-nav", ".reader-tools",
].join(",");
const BLOCK_SELECTOR = "p,div,li,blockquote,pre,section,article";

function normalizeText(raw) {
  return String(raw ?? "").normalize("NFC").replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v ]+\n/gu, "\n").replace(/\n[\t\f\v ]+/gu, "\n")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n").trim();
}
function textOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return normalizeText(clone.textContent ?? "");
}
function storyTextOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll(STORY_NOISE_SELECTOR).forEach((node) => node.remove());
  clone.querySelectorAll(":scope > div").forEach((node) => {
    const value = normalizeText(node.textContent ?? "");
    if (/^(?:ONEAD|溫馨提示|温馨提示)(?:\s|[:：]|$)/u.test(value)) node.remove();
  });
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  clone.querySelectorAll(BLOCK_SELECTOR).forEach((block) => { block.before("\n"); block.after("\n"); });
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
  const hasChallengeDocument = Boolean(document.querySelector('script[src*="/cdn-cgi/challenge-platform/"],#challenge-running,#challenge-stage,#challenge-form')) || Array.from(document.scripts).some((script) => /window\._cf_chl_opt\s*=/u.test(script.textContent || ""));
  if (!hasChallengeDocument && Array.from(document.querySelectorAll(".chapter-content .content,.chaplist .all")).some((node) => storyTextOf(node).length >= 40)) return "none";
  const interactive = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare.com"],.cf-turnstile,.cf-turnstile button,.cf-turnstile input[type="checkbox"]')).some(isVisibleChallengeControl);
  if (interactive) return "interactive";
  const text = `${document.title}\n${textOf(document.body)}`;
  return hasChallengeDocument || /^(?:Just a moment|Checking your browser|Chờ một chút|请稍候|請稍候)[.!…。\s]*$/iu.test(document.title.trim()) || /checking your browser|xác minh bảo mật|xác minh bạn không phải/iu.test(text) && /cloudflare|cf[-_]chl[-_]/iu.test(text) ? "passive" : "none";
}
function scopes(element) {
  const found = new Set(); let current = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    if (current.id) found.add(`#${current.id}`);
    for (const name of current.classList ?? []) found.add(`.${name}`);
  }
  return [...found].slice(0, 32);
}
function safeLinks() {
  return Array.from(document.querySelectorAll("a[href]"), (anchor) => {
    try { return { href: normalizeUrl(anchor.href), text: textOf(anchor).replace(/\s+/gu, " ").trim(), scopes: scopes(anchor) }; }
    catch { return undefined; }
  }).filter(Boolean).slice(0, 20_000);
}

async function collect(requestedUrl) {
  const requested = normalizeUrl(requestedUrl);
  const current = normalizeUrl(location.href);
  if (requested !== current) throw new Error("The paired Novel543 page is no longer the requested page.");
  const elements = {};
  for (const selector of ["h1", ".title", ".author", ".meta-dir", ".chaplist .all", ".chapter-content .content", ".chapter-content", "#content"]) {
    const extractor = [".chapter-content .content", ".chapter-content", "#content"].includes(selector) ? storyTextOf : textOf;
    const values = Array.from(document.querySelectorAll(selector)).map(extractor).filter(Boolean).slice(0, 5_000);
    if (values.length) elements[selector] = values;
  }
  let canonicalUrl;
  try { canonicalUrl = normalizeUrl(document.querySelector('link[rel="canonical"]')?.href); } catch { /* omit */ }
  const snapshot = {
    requestedUrl: requested, url: current,
    title: String(document.title ?? "").normalize("NFC").slice(0, 1_000),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    charset: String(document.characterSet || "UTF-8").slice(0, 32),
    htmlLanguage: String(document.documentElement.lang || "").slice(0, 64),
    bodyText: textOf(document.body), rawBodyText: document.body?.innerText ?? document.body?.textContent ?? '', elements, links: safeLinks(),
    fontFamilies: [], fontUrls: [], fontHashes: [], challenge: challengeState(),
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) throw new RangeError("Page snapshot exceeds the safe 1.9 MB envelope.");
  return snapshot;
}

if (isSupportedCurrentPage()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "collect-snapshot") return false;
    void collect(message.requestedUrl).then(
      (snapshot) => sendResponse({ ok: true, snapshot }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Novel543 snapshot failed." }),
    );
    return true;
  });
  connectHeartbeat();
}
}
