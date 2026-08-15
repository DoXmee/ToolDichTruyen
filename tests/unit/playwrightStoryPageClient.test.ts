import { describe, expect, it } from "vitest";
import type { BrowserContext, Page, Response } from "playwright-core";
import { PlaywrightPageClient } from "../../src/main/storySources/PlaywrightStoryPageClient";
import type { StoryPageSnapshot } from "../../src/main/storySources/types";

function documentData(overrides: Partial<StoryPageSnapshot> = {}) {
  return {
    url: "https://m.huliwang.net/dir/1703891.html",
    title: "Just a moment...",
    canonicalUrl: undefined,
    charset: "UTF-8",
    htmlLanguage: "en-US",
    bodyText: "Performing security verification Cloudflare Ray ID",
    elements: {},
    links: [],
    fontFamilies: [],
    fontAssets: [],
    readerMetadata: undefined,
    challenge: "passive" as const,
    ...overrides,
  };
}

describe("PlaywrightPageClient Cloudflare status tracking", () => {
  it("replaces the initial challenge 403 after the same tab navigates to story content with HTTP 200", async () => {
    const mainFrame = {};
    const responseHandlers: Array<(response: Response) => void> = [];
    let currentDocument = documentData();

    const response = (status: number): Response => ({
      status: () => status,
      frame: () => mainFrame,
      request: () => ({ isNavigationRequest: () => true }),
    } as unknown as Response);

    const page = {
      on: (event: string, handler: (value: Response) => void) => {
        if (event === "response") responseHandlers.push(handler);
      },
      mainFrame: () => mainFrame,
      goto: async () => {
        const blocked = response(403);
        responseHandlers.forEach((handler) => handler(blocked));
        return blocked;
      },
      evaluate: async () => currentDocument,
      url: () => currentDocument.url,
      close: async () => undefined,
    } as unknown as Page;
    const context = { newPage: async () => page } as unknown as BrowserContext;
    const networkGuard = {
      assert: async () => undefined,
      clearNavigationFailure: () => undefined,
      takeNavigationFailure: () => undefined,
    };
    const client = new PlaywrightPageClient(context, networkGuard as never);

    const challenge = await client.visit("https://m.huliwang.net/dir/1703891.html");
    expect(challenge).toMatchObject({ status: 403, challenge: "passive" });

    currentDocument = documentData({
      title: "Mục lục truyện",
      bodyText: "Nội dung trang truyện đã tải xong sau khi xác minh.",
      challenge: "none",
    });
    const accepted = response(200);
    responseHandlers.forEach((handler) => handler(accepted));

    const inspected = await client.inspectCurrent();
    expect(inspected).toMatchObject({
      status: 200,
      challenge: "none",
      title: "Mục lục truyện",
    });
  });
});
