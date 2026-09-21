import { EventEmitter } from "node:events";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
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
import {
  CHATGPT_SELECTORS,
  DEEPSEEK_SELECTORS,
  GEMINI_SELECTORS,
  KIMI_SELECTORS,
  type ChatWebSelectors,
  type ChatWebModelPicker,
} from "./selectors.js";
import {
  currentModelFromAriaLabel,
  ensureProModel,
  normalizeModelChipText,
  type GeminiModelDriver,
} from "./geminiModel.js";

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
const KIMI_USAGE_LIMIT_SELECTORS = [
  'text=/Your free quota is used up/i',
  'text=/free quota.*used up/i',
  'text=/quota.*refreshes at/i',
  'text=/免费.*(额度|次数).*(已用完|用完|耗尽)/i',
  'text=/(额度|次数).*(不足|已用完|用完|耗尽)/i',
] as const;
const DEEPSEEK_USAGE_LIMIT_SELECTORS = [
  'text=/reached.*(?:limit|quota)/i',
  'text=/(?:limit|quota).*(?:reached|exceeded|used up)/i',
  'text=/已达到.*(?:上限|限额)/i',
] as const;
const DEEPSEEK_TRANSIENT_ERROR_SELECTORS = [
  'text=/server is busy/i',
  'text=/service is temporarily unavailable/i',
  'text=/network error/i',
  'text=/服务器繁忙/i',
  'text=/服务暂时不可用/i',
] as const;
const DEEPSEEK_INITIAL_RESPONSE_TIMEOUT_MS = 3 * 60_000;
const DEEPSEEK_RESPONSE_IDLE_TIMEOUT_MS = 3 * 60_000;

// Kimi pauses long answers behind an inline "continue" control instead of
// finishing the assistant turn.  Without handling it the Stop control is gone
// but the answer is incomplete, so the adapter waits until the global timeout
// and retries the whole chapter.  Keep these selectors deliberately narrow so
// we never click an unrelated navigation or onboarding action.
const KIMI_CONTINUE_RESPONSE_SELECTORS = [
  'p.continue-chat-button',
  '.continue-chat-button',
  'button:has-text("Continue generating")',
  'button:has-text("继续生成")',
] as const;

const MAX_KIMI_RESPONSE_CONTINUATIONS = 6;
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
  provider: AiProvider;
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
  /**
   * Runs after the plain browser window used for a manual login is closed. That
   * is the first moment the tool may take the profile back and read who signed
   * in, because a normal browser process cannot be inspected while it is open.
   */
  onManualLoginWindowClosed?: () => Promise<void>;
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
  messages: Map<string, {
    count: number;
    latestTurnOrdinal?: number;
    latestVirtualItemKey?: string;
  }>;
}

function isAuthenticationUrl(url: string): boolean {
  return /\/(?:auth|login|signin|sign_in|signup|sign_up)(?:\/|\?|$)/iu.test(url);
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
    : provider === "deepseek"
      ? /^\/(?:a\/)?chat\/s\/([a-zA-Z0-9_-]{8,128})\/?$/u
      : provider === "gemini"
        ? /^\/(?:app|chat)\/([a-zA-Z0-9_-]{8,128})\/?$/u
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
  const openBrowser = async (): Promise<BrowserContext> => {
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
          `Không thể mở trình duyệt hệ thống tại ${executablePath}.`,
          { cause: fallbackError },
        );
      }
    }
  };

  try {
    return await openBrowser();
  } catch (error) {
    // A browser process left behind by an earlier run keeps the profile locked
    // and Chromium then refuses to start with "profile is already in use". Only
    // the processes naming this exact profile are stopped, so the user's own
    // browser windows are untouched.
    await releaseProfileLock(options.profileDirectory);
    return await openBrowser().catch(() => {
      throw error;
    });
  }
}

/**
 * Stops the tool's own leftover browser processes for one profile. Chromium
 * reports "profile is already in use" and the user is otherwise stuck until
 * they find and close that window by hand.
 */
async function releaseProfileLock(profileDirectory: string): Promise<void> {
  if (process.platform !== "win32" || !profileDirectory) return;
  const escaped = profileDirectory.replace(/'/gu, "''");
  const script = [
    "Get-CimInstance Win32_Process",
    `| Where-Object { $_.CommandLine -like '*${escaped}*' }`,
    "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join(" ");
  await new Promise<void>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
      () => resolve(),
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
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
  provider: AiProvider;
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

async function kimiUsageLimitVisible(page: Page): Promise<boolean> {
  if (await firstVisible(page, KIMI_USAGE_LIMIT_SELECTORS)) return true;
  // The current landing page paints this notice inside a client component
  // whose text locator is occasionally not exposed as a visible Playwright
  // node. A read-only body-text fallback keeps quota detection reliable
  // without depending on that component's generated class names.
  if (typeof page.evaluate !== "function") return false;
  return page.evaluate(() => {
    const text = document.body?.innerText?.replace(/\s+/gu, " ").trim() ?? "";
    return /your free quota is used up/iu.test(text)
      || /free quota.{0,80}used up/iu.test(text)
      || /quota.{0,80}refreshes at/iu.test(text)
      || /免费.{0,40}(?:额度|次数).{0,40}(?:已用完|用完|耗尽)/u.test(text)
      || /(?:额度|次数).{0,40}(?:不足|已用完|用完|耗尽)/u.test(text);
  }).catch(() => false);
}

async function deepSeekUsageLimitVisible(page: Page): Promise<boolean> {
  return Boolean(await firstVisible(page, DEEPSEEK_USAGE_LIMIT_SELECTORS));
}

function maximumResponseTimeoutMs(provider: AiProvider): number {
  if (provider === "deepseek") return 30 * 60_000;
  if (provider === "gemini") return 25 * 60_000;
  if (provider === "kimi") return 20 * 60_000;
  return 10 * 60_000;
}

function providerStateFile(provider: AiProvider): string {
  if (provider === "kimi") return "kimi-tool-conversation.json";
  if (provider === "deepseek") return "deepseek-tool-conversation.json";
  if (provider === "gemini") return "gemini-tool-conversation.json";
  return "chatgpt-tool-conversation.json";
}

function providerDefaultAccountLabel(provider: AiProvider): string {
  if (provider === "kimi") return "Kimi AI";
  if (provider === "deepseek") return "DeepSeek AI";
  if (provider === "gemini") return "Tài khoản Google";
  return "ChatGPT";
}

function providerStatusMessage(provider: AiProvider, message: string): string {
  if (provider === "chatgpt") return message;
  const label = provider === "kimi" ? "Kimi AI" : provider === "deepseek" ? "DeepSeek AI" : "Gemini AI";
  return message.replaceAll("ChatGPT Web", label).replaceAll("ChatGPT", label);
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u;
const CHATGPT_PLAN_PATTERN = /\b(free|plus|pro|team|enterprise|business|go)\b/iu;
const CHATGPT_PROFILE_NOISE = [
  /mở menu hồ sơ/giu,
  /open profile menu/giu,
  /profile menu/giu,
  /user menu/giu,
  /my plan/giu,
  /my account/giu,
  /customize chatgpt/giu,
  /settings/giu,
  /log out/giu,
  /sign out/giu,
  /nâng cấp/giu,
  /cài đặt/giu,
  /đăng xuất/giu,
] as const;

const DEEPSEEK_PROFILE_NOISE = [
  /deepseek/giu,
  /appkit/giu,
  /new chat/giu,
  /settings/giu,
  /setting/giu,
  /storage/giu,
  /localstorage/giu,
  /sessionstorage/giu,
  /log out/giu,
  /sign out/giu,
  /profile/giu,
  /account/giu,
  /user/giu,
  /avatar/giu,
  /upgrade/giu,
  /download/giu,
  /theme/giu,
  /language/giu,
  /chào buổi sáng/giu,
  /bắt đầu trò chuyện nào/giu,
  /xin chào.*giúp.*bạn/giu,
  /suy nghĩ sâu/giu,
  /tìm kiếm thông minh/giu,
  /trò chuyện mới/giu,
  /hôm qua/giu,
  /\b7 ngày\b/giu,
  /\b30 ngày\b/giu,
  /cài đặt/giu,
  /đăng xuất/giu,
  /tài khoản/giu,
  /hồ sơ/giu,
] as const;

const KIMI_PROFILE_NOISE = [
  /kimi/giu,
  /new chat/giu,
  /ctrl\s*k/giu,
  /\bmy\b/giu,
  /my kimi/giu,
  /plugins?/giu,
  /scheduled/giu,
  /slides?/giu,
  /projects?/giu,
  /new project/giu,
  /chats?/giu,
  /log in/giu,
  /sign in/giu,
  /log out/giu,
  /sign out/giu,
  /download/giu,
  /desktop/giu,
  /ask anything/giu,
  /instant high/giu,
  /deep research/giu,
  /docs?/giu,
  /settings?/giu,
  /account/giu,
  /profile/giu,
  /user/giu,
  /avatar/giu,
  /đăng nhập/giu,
  /đăng xuất/giu,
  /tài khoản/giu,
  /hồ sơ/giu,
] as const;

function normalizePlan(value: string | undefined): string | undefined {
  const match = CHATGPT_PLAN_PATTERN.exec(value ?? "");
  return match?.[1]?.toLowerCase();
}

function normalizeIdentityLabel(value: string | undefined): string | undefined {
  let text = (value ?? "")
    .replace(EMAIL_PATTERN, " ")
    .replace(CHATGPT_PLAN_PATTERN, " ")
    .replace(/[·•|,;]+/gu, " ");
  for (const pattern of CHATGPT_PROFILE_NOISE) text = text.replace(pattern, " ");
  text = text.replace(/\s+/gu, " ").trim();
  if (!text || text.length > 80) return undefined;
  if (/^(?:chatgpt|account|tài khoản|menu|free|plus|pro|team|enterprise|business|go)$/iu.test(text)) {
    return undefined;
  }
  return text;
}

function pickChatGptIdentity(candidates: readonly string[]): { label: string; email?: string; plan?: string } | undefined {
  const cleaned = candidates
    .flatMap((candidate) => candidate.split(/\r?\n|[·•|]/u))
    .map((candidate) => candidate.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const combined = candidates.join("\n");
  const email = EMAIL_PATTERN.exec(combined)?.[0];
  const plan = normalizePlan(combined);
  const emailLineIndex = email
    ? cleaned.findIndex((candidate) => candidate.toLowerCase().includes(email.toLowerCase()))
    : -1;
  const nearbyLabel = emailLineIndex > 0
    ? normalizeIdentityLabel(cleaned[emailLineIndex - 1])
    : undefined;
  const label = nearbyLabel
    ?? cleaned
      .map(normalizeIdentityLabel)
      .find((candidate): candidate is string => Boolean(candidate))
    ?? email
    ?? (plan ? "ChatGPT" : undefined);
  if (!label && !email && !plan) return undefined;
  return {
    label: label ?? "ChatGPT",
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
  };
}

function normalizeDeepSeekLabel(value: string | undefined): string | undefined {
  let text = (value ?? "")
    .replace(EMAIL_PATTERN, " ")
    .replace(/[·•|,;]+/gu, " ");
  if (
    /__|@|\/chat_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(text)
  ) return undefined;
  for (const pattern of DEEPSEEK_PROFILE_NOISE) text = text.replace(pattern, " ");
  text = text.replace(/\s+/gu, " ").trim();
  if (!text || text.length > 80) return undefined;
  if (/[_{}[\]:"/\\]/u.test(text)) return undefined;
  if (/^(?:ds|me|you|vip|api|v\d+(?:\.\d+)*)$/iu.test(text)) return undefined;
  if (/^(?:new|chat|history|help|feedback)$/iu.test(text)) return undefined;
  return text;
}

function pickDeepSeekIdentity(candidates: readonly string[]): { label: string } | undefined {
  const label = candidates
    .flatMap((candidate) => candidate.split(/\r?\n|[·•|]/u))
    .map((candidate) => candidate.replace(/\s+/gu, " ").trim())
    .map(normalizeDeepSeekLabel)
    .find((candidate): candidate is string => Boolean(candidate));
  return label ? { label } : undefined;
}

function normalizeKimiLabel(value: string | undefined): string | undefined {
  let text = (value ?? "")
    .replace(EMAIL_PATTERN, " ")
    .replace(/[·•|,;]+/gu, " ");
  if (
    /__|appkit|storage|\/chat_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(text)
  ) return undefined;
  for (const pattern of KIMI_PROFILE_NOISE) text = text.replace(pattern, " ");
  text = text.replace(/\s+/gu, " ").trim();
  if (!text || text.length > 80) return undefined;
  if (/[_{}[\]:"/\\]/u.test(text)) return undefined;
  if (/^(?:my|me|you|vip|api|more|history|help|feedback|swarm)$/iu.test(text)) return undefined;
  return text;
}

function pickKimiIdentity(candidates: readonly string[]): { label: string } | undefined {
  const label = candidates
    .flatMap((candidate) => candidate.split(/\r?\n|[·•|]/u))
    .map((candidate) => candidate.replace(/\s+/gu, " ").trim())
    .map(normalizeKimiLabel)
    .find((candidate): candidate is string => Boolean(candidate));
  return label ? { label } : undefined;
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
  /** Mutable: Gemini selects an account with a `?authuser=` address. */
  private baseUrl: string;
  private readonly provider: AiProvider;
  private readonly selectors: ChatWebSelectors;
  private readonly conversationState: ConversationStateStore;
  private readonly conversationUrlTimeoutMs: number;
  /** Mutable: one account per browser profile, so this changes when switching. */
  private profileDirectory: string;
  private context?: BrowserContext;
  private page?: Page;
  private manualLogin?: ManualLoginSession;
  private manualLoginClosedHandler?: () => Promise<void>;
  private manualLoginVerifiedIdentity?: { label: string; email?: string; plan?: string };
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
    this.profileDirectory = options.profileDirectory;
    this.provider = options.provider === "kimi" || options.provider === "deepseek" || options.provider === "gemini"
      ? options.provider
      : "chatgpt";
    this.selectors = this.provider === "kimi"
      ? KIMI_SELECTORS
      : this.provider === "deepseek"
        ? DEEPSEEK_SELECTORS
        : this.provider === "gemini"
          ? GEMINI_SELECTORS
          : CHATGPT_SELECTORS;
    this.conversationState = options.conversationStateStore === false || (
      options.conversationStateStore === undefined && options.browserFactory !== undefined
    )
      ? new VolatileConversationStateStore()
      : options.conversationStateStore
        ?? new FileConversationStateStore(
          path.join(
            path.dirname(options.profileDirectory),
            providerStateFile(this.provider),
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
      const verified = await this.verifyManualLoginWindow(this.manualLogin);
      if (verified.status === "ready") return verified;
      return verified;
    }
    this.manualLogin = undefined;

    if (!this.context) {
      this.setStatus("opening");
      try {
        const context = await this.browserFactory({
          profileDirectory: this.profileDirectory,
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

  public async openManualLogin(): Promise<ChatGptStatusSnapshot> {
    if (this.manualLogin?.isRunning()) return this.waitForManualLoginWindow(this.manualLogin);
    this.manualLogin = undefined;
    return this.switchToManualLogin();
  }

  /** Browser profile currently backing this adapter. */
  public currentProfileDirectory(): string {
    return this.profileDirectory;
  }

  /** Registers what to do once the plain window used for a manual login closes. */
  public setManualLoginClosedHandler(handler: () => Promise<void>): void {
    this.manualLoginClosedHandler = handler;
  }

  /**
   * Opens the controlled browser after a manual login and reports who signed in.
   * This deliberately skips the manual-login fallback: the window the user just
   * closed must not be reopened while the tool reads its own profile.
   */
  public async readAccountAfterManualLogin(): Promise<{ label: string; email?: string; plan?: string } | undefined> {
    let temporaryContext: BrowserContext | undefined;
    try {
      if (!this.context) {
        this.setStatus(
          "opening",
          providerStatusMessage(
            this.provider,
            "Đang đọc phiên đã đăng nhập bằng cửa sổ ẩn.",
          ),
        );
        let context: BrowserContext | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            context = await this.browserFactory({
              profileDirectory: this.profileDirectory,
              headless: true,
              executablePath: this.options.executablePath,
            });
            break;
          } catch (error) {
            lastError = error;
            await delay(500 + attempt * 250);
          }
        }
        if (!context) throw lastError instanceof Error ? lastError : new Error(String(lastError));
        temporaryContext = context;
        this.context = context;
        context.on("close", () => {
          if (this.context !== context) return;
          this.context = undefined;
          this.page = undefined;
          this.operationInProgress = false;
          if (!this.manualLogin) this.setStatus("closed");
        });
      }
      this.page = await this.getOrCreatePage();
      if (!this.page.url().startsWith(this.baseUrl)) {
        await this.page.goto(this.baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
          .catch(() => undefined);
      }
      const status = await this.refreshStatus(10_000);
      if (status.status !== "ready") return undefined;
      return await this.readAccountIdentity();
    } catch {
      return undefined;
    } finally {
      if (temporaryContext) {
        if (this.context === temporaryContext) {
          this.context = undefined;
          this.page = undefined;
          this.operationInProgress = false;
        }
        await temporaryContext.close().catch(() => undefined);
      }
    }
  }

  /**
   * Where the session currently lives: the profile plus, for Google, which
   * account index inside it. Read from the live page so a switch the user made
   * in the browser is picked up on the next check.
   */
  public accountHint(): { profileDirectory: string; authuser?: number; url?: string } {
    const url = this.page && !this.page.isClosed() ? this.page.url() : undefined;
    let authuser: number | undefined;
    if (url) {
      try {
        const parsed = Number.parseInt(new URL(url).searchParams.get("authuser") ?? "", 10);
        if (Number.isInteger(parsed) && parsed >= 0) authuser = parsed;
      } catch {
        authuser = undefined;
      }
    }
    return {
      profileDirectory: this.profileDirectory,
      ...(authuser === undefined ? {} : { authuser }),
      ...(url ? { url } : {}),
    };
  }

  /**
   * Finds which Google account index belongs to a saved address. Google stopped
   * putting the index in the URL, so the only dependable way back to a specific
   * saved login is to try the indexes the profile holds and read the address the
   * page reports. This runs once per account, when the user first selects it.
   */
  public async resolveAuthuserForEmail(email: string): Promise<number | undefined> {
    const wanted = email.trim().toLowerCase();
    const page = this.page;
    if (!wanted || !page || page.isClosed()) return undefined;
    const base = this.baseUrl.split("?")[0]!;
    for (let index = 0; index < 10; index += 1) {
      const url = `${base}?authuser=${index}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      await delay(1_500);
      const identity = await this.readAccountIdentity();
      if (identity?.email?.trim().toLowerCase() === wanted) {
        this.baseUrl = url;
        return index;
      }
    }
    // Nothing matched: leave the window where it started.
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    this.baseUrl = base;
    return undefined;
  }

  /**
   * Points the adapter at another saved account's profile. The running browser
   * is closed first: a Chromium profile can only be open in one process, and the
   * tool keeps one browser per bot on purpose.
   */
  public async useProfileDirectory(directory: string, options: { authuser?: number } = {}): Promise<void> {
    if (directory === this.profileDirectory && options.authuser === undefined) return;
    if (this.operationInProgress) {
      throw new Error("Không thể đổi tài khoản khi AI đang trả lời.");
    }
    if (directory !== this.profileDirectory) {
      const manualLogin = this.manualLogin;
      this.manualLogin = undefined;
      await manualLogin?.close().catch(() => undefined);
      await this.closeAutomationContext();
      this.profileDirectory = directory;
      // The remembered chat belongs to the account that just went away.
      this.sessionVerifiedToolConversationId = undefined;
      await this.conversationState.clear().catch(() => undefined);
    }
    if (options.authuser !== undefined) {
      // Google keeps several logins inside one profile; the index selects which
      // one this session uses.
      this.baseUrl = `${this.baseUrl.split("?")[0]}?authuser=${options.authuser}`;
      this.sessionVerifiedToolConversationId = undefined;
      const page = this.page;
      if (page && !page.isClosed()) {
        await page.goto(this.baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
          .catch(() => undefined);
      }
    }
  }

  /**
   * Reads the signed-in account from the page. Gemini exposes the full address,
   * ChatGPT names the account and its plan, DeepSeek exposes the profile name,
   * and Kimi exposes nothing reliably readable, so the caller keeps its label.
   */
  public async readAccountIdentity(): Promise<{ label: string; email?: string; plan?: string } | undefined> {
    const page = this.page;
    if (!page || page.isClosed()) return this.manualLoginVerifiedIdentity;
    return this.readAccountIdentityFromPage(page);
  }

  private async readAccountIdentityFromPage(page: Page): Promise<{ label: string; email?: string; plan?: string } | undefined> {
    if (this.provider === "chatgpt") return this.readChatGptAccountIdentity(page);
    if (this.provider === "kimi") return this.readKimiAccountIdentity(page);
    if (this.provider === "deepseek") return this.readDeepSeekAccountIdentity(page);
    try {
      return await page.evaluate(() => {
        const emailPattern = /[\w.+-]+@[\w-]+\.[\w.]+/u;
        const googleChip = document.querySelector(
          'a[aria-label*="Google Account" i], a[aria-label*="Tài khoản Google" i]',
        );
        const googleLabel = googleChip?.getAttribute("aria-label") ?? "";
        if (googleLabel) {
          const email = emailPattern.exec(googleLabel)?.[0];
          const name = /:\s*([^(,]+)/u.exec(googleLabel)?.[1]?.trim();
          if (email || name) {
            return { label: name || email || "Tài khoản Google", ...(email ? { email } : {}) };
          }
        }
        return undefined;
      });
    } catch {
      return undefined;
    }
  }

  private async readKimiAccountIdentity(page: Page): Promise<{ label: string } | undefined> {
    const readCandidates = async (): Promise<string[]> => page.evaluate(() => {
      const values = new Set<string>();
      const push = (value: unknown): void => {
        if (typeof value !== "string") return;
        const text = value.replace(/\s+/gu, " ").trim();
        if (text) values.add(text);
      };
      const visible = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const profileNodes = [
        ...document.querySelectorAll(
          [
            ".user-info-container",
            ".user-area__main",
            '[class*="avatar" i]',
            '[class*="account" i]',
            '[class*="profile" i]',
            '[class*="user" i]',
            '[aria-label*="account" i]',
            '[aria-label*="profile" i]',
            '[aria-label*="user" i]',
            '[title*="account" i]',
            '[title*="profile" i]',
            '[title*="user" i]',
            'img[alt]',
          ].join(", "),
        ),
      ].filter(visible);
      for (const node of profileNodes) {
        push(node.getAttribute("aria-label"));
        push(node.getAttribute("title"));
        push(node.getAttribute("alt"));
        push((node as HTMLElement).innerText);
        push(node.textContent);
      }
      const floatingMenus = [
        ...document.querySelectorAll('[role="menu"], [role="dialog"], [class*="popover" i], [class*="dropdown" i]'),
      ].filter(visible);
      for (const node of floatingMenus) {
        push((node as HTMLElement).innerText);
        push(node.textContent);
        for (const child of [...node.querySelectorAll("[aria-label], [title], img[alt]")]) {
          push(child.getAttribute("aria-label"));
          push(child.getAttribute("title"));
          push(child.getAttribute("alt"));
          push((child as HTMLElement).innerText);
        }
      }
      const sidebarBottomCandidates = [...document.querySelectorAll("button, [role='button'], a, div, span")]
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ node, rect }) => (
          visible(node)
          && rect.left >= 0
          && rect.left < 360
          && rect.width <= 360
          && rect.bottom > window.innerHeight - 180
          && rect.top < window.innerHeight
        ))
        .sort((left, right) => right.rect.top - left.rect.top);
      for (const { node } of sidebarBottomCandidates) {
        push((node as HTMLElement).innerText);
        push(node.textContent);
        push(node.getAttribute("aria-label"));
        push(node.getAttribute("title"));
      }
      const walk = (value: unknown, depth = 0): void => {
        if (depth > 4 || value === null || value === undefined) return;
        if (typeof value === "string") {
          push(value);
          try {
            const parsed: unknown = JSON.parse(value);
            if (parsed !== value) walk(parsed, depth + 1);
          } catch {
            // Plain storage string.
          }
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value.slice(0, 30)) walk(item, depth + 1);
          return;
        }
        if (typeof value === "object") {
          for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (/name|nick|user|account|profile|email|display/iu.test(key)) {
              if (typeof item === "string" || typeof item === "number") push(String(item));
              walk(item, depth + 1);
            }
          }
        }
      };
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index) ?? "";
          if (!/user|account|profile|auth|session|login|member/iu.test(key)) continue;
          walk(storage.getItem(key));
        }
      }
      return [...values];
    }).catch(() => []);

    let candidates: string[] = [];
    let identity: { label: string } | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      candidates = await readCandidates();
      identity = pickKimiIdentity(candidates);
      if (identity) return identity;
      await delay(400);
    }

    const profileButton = await firstVisible(page, [
      ".user-info-container",
      ".user-area__main",
      'button:has([class*="avatar" i])',
      'button:has(img[alt])',
      '[role="button"]:has([class*="avatar" i])',
      '[role="button"]:has(img[alt])',
      '[class*="avatar" i]',
      '[aria-label*="account" i]',
      '[aria-label*="profile" i]',
      '[aria-label*="user" i]',
    ]);
    if (!profileButton) return undefined;
    await profileButton.click({ timeout: 5_000 }).catch(() => undefined);
    await delay(500);
    identity = pickKimiIdentity([...(await readCandidates()), ...candidates]);
    await page.keyboard.press("Escape").catch(() => undefined);
    return identity;
  }

  private async readDeepSeekAccountIdentity(page: Page): Promise<{ label: string } | undefined> {
    const readCandidates = async (): Promise<string[]> => page.evaluate(() => {
      const values = new Set<string>();
      const push = (value: unknown): void => {
        if (typeof value !== "string") return;
        const text = value.replace(/\s+/gu, " ").trim();
        if (text) values.add(text);
      };
      const profileNodes = [
        ...document.querySelectorAll(
          [
            '[class*="avatar" i]',
            '[class*="account" i]',
            '[class*="profile" i]',
            '[class*="user" i]',
            '[aria-label*="account" i]',
            '[aria-label*="profile" i]',
            '[aria-label*="user" i]',
            '[title*="account" i]',
            '[title*="profile" i]',
            '[title*="user" i]',
            'img[alt]',
          ].join(", "),
        ),
      ];
      for (const node of profileNodes) {
        push(node.getAttribute("aria-label"));
        push(node.getAttribute("title"));
        push(node.getAttribute("alt"));
        push((node as HTMLElement).innerText);
        push(node.textContent);
      }
      const floatingMenus = [
        ...document.querySelectorAll('[role="menu"], [role="dialog"], [class*="popover" i], [class*="dropdown" i]'),
      ];
      for (const node of floatingMenus) {
        push((node as HTMLElement).innerText);
        push(node.textContent);
        for (const child of [...node.querySelectorAll("[aria-label], [title], img[alt]")]) {
          push(child.getAttribute("aria-label"));
          push(child.getAttribute("title"));
          push(child.getAttribute("alt"));
          push((child as HTMLElement).innerText);
        }
      }
      const avatarImages = [...document.querySelectorAll('img[src*="user-avatar"], img[src*="avatar"]')];
      for (const image of avatarImages) {
        let current: Element | null = image;
        for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
          push((current as HTMLElement).innerText);
          push(current.textContent);
        }
      }
      const visible = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const sidebarBottomCandidates = [...document.querySelectorAll("button, [role='button'], a, div, span")]
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ node, rect }) => (
          visible(node)
          && rect.left >= 0
          && rect.left < 360
          && rect.width <= 360
          && rect.bottom > window.innerHeight - 180
          && rect.top < window.innerHeight
        ))
        .sort((left, right) => right.rect.top - left.rect.top);
      for (const { node } of sidebarBottomCandidates) {
        push((node as HTMLElement).innerText);
        push(node.textContent);
        push(node.getAttribute("aria-label"));
        push(node.getAttribute("title"));
      }
      const walk = (value: unknown, depth = 0): void => {
        if (depth > 4 || value === null || value === undefined) return;
        if (typeof value === "string") {
          push(value);
          try {
            const parsed: unknown = JSON.parse(value);
            if (parsed !== value) walk(parsed, depth + 1);
          } catch {
            // Plain storage string.
          }
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value.slice(0, 30)) walk(item, depth + 1);
          return;
        }
        if (typeof value === "object") {
          for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (/name|nick|user|account|profile|email|display/iu.test(key)) {
              if (typeof item === "string" || typeof item === "number") push(String(item));
              walk(item, depth + 1);
            }
          }
        }
      };
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index) ?? "";
          if (!/user|account|profile|auth|session|login/iu.test(key)) continue;
          walk(storage.getItem(key));
        }
      }
      return [...values];
    }).catch(() => []);

    let candidates: string[] = [];
    let identity: { label: string } | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      candidates = await readCandidates();
      identity = pickDeepSeekIdentity(candidates);
      if (identity) return identity;
      await delay(400);
    }
    if (identity) return identity;

    const profileButton = await firstVisible(page, [
      'button:has([class*="avatar" i])',
      'button:has(img[alt])',
      '[role="button"]:has([class*="avatar" i])',
      '[role="button"]:has(img[alt])',
      '[class*="avatar" i]',
      '[aria-label*="account" i]',
      '[aria-label*="profile" i]',
      '[aria-label*="user" i]',
    ]);
    if (!profileButton) return undefined;
    await profileButton.click({ timeout: 5_000 }).catch(() => undefined);
    await delay(500);
    identity = pickDeepSeekIdentity([...(await readCandidates()), ...candidates]);
    await page.keyboard.press("Escape").catch(() => undefined);
    return identity;
  }

  private async readChatGptAccountIdentity(page: Page): Promise<{ label: string; email?: string; plan?: string } | undefined> {
    const readCandidates = async (): Promise<string[]> => page.evaluate(() => {
      const values = new Set<string>();
      const push = (value: unknown): void => {
        if (typeof value !== "string") return;
        const text = value.replace(/\s+/gu, " ").trim();
        if (text) values.add(text);
      };
      const profileNodes = [
        ...document.querySelectorAll(
          [
            '[data-testid="accounts-profile-button"]',
            '[data-testid="profile-button"]',
            '[data-testid="user-menu-button"]',
            '[data-testid="user-avatar"]',
            '[aria-label*="profile" i]',
            '[aria-label*="hồ sơ" i]',
            '[aria-label*="account" i]',
            '[aria-label*="tài khoản" i]',
          ].join(", "),
        ),
      ];
      for (const node of profileNodes) {
        push(node.getAttribute("aria-label"));
        push((node as HTMLElement).innerText);
        push(node.textContent);
      }
      const floatingMenus = [
        ...document.querySelectorAll('[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]'),
      ];
      for (const node of floatingMenus) {
        push((node as HTMLElement).innerText);
        push(node.textContent);
        for (const child of [...node.querySelectorAll("[aria-label], [title]")]) {
          push(child.getAttribute("aria-label"));
          push(child.getAttribute("title"));
          push((child as HTMLElement).innerText);
        }
      }
      return [...values];
    }).catch(() => []);

    const candidates = await readCandidates();
    let identity = pickChatGptIdentity(candidates);
    if (identity?.email && (identity.plan || normalizeIdentityLabel(identity.label))) return identity;

    const profileButton = await firstVisible(page, [
      '[data-testid="accounts-profile-button"]',
      '[data-testid="profile-button"]',
      '[data-testid="user-menu-button"]',
      '[data-testid="user-avatar"]',
      'button[aria-label*="profile" i]',
      'button[aria-label*="hồ sơ" i]',
      'button[aria-label*="account" i]',
      'button[aria-label*="tài khoản" i]',
      'button:has([data-testid="user-avatar"])',
    ]);
    if (!profileButton) return identity;
    await profileButton.click({ timeout: 5_000 }).catch(() => undefined);
    await delay(400);
    identity = pickChatGptIdentity([...(await readCandidates()), ...candidates]) ?? identity;
    await page.keyboard.press("Escape").catch(() => undefined);
    return identity;
  }

  private async waitForManualLoginWindow(session: ManualLoginSession): Promise<ChatGptStatusSnapshot> {
    if (!session.isRunning()) {
      this.manualLogin = undefined;
      this.setStatus(
        "login-required",
        providerStatusMessage(
          this.provider,
          "Cửa sổ đăng nhập đã đóng. Bấm Kiểm tra kết nối để xác nhận phiên ChatGPT.",
        ),
      );
      return this.status();
    }
    this.setStatus(
      "login-required",
      providerStatusMessage(
        this.provider,
        "Cửa sổ đăng nhập vẫn đang mở. Hãy hoàn tất đăng nhập trong cửa sổ đó rồi đóng cửa sổ, sau đó bấm Kiểm tra kết nối lại.",
      ),
    );
    return this.status();
  }

  private async verifyManualLoginWindow(session: ManualLoginSession): Promise<ChatGptStatusSnapshot> {
    if (this.manualLogin === session) this.manualLogin = undefined;
    this.setStatus(
      "opening",
      providerStatusMessage(
        this.provider,
        "Đang đóng cửa sổ đăng nhập và xác minh phiên ChatGPT vừa đăng nhập.",
      ),
    );
    await session.close().catch(() => undefined);
    const deadline = Date.now() + 8_000;
    while (session.isRunning() && Date.now() < deadline) {
      await delay(250);
    }
    if (session.isRunning()) {
      this.manualLogin = session;
      this.setStatus(
        "login-required",
        providerStatusMessage(
          this.provider,
          "Cửa sổ đăng nhập vẫn chưa đóng hoàn toàn. Hãy đóng cửa sổ đó rồi bấm Kiểm tra kết nối lại.",
        ),
      );
      return this.status();
    }
    // Chromium may keep a detached visible process alive even after the spawned
    // root exits. Clear that exact account profile before the hidden
    // verification context opens, otherwise Playwright cannot read the session.
    await releaseProfileLock(this.profileDirectory).catch(() => undefined);
    await delay(750);
    const identity = await this.readAccountAfterManualLogin();
    if (!identity) {
      this.setStatus(
        "login-required",
        providerStatusMessage(
          this.provider,
          "Chưa đọc được phiên ChatGPT sau khi đóng cửa sổ đăng nhập. Hãy bấm Thêm tài khoản và đăng nhập lại.",
        ),
      );
      return this.status();
    }
    this.manualLoginVerifiedIdentity = identity;
    this.setStatus("ready");
    return this.status();
  }

  public async refreshStatus(waitMs = 0): Promise<ChatGptStatusSnapshot> {
    if (!this.context || !this.page || this.page.isClosed()) {
      this.setStatus("closed");
      return this.status();
    }
    const page = this.page;
    /**
     * Google cannot be asked "is this session signed in?" through the login
     * URL: `accounts.google.com` appears on both the signed-out page (a hidden
     * `ServiceLogin` anchor) and the signed-in page (the account chip pointing
     * at `SignOutOptions`). A visible positive marker must therefore win over
     * any sign-in affordance, otherwise a correctly signed-in Gemini session
     * bounces the user back to the manual login window forever.
     */
    const signInRequired = async (): Promise<boolean> => {
      if (isAuthenticationUrl(page.url())) return true;
      if (await firstVisible(page, this.selectors.signedInMarkers ?? [])) return false;
      return Boolean(await firstVisible(page, this.selectors.loginLink));
    };
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      if (await signInRequired()) {
        this.setStatus("login-required", "Hãy đăng nhập ChatGPT trong cửa sổ trình duyệt vừa mở.");
        return this.status();
      }
      // ChatGPT currently renders a usable-looking composer on its signed-out
      // landing page as well. Authentication indicators must therefore win
      // over composer detection, otherwise an anonymous page is reported as a
      // connected account and the persisted session is never actually proven.
      if (await firstVisible(page, this.selectors.composer)) {
        if (this.provider === "kimi") {
          await delay(KIMI_AUTHENTICATION_STABILIZATION_MS);
          if (await signInRequired()) {
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
    if (!this.tracksConversationUrl) {
      // Without a conversation id in the URL there is no way to navigate back to
      // a specific chat and prove which one a delete menu belongs to. The remote
      // chat is left untouched and only the local pointer is dropped.
      await this.clearActiveToolConversationPointer();
      return;
    }
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
    await this.ensurePreferredModel(page);
    const activeConversation = await this.prepareToolConversationForSend(page);
    if (this.provider === "kimi") await this.ensureKimiStandardThinkingEffort(page);
    const ownershipMarker = createOwnershipMarker();
    const submittedMessage = appendOwnershipMetadata(message, ownershipMarker);
    if (submittedMessage.length > 200_000) {
      throw new RangeError("Nội dung gửi ChatGPT quá dài sau khi thêm metadata xác minh.");
    }
    throwIfAborted(options.signal);
    const timeoutMs = Math.min(
      maximumResponseTimeoutMs(this.provider),
      Math.max(10_000, options.timeoutMs ?? 180_000),
    );
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
    const failedProviderResponses: string[] = [];
    const onProviderResponse = (response: Response): void => {
      if (this.provider === "chatgpt" || response.status() < 400) return;
      try {
        const url = new URL(response.url());
        const expectedHosts = this.provider === "kimi"
          ? ["kimi.com", "kimi.ai"]
          : this.provider === "gemini"
            ? ["gemini.google.com"]
            : ["deepseek.com"];
        if (!expectedHosts.some((host) => url.hostname.endsWith(host))) return;
        failedProviderResponses.push(`${response.status()} ${url.pathname}`);
      } catch {
        failedProviderResponses.push(String(response.status()));
      }
    };
    if (this.provider !== "chatgpt") page.on("response", onProviderResponse);

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
        failedProviderResponses,
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
      if (this.provider !== "chatgpt" && typeof page.off === "function") {
        page.off("response", onProviderResponse);
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
        profileDirectory: this.profileDirectory,
        url: this.baseUrl,
        provider: this.provider,
        ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
      });
      this.manualLogin = session;
      const onManualLoginClosed = (): void => {
        if (this.manualLogin !== session) return;
        this.manualLogin = undefined;
        this.setStatus(
          "login-required",
          providerStatusMessage(
            this.provider,
            "Cửa sổ đăng nhập đã đóng. Bấm Kiểm tra kết nối để xác nhận phiên ChatGPT.",
          ),
        );
        // The window is gone, so the tool may take the profile back and record
        // whoever signed in without asking the user for another click.
        void (this.manualLoginClosedHandler ?? this.options.onManualLoginWindowClosed)?.()
          .catch(() => undefined);
      };
      void session.closed.then(onManualLoginClosed, (error: unknown) => {
        if (this.manualLogin !== session) return;
        this.manualLogin = undefined;
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus("error", `Cửa sổ đăng nhập bị lỗi: ${message}`);
      });
      this.setStatus(
        "login-required",
        providerStatusMessage(
          this.provider,
          "Đăng nhập ChatGPT trong cửa sổ Edge bình thường. Khi đã vào được ChatGPT, hãy ĐÓNG cửa sổ Edge rồi bấm Kiểm tra kết nối.",
        ),
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

  /** True unless the provider keeps its conversation id out of the page URL. */
  private get tracksConversationUrl(): boolean {
    return this.selectors.conversationIdInUrl !== false;
  }

  /**
   * Identity for a chat that has no URL id to remember it by. The ownership
   * markers are the proof of ownership; the page URL stays the landing URL
   * because it never changes. Keep the local id stable across later sends so a
   * Gemini translation job can keep using the same open chat.
   */
  private markerConversation(
    ownershipHash: string,
    existing?: ToolCreatedConversation,
  ): ToolCreatedConversation {
    return {
      id: existing?.id ?? `marker-${ownershipHash.slice(0, 24)}`,
      url: this.baseUrl,
      recordedAt: existing?.recordedAt ?? new Date().toISOString(),
      ownershipHashes: existing?.ownershipHashes?.length ? [...existing.ownershipHashes] : [ownershipHash],
    };
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
    if (stored && !this.tracksConversationUrl && this.sessionVerifiedToolConversationId !== stored.id) {
      // There is no URL id to navigate back to, so the only way to know the tool
      // still owns what is on screen is to find its submitted marker. A browser
      // restart cannot show that marker; starting a fresh chat is safe because
      // the runner resends the full base prompt whenever this returns nothing.
      try {
        await this.verifyToolConversationOwnership(page, stored);
        this.sessionVerifiedToolConversationId = stored.id;
      } catch {
        await this.clearActiveToolConversationPointer();
        stored = undefined;
        await this.resetToFreshConversationRoot(page, { forceNavigation: true });
      }
    }
    if (stored) {
      if (this.tracksConversationUrl) {
        if (!isSameConversationUrl(page.url(), stored, this.baseUrl, this.provider)) {
          // The user may have opened a personal chat while a multi-segment job
          // was running. Return to the exact tool-owned chat; never adopt the
          // currently visible /c/{id} as tool-owned.
          await page.goto(stored.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        }
        this.assertExactToolConversation(page, stored);
      }
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
    if (!this.tracksConversationUrl) {
      // The provider keeps the conversation id out of the URL, so the stored
      // record is identified by the ownership marker hash alone.
      const hashesValid = Array.isArray(stored.ownershipHashes)
        && stored.ownershipHashes.length > 0
        && stored.ownershipHashes.length <= MAX_CONVERSATION_OWNERSHIP_HASHES
        && stored.ownershipHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash));
      if (!/^marker-[a-f0-9]{24}$/u.test(stored.id) || !hashesValid) {
        throw new Error(
          "Dấu sở hữu cuộc chat do tool lưu không hợp lệ. Tool đã dừng và không đụng vào cuộc chat nào.",
        );
      }
      return { ...stored };
    }
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
    // Nothing to compare when the provider does not expose the id in the URL;
    // ownership is proven by the submitted marker instead.
    if (!this.tracksConversationUrl) return;
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
      // (`.chat-content-item-user`, `.user-content`, `.segment-user`), and
      // Gemini nests `<user-query-content>` inside `<user-query>`. A combined
      // selector therefore returns the same single turn several times and the
      // ownership check would reject a chat the tool just created. Use the
      // first populated canonical selector for those providers; ChatGPT keeps
      // its historical combined-selector check because its selectors are
      // mutually exclusive in that DOM.
      let messages = page.locator(this.selectors.toolConversationUserMessages.join(", "));
      if (this.provider === "kimi" || this.provider === "gemini") {
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
        // While the new chat swaps in, the previously open conversation can
        // still be painted for a moment. Wait for the DOM to settle instead of
        // rejecting the chat on the first look.
        if (Date.now() < deadline) {
          await delay(250);
          continue;
        }
        await this.captureGeminiDiagnostic(page, `first-conversation-count=${count}`);
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
    if (!this.tracksConversationUrl) {
      return await this.rememberMarkerConversation(page, expected, submittedOwnershipHash);
    }
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
      await this.captureGeminiDiagnostic(page, "conversation-url");
      throw new Error(
        "Tin nhắn đã được gửi nhưng ChatGPT không cấp URL /c/{id} hợp lệ. " +
        "Tool đã dừng vì không thể ghi nhớ an toàn cuộc chat để xóa ở lần sau.",
      );
    } finally {
      await observerPage?.close().catch(() => undefined);
    }
  }

  /**
   * Remembers a chat whose provider never exposes its id in the URL. The tool's
   * own ownership marker is the proof of ownership, and the record is named by
   * that marker's hash so later segments can recognise the same conversation.
   */
  private async rememberMarkerConversation(
    page: Page,
    expected: ToolCreatedConversation | undefined,
    submittedOwnershipHash: string,
  ): Promise<ToolCreatedConversation> {
    const persisted = await this.loadVerifiedToolConversation();
    if (expected && persisted && expected.id !== persisted.id) {
      throw new Error(
        "Dấu sở hữu chat đang mở không khớp dấu tool đã lưu. Tool giữ nguyên bản ghi cũ để tránh nhận nhầm.",
      );
    }
    const conversation = this.markerConversation(submittedOwnershipHash, persisted ?? expected);

    // The first send lands in an empty chat, so the marker must be the only
    // user turn. Later segments share that chat, where the marker is one of
    // several turns and only needs to be found.
    if (!expected && !persisted) {
      await this.verifyFirstSubmittedConversation(page, conversation, submittedOwnershipHash);
    } else {
      await this.verifySubmittedOwnershipMarker(page, conversation, submittedOwnershipHash);
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
    this.sessionVerifiedToolConversationId = conversation.id;
    return savedConversation;
  }

  private async captureAssistantTurnBaseline(page: Page): Promise<AssistantTurnBaseline> {
    const messages = new Map<string, {
      count: number;
      latestTurnOrdinal?: number;
      latestVirtualItemKey?: string;
    }>();
    for (const selector of this.selectors.assistantMessages) {
      const locator = page.locator(selector);
      const count = await locator.count();
      const latestTurnOrdinal = count > 0
        ? await this.assistantTurnOrdinal(locator.last())
        : undefined;
      const latestVirtualItemKey = count > 0 && this.provider === "deepseek"
        ? await this.assistantVirtualItemKey(locator.last())
        : undefined;
      messages.set(selector, {
        count,
        ...(latestTurnOrdinal === undefined ? {} : { latestTurnOrdinal }),
        ...(latestVirtualItemKey === undefined ? {} : { latestVirtualItemKey }),
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

  private async assistantVirtualItemKey(messageLocator: Locator): Promise<string | undefined> {
    const item = messageLocator.locator(
      'xpath=ancestor-or-self::*[@data-virtual-list-item-key][1]',
    );
    if (await item.count() === 0) return undefined;
    return (await item.first().getAttribute('data-virtual-list-item-key').catch(() => null))
      ?? undefined;
  }

  /**
   * DeepSeek virtualizes the conversation and can recycle an assistant DOM
   * node without increasing the visible message count. Pair the ownership
   * marker of the prompt we just submitted with the immediately following
   * virtual-list assistant item so an old answer can never satisfy this send.
   */
  private async deepSeekResponseForSubmittedTurn(
    page: Page,
    submittedOwnershipHash: string,
  ): Promise<Locator | undefined> {
    const expectedHashes = new Set([submittedOwnershipHash]);
    for (const selector of this.selectors.toolConversationUserMessages) {
      const messages = page.locator(selector);
      for (let index = (await messages.count()) - 1; index >= 0; index -= 1) {
        const message = messages.nth(index);
        const text = await message.innerText().catch(() => "");
        if (!text || !containsOwnershipHash(text, expectedHashes)) continue;
        const response = message.locator(
          'xpath=ancestor-or-self::*[@data-virtual-list-item-key][1]'
          + '/following-sibling::*[@data-virtual-list-item-key][1]'
          + '//*[contains(concat(" ", normalize-space(@class), " "), " ds-assistant-message-main-content ")]',
        );
        if (await response.count() > 0) return response.last();
      }
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
    failedProviderResponses: readonly string[] = [],
    submittedConversation?: ToolCreatedConversation,
    submittedOwnershipHash?: string,
  ): Promise<string> {
    const startedAt = Date.now();
    const hardDeadline = startedAt + timeoutMs;
    let deadline = this.provider === "deepseek"
      ? Math.min(hardDeadline, startedAt + DEEPSEEK_INITIAL_RESPONSE_TIMEOUT_MS)
      : hardDeadline;
    let responseLocator: Locator | undefined;
    let responsePage = page;
    let selectedResponseSelector = "";
    let previousText = "";
    let stableChecks = 0;
    let observerPage: Page | undefined;
    let observerVerified = false;
    let nextObserverRefreshAt = Date.now() + 30_000;
    let kimiResponseContinuations = 0;
    // Kimi can show the quota banner immediately after accepting the last
    // available request while that response is still streaming. Give the
    // accepted request time to expose its Stop control/assistant turn instead
    // of discarding a valid translation solely because the banner is visible.
    const kimiUsageLimitGraceDeadline = Date.now() + 15_000;

    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason ?? new Error("Đã hủy thao tác.");

        if (this.provider === "kimi") {
          const continueResponse = await firstVisible(page, KIMI_CONTINUE_RESPONSE_SELECTORS);
          if (continueResponse) {
            if (kimiResponseContinuations >= MAX_KIMI_RESPONSE_CONTINUATIONS) {
              throw new Error(
                `Kimi AI đã yêu cầu tiếp tục phản hồi quá ${MAX_KIMI_RESPONSE_CONTINUATIONS} lần.`,
              );
            }
            await continueResponse.click({ timeout: 5_000 });
            kimiResponseContinuations += 1;
            stableChecks = 0;
            // A continuation is a real new generation phase. Give it a fresh
            // response window instead of letting the original deadline expire
            // while Kimi is still extending the same answer.
            deadline = Math.max(deadline, Date.now() + timeoutMs);
            await delay(750, signal);
          }
        }
        const kimiUsageLimitDetected = this.provider === "kimi"
          && await kimiUsageLimitVisible(page);
        const deepSeekUsageLimitDetected = this.provider === "deepseek"
          && await deepSeekUsageLimitVisible(page);
        if (
          this.provider === "deepseek"
          && !previousText
          && !await firstVisible(page, this.selectors.stopButton)
          && await firstVisible(page, DEEPSEEK_TRANSIENT_ERROR_SELECTORS)
        ) {
          throw new Error("DeepSeek AI đang bận hoặc gặp lỗi mạng và chưa tạo phản hồi.");
        }

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
          if (this.provider === "deepseek" && submittedOwnershipHash) {
            const pairedResponse = await this.deepSeekResponseForSubmittedTurn(
              candidatePage,
              submittedOwnershipHash,
            );
            if (pairedResponse) {
              responseLocator = pairedResponse;
              selectedResponseSelector = "deepseek-owned-virtual-turn";
              responsePage = candidatePage;
              break;
            }
          }
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
            const latestVirtualItemKey = this.provider === "deepseek"
              ? await this.assistantVirtualItemKey(candidate)
              : undefined;
            const virtualItemAdvanced = latestVirtualItemKey !== undefined
              && latestVirtualItemKey !== prior.latestVirtualItemKey;
            if (count > prior.count || ordinalAdvanced || virtualItemAdvanced) {
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
          const rawText = (await responseLocator.innerText().catch(() => "")).trim();
          const text = this.selectors.cleanupResponse?.(rawText) ?? rawText;
          const stopButtonVisible = Boolean(await firstVisible(responsePage, this.selectors.stopButton));
          const stillStreaming = await this.responseStillStreaming(responsePage);
          // Kimi renders Copy/action controls on intermediate thinking
          // segments.  Those controls are not a completion signal; only the
          // disappearance of its Stop control proves the final answer ended.
          const responseComplete = stillStreaming
            ? false
            : this.provider === "kimi"
              ? !stopButtonVisible
              : !stopButtonVisible || (
                await this.responseTurnHasVisibleCompletionAction(responseLocator)
              );
          if (text && text === previousText && responseComplete) stableChecks += 1;
          else stableChecks = 0;
          if (this.provider === "deepseek" && text && text !== previousText) {
            deadline = Math.min(hardDeadline, Date.now() + DEEPSEEK_RESPONSE_IDLE_TIMEOUT_MS);
          }
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

        if (
          kimiUsageLimitDetected
          && Date.now() >= kimiUsageLimitGraceDeadline
          && !previousText
          && !await firstVisible(page, this.selectors.stopButton)
        ) {
          throw new Error(
            "Kimi AI đã hết hạn mức sử dụng hiện tại và không tạo phản hồi mới.",
          );
        }
        if (
          deepSeekUsageLimitDetected
          && !previousText
          && !await firstVisible(page, this.selectors.stopButton)
        ) {
          throw new Error("DeepSeek AI đã hết hạn mức sử dụng hiện tại và không tạo phản hồi mới.");
        }
        await delay(500, signal);
      }
    } finally {
      await observerPage?.close().catch(() => undefined);
    }
    const providerDiagnostic = this.provider === "kimi" || this.provider === "deepseek" || this.provider === "gemini"
      ? await this.kimiResponseDomDiagnostic(page)
      : "";
    const failedNetwork = [...new Set(failedProviderResponses)].slice(0, 8).join(", ");
    const providerLabel = this.provider === "kimi"
      ? "Kimi AI"
      : this.provider === "deepseek"
        ? "DeepSeek AI"
        : this.provider === "gemini"
          ? "Gemini AI"
          : "ChatGPT";
    const diagnosticLabel = this.provider === "kimi" ? "Kimi" : this.provider === "gemini" ? "Gemini" : "DeepSeek";
    const diagnosticSuffix =
      (providerDiagnostic ? ` ${diagnosticLabel} DOM: ${providerDiagnostic}` : "")
      + (failedNetwork ? ` ${diagnosticLabel} HTTP: ${failedNetwork}` : "");
    if (this.provider === "deepseek") {
      const observedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      throw new ChatGptConversationVerificationError(
        `DeepSeek AI không phát hiện được phản hồi mới trong ${observedSeconds} giây `
        + `(giới hạn toàn phản hồi ${Math.round(timeoutMs / 1000)} giây). `
        + "Tool đã dừng mà không gửi lại để tránh dịch trùng."
        + diagnosticSuffix,
      );
    }
    throw new Error(
      `${providerLabel} không hoàn tất phản hồi trong ${Math.round(timeoutMs / 1000)} giây.`
      + diagnosticSuffix,
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

  /**
   * Providers that expose an `aria-busy` flag while the reply is still being
   * written can prove the answer is complete. Without it a long pause between
   * streamed chunks looks identical to a finished reply, and the tool would
   * capture half a translation.
   */
  private async responseStillStreaming(page: Page): Promise<boolean> {
    const selectors = this.selectors.streamingIndicators;
    if (!selectors?.length) return false;
    for (const selector of selectors) {
      const nodes = page.locator(selector);
      const count = await nodes.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const busy = await nodes.nth(index).getAttribute("aria-busy").catch(() => null);
        if (busy === "true") return true;
      }
    }
    return false;
  }

  /**
   * Translation must run on the newest Pro model, so the picker is checked
   * before every send and switched when it shows anything else. A missing Pro
   * entry is reported as an error rather than silently answered by Flash or
   * Flash-Lite, whose wording and safety behaviour differ. Providers without a
   * model picker skip this entirely.
   */
  private async ensurePreferredModel(page: Page): Promise<void> {
    const picker = this.selectors.modelPicker;
    if (!picker) return;
    const closeMenu = async (): Promise<void> => {
      await page.keyboard.press("Escape").catch(() => undefined);
    };
    const driver: GeminiModelDriver = {
      // The chip is re-rendered while the page settles, so an empty read is
      // retried instead of being treated as "no model".
      currentLabel: async () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const label = await this.readModelLabel(page, picker);
          if (label) return label;
          await delay(400);
        }
        return "";
      },
      openMenu: async () => {
        const trigger = await firstVisible(page, picker.trigger);
        if (!trigger) {
          const seen = await this.readModelLabel(page, picker);
          throw new Error(
            `Không tìm thấy nút chọn model của Gemini (đang thấy "${seen || "không rõ"}"). `
            + "Tool cần xác nhận đang dùng model Pro trước khi dịch.",
          );
        }
        await trigger.click({ timeout: 10_000 });
      },
      options: async () => {
        const entries = await this.readModelOptions(page, picker);
        return entries.map((entry) => ({
          label: entry.label,
          disabled: entry.disabled,
          select: async () => {
            await entry.locator.click({ timeout: 10_000 });
            await delay(800);
          },
        }));
      },
      closeMenu,
    };
    try {
      await ensureProModel(driver);
    } catch (error) {
      await this.captureGeminiDiagnostic(
        page,
        `model-check: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Gemini has been switching between interface layouts on this account (a
   * classic composer with the model chip, and a newer "Spark" tab whose DOM has
   * neither that chip nor the usual conversation URL). A failure on the user's
   * machine cannot be reproduced from a static selector list, so the exact page
   * state is written next to the app data for the next investigation.
   */
  private async captureGeminiDiagnostic(page: Page, reason: string): Promise<void> {
    if (this.provider !== "gemini") return;
    try {
      const userSelectors = [...this.selectors.toolConversationUserMessages];
      const snapshot = await page.evaluate((selectors) => {
        const label = (node: Element | null): string =>
          node?.getAttribute("aria-label") ?? (node?.textContent ?? "").trim().slice(0, 40);
        const header = document.querySelector("header, top-bar, .top-bar, [role='banner']");
        return {
          url: location.href,
          title: document.title,
          switcherCount: document.querySelectorAll("bard-mode-switcher").length,
          switcherHtml: (document.querySelector("bard-mode-switcher")?.outerHTML ?? "").slice(0, 900),
          composerCount: document.querySelectorAll('div[contenteditable="true"][role="textbox"]').length,
          richTextareaCount: document.querySelectorAll("rich-textarea").length,
          messageContentCount: document.querySelectorAll("message-content").length,
          headerHtml: (header?.outerHTML ?? "").slice(0, 900),
          topButtons: [...document.querySelectorAll("button")]
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.top < 120;
            })
            .map((node) => label(node))
            .filter(Boolean)
            .slice(0, 25),
          userTurns: selectors.map((selector) => ({
            selector,
            count: document.querySelectorAll(selector).length,
            texts: [...document.querySelectorAll(selector)]
              .slice(0, 3)
              .map((node) => ((node as HTMLElement).innerText ?? "")
                .trim()
                .replace(/\s+/gu, " ")
                .slice(0, 120)),
          })),
          bodyHead: (document.body?.innerText ?? "").replace(/\s+/gu, " ").trim().slice(0, 400),
        };
      }, userSelectors);
      await writeFile(
        path.join(path.dirname(this.profileDirectory), "gemini-diagnostic.json"),
        JSON.stringify({ at: new Date().toISOString(), reason, ...snapshot }, null, 2),
        "utf8",
      );
    } catch {
      // Diagnostics must never change how a translation behaves.
    }
  }

  private async readModelLabel(page: Page, picker: ChatWebModelPicker): Promise<string> {
    for (const selector of picker.currentLabel) {
      const nodes = page.locator(selector);
      const count = await nodes.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const node = nodes.nth(index);
        const ariaLabel = await node.getAttribute("aria-label").catch(() => null);
        const fromAria = currentModelFromAriaLabel(ariaLabel ?? "");
        if (fromAria) return fromAria;
        const fromText = normalizeModelChipText(await node.innerText().catch(() => ""));
        if (fromText) return fromText;
      }
    }
    return "";
  }

  private async readModelOptions(
    page: Page,
    picker: ChatWebModelPicker,
  ): Promise<Array<{ label: string; locator: Locator; disabled: boolean }>> {
    for (const selector of picker.options) {
      const nodes = page.locator(selector);
      const count = await nodes.count().catch(() => 0);
      if (count === 0) continue;
      const entries: Array<{ label: string; locator: Locator; disabled: boolean }> = [];
      for (let index = 0; index < count; index += 1) {
        const locator = nodes.nth(index);
        if (!await locator.isVisible().catch(() => false)) continue;
        const label = (await locator.innerText().catch(() => "")).trim().replace(/\s+/gu, " ");
        // A quota-locked model stays visible but carries aria-disabled="true";
        // clicking it would hang until the click timeout instead of explaining
        // why the model cannot be used.
        const disabled = (await locator.getAttribute("aria-disabled").catch(() => null)) === "true";
        if (label) entries.push({ label, locator, disabled });
      }
      if (entries.length) return entries;
    }
    return [];
  }

  private setStatus(status: ChatGptWebStatus, message?: string): void {
    if (this.snapshot.status === status && this.snapshot.message === message) return;
    this.snapshot = { status, ...(message ? { message } : {}) };
    this.emitter.emit("status", this.status());
  }
}
