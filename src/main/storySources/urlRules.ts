import type { StorySite, StoryUrlKind } from "../../shared/types.js";
import { StorySourceError } from "./types.js";

export interface ParsedStoryUrl {
  site: StorySite;
  kind: StoryUrlKind;
  bookId: string;
  chapterKey?: string;
  page?: number;
  inputUrl: string;
  normalizedUrl: string;
  bookUrl: string;
  catalogUrl: string;
}

const HOSTS: Readonly<Record<StorySite, ReadonlySet<string>>> = {
  huliwang: new Set(["huliwang.net", "www.huliwang.net", "m.huliwang.net"]),
  timotxt: new Set(["timotxt.com", "www.timotxt.com"]),
  qingrenyouxi: new Set(["qingrenyouxi.com", "www.qingrenyouxi.com"]),
  xbanxia: new Set(["xbanxia.cc", "www.xbanxia.cc"]),
  xszj: new Set(["xszj.org", "www.xszj.org", "ixdzs8.com", "www.ixdzs8.com"]),
  liehuozw: new Set(["liehuozw.com", "www.liehuozw.com", "m.liehuozw.com"]),
  uaa002: new Set(["uaa002.com", "www.uaa002.com", "m.uaa002.com", "uaa.com", "www.uaa.com", "m.uaa.com"]),
  c6k6: new Set(["c6k6.com", "www.c6k6.com", "m.c6k6.com"]),
  czbooks: new Set(["czbooks.net", "www.czbooks.net", "m.czbooks.net"]),
  novel543: new Set(["novel543.com", "www.novel543.com"]),
};

function safeUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length > 2_048 || !raw.trim()) {
    throw new TypeError("URL nguồn truyện không hợp lệ.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch (error) {
    throw new StorySourceError("UNSUPPORTED_URL", "URL nguồn truyện không hợp lệ.", { cause: error });
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    (parsed.port && !["80", "443"].includes(parsed.port))
  ) {
    throw new StorySourceError("UNSUPPORTED_URL", "URL chứa giao thức, thông tin đăng nhập hoặc cổng không được phép.");
  }
  parsed.hash = "";
  return parsed;
}

function canonicalOrigin(site: StorySite): string {
  if (site === "huliwang") return "https://m.huliwang.net";
  if (site === "timotxt") return "https://www.timotxt.com";
  if (site === "qingrenyouxi") return "https://www.qingrenyouxi.com";
  if (site === "xbanxia") return "https://www.xbanxia.cc";
  if (site === "xszj") return "https://xszj.org";
  if (site === "liehuozw") return "https://m.liehuozw.com";
  if (site === "uaa002") return "https://m.uaa002.com";
  if (site === "c6k6") return "https://www.c6k6.com";
  if (site === "novel543") return "https://www.novel543.com";
  return "https://czbooks.net";
}

export function siteForHostname(hostname: string): StorySite | undefined {
  const normalized = hostname.toLowerCase();
  return (Object.keys(HOSTS) as StorySite[]).find((site) => HOSTS[site].has(normalized));
}

export function parseStoryUrl(raw: string): ParsedStoryUrl {
  const input = safeUrl(raw);
  const site = siteForHostname(input.hostname);
  if (!site) {
    throw new StorySourceError(
      "UNSUPPORTED_URL",
      "Chỉ hỗ trợ các nguồn: huliwang.net, timotxt.com, qingrenyouxi.com, xbanxia.cc, xszj.org/ixdzs8.com, liehuozw.com, uaa002.com, c6k6.com, czbooks.net và novel543.com.",
    );
  }
  const path = input.pathname.replace(/\/{2,}/gu, "/");
  const sourcePage = input.searchParams.get("page");
  const sourceNovelId = input.searchParams.get("id") ?? input.searchParams.get("novelId") ?? input.searchParams.get("novel_id");
  const sourceChapterId = input.searchParams.get("chapter") ?? input.searchParams.get("chapterId") ?? input.searchParams.get("cid");
  const sourcePageId = input.searchParams.get("id");
  input.search = "";
  const origin = canonicalOrigin(site);

  if (site === "huliwang") {
    const catalog = /^\/dir\/(\d+)(?:[-_/](\d+))?\.html\/?$/u.exec(path);
    const chapter = /^\/(\d+)\/(\d+)(?:\/(\d+))?\.html\/?$/u.exec(path);
    const book = /^\/(\d+)\/?$/u.exec(path);
    const bookId = catalog?.[1] ?? chapter?.[1] ?? book?.[1];
    if (!bookId) throwUnsupportedPath(site);
    const kind: StoryUrlKind = catalog ? "catalog" : chapter ? "chapter" : "book";
    const chapterKey = chapter?.[2];
    const page = chapter?.[3] ? Number.parseInt(chapter[3], 10) : chapter ? 1 : undefined;
    const normalizedPath = catalog
      ? path
      : chapterKey
        ? `/${bookId}/${chapterKey}${page && page > 1 ? `/${page}` : ""}.html`
        : `/${bookId}/`;
    return {
      site,
      kind,
      bookId,
      ...(chapterKey ? { chapterKey } : {}),
      ...(page ? { page } : {}),
      inputUrl: input.toString(),
      normalizedUrl: `${origin}${normalizedPath}`,
      bookUrl: `${origin}/${bookId}/`,
      catalogUrl: `${origin}/dir/${bookId}.html`,
    };
  }

  if (site === "timotxt") {
    const catalog = /^\/([a-zA-Z0-9]{4,24})\/dir\/?$/u.exec(path);
    const chapter = /^\/([a-zA-Z0-9]{4,24})\/(\d+(?:_\d+)?)\.html\/?$/u.exec(path);
    const book = /^\/([a-zA-Z0-9]{4,24})\/?$/u.exec(path);
    const bookId = catalog?.[1] ?? chapter?.[1] ?? book?.[1];
    if (!bookId) throwUnsupportedPath(site);
    const kind: StoryUrlKind = catalog ? "catalog" : chapter ? "chapter" : "book";
    const chapterKey = chapter?.[2];
    return {
      site,
      kind,
      bookId,
      ...(chapterKey ? { chapterKey } : {}),
      inputUrl: input.toString(),
      normalizedUrl: `${origin}/${bookId}/${catalog ? "dir" : chapterKey ? `${chapterKey}.html` : ""}`,
      bookUrl: `${origin}/${bookId}/`,
      catalogUrl: `${origin}/${bookId}/dir`,
    };
  }

  if (site === "qingrenyouxi") {
    const chapter = /^\/book\/(\d+)\/(\d+)\.html\/?$/u.exec(path);
    const book = /^\/book\/(\d+)\.html\/?$/u.exec(path);
    const bookId = chapter?.[1] ?? book?.[1];
    if (!bookId) throwUnsupportedPath(site);
    const chapterKey = chapter?.[2];
    return {
      site,
      kind: chapter ? "chapter" : "book",
      bookId,
      ...(chapterKey ? { chapterKey } : {}),
      inputUrl: input.toString(),
      normalizedUrl: `${origin}/book/${bookId}${chapterKey ? `/${chapterKey}` : ""}.html`,
      bookUrl: `${origin}/book/${bookId}.html`,
      catalogUrl: `${origin}/book/${bookId}.html`,
    };
  }

  if (site === "xszj") {
    const xszjBook = /^\/b\/(\d+)\/?$/u.exec(path);
    const xszjCatalog = /^\/b\/(\d+)\/cs\/(\d+)\/?$/u.exec(path);
    const xszjChapter = /^\/b\/(\d+)\/c\/(\d+)\/?$/u.exec(path);
    const ixdzsBook = /^\/read\/(\d+)\/?$/u.exec(path);
    const ixdzsChapter = /^\/read\/(\d+)\/p(\d+)\.html\/?$/u.exec(path);
    const bookId = xszjBook?.[1] ?? xszjCatalog?.[1] ?? xszjChapter?.[1] ?? ixdzsBook?.[1] ?? ixdzsChapter?.[1];
    if (!bookId) throwUnsupportedPath(site);
    const isNative = Boolean(xszjBook ?? xszjCatalog ?? xszjChapter);
    const origin = isNative ? "https://xszj.org" : "https://ixdzs8.com";
    const chapterKey = xszjChapter?.[2] ?? ixdzsChapter?.[2];
    const catalogPage = xszjCatalog?.[2];
    const page = chapterKey && isNative && sourcePage && /^\d+$/u.test(sourcePage)
      ? Number.parseInt(sourcePage, 10)
      : undefined;
    const kind: StoryUrlKind = xszjCatalog ? "catalog" : chapterKey ? "chapter" : "book";
    const normalizedUrl = xszjCatalog
      ? `${origin}/b/${bookId}/cs/${catalogPage}`
      : chapterKey
        ? isNative
          ? `${origin}/b/${bookId}/c/${chapterKey}${page && page > 1 ? `?page=${page}` : ""}`
          : `${origin}/read/${bookId}/p${chapterKey}.html`
        : isNative ? `${origin}/b/${bookId}` : `${origin}/read/${bookId}/`;
    return {
      site,
      kind,
      bookId,
      ...(chapterKey ? { chapterKey } : {}),
      ...(page ? { page } : {}),
      inputUrl: input.toString(),
      normalizedUrl,
      bookUrl: isNative ? `${origin}/b/${bookId}` : `${origin}/read/${bookId}/`,
      catalogUrl: isNative ? `${origin}/b/${bookId}/cs/1` : `${origin}/read/${bookId}/`,
    };
  }

  if (site === "liehuozw") {
    const catalog = /^\/(\d+)\/(\d+)\/all(?:_\d+)?\/?$/u.exec(path);
    const match = /^\/(\d+)\/(\d+)(?:\/(\d+)(?:_(\d+))?)?(?:\.html)?\/?$/u.exec(path);
    const bookId = (match?.[1] ?? catalog?.[1]) && (match?.[2] ?? catalog?.[2]) ? `${match?.[1] ?? catalog?.[1]}/${match?.[2] ?? catalog?.[2]}` : undefined;
    if (!bookId) throwUnsupportedPath(site);
    const chapterKey = match?.[3];
    const page = match?.[4] ? Number.parseInt(match[4], 10) : undefined;
    const normalizedUrl = catalog
      ? `${origin}/${bookId}/all${path.match(/all(_\d+)?/u)?.[1] ?? ""}/`
      : chapterKey
        ? `${origin}/${bookId}/${chapterKey}${page && page > 1 ? `_${page}` : ""}.html`
        : `${origin}/${bookId}/`;
    return {
      site,
      kind: catalog ? "catalog" : chapterKey ? "chapter" : "book",
      bookId,
      ...(chapterKey ? { chapterKey } : {}),
      ...(page ? { page } : {}),
      inputUrl: input.toString(),
      normalizedUrl,
      bookUrl: `${origin}/${bookId}/`,
      catalogUrl: `${origin}/${bookId}/all_1/`,
    };
  }

  if (site === "uaa002") {
    const id = sourceNovelId;
    const pathId = /\/novel\/(?:intro|read|chapter)\/(\d+)/iu.exec(path)?.[1];
    const chapterQueryId = sourcePageId;
    const isChapterPath = /^\/novel\/chapter\/?$/iu.test(path);
    const bookId = id ?? pathId ?? (isChapterPath ? "unknown" : undefined);
    if (!bookId || (!/^\d+$/u.test(bookId) && bookId !== "unknown")) throwUnsupportedPath(site);
    const chapterKey = sourceChapterId ?? (isChapterPath ? chapterQueryId : undefined) ?? (/\/novel\/(?:read|chapter)\/\d+\/(\d+)/iu.exec(path)?.[1]);
    const normalizedUrl = chapterKey
      ? (isChapterPath ? `${origin}/novel/chapter?id=${chapterKey}` : `${origin}/novel/read/${bookId}/${chapterKey}`)
      : `${origin}/novel/intro?id=${bookId}`;
    return { site, kind: chapterKey ? "chapter" : "book", bookId, ...(chapterKey ? { chapterKey } : {}), inputUrl: input.toString(), normalizedUrl, bookUrl: `${origin}/novel/intro?id=${bookId}`, catalogUrl: `${origin}/novel/intro?id=${bookId}` };
  }

  if (site === "c6k6") {
    const desktop = /^\/book\/(\d+)(?:\/(\d+))?\.html\/?$/u.exec(path) ?? /^\/book\/(\d+)(?:\/(\d+))?\/?$/u.exec(path);
    const mobile = /^\/(\d+)\/(\d+)(?:\/(\d+)\.html)?\/?$/u.exec(path);
    const bookId = desktop?.[1] ?? mobile?.[2];
    if (!bookId) throwUnsupportedPath(site);
    const chapterKey = desktop?.[2] ?? mobile?.[3];
    // The desktop C6K6 book endpoint is intermittently returning HTTP 500
    // while its canonical mobile catalog remains available. Its directory is
    // the integer book id divided by 1000 (for example 124560 -> 124 and
    // 1064 -> 1), which is also the structure used by every accepted mobile
    // URL. Canonicalize both variants to that same verified mobile surface.
    const mobileSection = mobile?.[1] ?? String(Math.floor(Number.parseInt(bookId, 10) / 1_000));
    const mobileOrigin = "https://m.c6k6.com";
    const normalizedUrl = chapterKey
      ? `${mobileOrigin}/${mobileSection}/${bookId}/${chapterKey}.html`
      : `${mobileOrigin}/${mobileSection}/${bookId}/`;
    const bookUrl = `${mobileOrigin}/${mobileSection}/${bookId}/`;
    return { site, kind: chapterKey ? "chapter" : "book", bookId, ...(chapterKey ? { chapterKey } : {}), inputUrl: input.toString(), normalizedUrl, bookUrl, catalogUrl: bookUrl };
  }

  if (site === "czbooks") {
    const match = /^\/n\/([a-z0-9]+)(?:\/([a-z0-9]+))?\/?$/iu.exec(path);
    const bookId = match?.[1];
    if (!bookId) throwUnsupportedPath(site);
    const chapterKey = match?.[2];
    const chapterNumber = input.searchParams.get("chapterNumber");
    const normalizedUrl = chapterKey
      ? `${origin}/n/${bookId}/${chapterKey}${chapterNumber === null ? "" : `?chapterNumber=${encodeURIComponent(chapterNumber)}`}`
      : `${origin}/n/${bookId}`;
    return { site, kind: chapterKey ? "chapter" : "book", bookId, ...(chapterKey ? { chapterKey } : {}), inputUrl: input.toString(), normalizedUrl, bookUrl: `${origin}/n/${bookId}`, catalogUrl: `${origin}/n/${bookId}` };
  }

  if (site === "novel543") {
    const catalog = /^\/(\d{6,20})\/dir\/?$/u.exec(path);
    const chapter = /^\/(\d{6,20})\/(\d+)_(\d+)(?:_(\d+))?\.html\/?$/u.exec(path);
    const book = /^\/(\d{6,20})\/?$/u.exec(path);
    const bookId = catalog?.[1] ?? chapter?.[1] ?? book?.[1];
    if (!bookId) throwUnsupportedPath(site);
    const chapterKey = chapter ? `${chapter[2]}_${chapter[3]}` : undefined;
    const page = chapter?.[4] ? Number.parseInt(chapter[4], 10) : chapter ? 1 : undefined;
    const normalizedUrl = chapterKey
      ? `${origin}/${bookId}/${chapterKey}${page && page > 1 ? `_${page}` : ""}.html`
      : catalog ? `${origin}/${bookId}/dir` : `${origin}/${bookId}/`;
    return {
      site,
      kind: catalog ? "catalog" : chapter ? "chapter" : "book",
      bookId,
      ...(chapterKey ? { chapterKey } : {}),
      ...(page ? { page } : {}),
      inputUrl: input.toString(),
      normalizedUrl,
      bookUrl: `${origin}/${bookId}/`,
      catalogUrl: `${origin}/${bookId}/dir`,
    };
  }

  const chapter = /^\/books\/(\d+)\/(\d+)\.html\/?$/u.exec(path);
  const book = /^\/books\/(\d+)\.html\/?$/u.exec(path);
  const bookId = chapter?.[1] ?? book?.[1];
  if (!bookId) throwUnsupportedPath(site);
  const chapterKey = chapter?.[2];
  const bookUrl = `${origin}/books/${bookId}.html`;
  return {
    site,
    kind: chapter ? "chapter" : "book",
    bookId,
    ...(chapterKey ? { chapterKey } : {}),
    inputUrl: input.toString(),
    normalizedUrl: chapterKey ? `${origin}/books/${bookId}/${chapterKey}.html` : bookUrl,
    bookUrl,
    catalogUrl: bookUrl,
  };
}

function throwUnsupportedPath(site: StorySite): never {
  throw new StorySourceError("UNSUPPORTED_URL", `Đường dẫn ${site} không phải trang sách, mục lục hoặc chương được hỗ trợ.`);
}

export function assertSnapshotUrl(
  candidate: string,
  expectedSite: StorySite,
  expectedBookId?: string,
): ParsedStoryUrl {
  let parsed: ParsedStoryUrl;
  try {
    parsed = parseStoryUrl(candidate);
  } catch (error) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trang nguồn đã chuyển tới URL ngoài phạm vi an toàn.", { cause: error });
  }
  if (parsed.site !== expectedSite || (expectedBookId && parsed.bookId !== expectedBookId)) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trang nguồn đã chuyển sang website hoặc sách khác.");
  }
  return parsed;
}

export function sameCanonicalUrl(left: string, right: string): boolean {
  try {
    const a = safeUrl(left);
    const b = safeUrl(right);
    const normalizeHost = (value: string): string => value.toLowerCase().replace(/^www\./u, "");
    return normalizeHost(a.hostname) === normalizeHost(b.hostname)
      && a.pathname.replace(/\/+$/u, "") === b.pathname.replace(/\/+$/u, "");
  } catch {
    return false;
  }
}
