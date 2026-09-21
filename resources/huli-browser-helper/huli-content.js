{
const SELECTORS = ["h1", "h2", ".title", "#pt_h1", ".readTitle", ".info", ".meta-dir", "#nr_title", "#nr", ".chaplist", ".chaplist .all", ".nr_page", "#bookIntro", "[rel=author]", ".author", "#chapterList", ".chapter-list", "#pagination", ".pagination"];
const HOSTS = new Set(["m.huliwang.net", "www.huliwang.net", "m.ihuliwang.net", "www.ihuliwang.net"]);
const HEARTBEAT_PORT_NAME = "huli-heartbeat";
// This remains shorter than the worker's SNAPSHOT_TIMEOUT_MS. It only waits
// for Huliwang's own list render; it never reloads, navigates, or interacts
// with any verification surface.
const CATALOG_SNAPSHOT_READY_TIMEOUT_MS = 8_000;
let heartbeatPort;
let heartbeatReconnects = 0;

function connectHeartbeat() {
  if (heartbeatPort || heartbeatReconnects >= 3) return;
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

function normalizeUrl(raw) {
  const url = new URL(raw);
  const labels = url.hostname.toLowerCase().split(".");
  const brand = labels[0] === "www" || labels[0] === "m" ? labels[1] : labels[0];
  const flexibleHost = brand === "huliwang" || brand === "ihuliwang";
  if (url.protocol !== "https:" || (!HOSTS.has(url.hostname.toLowerCase()) && !flexibleHost) || url.port || url.username || url.password || !/^\/(?:dir\/\d+(?:[-_/]\d+)?\.html|\d+\/?|\d+\/\d+(?:\/\d+)?\.html)\/?$/u.test(url.pathname)) throw new TypeError("Unsafe Huliwang URL.");
  url.search = ""; url.hash = ""; return url.href;
}

function isSupportedCurrentPage() {
  try { normalizeUrl(location.href); return true; } catch { return false; }
}

const STORY_NOISE_SELECTOR = 'script,style,iframe,ins,figure,.adBlock,.gadBlock,.cf-unit,#comment,.bh-rec-embed,.recommend-wrap,[class^="ad-"],[class*=" ad-"]';
const STORY_BLOCK_SELECTOR = "p,div,li,blockquote,pre,section,article";
// Huli's real reader can split this footer over multiple paragraphs/lines,
// including its page-count/help text and a decorative emoticon. It remains a
// detection signal only; final cleanup happens after merged verified pages.
const TERMINAL_CONTINUATION_SENTINEL = /(?:^|\n)\s*本章未完\s*[，,。.！!？?…~～]*\s*(?:(?:请\s*)?点击\s*下一页\s*(?:继续(?:\s*阅读)?)?|下一页\s*继续(?:\s*阅读)?)(?:\s*[，,。.！!？?…~～]*\s*(?:此页为本章\s*第\s*\d{1,4}\s*页\s*\/\s*共\s*\d{1,4}\s*页|如内容不全或无法翻页|或提示是最新章节|请退出\s*\[?\s*阅\s*#?\s*读\s*#?\s*模\s*#?\s*式\s*\]?))*[\s\p{Punctuation}\p{Symbol}\u200d\ufe0f]*$/u;

function normalizeStoryText(raw) {
  return raw.normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v ]+\n/gu, "\n")
    .replace(/\n[\t\f\v ]+/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Only #nr uses this story-specific extractor.  Keeping block boundaries
// makes paragraph-based Huli chapters readable without changing title/link
// semantics elsewhere in the bridge snapshot.
function storyTextOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll(STORY_NOISE_SELECTOR).forEach((node) => node.remove());
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  clone.querySelectorAll(STORY_BLOCK_SELECTOR).forEach((block) => {
    block.before("\n");
    block.after("\n");
  });
  return normalizeStoryText(clone.textContent ?? "");
}

function textOf(element) {
  if (!element) return "";
  if (element.matches("#nr")) return storyTextOf(element);
  const clone = element.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (clone.textContent ?? "").normalize("NFC").trim();
}

function enabledPagerControl(control) {
  return Boolean(control)
    && !control.hasAttribute("disabled")
    && control.getAttribute("aria-disabled") !== "true";
}

function huliChapterLocation() {
  const match = /^\/(\d+)\/(\d+)(?:\/(\d+))?\.html$/u.exec(location.pathname);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    bookId: match[1],
    chapterKey: match[2],
    page: match[3] ? Number.parseInt(match[3], 10) : 1,
  };
}

function chapterPageForUrl(rawUrl, baseUrl) {
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(new URL(rawUrl, baseUrl).href);
  } catch {
    return undefined;
  }
  const match = /^\/(\d+)\/(\d+)(?:\/(\d+))?\.html$/u.exec(new URL(normalizedUrl).pathname);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    bookId: match[1],
    chapterKey: match[2],
    page: match[3] ? Number.parseInt(match[3], 10) : 1,
    normalizedUrl,
  };
}

function pageNumberFromText(text) {
  const match = /第\s*(\d{1,4})\s*页/u.exec(text);
  if (!match?.[1]) return undefined;
  const page = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
}

function hasTerminalContinuationSentinel(text) {
  return TERMINAL_CONTINUATION_SENTINEL.test(text);
}

function sameHuliChapter(rawUrl) {
  const requested = chapterPageForUrl(rawUrl, location.href);
  const current = huliChapterLocation();
  return Boolean(
    requested
    && current
    && requested.bookId === current.bookId
    && requested.chapterKey === current.chapterKey
    && requested.page === current.page,
  );
}

function isRenderedChallengeControl(element) {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

function hasVisibleChallengeControl() {
  // Hidden Turnstile response fields are passive implementation details, not
  // controls a user can act on. Never click or interact with any candidate.
  return Array.from(document.querySelectorAll(
    'iframe[src*="challenges.cloudflare.com"],.cf-turnstile,.cf-turnstile button,.cf-turnstile input[type="checkbox"]',
  )).some(isRenderedChallengeControl);
}

function catalogBookId() {
  return /^\/dir\/(\d+)(?:[-_/]\d+)?\.html$/u.exec(location.pathname)?.[1];
}

function isCatalogPage() {
  return Boolean(catalogBookId());
}

function catalogPagination() {
  if (!isCatalogPage()) return undefined;
  const next = document.querySelector("#pagination #nextPage");
  const previous = document.querySelector("#pagination #prevPage");
  if (!next && !previous) return undefined;
  return { hasNext: enabledPagerControl(next), hasPrevious: enabledPagerControl(previous) };
}

function resolveChapterNextTarget() {
  const chapter = huliChapterLocation();
  const storyElement = document.querySelector("#nr");
  if (!chapter || !storyElement) return undefined;
  const story = storyTextOf(storyElement);
  if (!hasTerminalContinuationSentinel(story)) return undefined;
  const title = textOf(document.querySelector("#nr_title"));
  const currentPage = pageNumberFromText(title)
    ?? pageNumberFromText(story)
    ?? chapter.page;
  const controls = Array.from(document.querySelectorAll(".nr_page button#pt_next[data-url]"))
    .filter(enabledPagerControl);
  if (!controls.length) return undefined;
  const targets = controls.map((control) => chapterPageForUrl(
    control.getAttribute("data-url") ?? "",
    location.href,
  ));
  if (targets.some((target) => !target)) return undefined;
  const verified = targets.filter(Boolean);
  if (verified.some((target) => (
    target.bookId !== chapter.bookId
    || target.chapterKey !== chapter.chapterKey
    || target.page !== currentPage + 1
  ))) return undefined;
  const identities = new Set(verified.map((target) => `${target.bookId}\u0000${target.chapterKey}\u0000${target.page}`));
  return identities.size === 1 ? verified[0]?.normalizedUrl : undefined;
}

function chapterPagination() {
  const chapter = huliChapterLocation();
  const storyElement = document.querySelector("#nr");
  if (!chapter || !storyElement) return undefined;
  const story = storyTextOf(storyElement);
  const title = textOf(document.querySelector("#nr_title"));
  const currentPage = pageNumberFromText(title)
    ?? pageNumberFromText(story)
    ?? chapter.page;
  const previous = Array.from(document.querySelectorAll(".nr_page button#pt_prev"))
    .some(enabledPagerControl);
  return {
    // A next button can remain visible after the last part and lead to the
    // next chapter.  A terminal marker plus one verified data-url is needed.
    hasNext: Boolean(resolveChapterNextTarget()),
    hasPrevious: previous,
    currentPage,
  };
}

function safeCatalogChapterAnchors() {
  const bookId = catalogBookId();
  const list = document.querySelector("#chapterList");
  if (!bookId || !list) return [];
  return Array.from(list.querySelectorAll("a[href]"), (anchor) => {
    let href;
    try { href = normalizeUrl(anchor.href); } catch { return undefined; }
    const match = /^\/(\d+)\/(\d+)(?:\/\d+)?\.html$/u.exec(new URL(href).pathname);
    if (!match || match[1] !== bookId) return undefined;
    return { href, text: textOf(anchor) };
  }).filter(Boolean);
}

function catalogFingerprint() {
  return safeCatalogChapterAnchors().map(({ href, text }) => `${href}\u0000${text}`).join("\u0001");
}

function hasCatalogChapters() {
  return Boolean(catalogFingerprint());
}

function hasCatalogPagerControls() {
  return Boolean(
    document.querySelector("#pagination #nextPage")
    && document.querySelector("#pagination #prevPage"),
  );
}

function challengeState() {
  const bodyText = textOf(document.body);
  const interactive = hasVisibleChallengeControl();
  const passive = /Just a moment|Checking your browser|cf-chl-|Cloudflare Ray ID/iu.test(`${document.title}\n${bodyText}`);
  return interactive ? "interactive" : passive ? "passive" : "none";
}

function waitForCatalogReady(timeoutMs = CATALOG_SNAPSHOT_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      // Stop immediately if Cloudflare becomes visible. The tool will show
      // the snapshot to the user, but this helper never acts on the challenge.
      if (challengeState() !== "none") return finish();
      if (hasCatalogChapters() && hasCatalogPagerControls()) return finish();
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled"],
    });
    const interval = setInterval(inspect, 100);
    const timeout = setTimeout(() => {
      finish(new Error("Huliwang chưa tải xong danh sách chương hợp lệ trong thời gian chờ an toàn."));
    }, timeoutMs);
    inspect();
  });
}

async function collectCatalogSnapshotWhenReady(requestedUrl) {
  // Only a catalog page without a current Cloudflare signal is held briefly
  // for its own #chapterList XHR render. Chapter pages and challenge pages
  // remain immediate snapshots, preserving the existing manual-verification
  // flow.
  const initial = collect(requestedUrl);
  if (initial.challenge !== "none" || (hasCatalogChapters() && hasCatalogPagerControls())) return initial;
  await waitForCatalogReady();
  return collect(requestedUrl);
}

function waitForCatalogChange(before, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      if (catalogFingerprint() !== before && hasCatalogChapters()) finish();
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.querySelector("#chapterList") ?? document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const interval = setInterval(inspect, 100);
    const timeout = setTimeout(() => {
      const elapsed = Date.now() - startedAt;
      finish(new Error(`Huliwang did not change the catalog list after ${elapsed} ms.`));
    }, timeoutMs);
    inspect();
  });
}

async function advanceCatalogPage(requestedUrl) {
  // This is intentionally the only DOM action the companion supports.  It
  // never receives selector/script input and never touches Cloudflare UI.
  if (normalizeUrl(requestedUrl) !== normalizeUrl(location.href)) {
    throw new Error("The paired Huliwang catalog is no longer the requested page.");
  }
  const current = collect(requestedUrl);
  if (current.challenge !== "none") throw new Error("Huliwang verification has not finished.");
  if (!current.catalogPagination?.hasNext) throw new Error("The Huliwang catalog does not have an enabled next-page button.");
  const button = document.querySelector("#pagination #nextPage");
  if (!button || button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") {
    throw new Error("The Huliwang catalog next-page button is unavailable.");
  }
  const before = catalogFingerprint();
  if (!before || !hasCatalogChapters()) throw new Error("The Huliwang catalog list is unavailable.");
  const changed = waitForCatalogChange(before);
  button.click();
  await changed;
  return collect(requestedUrl);
}

function resolveChapterNextPage(requestedUrl) {
  // Reader pagination performs a full navigation. The content script only
  // resolves the page-owned data-url; the worker alone changes the tab URL.
  if (!sameHuliChapter(requestedUrl)) {
    throw new Error("The paired Huliwang tab is no longer the requested chapter.");
  }
  const current = collect(requestedUrl);
  if (current.challenge !== "none") throw new Error("Huliwang verification has not finished.");
  if (!current.chapterPagination?.hasNext) {
    throw new Error("The Huliwang chapter does not have a verified incomplete-page continuation.");
  }
  const nextUrl = resolveChapterNextTarget();
  if (!nextUrl) throw new Error("The Huliwang chapter next-page target is unavailable or unsafe.");
  return nextUrl;
}

function collect(requestedUrl) {
  const elements = {};
  for (const selector of SELECTORS) {
    const values = Array.from(document.querySelectorAll(selector)).map(textOf).filter(Boolean).slice(0, 5_000);
    if (values.length) elements[selector] = values;
  }
  const scopes = (element) => { const found = new Set(); let current = element; for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) { if (current.id) found.add(`#${current.id}`); for (const name of current.classList) found.add(`.${name}`); } return [...found]; };
  const links = Array.from(document.querySelectorAll("a[href]"), (anchor) => { try { return { href: normalizeUrl(anchor.href), text: textOf(anchor).replace(/\s+/gu, " "), scopes: scopes(anchor) }; } catch { return undefined; } }).filter(Boolean).slice(0, 20_000);
  let canonicalUrl; try { canonicalUrl = normalizeUrl(document.querySelector('link[rel="canonical"]')?.href); } catch { /* omit */ }
  const bodyText = textOf(document.body);
  const challenge = challengeState();
  const pager = catalogPagination();
  const chapterPager = chapterPagination();
  const snapshot = { requestedUrl: normalizeUrl(requestedUrl), url: normalizeUrl(location.href), status: 200, title: String(document.title ?? "").normalize("NFC").slice(0, 1_000), ...(canonicalUrl ? { canonicalUrl } : {}), charset: String(document.characterSet || "UTF-8").slice(0, 32), htmlLanguage: String(document.documentElement.lang || "").slice(0, 64), bodyText, elements, links, fontFamilies: [], fontUrls: [], fontHashes: [], ...(pager ? { catalogPagination: pager } : {}), ...(chapterPager ? { chapterPagination: chapterPager } : {}), challenge };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 1_900_000) throw new RangeError("Page snapshot exceeds the safe 1.9 MB envelope.");
  return snapshot;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "collect-snapshot") {
    if (isCatalogPage()) {
      void collectCatalogSnapshotWhenReady(message.requestedUrl).then(
        (snapshot) => sendResponse({ ok: true, snapshot }),
        (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Catalog snapshot failed." }),
      );
      return true;
    }
    try {
      sendResponse({ ok: true, snapshot: collect(message.requestedUrl) });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Snapshot failed." });
    }
    return false;
  }
  if (message?.type === "advance-catalog-page") {
    void advanceCatalogPage(message.requestedUrl).then(
      (snapshot) => sendResponse({ ok: true, snapshot }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Catalog page advance failed." }),
    );
    return true;
  }
  if (message?.type === "resolve-chapter-next") {
    try {
      sendResponse({ ok: true, nextUrl: resolveChapterNextPage(message.requestedUrl) });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Chapter next-page target failed." });
    }
    return false;
  }
  return false;
});

// The paired tab is replaced during navigation, so every Huli document opens
// its own Port from this content script immediately after it loads.
if (isSupportedCurrentPage()) connectHeartbeat();
}
