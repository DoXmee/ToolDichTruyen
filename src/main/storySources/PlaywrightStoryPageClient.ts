import { createHash } from "node:crypto";
import type { BrowserContext, Page } from "playwright-core";
import {
  StorySourceError,
  type StoryPageClient,
  type StoryPageClientFactory,
  type StoryPageFontAsset,
  type StoryPageLink,
  type StoryPageSnapshot,
  type StoryTranscodeResponse,
} from "./types.js";
import {
  installStoryNetworkRoutes,
  StoryNetworkGuard,
} from "./networkSafety.js";
import { parseStoryUrl } from "./urlRules.js";

const SNAPSHOT_SELECTORS = [
  "h1", "h2", "h3", ".title", ".bookTitle", ".readTitle", ".info", ".meta-dir", ".cataloginfo", ".infotype", ".infotype a[href*='/author/']",
  "#nr_title", "#nr", "#nr1", ".chapter-content .content", "#htmlContent", "#content", "article.page-content",
  ".chaplist .all", "#list-chapterAll .panel-chapterlist", ".panel-chapterlist",
  ".book-list", ".book-describe h1", ".book-describe p", ".book-describe a[href^='/author/']",
  "#bookIntro", "[rel=author]", ".author", ".booktag", ".nr_page",
  ".chapter-title", ".read-title", ".read-content", ".read-content-inner", ".article-content",
  ".novel-content", ".book-title", ".novel-title", ".bookname", "main",
  ".reader-content", ".reader-chap", ".reader-top__title", ".rc-row", ".chapter-list",
  ".novelcontent", ".content_novel", ".content_title", ".panel-readcontent", ".readTitle",
  ".chapter-detail .content",
].join(",");

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Đã hủy thao tác.", "AbortError");
}

interface FontAssetCandidate {
  family: string;
  url: string;
}

export function classifyCloudflareChallenge(input: {
  title: string;
  bodyText: string;
  hasStorySurface: boolean;
  hasVisibleChallengeControl: boolean;
}): "none" | "passive" | "interactive" {
  // A normal story page can contain a cached/hidden Cloudflare string. Such
  // text is not a challenge. A recognized story surface always wins.
  if (input.hasStorySurface) return "none";
  if (input.hasVisibleChallengeControl) return "interactive";

  const title = input.title.trim();
  const titleIsChallenge = /^(?:just a moment|checking your browser)[.!…\s]*$/iu.test(title);
  const mentionsChecking = /checking your browser|performing security verification/iu.test(input.bodyText);
  const hasCloudflareIdentity = /cloudflare ray id|\bcf-chl-/iu.test(input.bodyText);
  return titleIsChallenge || (mentionsChecking && hasCloudflareIdentity) ? "passive" : "none";
}

export function raceStoryOperationWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void | Promise<void>,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => {
      void Promise.resolve(onAbort?.()).catch(() => undefined);
      reject(abortError(signal));
    });
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function hashFontAssets(
  page: Page,
  candidates: FontAssetCandidate[],
  signal: AbortSignal | undefined,
  guard: StoryNetworkGuard,
): Promise<StoryPageFontAsset[]> {
  const sameOrigin = new URL(page.url()).origin;
  const safeCandidates = candidates.filter(({ url: raw }) => {
    try {
      const url = new URL(raw, page.url());
      return url.protocol === "https:" && url.origin === sameOrigin && /\.(?:woff2?|ttf)(?:\?|$)/iu.test(url.pathname);
    } catch {
      return false;
    }
  }).filter((candidate, index, all) => all.findIndex((value) =>
    value.family.toLowerCase() === candidate.family.toLowerCase() && value.url === candidate.url,
  ) === index).slice(0, 4);
  const assets: StoryPageFontAsset[] = [];
  for (const candidate of safeCandidates) {
    if (signal?.aborted) throw abortError(signal);
    await guard.assert(candidate.url, "font");
    try {
      const response = await raceStoryOperationWithAbort(page.request.get(candidate.url, {
        timeout: 15_000,
        failOnStatusCode: false,
        maxRedirects: 0,
        ...(signal ? { signal } : {}),
      }), signal);
      if (!response.ok()) continue;
      const body = await response.body();
      if (body.length > 2_000_000) continue;
      assets.push({
        family: candidate.family,
        url: candidate.url,
        sha256: createHash("sha256").update(body).digest("hex"),
      });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (error instanceof StorySourceError) throw error;
      // A missing font hash is handled fail-closed by the adapter when needed.
    }
  }
  return assets;
}

async function snapshot(
  page: Page,
  requestedUrl: string,
  status: number | undefined,
  signal: AbortSignal | undefined,
  guard: StoryNetworkGuard,
): Promise<StoryPageSnapshot> {
  const data = await page.evaluate((selectors) => {
    const textOf = (element: Element | null): string => {
      if (!element) return "";
      const clone = element.cloneNode(true) as Element;
      if (element.matches("#nr, #nr1, .chapter-content .content, #htmlContent, #content, article.page-content")) {
        clone.querySelectorAll(
          'script, style, iframe, ins, figure, .adBlock, .gadBlock, .clickforceads, .cf-unit, #comment, #teadunit, .bh-rec-embed, .recommend-wrap, [id^="cfadif"], [id^="div-onead-"], [id^="pf-"], [class^="ad-"], [class*=" ad-"], [style*="height: 0"]',
        ).forEach((node) => node.remove());
        if (element.matches(".chapter-content .content")) {
          clone.querySelectorAll(":scope > div").forEach((node) => {
            if (/(?:ONEAD_TEXT|溫馨提示\s*[:：])/u.test(node.textContent ?? "")) node.remove();
          });
        }
        // XSZJ inserts an ad container as a direct child of #booktxt between
        // real paragraph nodes. That container never belongs to prose.
        if (element.matches("#content")) {
          clone.querySelectorAll("#booktxt > div, #booktxt > ins, #booktxt > iframe").forEach((node) => node.remove());
        }
      }
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      return (clone.textContent ?? "").normalize("NFC").trim();
    };
    const elements: Record<string, string[]> = {};
    for (const selector of selectors.split(",")) {
      const key = selector.trim();
      if (!key) continue;
      const values = Array.from(document.querySelectorAll(key))
        .map(textOf)
        .filter(Boolean)
        .slice(0, 5_000);
      if (values.length) elements[key] = values;
    }
    const scopeTokens = (element: Element): string[] => {
      const values = new Set<string>();
      let current: Element | null = element;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
        if (current.id) values.add(`#${current.id}`);
        for (const className of current.classList) values.add(`.${className}`);
      }
      return [...values];
    };
    const links = Array.from(document.querySelectorAll("a[href]"), (anchor): StoryPageLink => ({
      href: (anchor as HTMLAnchorElement).href,
      text: textOf(anchor).replace(/\s+/gu, " "),
      scopes: scopeTokens(anchor),
    }));
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    const fontFamilies = new Set<string>();
    for (const element of Array.from(document.querySelectorAll("#nr, #nr1, .chapter-content .content, #htmlContent, #content, article.page-content"))) {
      const style = getComputedStyle(element);
      style.fontFamily.split(",").forEach((family) => fontFamilies.add(family.replace(/["']/gu, "").trim()));
    }
    const activeFamilies = new Set([...fontFamilies].map((family) => family.toLowerCase()));
    const fontAssets: Array<{ family: string; url: string }> = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const fontRule = rule as CSSFontFaceRule;
          const family = fontRule.style.getPropertyValue("font-family").replace(/["']/gu, "").trim();
          if (!family || !activeFamilies.has(family.toLowerCase())) continue;
          const source = fontRule.style.getPropertyValue("src");
          for (const match of source.matchAll(/url\(["']?([^"')]+\.(?:woff2?|ttf)(?:\?[^"')]*)?)/giu)) {
            if (match[1]) fontAssets.push({ family, url: new URL(match[1], document.baseURI).href });
          }
        }
      } catch {
        // Cross-origin CSS is expected; the adapter still sees computed family.
      }
    }
    const scripts = Array.from(document.scripts, (script) => script.textContent ?? "").join("\n");
    const readInit = /Read\.init\s*\(\s*\{([\s\S]{0,3000}?)\}\s*\)/u.exec(scripts)?.[1] ?? "";
    const metadata = {
      bookId: /book_id\s*:\s*['"]([a-zA-Z0-9]{4,24})['"]/u.exec(readInit)?.[1],
      chapterId: /cid\s*:\s*['"]?(\d+)['"]?/u.exec(readInit)?.[1],
      sourceId: /sid\s*:\s*['"]?(\d+)['"]?/u.exec(readInit)?.[1],
    };
    const bodyText = textOf(document.body);
    const storySurfaceSelectors = "#nr, #nr1, .chapter-content .content, #htmlContent, #content, article.page-content, .chaplist .all, #list-chapterAll .panel-chapterlist, .panel-chapterlist, .u-chapter, #list";
    const hasStorySurface = Array.from(document.querySelectorAll(storySurfaceSelectors)).some((element) => textOf(element).length >= 40);
    const hasVisibleChallengeControl = Array.from(document.querySelectorAll(
      'iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"], .cf-turnstile',
    )).some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0 && rect.width >= 8 && rect.height >= 8;
    });
    return {
      url: location.href,
      title: document.title,
      canonicalUrl: canonical,
      charset: document.characterSet,
      htmlLanguage: document.documentElement.lang,
      bodyText,
      elements,
      links,
      fontFamilies: [...fontFamilies],
      fontAssets,
      readerMetadata: Object.values(metadata).some(Boolean) ? metadata : undefined,
      hasStorySurface,
      hasVisibleChallengeControl,
    };
  }, SNAPSHOT_SELECTORS);
  const fontAssets = await hashFontAssets(page, data.fontAssets, signal, guard);
  const fontHashes = [...new Set(fontAssets.map((asset) => asset.sha256))];
  const fontUrls = [...new Set(data.fontAssets.map((asset) => asset.url))];
  const { hasStorySurface, hasVisibleChallengeControl, ...snapshotData } = data;
  return {
    requestedUrl,
    ...(status === undefined ? {} : { status }),
    ...snapshotData,
    challenge: classifyCloudflareChallenge({
      title: data.title,
      bodyText: data.bodyText,
      hasStorySurface,
      hasVisibleChallengeControl,
    }),
    fontUrls,
    fontHashes,
    fontAssets,
  };
}

export class PlaywrightPageClient implements StoryPageClient {
  private page?: Page;
  private lastNavigation?: { requestedUrl: string; status?: number };

  public constructor(
    private readonly context: BrowserContext,
    private readonly networkGuard = new StoryNetworkGuard(),
  ) {}

  public async visit(url: string, signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (signal?.aborted) throw abortError(signal);
    await this.networkGuard.assert(url, "navigation");
    this.networkGuard.clearNavigationFailure();
    if (!this.page) {
      this.page = await this.context.newPage();
      this.trackMainFrameResponses(this.page);
    }
    const page = this.page;
    // Install the requested-URL ownership before goto. Playwright emits the
    // main-document response before goto resolves, so the response listener
    // can safely associate both the initial response and a later Cloudflare
    // JavaScript navigation with this exact visit.
    this.lastNavigation = { requestedUrl: url };
    try {
      return await raceStoryOperationWithAbort((async () => {
        const c6k6 = isC6k6Url(url);
        const response = await page.goto(url, {
          // C6K6 can leave a third-party script pending indefinitely after the
          // useful document has committed. Wait for its story surface below
          // instead of tying success to DOMContentLoaded.
          waitUntil: c6k6 ? "commit" : "domcontentloaded",
          // C6K6 often leaves a third-party script pending even though the
          // catalog/chapter DOM is already usable.  Return control sooner so
          // StorySourceService can inspect and validate that loaded DOM rather
          // than paying the generic 45-second timeout for every chapter.
          timeout: storyNavigationTimeoutMs(url),
          ...(signal ? { signal } : {}),
        });
        if (signal?.aborted) throw abortError(signal);
        if (c6k6) {
          await page.waitForFunction(
            () => (document.body?.innerText ?? "").trim().length >= 40,
            undefined,
            { timeout: 20_000 },
          );
          if (signal?.aborted) throw abortError(signal);
        }
        const status = response?.status();
        const current = this.lastNavigation;
        // The response event is authoritative because Cloudflare can finish a
        // second main-frame navigation before the original goto promise is
        // observed here. Only fill a missing value; never overwrite a newer
        // status with the stale response returned by goto.
        if (current?.requestedUrl === url && current.status === undefined && status !== undefined) {
          this.lastNavigation = { ...current, status };
        }
        await this.expandIxdzsCatalog(page, url, signal);
        const expanded = await snapshot(page, url, undefined, signal, this.networkGuard);
        return this.withLatestNavigationStatus(expanded, url);
      })(), signal, () => this.discardPage(page));
    } catch (error) {
      const networkFailure = this.networkGuard.takeNavigationFailure();
      if (networkFailure) throw networkFailure;
      throw error;
    }
  }

  /**
   * Samples the already-open tab only. In particular, it intentionally does
   * not call `goto`: Cloudflare's passive verification is page-local and a
   * repeated navigation restarts it before its JavaScript can finish.
   */
  public async inspectCurrent(signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (signal?.aborted) throw abortError(signal);
    const page = this.page;
    const lastNavigation = this.lastNavigation;
    if (!page || !lastNavigation) {
      throw new StorySourceError("SOURCE_CHANGED", "Chưa có trang nguồn đang mở để kiểm tra xác minh.");
    }
    try {
      const result = await raceStoryOperationWithAbort(
        snapshot(page, lastNavigation.requestedUrl, undefined, signal, this.networkGuard),
        signal,
        () => this.discardPage(page),
      );
      // Read the tracker after evaluating the current document. A successful
      // Cloudflare navigation emits its main-frame response before the new DOM
      // can be evaluated, so this cannot retain the challenge page's old 403.
      return this.withLatestNavigationStatus(result, lastNavigation.requestedUrl);
    } catch (error) {
      const networkFailure = this.networkGuard.takeNavigationFailure();
      if (networkFailure) throw networkFailure;
      throw error;
    }
  }

  public async transcode(request: {
    bookId: string;
    chapterId: string;
    sourceId: string;
    referer: string;
  }, signal?: AbortSignal): Promise<StoryTranscodeResponse> {
    if (signal?.aborted) throw abortError(signal);
    const page = this.page;
    if (!page) throw new StorySourceError("TIMOTXT_DECODE_FAILED", "Trang TimoTXT chưa được mở để giải mã.");
    const current = new URL(page.url());
    if (current.hostname !== "www.timotxt.com" || new URL(request.referer).hostname !== current.hostname) {
      throw new StorySourceError("UNSAFE_REDIRECT", "Không gọi endpoint giải mã TimoTXT từ trang không được xác minh.");
    }
    const endpoint = "https://www.timotxt.com/chapter/transcode.html";
    await this.networkGuard.assert(endpoint, "transcode");
    const response = await raceStoryOperationWithAbort(page.request.get(endpoint, {
        params: { bid: request.bookId, cid: request.chapterId, sid: request.sourceId },
        headers: { Referer: request.referer },
        failOnStatusCode: false,
        maxRedirects: 0,
        timeout: 30_000,
        ...(signal ? { signal } : {}),
      }), signal, () => this.discardPage(page));
    if (signal?.aborted) throw abortError(signal);
    if (!response.ok()) {
      return { status: response.status(), content: "", message: `HTTP ${response.status()}` };
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new StorySourceError("TIMOTXT_DECODE_FAILED", "Endpoint giải mã TimoTXT trả JSON không hợp lệ.", { cause: error });
    }
    if (!value || typeof value !== "object") {
      throw new StorySourceError("TIMOTXT_DECODE_FAILED", "Endpoint giải mã TimoTXT trả dữ liệu không hợp lệ.");
    }
    const record = value as { status?: unknown; content?: unknown; msg?: unknown };
    return {
      status: typeof record.status === "number" ? record.status : 0,
      content: typeof record.content === "string" ? record.content : "",
      ...(typeof record.msg === "string" ? { message: record.msg } : {}),
    };
  }

  public async close(): Promise<void> {
    await this.context.close();
  }

  private async discardPage(page: Page): Promise<void> {
    if (this.page === page) {
      this.page = undefined;
      this.lastNavigation = undefined;
    }
    await page.close({ runBeforeUnload: false }).catch(() => undefined);
  }

  /** Opens only Ixdzs' in-page full catalog control; no arbitrary DOM action. */
  private async expandIxdzsCatalog(page: Page, requestedUrl: string, signal?: AbortSignal): Promise<void> {
    let parsed;
    try { parsed = parseStoryUrl(requestedUrl); } catch { return; }
    if (parsed.site !== "xszj" || parsed.kind !== "book" || !/^https:\/\/ixdzs8\.com\/read\//u.test(parsed.normalizedUrl)) return;
    const trigger = page.locator("li.catalog-all");
    if (await trigger.count() !== 1) return;
    const before = await page.locator(".u-chapter a[href*='/p']").count();
    await raceStoryOperationWithAbort(trigger.click({ timeout: 8_000 }), signal, () => this.discardPage(page));
    await raceStoryOperationWithAbort(page.waitForFunction((count) => document.querySelectorAll(".u-chapter a[href*='/p']").length > count, before, { timeout: 8_000 }), signal, () => this.discardPage(page));
  }

  private trackMainFrameResponses(page: Page): void {
    page.on("response", (response) => {
      if (this.page !== page) return;
      const request = response.request();
      if (!request.isNavigationRequest() || response.frame() !== page.mainFrame()) return;
      const current = this.lastNavigation;
      if (!current) return;
      this.lastNavigation = {
        ...current,
        status: response.status(),
      };
    });
  }

  private withLatestNavigationStatus(
    result: StoryPageSnapshot,
    requestedUrl: string,
  ): StoryPageSnapshot {
    const current = this.lastNavigation;
    if (current?.requestedUrl !== requestedUrl || current.status === undefined) return result;
    return { ...result, status: current.status };
  }
}

export function storyNavigationTimeoutMs(url: string): number {
  if (isC6k6Url(url)) return 20_000;
  return 45_000;
}

function isC6k6Url(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "c6k6.com" || hostname.endsWith(".c6k6.com");
  } catch {
    // URL ownership is validated before this helper is reached.
    return false;
  }
}

export const createPlaywrightStoryPageClient: StoryPageClientFactory = async (options) => {
  const { chromium } = await import("playwright-core");
  const launchOptions = {
    headless: options.headless,
    acceptDownloads: false,
    serviceWorkers: "block" as const,
    viewport: { width: 1280, height: 900 },
    ...(options.executablePath ? { executablePath: options.executablePath } : { channel: "msedge" }),
  };
  const context = await chromium.launchPersistentContext(options.profileDirectory, launchOptions);
  const networkGuard = new StoryNetworkGuard();
  try {
    await installStoryNetworkRoutes(context, networkGuard);
    return new PlaywrightPageClient(context, networkGuard);
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
};
