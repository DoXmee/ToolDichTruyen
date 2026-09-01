import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  StoryChapterReference,
  StoryFetchResult,
  StorySourceAnalysis,
  StorySourceProgress,
} from "../../shared/types.js";
import { adapterFor, type AdapterRuntime } from "./adapters.js";
import {
  startHuliwangBrowserBridge,
  type HuliwangCompanionSession,
} from "./HuliwangBrowserBridge.js";
import { defaultManualVerificationLauncher } from "./manualVerification.js";
import { createPlaywrightStoryPageClient } from "./PlaywrightStoryPageClient.js";
import { TimotxtF24092Decoder } from "./timotxtDecoder.js";
import { parseStoryUrl } from "./urlRules.js";
import { assignOutputChapterNumbers } from "./outputNumbering.js";
import { parseChapterLabel } from "./text.js";
import {
  StorySourceError,
  type FetchStoryChaptersRequest,
  type StoryPageClient,
  type StoryPageSnapshot,
  type StoryProgressListener,
  type StorySourceServiceApi,
  type StorySourceServiceOptions,
} from "./types.js";

interface ActiveOperation {
  analysisId: string;
  controller: AbortController;
}

/**
 * These sites are deliberately read through the paired, everyday browser
 * profile rather than an app-owned Playwright context.  That keeps a
 * Cloudflare verification in the browser the person actually uses and avoids
 * treating the verification as content or attempting to automate it.
 */
type BrowserCompanionSite = "huliwang" | "xszj" | "novel543";

function isBrowserCompanionSite(site: StorySourceAnalysis["site"]): site is BrowserCompanionSite {
  return site === "huliwang" || site === "xszj" || site === "novel543";
}

function browserCompanionSiteLabel(site: BrowserCompanionSite): string {
  if (site === "huliwang") return "Huliwang";
  if (site === "xszj") return "XSZJ/爱下电子书";
  return "Novel543";
}

function browserCompanionRequiredMessage(site: BrowserCompanionSite): string {
  const label = browserCompanionSiteLabel(site);
  return `${label} chỉ được đọc bằng trình duyệt mặc định và hồ sơ bạn dùng hằng ngày. Hãy bấm Kết nối trình duyệt mặc định; tool không mở trình duyệt tự động cho ${label}.`;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Đã hủy thao tác.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Đã hủy thao tác.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isCancellation(error: unknown): boolean {
  return (error instanceof StorySourceError && error.code === "CANCELLED")
    || (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

/**
 * Playwright has a distinct failure mode when its page, context or browser was
 * closed between source operations.  It is safe to replace only a client that
 * this service created itself; all other navigation errors must keep their
 * original fail-closed behaviour.
 */
function isClosedPageClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:target\s+(?:page(?:,\s*context)?\s+or\s+browser|page|context|browser)\s+(?:has\s+been\s+)?closed|(?:page|context|browser)\s+has\s+been\s+closed|target\s+closed)/iu
    .test(error.message);
}

function isPageNavigationTimeout(error: unknown): boolean {
  return error instanceof Error && /(?:page\.goto|navigation)[\s\S]*timeout/iu.test(error.message);
}

function isTransientPageTransition(error: unknown): boolean {
  return error instanceof Error && /(?:execution context was destroyed|frame was detached|cannot find context with specified id|most likely because of a navigation)/iu.test(error.message);
}

function isUaaLoginLocked(snapshot: StoryPageSnapshot): boolean {
  return /(?:以下正文内容已隐藏|您在登录后即可阅读|立即登录)/iu.test(snapshot.bodyText);
}

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fallback;
  return Math.min(maximum, Math.max(1, value));
}

function cloneAnalysis(analysis: StorySourceAnalysis): StorySourceAnalysis {
  return {
    ...analysis,
    chapters: analysis.chapters.map((chapter) => ({ ...chapter, partUrls: [...chapter.partUrls] })),
    defaultSelectedChapterIds: [...analysis.defaultSelectedChapterIds],
    notices: [...analysis.notices],
  };
}

function chapterHeader(chapter: { title: string }, outputNumber: number): string {
  const prefix = `Chương ${outputNumber}`;
  const nestedChinese = parseChapterLabel(chapter.title);
  let title = chapter.title.trim();
  if (nestedChinese.number !== undefined) {
    if (nestedChinese.number !== outputNumber) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        `Tên chương ${outputNumber} chứa số chương lồng ${nestedChinese.number}; đã dừng trước khi dịch để tránh đánh số sai.`,
      );
    }
    title = nestedChinese.title === nestedChinese.numberLabel ? "" : nestedChinese.title;
  }
  const nestedVietnamese = /^\s*(?:【|\[|［)?\s*Chương\s+(\d+)(?:\s|[:：\-—]|$)/iu.exec(title);
  if (nestedVietnamese?.[1]) {
    throw new StorySourceError(
      "SOURCE_CHANGED",
      `Tên chương ${outputNumber} vẫn chứa một tiêu đề chương lồng bên trong; đã dừng trước khi dịch để tránh đánh số sai.`,
    );
  }
  return title && !new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "iu").test(title)
    ? `${prefix}: ${title}`
    : prefix;
}

export class StorySourceService implements StorySourceServiceApi {
  private readonly emitter = new EventEmitter();
  private readonly analyses = new Map<string, StorySourceAnalysis>();
  private readonly profileDirectory: string;
  private readonly minRequestIntervalMs: number;
  private readonly verificationWaitMs: number;
  private readonly manualVerificationWaitMs: number;
  private readonly maxCatalogPages: number;
  private readonly maxChapterPages: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly decoders;
  /** A caller-supplied test/client boundary is owned by the caller, not this service. */
  private readonly suppliedPageClient?: StoryPageClient;
  private pageClient?: StoryPageClient;
  private huliwangCompanion?: HuliwangCompanionSession;
  private huliwangCompanionSite?: BrowserCompanionSite;
  private huliwangCompanionReady = false;
  private companionPairingInProgress = false;
  private active?: ActiveOperation;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private closed = false;

  public constructor(private readonly options: StorySourceServiceOptions = {}) {
    this.profileDirectory = options.profileDirectory
      ?? path.join(os.tmpdir(), "tool-dich-truyen-story-source-profile");
    this.minRequestIntervalMs = Math.min(10_000, Math.max(0, options.minRequestIntervalMs ?? 650));
    this.verificationWaitMs = Math.min(60_000, Math.max(0, options.verificationWaitMs ?? 30_000));
    this.manualVerificationWaitMs = Math.min(10 * 60_000, Math.max(0, options.manualVerificationWaitMs ?? 3 * 60_000));
    // Huliwang currently renders 50 chapters per catalog page.  One hundred
    // pages lets a normal book expose up to roughly 5,000 entries while the
    // explicit hard cap still prevents an unbounded hostile pager.
    this.maxCatalogPages = boundedPositiveInteger(options.maxCatalogPages, 100, 200);
    this.maxChapterPages = boundedPositiveInteger(options.maxChapterPages, 12, 50);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.suppliedPageClient = options.pageClient;
    this.pageClient = options.pageClient;
    this.decoders = [...(options.textDecoders ?? [new TimotxtF24092Decoder()])];
  }

  public onProgress(listener: StoryProgressListener): () => void {
    this.emitter.on("progress", listener);
    return () => this.emitter.off("progress", listener);
  }

  public async analyzeUrl(url: string): Promise<StorySourceAnalysis> {
    this.assertOpen();
    const parsed = parseStoryUrl(url);
    const analysisId = randomUUID();
    const controller = this.begin(analysisId);
    this.emit({ analysisId, phase: "opening", completed: 0, total: 0, message: "Đang mở nguồn truyện…" });
    try {
      const runtime = await this.runtime(controller.signal, analysisId, parsed.site);
      this.emit({ analysisId, phase: "catalog", completed: 0, total: 0, message: "Đang đọc mục lục…" });
      const data = await adapterFor(parsed.site).analyze(parsed, runtime);
      this.throwIfAborted(controller.signal);
      const chapters = data.chapters.map((chapter): StoryChapterReference => {
        const selectedByDefault = parsed.kind === "chapter"
          ? chapter.partUrls.some((partUrl) => parseStoryUrl(partUrl).chapterKey === parsed.chapterKey)
          : !chapter.isIntroduction;
        return { ...chapter, selectedByDefault };
      });
      const defaultSelectedChapterIds = chapters
        .filter((chapter) => chapter.selectedByDefault)
        .map((chapter) => chapter.id);
      if (parsed.kind === "chapter" && defaultSelectedChapterIds.length !== 1) {
        throw new StorySourceError("SOURCE_CHANGED", "Chương trong URL không xuất hiện đúng một lần trong mục lục.");
      }
      const analysis: StorySourceAnalysis = {
        analysisId,
        site: parsed.site,
        inputKind: parsed.kind,
        inputUrl: parsed.inputUrl,
        bookId: parsed.bookId,
        bookTitle: data.bookTitle,
        ...(data.author ? { author: data.author } : {}),
        bookUrl: parsed.bookUrl,
        catalogUrl: parsed.catalogUrl,
        chapters,
        defaultSelectedChapterIds,
        verification: "not-needed",
        notices: data.notices,
      };
      this.analyses.set(analysisId, analysis);
      while (this.analyses.size > 20) {
        const oldest = this.analyses.keys().next().value as string | undefined;
        if (!oldest) break;
        this.analyses.delete(oldest);
      }
      this.emit({
        analysisId,
        phase: "completed",
        completed: chapters.length,
        total: chapters.length,
        message: `Đã phân tích ${chapters.length} chương.`,
      });
      return cloneAnalysis(analysis);
    } catch (error) {
      this.emitTerminalError(analysisId, error);
      throw error;
    } finally {
      this.end(controller);
    }
  }

  /**
   * Opens a tool-owned loopback pairing page in the person's OS-default daily
   * browser and waits for the narrowly scoped companion extension. After
   * pairing, snapshots come from that ordinary browser/profile; no browser
   * cookies, credentials, CDP access, or arbitrary proxy are exposed.
   */
  public async openManualVerification(rawUrl: string): Promise<void> {
    this.assertOpen();
    if (this.active || this.companionPairingInProgress) {
      throw new Error("Đang có một thao tác nguồn truyện khác; hãy chờ hoặc hủy trước khi mở xác minh thủ công.");
    }

    const parsed = parseStoryUrl(rawUrl);
    if (!isBrowserCompanionSite(parsed.site)) {
      throw new StorySourceError(
        "UNSUPPORTED_URL",
        "Kết nối trình duyệt mặc định chỉ hỗ trợ link Huliwang, XSZJ hoặc Novel543 hợp lệ.",
      );
    }
    const companionSite = parsed.site;

    this.companionPairingInProgress = true;
    let session: HuliwangCompanionSession | undefined;
    try {
      // Never keep the Playwright source context alive while pairing the
      // person's actual daily browser.
      await this.releasePageClient();
      const previous = this.huliwangCompanion;
      this.huliwangCompanion = undefined;
      this.huliwangCompanionSite = undefined;
      this.huliwangCompanionReady = false;
      await previous?.close();

      const factory = this.options.huliwangCompanionFactory
        ?? (() => startHuliwangBrowserBridge({ site: companionSite }));
      session = await factory();
      this.huliwangCompanion = session;
      const launcher = this.options.manualVerificationLauncher ?? defaultManualVerificationLauncher;
      await launcher({ url: session.pairingUrl });
      // Resolve only after the extension proves possession of the session
      // token. The renderer may immediately retry Analyze after this returns.
      await session.waitUntilPaired();
      if (this.closed || this.huliwangCompanion !== session) {
        throw new StorySourceError("CANCELLED", `Phiên ghép nối ${browserCompanionSiteLabel(companionSite)} đã đóng.`);
      }
      this.huliwangCompanionSite = companionSite;
      this.huliwangCompanionReady = true;
    } catch (error) {
      if (session && this.huliwangCompanion === session) {
        this.huliwangCompanion = undefined;
        this.huliwangCompanionSite = undefined;
        this.huliwangCompanionReady = false;
      }
      await session?.close().catch(() => undefined);
      throw error;
    } finally {
      this.companionPairingInProgress = false;
    }
  }

  public async fetchChapters(request: FetchStoryChaptersRequest): Promise<StoryFetchResult> {
    this.assertOpen();
    if (!request || typeof request.analysisId !== "string" || !Array.isArray(request.chapterIds)) {
      throw new TypeError("Yêu cầu tải chương không hợp lệ.");
    }
    if (!request.chapterIds.length) throw new RangeError("Cần chọn ít nhất một chương.");
    if (request.chapterIds.length > 10_000) throw new RangeError("Chỉ có thể tải tối đa 10.000 chương mỗi lần.");
    const analysis = this.analyses.get(request.analysisId);
    if (!analysis) throw new StorySourceError("ANALYSIS_NOT_FOUND", "Phiên phân tích không còn tồn tại; hãy phân tích lại URL.");
    const ids = new Set(request.chapterIds);
    if (ids.size !== request.chapterIds.length) throw new TypeError("Danh sách chương bị trùng ID.");
    const byId = new Map(analysis.chapters.map((chapter) => [chapter.id, chapter]));
    const chapters = request.chapterIds.map((id) => {
      const chapter = byId.get(id);
      if (!chapter) throw new TypeError(`ID chương không thuộc phiên phân tích: ${id.slice(0, 120)}`);
      return chapter;
    }).sort((left, right) => left.order - right.order);
    const controller = this.begin(analysis.analysisId);
    try {
      const runtime = await this.runtime(controller.signal, analysis.analysisId, analysis.site);
      const fetched = [];
      for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        if (!chapter) continue;
        this.throwIfAborted(controller.signal);
        this.emit({
          analysisId: analysis.analysisId,
          phase: "fetching",
          completed: index,
          total: chapters.length,
          chapterId: chapter.id,
          message: `Đang tải ${chapter.numberLabel} ${chapter.title}`.trim(),
        });
        const content = await adapterFor(analysis.site).fetch(analysis, chapter, runtime);
        this.throwIfAborted(controller.signal);
        fetched.push(content);
        this.emit({
          analysisId: analysis.analysisId,
          phase: "validating",
          completed: index + 1,
          total: chapters.length,
          chapterId: chapter.id,
          message: `Đã kiểm tra ${index + 1}/${chapters.length} chương.`,
        });
      }
      const outputNumbers = assignOutputChapterNumbers(fetched);
      const combinedSource = fetched
        .map((chapter, index) => `${chapterHeader(chapter, outputNumbers[index] ?? index + 1)}\n\n${chapter.sourceText}`)
        .join("\n\n");
      const warnings = fetched.flatMap((chapter) => chapter.warnings.map((warning) => `${chapter.title}: ${warning}`));
      const result: StoryFetchResult = {
        analysisId: analysis.analysisId,
        site: analysis.site,
        bookId: analysis.bookId,
        bookTitle: analysis.bookTitle,
        chapters: fetched,
        combinedSource,
        warnings,
      };
      this.emit({
        analysisId: analysis.analysisId,
        phase: "completed",
        completed: fetched.length,
        total: chapters.length,
        message: `Đã tải và kiểm tra ${fetched.length} chương.`,
      });
      // The source browser has done its job. Close its complete Edge context
      // before the renderer starts a potentially long ChatGPT translation so
      // the two persistent Chromium profiles do not compete for RAM/GPU. The
      // analysis and the fully checked fetched text stay in memory; a later
      // Analyze/Tải operation lazily opens a fresh source context.
      await this.releasePageClient();
      return result;
    } catch (error) {
      this.emitTerminalError(analysis.analysisId, error);
      throw error;
    } finally {
      this.end(controller);
    }
  }

  public async cancel(analysisId?: string): Promise<void> {
    if (!this.active || (analysisId && this.active.analysisId !== analysisId)) return;
    this.active.controller.abort(new StorySourceError("CANCELLED", "Đã hủy thao tác nguồn truyện."));
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.active?.controller.abort(new StorySourceError("CANCELLED", "Dịch vụ nguồn truyện đã đóng."));
    const client = this.pageClient;
    this.pageClient = undefined;
    const companion = this.huliwangCompanion;
    this.huliwangCompanion = undefined;
    this.huliwangCompanionSite = undefined;
    this.huliwangCompanionReady = false;
    await Promise.all([client?.close?.(), companion?.close()]);
    this.emitter.removeAllListeners();
    this.analyses.clear();
  }

  private async runtime(
    signal: AbortSignal,
    analysisId: string,
    site: StorySourceAnalysis["site"],
  ): Promise<AdapterRuntime> {
    let client: StoryPageClient;
    if (isBrowserCompanionSite(site)) {
      if (this.hasBrowserCompanionFor(site)) {
        client = this.huliwangCompanion!.client;
      } else if (this.suppliedPageClient) {
        // Explicitly supplied clients are retained as a deterministic adapter
        // test boundary. Production never supplies one here.
        client = this.suppliedPageClient;
      } else {
        // Never launch Playwright for either companion-only source, even for
        // an initial probe. Cloudflare can classify that browser before the
        // ordinary daily profile gets a chance to load. The renderer offers
        // pairing and retries Analyze after the real default browser connects.
        throw new StorySourceError(
          "USER_ACTION_REQUIRED",
          browserCompanionRequiredMessage(site),
        );
      }
    } else {
      client = await this.getClient();
    }
    return {
      client,
      signal,
      reportCatalogProgress: (completed, message) => {
        this.emit({
          analysisId,
          phase: "catalog",
          completed,
          total: 0,
          message,
        });
      },
      // Do not capture `client` here. A factory-owned Playwright context can
      // disappear while an adapter is visiting a multi-page chapter; each
      // navigation must resolve the currently live client instead.
      visit: (url) => this.visit(url, signal, analysisId),
      ...(client.advanceCatalogPage ? {
        advanceCatalogPage: (currentUrl: string) => this.advanceCatalogPage(currentUrl, signal, analysisId),
      } : {}),
      ...(client.advanceChapterPage ? {
        advanceChapterPage: (currentUrl: string) => this.advanceChapterPage(currentUrl, signal, analysisId),
      } : {}),
      ...(client.transcode ? {
        transcode: async (request, requestSignal) => {
          await this.throttle(signal);
          const response = await client.transcode!(request, requestSignal ?? signal);
          this.lastRequestAt = this.now();
          return response;
        },
      } : {}),
      maxCatalogPages: this.maxCatalogPages,
      maxChapterPages: this.maxChapterPages,
      decoders: this.decoders,
    };
  }

  private async getClient(): Promise<StoryPageClient> {
    if (this.pageClient) return this.pageClient;
    if (this.suppliedPageClient) {
      this.pageClient = this.suppliedPageClient;
      return this.pageClient;
    }
    const factory = this.options.pageClientFactory ?? createPlaywrightStoryPageClient;
    this.pageClient = await factory({
      profileDirectory: this.profileDirectory,
      executablePath: this.options.executablePath,
      headless: this.options.headless ?? true,
    });
    return this.pageClient;
  }

  private async releasePageClient(): Promise<void> {
    // A passed-in client is deliberately kept alive for its owner (and for
    // deterministic tests). Production uses a factory-created context, which
    // is safe and necessary to release between source import and translation.
    if (this.suppliedPageClient) return;
    const client = this.pageClient;
    this.pageClient = undefined;
    await client?.close?.().catch(() => undefined);
  }

  private async visit(url: string, signal: AbortSignal, analysisId: string) {
    this.throwIfAborted(signal);
    await this.throttle(signal);
    const parsed = parseStoryUrl(url);
    let snapshot: StoryPageSnapshot | undefined;
    try {
      snapshot = await this.visitSnapshot(url, signal);
    } catch (error) {
      if (parsed.site !== "c6k6" || !isPageNavigationTimeout(error)) throw error;
      let lastError: unknown = error;
      for (let retry = 1; retry <= 3; retry += 1) {
        this.emit({
          analysisId,
          phase: "opening",
          completed: 0,
          total: 0,
          message: `C6K6 tải trang quá lâu; đang kiểm tra và thử lại ${retry}/3…`,
        });
        try {
          const current = await this.inspectCurrentSnapshot(url, signal);
          const actual = parseStoryUrl(current.url);
          if (
            current.challenge === "none"
            && actual.site === "c6k6"
            && actual.bookId === parsed.bookId
            && current.bodyText.trim().length >= 40
          ) {
            snapshot = current;
            break;
          }
        } catch (inspectionError) {
          lastError = inspectionError;
        }
        await this.sleep(1_500, signal);
        try {
          snapshot = await this.visitSnapshot(url, signal);
          break;
        } catch (retryError) {
          lastError = retryError;
          if (!isPageNavigationTimeout(retryError)) throw retryError;
        }
      }
      if (!snapshot) throw lastError;
    }
    if (parsed.site === "c6k6" && snapshot.status !== undefined && snapshot.status >= 500) {
      for (let retry = 1; retry <= 9 && snapshot.status !== undefined && snapshot.status >= 500; retry += 1) {
        this.emit({
          analysisId,
          phase: "opening",
          completed: 0,
          total: 0,
          message: `C6K6 tạm trả HTTP ${snapshot.status}; đang thử lại ${retry}/9…`,
        });
        await this.sleep(1_200, signal);
        snapshot = await this.visitSnapshot(url, signal);
      }
    }
    const companionReady = isBrowserCompanionSite(parsed.site) && this.hasBrowserCompanionFor(parsed.site);
    if ((parsed.site === "huliwang" || parsed.site === "xszj" || parsed.site === "czbooks" || parsed.site === "novel543") && snapshot.challenge === "passive") {
      this.emit({ analysisId, phase: "verification", completed: 0, total: 0, message: "Đang chờ Cloudflare xác minh thụ động…" });
      // Cloudflare's automatic check does not have a stable duration. Sample
      // the current page rather than navigating to the URL again: a reload
      // restarts its verification JavaScript. No checkbox, challenge iframe
      // or CAPTCHA is clicked by the tool.
      // CZBooks can trigger a longer passive Cloudflare cooldown only after a
      // dozen chapter navigations. Keep inspecting the same tab for the same
      // bounded window used by its visible manual-verification flow; reloading
      // here would restart the challenge and lose the in-flight chapter.
      let remainingWaitMs = parsed.site === "czbooks" || parsed.site === "novel543"
        ? this.manualVerificationWaitMs
        : this.verificationWaitMs;
      while (snapshot.challenge === "passive" && remainingWaitMs > 0) {
        const iterationStartedAt = Date.now();
        const waitMs = Math.min(2_000, remainingWaitMs);
        await this.sleep(waitMs, signal);
        try {
          snapshot = await this.inspectCurrentSnapshot(url, signal);
        } catch (error) {
          if (!isTransientPageTransition(error)) throw error;
          // Cloudflare can replace its verification document between the DOM
          // lookup and page.evaluate. Keep the same tab and sample it again;
          // reloading here would restart the verification.
        }
        // Preserve deterministic fake-clock tests while also charging slow
        // extension/DOM collection against the real verification budget.
        remainingWaitMs -= Math.max(waitMs, Date.now() - iterationStartedAt);
      }
      if (snapshot.challenge === "passive") {
        // Close only a Playwright-controlled context. A paired default-browser
        // companion stays alive so the user can finish a visible check without
        // losing the ordinary tab/profile.
        if (!companionReady && parsed.site !== "novel543") await this.releasePageClient();
        throw new StorySourceError(
          "SOURCE_BLOCKED",
          parsed.site === "huliwang" && companionReady
            ? "Cloudflare chưa hoàn tất kiểm tra trong trình duyệt mặc định. Hãy giữ tab Huliwang mở, chờ trang hiện nội dung rồi bấm Phân tích lại."
            : parsed.site === "xszj" && companionReady
              ? "Cloudflare chưa hoàn tất kiểm tra trong trình duyệt mặc định. Hãy giữ tab XSZJ/爱下电子书 mở, chờ trang hiện nội dung rồi bấm Phân tích lại."
            : parsed.site === "novel543" && companionReady
              ? "Cloudflare chưa hoàn tất kiểm tra trong trình duyệt mặc định. Hãy giữ tab Novel543 mở, chờ trang hiện nội dung rồi bấm Phân tích lại."
            : parsed.site === "xszj"
              ? "XSZJ/爱下电子书 vẫn đang xác minh thụ động. Tool đã giữ nguyên trang, chờ ngắn rồi mới dừng; hãy chờ trang hiện nội dung rồi bấm Phân tích lại."
              : parsed.site === "czbooks"
                ? "CZBooks chưa hoàn tất xác minh thụ động. Tool đã giữ nguyên trang trong thời gian chờ và không nhận trang Cloudflare làm nội dung truyện."
              : parsed.site === "novel543"
                ? "Novel543 chưa hoàn tất xác minh thụ động. Tool vẫn giữ nguyên cửa sổ và đúng trang đang tải; hãy chờ trang hiện nội dung rồi bấm lại thao tác."
              : "Cloudflare chưa hoàn tất xác minh thụ động. Tool đã đóng phiên đọc tự động; hãy bấm Kết nối trình duyệt mặc định để đọc Huliwang bằng đúng trình duyệt và hồ sơ bạn thường dùng.",
        );
      }
    }
    if ((parsed.site === "czbooks" || parsed.site === "novel543") && snapshot.challenge === "interactive") {
      const sourceName = parsed.site === "novel543" ? "Novel543" : "CZBooks";
      this.emit({
        analysisId,
        phase: "verification",
        completed: 0,
        total: 0,
        message: `${sourceName} đang yêu cầu xác minh trong cửa sổ đọc nguồn. Hãy bấm ô xác minh; tool đang giữ nguyên đúng trang và sẽ tự tiếp tục ngay khi được duyệt…`,
      });
      let remainingWaitMs = this.manualVerificationWaitMs;
      while (snapshot.challenge !== "none" && remainingWaitMs > 0) {
        const iterationStartedAt = Date.now();
        const waitMs = Math.min(1_000, remainingWaitMs);
        await this.sleep(waitMs, signal);
        try {
          snapshot = await this.inspectCurrentSnapshot(url, signal);
        } catch (error) {
          if (!isTransientPageTransition(error)) throw error;
        }
        remainingWaitMs -= Math.max(waitMs, Date.now() - iterationStartedAt);
      }
      if (snapshot.challenge !== "none") {
        const message = `${sourceName} vẫn đang chờ xác minh. Tool đã giữ nguyên cửa sổ và đúng trang nguồn; hãy hoàn tất thao tác Cloudflare rồi bấm lại Phân tích hoặc Tải, dịch và lưu. Tool không tự bấm hay giải CAPTCHA.`;
        this.emit({ analysisId, phase: "verification", completed: 0, total: 0, message });
        // Deliberately keep the factory-owned visible page alive. A retry can
        // reuse the same persistent profile/cookie instead of opening browser
        // windows repeatedly or throwing away the user's completed check.
        throw new StorySourceError("USER_ACTION_REQUIRED", message);
      }
      this.emit({
        analysisId,
        phase: "verification",
        completed: 0,
        total: 0,
        message: `${sourceName} đã xác minh xong; đang tiếp tục lấy đúng chương đang tải…`,
      });
    }
    if (snapshot.challenge === "interactive") {
      const message = parsed.site === "huliwang" && companionReady
        ? "Cloudflare yêu cầu thao tác trong tab Huliwang của trình duyệt mặc định. Tool không tự bấm CAPTCHA/Turnstile; hãy hoàn tất bằng tay rồi bấm Phân tích lại."
        : parsed.site === "xszj" && companionReady
          ? "Cloudflare yêu cầu thao tác trong tab XSZJ/爱下电子书 của trình duyệt mặc định. Tool không tự bấm CAPTCHA/Turnstile; hãy hoàn tất bằng tay rồi bấm Phân tích lại."
          : parsed.site === "novel543" && companionReady
            ? "Cloudflare yêu cầu thao tác trong tab Novel543 của trình duyệt mặc định. Tool không tự bấm CAPTCHA/Turnstile; hãy hoàn tất bằng tay rồi bấm Phân tích lại."
          : parsed.site === "xszj"
          ? "XSZJ/爱下电子书 yêu cầu xác minh thủ công. Tool không tự bấm CAPTCHA/Turnstile; hãy hoàn tất trong trình duyệt rồi bấm Phân tích lại."
          : "Cloudflare không chấp nhận và tool đã đóng phiên đọc tự động; tool không bấm CAPTCHA/Turnstile. Hãy bấm Kết nối trình duyệt mặc định để Huliwang được mở bằng đúng trình duyệt và hồ sơ bạn thường dùng.";
      if (!companionReady) await this.releasePageClient();
      this.emit({ analysisId, phase: "verification", completed: 0, total: 0, message });
      throw new StorySourceError("USER_ACTION_REQUIRED", message);
    }
    if (parsed.site === "uaa002" && parsed.kind === "chapter" && isUaaLoginLocked(snapshot)) {
      this.emit({
        analysisId,
        phase: "verification",
        completed: 0,
        total: 0,
        message: "UAA đang yêu cầu đăng nhập. Hãy đăng nhập trong cửa sổ đọc nguồn và quay lại đúng chương; tool đang giữ nguyên phiên và sẽ tự tiếp tục…",
      });
      let remainingWaitMs = this.manualVerificationWaitMs;
      while (remainingWaitMs > 0) {
        const iterationStartedAt = Date.now();
        const waitMs = Math.min(1_000, remainingWaitMs);
        await this.sleep(waitMs, signal);
        const current = await this.inspectCurrentSnapshot(url, signal);
        remainingWaitMs -= Math.max(waitMs, Date.now() - iterationStartedAt);
        try {
          const currentUrl = parseStoryUrl(current.url);
          if (
            currentUrl.site === "uaa002"
            && currentUrl.kind === "chapter"
            && currentUrl.bookId === parsed.bookId
            && currentUrl.chapterKey === parsed.chapterKey
            && !isUaaLoginLocked(current)
          ) {
            snapshot = current;
            this.emit({
              analysisId,
              phase: "verification",
              completed: 0,
              total: 0,
              message: "UAA đã đăng nhập; đang tiếp tục lấy truyện…",
            });
            break;
          }
        } catch {
          // The user may temporarily be on UAA's login route. Keep waiting for
          // the same requested chapter; never accept the login page as prose.
        }
      }
      if (isUaaLoginLocked(snapshot)) {
        const message = "UAA vẫn đang khóa nội dung. Tool đã giữ nguyên cửa sổ và hồ sơ đăng nhập; hãy đăng nhập, quay lại chương đang mở rồi bấm Tải, dịch và lưu lần nữa.";
        this.emit({ analysisId, phase: "verification", completed: 0, total: 0, message });
        throw new StorySourceError("USER_ACTION_REQUIRED", message);
      }
    }
    return snapshot;
  }

  /**
   * Advance only Huliwang's already-visible JavaScript catalog pager in the
   * paired everyday browser.  This is deliberately not a generic click or a
   * guessed page URL.  The companion exposes it only after it has observed
   * the exact catalog and its enabled #nextPage control.
   */
  private async advanceCatalogPage(url: string, signal: AbortSignal, analysisId: string) {
    this.throwIfAborted(signal);
    const parsed = parseStoryUrl(url);
    if (parsed.site !== "huliwang" || parsed.kind !== "catalog") {
      throw new StorySourceError("UNSUPPORTED_URL", "Chỉ có thể sang trang trong mục lục Huliwang đang mở.");
    }
    await this.throttle(signal);
    const client = await this.clientForUrl(parsed.normalizedUrl);
    if (!client.advanceCatalogPage) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        "Tiện ích trình duyệt hiện tại chưa hỗ trợ nút sang trang JavaScript của Huliwang; hãy cập nhật tiện ích rồi Phân tích lại.",
      );
    }

    let snapshot = await client.advanceCatalogPage(parsed.normalizedUrl, signal);
    this.throwIfAborted(signal);
    this.lastRequestAt = this.now();

    // An in-place catalog click normally leaves Cloudflare alone.  If the
    // site does show its passive verification again, sample the same paired
    // tab without re-navigating so that verification is never reset.
    if (snapshot.challenge === "passive") {
      this.emit({ analysisId, phase: "verification", completed: 0, total: 0, message: "Đang chờ Cloudflare xác minh thụ động…" });
      let remainingWaitMs = this.verificationWaitMs;
      while (snapshot.challenge === "passive" && remainingWaitMs > 0) {
        const iterationStartedAt = Date.now();
        const waitMs = Math.min(2_000, remainingWaitMs);
        await this.sleep(waitMs, signal);
        snapshot = await this.inspectCurrentSnapshot(parsed.normalizedUrl, signal);
        remainingWaitMs -= Math.max(waitMs, Date.now() - iterationStartedAt);
      }
      if (snapshot.challenge === "passive") {
        throw new StorySourceError(
          "SOURCE_BLOCKED",
          "Cloudflare chưa hoàn tất kiểm tra trong trình duyệt mặc định. Hãy giữ tab Huliwang mở, chờ nội dung hiện ra rồi Phân tích lại.",
        );
      }
    }
    if (snapshot.challenge === "interactive") {
      throw new StorySourceError(
        "USER_ACTION_REQUIRED",
        "Cloudflare yêu cầu thao tác trong tab Huliwang của trình duyệt mặc định. Tool không tự bấm CAPTCHA/Turnstile; hãy hoàn tất bằng tay rồi Phân tích lại.",
      );
    }
    return snapshot;
  }

  /**
   * Advance one already verified Huliwang reader page.  The paired companion
   * owns the only permitted DOM action; this method neither guesses a URL nor
   * lets callers choose a selector.  Its bridge checks the same chapter and
   * an exact one-page increment before returning a snapshot.
   */
  private async advanceChapterPage(url: string, signal: AbortSignal, analysisId: string) {
    this.throwIfAborted(signal);
    const parsed = parseStoryUrl(url);
    if (parsed.site !== "huliwang" || parsed.kind !== "chapter") {
      throw new StorySourceError("UNSUPPORTED_URL", "Chỉ có thể sang trang trong chương Huliwang đang mở.");
    }
    await this.throttle(signal);
    const client = await this.clientForUrl(parsed.normalizedUrl);
    if (!client.advanceChapterPage) {
      throw new StorySourceError(
        "SOURCE_CHANGED",
        "Tiện ích trình duyệt hiện tại chưa hỗ trợ nút sang trang trong chương Huliwang; hãy cập nhật tiện ích rồi thử lại.",
      );
    }

    let snapshot = await client.advanceChapterPage(parsed.normalizedUrl, signal);
    this.throwIfAborted(signal);
    this.lastRequestAt = this.now();

    if (snapshot.challenge === "passive") {
      this.emit({ analysisId, phase: "verification", completed: 0, total: 0, message: "Đang chờ Cloudflare xác minh thụ động…" });
      let remainingWaitMs = this.verificationWaitMs;
      while (snapshot.challenge === "passive" && remainingWaitMs > 0) {
        const iterationStartedAt = Date.now();
        const waitMs = Math.min(2_000, remainingWaitMs);
        await this.sleep(waitMs, signal);
        snapshot = await this.inspectCurrentSnapshot(parsed.normalizedUrl, signal);
        remainingWaitMs -= Math.max(waitMs, Date.now() - iterationStartedAt);
      }
      if (snapshot.challenge === "passive") {
        throw new StorySourceError(
          "SOURCE_BLOCKED",
          "Cloudflare chưa hoàn tất kiểm tra trong trình duyệt mặc định. Hãy giữ tab Huliwang mở, chờ nội dung hiện ra rồi thử lại.",
        );
      }
    }
    if (snapshot.challenge === "interactive") {
      throw new StorySourceError(
        "USER_ACTION_REQUIRED",
        "Cloudflare yêu cầu thao tác trong tab Huliwang của trình duyệt mặc định. Tool không tự bấm CAPTCHA/Turnstile; hãy hoàn tất bằng tay rồi thử lại.",
      );
    }
    return snapshot;
  }

  /**
   * Retry a single exact navigation after replacing a service-owned client
   * that Playwright says has already closed.  This deliberately does not
   * recover caller-supplied clients, does not widen the URL, and does not
   * interact with any Cloudflare/Turnstile UI.
   */
  private async visitSnapshot(url: string, signal: AbortSignal) {
    const visitWith = async (client: StoryPageClient) => {
      const snapshot = await client.visit(url, signal);
      this.throwIfAborted(signal);
      this.lastRequestAt = this.now();
      return snapshot;
    };

    const client = await this.clientForUrl(url);
    try {
      return await visitWith(client);
    } catch (error) {
      // An abort can make Playwright report a closed target too. Preserve the
      // cancellation rather than opening a replacement browser in that case.
      this.throwIfAborted(signal);
      if (this.suppliedPageClient || this.isCompanionClient(client) || !isClosedPageClientError(error)) throw error;

      await this.discardClosedFactoryClient(client);

      this.throwIfAborted(signal);
      // Exactly one retry, on the same already-allow-listed URL. Any failure
      // from this replacement client is intentionally surfaced unchanged,
      // except for the same closed-context condition, which has a useful
      // recovery instruction for the renderer instead of raw Playwright text.
      const replacement = await this.getClient();
      try {
        return await visitWith(replacement);
      } catch (retryError) {
        this.throwIfAborted(signal);
        if (!isClosedPageClientError(retryError)) throw retryError;
        await this.discardClosedFactoryClient(replacement);
        throw new StorySourceError(
          "SOURCE_BLOCKED",
          "Phiên trình duyệt đọc nguồn vừa bị đóng; hãy bấm “Phân tích lại” để tạo phiên mới.",
          { cause: retryError },
        );
      }
    }
  }

  /**
   * Reads a passive-verification page without reloading it. Legacy injected
   * clients that cannot inspect an existing page retain the historical visit
   * fallback; the production Playwright client always supports inspection.
   */
  private async inspectCurrentSnapshot(url: string, signal: AbortSignal) {
    const client = await this.clientForUrl(url);
    if (!client.inspectCurrent) return this.visitSnapshot(url, signal);
    try {
      const snapshot = await client.inspectCurrent(signal);
      this.throwIfAborted(signal);
      return snapshot;
    } catch (error) {
      // A context can disappear while Cloudflare is verifying. A new context
      // has no page to inspect, so resume with precisely one safe navigation
      // through the established closed-client recovery path.
      this.throwIfAborted(signal);
      if (this.suppliedPageClient || this.isCompanionClient(client) || !isClosedPageClientError(error)) throw error;
      await this.discardClosedFactoryClient(client);
      return this.visitSnapshot(url, signal);
    }
  }

  private async discardClosedFactoryClient(client: StoryPageClient): Promise<void> {
    if (this.pageClient !== client) return;
    this.pageClient = undefined;
    await client.close?.().catch(() => undefined);
  }

  private async clientForUrl(url: string): Promise<StoryPageClient> {
    const parsed = parseStoryUrl(url);
    if (isBrowserCompanionSite(parsed.site)) {
      if (this.hasBrowserCompanionFor(parsed.site)) return this.huliwangCompanion!.client;
      if (this.suppliedPageClient) return this.suppliedPageClient;
      throw new StorySourceError("USER_ACTION_REQUIRED", browserCompanionRequiredMessage(parsed.site));
    }
    return this.getClient();
  }

  private hasBrowserCompanionFor(site: BrowserCompanionSite): boolean {
    return this.huliwangCompanionReady
      && this.huliwangCompanionSite === site
      && Boolean(this.huliwangCompanion);
  }

  private isCompanionClient(client: StoryPageClient): boolean {
    return this.huliwangCompanion?.client === client;
  }

  private async throttle(signal: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const wait = Math.max(0, this.lastRequestAt + this.minRequestIntervalMs - this.now());
    if (wait) await this.sleep(wait, signal);
    this.throwIfAborted(signal);
  }

  private begin(analysisId: string): AbortController {
    if (this.companionPairingInProgress) {
      throw new Error("Đang ghép nối trình duyệt Huliwang; hãy chờ thao tác hoàn tất.");
    }
    if (this.active) throw new Error("Đang có một thao tác nguồn truyện khác; hãy chờ hoặc hủy trước.");
    const controller = new AbortController();
    this.active = { analysisId, controller };
    return controller;
  }

  private end(controller: AbortController): void {
    if (this.active?.controller === controller) this.active = undefined;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Dịch vụ nguồn truyện đã đóng.");
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason ?? new StorySourceError("CANCELLED", "Đã hủy thao tác nguồn truyện.");
  }

  private emit(progress: StorySourceProgress): void {
    this.emitter.emit("progress", { ...progress });
  }

  private emitTerminalError(analysisId: string, error: unknown): void {
    this.emit({
      analysisId,
      phase: isCancellation(error) ? "cancelled" : "failed",
      completed: 0,
      total: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
