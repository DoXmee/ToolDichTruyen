{
// Strict TimoTXT snapshot reader. It never clicks CAPTCHA/Turnstile or runs caller-provided code.
const TIMOTXT_HOSTS = new Set(["timotxt.com", "www.timotxt.com"]);
const HEARTBEAT_PORT_NAME = "huli-heartbeat";
const MAX_SNAPSHOT_BYTES = 1_900_000;
const MAX_FONT_BYTES = 2_000_000;
const MAX_STYLESHEET_BYTES = 1_000_000;
let heartbeatPort;
let heartbeatReconnects = 0;

function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const labels = host.split(".");
  const brand = labels[0] === "www" || labels[0] === "m" ? labels[1] : labels[0];
  if (
    url.href.length > 2_048
    || url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || (!TIMOTXT_HOSTS.has(host) && brand !== "timotxt")
  ) throw new TypeError("Unsafe TimoTXT URL.");
  const origin = TIMOTXT_HOSTS.has(host) ? "https://www.timotxt.com" : `https://${labels[0] === "www" ? host : `www.${host}`}`;
  const path = url.pathname.replace(/\/{2,}/gu, "/");
  const book = /^\/([a-zA-Z0-9]{4,24})\/?$/u.exec(path);
  const catalog = /^\/([a-zA-Z0-9]{4,24})\/dir\/?$/u.exec(path);
  const chapter = /^\/([a-zA-Z0-9]{4,24})\/(\d+)(?:_(\d+))?\.html\/?$/u.exec(path);
  if (book?.[1]) return `${origin}/${book[1]}/`;
  if (catalog?.[1]) return `${origin}/${catalog[1]}/dir`;
  if (chapter?.[1] && chapter[2]) {
    const part = chapter[3] && Number.parseInt(chapter[3], 10) > 1 ? `_${Number.parseInt(chapter[3], 10)}` : "";
    return `${origin}/${chapter[1]}/${chapter[2]}${part}.html`;
  }
  throw new TypeError("Unsupported TimoTXT path.");
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
  "script", "style", "noscript", "iframe", "ins", "figure", ".adBlock", ".gadBlock", ".clickforceads",
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
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return normalizeText(clone.textContent ?? "");
}
function storyTextOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll(STORY_NOISE_SELECTOR).forEach((node) => node.remove());
  clone.querySelectorAll(":scope > div").forEach((node) => {
    const value = normalizeText(node.textContent ?? "");
    if (/(?:ONEAD_TEXT|溫馨提示\s*[:：]|温馨提示\s*[:：])/u.test(value)) node.remove();
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
  const interactive = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare.com"],.cf-turnstile,.cf-turnstile button,.cf-turnstile input[type="checkbox"]')).some(isVisibleChallengeControl);
  if (interactive) return "interactive";
  return /Just a moment|Checking your browser|Performing security verification|Verify you are human|cf-chl-|Cloudflare Ray ID/iu.test(`${document.title}\n${textOf(document.body)}`) ? "passive" : "none";
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
function isAllowedTimotxtHost(host) {
  const normalized = host.toLowerCase();
  return TIMOTXT_HOSTS.has(normalized) || normalized.endsWith(".timotxt.com");
}
function normalizeFontUrl(rawUrl, baseUrl = location.href) {
  const url = new URL(rawUrl, baseUrl);
  const host = url.hostname.toLowerCase();
  if (
    url.href.length > 2_048
    || url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || !isAllowedTimotxtHost(host)
    || !/\.(?:woff2?|ttf)(?:$|\?)/iu.test(url.pathname)
  ) throw new TypeError("Unsafe TimoTXT font URL.");
  return url.href;
}
function cleanFontFamily(value) {
  return String(value ?? "").replace(/["']/gu, "").trim();
}
function activeContentFontFamilies() {
  const families = new Set();
  for (const element of document.querySelectorAll(".chapter-content .content")) {
    const style = getComputedStyle(element);
    style.fontFamily.split(",").map(cleanFontFamily).filter(Boolean).forEach((family) => families.add(family));
  }
  return [...families].slice(0, 32);
}
function requestWorkerAsset(url, kind) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "read-timotxt-asset", url, kind }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) return resolve(undefined);
        resolve(response);
      });
    } catch { resolve(undefined); }
  });
}
function collectFontUrlsFromCss(cssText, family, baseUrl) {
  const urls = [];
  for (const match of cssText.matchAll(/@font-face\s*\{([\s\S]*?)\}/giu)) {
    const rule = match[1] ?? "";
    const declaredFamily = cleanFontFamily(/(?:^|;)\s*font-family\s*:\s*([^;]+)/iu.exec(rule)?.[1]);
    if (!declaredFamily || declaredFamily.toLowerCase() !== family.toLowerCase()) continue;
    const source = /(?:^|;)\s*src\s*:\s*([^;]+)/iu.exec(rule)?.[1] ?? "";
    for (const sourceMatch of source.matchAll(/url\(["']?([^"')]+\.(?:woff2?|ttf)(?:\?[^"')]*)?)/giu)) {
      try { urls.push({ family: declaredFamily, url: normalizeFontUrl(sourceMatch[1], baseUrl) }); } catch { /* ignore unsafe font urls */ }
    }
  }
  return urls;
}
async function activeFontCandidates(fontFamilies) {
  const active = new Set(fontFamilies.map((family) => family.toLowerCase()));
  const candidates = [];
  const fontFaceRuleType = typeof CSSRule === "undefined" ? 5 : (CSSRule.FONT_FACE_RULE ?? 5);
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== fontFaceRuleType) continue;
        const family = cleanFontFamily(rule.style.getPropertyValue("font-family"));
        if (!family || !active.has(family.toLowerCase())) continue;
        const source = rule.style.getPropertyValue("src");
        for (const match of source.matchAll(/url\(["']?([^"')]+\.(?:woff2?|ttf)(?:\?[^"')]*)?)/giu)) {
          if (!match[1]) continue;
          try { candidates.push({ family, url: normalizeFontUrl(match[1], sheet.href || location.href) }); } catch { /* ignore unsafe font urls */ }
        }
      }
    } catch {
      // Cross-origin stylesheets are unreadable through CSSOM. Fetch only the
      // stylesheet's own TimoTXT origin and parse its @font-face declarations.
      if (!sheet.href) continue;
      try {
        const stylesheetUrl = new URL(sheet.href, location.href);
        if (!isAllowedTimotxtHost(stylesheetUrl.hostname.toLowerCase())) continue;
        const workerResult = await requestWorkerAsset(stylesheetUrl.href, "stylesheet");
        const cssText = typeof workerResult?.text === "string" ? workerResult.text : "";
        if (!cssText) continue;
        if (new TextEncoder().encode(cssText).byteLength > MAX_STYLESHEET_BYTES) continue;
        for (const family of fontFamilies) candidates.push(...collectFontUrlsFromCss(cssText, family, stylesheetUrl.href));
      } catch { /* ignore unreadable or oversized stylesheets */ }
    }
  }
  return candidates.filter((candidate, index, all) => all.findIndex((value) =>
    value.family.toLowerCase() === candidate.family.toLowerCase() && value.url === candidate.url,
  ) === index).slice(0, 4);
}
async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function collectFontAssets() {
  const fontFamilies = activeContentFontFamilies();
  const candidates = await activeFontCandidates(fontFamilies);
  const fontAssets = [];
  for (const candidate of candidates) {
    try {
      let response;
      try {
        response = await fetch(candidate.url, {
          credentials: "same-origin",
          cache: "force-cache",
          redirect: "error",
        });
      } catch { response = undefined; }
      let buffer = response?.ok ? await response.arrayBuffer() : undefined;
      if (!buffer) {
        const workerResult = await requestWorkerAsset(candidate.url, "font");
        if (typeof workerResult?.base64 !== "string") continue;
        const binary = atob(workerResult.base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        buffer = bytes.buffer;
      }
      if (buffer.byteLength > MAX_FONT_BYTES) continue;
      fontAssets.push({ ...candidate, sha256: await sha256Hex(buffer) });
    } catch {
      // Missing hashes are handled by the main process. The helper remains passive.
    }
  }
  return {
    fontFamilies,
    fontUrls: [...new Set(candidates.map((asset) => asset.url))],
    fontHashes: [...new Set(fontAssets.map((asset) => asset.sha256))],
    ...(fontAssets.length ? { fontAssets } : {}),
  };
}
function readMetadata() {
  const scripts = Array.from(document.scripts, (script) => script.textContent ?? "").join("\n");
  const init = /Read\.init\s*\(\s*\{([\s\S]{0,3000}?)\}\s*\)/u.exec(scripts)?.[1] ?? "";
  const metadata = {
    bookId: /book_id\s*:\s*['"]([a-zA-Z0-9]{4,24})['"]/u.exec(init)?.[1],
    chapterId: /cid\s*:\s*['"]?(\d+)['"]?/u.exec(init)?.[1],
    sourceId: /sid\s*:\s*['"]?(\d+)['"]?/u.exec(init)?.[1],
  };
  return Object.values(metadata).some(Boolean) ? metadata : undefined;
}
async function transcodeContent(metadata) {
  if (!metadata?.bookId || !metadata.chapterId || !metadata.sourceId) return undefined;
  const endpoint = new URL("/chapter/transcode.html", location.href);
  endpoint.searchParams.set("book_id", metadata.bookId);
  endpoint.searchParams.set("cid", metadata.chapterId);
  endpoint.searchParams.set("sid", metadata.sourceId);
  const response = await fetch(endpoint.href, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) return undefined;
  const data = await response.json().catch(() => undefined);
  const content = typeof data?.content === "string" ? normalizeText(data.content) : "";
  return content || undefined;
}

async function collect(requestedUrl) {
  const requested = normalizeUrl(requestedUrl);
  const current = normalizeUrl(location.href);
  if (requested !== current) throw new Error("The paired TimoTXT page is no longer the requested page.");
  const metadata = readMetadata();
  const decoded = await transcodeContent(metadata).catch(() => undefined);
  const fontSnapshot = await collectFontAssets();
  const elements = {};
  for (const selector of ["h1", ".title", ".author", ".infotype", ".infotype a[href*='/author/']", ".all", ".chapter-content .content"]) {
    let values;
    if (selector === ".chapter-content .content" && decoded) values = [decoded];
    else {
      const extractor = selector === ".chapter-content .content" ? storyTextOf : textOf;
      values = Array.from(document.querySelectorAll(selector)).map(extractor).filter(Boolean).slice(0, 5_000);
    }
    if (values.length) elements[selector] = values;
  }
  let canonicalUrl;
  try { canonicalUrl = normalizeUrl(document.querySelector('link[rel="canonical"]')?.href); } catch { /* omit */ }
  const snapshot = {
    requestedUrl: requested, url: current, status: 200,
    title: String(document.title ?? "").normalize("NFC").slice(0, 1_000),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    charset: String(document.characterSet || "UTF-8").slice(0, 32),
    htmlLanguage: String(document.documentElement.lang || "").slice(0, 64),
    bodyText: textOf(document.body), elements, links: safeLinks(),
    ...fontSnapshot, ...(metadata ? { readerMetadata: metadata } : {}),
    challenge: challengeState(),
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) throw new RangeError("Page snapshot exceeds the safe 1.9 MB envelope.");
  return snapshot;
}

if (isSupportedCurrentPage()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "collect-snapshot") return false;
    void collect(message.requestedUrl).then(
      (snapshot) => sendResponse({ ok: true, snapshot }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "TimoTXT snapshot failed." }),
    );
    return true;
  });
  connectHeartbeat();
}
}
