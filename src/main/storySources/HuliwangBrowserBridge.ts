import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  StorySourceError,
  type StoryPageClient,
  type StoryCatalogPagination,
  type StoryChapterPagination,
  type StoryPageFontAsset,
  type StoryPageLink,
  type StoryPageSnapshot,
} from "./types.js";
import { parseStoryUrl } from "./urlRules.js";

export const HULIWANG_COMPANION_EXTENSION_ID = "pnokdbiaajanoohgcaleeedhijgjkmhd";
export const HULIWANG_COMPANION_EXTENSION_ORIGIN =
  `chrome-extension://${HULIWANG_COMPANION_EXTENSION_ID}`;
/**
 * The in-page Huliwang catalog is paged by JavaScript.  Older helpers do not
 * expose the narrowly scoped `catalog-next` command, so pairing them would
 * otherwise fail later with a misleading empty/partial catalog error.
 */
// Version 1.0.4 adds the verified full-navigation reader continuation used
// by Huliwang's real `button#pt_next[data-url]` controls.  Older helpers can
// only see the first page of a split chapter, so refuse them before import.
export const HULIWANG_COMPANION_MINIMUM_VERSION = "1.0.4";

const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_PAIR_BYTES = 4 * 1024;
const MAX_TEXT_LENGTH = 1_750_000;
const EMPTY_COMMANDS = JSON.stringify({ commands: [] });
const STRICT_EXTENSION_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/u;
const MINIMUM_COMPANION_VERSION = parseExtensionVersion(HULIWANG_COMPANION_MINIMUM_VERSION);

export interface HuliwangBrowserBridgeOptions {
  /** Exact extension origins allowed to use the authenticated API. */
  allowedExtensionOrigins?: readonly string[];
  /** Defaults to 45 seconds. */
  pairingTimeoutMs?: number;
  /** Defaults to 90 seconds for every browser navigation/snapshot. */
  visitTimeoutMs?: number;
  /** Defaults to 20 seconds. */
  pollTimeoutMs?: number;
  /** Test-only port override. Production always requests an ephemeral port. */
  port?: number;
}

export interface HuliwangCompanionSession {
  readonly bridgeOrigin: string;
  readonly pairingUrl: string;
  readonly client: StoryPageClient;
  waitUntilPaired(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export type HuliwangCompanionFactory = () => Promise<HuliwangCompanionSession>;

type PendingCommandType = "visit" | "catalog-next" | "chapter-next";

interface PendingCommand {
  id: string;
  type: PendingCommandType;
  url: string;
  /** Logical reader page before a fixed in-page chapter advance. */
  expectedChapterPage?: number;
  delivered: boolean;
  resolve(snapshot: StoryPageSnapshot): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface PairWaiter {
  resolve(): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

type ExtensionVersion = readonly [major: number, minor: number, patch: number];

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError("Bridge timeout must be finite.");
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new TypeError("Request contains an unsupported field.");
  }
}

function boundedString(value: unknown, name: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value)) {
    throw new TypeError(`${name} is invalid.`);
  }
  return value;
}

function optionalString(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, name, maximum);
}

function parseExtensionVersion(value: unknown): ExtensionVersion {
  const raw = boundedString(value, "extensionVersion", 64, false);
  const match = STRICT_EXTENSION_VERSION.exec(raw);
  if (!match) throw new TypeError("extensionVersion is invalid.");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isExtensionVersionAtLeast(
  actual: ExtensionVersion,
  minimum: ExtensionVersion,
): boolean {
  for (let index = 0; index < actual.length; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart !== minimumPart) return actualPart > minimumPart;
  }
  return true;
}

function incompatibleCompanionVersionError(extensionVersion: string): StorySourceError {
  return new StorySourceError(
    "USER_ACTION_REQUIRED",
    `Tiện ích Huli Browser Helper đang là phiên bản ${extensionVersion}, nhưng tool cần tối thiểu ${HULIWANG_COMPANION_MINIMUM_VERSION} để đọc mục lục Huliwang. Hãy mở edge://extensions hoặc chrome://extensions, bấm Tải lại tiện ích rồi kết nối lại.`,
  );
}

function stringArray(value: unknown, name: string, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new TypeError(`${name} is invalid.`);
  return value.map((item) => boundedString(item, name, maximumLength));
}

function assertHuliwangHttpsUrl(value: unknown, name: string): string {
  const raw = boundedString(value, name, 2_048, false);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${name} is not a valid URL.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || !["huliwang.net", "www.huliwang.net", "m.huliwang.net"].includes(host)
  ) {
    throw new TypeError(`${name} is outside the Huliwang allow-list.`);
  }
  return parsed.toString();
}

function validateStoryUrl(value: unknown, name: string) {
  const raw = assertHuliwangHttpsUrl(value, name);
  const parsed = parseStoryUrl(raw);
  if (parsed.site !== "huliwang") throw new TypeError(`${name} is not a Huliwang story URL.`);
  return parsed;
}

function validateLink(value: unknown): StoryPageLink {
  if (!plainRecord(value)) throw new TypeError("snapshot.links contains an invalid entry.");
  assertOnlyKeys(value, new Set(["href", "text", "scopes"]));
  return {
    href: assertHuliwangHttpsUrl(value.href, "snapshot.links.href"),
    text: boundedString(value.text, "snapshot.links.text", 4_096),
    scopes: stringArray(value.scopes, "snapshot.links.scopes", 32, 512),
  };
}

function validateFontAsset(value: unknown): StoryPageFontAsset {
  if (!plainRecord(value)) throw new TypeError("snapshot.fontAssets contains an invalid entry.");
  assertOnlyKeys(value, new Set(["family", "url", "sha256"]));
  const sha256 = boundedString(value.sha256, "snapshot.fontAssets.sha256", 64, false);
  if (!/^[a-f\d]{64}$/iu.test(sha256)) throw new TypeError("snapshot.fontAssets.sha256 is invalid.");
  return {
    family: boundedString(value.family, "snapshot.fontAssets.family", 512, false),
    url: assertHuliwangHttpsUrl(value.url, "snapshot.fontAssets.url"),
    sha256: sha256.toLowerCase(),
  };
}

function validateCatalogPagination(value: unknown): StoryCatalogPagination {
  if (!plainRecord(value)) throw new TypeError("snapshot.catalogPagination is invalid.");
  assertOnlyKeys(value, new Set(["hasNext", "hasPrevious"]));
  if (typeof value.hasNext !== "boolean" || typeof value.hasPrevious !== "boolean") {
    throw new TypeError("snapshot.catalogPagination is invalid.");
  }
  return {
    hasNext: value.hasNext,
    hasPrevious: value.hasPrevious,
  };
}

function validateChapterPagination(value: unknown): StoryChapterPagination {
  if (!plainRecord(value)) throw new TypeError("snapshot.chapterPagination is invalid.");
  assertOnlyKeys(value, new Set(["hasNext", "hasPrevious", "currentPage"]));
  const currentPage = value.currentPage;
  if (
    typeof value.hasNext !== "boolean"
    || typeof value.hasPrevious !== "boolean"
    || typeof currentPage !== "number"
    || !Number.isSafeInteger(currentPage)
    || currentPage < 1
    || currentPage > 10_000
  ) {
    throw new TypeError("snapshot.chapterPagination is invalid.");
  }
  return {
    hasNext: value.hasNext,
    hasPrevious: value.hasPrevious,
    currentPage,
  };
}

function validateSnapshot(
  value: unknown,
  commandUrl: string,
  commandType: PendingCommandType,
  expectedChapterPage?: number,
): StoryPageSnapshot {
  if (!plainRecord(value)) throw new TypeError("snapshot must be an object.");
  assertOnlyKeys(value, new Set([
    "requestedUrl", "url", "status", "title", "canonicalUrl", "charset", "htmlLanguage",
    "bodyText", "elements", "links", "fontFamilies", "fontUrls", "fontHashes", "fontAssets",
    "readerMetadata", "catalogPagination", "chapterPagination", "challenge",
  ]));

  const expected = validateStoryUrl(commandUrl, "command.url");
  const requested = validateStoryUrl(value.requestedUrl, "snapshot.requestedUrl");
  if (requested.normalizedUrl !== expected.normalizedUrl) {
    throw new TypeError("snapshot.requestedUrl does not match the command URL.");
  }
  const actual = validateStoryUrl(value.url, "snapshot.url");
  if (actual.bookId !== expected.bookId) {
    throw new TypeError("snapshot.url changed to another Huliwang book.");
  }
  if (
    commandType === "catalog-next"
    && (expected.kind !== "catalog" || actual.kind !== "catalog" || actual.normalizedUrl !== expected.normalizedUrl)
  ) {
    throw new TypeError("catalog-next result did not remain on the exact current Huliwang catalog URL.");
  }
  let canonicalUrl: string | undefined;
  if (value.canonicalUrl !== undefined) {
    const canonical = validateStoryUrl(value.canonicalUrl, "snapshot.canonicalUrl");
    if (canonical.bookId !== expected.bookId) {
      throw new TypeError("snapshot.canonicalUrl changed to another Huliwang book.");
    }
    if (
      commandType === "catalog-next"
      && (canonical.kind !== "catalog" || canonical.normalizedUrl !== expected.normalizedUrl)
    ) {
      throw new TypeError("catalog-next result canonical URL did not remain on the current Huliwang catalog.");
    }
    canonicalUrl = canonical.normalizedUrl;
  }

  if (!plainRecord(value.elements) || Object.keys(value.elements).length > 256) {
    throw new TypeError("snapshot.elements is invalid.");
  }
  const elements: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const [selector, entries] of Object.entries(value.elements)) {
    if (!selector || selector.length > 512 || ["__proto__", "prototype", "constructor"].includes(selector)) {
      throw new TypeError("snapshot.elements contains an invalid selector.");
    }
    elements[selector] = stringArray(entries, `snapshot.elements.${selector}`, 2_000, 100_000);
  }

  if (!Array.isArray(value.links) || value.links.length > 20_000) {
    throw new TypeError("snapshot.links is invalid.");
  }
  const links = value.links.map(validateLink);
  const fontFamilies = stringArray(value.fontFamilies, "snapshot.fontFamilies", 256, 512);
  const fontUrls = stringArray(value.fontUrls, "snapshot.fontUrls", 256, 2_048)
    .map((url) => assertHuliwangHttpsUrl(url, "snapshot.fontUrls"));
  const fontHashes = stringArray(value.fontHashes, "snapshot.fontHashes", 256, 64)
    .map((hash) => {
      if (!/^[a-f\d]{64}$/iu.test(hash)) throw new TypeError("snapshot.fontHashes is invalid.");
      return hash.toLowerCase();
    });

  let fontAssets: StoryPageFontAsset[] | undefined;
  if (value.fontAssets !== undefined) {
    if (!Array.isArray(value.fontAssets) || value.fontAssets.length > 256) {
      throw new TypeError("snapshot.fontAssets is invalid.");
    }
    fontAssets = value.fontAssets.map(validateFontAsset);
  }

  let readerMetadata: StoryPageSnapshot["readerMetadata"];
  if (value.readerMetadata !== undefined) {
    if (!plainRecord(value.readerMetadata)) throw new TypeError("snapshot.readerMetadata is invalid.");
    assertOnlyKeys(value.readerMetadata, new Set(["bookId", "chapterId", "sourceId"]));
    readerMetadata = {
      ...(value.readerMetadata.bookId !== undefined
        ? { bookId: boundedString(value.readerMetadata.bookId, "readerMetadata.bookId", 128) }
        : {}),
      ...(value.readerMetadata.chapterId !== undefined
        ? { chapterId: boundedString(value.readerMetadata.chapterId, "readerMetadata.chapterId", 128) }
        : {}),
      ...(value.readerMetadata.sourceId !== undefined
        ? { sourceId: boundedString(value.readerMetadata.sourceId, "readerMetadata.sourceId", 128) }
        : {}),
    };
  }

  const catalogPagination = value.catalogPagination === undefined
    ? undefined
    : validateCatalogPagination(value.catalogPagination);
  if (catalogPagination && actual.kind !== "catalog") {
    throw new TypeError("snapshot.catalogPagination is only valid on a Huliwang catalog.");
  }
  if (commandType === "catalog-next" && !catalogPagination) {
    throw new TypeError("catalog-next result omitted catalog pager state.");
  }

  const chapterPagination = value.chapterPagination === undefined
    ? undefined
    : validateChapterPagination(value.chapterPagination);
  if (chapterPagination && actual.kind !== "chapter") {
    throw new TypeError("snapshot.chapterPagination is only valid on a Huliwang chapter.");
  }
  if (commandType === "chapter-next") {
    const expectedPage = expectedChapterPage ?? expected.page ?? 1;
    const actualPage = actual.page ?? 1;
    if (
      expected.kind !== "chapter"
      || actual.kind !== "chapter"
      || actual.chapterKey !== expected.chapterKey
      || !chapterPagination
      || chapterPagination.currentPage !== expectedPage + 1
      // Huliwang can either change its reader URL to /<page>.html or keep
      // one URL while replacing #nr in place. Both are safe only after the
      // companion has reported the exact sequential reader page.
      || ![expected.page ?? 1, expectedPage + 1].includes(actualPage)
    ) {
      throw new TypeError("chapter-next result did not advance exactly one page in the same Huliwang chapter.");
    }
  }

  if (!(["none", "passive", "interactive"] as const).includes(
    value.challenge as "none" | "passive" | "interactive",
  )) {
    throw new TypeError("snapshot.challenge is invalid.");
  }
  let status: number | undefined;
  if (value.status !== undefined) {
    if (!Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599) {
      throw new TypeError("snapshot.status is invalid.");
    }
    status = value.status as number;
  }

  return {
    requestedUrl: expected.normalizedUrl,
    url: actual.normalizedUrl,
    ...(status !== undefined ? { status } : {}),
    title: boundedString(value.title, "snapshot.title", 16_384),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(value.charset !== undefined ? { charset: optionalString(value.charset, "snapshot.charset", 128) } : {}),
    ...(value.htmlLanguage !== undefined
      ? { htmlLanguage: optionalString(value.htmlLanguage, "snapshot.htmlLanguage", 128) }
      : {}),
    bodyText: boundedString(value.bodyText, "snapshot.bodyText", MAX_TEXT_LENGTH),
    elements,
    links,
    fontFamilies,
    fontUrls,
    fontHashes,
    ...(fontAssets ? { fontAssets } : {}),
    ...(readerMetadata ? { readerMetadata } : {}),
    ...(catalogPagination ? { catalogPagination } : {}),
    ...(chapterPagination ? { chapterPagination } : {}),
    challenge: value.challenge as "none" | "passive" | "interactive",
  };
}

function pairingPage(): string {
  return "<!doctype html><html lang=vi><meta charset=utf-8><meta name=referrer content=no-referrer>"
    + "<title>Kết nối Tool dịch truyện</title><h1>Đang kết nối Tool dịch truyện…</h1>"
    + "<p>Hãy cài và bật tiện ích Huliwang Companion. Không đóng tab này cho đến khi tool báo đã kết nối.</p>"
    + "<p>Trang ghép nối này không đọc cookie, mật khẩu hay lịch sử duyệt web.</p></html>";
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new StorySourceError("CANCELLED", "Đã hủy thao tác nguồn truyện.");
}

export class HuliwangBrowserBridge implements HuliwangCompanionSession {
  public bridgeOrigin = "";
  public pairingUrl = "";
  public readonly client: StoryPageClient;

  private readonly token = randomBytes(32).toString("base64url");
  private readonly sessionId = randomUUID();
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly pairingTimeoutMs: number;
  private readonly visitTimeoutMs: number;
  private readonly pollTimeoutMs: number;
  private readonly port: number;
  private readonly pairWaiters = new Set<PairWaiter>();
  private readonly pollWaiters = new Set<ServerResponse>();
  private readonly consumedCommandIds: string[] = [];
  private server?: Server;
  private pending?: PendingCommand;
  private lastSnapshot?: StoryPageSnapshot;
  private lastRequestedUrl?: string;
  /**
   * Set only while this bridge has not accepted a compatible companion. It
   * makes a stale helper fail the visible pairing flow immediately instead of
   * leaving the renderer to time out and later attempt a catalog read.
   */
  private pairingFailure?: StorySourceError;
  private paired = false;
  private closed = false;

  public constructor(options: HuliwangBrowserBridgeOptions = {}) {
    const origins = options.allowedExtensionOrigins ?? [HULIWANG_COMPANION_EXTENSION_ORIGIN];
    if (!origins.length || origins.some((origin) => !/^chrome-extension:\/\/[a-p]{32}$/u.test(origin))) {
      throw new TypeError("allowedExtensionOrigins must contain exact Chrome extension origins.");
    }
    this.allowedOrigins = new Set(origins);
    this.pairingTimeoutMs = boundedInteger(options.pairingTimeoutMs, 45_000, 120_000);
    this.visitTimeoutMs = boundedInteger(options.visitTimeoutMs, 90_000, 180_000);
    this.pollTimeoutMs = boundedInteger(options.pollTimeoutMs, 20_000, 30_000);
    this.port = options.port === undefined ? 0 : Math.min(65_535, Math.max(0, Math.trunc(options.port)));
    this.client = {
      visit: (url, signal) => this.visit(url, signal),
      inspectCurrent: (signal) => this.inspectCurrent(signal),
      advanceCatalogPage: (currentUrl, signal) => this.advanceCatalogPage(currentUrl, signal),
      advanceChapterPage: (currentUrl, signal) => this.advanceChapterPage(currentUrl, signal),
      close: () => this.close(),
    };
  }

  public async start(): Promise<this> {
    if (this.server || this.closed) throw new Error("Huliwang browser bridge cannot be started twice.");
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch(() => {
        if (!response.headersSent) this.sendText(response, 500, "Bridge request failed.");
        else response.destroy();
      });
    });
    server.maxHeadersCount = 32;
    server.headersTimeout = 5_000;
    server.requestTimeout = 10_000;
    server.keepAliveTimeout = 2_000;
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once("error", onError);
      server.listen(this.port, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    }).catch((error) => {
      this.server = undefined;
      throw new StorySourceError("SOURCE_BLOCKED", "Không thể khởi động cầu nối trình duyệt cục bộ.", { cause: error });
    });

    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
      await this.close();
      throw new StorySourceError("SOURCE_BLOCKED", "Cầu nối trình duyệt không được bind đúng vào loopback IPv4.");
    }
    this.bridgeOrigin = `http://127.0.0.1:${address.port}`;
    const pairingPayload = Buffer.from(JSON.stringify({
      sessionId: this.sessionId,
      token: this.token,
    }), "utf8").toString("base64url");
    this.pairingUrl = `${this.bridgeOrigin}/v1/pair#tdt-pair=${pairingPayload}`;
    return this;
  }

  public waitUntilPaired(signal?: AbortSignal): Promise<void> {
    if (this.closed) return Promise.reject(new StorySourceError("CANCELLED", "Cầu nối trình duyệt đã đóng."));
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.paired) return Promise.resolve();
    if (this.pairingFailure) return Promise.reject(this.pairingFailure);
    return new Promise<void>((resolve, reject) => {
      const waiter: PairWaiter = {
        resolve: () => {
          this.removePairWaiter(waiter);
          resolve();
        },
        reject: (error) => {
          this.removePairWaiter(waiter);
          reject(error);
        },
        timer: setTimeout(() => {
          waiter.reject(new StorySourceError(
            "USER_ACTION_REQUIRED",
            "Chưa nhận được kết nối từ tiện ích Huliwang Companion. Hãy cài/bật tiện ích trong trình duyệt mặc định rồi thử kết nối lại.",
          ));
        }, this.pairingTimeoutMs),
        ...(signal ? { signal } : {}),
      };
      if (signal) {
        waiter.onAbort = () => waiter.reject(abortReason(signal));
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.pairWaiters.add(waiter);
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const error = new StorySourceError("CANCELLED", "Cầu nối trình duyệt đã đóng.");
    for (const waiter of [...this.pairWaiters]) waiter.reject(error);
    this.rejectPending(error);
    for (const response of this.pollWaiters) {
      if (!response.writableEnded) this.sendJson(response, 200, EMPTY_COMMANDS);
    }
    this.pollWaiters.clear();
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
    }
  }

  private visit(rawUrl: string, signal?: AbortSignal): Promise<StoryPageSnapshot> {
    return this.queueVisit(rawUrl, "visit", signal);
  }

  /**
   * Ask the paired companion to click exactly the next button in the catalog
   * currently displayed in its paired Huliwang tab.  The URL deliberately
   * remains the current catalog URL: Huliwang swaps the 50-entry list via
   * JavaScript instead of navigating to an addressable next-page URL.
   */
  private advanceCatalogPage(rawCurrentUrl: string, signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (this.closed) return Promise.reject(new StorySourceError("CANCELLED", "Cầu nối trình duyệt đã đóng."));
    if (!this.paired) {
      return Promise.reject(new StorySourceError(
        "USER_ACTION_REQUIRED",
        "Huliwang Companion chưa kết nối với trình duyệt mặc định.",
      ));
    }
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    let parsed;
    try {
      parsed = validateStoryUrl(rawCurrentUrl, "catalog-next.url");
      if (parsed.kind !== "catalog") throw new TypeError("catalog-next requires a catalog URL.");
    } catch (error) {
      return Promise.reject(new StorySourceError(
        "UNSUPPORTED_URL",
        "Chỉ có thể chuyển trang mục lục Huliwang hiện tại.",
        { cause: error },
      ));
    }

    // Do not turn this companion into a general browser-control channel. A
    // catalog-next command is permitted only after an authenticated snapshot
    // proved that this exact catalog is the page currently paired to the app.
    if (
      !this.lastSnapshot
      || this.lastRequestedUrl !== parsed.normalizedUrl
      || this.lastSnapshot.url !== parsed.normalizedUrl
    ) {
      return Promise.reject(new StorySourceError(
        "SOURCE_BLOCKED",
        "Chưa có snapshot đã xác thực của đúng mục lục Huliwang hiện tại; tool không tự điều khiển tab khác.",
      ));
    }
    if (this.lastSnapshot.challenge !== "none") {
      return Promise.reject(new StorySourceError(
        "SOURCE_BLOCKED",
        "Trang mục lục Huliwang hiện chưa qua xác minh; tool không bấm nút phân trang trong lúc Cloudflare đang kiểm tra.",
      ));
    }
    if (!this.lastSnapshot.catalogPagination?.hasNext) {
      return Promise.reject(new StorySourceError(
        "SOURCE_CHANGED",
        "Mục lục Huliwang hiện tại không xác nhận có trang kế tiếp; tool không tự bấm nút không rõ trạng thái.",
      ));
    }
    return this.queueVisit(parsed.normalizedUrl, "catalog-next", signal);
  }

  /**
   * Ask the companion to use only Huliwang's fixed reader next-page control.
   * It is not a generic click: a previously authenticated snapshot must have
   * proved that this exact chapter page has a continuation, and the result is
   * accepted only if it advances exactly one page of the same chapter.
   */
  private advanceChapterPage(rawCurrentUrl: string, signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (this.closed) return Promise.reject(new StorySourceError("CANCELLED", "Cầu nối trình duyệt đã đóng."));
    if (!this.paired) {
      return Promise.reject(new StorySourceError(
        "USER_ACTION_REQUIRED",
        "Huliwang Companion chưa kết nối với trình duyệt mặc định.",
      ));
    }
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    let parsed;
    try {
      parsed = validateStoryUrl(rawCurrentUrl, "chapter-next.url");
      if (parsed.kind !== "chapter" || !parsed.chapterKey) {
        throw new TypeError("chapter-next requires a Huliwang chapter URL.");
      }
    } catch (error) {
      return Promise.reject(new StorySourceError(
        "UNSUPPORTED_URL",
        "Chỉ có thể chuyển trang trong chương Huliwang hiện tại.",
        { cause: error },
      ));
    }
    if (
      !this.lastSnapshot
      || this.lastRequestedUrl !== parsed.normalizedUrl
      || this.lastSnapshot.url !== parsed.normalizedUrl
    ) {
      return Promise.reject(new StorySourceError(
        "SOURCE_BLOCKED",
        "Chưa có snapshot đã xác thực của đúng trang chương Huliwang hiện tại; tool không tự điều khiển tab khác.",
      ));
    }
    if (this.lastSnapshot.challenge !== "none") {
      return Promise.reject(new StorySourceError(
        "SOURCE_BLOCKED",
        "Trang chương Huliwang hiện chưa qua xác minh; tool không bấm nút phân trang trong lúc Cloudflare đang kiểm tra.",
      ));
    }
    if (!this.lastSnapshot.chapterPagination?.hasNext) {
      return Promise.reject(new StorySourceError(
        "SOURCE_CHANGED",
        "Chương Huliwang hiện tại không xác nhận có trang tiếp theo; tool không tự bấm nút không rõ trạng thái.",
      ));
    }
    return this.queueVisit(
      parsed.normalizedUrl,
      "chapter-next",
      signal,
      this.lastSnapshot.chapterPagination.currentPage,
    );
  }

  private queueVisit(
    rawUrl: string,
    commandType: PendingCommandType,
    signal?: AbortSignal,
    expectedChapterPage?: number,
  ): Promise<StoryPageSnapshot> {
    if (this.closed) return Promise.reject(new StorySourceError("CANCELLED", "Cầu nối trình duyệt đã đóng."));
    if (!this.paired) {
      return Promise.reject(new StorySourceError(
        "USER_ACTION_REQUIRED",
        "Huliwang Companion chưa kết nối với trình duyệt mặc định.",
      ));
    }
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    let parsed;
    try {
      parsed = validateStoryUrl(rawUrl, "visit.url");
    } catch (error) {
      return Promise.reject(new StorySourceError(
        "UNSUPPORTED_URL",
        "Cầu nối trình duyệt chỉ nhận URL truyện Huliwang hợp lệ.",
        { cause: error },
      ));
    }
    if (this.pending) {
      return Promise.reject(new StorySourceError("SOURCE_BLOCKED", "Cầu nối Huliwang đang xử lý một trang khác."));
    }

    return new Promise<StoryPageSnapshot>((resolve, reject) => {
      const command: PendingCommand = {
        id: randomUUID(),
        type: commandType,
        url: parsed.normalizedUrl,
        ...(expectedChapterPage === undefined ? {} : { expectedChapterPage }),
        delivered: false,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.rejectPending(new StorySourceError(
            "USER_ACTION_REQUIRED",
            "Trình duyệt mặc định chưa gửi lại trang Huliwang. Hãy giữ tab ghép nối và tiện ích Huliwang Companion đang bật rồi thử lại.",
          ));
        }, this.visitTimeoutMs),
        ...(signal ? { signal } : {}),
      };
      if (signal) {
        command.onAbort = () => this.rejectPending(abortReason(signal));
        signal.addEventListener("abort", command.onAbort, { once: true });
      }
      this.pending = command;
      this.lastRequestedUrl = command.url;
      this.flushCommandToPoller();
    });
  }

  private inspectCurrent(signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (!this.lastRequestedUrl || !this.lastSnapshot) {
      return Promise.reject(new StorySourceError("SOURCE_BLOCKED", "Trình duyệt mặc định chưa gửi snapshot Huliwang nào."));
    }
    // Ask the extension for a fresh snapshot of the same URL. The companion
    // recognizes that its paired tab is already at this exact URL and reads
    // the DOM in place; it must not call tabs.update/reload. This lets a
    // passive Cloudflare interstitial finish without restarting its timer.
    return this.visit(this.lastRequestedUrl, signal);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.setBaseHeaders(response);
    if (this.closed || !this.bridgeOrigin) return this.sendText(response, 503, "Bridge is closed.");
    if (request.headers.host !== this.bridgeOrigin.slice("http://".length)) {
      return this.sendText(response, 400, "Invalid Host header.");
    }
    if (!request.url || request.url.length > 2_048 || /^https?:/iu.test(request.url)) {
      return this.sendText(response, 400, "Invalid request target.");
    }
    const url = new URL(request.url, this.bridgeOrigin);

    if (request.method === "GET" && url.pathname === "/v1/pair" && !url.search) {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      response.end(pairingPage());
      return;
    }

    const isApiPath = [
      "/v1/extension/pair",
      "/v1/extension/commands",
      "/v1/extension/results",
    ].includes(url.pathname);
    if (!isApiPath) return this.sendText(response, 404, "Not found.");

    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
    if (!this.allowedOrigins.has(origin)) return this.sendText(response, 403, "Extension origin rejected.");
    this.setCorsHeaders(response, origin);
    if (request.method === "OPTIONS") return this.handlePreflight(request, response, url.pathname);
    if (!this.authorized(request)) return this.sendText(response, 401, "Unauthorized.");

    if (request.method === "POST" && url.pathname === "/v1/extension/pair" && !url.search) {
      return this.handlePair(request, response);
    }
    if (request.method === "POST" && url.pathname === "/v1/extension/commands" && !url.search) {
      return this.handleCommands(request, response);
    }
    if (request.method === "POST" && url.pathname === "/v1/extension/results" && !url.search) {
      return this.handleResult(request, response);
    }
    return this.sendText(response, 405, "Method not allowed.");
  }

  private handlePreflight(request: IncomingMessage, response: ServerResponse, pathname: string): void {
    const requestedMethod = request.headers["access-control-request-method"];
    const requestedHeaders = String(request.headers["access-control-request-headers"] ?? "")
      .toLowerCase().split(",").map((header) => header.trim()).filter(Boolean);
    const expectedMethod = "POST";
    if (requestedMethod !== expectedMethod
      || requestedHeaders.some((header) => !["authorization", "content-type"].includes(header))) {
      this.sendText(response, 403, "Preflight rejected.");
      return;
    }
    response.statusCode = 204;
    response.end();
  }

  private async handlePair(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    let extensionVersion: string;
    let parsedExtensionVersion: ExtensionVersion;
    try {
      body = await this.readJson(request, MAX_PAIR_BYTES);
      assertOnlyKeys(body, new Set(["sessionId", "extensionVersion"]));
      if (body.sessionId !== this.sessionId) throw new TypeError("Wrong session.");
      extensionVersion = boundedString(body.extensionVersion, "extensionVersion", 64, false);
      parsedExtensionVersion = parseExtensionVersion(extensionVersion);
    } catch (error) {
      return this.sendText(response, error instanceof RangeError ? 413 : 400, "Invalid pairing request.");
    }
    if (!isExtensionVersionAtLeast(parsedExtensionVersion, MINIMUM_COMPANION_VERSION)) {
      // Do not make a successfully paired compatible helper unusable because
      // of a later stale retry. Before pairing, however, surface the precise
      // upgrade instruction to the app immediately.
      if (!this.paired) this.rejectPairing(incompatibleCompanionVersionError(extensionVersion));
      return this.sendText(
        response,
        426,
        `Huli Browser Helper must be updated to ${HULIWANG_COMPANION_MINIMUM_VERSION} or newer.`,
      );
    }
    this.pairingFailure = undefined;
    if (!this.paired) {
      this.paired = true;
      for (const waiter of [...this.pairWaiters]) waiter.resolve();
    }
    response.statusCode = 204;
    response.end();
  }

  private async handleCommands(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJson(request, 1_024);
      assertOnlyKeys(body, new Set(["sessionId", "since"]));
      if (body.sessionId !== this.sessionId
        || (body.since !== undefined && (typeof body.since !== "string" || body.since.length > 128))) {
        throw new TypeError("Invalid command request.");
      }
    } catch (error) {
      return this.sendText(response, error instanceof RangeError ? 413 : 400, "Invalid command request.");
    }
    if (!this.paired) return this.sendText(response, 409, "Session is not paired.");
    // Keep the command available until its authenticated result is consumed.
    // A browser/service-worker can lose the HTTP response after the server has
    // written it; redelivering the same command id on the next poll prevents a
    // silent 90-second stall. The result endpoint remains exactly-once.
    if (this.pending) {
      this.sendPendingCommand(response);
      return;
    }
    if (this.pollWaiters.size >= 2) return this.sendText(response, 429, "Too many polls.");

    this.pollWaiters.add(response);
    const timer = setTimeout(() => {
      this.pollWaiters.delete(response);
      if (!response.writableEnded) this.sendJson(response, 200, EMPTY_COMMANDS);
    }, this.pollTimeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      this.pollWaiters.delete(response);
    };
    request.once("aborted", cleanup);
    response.once("close", cleanup);
  }

  private async handleResult(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await this.readJson(request, MAX_RESULT_BYTES);
      assertOnlyKeys(body, new Set(["sessionId", "commandId", "ok", "snapshot", "error"]));
      if (body.sessionId !== this.sessionId) throw new TypeError("Wrong session.");
      boundedString(body.commandId, "commandId", 128, false);
      if (typeof body.ok !== "boolean") throw new TypeError("ok is invalid.");
    } catch (error) {
      return this.sendText(response, error instanceof RangeError ? 413 : 400, "Invalid result request.");
    }

    const commandId = body.commandId as string;
    if (this.consumedCommandIds.includes(commandId)) return this.sendText(response, 409, "Result already consumed.");
    const pending = this.pending;
    if (!pending || !pending.delivered || pending.id !== commandId) {
      return this.sendText(response, 409, "Unknown command.");
    }

    if (!body.ok) {
      let message = "Tiện ích trình duyệt không thể đọc trang Huliwang.";
      try {
        const detail = boundedString(body.error, "error", 512, false);
        message = `${message} ${detail}`;
      } catch {
        // Keep a stable, non-sensitive error when the extension sent malformed detail.
      }
      this.consumePending();
      pending.reject(new StorySourceError("SOURCE_BLOCKED", message));
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      const snapshot = validateSnapshot(
        body.snapshot,
        pending.url,
        pending.type,
        pending.expectedChapterPage,
      );
      this.lastSnapshot = snapshot;
      // A chapter pager may update its reader URL from page N to page N+1.
      // Subsequent fixed next-page requests must be bound to that actual
      // authenticated page, not to the command URL that initiated the click.
      this.lastRequestedUrl = snapshot.url;
      this.consumePending();
      pending.resolve(snapshot);
      response.statusCode = 204;
      response.end();
    } catch (error) {
      this.consumePending();
      pending.reject(new StorySourceError(
        "INVALID_CONTENT",
        "Snapshot do tiện ích Huliwang gửi về không hợp lệ hoặc vượt ngoài phạm vi an toàn.",
        { cause: error },
      ));
      this.sendText(response, 400, "Invalid snapshot.");
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    if (typeof header !== "string") return false;
    const match = /^Bearer ([A-Za-z\d_-]{43})$/u.exec(header);
    return Boolean(match?.[1] && safeEqual(match[1], this.token));
  }

  private async readJson(request: IncomingMessage, maximumBytes: number): Promise<Record<string, unknown>> {
    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (!/^application\/json(?:\s*;|$)/u.test(contentType)) throw new TypeError("JSON required.");
    const declared = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > maximumBytes) throw new RangeError("Body too large.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > maximumBytes) throw new RangeError("Body too large.");
      chunks.push(chunk);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!plainRecord(value)) throw new TypeError("JSON object required.");
    return value;
  }

  private flushCommandToPoller(): void {
    const response = this.pollWaiters.values().next().value as ServerResponse | undefined;
    if (!response || !this.pending || this.pending.delivered) return;
    this.pollWaiters.delete(response);
    this.sendPendingCommand(response);
  }

  private sendPendingCommand(response: ServerResponse): void {
    const pending = this.pending;
    if (!pending) return this.sendJson(response, 200, EMPTY_COMMANDS);
    pending.delivered = true;
    this.sendJson(response, 200, JSON.stringify({
      commands: [{ id: pending.id, type: pending.type, url: pending.url }],
    }));
  }

  private consumePending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
    this.consumedCommandIds.push(pending.id);
    while (this.consumedCommandIds.length > 128) this.consumedCommandIds.shift();
  }

  private rejectPending(error: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.consumePending();
    pending.reject(error);
  }

  private rejectPairing(error: StorySourceError): void {
    this.pairingFailure = error;
    for (const waiter of [...this.pairWaiters]) waiter.reject(error);
  }

  private removePairWaiter(waiter: PairWaiter): void {
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    this.pairWaiters.delete(waiter);
  }

  private setBaseHeaders(response: ServerResponse): void {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
  }

  private setCorsHeaders(response: ServerResponse, origin: string): void {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Max-Age", "0");
    response.setHeader("Vary", "Origin");
  }

  private sendJson(response: ServerResponse, status: number, json: string): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(json);
  }

  private sendText(response: ServerResponse, status: number, message: string): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(message);
  }
}

export async function startHuliwangBrowserBridge(
  options: HuliwangBrowserBridgeOptions = {},
): Promise<HuliwangCompanionSession> {
  return new HuliwangBrowserBridge(options).start();
}
