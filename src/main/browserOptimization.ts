import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";

export const EDGE_DISABLED_FEATURES = [
  // Preserve Playwright's built-in Chromium stability/privacy disabled features
  // because Chromium honors only the last --disable-features flag on CLI.
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "BlockOriginHeaderModificationOnRedirect",
  "AutoDeElevate",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
  // Edge bloat / background features
  "PasswordManagerOnboarding",
  "PasswordLeakDetection",
  "AutofillServerCommunication",
  "EdgeShopping",
  "EdgeEntityExtraction",
  "EdgeWallet",
  "EdgeSidebar",
  "EdgeWorkspaces",
  "msEdgeAccountConsistency",
  "Translate",
  "OptimizationHints",
  "MediaRouter",
  "CalculateNativeWinOcclusion",
].join(",");

/**
 * Optimized Edge Chromium flags for Web AI automation:
 * preserves existing logins and lightweight GPU acceleration while capping
 * renderer/V8 memory and disabling background services/session restore.
 */
export const OPTIMIZED_EDGE_AI_WEB_ARGS: readonly string[] = [
  "--disable-blink-features=AutomationControlled",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-save-password-bubble",
  `--disable-features=${EDGE_DISABLED_FEATURES}`,
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-session-crashed-bubble",
  "--hide-crash-restore-bubble",
  "--disable-extensions",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-background-mode",
  "--disable-component-extensions-with-background-pages",
  "--disable-breakpad",
  "--disable-domain-reliability",
  "--disable-client-side-phishing-detection",
  "--disable-speech-api",
  "--disable-notifications",
  "--mute-audio",
  "--no-pings",
  "--disable-gpu-shader-disk-cache",
  "--disk-cache-size=16777216",
  "--media-cache-size=1",
  "--renderer-process-limit=2",
  "--process-per-site",
  "--js-flags=--max-old-space-size=1536",
  "--disable-background-timer-throttling",
  "--enable-features=MemorySaver",
];

/** Optimized Edge flags for Playwright chapter fetching (keeps light GPU + bounded RAM). */
export const OPTIMIZED_EDGE_STORY_CRAWL_ARGS: readonly string[] = [
  "--disable-default-apps",
  "--disable-sync",
  "--disable-save-password-bubble",
  `--disable-features=${EDGE_DISABLED_FEATURES}`,
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-session-crashed-bubble",
  "--hide-crash-restore-bubble",
  "--disable-extensions",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-background-mode",
  "--disable-component-extensions-with-background-pages",
  "--disable-breakpad",
  "--disable-domain-reliability",
  "--disable-client-side-phishing-detection",
  "--disable-speech-api",
  "--disable-notifications",
  "--mute-audio",
  "--no-pings",
  "--disable-gpu-shader-disk-cache",
  "--disk-cache-size=16777216",
  "--media-cache-size=1",
  "--renderer-process-limit=2",
  "--process-per-site",
  "--js-flags=--max-old-space-size=1024",
  "--enable-features=MemorySaver",
];

/** Builds launch arguments for a plain manual Edge login window without leaving background processes. */
export function buildEdgeManualLoginArgs(profileDirectory: string, url: string): string[] {
  return [
    `--user-data-dir=${profileDirectory}`,
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-background-mode",
    "--disable-extensions",
    "--disable-sync",
    "--disable-component-update",
    "--disable-background-networking",
    "--disable-breakpad",
    "--mute-audio",
    "--no-pings",
    "--disable-gpu-shader-disk-cache",
    "--disk-cache-size=16777216",
    "--media-cache-size=1",
    "--js-flags=--max-old-space-size=1024",
    `--disable-features=${EDGE_DISABLED_FEATURES}`,
    url,
  ];
}

/**
 * Clears previous crash flags and background-mode settings in Default/Preferences
 * so Edge never restores old tabs or stays alive invisibly after exit.
 */
export async function normalizeEdgeProfilePreferences(profileDirectory: string): Promise<void> {
  if (!profileDirectory) return;
  const preferencesPath = path.join(profileDirectory, "Default", "Preferences");
  try {
    const raw = await readFile(preferencesPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    const profile = (parsed.profile && typeof parsed.profile === "object" && !Array.isArray(parsed.profile))
      ? { ...(parsed.profile as Record<string, unknown>) }
      : {};
    profile.exit_type = "Normal";
    profile.exited_cleanly = true;

    const session = (parsed.session && typeof parsed.session === "object" && !Array.isArray(parsed.session))
      ? { ...(parsed.session as Record<string, unknown>) }
      : {};
    // 5 = open New Tab page cleanly instead of restoring stale multi-tab sessions.
    session.restore_on_startup = 5;

    const backgroundMode = (parsed.background_mode && typeof parsed.background_mode === "object" && !Array.isArray(parsed.background_mode))
      ? { ...(parsed.background_mode as Record<string, unknown>) }
      : {};
    backgroundMode.enabled = false;

    const hardwareAcceleration = (
      parsed.hardware_acceleration_mode &&
      typeof parsed.hardware_acceleration_mode === "object" &&
      !Array.isArray(parsed.hardware_acceleration_mode)
    )
      ? { ...(parsed.hardware_acceleration_mode as Record<string, unknown>) }
      : {};
    hardwareAcceleration.enabled = true;

    parsed.profile = profile;
    parsed.session = session;
    parsed.background_mode = backgroundMode;
    parsed.hardware_acceleration_mode = hardwareAcceleration;

    await writeFile(preferencesPath, JSON.stringify(parsed), "utf-8");
  } catch {
    // Missing profile directory or unreadable Preferences is non-fatal.
  }
}

const TELEMETRY_HOST_PATTERNS = [
  /(?:^|\.)sentry\.io$/iu,
  /(?:^|\.)browser-intake-datadoghq\.com$/iu,
  /(?:^|\.)statsigapi\.net$/iu,
  /(?:^|\.)google-analytics\.com$/iu,
  /(?:^|\.)googletagmanager\.com$/iu,
  /(?:^|\.)doubleclick\.net$/iu,
  /(?:^|\.)connect\.facebook\.net$/iu,
  /(?:^|\.)clarity\.ms$/iu,
];

/**
 * Aborts non-essential AI web resources (audio/video, heavy webfonts, telemetry)
 * while keeping scripts, styles, XHR/fetch, SSE, images, and Cloudflare/OAuth intact.
 */
export function shouldBlockAiWebResource(resourceType: string, rawUrl: string): boolean {
  if (resourceType === "media" || resourceType === "font") return true;
  if (resourceType === "ping" || resourceType === "cspviolationreport") return true;
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return TELEMETRY_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

export interface OptimizedBrowserContext extends BrowserContext {
  __creatingObserverPage?: boolean;
  __exemptObserverPage?: Page;
}

/**
 * Closes any surplus pages in a Playwright BrowserContext, keeping one target page
 * (and any explicitly exempt temporary observer page).
 */
export async function closeSurplusContextPages(
  context: OptimizedBrowserContext,
  keepPage?: Page,
): Promise<void> {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  if (pages.length <= 1) return;
  const primary = keepPage && !keepPage.isClosed()
    ? keepPage
    : pages.find((candidate) => candidate.url() !== "about:blank" && !candidate.url().startsWith("edge://")) ?? pages[0];
  for (const candidate of pages) {
    if (candidate === primary || candidate === context.__exemptObserverPage) continue;
    await candidate.close().catch(() => undefined);
  }
}

/**
 * Configures a real Playwright BrowserContext for minimal resource usage and
 * strict single-tab operation (closing stray/restored/popup tabs automatically).
 */
export async function configureOptimizedBrowserContext(
  context: OptimizedBrowserContext,
  options: { blockHeavyAiAssets?: boolean } = {},
): Promise<void> {
  await closeSurplusContextPages(context);

  if (typeof context.on === "function") {
    context.on("page", (newPage: Page) => {
      if (context.__creatingObserverPage || newPage === context.__exemptObserverPage) {
        return;
      }
      const openPages = context.pages().filter(
        (candidate) => !candidate.isClosed() && candidate !== context.__exemptObserverPage,
      );
      if (openPages.length > 1) {
        void newPage.close().catch(() => undefined);
      }
    });
  }

  if (options.blockHeavyAiAssets && typeof context.route === "function") {
    await context.route("**/*", (route) => {
      const request = route.request();
      if (shouldBlockAiWebResource(request.resourceType(), request.url())) {
        return route.abort().catch(() => undefined);
      }
      return route.continue().catch(() => undefined);
    }).catch(() => undefined);
  }
}
