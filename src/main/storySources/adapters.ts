import type {
  StoryChapterContent,
  StoryChapterReference,
  StorySite,
  StorySourceAnalysis,
} from "../../shared/types.js";
import {
  assertSnapshotUrl,
  parseStoryUrl,
  sameCanonicalUrl,
  type ParsedStoryUrl,
} from "./urlRules.js";
import {
  assertPlausibleStoryText,
  cleanIxdzsStoryText,
  cleanXbanxiaChapterTitle,
  cleanXbanxiaStoryText,
  assertCleanXbanxiaStoryText,
  mergeTextParts,
  normalizeText,
  parseChapterLabel,
  removeRepeatedHeading,
} from "./text.js";
import {
  containsTimotxtEncodedCodepoints,
  TIMOTXT_BQG_FONT_HASH,
} from "./timotxtDecoder.js";
import {
  StorySourceError,
  type StoryPageClient,
  type StoryPageLink,
  type StoryPageSnapshot,
  type StoryTextDecoder,
} from "./types.js";

export interface AdapterRuntime {
  client: StoryPageClient;
  signal: AbortSignal;
  visit(url: string): Promise<StoryPageSnapshot>;
  /**
   * Advances Huliwang's own in-place catalog pager.  This is intentionally
   * optional: only the paired, user-controlled browser companion can expose
   * this operation.  Adapters must never fall back to inventing a URL or
   * clicking arbitrary page controls.
   */
  advanceCatalogPage?: (currentUrl: string) => Promise<StoryPageSnapshot>;
  /** Reports a bounded catalog traversal step without exposing browser state. */
  reportCatalogProgress(completed: number, message: string): void;
  transcode?: NonNullable<StoryPageClient["transcode"]>;
  maxCatalogPages: number;
  maxChapterPages: number;
  decoders: readonly StoryTextDecoder[];
}

export interface AdapterAnalysisData {
  bookTitle: string;
  author?: string;
  chapters: StoryChapterReference[];
  notices: string[];
}

export interface Adapter {
  analyze(input: ParsedStoryUrl, runtime: AdapterRuntime): Promise<AdapterAnalysisData>;
  fetch(
    analysis: StorySourceAnalysis,
    chapter: StoryChapterReference,
    runtime: AdapterRuntime,
  ): Promise<StoryChapterContent>;
}

function values(snapshot: StoryPageSnapshot, ...selectors: string[]): string[] {
  return selectors.flatMap((selector) => snapshot.elements[selector] ?? []);
}

function firstValue(snapshot: StoryPageSnapshot, ...selectors: string[]): string | undefined {
  return values(snapshot, ...selectors).map(normalizeText).find(Boolean);
}

function linkInScope(link: StoryPageLink, scopes: string[]): boolean {
  return scopes.length === 0 || scopes.some((scope) => link.scopes.includes(scope));
}

function canonicalChapterUrl(parsed: ParsedStoryUrl): string {
  if (!parsed.chapterKey) throw new StorySourceError("SOURCE_CHANGED", "Liên kết chương không có ID.");
  if (parsed.site === "huliwang") return `https://m.huliwang.net/${parsed.bookId}/${parsed.chapterKey}.html`;
  if (parsed.site === "timotxt") return `https://www.timotxt.com/${parsed.bookId}/${parsed.chapterKey}.html`;
  if (parsed.site === "qingrenyouxi") return `https://www.qingrenyouxi.com/book/${parsed.bookId}/${parsed.chapterKey}.html`;
  if (parsed.site === "xbanxia") return `https://www.xbanxia.cc/books/${parsed.bookId}/${parsed.chapterKey}.html`;
  return parsed.normalizedUrl;
}

function catalogReferences(
  snapshot: StoryPageSnapshot,
  parsedInput: ParsedStoryUrl,
  scopes: string[],
): StoryChapterReference[] {
  const candidates: Array<{ parsed: ParsedStoryUrl; label: string; url: string }> = [];
  for (const link of snapshot.links) {
    if (!linkInScope(link, scopes) || !link.text.trim()) continue;
    let parsed: ParsedStoryUrl;
    try {
      parsed = parseStoryUrl(link.href);
    } catch {
      continue;
    }
    if (parsed.site !== parsedInput.site || parsed.bookId !== parsedInput.bookId || parsed.kind !== "chapter") continue;
    candidates.push({ parsed, label: link.text, url: canonicalChapterUrl(parsed) });
  }

  const seen = new Set<string>();
  const raw = candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  }).map((candidate, index): StoryChapterReference => {
    const label = parseChapterLabel(candidate.label);
    return {
      id: `${parsedInput.site}:${parsedInput.bookId}:${candidate.parsed.chapterKey}`,
      order: index,
      ...(label.number === undefined ? {} : { number: label.number }),
      numberLabel: label.numberLabel,
      title: label.title,
      url: candidate.url,
      partUrls: [candidate.url],
      isIntroduction: label.isIntroduction,
      selectedByDefault: !label.isIntroduction,
    };
  });
  if (parsedInput.site === "huliwang" || parsedInput.site === "timotxt" || parsedInput.site === "xszj") {
    raw.sort((left, right) => {
      const leftKey = parseStoryUrl(left.url).chapterKey ?? "";
      const rightKey = parseStoryUrl(right.url).chapterKey ?? "";
      const numeric = (key: string): [number, number] => {
        const [base = "0", part = "0"] = key.split("_");
        return [Number.parseInt(base, 10), Number.parseInt(part, 10)];
      };
      const [leftBase, leftPart] = numeric(leftKey);
      const [rightBase, rightPart] = numeric(rightKey);
      return leftBase - rightBase || leftPart - rightPart;
    });
    raw.forEach((chapter, order) => { chapter.order = order; });
  }
  return mergeContinuationEntries(raw);
}

export function mergeContinuationEntries(entries: StoryChapterReference[]): StoryChapterReference[] {
  const merged: StoryChapterReference[] = [];
  let previousEntry: StoryChapterReference | undefined;
  for (const entry of entries) {
    const prior = merged.at(-1);
    const continuation = prior !== undefined
      && previousEntry !== undefined
      && isVerifiedContinuation(previousEntry, entry);
    if (continuation && prior) {
      prior.partUrls.push(...entry.partUrls.filter((url) => !prior.partUrls.includes(url)));
      previousEntry = entry;
      continue;
    }
    merged.push({ ...entry, order: merged.length, partUrls: [...entry.partUrls] });
    previousEntry = entry;
  }
  return merged;
}

interface TitlePartMarker {
  stem: string;
  ordinal: number;
}

const CONTINUATION_ONLY = /^(?:续|續|续篇|續篇|续章|續章|继续|繼續|接上(?:章|文)?|承上(?:章|文)?|后续|後續|下(?:篇|部|集|半|半章)?|tiếp|phần\s+tiếp|continued?|continuation|cont\.?)$/iu;

function normalizedEntryTitle(entry: StoryChapterReference): string {
  let title = entry.title.normalize("NFKC").trim();
  const nested = parseChapterLabel(title);
  if (nested.number !== undefined && nested.number === entry.number && nested.title !== title) {
    title = nested.title;
  }
  const compactTitle = title.replace(/\s+/gu, "").toLocaleLowerCase();
  const compactNumberLabel = entry.numberLabel.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
  return compactTitle === compactNumberLabel ? "" : title.trim();
}

function markerOrdinal(marker: string): number | undefined {
  const normalized = marker.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
  if (/^(?:上|上篇|上部|上集|上半|上半章|一|1)$/u.test(normalized)) return 1;
  if (/^(?:中|中篇|中部|中集|二|2|续|續|续篇|續篇|续章|續章|继续|繼續|接上(?:章|文)?|承上(?:章|文)?|后续|後續|tiếp|phầntiếp|continued?|continuation|cont\.?)$/iu.test(normalized)) return 2;
  if (/^(?:下|下篇|下部|下集|下半|下半章|三|3)$/u.test(normalized)) return 3;
  const numeric = /^(\d{1,3})$/u.exec(normalized)?.[1];
  return numeric ? Number.parseInt(numeric, 10) : undefined;
}

function titlePartMarker(rawTitle: string): TitlePartMarker | undefined {
  const title = rawTitle.normalize("NFKC").trim();
  if (!title) return undefined;
  const markerPattern = "上|中|下|上篇|中篇|下篇|上部|中部|下部|上集|中集|下集|上半|下半|一|二|三|\\d{1,3}|续|續|续篇|續篇|续章|續章|继续|繼續|后续|後續|tiếp|phần\\s+tiếp|continued?|continuation|cont\\.?";
  const wrapped = new RegExp(`^(.*?)[(\\[【]\\s*(${markerPattern})(?:\\s*\\/\\s*\\d{1,3})?\\s*[)\\]】]$`, "iu").exec(title);
  const separated = new RegExp(`^(.*?)\\s+(?:[-—_:：·]\\s*)?(${markerPattern})$`, "iu").exec(title);
  const compound = /^(.*?)(上篇|中篇|下篇|上部|中部|下部|上集|中集|下集|上半|下半|续篇|續篇|续章|續章|后续|後續)$/iu.exec(title);
  const match = wrapped ?? separated ?? compound;
  if (!match) {
    const ordinal = markerOrdinal(title);
    return ordinal === undefined ? undefined : { stem: "", ordinal };
  }
  const marker = match?.[2];
  const ordinal = marker ? markerOrdinal(marker) : undefined;
  if (ordinal === undefined) return undefined;
  return { stem: (match?.[1] ?? "").replace(/[\s\-—_:：·]+$/gu, "").trim(), ordinal };
}

function isTimoUrlPartSequence(previousKey: string | undefined, currentKey: string | undefined): boolean {
  const previous = /^(\d+)(?:_(\d+))?$/u.exec(previousKey ?? "");
  const current = /^(\d+)_(\d+)$/u.exec(currentKey ?? "");
  if (!previous?.[1] || !current?.[1] || previous[1] !== current[1]) return false;
  const previousPart = previous[2] ? Number.parseInt(previous[2], 10) : 1;
  return Number.parseInt(current[2] ?? "0", 10) === previousPart + 1;
}

function isVerifiedContinuation(
  previous: StoryChapterReference,
  current: StoryChapterReference,
): boolean {
  if (current.number === undefined || previous.number === undefined || current.number !== previous.number) return false;
  let previousUrl: ParsedStoryUrl;
  let currentUrl: ParsedStoryUrl;
  try {
    previousUrl = parseStoryUrl(previous.url);
    currentUrl = parseStoryUrl(current.url);
  } catch {
    return false;
  }
  if (
    previousUrl.kind !== "chapter"
    || currentUrl.kind !== "chapter"
    || previousUrl.site !== currentUrl.site
    || previousUrl.bookId !== currentUrl.bookId
    || previousUrl.normalizedUrl === currentUrl.normalizedUrl
  ) return false;

  if (
    currentUrl.site === "timotxt"
    && isTimoUrlPartSequence(previousUrl.chapterKey, currentUrl.chapterKey)
  ) return true;

  const previousKey = Number.parseInt(previousUrl.chapterKey?.split("_")[0] ?? "", 10);
  const currentKey = Number.parseInt(currentUrl.chapterKey?.split("_")[0] ?? "", 10);
  if (!Number.isSafeInteger(previousKey) || !Number.isSafeInteger(currentKey) || currentKey <= previousKey) {
    return false;
  }

  const currentTitle = normalizedEntryTitle(current);
  if (CONTINUATION_ONLY.test(currentTitle)) return true;

  const previousTitle = normalizedEntryTitle(previous);
  const previousPart = titlePartMarker(previousTitle);
  const currentPart = titlePartMarker(currentTitle);
  if (!currentPart) return false;
  if (!currentPart.stem) return currentPart.ordinal >= 2;
  const comparable = (value: string): string => value.replace(/\s+/gu, "").toLocaleLowerCase();
  if (previousPart) {
    return comparable(previousPart.stem) === comparable(currentPart.stem)
      && currentPart.ordinal > previousPart.ordinal;
  }
  return Boolean(currentPart.stem)
    && comparable(previousTitle) === comparable(currentPart.stem)
    && currentPart.ordinal >= 2;
}

function assertPageReady(snapshot: StoryPageSnapshot, parsed: ParsedStoryUrl): void {
  const actual = assertSnapshotUrl(snapshot.url, parsed.site, parsed.bookId);
  if (
    actual.kind !== parsed.kind
    || (parsed.site === "huliwang" && !sameHuliwangPageIdentity(actual, parsed))
    || (parsed.site !== "huliwang" && parsed.kind === "chapter" && (
      actual.chapterKey !== parsed.chapterKey
    )) || (parsed.site === "xszj" && parsed.kind === "chapter" && actual.page !== parsed.page)
  ) {
    throw new StorySourceError("SOURCE_CHANGED", "Nguồn đã chuyển sang trang/chương khác trong cùng sách.");
  }
  if (snapshot.status !== undefined && snapshot.status >= 400) {
    throw new StorySourceError("SOURCE_BLOCKED", `Nguồn truyện trả HTTP ${snapshot.status}.`);
  }
  if (snapshot.challenge !== "none") {
    throw new StorySourceError(
      "USER_ACTION_REQUIRED",
      snapshot.challenge === "interactive"
        ? "Cloudflare yêu cầu xác minh: hãy bấm checkbox trong cửa sổ trình duyệt, sau đó bấm “Phân tích lại”; tool không tự bấm Turnstile."
        : "Cloudflare chưa hoàn tất xác minh thụ động.",
    );
  }
}

/**
 * Huliwang serves equivalent catalog pages under a few URL spellings
 * (`-2`, `_2`, `/2`, and explicit page one).  The normal-browser helper may
 * preserve the spelling selected by the site, so compare their parsed page
 * identity instead of rejecting a safe same-book alias as a redirect.
 */
function sameHuliwangPageIdentity(actual: ParsedStoryUrl, expected: ParsedStoryUrl): boolean {
  if (
    actual.site !== "huliwang"
    || expected.site !== "huliwang"
    || actual.kind !== expected.kind
    || actual.bookId !== expected.bookId
  ) return false;
  if (actual.kind === "catalog") {
    return huliCatalogPageNumber(actual) === huliCatalogPageNumber(expected);
  }
  return actual.normalizedUrl === expected.normalizedUrl;
}

function validateCanonical(snapshot: StoryPageSnapshot, expected: string): void {
  if (!snapshot.canonicalUrl || !sameCanonicalUrl(snapshot.canonicalUrl, expected)) {
    throw new StorySourceError("SOURCE_CHANGED", "Canonical URL không khớp trang được yêu cầu.");
  }
}

function qingSoft200(snapshot: StoryPageSnapshot): boolean {
  return /I'm very sorry|非常抱歉|找不到您请求的页面|页面不存在|自动找回最新网址/iu.test(
    `${snapshot.title}\n${snapshot.bodyText}`,
  );
}

function extractAuthor(snapshot: StoryPageSnapshot): string | undefined {
  const direct = firstValue(snapshot, "[rel=author]", ".author", ".book-describe a[href^='/author/']");
  if (direct) return direct.replace(/^\s*(?:作者|Tác giả)\s*[/:：]?\s*/iu, "").slice(0, 160);
  const combined = values(snapshot, ".info", ".booktag", "h2").join("\n");
  const match = /(?:作者\s*[/:：]?|\u4f5c者\s*\/\s*)([^\n分類类别更新]{1,80})/iu.exec(combined);
  return match?.[1]?.trim();
}

async function collectCatalog(
  firstUrl: string,
  parsed: ParsedStoryUrl,
  runtime: AdapterRuntime,
  options: {
    scopes: string[];
    nextLabels?: RegExp;
    nextPath?: (candidate: ParsedStoryUrl) => boolean;
    validate?: (snapshot: StoryPageSnapshot, requestedUrl: string) => void;
  },
): Promise<{ snapshots: StoryPageSnapshot[]; chapters: StoryChapterReference[] }> {
  const queue = [firstUrl];
  const visited = new Set<string>();
  const snapshots: StoryPageSnapshot[] = [];
  const chapters: StoryChapterReference[] = [];
  while (queue.length) {
    if (visited.size >= runtime.maxCatalogPages) {
      throw new StorySourceError("SOURCE_CHANGED", "Mục lục vượt giới hạn trang an toàn.");
    }
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const snapshot = await runtime.visit(url);
    assertPageReady(snapshot, parseStoryUrl(url));
    options.validate?.(snapshot, url);
    snapshots.push(snapshot);
    chapters.push(...catalogReferences(snapshot, parsed, options.scopes));
    if (!options.nextLabels) continue;
    for (const link of snapshot.links) {
      if (!options.nextLabels.test(link.text)) continue;
      let candidate: ParsedStoryUrl;
      try {
        candidate = parseStoryUrl(link.href);
      } catch {
        continue;
      }
      if (
        candidate.site === parsed.site && candidate.bookId === parsed.bookId &&
        (!options.nextPath || options.nextPath(candidate)) && !visited.has(candidate.normalizedUrl)
      ) queue.push(candidate.normalizedUrl);
    }
  }
  const unique = new Map<string, StoryChapterReference>();
  for (const chapter of chapters) if (!unique.has(chapter.url)) unique.set(chapter.url, chapter);
  return {
    snapshots,
    chapters: mergeContinuationEntries([...unique.values()].map((chapter, order) => ({ ...chapter, order }))),
  };
}

interface HuliCatalogPageLink {
  page: number;
  url: string;
  text: string;
}

interface HuliCatalogPlan {
  url: string;
  /** Logical page is used only after the in-place JavaScript pager advances. */
  logicalPage?: number;
  snapshot?: StoryPageSnapshot;
}

const HULI_CATALOG_SCOPES = [
  ".chaplist",
  "#list-chapterAll",
  ".panel-chapterlist",
  ".chapter-list",
];
const HULI_CATALOG_PAGE_SIZE = 50;

function huliCatalogPageNumber(parsed: ParsedStoryUrl): number {
  if (parsed.site !== "huliwang" || parsed.kind !== "catalog") {
    throw new StorySourceError("SOURCE_CHANGED", "Liên kết mục lục Huliwang không hợp lệ.");
  }
  const pathname = new URL(parsed.normalizedUrl).pathname;
  const match = /^\/dir\/\d+(?:[-_/](\d+))?\.html\/?$/u.exec(pathname);
  const page = match?.[1] ? Number.parseInt(match[1], 10) : 1;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new StorySourceError("SOURCE_CHANGED", "Số trang mục lục Huliwang không hợp lệ.");
  }
  return page;
}

function huliCatalogPagerLinks(snapshot: StoryPageSnapshot, input: ParsedStoryUrl): HuliCatalogPageLink[] {
  const links: HuliCatalogPageLink[] = [];
  const seen = new Set<string>();
  for (const link of snapshot.links) {
    let candidate: ParsedStoryUrl;
    try {
      candidate = parseStoryUrl(link.href);
    } catch {
      continue;
    }
    if (candidate.site !== "huliwang" || candidate.kind !== "catalog" || candidate.bookId !== input.bookId) continue;
    const page = huliCatalogPageNumber(candidate);
    // Do not use normalizeText here: pager controls such as "下一页" are
    // intentionally treated as page chrome by the story-text cleaner and
    // would become empty.  We need the raw label solely to detect a backward
    // "next" link and fail closed rather than return a partial catalog.
    const text = link.text.normalize("NFC").replace(/\s+/gu, " ").trim();
    const key = `${page}\u0000${candidate.normalizedUrl}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ page, url: candidate.normalizedUrl, text });
  }
  return links.sort((left, right) => left.page - right.page || left.url.localeCompare(right.url));
}

function isHuliNextPageControl(text: string): boolean {
  const label = text.normalize("NFKC").replace(/[\s\u00a0]+/gu, "").toLocaleLowerCase();
  return /(?:下一[页頁]|下[页頁]|next(?:page)?|›|»|〉|＞)/iu.test(label);
}

function compareHuliChapterReferences(left: StoryChapterReference, right: StoryChapterReference): number {
  const key = (chapter: StoryChapterReference): [number, number] => {
    const parsed = parseStoryUrl(chapter.url);
    const [base = "0", part = "0"] = (parsed.chapterKey ?? "").split("_");
    return [Number.parseInt(base, 10), Number.parseInt(part, 10)];
  };
  const [leftBase, leftPart] = key(left);
  const [rightBase, rightPart] = key(right);
  return leftBase - rightBase || leftPart - rightPart;
}

function huliCatalogReferences(snapshot: StoryPageSnapshot, input: ParsedStoryUrl): StoryChapterReference[] {
  // Prefer links collected from the catalog container.  Old mobile templates
  // sometimes omit these classes, so retain a bounded compatibility fallback
  // only when the expected container produced no chapter link at all.
  const scoped = catalogReferences(snapshot, input, HULI_CATALOG_SCOPES);
  return scoped.length ? scoped : catalogReferences(snapshot, input, []);
}

/**
 * Huliwang shows a finite slice of the catalog per page.  Its pager text is
 * not stable (it can be an icon, a number, simplified/traditional text, or a
 * final-page shortcut), so traversal is derived from the strictly parsed
 * catalog URL instead.  We only follow N -> N+1.  A loop or a missing page is
 * rejected instead of silently returning a partial book.
 */
async function collectHuliwangCatalog(
  firstUrl: string,
  input: ParsedStoryUrl,
  runtime: AdapterRuntime,
): Promise<{ snapshots: StoryPageSnapshot[]; chapters: StoryChapterReference[] }> {
  // Most Huliwang catalogs have addressable page links, but the mobile catalog
  // currently swaps each 50-entry slice in-place through #nextPage.  Carry a
  // logical page number separately so a safe in-place advance can retain the
  // same URL without looking like a navigation loop.
  let next: HuliCatalogPlan | undefined = {
    url: firstUrl,
  };
  const visitedStates = new Set<string>();
  const visitedPages = new Set<number>();
  const seenChapterUrls = new Set<string>();
  const snapshots: StoryPageSnapshot[] = [];
  const chapters: StoryChapterReference[] = [];

  while (next) {
    if (snapshots.length >= runtime.maxCatalogPages) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        `Mục lục Huliwang vượt giới hạn ${runtime.maxCatalogPages} trang an toàn; tool không trả danh sách thiếu.`,
      );
    }

    const planned: HuliCatalogPlan = next;
    next = undefined;
    const requested = parseStoryUrl(planned.url);
    const currentPage: number = planned.logicalPage ?? huliCatalogPageNumber(requested);
    const visitState = `${requested.normalizedUrl}\u0000${currentPage}`;
    if (visitedStates.has(visitState) || visitedPages.has(currentPage)) {
      throw new StorySourceError("SOURCE_CHANGED", "Huliwang tạo vòng lặp phân trang mục lục.");
    }
    visitedStates.add(visitState);
    visitedPages.add(currentPage);
    runtime.reportCatalogProgress(
      currentPage,
      `Đang đọc trang mục lục Huliwang ${currentPage}…`,
    );

    const snapshot = planned.snapshot ?? await runtime.visit(requested.normalizedUrl);
    assertPageReady(snapshot, requested);
    snapshots.push(snapshot);
    const pageChapters = huliCatalogReferences(snapshot, input);
    const pageChapterUrls = pageChapters.flatMap((chapter) => chapter.partUrls);
    const addedNewChapter = pageChapterUrls.some((url) => !seenChapterUrls.has(url));
    for (const url of pageChapterUrls) seenChapterUrls.add(url);
    if (currentPage > 1 && !addedNewChapter) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        `Trang mục lục Huliwang ${currentPage} không có chương mới; tool đã dừng để không trả danh sách thiếu hoặc lặp.`,
      );
    }
    chapters.push(...pageChapters);

    const pager = huliCatalogPagerLinks(snapshot, input);
    const backwardsNext = pager.find((candidate) => (
      candidate.page <= currentPage && isHuliNextPageControl(candidate.text)
    ));
    if (backwardsNext) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        `Huliwang liên kết “trang sau” quay lại trang ${backwardsNext.page}; tool đã dừng để không bỏ sót chương.`,
      );
    }

    const sequentialNext: HuliCatalogPageLink | undefined = pager.find(
      (candidate) => candidate.page === currentPage + 1,
    );
    if (sequentialNext) {
      next = { url: sequentialNext.url };
      continue;
    }

    const skippedPage = pager.find((candidate) => candidate.page > currentPage + 1);
    if (skippedPage) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        `Mục lục Huliwang thiếu liên kết từ trang ${currentPage} sang trang ${currentPage + 1} (chỉ thấy trang ${skippedPage.page}); tool không trả danh sách thiếu.`,
      );
    }

    // The real mobile Huliwang catalog uses a JavaScript-only #nextPage
    // button.  Its URL deliberately stays /dir/<book>.html, so there is no
    // anchor for the collector to follow.  The companion reports only the
    // bounded boolean state and offers a dedicated operation that clicks that
    // exact button in the already paired ordinary-browser tab.  No selector,
    // arbitrary JavaScript, URL guessing, or Cloudflare interaction crosses
    // this boundary.
    if (snapshot.catalogPagination?.hasNext) {
      if (!runtime.advanceCatalogPage) {
        throw new StorySourceError(
          "SOURCE_CHANGED",
          "Mục lục Huliwang có nút sang trang JavaScript nhưng tiện ích trình duyệt chưa hỗ trợ; hãy cập nhật tiện ích rồi Phân tích lại.",
        );
      }
      const advanced = await runtime.advanceCatalogPage(requested.normalizedUrl);
      next = {
        url: requested.normalizedUrl,
        logicalPage: currentPage + 1,
        snapshot: advanced,
      };
      continue;
    }

    // A normal Huliwang page contains 50 entries (occasionally plus a
    // boundary duplicate).  Treat that small page-shaped result without a
    // next link as incomplete.  Do not reject older/static catalogs that
    // genuinely render a much larger complete list on one page.
    if (
      snapshot.catalogPagination === undefined
      && pageChapterUrls.length >= HULI_CATALOG_PAGE_SIZE
      && pageChapterUrls.length <= HULI_CATALOG_PAGE_SIZE + 2
    ) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        `Trang mục lục Huliwang ${currentPage} có ít nhất ${HULI_CATALOG_PAGE_SIZE} chương nhưng không có liên kết sang trang kế tiếp hợp lệ; tool đã dừng để không bỏ sót chương.`,
      );
    }
  }

  const unique = new Map<string, StoryChapterReference>();
  for (const chapter of chapters) if (!unique.has(chapter.url)) unique.set(chapter.url, chapter);
  const ordered = [...unique.values()].sort(compareHuliChapterReferences)
    .map((chapter, order) => ({ ...chapter, order }));
  return {
    snapshots,
    chapters: mergeContinuationEntries(ordered),
  };
}

function chooseBookTitle(snapshot: StoryPageSnapshot, site: StorySite): string {
  let title = site === "huliwang"
    ? firstValue(snapshot, "h1", "#pt_h1", ".title")
    : site === "timotxt"
      ? firstValue(snapshot, "h1", ".title")
      : site === "qingrenyouxi"
        ? firstValue(snapshot, ".bookTitle", "h1")
        : site === "xszj"
          ? firstValue(snapshot, "h1", ".title")
        : firstValue(snapshot, ".book-describe h1");
  title = title?.replace(/\s*(?:章节列表|章節列表|目录|目錄)\s*$/iu, "").trim();
  if (!title || title.length > 300) throw new StorySourceError("SOURCE_CHANGED", "Không đọc được tên sách từ DOM đã xác minh.");
  return title;
}

/**
 * Huliwang puts an incomplete-page notice inside #nr on every non-final
 * page.  It is deliberately not removed by the general text cleaner: until
 * a same-chapter successor has been verified, removing it would turn a
 * truncated chapter into an apparently complete one.
 */
const HULI_UNFINISHED_PAGE_TAIL = /\s*\u672c\u7ae0\u672a\u5b8c(?:[\uFF0C,\.\u3002!\uFF01\u2026~\uFF5E]*)\s*$/u;
const HULI_NEXT_PAGE_TAIL = /\s*(?:(?:\u70b9\u51fb|\u9ede\u64ca)\s*)?(?:\u4e0b\u4e00|\u4e0b)\s*[\u9875\u9801](?:\s*(?:\u7ee7\u7eed|\u7e7c\u7e8c)?(?:\u9605\u8bfb|\u95b1\u8b80)?)?[\s~\uFF5E\u2026]*$/u;
const HULI_PAGE_COUNTER_TAIL = /\s*(?:\u6b64\u9875\u4e3a\u672c\u7ae0|\u6b64\u9801\u70ba\u672c\u7ae0)\s*\u7b2c\s*\d+\s*[\u9875\u9801]\s*\/\s*\u5171\s*\d+\s*[\u9875\u9801][\s~\uFF5E\u2026]*$/u;
const HULI_TITLE_PAGE = /\u7b2c\s*(\d+)\s*[\u9875\u9801]/u;
const HULI_TEXT_PAGE_COUNTER = /\u7b2c\s*(\d+)\s*[\u9875\u9801]\s*\/\s*\u5171\s*(\d+)\s*[\u9875\u9801]/u;

interface HuliChapterPagePlan {
  url: string;
  expectedPage: number;
  snapshot?: StoryPageSnapshot;
}

interface HuliChapterPaginationState {
  hasNext: boolean;
  hasPrevious: boolean;
  currentPage: number;
}

type HuliChapterRuntime = AdapterRuntime & {
  advanceChapterPage?: (currentUrl: string) => Promise<StoryPageSnapshot>;
};

function firstRawValue(snapshot: StoryPageSnapshot, ...selectors: string[]): string | undefined {
  return values(snapshot, ...selectors).find((value) => Boolean(normalizeText(value)));
}

function huliChapterPagination(snapshot: StoryPageSnapshot): HuliChapterPaginationState | undefined {
  // The ordinary-browser companion supplies this small, fixed state for a
  // JavaScript-only chapter pager.  Keep the adapter compatible with older
  // companions while the bridge is upgraded: absence is treated as no safe
  // in-place continuation, never as permission to guess or click a selector.
  const candidate = (snapshot as StoryPageSnapshot & {
    chapterPagination?: Partial<HuliChapterPaginationState>;
  }).chapterPagination;
  return candidate
    && typeof candidate.hasNext === "boolean"
    && typeof candidate.hasPrevious === "boolean"
    && Number.isSafeInteger(candidate.currentPage)
    && candidate.currentPage >= 1
    ? {
      hasNext: candidate.hasNext,
      hasPrevious: candidate.hasPrevious,
      currentPage: candidate.currentPage,
    }
    : undefined;
}

function huliHasUnfinishedPageTail(text: string): boolean {
  return HULI_UNFINISHED_PAGE_TAIL.test(text);
}

function cleanHuliContinuationPageText(raw: string): string {
  // Call this only after a same-chapter successor has been validated.  The
  // order matters when a template renders all of these fragments inline.
  return normalizeText(raw)
    .replace(HULI_NEXT_PAGE_TAIL, "")
    .replace(HULI_PAGE_COUNTER_TAIL, "")
    .replace(HULI_UNFINISHED_PAGE_TAIL, "")
    .trim();
}

/**
 * Finds a page N+1 link by its parsed, allow-listed Huliwang URL rather than
 * its visible label.  Real templates label it variably (for example, the
 * entire \"click next page to continue\" sentence).  A visible exact
 * \"next page\" link still retains the previous fail-closed behavior if it
 * points outside the expected chapter.
 */
function huliSameChapterNextPageUrl(
  snapshot: StoryPageSnapshot,
  current: ParsedStoryUrl,
  currentPage = current.page ?? 1,
): string | undefined {
  const candidates = new Set<string>();
  let invalidExplicitNextLink = false;
  for (const link of snapshot.links) {
    const isExplicitNext = /^\s*\u4e0b\u4e00[\u9875\u9801]\s*$/u.test(link.text);
    let candidate: ParsedStoryUrl;
    try {
      candidate = parseStoryUrl(link.href);
    } catch {
      if (isExplicitNext) invalidExplicitNextLink = true;
      continue;
    }
    if (
      candidate.site === "huliwang"
      && candidate.kind === "chapter"
      && candidate.bookId === current.bookId
      && candidate.chapterKey === current.chapterKey
      && candidate.page === currentPage + 1
    ) {
      candidates.add(candidate.normalizedUrl);
      continue;
    }
    if (isExplicitNext) invalidExplicitNextLink = true;
  }
  if (candidates.size > 1) {
    throw new StorySourceError("SOURCE_CHANGED", "Huliwang trả nhiều liên kết khác nhau cho trang kế tiếp của cùng chương.");
  }
  const next = candidates.values().next().value as string | undefined;
  if (next) return next;
  if (invalidExplicitNextLink) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Liên kết ‘下一页’ Huliwang không an toàn.");
  }
  return undefined;
}

function assertHuliChapterPage(
  snapshot: StoryPageSnapshot,
  analysis: StorySourceAnalysis,
  chapterKey: string,
  expectedPage: number,
): ParsedStoryUrl {
  // A JavaScript-only pager can advance the already-paired tab from page N
  // to N+1 without a new visit() call.  Validate the returned page against
  // its own actual URL first, then make the page progression explicit.
  const actual = assertSnapshotUrl(snapshot.url, "huliwang", analysis.bookId);
  assertPageReady(snapshot, actual);
  const pager = huliChapterPagination(snapshot);
  const urlPage = actual.page ?? 1;
  const pageMatches = urlPage === expectedPage
    || (pager?.currentPage === expectedPage && urlPage <= expectedPage);
  if (
    actual.kind !== "chapter"
    || actual.chapterKey !== chapterKey
    || !pageMatches
  ) {
    throw new StorySourceError("SOURCE_CHANGED", "Huliwang chuyển sang trang hoặc chương không liên tục.");
  }
  return actual;
}

class HuliwangAdapter implements Adapter {
  public async analyze(input: ParsedStoryUrl, runtime: AdapterRuntime): Promise<AdapterAnalysisData> {
    const catalog = await collectHuliwangCatalog(input.catalogUrl, input, runtime);
    if (!catalog.chapters.length) throw new StorySourceError("SOURCE_CHANGED", "Mục lục Huliwang không có chương hợp lệ.");
    const snapshot = catalog.snapshots[0];
    if (!snapshot) throw new StorySourceError("SOURCE_CHANGED", "Không nhận được trang mục lục Huliwang.");
    return {
      bookTitle: chooseBookTitle(snapshot, "huliwang"),
      ...(extractAuthor(snapshot) ? { author: extractAuthor(snapshot) } : {}),
      chapters: catalog.chapters,
      notices: ["Huliwang có thể chia mục lục và từng chương thành nhiều trang; tool tự chuyển tuần tự qua các trang mục lục/chương đã xác minh."],
    };
  }

  public async fetch(
    analysis: StorySourceAnalysis,
    chapter: StoryChapterReference,
    runtime: AdapterRuntime,
  ): Promise<StoryChapterContent> {
    const sourceUrls: string[] = [];
    const parts: string[] = [];
    const warnings: string[] = [];
    for (const entryUrl of chapter.partUrls) {
      const entry = parseStoryUrl(entryUrl);
      if (entry.site !== "huliwang" || entry.kind !== "chapter" || !entry.chapterKey) {
        throw new StorySourceError("SOURCE_CHANGED", "Liên kết chương Huliwang không hợp lệ.");
      }
      let next: HuliChapterPagePlan | undefined = {
        url: entry.normalizedUrl,
        expectedPage: entry.page ?? 1,
      };
      const visited = new Set<string>();
      while (next) {
        if (visited.size >= runtime.maxChapterPages) throw new StorySourceError("SOURCE_CHANGED", "Chương Huliwang vượt giới hạn trang an toàn.");
        const planned: HuliChapterPagePlan = next;
        next = undefined;
        const requested = parseStoryUrl(planned.url);
        if (requested.bookId !== analysis.bookId || requested.chapterKey !== entry.chapterKey) {
          throw new StorySourceError("UNSAFE_REDIRECT", "Liên kết trang con Huliwang đã rời khỏi chương.");
        }
        const snapshot: StoryPageSnapshot = planned.snapshot ?? await runtime.visit(requested.normalizedUrl);
        const parsed = assertHuliChapterPage(snapshot, analysis, entry.chapterKey, planned.expectedPage);
        // A JavaScript pager may retain its original URL.  Logical page is
        // therefore part of the loop key, while URL navigation keeps the
        // usual canonical identity.
        const logicalPage: number = huliChapterPagination(snapshot)?.currentPage ?? parsed.page ?? 1;
        const visitedKey = `${parsed.normalizedUrl}#${logicalPage}`;
        if (visited.has(visitedKey)) {
          throw new StorySourceError("SOURCE_CHANGED", "Huliwang tạo vòng lặp phân trang chương.");
        }
        visited.add(visitedKey);
        const title = firstValue(snapshot, "#nr_title");
        const rawText = firstRawValue(snapshot, "#nr");
        if (!title || !rawText) throw new StorySourceError("SOURCE_CHANGED", "DOM chương Huliwang thiếu #nr_title hoặc #nr.");
        const normalizedText = normalizeText(rawText);
        const currentPage: number = logicalPage;
        const titlePage = HULI_TITLE_PAGE.exec(title)?.[1];
        const totalPage = HULI_TEXT_PAGE_COUNTER.exec(rawText)?.[2];
        if (
          (titlePage && currentPage !== Number.parseInt(titlePage, 10))
          || (totalPage && currentPage > Number.parseInt(totalPage, 10))
        ) {
          throw new StorySourceError("SOURCE_CHANGED", "Số trang Huliwang không liên tục hoặc vượt tổng trang.");
        }

        const directNext = huliSameChapterNextPageUrl(snapshot, parsed, currentPage);
        const needsContinuation = huliHasUnfinishedPageTail(normalizedText)
          || (totalPage !== undefined && currentPage < Number.parseInt(totalPage, 10));
        let continuation: HuliChapterPagePlan | undefined;
        if (directNext) {
          continuation = { url: directNext, expectedPage: currentPage + 1 };
        } else if (needsContinuation) {
          const pager = huliChapterPagination(snapshot);
          const advanceChapterPage = (runtime as HuliChapterRuntime).advanceChapterPage;
          if (pager?.hasNext && advanceChapterPage) {
            // This call is intentionally limited to the exact paired Huliwang
            // tab and its reported chapter pager.  The next loop validates
            // that it actually became page N+1 of this same chapter.
            const advanced = await advanceChapterPage(parsed.normalizedUrl);
            continuation = {
              url: parsed.normalizedUrl,
              expectedPage: currentPage + 1,
              snapshot: advanced,
            };
          } else {
            throw new StorySourceError(
              "SOURCE_CHANGED",
              "Huliwang báo chương chưa hết nhưng không có trang kế tiếp hợp lệ; tool đã dừng để không dịch bản thiếu.",
            );
          }
        }

        // A footer is removed only after a validated same-chapter successor
        // exists.  On the terminal page it is retained so an unexpected
        // marker fails closed above instead of masking a truncated chapter.
        const clean = continuation ? cleanHuliContinuationPageText(rawText) : normalizedText;
        assertPlausibleStoryText(clean, "Huliwang");
        parts.push(clean);
        sourceUrls.push(snapshot.url);
        next = continuation;
      }
    }
    const merged = mergeTextParts(parts);
    if (merged.overlapsRemoved) warnings.push(`Đã loại ${merged.overlapsRemoved} ký tự trùng giữa các trang.`);
    return chapterContent(chapter, merged.text, sourceUrls, warnings);
  }
}

class TimotxtAdapter implements Adapter {
  public async analyze(input: ParsedStoryUrl, runtime: AdapterRuntime): Promise<AdapterAnalysisData> {
    const catalog = await collectCatalog(input.catalogUrl, input, runtime, { scopes: [".all"] });
    if (!catalog.chapters.length) throw new StorySourceError("SOURCE_CHANGED", "Mục lục TimoTXT không có chương hợp lệ.");
    const snapshot = catalog.snapshots[0];
    if (!snapshot) throw new StorySourceError("SOURCE_CHANGED", "Không nhận được trang mục lục TimoTXT.");
    return {
      bookTitle: chooseBookTitle(snapshot, "timotxt"),
      ...(extractAuthor(snapshot) ? { author: extractAuthor(snapshot) } : {}),
      chapters: catalog.chapters,
      notices: ["TimoTXT được giải mã qua endpoint transcode của chính website; font bqg lạ sẽ bị từ chối an toàn."],
    };
  }

  public async fetch(
    analysis: StorySourceAnalysis,
    chapter: StoryChapterReference,
    runtime: AdapterRuntime,
  ): Promise<StoryChapterContent> {
    const parts: string[] = [];
    const sourceUrls: string[] = [];
    const warnings: string[] = [];
    for (const url of chapter.partUrls) {
      const parsed = parseStoryUrl(url);
      const snapshot = await runtime.visit(url);
      assertPageReady(snapshot, parsed);
      const raw = firstValue(snapshot, ".chapter-content .content");
      if (!raw) throw new StorySourceError("SOURCE_CHANGED", "DOM chương TimoTXT thiếu .chapter-content .content.");
      const metadata = snapshot.readerMetadata;
      let decoded: string | undefined;
      if (
        runtime.transcode && metadata?.sourceId && metadata.bookId === analysis.bookId &&
        metadata.chapterId === parsed.chapterKey?.split("_")[0] && metadata.chapterId
      ) {
        const response = await runtime.transcode({
          bookId: analysis.bookId,
          chapterId: metadata.chapterId,
          sourceId: metadata.sourceId,
          referer: snapshot.url,
        }, runtime.signal);
        if (response.status === 200 && response.content.trim()) {
          decoded = normalizeText(response.content);
          if (containsTimotxtEncodedCodepoints(decoded)) {
            throw new StorySourceError("TIMOTXT_DECODE_FAILED", "Endpoint transcode TimoTXT vẫn còn mã Hangul/font bqg.");
          }
        } else {
          warnings.push(`Endpoint transcode TimoTXT không sẵn sàng${response.message ? `: ${response.message}` : "."}`);
        }
      }
      if (!decoded && containsTimotxtEncodedCodepoints(raw)) {
        const activeBqgAssets = (snapshot.fontAssets ?? []).filter((asset) => asset.family.trim().toLowerCase() === "bqg");
        const hash = activeBqgAssets
          .map((asset) => asset.sha256)
          .find((value) => value.toLowerCase() === TIMOTXT_BQG_FONT_HASH);
        const decoder = runtime.decoders.find((candidate) =>
          hash && candidate.supportedFontHashes.some((supported) => supported.toLowerCase() === hash.toLowerCase()),
        );
        if (!hash) throw new StorySourceError(
          "TIMOTXT_FONT_UNVERIFIED",
          activeBqgAssets.length
            ? "Font bqg đang áp dụng cho nội dung TimoTXT không khớp hash đã ghim."
            : "Không ràng buộc được font bqg đang áp dụng với tệp font đã xác minh.",
        );
        if (!decoder) throw new StorySourceError("TIMOTXT_DECODER_REQUIRED", "Chưa có decoder đúng phiên bản/hash cho font bqg TimoTXT.");
        decoded = normalizeText(await decoder.decode({ site: "timotxt", url, text: raw, fontHash: hash }));
        warnings.push(`Đã dùng decoder ${decoder.id}@${decoder.version} được ghim theo hash font.`);
      }
      decoded ??= normalizeText(raw);
      if (containsTimotxtEncodedCodepoints(decoded)) throw new StorySourceError("TIMOTXT_DECODE_FAILED", "Nội dung TimoTXT còn mã Hangul sau giải mã.");
      decoded = removeRepeatedHeading(decoded, chapter.numberLabel);
      assertPlausibleStoryText(decoded, "TimoTXT");
      parts.push(decoded);
      sourceUrls.push(snapshot.url);
    }
    const merged = mergeTextParts(parts);
    if (merged.overlapsRemoved) warnings.push(`Đã loại ${merged.overlapsRemoved} ký tự trùng giữa các phần.`);
    return chapterContent(chapter, merged.text, sourceUrls, warnings);
  }
}

class QingrenyouxiAdapter implements Adapter {
  public async analyze(input: ParsedStoryUrl, runtime: AdapterRuntime): Promise<AdapterAnalysisData> {
    const snapshot = await runtime.visit(input.bookUrl);
    assertPageReady(snapshot, parseStoryUrl(input.bookUrl));
    if (qingSoft200(snapshot)) throw new StorySourceError("SOFT_200", "Qingrenyouxi trả trang báo không tìm thấy dù HTTP 200.");
    validateCanonical(snapshot, input.bookUrl);
    const chapters = catalogReferences(snapshot, input, ["#list-chapterAll"]);
    if (!chapters.length) throw new StorySourceError("SOURCE_CHANGED", "Mục lục Qingrenyouxi không có chương hợp lệ.");
    return {
      bookTitle: chooseBookTitle(snapshot, "qingrenyouxi"),
      ...(extractAuthor(snapshot) ? { author: extractAuthor(snapshot) } : {}),
      chapters,
      notices: ["Qingrenyouxi khai báo GBK; nội dung được đọc sau khi engine trình duyệt giải mã và kiểm tra canonical."],
    };
  }

  public async fetch(
    analysis: StorySourceAnalysis,
    chapter: StoryChapterReference,
    runtime: AdapterRuntime,
  ): Promise<StoryChapterContent> {
    const parts: string[] = [];
    const sourceUrls: string[] = [];
    const warnings: string[] = [];
    for (const url of chapter.partUrls) {
      const parsed = parseStoryUrl(url);
      const snapshot = await runtime.visit(url);
      assertPageReady(snapshot, parsed);
      if (qingSoft200(snapshot)) throw new StorySourceError("SOFT_200", "Qingrenyouxi trả trang báo không tìm thấy dù HTTP 200.");
      validateCanonical(snapshot, url);
      if (snapshot.charset && !/^(?:GBK|GB18030|UTF-8)$/iu.test(snapshot.charset.trim())) {
        throw new StorySourceError("SOURCE_CHANGED", `Bảng mã Qingrenyouxi không mong đợi: ${snapshot.charset}.`);
      }
      const heading = firstValue(snapshot, ".readTitle", "h1");
      let text = firstValue(snapshot, "#htmlContent");
      if (!heading || !text) throw new StorySourceError("SOURCE_CHANGED", "DOM chương Qingrenyouxi thiếu .readTitle hoặc #htmlContent.");
      text = removeRepeatedHeading(normalizeText(text), heading);
      assertPlausibleStoryText(text, "Qingrenyouxi");
      parts.push(text);
      sourceUrls.push(snapshot.url);
    }
    const merged = mergeTextParts(parts);
    if (merged.overlapsRemoved) warnings.push(`Đã loại ${merged.overlapsRemoved} ký tự trùng giữa các phần.`);
    return chapterContent(chapter, merged.text, sourceUrls, warnings);
  }
}

function xbanxiaSoft200(snapshot: StoryPageSnapshot): boolean {
  return /(?:出現錯誤|出现错误|文章不存在|頁面不存在|页面不存在)/iu.test(snapshot.title)
    || /(?:^|\n)\s*(?:該文章不存在|该文章不存在|文章不存在)\s*(?:\n|$)/iu.test(snapshot.bodyText);
}

class XbanxiaAdapter implements Adapter {
  public async analyze(input: ParsedStoryUrl, runtime: AdapterRuntime): Promise<AdapterAnalysisData> {
    const snapshot = await runtime.visit(input.bookUrl);
    assertPageReady(snapshot, parseStoryUrl(input.bookUrl));
    if (xbanxiaSoft200(snapshot)) {
      throw new StorySourceError("SOFT_200", "Xbanxia trả trang báo không tồn tại dù HTTP 200.");
    }
    validateCanonical(snapshot, input.bookUrl);
    const chapters = catalogReferences(snapshot, input, [".book-list"]);
    if (!chapters.length) throw new StorySourceError("SOURCE_CHANGED", "Mục lục Xbanxia không có chương hợp lệ.");
    return {
      bookTitle: chooseBookTitle(snapshot, "xbanxia"),
      ...(extractAuthor(snapshot) ? { author: extractAuthor(snapshot) } : {}),
      chapters,
      notices: ["Xbanxia được đọc đúng vùng mục lục và #nr1; watermark, điều hướng, đề xuất và ghi chú tác giả cuối chương bị loại."],
    };
  }

  public async fetch(
    _analysis: StorySourceAnalysis,
    chapter: StoryChapterReference,
    runtime: AdapterRuntime,
  ): Promise<StoryChapterContent> {
    const parts: string[] = [];
    const sourceUrls: string[] = [];
    const warnings: string[] = [];
    let resolvedTitle: string | undefined;
    for (const url of chapter.partUrls) {
      const parsed = parseStoryUrl(url);
      const snapshot = await runtime.visit(url);
      assertPageReady(snapshot, parsed);
      if (xbanxiaSoft200(snapshot)) {
        throw new StorySourceError("SOFT_200", "Xbanxia trả trang báo không tồn tại dù HTTP 200.");
      }
      validateCanonical(snapshot, url);
      if (snapshot.charset && !/^UTF-8$/iu.test(snapshot.charset.trim())) {
        throw new StorySourceError("SOURCE_CHANGED", `Bảng mã Xbanxia không mong đợi: ${snapshot.charset}.`);
      }
      const heading = firstValue(snapshot, "#nr_title");
      const raw = firstValue(snapshot, "#nr1");
      if (!heading || !raw) throw new StorySourceError("SOURCE_CHANGED", "DOM chương Xbanxia thiếu #nr_title hoặc #nr1.");
      const headingLabel = parseChapterLabel(heading);
      if (chapter.number !== undefined && headingLabel.number !== chapter.number) {
        throw new StorySourceError("SOURCE_CHANGED", "Số chương Xbanxia trong nội dung không khớp mục lục.");
      }
      const chapterNumber = chapter.number;
      const pageTitle = chapterNumber === undefined
        ? chapter.title
        : [
            cleanXbanxiaChapterTitle(heading, chapterNumber),
            cleanXbanxiaChapterTitle(`第${chapterNumber}章 ${chapter.title}`, chapterNumber),
            ...normalizeText(raw).split("\n").slice(0, 3)
              .map((line) => cleanXbanxiaChapterTitle(line, chapterNumber)),
          ].find((title): title is string => Boolean(title));
      if (!pageTitle) {
        throw new StorySourceError("SOURCE_CHANGED", `Không thể xác định tên sạch của chương Xbanxia ${chapterNumber ?? chapter.order + 1}.`);
      }
      if (resolvedTitle && resolvedTitle !== pageTitle) {
        throw new StorySourceError("SOURCE_CHANGED", "Tên chương Xbanxia thay đổi giữa các phần của cùng một chương.");
      }
      resolvedTitle = pageTitle;
      const text = removeRepeatedHeading(cleanXbanxiaStoryText(raw, chapterNumber), heading);
      assertCleanXbanxiaStoryText(text);
      assertPlausibleStoryText(text, "Xbanxia");
      parts.push(text);
      sourceUrls.push(snapshot.url);
    }
    const merged = mergeTextParts(parts);
    if (merged.overlapsRemoved) warnings.push(`Đã loại ${merged.overlapsRemoved} ký tự trùng giữa các phần.`);
    return chapterContent({ ...chapter, title: resolvedTitle ?? chapter.title }, merged.text, sourceUrls, warnings);
  }
}

const XSZJ_PAGE_COUNTER = /[（(]\s*(\d+)\s*\/\s*(\d+)\s*[）)]/u;
const XSZJ_READER_EDGE_NOISE = /^(?:没有了|目[录錄]|上一[页頁章]|下一[页頁章]|报错|手机上看|分享)$/u;

function isXszjNative(parsed: ParsedStoryUrl): boolean {
  return new URL(parsed.normalizedUrl).hostname === "xszj.org";
}

function xszjChapterNextPage(snapshot: StoryPageSnapshot, current: ParsedStoryUrl): string | undefined {
  const candidates = new Set<string>();
  for (const link of snapshot.links) {
    if (!/^\s*下一[页頁]\s*$/u.test(link.text)) continue;
    let candidate: ParsedStoryUrl;
    try { candidate = parseStoryUrl(link.href); } catch { continue; }
    if (
      candidate.site === "xszj" && candidate.kind === "chapter"
      && candidate.bookId === current.bookId && candidate.chapterKey === current.chapterKey
      && (candidate.page ?? 1) === (current.page ?? 1) + 1
    ) candidates.add(candidate.normalizedUrl);
  }
  if (candidates.size > 1) {
    throw new StorySourceError("SOURCE_CHANGED", "XSZJ trả nhiều trang kế tiếp khác nhau cho cùng một chương.");
  }
  return candidates.values().next().value as string | undefined;
}

function cleanXszjText(raw: string, heading: string): string {
  const text = removeRepeatedHeading(cleanIxdzsStoryText(raw), heading);
  const lines = text.split("\n").filter((line) => !XSZJ_READER_EDGE_NOISE.test(line.trim()));
  return lines.join("\n").trim();
}

class XszjAdapter implements Adapter {
  public async analyze(input: ParsedStoryUrl, runtime: AdapterRuntime): Promise<AdapterAnalysisData> {
    const book = await runtime.visit(input.bookUrl);
    assertPageReady(book, parseStoryUrl(input.bookUrl));
    // IXDZS8 does not publish a <link rel="canonical"> on its normal book
    // and reader pages. The authenticated snapshot URL is still validated by
    // assertPageReady on every request, so requiring a missing optional tag
    // would reject a legitimate page before its scoped content is examined.
    let catalog = isXszjNative(input)
      ? await collectCatalog(input.catalogUrl, input, runtime, {
        scopes: ["#list"],
        nextLabels: /^\s*(?:下一[页頁]|下[页頁])\s*$/u,
        nextPath: (candidate) => candidate.kind === "catalog",
      })
      : await collectCatalog(input.catalogUrl, input, runtime, { scopes: [".u-chapter"] });
    // The native book page intentionally exposes only its newest slice.  A
    // catalog that is empty is therefore a layout change, never a silent
    // partial import.
    if (!catalog.chapters.length) throw new StorySourceError("SOURCE_CHANGED", "Mục lục XSZJ không có chương hợp lệ.");
    return {
      bookTitle: chooseBookTitle(book, "xszj"),
      ...(extractAuthor(book) ? { author: extractAuthor(book) } : {}),
      chapters: catalog.chapters,
      notices: ["XSZJ/爱下电子书: tool chỉ lấy vùng mục lục và thân chương đã xác minh; trang cùng chương được ghép tuần tự khi trang hiển thị (N/tổng)."],
    };
  }

  public async fetch(
    analysis: StorySourceAnalysis,
    chapter: StoryChapterReference,
    runtime: AdapterRuntime,
  ): Promise<StoryChapterContent> {
    const parts: string[] = [];
    const sourceUrls: string[] = [];
    const warnings: string[] = [];
    for (const startUrl of chapter.partUrls) {
      let next: string | undefined = startUrl;
      const visited = new Set<string>();
      while (next) {
        if (visited.size >= runtime.maxChapterPages) throw new StorySourceError("SOURCE_CHANGED", "Chương XSZJ vượt giới hạn trang an toàn.");
        const requested = parseStoryUrl(next);
        const snapshot = await runtime.visit(requested.normalizedUrl);
        assertPageReady(snapshot, requested);
        const actual = assertSnapshotUrl(snapshot.url, "xszj", analysis.bookId);
        if (actual.kind !== "chapter" || actual.chapterKey !== requested.chapterKey || actual.page !== requested.page) {
          throw new StorySourceError("SOURCE_CHANGED", "XSZJ chuyển sang trang hoặc chương không liên tục.");
        }
        if (visited.has(actual.normalizedUrl)) throw new StorySourceError("SOURCE_CHANGED", "XSZJ tạo vòng lặp phân trang chương.");
        visited.add(actual.normalizedUrl);
        const heading = firstValue(snapshot, "h1", ".bookname");
        const raw = firstRawValue(snapshot, "#content", "article.page-content");
        if (!heading || !raw) throw new StorySourceError("SOURCE_CHANGED", "DOM chương XSZJ thiếu tiêu đề hoặc vùng nội dung an toàn.");
        const headingLabel = parseChapterLabel(heading.replace(XSZJ_PAGE_COUNTER, "").trim());
        if (chapter.number !== undefined && headingLabel.number !== chapter.number) {
          throw new StorySourceError("SOURCE_CHANGED", "Số chương XSZJ trong nội dung không khớp mục lục.");
        }
        const counter = XSZJ_PAGE_COUNTER.exec(heading);
        const currentPage = actual.page ?? 1;
        const totalPage = counter?.[2] ? Number.parseInt(counter[2], 10) : 1;
        if (counter?.[1] && Number.parseInt(counter[1], 10) !== currentPage) {
          throw new StorySourceError("SOURCE_CHANGED", "Số trang XSZJ không liên tục.");
        }
        const successor = xszjChapterNextPage(snapshot, actual);
        if (currentPage < totalPage && !successor) {
          throw new StorySourceError("SOURCE_CHANGED", "XSZJ báo chương chưa hết nhưng không có liên kết trang kế tiếp hợp lệ.");
        }
        if (successor && currentPage >= totalPage) {
          throw new StorySourceError("SOURCE_CHANGED", "XSZJ trả liên kết trang kế tiếp sau trang cuối chương.");
        }
        const text = cleanXszjText(raw, heading);
        assertPlausibleStoryText(text, "XSZJ");
        parts.push(text);
        sourceUrls.push(snapshot.url);
        next = successor;
      }
    }
    const merged = mergeTextParts(parts);
    if (merged.overlapsRemoved) warnings.push(`Đã loại ${merged.overlapsRemoved} ký tự trùng giữa các trang.`);
    return chapterContent(chapter, merged.text, sourceUrls, warnings);
  }
}

function chapterContent(
  chapter: StoryChapterReference,
  text: string,
  sourceUrls: string[],
  warnings: string[],
): StoryChapterContent {
  assertPlausibleStoryText(text, chapter.title);
  return {
    id: chapter.id,
    order: chapter.order,
    ...(chapter.number === undefined ? {} : { number: chapter.number }),
    title: chapter.title,
    sourceText: text,
    sourceUrls,
    mergedPartCount: sourceUrls.length,
    characterCount: text.length,
    warnings,
  };
}

const ADAPTERS: Readonly<Record<StorySite, Adapter>> = {
  huliwang: new HuliwangAdapter(),
  timotxt: new TimotxtAdapter(),
  qingrenyouxi: new QingrenyouxiAdapter(),
  xbanxia: new XbanxiaAdapter(),
  xszj: new XszjAdapter(),
};

export function adapterFor(site: StorySite): Adapter {
  return ADAPTERS[site];
}
