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
  return "https://xszj.org";
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
      "Chỉ hỗ trợ các nguồn: huliwang.net, timotxt.com, qingrenyouxi.com, xbanxia.cc và xszj.org/ixdzs8.com.",
    );
  }
  const path = input.pathname.replace(/\/{2,}/gu, "/");
  const sourcePage = input.searchParams.get("page");
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
