import { describe, expect, it } from "vitest";
import {
  HULIWANG_COMPANION_EXTENSION_ORIGIN,
  HULIWANG_COMPANION_MINIMUM_VERSION,
  HuliwangBrowserBridge,
  type HuliwangCompanionSession,
} from "../../src/main/storySources/HuliwangBrowserBridge";
import type { StoryPageSnapshot } from "../../src/main/storySources/types";

interface PairData {
  sessionId: string;
  token: string;
}

function pairing(session: HuliwangCompanionSession): PairData {
  const url = new URL(session.pairingUrl);
  return JSON.parse(Buffer.from(url.hash.slice("#tdt-pair=".length), "base64url").toString("utf8")) as PairData;
}

function headers(token: string, origin = HULIWANG_COMPANION_EXTENSION_ORIGIN): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Origin: origin,
  };
}

function snapshot(url: string, overrides: Partial<StoryPageSnapshot> = {}): StoryPageSnapshot {
  return {
    requestedUrl: url,
    url,
    status: 200,
    title: "第1章 测试",
    canonicalUrl: url,
    charset: "UTF-8",
    htmlLanguage: "zh-CN",
    bodyText: "第一段正文内容足够用于确定页面快照来自真实浏览器。",
    elements: { "#nr": ["第一段正文内容。"], "#nr_title": ["第1章 测试"] },
    links: [{ href: "https://m.huliwang.net/1703891/2.html", text: "下一章", scopes: ["#nr"] }],
    fontFamilies: [],
    fontUrls: [],
    fontHashes: [],
    challenge: "none",
    ...overrides,
  };
}

async function pair(
  session: HuliwangCompanionSession,
  extensionVersion = HULIWANG_COMPANION_MINIMUM_VERSION,
): Promise<PairData> {
  const data = pairing(session);
  const response = await fetch(`${session.bridgeOrigin}/v1/extension/pair`, {
    method: "POST",
    headers: headers(data.token),
    body: JSON.stringify({ sessionId: data.sessionId, extensionVersion }),
  });
  expect(response.status).toBe(204);
  await session.waitUntilPaired();
  return data;
}

async function command(session: HuliwangCompanionSession, data: PairData) {
  const response = await fetch(`${session.bridgeOrigin}/v1/extension/commands`, {
    method: "POST",
    headers: headers(data.token),
    body: JSON.stringify({ sessionId: data.sessionId }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { commands: Array<{ id: string; type: string; url: string }> };
  expect(body.commands).toHaveLength(1);
  return body.commands[0]!;
}

async function result(
  session: HuliwangCompanionSession,
  data: PairData,
  commandId: string,
  page: StoryPageSnapshot,
): Promise<Response> {
  return fetch(`${session.bridgeOrigin}/v1/extension/results`, {
    method: "POST",
    headers: headers(data.token),
    body: JSON.stringify({ sessionId: data.sessionId, commandId, ok: true, snapshot: page }),
  });
}

describe("HuliwangBrowserBridge", () => {
  it("binds only to IPv4 loopback and keeps its bearer token out of HTTP URL components", async () => {
    const bridge = await new HuliwangBrowserBridge({ pairingTimeoutMs: 200 }).start();
    try {
      const url = new URL(bridge.pairingUrl);
      expect(url.origin).toBe(bridge.bridgeOrigin);
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/v1/pair");
      expect(url.search).toBe("");
      const data = pairing(bridge);
      expect(data.token).toMatch(/^[A-Za-z\d_-]{43}$/u);
      expect(url.origin + url.pathname).not.toContain(data.token);
      const pageResponse = await fetch(url.origin + url.pathname);
      expect(pageResponse.status).toBe(200);
      expect(pageResponse.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(await pageResponse.text()).not.toContain(data.token);
    } finally {
      await bridge.close();
    }
  });

  it("requires the exact fixed extension origin and high-entropy bearer token", async () => {
    const bridge = await new HuliwangBrowserBridge({ pairingTimeoutMs: 200 }).start();
    const data = pairing(bridge);
    try {
      const endpoint = `${bridge.bridgeOrigin}/v1/extension/pair`;
      const body = JSON.stringify({ sessionId: data.sessionId, extensionVersion: HULIWANG_COMPANION_MINIMUM_VERSION });
      expect((await fetch(endpoint, { method: "POST", headers: headers("B".repeat(43)), body })).status).toBe(401);
      expect((await fetch(endpoint, {
        method: "POST",
        headers: headers(data.token, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        body,
      })).status).toBe(403);
      expect((await fetch(endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${data.token}`, "Content-Type": "application/json" }, body,
      })).status).toBe(403);
      expect((await fetch(endpoint, { method: "POST", headers: headers(data.token), body })).status).toBe(204);
    } finally {
      await bridge.close();
    }
  });

  it("rejects a stale helper before it can receive commands, then accepts the minimum compatible version", async () => {
    const bridge = await new HuliwangBrowserBridge({ pairingTimeoutMs: 200, visitTimeoutMs: 500 }).start();
    const data = pairing(bridge);
    const pairEndpoint = `${bridge.bridgeOrigin}/v1/extension/pair`;
    const commandEndpoint = `${bridge.bridgeOrigin}/v1/extension/commands`;
    try {
      const stale = await fetch(pairEndpoint, {
        method: "POST",
        headers: headers(data.token),
        body: JSON.stringify({ sessionId: data.sessionId, extensionVersion: "1.0.1" }),
      });
      expect(stale.status).toBe(426);
      await expect(bridge.waitUntilPaired()).rejects.toMatchObject({
        code: "USER_ACTION_REQUIRED",
        message: expect.stringContaining(`tối thiểu ${HULIWANG_COMPANION_MINIMUM_VERSION}`),
      });
      expect((await fetch(commandEndpoint, {
        method: "POST",
        headers: headers(data.token),
        body: JSON.stringify({ sessionId: data.sessionId }),
      })).status).toBe(409);
      await expect(bridge.client.visit("https://m.huliwang.net/1703891/1.html"))
        .rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });

      const compatible = await fetch(pairEndpoint, {
        method: "POST",
        headers: headers(data.token),
        body: JSON.stringify({ sessionId: data.sessionId, extensionVersion: HULIWANG_COMPANION_MINIMUM_VERSION }),
      });
      expect(compatible.status).toBe(204);
      await expect(bridge.waitUntilPaired()).resolves.toBeUndefined();

      const url = "https://m.huliwang.net/1703891/1.html";
      const visit = bridge.client.visit(url);
      const next = await command(bridge, data);
      expect((await result(bridge, data, next.id, snapshot(url))).status).toBe(204);
      await expect(visit).resolves.toMatchObject({ requestedUrl: url });
    } finally {
      await bridge.close();
    }
  });

  it("answers a strict authenticated CORS preflight", async () => {
    const bridge = await new HuliwangBrowserBridge().start();
    try {
      const response = await fetch(`${bridge.bridgeOrigin}/v1/extension/results`, {
        method: "OPTIONS",
        headers: {
          Origin: HULIWANG_COMPANION_EXTENSION_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(HULIWANG_COMPANION_EXTENSION_ORIGIN);
      expect((await fetch(`${bridge.bridgeOrigin}/v1/extension/results`, {
        method: "OPTIONS",
        headers: {
          Origin: HULIWANG_COMPANION_EXTENSION_ORIGIN,
          "Access-Control-Request-Method": "DELETE",
        },
      })).status).toBe(403);
      const commandsPreflight = await fetch(`${bridge.bridgeOrigin}/v1/extension/commands`, {
        method: "OPTIONS",
        headers: {
          Origin: HULIWANG_COMPANION_EXTENSION_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      });
      expect(commandsPreflight.status).toBe(204);
    } finally {
      await bridge.close();
    }
  });

  it("accepts commands only as strict authenticated JSON POST requests", async () => {
    const bridge = await new HuliwangBrowserBridge().start();
    const data = await pair(bridge);
    try {
      const endpoint = `${bridge.bridgeOrigin}/v1/extension/commands`;
      expect((await fetch(`${endpoint}?sessionId=${encodeURIComponent(data.sessionId)}`, {
        headers: { Authorization: `Bearer ${data.token}`, Origin: HULIWANG_COMPANION_EXTENSION_ORIGIN },
      })).status).toBe(405);
      expect((await fetch(endpoint, {
        method: "POST", headers: headers(data.token), body: JSON.stringify({ sessionId: "wrong" }),
      })).status).toBe(400);
      expect((await fetch(endpoint, {
        method: "POST", headers: headers(data.token), body: JSON.stringify({ sessionId: data.sessionId, extra: true }),
      })).status).toBe(400);
      expect((await fetch(endpoint, {
        method: "POST",
        headers: headers(data.token, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        body: JSON.stringify({ sessionId: data.sessionId }),
      })).status).toBe(403);
      expect((await fetch(endpoint, {
        method: "POST", headers: headers("B".repeat(43)), body: JSON.stringify({ sessionId: data.sessionId }),
      })).status).toBe(401);
    } finally {
      await bridge.close();
    }
  });

  it("pairs, queues one exact normalized Huli URL, and resolves a structured snapshot", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const visit = bridge.client.visit("https://www.huliwang.net/1703891/1/1.html?ignored=1#ignored");
      const next = await command(bridge, data);
      expect(next).toEqual({ id: expect.any(String), type: "visit", url: "https://m.huliwang.net/1703891/1.html" });
      const response = await result(bridge, data, next.id, snapshot(next.url));
      expect(response.status).toBe(204);
      await expect(visit).resolves.toMatchObject({
        requestedUrl: next.url,
        url: next.url,
        title: "第1章 测试",
        challenge: "none",
      });
    } finally {
      await bridge.close();
    }
  });

  it("pairs an XSZJ session for fixed visits only and rejects a cross-site snapshot", async () => {
    const bridge = await new HuliwangBrowserBridge({ site: "xszj", visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const url = "https://xszj.org/b/485734/c/856451?page=2";
      const visit = bridge.client.visit(url);
      const rejectedVisit = visit.catch((error: unknown) => error);
      const next = await command(bridge, data);
      expect(next).toEqual({
        id: expect.any(String),
        type: "visit",
        url,
      });
      expect(bridge.client.advanceCatalogPage).toBeUndefined();
      expect(bridge.client.advanceChapterPage).toBeUndefined();

      const invalid = snapshot("https://m.huliwang.net/485734/856451.html", {
        requestedUrl: url,
        url: "https://m.huliwang.net/485734/856451.html",
      });
      expect((await result(bridge, data, next.id, invalid)).status).toBe(400);
      await expect(rejectedVisit).resolves.toMatchObject({ code: "INVALID_CONTENT" });

      const retry = bridge.client.visit(url);
      const retryCommand = await command(bridge, data);
      const xszjSnapshot: StoryPageSnapshot = {
        requestedUrl: url,
        url,
        status: 200,
        title: "第1章 测试（2/2）",
        canonicalUrl: url,
        charset: "UTF-8",
        htmlLanguage: "zh-CN",
        bodyText: "这是 XSZJ 的正常正文内容，人物继续前行，故事没有跳转到其他网站。",
        elements: { h1: ["第1章 测试（2/2）"], "#content": ["这是 XSZJ 的正常正文内容，人物继续前行，故事没有跳转到其他网站。"] },
        links: [],
        fontFamilies: [],
        fontUrls: [],
        fontHashes: [],
        challenge: "none",
      };
      expect((await result(bridge, data, retryCommand.id, xszjSnapshot)).status).toBe(204);
      await expect(retry).resolves.toMatchObject({ url, challenge: "none" });

      const inspect = bridge.client.inspectCurrent!();
      const inspectCommand = await command(bridge, data);
      // Passive Cloudflare checks are sampled in place: the bridge must queue
      // the same fixed URL rather than navigate/reload the ordinary browser.
      expect(inspectCommand).toMatchObject({ type: "visit", url });
      expect((await result(bridge, data, inspectCommand.id, xszjSnapshot)).status).toBe(204);
      await expect(inspect).resolves.toMatchObject({ challenge: "none", url });
    } finally {
      await bridge.close();
    }
  });

  it("redelivers the same pending command until one authenticated result is consumed", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const url = "https://m.huliwang.net/1703891/1.html";
      const visit = bridge.client.visit(url);

      const firstDelivery = await command(bridge, data);
      const retryDelivery = await command(bridge, data);
      expect(retryDelivery).toEqual(firstDelivery);

      expect((await result(bridge, data, retryDelivery.id, snapshot(url))).status).toBe(204);
      await expect(visit).resolves.toMatchObject({ requestedUrl: url, challenge: "none" });
      expect((await result(bridge, data, retryDelivery.id, snapshot(url))).status).toBe(409);
    } finally {
      await bridge.close();
    }
  });

  it("accepts passive challenge snapshots and inspectCurrent queues a fresh same-URL read", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const url = "https://m.huliwang.net/1703891/1.html";
      const firstVisit = bridge.client.visit(url);
      const firstCommand = await command(bridge, data);
      expect((await result(bridge, data, firstCommand.id, snapshot(url, { challenge: "passive" }))).status).toBe(204);
      await expect(firstVisit).resolves.toMatchObject({ challenge: "passive" });

      const inspect = bridge.client.inspectCurrent!();
      const inspectCommand = await command(bridge, data);
      expect(inspectCommand.url).toBe(url);
      expect(inspectCommand.id).not.toBe(firstCommand.id);
      await result(bridge, data, inspectCommand.id, snapshot(url));
      await expect(inspect).resolves.toMatchObject({ challenge: "none" });
    } finally {
      await bridge.close();
    }
  });

  it("advances only the exact current Huliwang catalog through a strict catalog-next command", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const catalogUrl = "https://m.huliwang.net/dir/1703891.html";

      await expect(bridge.client.advanceCatalogPage!(catalogUrl))
        .rejects.toMatchObject({ code: "SOURCE_BLOCKED" });

      const initial = bridge.client.visit(catalogUrl);
      const initialCommand = await command(bridge, data);
      expect(initialCommand).toEqual({ id: expect.any(String), type: "visit", url: catalogUrl });
      expect((await result(bridge, data, initialCommand.id, snapshot(catalogUrl, {
        catalogPagination: { hasNext: true, hasPrevious: false },
      }))).status).toBe(204);
      await initial;

      await expect(bridge.client.advanceCatalogPage!("https://m.huliwang.net/dir/1703891-2.html"))
        .rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
      await expect(bridge.client.advanceCatalogPage!("https://m.huliwang.net/1703891/1.html"))
        .rejects.toMatchObject({ code: "UNSUPPORTED_URL" });

      const advanced = bridge.client.advanceCatalogPage!(catalogUrl);
      const next = await command(bridge, data);
      expect(next).toEqual({ id: expect.any(String), type: "catalog-next", url: catalogUrl });
      expect((await result(bridge, data, next.id, snapshot(catalogUrl, {
        catalogPagination: { hasNext: false, hasPrevious: true },
      }))).status).toBe(204);
      await expect(advanced).resolves.toMatchObject({
        requestedUrl: catalogUrl,
        url: catalogUrl,
        catalogPagination: { hasNext: false, hasPrevious: true },
      });

      await expect(bridge.client.advanceCatalogPage!(catalogUrl))
        .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    } finally {
      await bridge.close();
    }
  });

  it("advances one Huliwang chapter page at a time and stops before the next chapter", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const pageOne = "https://m.huliwang.net/1703891/50.html";
      const pageTwo = "https://m.huliwang.net/1703891/50/2.html";
      const pageThree = "https://m.huliwang.net/1703891/50/3.html";

      const initial = bridge.client.visit(pageOne);
      const initialCommand = await command(bridge, data);
      await result(bridge, data, initialCommand.id, snapshot(pageOne, {
        chapterPagination: { hasNext: true, hasPrevious: false, currentPage: 1 },
      }));
      await initial;

      const second = bridge.client.advanceChapterPage!(pageOne);
      const secondCommand = await command(bridge, data);
      expect(secondCommand).toEqual({ id: expect.any(String), type: "chapter-next", url: pageOne });
      expect((await result(bridge, data, secondCommand.id, snapshot(pageOne, {
        url: pageTwo,
        canonicalUrl: pageTwo,
        chapterPagination: { hasNext: true, hasPrevious: true, currentPage: 2 },
      }))).status).toBe(204);
      await expect(second).resolves.toMatchObject({
        url: pageTwo,
        chapterPagination: { hasNext: true, hasPrevious: true, currentPage: 2 },
      });

      const third = bridge.client.advanceChapterPage!(pageTwo);
      const thirdCommand = await command(bridge, data);
      expect(thirdCommand).toEqual({ id: expect.any(String), type: "chapter-next", url: pageTwo });
      expect((await result(bridge, data, thirdCommand.id, snapshot(pageTwo, {
        url: pageThree,
        canonicalUrl: pageThree,
        chapterPagination: { hasNext: false, hasPrevious: true, currentPage: 3 },
      }))).status).toBe(204);
      await expect(third).resolves.toMatchObject({
        url: pageThree,
        chapterPagination: { hasNext: false, hasPrevious: true, currentPage: 3 },
      });

      // A new chapter may be linked in the DOM, but the bridge will not issue
      // another reader-page click once the terminal page reports no next page.
      await expect(bridge.client.advanceChapterPage!(pageThree))
        .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    } finally {
      await bridge.close();
    }
  });

  it("fails closed when catalog-next returns a chapter, another catalog URL, or invalid pager metadata", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const catalogUrl = "https://m.huliwang.net/dir/1703891.html";
      const initial = bridge.client.visit(catalogUrl);
      const initialCommand = await command(bridge, data);
      await result(bridge, data, initialCommand.id, snapshot(catalogUrl, {
        catalogPagination: { hasNext: true, hasPrevious: false },
      }));
      await initial;

      const chapterResult = bridge.client.advanceCatalogPage!(catalogUrl);
      const chapterOutcome = expect(chapterResult).rejects.toMatchObject({ code: "INVALID_CONTENT" });
      const chapterCommand = await command(bridge, data);
      expect((await result(bridge, data, chapterCommand.id, snapshot(catalogUrl, {
        url: "https://m.huliwang.net/1703891/1.html",
      }))).status).toBe(400);
      await chapterOutcome;

      const freshInitial = bridge.client.visit(catalogUrl);
      const freshCommand = await command(bridge, data);
      await result(bridge, data, freshCommand.id, snapshot(catalogUrl, {
        catalogPagination: { hasNext: true, hasPrevious: false },
      }));
      await freshInitial;

      const invalidMetadata = bridge.client.advanceCatalogPage!(catalogUrl);
      const invalidOutcome = expect(invalidMetadata).rejects.toMatchObject({ code: "INVALID_CONTENT" });
      const invalidCommand = await command(bridge, data);
      const invalidResponse = await fetch(`${bridge.bridgeOrigin}/v1/extension/results`, {
        method: "POST",
        headers: headers(data.token),
        body: JSON.stringify({
          sessionId: data.sessionId,
          commandId: invalidCommand.id,
          ok: true,
          snapshot: {
            ...snapshot(catalogUrl),
            catalogPagination: { hasNext: "yes", hasPrevious: false },
          },
        }),
      });
      expect(invalidResponse.status).toBe(400);
      await invalidOutcome;
    } finally {
      await bridge.close();
    }
  });

  it("never advances the in-page catalog pager while Cloudflare is still verifying", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const catalogUrl = "https://m.huliwang.net/dir/1703891.html";
      const initial = bridge.client.visit(catalogUrl);
      const initialCommand = await command(bridge, data);
      await result(bridge, data, initialCommand.id, snapshot(catalogUrl, {
        challenge: "passive",
        catalogPagination: { hasNext: true, hasPrevious: false },
      }));
      await initial;

      await expect(bridge.client.advanceCatalogPage!(catalogUrl))
        .rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
    } finally {
      await bridge.close();
    }
  });

  it("rejects non-Huli commands, unsafe snapshot URLs, wrong books, and oversized request bodies", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      await expect(bridge.client.visit("https://www.timotxt.com/1509589610/13.html"))
        .rejects.toBeInstanceOf(Error);

      const url = "https://m.huliwang.net/1703891/1.html";
      const visit = bridge.client.visit(url);
      const visitOutcome = expect(visit).rejects.toMatchObject({ code: "INVALID_CONTENT" });
      const next = await command(bridge, data);
      const unsafe = snapshot(url, { url: "https://m.huliwang.net/9999999/1.html" });
      expect((await result(bridge, data, next.id, unsafe)).status).toBe(400);
      await visitOutcome;

      const huge = "x".repeat(2 * 1024 * 1024 + 1);
      const response = await fetch(`${bridge.bridgeOrigin}/v1/extension/results`, {
        method: "POST",
        headers: headers(data.token),
        body: huge,
      });
      expect(response.status).toBe(413);
    } finally {
      await bridge.close();
    }
  });

  it("rejects replayed, unknown, undelivered, and concurrent commands deterministically", async () => {
    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 500 }).start();
    try {
      const data = await pair(bridge);
      const url = "https://m.huliwang.net/1703891/1.html";
      const first = bridge.client.visit(url);
      await expect(bridge.client.visit("https://m.huliwang.net/1703891/2.html"))
        .rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
      const next = await command(bridge, data);
      expect((await result(bridge, data, "unknown-command", snapshot(url))).status).toBe(409);
      expect((await result(bridge, data, next.id, snapshot(url))).status).toBe(204);
      await first;
      expect((await result(bridge, data, next.id, snapshot(url))).status).toBe(409);
    } finally {
      await bridge.close();
    }
  });

  it("times out pairing/visits, propagates abort, and cleans up pending work on close", async () => {
    const pairingBridge = await new HuliwangBrowserBridge({ pairingTimeoutMs: 20 }).start();
    await expect(pairingBridge.waitUntilPaired()).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    await pairingBridge.close();

    const bridge = await new HuliwangBrowserBridge({ visitTimeoutMs: 20 }).start();
    const data = await pair(bridge);
    await expect(bridge.client.visit("https://m.huliwang.net/1703891/1.html"))
      .rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });

    const controller = new AbortController();
    const aborted = bridge.client.visit("https://m.huliwang.net/1703891/2.html", controller.signal);
    controller.abort(new Error("test abort"));
    await expect(aborted).rejects.toThrow("test abort");

    const pending = bridge.client.visit("https://m.huliwang.net/1703891/3.html");
    await bridge.close();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(fetch(`${bridge.bridgeOrigin}/v1/pair`)).rejects.toBeInstanceOf(Error);
    expect(data.token).toHaveLength(43);
  });
});
