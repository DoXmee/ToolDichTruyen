import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Locator, Page, Response } from "playwright-core";
import type { AiProvider } from "../../shared/types.js";
import {
  FileConversationStateStore,
  VolatileConversationStateStore,
  type ConversationStateStore,
  type ToolCreatedConversation,
} from "./conversationState.js";
import {
  MAX_CONVERSATION_OWNERSHIP_HASHES,
  appendOwnershipMetadata,
  containsOwnershipHash,
  createOwnershipMarker,
  ownershipMarkerHash,
} from "./ownershipMarker.js";
import { CHATGPT_SELECTORS, KIMI_SELECTORS, type ChatWebSelectors } from "./selectors.js";

export type ChatGptWebStatus =
  | "closed"
  | "opening"
  | "login-required"
  | "ready"
  | "busy"
  | "error";

export interface ChatGptStatusSnapshot {
  status: ChatGptWebStatus;
  message?: string;
}

export interface SendMessageOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ChatGptGenerationStopError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptGenerationStopError";
  }
}

/**
 * The prior tool-controlled browser context was closed after ChatGPT kept
 * showing Stop (or the Stop click failed), and its local conversation pointer
 * was cleared.  A caller may safely create a fresh tool chat before sending
 * the affected work again.  This deliberately does not extend
 * `ChatGptGenerationStopError`: the old context is no longer available for a
 * later prompt to overlap with its stuck response.
 */
export class ChatGptFreshChatRecoveryError extends Error {
  public readonly safeForFreshChatRecovery = true;

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptFreshChatRecoveryError";
  }
}

/** A safety failure for which replaying the prompt could duplicate or leak it. */
export class ChatGptNonRetryableSafetyError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptNonRetryableSafetyError";
  }
}

/** The prompt was submitted, but ownership of the resulting chat was not proven. */
export class ChatGptConversationVerificationError extends ChatGptNonRetryableSafetyError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptConversationVerificationError";
  }
}

/**
 * A persisted tool conversation still has a valid URL/ID, but its ownership
 * marker is no longer rendered by ChatGPT. This is deliberately distinct
 * from malformed state and destructive-action failures: the old chat must be
 * left untouched, while a new translation may safely begin in a clean chat.
 */
class ChatGptOwnershipMarkerUnavailableError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptOwnershipMarkerUnavailableError";
  }
}

/**
 * ChatGPT rendered the exact, verified tool conversation, but one of the
 * controls required to clean it up was absent from the current DOM. This is
 * recoverable only before any destructive click is attempted: leave the
 * remote conversation untouched, forget the local pointer and use a new root
 * conversation. Click/action errors intentionally stay ordinary errors so a
 * navigation race or a partially executed destructive action still fails
 * closed.
 */
export class ChatGptConversationCleanupUnavailableError extends Error {
  public constructor(
    public readonly stage: "menu" | "delete-action" | "confirmation",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChatGptConversationCleanupUnavailableError";
  }
}

/**
 * A failed destructive click can be transient while ChatGPT is rearranging its
 * menu or confirmation dialog. Re-open the exact verified conversation once
 * before giving up on remote cleanup. This limit applies only to cleanup; it
 * never replays a translation prompt.
 */
const MAX_TOOL_CONVERSATION_CLEANUP_ATTEMPTS = 2;
// Kimi renders the anonymous composer before its login controls finish
// hydrating. Without this short confirmation window, a signed-out page can be
// reported as ready and fail only when the runner creates its first chat.
const KIMI_AUTHENTICATION_STABILIZATION_MS = 1_500;
const KIMI_CAPACITY_RETRY_INTERVAL_MS = 15_000;
const KIMI_CONCURRENCY_DIALOG_SELECTORS = [
  '[role="dialog"]:has-text("already have several chats open")',
  '[role="dialog"]:has-text("Please wait for them to finish")',
  '.n-modal:has-text("already have several chats open")',
] as const;
const KIMI_CONCURRENCY_DISMISS_SELECTORS = [
  '[role="dialog"] button:has-text("Got it")',
  '.n-modal button:has-text("Got it")',
] as const;
const KIMI_INSTANT_HIGH_SELECTORS = [
  'text=Instant High',
  ':text-is("Instant High")',
] as const;
const KIMI_THINKING_EFFORT_SELECTORS = [
  'text=Thinking effort',
  ':text-is("Thinking effort")',
] as const;
const KIMI_STANDARD_EFFORT_SELECTORS = [
  ':text-is("Standard")',
  'text=Standard',
] as const;

interface BrowserFactoryOptions {
  profileDirectory: string;
  headless: boolean;
  executablePath?: string;
}

export type BrowserFactory = (options: BrowserFactoryOptions) => Promise<BrowserContext>;

export interface ManualLoginSession {
  readonly closed: Promise<void>;
  isRunning(): boolean;
  close(): Promise<void>;
}

export type ManualLoginFactory = (options: {
  profileDirectory: string;
  url: string;
  executablePath?: string;
}) => Promise<ManualLoginSession>;

export interface ChatGptWebAdapterOptions {
  profileDirectory: string;
  provider?: AiProvider;
  baseUrl?: string;
  headless?: boolean;
  executablePath?: string;
  browserFactory?: BrowserFactory;
  manualLoginFactory?: ManualLoginFactory | false;
  /** Override persistence in tests. `false` keeps state only for this instance. */
  conversationStateStore?: ConversationStateStore | false;
  /** Maximum time to wait for ChatGPT to assign /c/{id} after a successful submit. */
  conversationUrlTimeoutMs?: number;
}

export interface ChatGptCloseOptions {
  /**
   * Fail closed unless every tool-owned browser session has stopped. This is
   * required before Windows opens an external URL, because an existing Edge
   * root can otherwise capture that URL in the tool's automation profile.
   */
  strict?: boolean;
}

export class ChatGptAutomationShutdownError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatGptAutomationShutdownError";
  }
}

interface AssistantTurnBaseline {
  messages: Map<string, { count: number; latestTurnOrdinal?: number }>;
}

function isAuthenticationUrl(url: string): boolean {
  return /\/(?:auth|login|signup)(?:\/|\?|$)/iu.test(url);
}

function conversationFromUrl(
  candidate: string,
  baseUrl: string,
  provider: AiProvider = "chatgpt",
): ToolCreatedConversation | undefined {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(candidate);
    base = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (parsed.origin !== base.origin || parsed.username || parsed.password) return undefined;
  const pattern = provider === "kimi"
    ? /^\/(?:chat|c)\/([a-zA-Z0-9_-]{8,128})\/?$/u
    : /^\/c\/([a-zA-Z0-9_-]{8,128})\/?$/u;
  const match = pattern.exec(parsed.pathname);
  const id = match?.[1];
  if (!id) return undefined;
  return {
    id,
    url: new URL(parsed.pathname.replace(/\/+$/u, ""), base.origin).toString(),
    recordedAt: new Date().toISOString(),
    ownershipHashes: [],
  };
}

function isSameConversationUrl(
  candidate: string,
  expected: ToolCreatedConversation,
  baseUrl: string,
  provider: AiProvider = "chatgpt",
): boolean {
  const parsed = conversationFromUrl(candidate, baseUrl, provider);
  return parsed?.id === expected.id && parsed.url === expected.url;
}

function isBaseLandingUrl(candidate: string, baseUrl: string): boolean {
  try {
    const parsed = new URL(candidate);
    const base = new URL(baseUrl);
    const normalizedPath = (value: string): string => value.replace(/\/+$/u, "") || "/";
    return parsed.origin === base.origin && normalizedPath(parsed.pathname) === normalizedPath(base.pathname);
  } catch {
    return false;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Đã hủy thao tác.", "AbortError");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Đã hủy thao tác."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Đã hủy thao tác."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function firstExistingExecutable(candidates: Array<string | undefined>): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next system browser path.
    }
  }
  return undefined;
}

export async function findSystemBrowserExecutable(): Promise<string | undefined> {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  return firstExistingExecutable([
    process.env.CHATGPT_BROWSER_EXECUTABLE,
    programFiles ? path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    programFilesX86
      ? path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
    localAppData
      ? path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
    programFiles ? path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    programFilesX86
      ? path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
    localAppData
      ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
  ]);
}

async function defaultBrowserFactory(options: BrowserFactoryOptions): Promise<BrowserContext> {
  const { chromium } = await import("playwright-core");
  const commonOptions = {
    headless: options.headless,
    acceptDownloads: false,
    viewport: null,
    // Google rejects OAuth sign-in when Chromium exposes Playwright's default
    // automation flag. Manual sign-in uses a normal Edge process below; this
    // also keeps the controlled phase from advertising navigator.webdriver.
    ignoreDefaultArgs: ["--enable-automation", "--no-sandbox", "--disable-setuid-sandbox"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-save-password-bubble",
      "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection,AutofillServerCommunication",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  };

  if (options.executablePath) {
    return chromium.launchPersistentContext(options.profileDirectory, {
      ...commonOptions,
      executablePath: options.executablePath,
    });
  }

  // Playwright's system channel is the most stable way to find the Edge that
  // ships with Windows. No Playwright-managed browser is downloaded/bundled.
  try {
    return await chromium.launchPersistentContext(options.profileDirectory, {
      ...commonOptions,
      channel: "msedge",
    });
  } catch (edgeError) {
    const executablePath = await findSystemBrowserExecutable();
    if (!executablePath) {
      throw new Error(
        "Không tìm thấy Microsoft Edge hoặc Google Chrome. Hãy cài Edge, hoặc đặt CHATGPT_BROWSER_EXECUTABLE.",
        { cause: edgeError },
      );
    }
    try {
      return await chromium.launchPersistentContext(options.profileDirectory, {
        ...commonOptions,
        executablePath,
      });
    } catch (fallbackError) {
      throw new Error(
        `Không thể mở trình duyệt hệ thống tại ${executablePath}. Hãy đóng các phiên Tool dịch truyện khác rồi thử lại.`,
        { cause: fallbackError },
      );
    }
  }
}

function childExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
}

async function defaultManualLoginFactory(options: {
  profileDirectory: string;
  url: string;
  executablePath?: string;
}): Promise<ManualLoginSession> {
  const executablePath = options.executablePath ?? (await findSystemBrowserExecutable());
  if (!executablePath) {
    throw new Error("Không tìm thấy Microsoft Edge hoặc Google Chrome để mở đăng nhập bình thường.");
  }

  const child = spawn(
    executablePath,
    [
      `--user-data-dir=${options.profileDirectory}`,
      "--new-window",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-default-apps",
      // Edge may otherwise keep the profile process alive after its last
      // visible login window closes. The adapter used to mistake that
      // background process for an unfinished login forever.
      "--disable-background-mode",
      options.url,
    ],
    {
      detached: false,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  const closed = childExit(child);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });

  return {
    closed,
    isRunning: () => child.exitCode === null && child.signalCode === null && !child.killed,
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.race([closed.catch(() => undefined), delay(3_000)]);
    },
  };
}

async function firstVisible(page: Page, selectors: readonly string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    for (let index = 0; index < await matches.count(); index += 1) {
      const candidate = matches.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return undefined;
}

async function waitForFirstVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const locator = await firstVisible(page, selectors);
    if (locator) return locator;
    if (Date.now() < deadline) await delay(200);
  } while (Date.now() < deadline);
  return undefined;
}

async function waitForUniqueVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    // A selector union makes the browser deduplicate the same DOM element
    // matching multiple fallbacks. Uniqueness is therefore checked across the
    // complete fallback set, not only the first selector that happens to hit.
    const matches = page.locator(selectors.join(", "));
    const visible: Locator[] = [];
    for (let index = 0; index < await matches.count(); index += 1) {
      const candidate = matches.nth(index);
      if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
    }
    if (visible.length > 1) {
      throw new Error(
        "Có nhiều nút thao tác cùng khớp trong ChatGPT. Đã dừng để không xóa nhầm.",
      );
    }
    if (visible[0]) return visible[0];
    if (Date.now() < deadline) await delay(200);
  } while (Date.now() < deadline);
  return undefined;
}

export class ChatGptWebAdapter {
  private readonly emitter = new EventEmitter();
  private readonly browserFactory: BrowserFactory;
  private readonly manualLoginFactory?: ManualLoginFactory;
  private readonly baseUrl: string;
  private readonly provider: AiProvider;
  private readonly selectors: ChatWebSelectors;
  private readonly conversationState: ConversationStateStore;
  private readonly conversationUrlTimeoutMs: number;
  private context?: BrowserContext;
  private page?: Page;
  private manualLogin?: ManualLoginSession;
  private cancellationInProgress?: Promise<void>;
  private snapshot: ChatGptStatusSnapshot = { status: "closed" };
  private operationInProgress = false;
  private freshConversationRecoveryArmed = false;
  /**
   * DOM virtualization can remove earlier user turns from a long ChatGPT
   * conversation. Once this live browser session has verified a freshly sent
   * ownership marker, the exact persisted conversation id remains sufficient
   * for subsequent sends in that *same* session. A fresh browser/context must
   * still prove a marker from the DOM before it can send or delete anything.
   */
  private sessionVerifiedToolConversationId?: string;

  public constructor(private readonly options: ChatGptWebAdapterOptions) {
    this.browserFactory = options.browserFactory ?? defaultBrowserFactory;
    this.manualLoginFactory = options.manualLoginFactory === false
      ? undefined
      : options.manualLoginFactory ?? (options.browserFactory ? undefined : defaultManualLoginFactory);
    this.baseUrl = options.baseUrl ?? "https://chatgpt.com/";
    this.provider = options.provider === "kimi" ? "kimi" : "chatgpt";
    this.selectors = this.provider === "kimi" ? KIMI_SELECTORS : CHATGPT_SELECTORS;
    this.conversationState = options.conversationStateStore === false || (
      options.conversationStateStore === undefined && options.browserFactory !== undefined
    )
      ? new VolatileConversationStateStore()
      : options.conversationStateStore
        ?? new FileConversationStateStore(
          path.join(
            path.dirname(options.profileDirectory),
            this.provider === "kimi" ? "kimi-tool-conversation.json" : "chatgpt-tool-conversation.json",
          ),
        );
    this.conversationUrlTimeoutMs = Math.min(
      30_000,
      Math.max(500, options.conversationUrlTimeoutMs ?? 15_000),
    );
  }

  public onStatus(listener: (snapshot: ChatGptStatusSnapshot) => void): () => void {
    this.emitter.on("status", listener);
    return () => this.emitter.off("status", listener);
  }

  public status(): ChatGptStatusSnapshot {
    return { ...this.snapshot };
  }

  public async openLogin(): Promise<ChatGptStatusSnapshot> {
    if (this.manualLogin?.isRunning()) {
      // This method is also the explicit "Kiểm tra kết nối" action.
      // Once the user has finished in the normal Edge window, its root process
      // may remain alive in background mode even though the window was closed.
      // Merely checking `isRunning()` trapped the UI in login-required and
      // never gave the controlled browser a chance to verify the saved cookie.
      // Close only this tool-owned manual process, then hand the same persistent
      // profile back to Playwright for an actual authenticated DOM check.
      const manualLogin = this.manualLogin;
      this.manualLogin = undefined;
      this.setStatus("opening", "Đang xác minh phiên ChatGPT đã đăng nhập.");
      await manualLogin.close().catch(() => undefined);
      if (manualLogin.isRunning()) {
        this.manualLogin = manualLogin;
        this.setStatus(
          "login-required",
          "Edge đăng nhập do tool mở vẫn chưa đóng hoàn toàn. Hãy đóng cửa sổ rồi bấm Kiểm tra kết nối lại.",
        );
        return this.status();
      }
      // Let Edge release its profile lock before launching a persistent
      // automation context against the exact same directory.
      await delay(250);
    }
    this.manualLogin = undefined;

    if (!this.context) {
      this.setStatus("opening");
      try {
        const context = await this.browserFactory({
          profileDirectory: this.options.profileDirectory,
          headless: this.options.headless ?? false,
          executablePath: this.options.executablePath,
        });
        this.context = context;
        context.on("close", () => {
          if (this.context !== context) return;
          this.context = undefined;
          this.page = undefined;
          this.operationInProgress = false;
          if (!this.manualLogin) this.setStatus("closed");
        });
      } catch (error) {
        this.setStatus("error", error instanceof Error ? error.message : String(error));
        throw error;
      }
    }

    this.page = await this.getOrCreatePage();
    if (!this.page.url().startsWith(this.baseUrl)) {
      await this.page.goto(this.baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    await this.page.bringToFront();
    const status = await this.refreshStatus(12_000);
    if (
      status.status === "login-required" &&
      this.manualLoginFactory &&
      !(this.options.headless ?? false)
    ) {
      return this.switchToManualLogin();
    }
    return status;
  }

  public async refreshStatus(waitMs = 0): Promise<ChatGptStatusSnapshot> {
    if (!this.context || !this.page || this.page.isClosed()) {
      this.setStatus("closed");
      return this.status();
    }
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      if (
        isAuthenticationUrl(this.page.url()) ||
        (await firstVisible(this.page, this.selectors.loginLink))
      ) {
        this.setStatus("login-required", "Hãy đăng nhập ChatGPT trong cửa sổ trình duyệt vừa mở.");
        return this.status();
      }
      // ChatGPT currently renders a usable-looking composer on its signed-out
      // landing page as well. Authentication indicators must therefore win
      // over composer detection, otherwise an anonymous page is reported as a
      // connected account and the persisted session is never actually proven.
      if (await firstVisible(this.page, this.selectors.composer)) {
        if (this.provider === "kimi") {
          await delay(KIMI_AUTHENTICATION_STABILIZATION_MS);
          if (
            isAuthenticationUrl(this.page.url())
            || (await firstVisible(this.page, this.selectors.loginLink))
          ) {
            this.setStatus("login-required", "Hãy đăng nhập ChatGPT trong cửa sổ trình duyệt vừa mở.");
            return this.status();
          }
        }
        this.setStatus(this.operationInProgress ? "busy" : "ready");
        return this.status();
      }
      if (Date.now() < deadline) await delay(300);
    } while (Date.now() < deadline);

    this.setStatus("login-required", "Chưa thấy ô nhập ChatGPT. Hãy hoàn tất đăng nhập rồi thử lại.");
    return this.status();
  }

  public async ensureReady(): Promise<void> {
    if (!this.context || !this.page || this.page.isClosed()) await this.openLogin();
    const status = await this.refreshStatus(5_000);
    if (status.status !== "ready") {
      throw new Error(status.message ?? "ChatGPT Web chưa sẵn sàng.");
    }
  }

  public async startNewConversation(): Promise<void> {
    this.freshConversationRecoveryArmed = false;
    await this.ensureReady();
    const page = this.requirePage();
    const previousConversation = await this.loadVerifiedToolConversation();
    if (previousConversation) {
      await this.cleanupPreviousToolConversation(page, previousConversation);
    }
    // ChatGPT's responsive sidebar can place an overlay over the visible
    // "New chat" link, causing Playwright's click action to time out even
    // though the element is present. Navigating to the root URL is ChatGPT's
    // stable new-conversation route and avoids layout-specific pointer events.
    await this.resetToFreshConversationRoot(page, {
      // Deleting a previous chat may leave its virtualized turns in the DOM
      // briefly even after ChatGPT redirects to `/`. Reload once in that case
      // so the first response of the new chat cannot be confused with stale
      // content. A checkpoint with no previous chat keeps its already-ready
      // root and avoids the account-chooser regression.
      forceNavigation: Boolean(previousConversation),
    });
    // Only this explicit lifecycle operation may authorize one recovery from a
    // surprise /c navigation before the first prompt. A direct send opened on
    // a personal chat remains fail-closed and never navigates or adopts it.
    this.freshConversationRecoveryArmed = true;
  }

  /**
   * Delete only the exact conversation that this adapter previously proved it
   * owns. Missing ownership evidence or controls never causes a destructive
   * retry: the remote chat is left alone and only the local active pointer is
   * dropped. A real cleanup-action failure gets one fresh exact-URL attempt;
   * if it still fails, continue from a clean root rather than pausing the job.
   */
  private async cleanupPreviousToolConversation(
    page: Page,
    conversation: ToolCreatedConversation,
  ): Promise<void> {
    let lastCleanupError: unknown;

    for (let attempt = 1; attempt <= MAX_TOOL_CONVERSATION_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        await this.deleteToolConversation(page, conversation);
        await this.clearActiveToolConversationPointer();
        return;
      } catch (error) {
        // These failures occur before a destructive action is possible. The
        // existing exact tool chat is intentionally left untouched; retrying
        // cannot add useful safety evidence, so switch to a clean root now.
        if (
          error instanceof ChatGptOwnershipMarkerUnavailableError
          || error instanceof ChatGptConversationCleanupUnavailableError
        ) {
          await this.abandonPreviousToolConversation(error);
          return;
        }

        lastCleanupError = error;
        if (attempt < MAX_TOOL_CONVERSATION_CLEANUP_ATTEMPTS) {
          console.warn(
            `[ChatGPT] Dọn chat tool cũ lỗi ở lượt ${attempt}/${MAX_TOOL_CONVERSATION_CLEANUP_ATTEMPTS}; thử lại đúng chat này.`,
            error,
          );
        }
      }
    }

    await this.abandonPreviousToolConversation(lastCleanupError);
  }

  /**
   * Forgetting the local pointer is non-destructive: it never changes the old
   * remote chat. It is nevertheless required before opening a new root, so a
   * persistence failure stays fail-closed instead of risking a later send back
   * into the stale conversation.
   */
  private async clearActiveToolConversationPointer(): Promise<void> {
    await this.conversationState.clear();
    this.sessionVerifiedToolConversationId = undefined;
  }

  private async abandonPreviousToolConversation(cleanupError: unknown): Promise<void> {
    try {
      await this.clearActiveToolConversationPointer();
    } catch (clearError) {
      throw new Error(
        "Không thể bỏ tham chiếu chat tool cũ sau khi dọn lỗi; tool chưa mở chat mới để tránh gửi nhầm.",
        { cause: new AggregateError([cleanupError, clearError]) },
      );
    }

    console.warn(
      "[ChatGPT] Không dọn được chat tool cũ sau các lượt an toàn; giữ nguyên chat cũ và tạo chat mới.",
      cleanupError,
    );
  }

  public async sendAndWait(message: string, options: SendMessageOptions = {}): Promise<string> {
    if (this.operationInProgress) throw new Error("ChatGPT đang xử lý một yêu cầu khác.");
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new TypeError("Nội dung gửi ChatGPT không được để trống.");
    }
    if (message.length > 200_000) throw new RangeError("Nội dung gửi ChatGPT quá dài.");

    throwIfAborted(options.signal);
    await this.ensureReady();
    throwIfAborted(options.signal);
    const page = this.requirePage();
    const activeConversation = await this.prepareToolConversationForSend(page);
    if (this.provider === "kimi") await this.ensureKimiStandardThinkingEffort(page);
    const ownershipMarker = createOwnershipMarker();
    const submittedMessage = appendOwnershipMetadata(message, ownershipMarker);
    if (submittedMessage.length > 200_000) {
      throw new RangeError("Nội dung gửi ChatGPT quá dài sau khi thêm metadata xác minh.");
    }
    throwIfAborted(options.signal);
    const timeoutMs = Math.min(10 * 60_000, Math.max(10_000, options.timeoutMs ?? 180_000));
    this.operationInProgress = true;
    this.setStatus("busy");
    let abortStopPromise: Promise<void> | undefined;
    const onAbort = (): void => {
      abortStopPromise ??= this.cancelGeneration();
      // The main catch path awaits this same coalesced promise and propagates a
      // stop failure. Attach a handler here only to prevent an unhandled
      // rejection between the abort event and that catch continuation.
      void abortStopPromise.catch(() => undefined);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let messageSubmitted = false;
    const failedKimiResponses: string[] = [];
    const onKimiResponse = (response: Response): void => {
      if (this.provider !== "kimi" || response.status() < 400) return;
      try {
        const url = new URL(response.url());
        if (!url.hostname.endsWith("kimi.ai")) return;
        failedKimiResponses.push(`${response.status()} ${url.pathname}`);
      } catch {
        failedKimiResponses.push(String(response.status()));
      }
    };
    if (this.provider === "kimi") page.on("response", onKimiResponse);

    try {
      throwIfAborted(options.signal);
      const baseline = await this.captureAssistantTurnBaseline(page);
      throwIfAborted(options.signal);
      this.assertSafeSendDestination(page, activeConversation);
      const composer = await firstVisible(page, this.selectors.composer);
      if (!composer) throw new Error("Không tìm thấy ô nhập ChatGPT. Giao diện web có thể đã thay đổi.");
      // A transient sidebar, tooltip or onboarding layer can intercept pointer
      // events while the editor itself remains fillable. Clicking is only a
      // focus convenience, so do not let that prevent the direct fill attempt.
      await composer.click({ timeout: 5_000 }).catch(() => undefined);
      throwIfAborted(options.signal);
      try {
        await composer.fill(submittedMessage);
      } catch {
        throwIfAborted(options.signal);
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.insertText(submittedMessage);
      }

      throwIfAborted(options.signal);
      this.assertSafeSendDestination(page, activeConversation);
      const sendButton = await firstVisible(page, this.selectors.sendButton);
      if (sendButton && (await sendButton.isEnabled().catch(() => false))) {
        messageSubmitted = await this.clickAtSafeSendDestination(sendButton, activeConversation)
          .then(() => true, () => false);
      }
      if (!messageSubmitted) {
        throwIfAborted(options.signal);
        this.assertSafeSendDestination(page, activeConversation);
        await composer.press("Enter");
        messageSubmitted = true;
      }
      if (messageSubmitted && this.provider === "kimi") {
        messageSubmitted = await this.waitForKimiSubmissionCapacity(
          page,
          composer,
          activeConversation,
          timeoutMs,
          options.signal,
        );
      }
      if (messageSubmitted) this.freshConversationRecoveryArmed = false;
      // ChatGPT assigns the conversation ID only after the first prompt is
      // submitted. Persist only a verified /c/{id} URL, before waiting for the
      // assistant, so a response timeout still leaves the chat deletable.
      let submittedConversation: ToolCreatedConversation;
      try {
        submittedConversation = await this.rememberSubmittedConversation(
          page,
          activeConversation,
          ownershipMarker,
        );
      } catch (error) {
        throw new ChatGptConversationVerificationError(
          "Tin nhắn đã được gửi nhưng tool không xác minh được ID và quyền sở hữu chat mới. " +
          "Đã chặn gửi lại để tránh trùng nội dung hoặc gửi nhầm chat.",
          { cause: error },
        );
      }
      return await this.waitForLatestResponse(
        page,
        baseline,
        timeoutMs,
        options.signal,
        failedKimiResponses,
        submittedConversation,
        ownershipMarkerHash(ownershipMarker),
      );
    } catch (error) {
      // A timeout or DOM failure after submission may leave ChatGPT streaming.
      // Stop it before the runner retries, otherwise the next prompt can race
      // with the response that this call failed to observe.
      if (messageSubmitted) {
        try {
          await (abortStopPromise ?? this.cancelGeneration());
        } catch (stopError) {
          await this.abandonAutomationForFreshChatRecovery(error, stopError);
        }
      }
      throw error;
    } finally {
      if (this.provider === "kimi" && typeof page.off === "function") {
        page.off("response", onKimiResponse);
      }
      options.signal?.removeEventListener("abort", onAbort);
      this.operationInProgress = false;
      if (this.context && this.page && !this.page.isClosed()) {
        await this.refreshStatus().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.setStatus("error", `Không thể kiểm tra lại phiên ChatGPT: ${message}`);
        });
      } else {
        this.setStatus("closed");
      }
    }
  }

  public async cancelGeneration(): Promise<void> {
    if (this.cancellationInProgress) return this.cancellationInProgress;
    const operation = this.stopActiveGeneration();
    this.cancellationInProgress = operation;
    try {
      await operation;
    } finally {
      if (this.cancellationInProgress === operation) this.cancellationInProgress = undefined;
    }
  }

  /**
   * Kimi accepts the click before showing its concurrent-task limit dialog.
   * At that point the source is still in the composer and no message exists.
   * Dismiss and retry the same filled composer without consuming a translation
   * retry or creating duplicate chats.
   */
  private async waitForKimiSubmissionCapacity(
    page: Page,
    composer: Locator,
    conversation: ToolCreatedConversation | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      await delay(750, signal);
      const capacityDialog = await firstVisible(page, KIMI_CONCURRENCY_DIALOG_SELECTORS);
      if (!capacityDialog) return true;

      const dismiss = await firstVisible(page, KIMI_CONCURRENCY_DISMISS_SELECTORS);
      if (dismiss) await dismiss.click().catch(() => undefined);
      if (Date.now() >= deadline) break;
      await delay(
        Math.min(KIMI_CAPACITY_RETRY_INTERVAL_MS, Math.max(0, deadline - Date.now())),
        signal,
      );
      throwIfAborted(signal);
      this.assertSafeSendDestination(page, conversation);
      const sendButton = await firstVisible(page, this.selectors.sendButton);
      if (sendButton && (await sendButton.isEnabled().catch(() => false))) {
        await this.clickAtSafeSendDestination(sendButton, conversation);
      } else {
        await composer.press("Enter");
      }
    } while (Date.now() < deadline);
    throw new Error(
      `Kimi AI đang xử lý quá nhiều chat đồng thời và chưa nhận nội dung sau ${Math.round(timeoutMs / 1000)} giây.`,
    );
  }

  /**
   * Kimi persists its reasoning effort in the browser profile.  High effort
   * can turn a normal translation into a multi-minute background task.  The
   * Standard option is available in the same Instant mode and is the closest
   * equivalent to ChatGPT's ordinary translation flow.
   */
  private async ensureKimiStandardThinkingEffort(page: Page): Promise<void> {
    const highMode = await firstVisible(page, KIMI_INSTANT_HIGH_SELECTORS);
    if (!highMode) return;
    await highMode.click({ timeout: 5_000 });
    await delay(750);
    const effort = await firstVisible(page, KIMI_THINKING_EFFORT_SELECTORS);
    if (!effort) throw new Error("Không mở được mục Thinking effort của Kimi AI.");
    await effort.click({ timeout: 5_000 });
    await delay(750);
    const standard = await firstVisible(page, KIMI_STANDARD_EFFORT_SELECTORS);
    if (!standard) throw new Error("Không tìm thấy chế độ Standard của Kimi AI.");
    await standard.click({ timeout: 5_000 });
    await delay(500);
    if (await firstVisible(page, KIMI_INSTANT_HIGH_SELECTORS)) {
      throw new Error("Kimi AI chưa chuyển từ High sang Standard.");
    }
  }

  private async stopActiveGeneration(): Promise<void> {
    const page = this.page;
    if (!page || page.isClosed()) return;
    const stop = await firstVisible(page, this.selectors.stopButton);
    // No visible Stop is the normal already-settled state.
    if (!stop) return;
    try {
      await stop.click({ timeout: 5_000 });
    } catch (error) {
      throw new ChatGptGenerationStopError(
        "Không bấm được nút dừng response trên ChatGPT Web.",
        { cause: error },
      );
    }

    const deadline = Date.now() + 3_000;
    do {
      if (page.isClosed()) return;
      if (!await firstVisible(page, this.selectors.stopButton)) return;
      if (Date.now() < deadline) await delay(150);
    } while (Date.now() < deadline);
    throw new ChatGptGenerationStopError(
      "ChatGPT Web vẫn hiển thị nút dừng sau khi tool đã bấm. Response có thể vẫn đang chạy.",
    );
  }

  public async close(options: ChatGptCloseOptions = {}): Promise<void> {
    this.freshConversationRecoveryArmed = false;
    const manualLogin = this.manualLogin;
    if (!options.strict) {
      // App shutdown must remain best-effort: Electron must still be allowed
      // to quit if the browser process is already unhealthy or unresponsive.
      this.manualLogin = undefined;
      await manualLogin?.close().catch(() => undefined);
      await this.closeAutomationContext();
      this.setStatus("closed");
      return;
    }

    try {
      if (manualLogin) {
        await manualLogin.close();
        if (manualLogin.isRunning()) {
          throw new Error("The tool-owned manual-login browser is still running after close().");
        }
        if (this.manualLogin === manualLogin) this.manualLogin = undefined;
      }
      await this.closeAutomationContext({ strict: true });
      if (this.context || this.page) {
        throw new Error("An active ChatGPT automation reference remains after close().");
      }
      this.setStatus("closed");
    } catch (error) {
      const failure = new ChatGptAutomationShutdownError(
        "Không thể đóng hoàn toàn trình duyệt ChatGPT do tool quản lý. " +
          "Đã hủy kết nối Huliwang để tránh mở trang vào sai profile.",
        { cause: error },
      );
      this.setStatus("error", failure.message);
      throw failure;
    }
  }

  /**
   * Bounded recovery for genuine ChatGPT/browser errors. The runner has
   * already checkpointed the affected segment, so this only closes the
   * tool-owned browser and forgets its chat pointer; it never replays text.
   */
  public async restartForRecovery(): Promise<void> {
    this.freshConversationRecoveryArmed = false;
    try {
      await this.closeAutomationContext({ strict: true });
      await this.clearActiveToolConversationPointer();
      this.setStatus("closed");
    } catch (error) {
      const failure = new ChatGptAutomationShutdownError(
        "Không thể khởi động lại riêng trình duyệt ChatGPT để khôi phục dịch.",
        { cause: error },
      );
      this.setStatus("error", failure.message);
      throw failure;
    }
  }

  /** Reload the verified tool chat after a transient ChatGPT page failure. */
  public async reloadForRecovery(): Promise<void> {
    const page = this.page;
    if (!page || page.isClosed()) {
      throw new ChatGptAutomationShutdownError(
        "Không còn trang ChatGPT để tải lại khi khôi phục dịch.",
      );
    }
    try {
      this.setStatus("opening", "Đang tải lại trang ChatGPT để khôi phục dịch.");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      const status = await this.refreshStatus(10_000);
      if (status.status !== "ready") {
        throw new Error(status.message ?? "ChatGPT chưa sẵn sàng sau khi tải lại trang.");
      }
    } catch (error) {
      const failure = new ChatGptAutomationShutdownError(
        "Không thể tải lại trang ChatGPT để khôi phục dịch.",
        { cause: error },
      );
      this.setStatus("error", failure.message);
      throw failure;
    }
  }

  private async switchToManualLogin(): Promise<ChatGptStatusSnapshot> {
    const factory = this.manualLoginFactory;
    if (!factory) return this.status();
    await this.closeAutomationContext();
    try {
      const session = await factory({
        profileDirectory: this.options.profileDirectory,
        url: this.baseUrl,
        ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
      });
      this.manualLogin = session;
      const onManualLoginClosed = (): void => {
        if (this.manualLogin !== session) return;
        this.manualLogin = undefined;
        this.setStatus(
          "login-required",
          "Cửa sổ đăng nhập đã đóng. Bấm Kiểm tra kết nối để xác nhận phiên ChatGPT.",
        );
      };
      void session.closed.then(onManualLoginClosed, (error: unknown) => {
        if (this.manualLogin !== session) return;
        this.manualLogin = undefined;
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus("error", `Cửa sổ đăng nhập bị lỗi: ${message}`);
      });
      this.setStatus(
        "login-required",
        "Đăng nhập ChatGPT trong cửa sổ Edge bình thường. Khi đã vào được ChatGPT, hãy ĐÓNG cửa sổ Edge rồi bấm Kiểm tra kết nối.",
      );
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("login-required", `Không mở được cửa sổ đăng nhập bình thường: ${message}`);
      return this.status();
    }
  }

  private async closeAutomationContext(options: { strict?: boolean } = {}): Promise<void> {
    const context = this.context;
    this.freshConversationRecoveryArmed = false;
    if (!options.strict) {
      this.context = undefined;
      this.page = undefined;
      this.operationInProgress = false;
      this.sessionVerifiedToolConversationId = undefined;
      if (!context) return;
      await context.close().catch(() => undefined);
      return;
    }

    const activePage = this.page;
    if (!context) {
      if (activePage && !activePage.isClosed()) {
        throw new ChatGptAutomationShutdownError(
          "Phiên ChatGPT còn một tab tự động đang mở dù không còn browser context.",
        );
      }
      this.page = undefined;
      this.operationInProgress = false;
      this.sessionVerifiedToolConversationId = undefined;
      return;
    }

    let trackedPages: Page[];
    try {
      trackedPages = [...context.pages()];
      if (activePage && !trackedPages.includes(activePage)) trackedPages.push(activePage);
    } catch (error) {
      throw new ChatGptAutomationShutdownError(
        "Không thể kiểm tra các tab ChatGPT do tool quản lý trước khi đóng.",
        { cause: error },
      );
    }

    // A fresh-chat retry or external-browser handoff is safe only once the
    // Playwright-controlled context is genuinely gone. Swallowing a close
    // error here could leave it alive while another browser receives a URL.
    try {
      await context.close();
    } catch (error) {
      throw new ChatGptAutomationShutdownError(
        "Không thể đóng browser context ChatGPT do tool quản lý.",
        { cause: error },
      );
    }

    const openPage = trackedPages.find((page) => !page.isClosed());
    if (openPage) {
      throw new ChatGptAutomationShutdownError(
        "Browser context báo đã đóng nhưng vẫn còn tab ChatGPT tự động đang mở.",
      );
    }

    // The context's close event normally clears these references. Clear only
    // references owned by the context we just closed; a concurrently-created
    // context must remain visible so the strict caller fails closed below.
    if (this.context === context) this.context = undefined;
    if (this.page === activePage || (this.page && trackedPages.includes(this.page))) {
      this.page = undefined;
    }
    this.operationInProgress = false;
    this.sessionVerifiedToolConversationId = undefined;
  }

  /**
   * Stop controls are an observable property of the active browser page. If
   * the control cannot be clicked or stays visible, keeping that context open
   * would make a later prompt race the old generation. Close only the
   * Playwright-owned automation context (never the manual-login window), then
   * atomically forget the local tool-chat pointer so the next send starts from
   * a clean root instead of reopening the possibly streaming conversation.
   *
   * Ownership/verification failures stay fail-closed: we close the browser to
   * stop local automation, but retain the pointer and keep the non-retryable
   * error classification rather than declaring recovery safe.
   */
  private async abandonAutomationForFreshChatRecovery(
    originalError: unknown,
    stopError: unknown,
  ): Promise<never> {
    try {
      await this.closeAutomationContext({ strict: true });
    } catch (closeError) {
      throw new ChatGptGenerationStopError(
        "Tool không thể đóng riêng phiên Edge đang giữ response cũ. " +
          "Đã chặn retry để tránh chồng response.",
        { cause: new AggregateError([originalError, stopError, closeError]) },
      );
    }

    if (originalError instanceof ChatGptNonRetryableSafetyError) {
      throw new ChatGptGenerationStopError(
        "Yêu cầu ChatGPT gặp lỗi an toàn và tool không thể dừng response đang chạy. " +
          "Đã đóng phiên tự động, giữ nguyên tham chiếu chat và chặn retry.",
        { cause: new AggregateError([originalError, stopError]) },
      );
    }

    try {
      await this.conversationState.clear();
    } catch (clearError) {
      throw new ChatGptGenerationStopError(
        "Tool không thể dừng response đang chạy và cũng không thể xóa tham chiếu chat cục bộ. " +
          "Đã đóng phiên tự động và chặn retry để tránh chồng response.",
        { cause: new AggregateError([originalError, stopError, clearError]) },
      );
    }

    throw new ChatGptFreshChatRecoveryError(
      "ChatGPT không dừng response cũ. Tool đã đóng riêng phiên Edge do tool điều khiển " +
        "và bỏ tham chiếu chat cục bộ; có thể khôi phục an toàn trong chat mới.",
      { cause: new AggregateError([originalError, stopError]) },
    );
  }

  private async getOrCreatePage(): Promise<Page> {
    if (!this.context) throw new Error("Trình duyệt ChatGPT chưa được mở.");
    const availablePages = this.context.pages().filter((candidate) => !candidate.isClosed());
    const chatGptPages = availablePages.filter((candidate) => candidate.url().startsWith(this.baseUrl));
    const existing = chatGptPages.find((candidate) => !isAuthenticationUrl(candidate.url()))
      ?? chatGptPages[0]
      ?? availablePages[0];
    const page = existing ?? (await this.context.newPage());
    page.on("close", () => {
      if (this.page === page) this.page = undefined;
    });
    return page;
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("Cửa sổ ChatGPT đã đóng.");
    return this.page;
  }

  private async prepareToolConversationForSend(
    page: Page,
  ): Promise<ToolCreatedConversation | undefined> {
    let stored = await this.loadVerifiedToolConversation();
    if (stored && this.provider === "kimi") {
      // Kimi's current web client can return to the landing page after a
      // completed background answer and rejects a second submission to that
      // saved chat.  Every Kimi segment already carries the complete base
      // prompt, so start it in a fresh root and forget only the local pointer;
      // the finished remote chat remains untouched.
      await this.clearActiveToolConversationPointer();
      stored = undefined;
      await this.resetToFreshConversationRoot(page, { forceNavigation: true });
    }
    if (stored) {
      if (!isSameConversationUrl(page.url(), stored, this.baseUrl, this.provider)) {
        // The user may have opened a personal chat while a multi-segment job
        // was running. Return to the exact tool-owned chat; never adopt the
        // currently visible /c/{id} as tool-owned.
        await page.goto(stored.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      this.assertExactToolConversation(page, stored);
      if (this.sessionVerifiedToolConversationId !== stored.id) {
        // A restarted browser has no in-memory proof. It must find a marker in
        // the DOM before touching a persisted conversation. During one long
        // live job, however, old turns may be virtualized away by ChatGPT; the
        // id was already verified from a freshly submitted marker in this
        // context, and the exact URL guard below still prevents a personal
        // conversation from being used.
        await this.verifyToolConversationOwnership(page, stored);
        this.sessionVerifiedToolConversationId = stored.id;
      }
    } else if (!isBaseLandingUrl(page.url(), this.baseUrl)) {
      // There is no owned /c/{id} yet, so the current conversation is always
      // untrusted. Recover once by explicitly opening and verifying a clean
      // root; never adopt or send into the currently visible personal chat.
      if (!this.freshConversationRecoveryArmed) {
        throw new ChatGptNonRetryableSafetyError(
          "Chưa có ID chat của tool nhưng trang hiện tại không phải chat mới. " +
          "Đã dừng và chưa gửi nội dung.",
        );
      }
      this.freshConversationRecoveryArmed = false;
      await this.resetToFreshConversationRoot(page);
    }

    const status = await this.refreshStatus(15_000);
    if (status.status !== "ready") {
      throw new Error(status.message ?? "ChatGPT Web chưa sẵn sàng để gửi vào cuộc chat của tool.");
    }
    this.assertSafeSendDestination(page, stored);
    return stored;
  }

  private assertSafeSendDestination(
    page: Page,
    stored: ToolCreatedConversation | undefined,
  ): void {
    if (stored) {
      this.assertExactToolConversation(page, stored);
      return;
    }
    if (!isBaseLandingUrl(page.url(), this.baseUrl)) {
      throw new ChatGptNonRetryableSafetyError(
        "Trang ChatGPT đã chuyển sang một cuộc chat chưa được tool xác minh. Đã dừng và chưa gửi nội dung.",
      );
    }
  }

  private async resetToFreshConversationRoot(
    page: Page,
    options: { forceNavigation?: boolean } = {},
  ): Promise<void> {
    // `ensureReady()` has just authenticated the current page. Reloading an
    // already-clean root is both redundant and harmful: ChatGPT's current
    // account flow can show its "welcome back / choose an account" overlay on
    // that reload even though the existing page was fully signed in. This was
    // especially visible when resuming a checkpoint: connection verification
    // succeeded, then the unconditional navigation immediately turned the
    // same session into `login-required`.
    //
    // Keep the verified root in place. Navigation remains mandatory when the
    // page is a conversation (owned, abandoned, or personal), so the existing
    // fail-closed destination checks are unchanged.
    if (options.forceNavigation || !isBaseLandingUrl(page.url(), this.baseUrl)) {
      await page.goto(this.baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    if (!isBaseLandingUrl(page.url(), this.baseUrl)) {
      throw new ChatGptNonRetryableSafetyError(
        "ChatGPT không ở lại trang chat mới sau khi tool mở lại trang gốc. " +
        "Đã dừng và chưa gửi nội dung để bảo vệ chat cá nhân.",
      );
    }
    const status = await this.refreshStatus(15_000);
    if (status.status !== "ready") {
      throw new Error(status.message ?? "Không thể tạo cuộc trò chuyện mới.");
    }
    try {
      await this.waitForFreshConversationRoot(page);
    } catch (error) {
      throw new ChatGptNonRetryableSafetyError(
        "Không xác minh được trang chat mới sạch. Đã dừng và chưa gửi nội dung.",
        { cause: error },
      );
    }
    if (!isBaseLandingUrl(page.url(), this.baseUrl)) {
      throw new ChatGptNonRetryableSafetyError(
        "ChatGPT đã rời trang chat mới trước khi gửi. Đã dừng và chưa gửi nội dung.",
      );
    }
  }

  private async loadVerifiedToolConversation(): Promise<ToolCreatedConversation | undefined> {
    let stored: ToolCreatedConversation | undefined;
    try {
      stored = await this.conversationState.load();
    } catch (error) {
      throw new Error(
        "Không đọc được dữ liệu cuộc chat do tool tạo. Tool đã dừng để không xóa nhầm cuộc chat khác.",
        { cause: error },
      );
    }
    if (!stored) return undefined;
    const verified = conversationFromUrl(stored.url, this.baseUrl, this.provider);
    if (
      !verified ||
      verified.id !== stored.id ||
      verified.url !== stored.url ||
      !Array.isArray(stored.ownershipHashes) ||
      stored.ownershipHashes.length === 0 ||
      stored.ownershipHashes.length > MAX_CONVERSATION_OWNERSHIP_HASHES ||
      stored.ownershipHashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash))
    ) {
      throw new Error(
        "ID/URL cuộc chat do tool lưu không hợp lệ. Tool đã dừng và không xóa bất kỳ cuộc chat nào.",
      );
    }
    return { ...stored };
  }

  private assertExactToolConversation(
    page: Page,
    conversation: ToolCreatedConversation,
  ): void {
    if (!isSameConversationUrl(page.url(), conversation, this.baseUrl, this.provider)) {
      throw new Error(
        "Trang ChatGPT đã rời khỏi đúng cuộc chat do tool tạo. Đã dừng để không xóa nhầm cuộc chat khác.",
      );
    }
  }

  private async clickWithinExactConversation(
    locator: Locator,
    conversation: ToolCreatedConversation,
  ): Promise<void> {
    const expected = new URL(conversation.url);
    await locator.evaluate((element, target) => {
      const current = new URL(window.location.href);
      const normalizedPath = (value: string): string => value.replace(/\/+$/u, "") || "/";
      if (
        current.origin !== target.origin ||
        normalizedPath(current.pathname) !== normalizedPath(target.pathname)
      ) {
        throw new Error("SAFETY_URL_MISMATCH");
      }
      if (!(element instanceof HTMLElement) || !element.isConnected || element.getClientRects().length === 0) {
        throw new Error("SAFETY_ELEMENT_NOT_ACTIONABLE");
      }
      element.click();
    }, { origin: expected.origin, pathname: expected.pathname });
  }

  private async clickAtSafeSendDestination(
    locator: Locator,
    conversation: ToolCreatedConversation | undefined,
  ): Promise<void> {
    const expected = new URL(conversation?.url ?? this.baseUrl);
    await locator.evaluate((element, target) => {
      const current = new URL(window.location.href);
      const normalizedPath = (value: string): string => value.replace(/\/+$/u, "") || "/";
      if (
        current.origin !== target.origin ||
        normalizedPath(current.pathname) !== normalizedPath(target.pathname)
      ) {
        throw new Error("SAFETY_SEND_URL_MISMATCH");
      }
      if (!(element instanceof HTMLElement) || !element.isConnected || element.getClientRects().length === 0) {
        throw new Error("SAFETY_SEND_ELEMENT_NOT_ACTIONABLE");
      }
      element.click();
    }, { origin: expected.origin, pathname: expected.pathname });
  }

  private async verifyToolConversationOwnership(
    page: Page,
    conversation: ToolCreatedConversation,
  ): Promise<void> {
    const expectedHashes = new Set(conversation.ownershipHashes);
    const deadline = Date.now() + 15_000;
    do {
      this.assertExactToolConversation(page, conversation);
      for (const selector of this.selectors.toolConversationUserMessages) {
        const messages = page.locator(selector);
        for (let index = 0; index < await messages.count(); index += 1) {
          const text = await messages.nth(index).innerText().catch(() => "");
          if (text && containsOwnershipHash(text, expectedHashes)) return;
        }
      }
      if (Date.now() < deadline) await delay(250);
    } while (Date.now() < deadline);
    throw new ChatGptOwnershipMarkerUnavailableError(
      "URL khớp nhưng không tìm thấy marker sở hữu do tool đã gửi. " +
      "Đã dừng trước khi mở menu để không xóa nhầm cuộc chat khác.",
    );
  }

  private async verifyFirstSubmittedConversation(
    page: Page,
    conversation: ToolCreatedConversation,
    submittedOwnershipHash: string,
  ): Promise<void> {
    const deadline = Date.now() + this.conversationUrlTimeoutMs;
    const expectedHashes = new Set([submittedOwnershipHash]);
    do {
      this.assertExactToolConversation(page, conversation);
      // Kimi exposes one logical user turn through several nested aliases
      // (`.chat-content-item-user`, `.user-content`, `.segment-user`). A
      // combined selector therefore returns the same turn three times. Use
      // the first populated canonical selector for Kimi; ChatGPT keeps its
      // historical combined-selector check because those selectors are
      // mutually exclusive in its DOM.
      let messages = page.locator(this.selectors.toolConversationUserMessages.join(", "));
      if (this.provider === "kimi") {
        for (const candidateSelector of this.selectors.toolConversationUserMessages) {
          const candidate = page.locator(candidateSelector);
          if (await candidate.count() > 0) {
            messages = candidate;
            break;
          }
        }
      }
      const count = await messages.count();
      if (count > 1) {
        throw new Error(
          "Chat vừa được cấp ID đã có nhiều tin nhắn người dùng. Tool không nhận chat này là chat do tool tạo.",
        );
      }
      if (count === 1) {
        const text = await messages.first().innerText().catch(() => "");
        if (text && containsOwnershipHash(text, expectedHashes)) return;
        throw new Error(
          "Tin nhắn đầu tiên trong chat không có marker sở hữu tool vừa gửi. Tool không lưu ID chat này.",
        );
      }
      if (Date.now() < deadline) await delay(200);
    } while (Date.now() < deadline);
    throw new Error("Không xác minh được tin nhắn đầu tiên trong chat mới do tool tạo.");
  }

  private async verifySubmittedOwnershipMarker(
    page: Page,
    conversation: ToolCreatedConversation,
    submittedOwnershipHash: string,
  ): Promise<void> {
    const deadline = Date.now() + this.conversationUrlTimeoutMs;
    const expectedHashes = new Set([submittedOwnershipHash]);
    const messages = page.locator(this.selectors.toolConversationUserMessages.join(", "));
    do {
      this.assertExactToolConversation(page, conversation);
      for (let index = 0; index < await messages.count(); index += 1) {
        const text = await messages.nth(index).innerText().catch(() => "");
        if (text && containsOwnershipHash(text, expectedHashes)) return;
      }
      if (Date.now() < deadline) await delay(200);
    } while (Date.now() < deadline);
    throw new Error(
      "Không tìm thấy marker sở hữu của tin nhắn tool vừa gửi. Tool không cập nhật state chat.",
    );
  }

  private async deleteToolConversation(
    page: Page,
    conversation: ToolCreatedConversation,
  ): Promise<void> {
    await page.goto(conversation.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!isSameConversationUrl(page.url(), conversation, this.baseUrl, this.provider)) {
      const status = await this.refreshStatus(5_000);
      if (status.status === "ready" && isBaseLandingUrl(page.url(), this.baseUrl)) {
        // Recovery for a crash after ChatGPT deleted the target but before the
        // local atomic clear completed. Redirecting the exact saved URL to a
        // ready root page proves there is no target left to delete.
        return;
      }
      this.assertExactToolConversation(page, conversation);
    }

    // Keep deletion strict after a cold start. In the current verified browser
    // session, ChatGPT may have virtualized every old user turn from a very
    // long tool chat; the exact saved URL plus the session-only proof obtained
    // from a freshly submitted marker are then enough to delete that same
    // chat. It can never authorize a different /c/{id}.
    if (this.sessionVerifiedToolConversationId !== conversation.id) {
      await this.verifyToolConversationOwnership(page, conversation);
      this.sessionVerifiedToolConversationId = conversation.id;
    }

    const menu = await waitForUniqueVisible(page, this.selectors.currentConversationMenu, 15_000);
    if (!menu) {
      throw new ChatGptConversationCleanupUnavailableError(
        "menu",
        "Không tìm thấy nút tùy chọn của đúng cuộc chat do tool tạo. Cuộc chat chưa bị xóa.",
      );
    }
    this.assertExactToolConversation(page, conversation);
    try {
      await this.clickWithinExactConversation(menu, conversation);
      this.assertExactToolConversation(page, conversation);
    } catch (error) {
      throw new Error("Không mở được menu của cuộc chat do tool tạo. Cuộc chat chưa bị xóa.", {
        cause: error,
      });
    }

    const deleteAction = await waitForUniqueVisible(
      page,
      this.selectors.deleteCurrentConversation,
      5_000,
    );
    if (!deleteAction) {
      throw new ChatGptConversationCleanupUnavailableError(
        "delete-action",
        "Không tìm thấy lệnh Xóa trong menu cuộc chat do tool tạo. Cuộc chat chưa bị xóa.",
      );
    }
    this.assertExactToolConversation(page, conversation);
    try {
      await this.clickWithinExactConversation(deleteAction, conversation);
      this.assertExactToolConversation(page, conversation);
    } catch (error) {
      throw new Error("Không mở được hộp xác nhận xóa cuộc chat do tool tạo.", { cause: error });
    }

    const confirm = await waitForUniqueVisible(
      page,
      this.selectors.confirmDeleteConversation,
      5_000,
    );
    if (!confirm) {
      throw new ChatGptConversationCleanupUnavailableError(
        "confirmation",
        "Không tìm thấy nút xác nhận Xóa. Cuộc chat do tool tạo chưa bị xóa.",
      );
    }
    this.assertExactToolConversation(page, conversation);
    try {
      await this.clickWithinExactConversation(confirm, conversation);
    } catch (error) {
      throw new Error("ChatGPT không nhận thao tác xác nhận xóa. Cuộc chat chưa bị xóa.", {
        cause: error,
      });
    }

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (!isSameConversationUrl(page.url(), conversation, this.baseUrl, this.provider)) {
        const status = await this.refreshStatus(5_000);
        if (status.status === "ready" && isBaseLandingUrl(page.url(), this.baseUrl)) return;
        throw new Error(
          "Sau khi xác nhận xóa, ChatGPT chuyển tới trang không an toàn thay vì chat mới. " +
          "Tool đã giữ bản ghi vì chưa xác minh được thao tác xóa.",
        );
      }
      await delay(250);
    }
    throw new Error(
      "ChatGPT chưa xác nhận đã xóa đúng cuộc chat do tool tạo. Tool đã giữ bản ghi và dừng lại.",
    );
  }

  private async rememberSubmittedConversation(
    page: Page,
    expected: ToolCreatedConversation | undefined,
    submittedOwnershipMarker: string,
  ): Promise<ToolCreatedConversation> {
    const deadline = Date.now() + this.conversationUrlTimeoutMs;
    const submittedOwnershipHash = ownershipMarkerHash(submittedOwnershipMarker);
    let kimiCandidate: ToolCreatedConversation | undefined;
    let observerPage: Page | undefined;
    try {
      do {
        const currentConversation = conversationFromUrl(page.url(), this.baseUrl, this.provider);
        if (currentConversation && this.provider === "kimi") kimiCandidate = currentConversation;
        const conversation = currentConversation ?? kimiCandidate;
        if (!conversation) {
          if (Date.now() < deadline) await delay(200);
          continue;
        }
        if (expected && conversation.id !== expected.id) {
          throw new Error(
            "ChatGPT đã chuyển sang ID khác sau khi gửi. Tool không ghi đè bản ghi để tránh nhận nhầm chat cá nhân.",
          );
        }
        const persisted = await this.loadVerifiedToolConversation();
        if (persisted && persisted.id !== conversation.id) {
          throw new Error(
            "ID chat vừa gửi không khớp ID do tool đã lưu. Tool đã giữ nguyên bản ghi cũ để tránh xóa nhầm.",
          );
        }
        let verificationPage = page;
        if (!isSameConversationUrl(page.url(), conversation, this.baseUrl, this.provider)) {
          if (this.provider !== "kimi") this.assertExactToolConversation(page, conversation);
          observerPage ??= await page.context().newPage();
          await observerPage.goto(conversation.url, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          }).catch(() => undefined);
          verificationPage = observerPage;
        }
        try {
          if (!expected && !persisted) {
            await this.verifyFirstSubmittedConversation(
              verificationPage,
              conversation,
              submittedOwnershipHash,
            );
          } else {
            const verifiedOwner = persisted ?? expected;
            if (!verifiedOwner) {
              throw new Error("Không còn state sở hữu chat để xác minh tin nhắn vừa gửi.");
            }
            if (this.sessionVerifiedToolConversationId !== verifiedOwner.id) {
              await this.verifyToolConversationOwnership(verificationPage, verifiedOwner);
              this.sessionVerifiedToolConversationId = verifiedOwner.id;
            }
            await this.verifySubmittedOwnershipMarker(
              verificationPage,
              conversation,
              submittedOwnershipHash,
            );
          }
        } catch (error) {
          if (this.provider === "kimi" && Date.now() < deadline) {
            await delay(300);
            continue;
          }
          throw error;
        }
        const priorOwnershipHashes = persisted?.ownershipHashes ?? expected?.ownershipHashes ?? [];
        const ownershipHashes = [
          ...priorOwnershipHashes.filter((hash) => hash !== submittedOwnershipHash),
          submittedOwnershipHash,
        ].slice(-MAX_CONVERSATION_OWNERSHIP_HASHES);
        const savedConversation = {
          ...conversation,
          recordedAt: persisted?.recordedAt ?? expected?.recordedAt ?? conversation.recordedAt,
          ownershipHashes,
        };
        await this.conversationState.save(savedConversation);
        // The just-submitted marker was found in the current DOM and the
        // resulting /c/{id} matched the expected URL. Keep that proof only in
        // memory: a later app/browser restart deliberately has to re-verify
        // from the page before it can use or delete this conversation.
        this.sessionVerifiedToolConversationId = conversation.id;
        return savedConversation;
      } while (Date.now() < deadline);
      throw new Error(
        "Tin nhắn đã được gửi nhưng ChatGPT không cấp URL /c/{id} hợp lệ. " +
        "Tool đã dừng vì không thể ghi nhớ an toàn cuộc chat để xóa ở lần sau.",
      );
    } finally {
      await observerPage?.close().catch(() => undefined);
    }
  }

  private async captureAssistantTurnBaseline(page: Page): Promise<AssistantTurnBaseline> {
    const messages = new Map<string, { count: number; latestTurnOrdinal?: number }>();
    for (const selector of this.selectors.assistantMessages) {
      const locator = page.locator(selector);
      const count = await locator.count();
      const latestTurnOrdinal = count > 0
        ? await this.assistantTurnOrdinal(locator.last())
        : undefined;
      messages.set(selector, {
        count,
        ...(latestTurnOrdinal === undefined ? {} : { latestTurnOrdinal }),
      });
    }
    return { messages };
  }

  /**
   * A root navigation can finish at `domcontentloaded` while React still shows
   * turns from the previously opened conversation for a short time. Capturing
   * a baseline in that window makes the first assistant turn look old and the
   * completed response is then missed. Do not send until both user and
   * assistant turns have actually left the new-chat root.
   */
  private async waitForFreshConversationRoot(page: Page, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (!isBaseLandingUrl(page.url(), this.baseUrl)) {
        throw new Error("ChatGPT đã rời trang chat mới trước khi tool gửi nội dung.");
      }
      const [userCount, assistantCount] = await Promise.all([
        page.locator(this.selectors.toolConversationUserMessages.join(", ")).count()
          .catch(() => Number.POSITIVE_INFINITY),
        page.locator(this.selectors.assistantMessages.join(", ")).count()
          .catch(() => Number.POSITIVE_INFINITY),
      ]);
      if (userCount === 0 && assistantCount === 0) return;
      if (Date.now() < deadline) await delay(200);
    } while (Date.now() < deadline);
    throw new Error(
      "ChatGPT chưa làm sạch nội dung cuộc trò chuyện trước sau khi mở chat mới. Tool đã dừng để không bỏ lỡ phản hồi đầu tiên.",
    );
  }

  private async assistantTurnOrdinal(messageLocator: Locator): Promise<number | undefined> {
    const turns = messageLocator.locator(
      this.selectors.assistantTurnContainerFromMessage[0]!,
    );
    for (let index = 0; index < await turns.count(); index += 1) {
      const testId = await turns.nth(index).getAttribute("data-testid").catch(() => null);
      const match = /^conversation-turn-(\d+)$/u.exec(testId ?? "");
      if (match?.[1]) return Number.parseInt(match[1], 10);
    }
    return undefined;
  }

  private async responseTurnHasVisibleCompletionAction(
    responseLocator: Locator,
  ): Promise<boolean> {
    for (const turnSelector of this.selectors.assistantTurnContainerFromMessage) {
      const turns = responseLocator.locator(turnSelector);
      for (let turnIndex = 0; turnIndex < await turns.count(); turnIndex += 1) {
        const turn = turns.nth(turnIndex);
        for (const actionSelector of this.selectors.assistantTurnCompletionAction) {
          const actions = turn.locator(actionSelector);
          for (let actionIndex = 0; actionIndex < await actions.count(); actionIndex += 1) {
            if (await actions.nth(actionIndex).isVisible().catch(() => false)) return true;
          }
        }
      }
    }
    return false;
  }

  private async waitForLatestResponse(
    page: Page,
    baseline: AssistantTurnBaseline,
    timeoutMs: number,
    signal?: AbortSignal,
    failedKimiResponses: readonly string[] = [],
    submittedConversation?: ToolCreatedConversation,
    submittedOwnershipHash?: string,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let responseLocator: Locator | undefined;
    let responsePage = page;
    let selectedResponseSelector = "";
    let previousText = "";
    let stableChecks = 0;
    let observerPage: Page | undefined;
    let observerVerified = false;
    let nextObserverRefreshAt = Date.now() + 30_000;

    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason ?? new Error("Đã hủy thao tác.");

        if (
          this.provider === "kimi"
          && submittedConversation
          && submittedOwnershipHash
          && Date.now() >= nextObserverRefreshAt
        ) {
          observerPage ??= await page.context().newPage();
          await observerPage.goto(submittedConversation.url, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          }).catch(() => undefined);
          observerVerified = false;
          if (isSameConversationUrl(
            observerPage.url(),
            submittedConversation,
            this.baseUrl,
            this.provider,
          )) {
            observerVerified = await this.verifySubmittedOwnershipMarker(
              observerPage,
              submittedConversation,
              submittedOwnershipHash,
            ).then(() => true, () => false);
          }
          nextObserverRefreshAt = Date.now() + 10_000;
        }

        const candidatePages = observerPage && observerVerified ? [page, observerPage] : [page];
        for (const candidatePage of candidatePages) {
          const candidates: Array<{ locator: Locator; selector: string; textLength: number }> = [];
          for (const selector of this.selectors.assistantMessages) {
            const locator = candidatePage.locator(selector);
            const count = await locator.count();
            if (count === 0) continue;
            const prior = baseline.messages.get(selector) ?? { count: 0 };
            const candidate = locator.last();
            const latestTurnOrdinal = await this.assistantTurnOrdinal(candidate);
            const ordinalAdvanced = latestTurnOrdinal !== undefined
              && prior.latestTurnOrdinal !== undefined
              && latestTurnOrdinal > prior.latestTurnOrdinal;
            if (count > prior.count || ordinalAdvanced) {
              const textLength = (await candidate.innerText().catch(() => "")).trim().length;
              candidates.push({ locator: candidate, selector, textLength });
              break;
            }
          }
          if (candidates.length > 0) {
            // Kimi's selector list is ordered from its final answer segment to
            // broader turn shells.  Taking the first populated canonical
            // selector excludes both the hidden reasoning trace and tiny UI
            // labels that live beside the final answer.
            const selected = candidates[0];
            responseLocator = selected?.locator;
            selectedResponseSelector = selected?.selector ?? "";
            responsePage = candidatePage;
            if (responseLocator) break;
          }
        }

        if (responseLocator) {
          const text = (await responseLocator.innerText().catch(() => "")).trim();
          const stopButtonVisible = Boolean(await firstVisible(responsePage, this.selectors.stopButton));
          // Kimi renders Copy/action controls on intermediate thinking
          // segments.  Those controls are not a completion signal; only the
          // disappearance of its Stop control proves the final answer ended.
          const responseComplete = this.provider === "kimi"
            ? !stopButtonVisible
            : !stopButtonVisible || (
              await this.responseTurnHasVisibleCompletionAction(responseLocator)
            );
          if (text && text === previousText && responseComplete) stableChecks += 1;
          else stableChecks = 0;
          previousText = text;
          if (text && stableChecks >= 3) {
            if (this.provider === "kimi") {
              console.warn(
                `[Kimi] Đã chọn phản hồi bằng ${selectedResponseSelector || "selector không rõ"}; độ dài ${text.length}.`,
              );
            }
            return text;
          }

          if (responseComplete && (await firstVisible(responsePage, this.selectors.retryButton))) {
            throw new Error("ChatGPT Web báo lỗi khi tạo phản hồi.");
          }
        }
        await delay(500, signal);
      }
    } finally {
      await observerPage?.close().catch(() => undefined);
    }
    const kimiDiagnostic = this.provider === "kimi"
      ? await this.kimiResponseDomDiagnostic(page)
      : "";
    const failedNetwork = [...new Set(failedKimiResponses)].slice(0, 8).join(", ");
    throw new Error(
      `ChatGPT không hoàn tất phản hồi trong ${Math.round(timeoutMs / 1000)} giây.`
      + (kimiDiagnostic ? ` Kimi DOM: ${kimiDiagnostic}` : "")
      + (failedNetwork ? ` Kimi HTTP: ${failedNetwork}` : ""),
    );
  }

  /**
   * Kimi does not publish a stable DOM contract.  Keep timeout diagnostics to
   * structure only (never response/source text) so selector regressions can be
   * repaired without leaking a user's novel into logs.
   */
  private async kimiResponseDomDiagnostic(page: Page): Promise<string> {
    try {
      return await page.evaluate(() => {
        const interesting = /(assistant|answer|chat|content|markdown|message|segment)/iu;
        const exceptional = /(alert|button|error|failed|notice|retry|toast|warning)/iu;
        const rows = Array.from(document.querySelectorAll<HTMLElement>(
          'body [class], body [data-role], body [data-testid]',
        ))
          .map((element) => {
            const className = typeof element.className === "string" ? element.className : "";
            const dataRole = element.getAttribute("data-role") ?? "";
            const testId = element.getAttribute("data-testid") ?? "";
            const role = element.getAttribute("role") ?? "";
            const identity = [className, dataRole, testId, role].filter(Boolean).join("|");
            const rect = element.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            return {
              identity: `${element.tagName.toLowerCase()}:${identity}`.slice(0, 180),
              textLength: (element.innerText ?? "").trim().length,
              visible,
            };
          })
          .filter((row) => row.visible && row.textLength > 0)
          .filter((row) => interesting.test(row.identity) || exceptional.test(row.identity) || row.textLength >= 120);
        const unique = new Map<string, { identity: string; textLength: number; visible: boolean }>();
        for (const row of rows) {
          const existing = unique.get(row.identity);
          if (!existing || row.textLength > existing.textLength) unique.set(row.identity, row);
        }
        const all = Array.from(unique.values());
        const largest = all
          .sort((left, right) => right.textLength - left.textLength)
          .slice(0, 12);
        const exceptionalRows = all
          .filter((row) => exceptional.test(row.identity))
          .slice(0, 8);
        return [...new Map(
          [...largest, ...exceptionalRows].map((row) => [row.identity, row]),
        ).values()].map((row) => `${row.identity}#${row.textLength}`).join(", ");
      });
    } catch {
      return "không đọc được cấu trúc trang";
    }
  }

  private setStatus(status: ChatGptWebStatus, message?: string): void {
    if (this.snapshot.status === status && this.snapshot.message === message) return;
    this.snapshot = { status, ...(message ? { message } : {}) };
    this.emitter.emit("status", this.status());
  }
}
