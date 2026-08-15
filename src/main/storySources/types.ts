import type {
  StoryFetchResult,
  StorySite,
  StorySourceAnalysis,
  StorySourceProgress,
} from "../../shared/types.js";

export interface StoryPageLink {
  href: string;
  text: string;
  scopes: string[];
}

export interface StoryPageFontAsset {
  family: string;
  url: string;
  sha256: string;
}

/**
 * Small, allow-listed state reported by the Huliwang companion for its
 * JavaScript catalog pager.  It intentionally carries no selector, URL or
 * arbitrary page data: the main process already owns the exact catalog URL
 * that a companion may advance.
 */
export interface StoryCatalogPagination {
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Small, allow-listed state reported by the Huliwang companion for a
 * chapter's own in-page pager.  It contains no DOM selector, URL, cookie, or
 * script: the main process owns the exact current chapter URL and may ask for
 * only its next verified page.
 */
export interface StoryChapterPagination {
  hasNext: boolean;
  hasPrevious: boolean;
  /** One-based page number shown by Huliwang's reader. */
  currentPage: number;
}

export interface StoryPageSnapshot {
  requestedUrl: string;
  url: string;
  status?: number;
  title: string;
  canonicalUrl?: string;
  charset?: string;
  htmlLanguage?: string;
  bodyText: string;
  elements: Record<string, string[]>;
  links: StoryPageLink[];
  fontFamilies: string[];
  fontUrls: string[];
  /** SHA-256 hashes of font assets that the browser could fetch safely. */
  fontHashes: string[];
  /** Font assets bound to the computed family actually applied to story text. */
  fontAssets?: StoryPageFontAsset[];
  /** Timo Read.init metadata, captured as data rather than evaluated source. */
  readerMetadata?: { bookId?: string; chapterId?: string; sourceId?: string };
  /** State of the Huliwang in-place JavaScript catalog pager, when present. */
  catalogPagination?: StoryCatalogPagination;
  /** State of the Huliwang in-page chapter pager, when present. */
  chapterPagination?: StoryChapterPagination;
  challenge: "none" | "passive" | "interactive";
}

export interface StoryTranscodeResponse {
  status: number;
  content: string;
  message?: string;
}

/** A deliberately small browser boundary so unit/integration tests never need live pages. */
export interface StoryPageClient {
  visit(url: string, signal?: AbortSignal): Promise<StoryPageSnapshot>;
  /**
   * Read the page that was opened by `visit` without navigating again.
   *
   * This is used while a provider performs a passive browser verification:
   * reloading a challenge can restart that verification indefinitely.
   */
  inspectCurrent?(signal?: AbortSignal): Promise<StoryPageSnapshot>;
  /**
   * Advances only the current Huliwang catalog through its own in-page
   * JavaScript pager. Unlike `visit`, this has no arbitrary navigation URL
   * and is available solely from the paired daily-browser companion.
   */
  advanceCatalogPage?(currentUrl: string, signal?: AbortSignal): Promise<StoryPageSnapshot>;
  /**
   * Advances only the current Huliwang chapter through its fixed in-page
   * pager. This is available solely from the paired daily-browser companion
   * and is never a generic browser-control operation.
   */
  advanceChapterPage?(currentUrl: string, signal?: AbortSignal): Promise<StoryPageSnapshot>;
  transcode?(request: {
    bookId: string;
    chapterId: string;
    sourceId: string;
    referer: string;
  }, signal?: AbortSignal): Promise<StoryTranscodeResponse>;
  close?(): Promise<void>;
}

export interface StoryPageClientFactoryOptions {
  profileDirectory: string;
  executablePath?: string;
  headless: boolean;
}

export type StoryPageClientFactory = (
  options: StoryPageClientFactoryOptions,
) => Promise<StoryPageClient>;

/**
 * Opens an exact loopback pairing page in the user's OS-default browser. The
 * launcher receives neither a source URL nor browser/profile flags and must
 * not drive the page or access/copy browser state.
 */
export interface ManualVerificationLaunchOptions {
  /** Exact loopback-owned pairing URL; never a Huliwang page or arbitrary URL. */
  url: string;
}

export type ManualVerificationLauncher = (
  options: ManualVerificationLaunchOptions,
) => Promise<void>;

export interface StoryDecoderInput {
  site: StorySite;
  url: string;
  text: string;
  fontHash: string;
}

/**
 * Font decoders are opt-in and pinned to exact font hashes. A decoder is never
 * tried heuristically against an unknown asset.
 */
export interface StoryTextDecoder {
  readonly id: string;
  readonly version: string;
  readonly supportedFontHashes: readonly string[];
  decode(input: StoryDecoderInput): string | Promise<string>;
}

export interface StorySourceServiceOptions {
  profileDirectory?: string;
  executablePath?: string;
  headless?: boolean;
  pageClient?: StoryPageClient;
  pageClientFactory?: StoryPageClientFactory;
  /**
   * Opens the tool-owned loopback pairing page through the OS default-browser
   * dispatcher. After pairing, the companion returns allow-listed DOM data,
   * never cookies, credentials, or a browser-control session.
   */
  manualVerificationLauncher?: ManualVerificationLauncher;
  /**
   * Creates one authenticated loopback companion session. Kept injectable so
   * source-service tests never need a real HTTP server or browser extension.
   */
  huliwangCompanionFactory?: import("./HuliwangBrowserBridge.js").HuliwangCompanionFactory;
  textDecoders?: readonly StoryTextDecoder[];
  /** Minimum gap between navigations. Defaults to 650 ms. */
  minRequestIntervalMs?: number;
  /** Passive Cloudflare wait (default 30 seconds). No challenge is ever clicked. */
  verificationWaitMs?: number;
  maxCatalogPages?: number;
  maxChapterPages?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface FetchStoryChaptersRequest {
  analysisId: string;
  chapterIds: string[];
}

export type StoryProgressListener = (progress: StorySourceProgress) => void;

export interface StorySourceServiceApi {
  onProgress(listener: StoryProgressListener): () => void;
  analyzeUrl(url: string): Promise<StorySourceAnalysis>;
  openManualVerification(rawUrl: string): Promise<void>;
  fetchChapters(request: FetchStoryChaptersRequest): Promise<StoryFetchResult>;
  cancel(analysisId?: string): Promise<void>;
  close(): Promise<void>;
}

export type StorySourceErrorCode =
  | "UNSUPPORTED_URL"
  | "UNSAFE_REDIRECT"
  | "USER_ACTION_REQUIRED"
  | "SOURCE_BLOCKED"
  | "SOURCE_CHANGED"
  | "SOFT_200"
  | "INVALID_CONTENT"
  | "TIMOTXT_DECODER_REQUIRED"
  | "TIMOTXT_FONT_UNVERIFIED"
  | "TIMOTXT_DECODE_FAILED"
  | "ANALYSIS_NOT_FOUND"
  | "CANCELLED";

export class StorySourceError extends Error {
  public constructor(
    public readonly code: StorySourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorySourceError";
  }
}
