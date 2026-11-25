import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import {
  buildEdgeManualLoginArgs,
  closeSurplusContextPages,
  configureOptimizedBrowserContext,
  normalizeEdgeProfilePreferences,
  OPTIMIZED_EDGE_AI_WEB_ARGS,
  OPTIMIZED_EDGE_STORY_CRAWL_ARGS,
  shouldBlockAiWebResource,
  type OptimizedBrowserContext,
} from "../../src/main/browserOptimization.js";

describe("browserOptimization", () => {
  it("normalizes crashed Edge Preferences cleanly while preserving account_info", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "edge-opt-pref-"));
    try {
      const defDir = path.join(tmpDir, "Default");
      await mkdir(defDir, { recursive: true });
      const prefPath = path.join(defDir, "Preferences");
      await writeFile(
        prefPath,
        JSON.stringify({
          account_info: [{ email: "user@example.com" }],
          profile: { exit_type: "Crashed", exited_cleanly: false, name: "Default" },
          session: { restore_on_startup: 1 },
          background_mode: { enabled: true },
          hardware_acceleration_mode: { enabled: false },
        }),
        "utf-8",
      );

      await normalizeEdgeProfilePreferences(tmpDir);
      const updated = JSON.parse(await readFile(prefPath, "utf-8"));
      expect(updated.account_info).toEqual([{ email: "user@example.com" }]);
      expect(updated.profile).toMatchObject({
        exit_type: "Normal",
        exited_cleanly: true,
        name: "Default",
      });
      expect(updated.session.restore_on_startup).toBe(5);
      expect(updated.background_mode.enabled).toBe(false);
      expect(updated.hardware_acceleration_mode.enabled).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces memory, process limits, and lightweight GPU flags without disabling GPU or triggering OOM", () => {
    for (const args of [OPTIMIZED_EDGE_AI_WEB_ARGS, OPTIMIZED_EDGE_STORY_CRAWL_ARGS]) {
      expect(args).not.toContain("--disable-gpu");
      expect(args).not.toContain("--memory-model=low");
      expect(args).toContain("--disable-gpu-shader-disk-cache");
      expect(args).toContain("--disable-background-mode");
      expect(args).toContain("--hide-crash-restore-bubble");
      expect(args).toContain("--disable-session-crashed-bubble");
      expect(args).toContain("--process-per-site");
      expect(args).toContain("--renderer-process-limit=2");
    }
    expect(OPTIMIZED_EDGE_AI_WEB_ARGS).toContain("--js-flags=--max-old-space-size=1536");
    expect(OPTIMIZED_EDGE_STORY_CRAWL_ARGS).toContain("--js-flags=--max-old-space-size=1024");

    const loginArgs = buildEdgeManualLoginArgs("C:\\profile", "https://chatgpt.com/");
    expect(loginArgs).toContain("--user-data-dir=C:\\profile");
    expect(loginArgs).toContain("--disable-background-mode");
    expect(loginArgs).toContain("--js-flags=--max-old-space-size=1024");
    expect(loginArgs).not.toContain("--disable-gpu");
    expect(loginArgs[loginArgs.length - 1]).toBe("https://chatgpt.com/");
  });

  it("blocks telemetry/media/fonts while preserving AI API, auth, and Cloudflare assets", () => {
    expect(shouldBlockAiWebResource("media", "https://chatgpt.com/video.mp4")).toBe(true);
    expect(shouldBlockAiWebResource("font", "https://cdn.oaistatic.com/font.woff2")).toBe(true);
    expect(shouldBlockAiWebResource("ping", "https://chatgpt.com/ping")).toBe(true);
    expect(shouldBlockAiWebResource("xhr", "https://o123.ingest.sentry.io/api/1/envelope/")).toBe(true);
    expect(shouldBlockAiWebResource("script", "https://www.googletagmanager.com/gtag/js")).toBe(true);

    expect(shouldBlockAiWebResource("fetch", "https://chatgpt.com/backend-api/conversation")).toBe(false);
    expect(shouldBlockAiWebResource("script", "https://challenges.cloudflare.com/turnstile/v0/api.js")).toBe(false);
    expect(shouldBlockAiWebResource("document", "https://accounts.google.com/o/oauth2/v2/auth")).toBe(false);
    expect(shouldBlockAiWebResource("image", "https://chatgpt.com/qr.png")).toBe(false);
  });

  it("closes surplus tabs and auto-closes unexpected new tabs while allowing exempt observer page", async () => {
    const mkPage = (url: string) => {
      let closed = false;
      return {
        url: () => url,
        isClosed: () => closed,
        close: vi.fn(async () => {
          closed = true;
        }),
      } as unknown as Page;
    };

    const blankPage = mkPage("about:blank");
    const mainPage = mkPage("https://chatgpt.com/");
    const strayPage = mkPage("https://example.com/ad");
    const pages: Page[] = [blankPage, mainPage];
    const pageListeners: Array<(p: Page) => void> = [];

    const context = {
      pages: () => pages,
      on: (event: string, listener: (p: Page) => void) => {
        if (event === "page") pageListeners.push(listener);
      },
      route: vi.fn(async () => undefined),
    } as unknown as OptimizedBrowserContext;

    await configureOptimizedBrowserContext(context, { blockHeavyAiAssets: true });
    expect(blankPage.close).toHaveBeenCalledTimes(1);
    expect(mainPage.close).not.toHaveBeenCalled();
    expect(context.route).toHaveBeenCalledTimes(1);

    // Unexpected new tab gets closed immediately
    pages.push(strayPage);
    for (const listener of pageListeners) listener(strayPage);
    await Promise.resolve();
    expect(strayPage.close).toHaveBeenCalledTimes(1);

    // Exempt Kimi observer page stays open until closed explicitly
    const observerPage = mkPage("https://www.kimi.ai/chat/123");
    context.__creatingObserverPage = true;
    pages.push(observerPage);
    for (const listener of pageListeners) listener(observerPage);
    context.__exemptObserverPage = observerPage;
    context.__creatingObserverPage = false;
    await Promise.resolve();
    expect(observerPage.close).not.toHaveBeenCalled();

    // closeSurplusContextPages also respects __exemptObserverPage
    await closeSurplusContextPages(context, mainPage);
    expect(observerPage.close).not.toHaveBeenCalled();
    expect(mainPage.close).not.toHaveBeenCalled();
  });
});
