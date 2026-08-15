import { MAX_SNAPSHOT_BYTES, normalizeHuliUrl } from "./protocol.js";

export const SNAPSHOT_SELECTORS = [
  "h1", "h2", ".title", "#pt_h1", ".readTitle", ".info", ".meta-dir",
  "#nr_title", "#nr", ".chaplist", ".chaplist .all", ".nr_page",
  "#bookIntro", "[rel=author]", ".author", "#chapterList", ".chapter-list",
  "#pagination", ".pagination",
];

const STORY_NOISE_SELECTOR = 'script,style,iframe,ins,figure,.adBlock,.gadBlock,.cf-unit,#comment,.bh-rec-embed,.recommend-wrap,[class^="ad-"],[class*=" ad-"]';
const STORY_BLOCK_SELECTOR = "p,div,li,blockquote,pre,section,article";
// Huli's real reader can split this footer over multiple paragraphs/lines,
// including its page-count/help text and a decorative emoticon. It remains a
// detection signal only; the adapter removes it only after all verified pages
// have been merged.  The terminal/data-url checks below prevent this display
// text from turning into a general navigation rule.
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

/**
 * Story text has a separate, deliberately narrow extractor.  Huli's reader
 * commonly uses <p>/<div> rather than <br>, so retaining those block
 * boundaries prevents otherwise adjacent paragraphs from becoming one long
 * line.  Titles and link labels keep the generic extractor below.
 */
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

function huliChapterLocation(document) {
  const match = /^\/(\d+)\/(\d+)(?:\/(\d+))?\.html$/u.exec(document.location.pathname);
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
    normalizedUrl = normalizeHuliUrl(new URL(rawUrl, baseUrl).href);
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

function scopesOf(element) {
  const scopes = new Set();
  let current = element;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    if (current.id) scopes.add(`#${current.id}`);
    for (const className of current.classList) scopes.add(`.${className}`);
  }
  return [...scopes];
}

function safeHuliUrl(rawUrl) {
  try {
    return normalizeHuliUrl(rawUrl);
  } catch {
    return undefined;
  }
}

function isRenderedChallengeControl(element) {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

function hasVisibleChallengeControl(document) {
  // The cf-turnstile-response input is only a hidden token field and is never
  // itself actionable. A managed challenge is interactive only when a real
  // widget/frame/control is visibly rendered for the user.
  return Array.from(document.querySelectorAll(
    'iframe[src*="challenges.cloudflare.com"],.cf-turnstile,.cf-turnstile button,.cf-turnstile input[type="checkbox"]',
  )).some(isRenderedChallengeControl);
}

/**
 * Huliwang's mobile directory swaps #chapterList through fixed buttons rather
 * than an href.  Expose only their enabled/disabled state, never a selector
 * or page script.  The main bridge may turn `hasNext` into its one narrowly
 * allow-listed `catalog-next` command.
 */
export function catalogPaginationFor(document) {
  if (!/^\/dir\/\d+(?:[-_/]\d+)?\.html$/u.test(document.location.pathname)) return undefined;
  const next = document.querySelector("#pagination #nextPage");
  const previous = document.querySelector("#pagination #prevPage");
  if (!next && !previous) return undefined;
  return {
    hasNext: enabledPagerControl(next),
    hasPrevious: enabledPagerControl(previous),
  };
}

/**
 * Resolve only Huli's real reader target.  The page can render repeated
 * `#pt_next` controls, but they must all point to the exact next numbered
 * page of this same chapter.  No selector, URL or script is exposed in the
 * bridge snapshot; the worker asks the content script for this target only
 * after it has already authenticated the current chapter snapshot.
 */
export function resolveChapterNextTarget(document) {
  const location = huliChapterLocation(document);
  const storyElement = document.querySelector("#nr");
  if (!location || !storyElement) return undefined;
  const story = storyTextOf(storyElement);
  if (!hasTerminalContinuationSentinel(story)) return undefined;
  const title = textOf(document.querySelector("#nr_title"));
  const currentPage = pageNumberFromText(title)
    ?? pageNumberFromText(story)
    ?? location.page;
  const controls = Array.from(document.querySelectorAll(".nr_page button#pt_next[data-url]"))
    .filter(enabledPagerControl);
  if (!controls.length) return undefined;
  const targets = controls.map((control) => chapterPageForUrl(
    control.getAttribute("data-url") ?? "",
    document.location.href,
  ));
  if (targets.some((target) => !target)) return undefined;
  const verified = targets.filter(Boolean);
  if (verified.some((target) => (
    target.bookId !== location.bookId
    || target.chapterKey !== location.chapterKey
    || target.page !== currentPage + 1
  ))) return undefined;
  const identities = new Set(verified.map((target) => `${target.bookId}\u0000${target.chapterKey}\u0000${target.page}`));
  return identities.size === 1 ? verified[0]?.normalizedUrl : undefined;
}

/**
 * A visible reader button is not enough: after the final part, it may lead to
 * the next chapter. `hasNext` is true only after the terminal incomplete-page
 * marker and a uniquely verified same-chapter `data-url` agree.
 */
export function chapterPaginationFor(document) {
  const location = huliChapterLocation(document);
  const storyElement = document.querySelector("#nr");
  if (!location || !storyElement) return undefined;
  const story = storyTextOf(storyElement);
  const title = textOf(document.querySelector("#nr_title"));
  const currentPage = pageNumberFromText(title)
    ?? pageNumberFromText(story)
    ?? location.page;
  const previous = Array.from(document.querySelectorAll(".nr_page button#pt_prev"))
    .some(enabledPagerControl);
  return {
    hasNext: Boolean(resolveChapterNextTarget(document)),
    hasPrevious: previous,
    currentPage,
  };
}

export function collectStorySnapshot(document, requestedUrl, status = 200) {
  const actualUrl = normalizeHuliUrl(document.location.href);
  const elements = {};
  for (const selector of SNAPSHOT_SELECTORS) {
    const values = Array.from(document.querySelectorAll(selector)).map(textOf).filter(Boolean).slice(0, 5_000);
    if (values.length) elements[selector] = values;
  }
  const links = Array.from(document.querySelectorAll("a[href]"), (anchor) => {
    const href = safeHuliUrl(anchor.href);
    return href ? { href, text: textOf(anchor).replace(/\s+/gu, " "), scopes: scopesOf(anchor) } : undefined;
  }).filter(Boolean).slice(0, 20_000);
  const canonicalUrl = safeHuliUrl(document.querySelector('link[rel="canonical"]')?.href);
  const bodyText = textOf(document.body);
  const interactive = hasVisibleChallengeControl(document);
  const passive = /Just a moment|Checking your browser|cf-chl-|Cloudflare Ray ID/iu.test(`${document.title}\n${bodyText}`);
  const catalogPagination = catalogPaginationFor(document);
  const chapterPagination = chapterPaginationFor(document);
  const snapshot = {
    requestedUrl: normalizeHuliUrl(requestedUrl),
    url: actualUrl,
    status,
    title: String(document.title ?? "").normalize("NFC").slice(0, 1_000),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    charset: String(document.characterSet || "UTF-8").slice(0, 32),
    htmlLanguage: String(document.documentElement.lang || "").slice(0, 64),
    bodyText,
    elements,
    links,
    fontFamilies: [],
    fontUrls: [],
    fontHashes: [],
    ...(catalogPagination ? { catalogPagination } : {}),
    ...(chapterPagination ? { chapterPagination } : {}),
    challenge: interactive ? "interactive" : passive ? "passive" : "none",
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("Page snapshot exceeds the 2 MiB bridge limit.");
  }
  return snapshot;
}
