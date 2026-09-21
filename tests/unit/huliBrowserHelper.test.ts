// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// The runtime dependency is present through Vitest; this recovered workspace
// intentionally does not add @types/jsdom solely for this isolated DOM test.
// @ts-expect-error jsdom has no declaration in the packaged dependency graph.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const root = resolve("resources/huli-browser-helper");
const protocol = await import(new URL(`../../resources/huli-browser-helper/lib/protocol.js`, import.meta.url).href);
const snapshotLib = await import(new URL(`../../resources/huli-browser-helper/lib/snapshot.js`, import.meta.url).href);

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("Huli normal-browser helper", () => {
  it("has a domain-flexible MV3 manifest with a stable extension id key", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe("1.0.8");
    expect(manifest.name).toBe("Tool Dịch Truyện - Browser Helper");
    expect(manifest.description).toContain("Novel543");
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.host_permissions).toEqual(["https://*/*", "http://127.0.0.1/*"]);
    expect(manifest.permissions).not.toEqual(expect.arrayContaining(["cookies", "history", "debugger", "webRequest", "scripting"]));
    expect(manifest.key).toMatch(/^MIIB/);
    const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
    const extensionId = [...digest].map((hex) => String.fromCharCode(97 + Number.parseInt(hex, 16))).join("");
    expect(extensionId).toBe("pnokdbiaajanoohgcaleeedhijgjkmhd");
  });

  it("derives only an exact loopback bridge origin", () => {
    expect(protocol.bridgeOriginFromLoopbackUrl("http://127.0.0.1:34567/v1/pair#x")).toBe("http://127.0.0.1:34567");
    for (const url of ["http://localhost:34567/v1/pair", "https://127.0.0.1:34567/v1/pair", "http://127.0.0.1:80/v1/pair", "http://127.0.0.1:70000/v1/pair"]) {
      expect(() => protocol.bridgeOriginFromLoopbackUrl(url)).toThrow();
    }
  });

  it("accepts only the exact loopback pairing route", () => {
    expect(protocol.assertPairingPageUrl("http://127.0.0.1:34567/v1/pair#tdt-pair=x")).toBe("http://127.0.0.1:34567");
    expect(() => protocol.assertPairingPageUrl("http://127.0.0.1:34567/other#tdt-pair=x")).toThrow();
    expect(() => protocol.assertPairingPageUrl("http://127.0.0.1:34567/v1/pair?q=x#tdt-pair=x")).toThrow();
  });

  it("accepts an Edge Port sender exposing only tab.url and rejects extension/unsafe senders", () => {
    const pairingUrl = "http://127.0.0.1:34567/v1/pair#tdt-pair=x";
    expect(protocol.resolveHeartbeatSenderUrl({ tab: { id: 7, url: pairingUrl } })).toBe(pairingUrl);
    expect(protocol.resolveHeartbeatSenderUrl({ tab: { id: 8, url: "https://m.huliwang.net/1703891/1.html" } })).toBe("https://m.huliwang.net/1703891/1.html");
    expect(protocol.resolveHeartbeatSenderUrl({ url: "chrome-extension://pnokdbiaajanoohgcaleeedhijgjkmhd/popup.html" })).toBeUndefined();
    expect(protocol.resolveHeartbeatSenderUrl({ tab: { id: 9, url: "https://evil.test/" }, url: pairingUrl })).toBeUndefined();
    expect(protocol.resolveHeartbeatSenderUrl(undefined)).toBeUndefined();
  });

  it("accepts only the exact pairing fields and strong base64url credentials", () => {
    const valid = { sessionId: "A234567890123456", token: "b".repeat(43) };
    expect(protocol.decodePairingFragment(`#tdt-pair=${encode(valid)}`)).toEqual(valid);
    expect(() => protocol.decodePairingFragment(`#tdt-pair=${encode({ ...valid, port: 4567 })}`)).toThrow();
    expect(() => protocol.decodePairingFragment(`#tdt-pair=${encode({ ...valid, token: "short" })}`)).toThrow();
    expect(() => protocol.decodePairingFragment(`#other=${encode(valid)}`)).toThrow();
  });

  it("allow-lists only supported HTTPS Huli book/catalog/chapter URLs", () => {
    expect(protocol.normalizeHuliUrl("https://www.huliwang.net/1703891/36/3.html?q=x#y")).toBe("https://www.huliwang.net/1703891/36/3.html");
    expect(protocol.normalizeHuliUrl("https://m.huliwang.net/dir/1703891.html")).toBe("https://m.huliwang.net/dir/1703891.html");
    expect(protocol.normalizeHuliUrl("https://www.ihuliwang.com/1703891/1.html")).toBe("https://www.ihuliwang.com/1703891/1.html");
    expect(protocol.normalizeHuliUrl("https://huliwang.ai/1703891/1.html")).toBe("https://huliwang.ai/1703891/1.html");
    for (const url of ["http://m.huliwang.net/1703891/1.html", "https://m.huliwang.net.evil.test/1703891/1.html", "https://m.huliwang.net/not-supported"]) {
      expect(() => protocol.normalizeHuliUrl(url)).toThrow();
    }
  });

  it("allow-lists and canonicalizes only exact Novel543 routes", () => {
    expect(protocol.normalizeNovel543Url("https://novel543.com/1013669909/?from=x#y")).toBe("https://www.novel543.com/1013669909/");
    expect(protocol.normalizeNovel543Url("https://www.novel543.com/1013669909/dir?q=x")).toBe("https://www.novel543.com/1013669909/dir");
    expect(protocol.normalizeNovel543Url("https://novel543.com/1013669909/8096_1_2.html#x")).toBe("https://www.novel543.com/1013669909/8096_1_2.html");
    expect(protocol.normalizeNovel543Url("https://novel543.net/1013669909/8096_1_2.html#x")).toBe("https://www.novel543.net/1013669909/8096_1_2.html");
    expect(protocol.companionSite("https://www.novel543.com/1013669909/dir")).toBe("novel543");
    for (const url of [
      "http://novel543.com/1013669909/",
      "https://evil.novel543.com/1013669909/",
      "https://www.novel543.com.evil.test/1013669909/",
      "https://user:pass@www.novel543.com/1013669909/",
      "https://www.novel543.com:444/1013669909/",
      "https://www.novel543.com/not-a-book/",
      "https://www.novel543.com/1013669909/8096_1.html/extra",
    ]) expect(() => protocol.normalizeNovel543Url(url)).toThrow();
  });

  it("ships a passive Novel543 content reader with fixed selectors and no verification clicks", async () => {
    const script = await readFile(resolve(root, "novel543-content.js"), "utf8");
    expect(script).toContain('".chaplist .all"');
    expect(script).toContain('".chapter-content .content"');
    expect(script).toContain("ONEAD");
    expect(script).toContain("溫馨提示");
    expect(script).not.toMatch(/\.click\s*\(|chrome\.scripting|executeScript|debugger/iu);
  });

  it("accepts only fixed visit/catalog-next/chapter-next commands and does not put the token in a URL", () => {
    expect(protocol.validateVisitCommand({ id: "cmd_1", type: "visit", url: "https://m.huliwang.net/1703891/1.html" })).toEqual({ id: "cmd_1", type: "visit", url: "https://m.huliwang.net/1703891/1.html" });
    expect(protocol.validateCompanionCommand({ id: "cmd_2", type: "catalog-next", url: "https://m.huliwang.net/dir/1703891.html" })).toEqual({ id: "cmd_2", type: "catalog-next", url: "https://m.huliwang.net/dir/1703891.html" });
    expect(protocol.validateCompanionCommand({ id: "cmd_2b", type: "chapter-next", url: "https://m.huliwang.net/1703891/50/2.html" })).toEqual({ id: "cmd_2b", type: "chapter-next", url: "https://m.huliwang.net/1703891/50/2.html" });
    expect(protocol.validateVisitCommand({ id: "cmd_n", type: "visit", url: "https://novel543.com/1013669909/8096_1_2.html" })).toEqual({ id: "cmd_n", type: "visit", url: "https://www.novel543.com/1013669909/8096_1_2.html" });
    expect(() => protocol.validateCompanionCommand({ id: "cmd_n2", type: "chapter-next", url: "https://www.novel543.com/1013669909/8096_1.html" })).toThrow();
    expect(() => protocol.validateVisitCommand({ id: "cmd_1", type: "script", url: "https://m.huliwang.net/1703891/1.html" })).toThrow();
    expect(() => protocol.validateVisitCommand({ id: "cmd_1", type: "visit", url: "https://m.huliwang.net/1703891/1.html", script: "x" })).toThrow();
    expect(() => protocol.validateCompanionCommand({ id: "cmd_3", type: "catalog-next", url: "https://m.huliwang.net/1703891/1.html" })).toThrow();
    expect(() => protocol.validateCompanionCommand({ id: "cmd_3b", type: "chapter-next", url: "https://m.huliwang.net/dir/1703891.html" })).toThrow();
    const headers = protocol.authHeaders("t".repeat(43), true);
    expect(headers.Authorization).toBe(`Bearer ${"t".repeat(43)}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("never updates or reloads a paired tab already on the requested URL", () => {
    const url = "https://m.huliwang.net/1703891/1.html";
    expect(protocol.pairedTabAction(url, url)).toEqual({ type: "reuse", url });
    expect(protocol.pairedTabAction("http://127.0.0.1:34567/v1/pair", url)).toEqual({ type: "navigate", url });
    expect(protocol.pairedTabAction(undefined, url, false)).toEqual({ type: "create", url, active: true });
    expect(protocol.mustWaitForPairedTab("reuse", "complete")).toBe(false);
    expect(protocol.mustWaitForPairedTab("reuse", "loading")).toBe(true);
    expect(protocol.mustWaitForPairedTab("navigate", "complete")).toBe(true);
    expect(protocol.mustWaitForPairedTab("create", "complete")).toBe(true);
    expect(protocol.pairedTabAction(
      "https://www.huliwang.net/1703891/1/1.html",
      "https://m.huliwang.net/1703891/1.html",
    )).toEqual({ type: "reuse", url: "https://www.huliwang.net/1703891/1/1.html" });
  });

  it("bounds catalog snapshot readiness while keeping challenge snapshots passive", async () => {
    expect(protocol.CATALOG_SNAPSHOT_READY_TIMEOUT_MS).toBe(8_000);
    expect(protocol.CATALOG_SNAPSHOT_READY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(protocol.SNAPSHOT_TIMEOUT_MS).toBe(12_000);
    expect(protocol.SNAPSHOT_TIMEOUT_MS).toBeGreaterThan(protocol.CATALOG_SNAPSHOT_READY_TIMEOUT_MS);
    expect(protocol.MAX_SNAPSHOT_BYTES).toBe(1_900_000);
    expect(protocol.MAX_SNAPSHOT_BYTES).toBeLessThan(2 * 1024 * 1024);
    const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
    const collectFunction = /async function collectSnapshot\([\s\S]*?\n\}/u.exec(worker)?.[0] ?? "";
    expect(collectFunction).toContain("chrome.tabs.sendMessage");
    expect(collectFunction.match(/chrome\.tabs\.sendMessage/gu)).toHaveLength(1);
    expect(collectFunction).toContain("SNAPSHOT_TIMEOUT_MS");
    expect(collectFunction).not.toMatch(/while\s*\(|do\s*\{|30_000|delay\s*\(/u);
    expect(worker).not.toContain("collectWithPassiveWait");
  });

  it("collects only allow-listed Huli links and cleaned story selectors", () => {
    const dom = new JSDOM(`<!doctype html><html lang="zh"><head><title>第1章</title><link rel="canonical" href="https://www.huliwang.net/1703891/1.html"></head><body><h1>书名</h1><div id="nr_title">第1章 开始</div><div id="nr">第一段<br>第二段<div class="adBlock">广告</div></div><a href="/1703891/2.html">下一章</a><a href="https://evil.test/">站外</a></body></html>`, { url: "https://m.huliwang.net/1703891/1.html" });
    const snapshot = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/1.html");
    expect(snapshot.elements["#nr"]).toEqual(["第一段\n第二段"]);
    expect(snapshot.links).toEqual([{ href: "https://m.huliwang.net/1703891/2.html", text: "下一章", scopes: [] }]);
    expect(snapshot.canonicalUrl).toBe("https://www.huliwang.net/1703891/1.html");
    expect(snapshot.challenge).toBe("none");
    expect(snapshot).not.toHaveProperty("fontAssets");
    expect(snapshotLib.SNAPSHOT_SELECTORS).toEqual(expect.arrayContaining(["#chapterList", ".chapter-list", "#pagination", ".pagination"]));
  });

  it("preserves #nr paragraph boundaries and exposes a reader continuation only for a terminal incomplete marker", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div id="nr_title">第50章 第1页</div>
      <div id="nr"><p>第一段。</p><div>第二段。<br>仍在第二段。</div><p>本章未完，点击下一页继续阅读</p><div class="adBlock">广告</div></div>
       <div class="nr_page"><button id="pt_prev" disabled>上一页</button><button id="pt_next" data-url="/1703891/50/2.html">下一页</button></div>
    </body></html>`, { url: "https://m.huliwang.net/1703891/50.html" });
    const first = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/50.html");
    expect(first.elements["#nr"]).toEqual(["第一段。\n第二段。\n仍在第二段。\n本章未完，点击下一页继续阅读"]);
    // The sentinel is intentionally retained. The adapter must prove and read
    // the next part before it removes the footer from final story text.
    expect(first.elements["#nr"]?.[0]).toContain("本章未完");
    expect(first.chapterPagination).toEqual({ hasNext: true, hasPrevious: false, currentPage: 1 });
    expect(snapshotLib.resolveChapterNextTarget(dom.window.document)).toBe("https://m.huliwang.net/1703891/50/2.html");

    dom.window.document.querySelector("#nr")!.innerHTML = "<p>第三页结尾。</p>";
    const final = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/50.html");
    expect(final.elements["#nr"]).toEqual(["第三页结尾。"]);
    expect(final.chapterPagination).toEqual({ hasNext: false, hasPrevious: false, currentPage: 1 });
    expect(snapshotLib.resolveChapterNextTarget(dom.window.document)).toBeUndefined();
  });

  it("recognizes Huli's complete multi-line incomplete-page footer only with its safe same-chapter data-url", () => {
    const fullFooter = [
      "本章未完，点击下一页继续~",
      "此页为本章 第1页 / 共3页~",
      "如内容不全或无法翻页",
      "或提示是最新章节",
      "请退出[阅#读#模#式]",
      "(^ ^) (^ ^)",
    ].join("\n");
    const dom = new JSDOM(`<!doctype html><html><body>
      <div id="nr_title">第50章 第1页</div>
      <div id="nr"><p>第一部分正文。</p><p>${fullFooter}</p></div>
      <div class="nr_page">
        <button id="pt_next" data-url="/1703891/50/2.html">下一页</button>
        <button id="pt_next" data-url="/1703891/50/2.html">下一页</button>
      </div>
    </body></html>`, { url: "https://m.huliwang.net/1703891/50.html" });
    const snapshot = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/50.html");
    expect(snapshot.elements["#nr"]?.[0]).toContain(fullFooter);
    expect(snapshot.chapterPagination).toEqual({ hasNext: true, hasPrevious: false, currentPage: 1 });
    expect(snapshotLib.resolveChapterNextTarget(dom.window.document)).toBe("https://m.huliwang.net/1703891/50/2.html");
  });

  it("reports only the enabled state of Huliwang's fixed catalog buttons", () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>目录</title></head><body><ul id="chapterList"><li><a href="/1703891/1.html">第一章</a></li></ul><div id="pagination"><button id="prevPage" disabled>上一页</button><button id="nextPage">下一页</button></div></body></html>`, {
      url: "https://m.huliwang.net/dir/1703891.html",
    });
    const first = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/dir/1703891.html");
    expect(first.catalogPagination).toEqual({ hasNext: true, hasPrevious: false });
    dom.window.document.querySelector("#nextPage")?.setAttribute("disabled", "");
    dom.window.document.querySelector("#prevPage")?.removeAttribute("disabled");
    const final = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/dir/1703891.html");
    expect(final.catalogPagination).toEqual({ hasNext: false, hasPrevious: true });
  });

  it("classifies hidden managed-Challenge artifacts as passive without clicking", () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser<div class="cf-turnstile" style="display:none"><iframe src="https://challenges.cloudflare.com/widget"></iframe></div><input type="hidden" name="cf-turnstile-response"></body></html>`, {
      url: "https://m.huliwang.net/1703891/1.html",
    });
    const snapshot = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/1.html");
    expect(snapshot.challenge).toBe("passive");
  });

  it("classifies only a genuinely visible Turnstile widget as interactive", () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>Just a moment...</title></head><body><div class="cf-turnstile">Verify</div></body></html>`, {
      url: "https://m.huliwang.net/1703891/1.html",
    });
    const widget = dom.window.document.querySelector(".cf-turnstile");
    Object.defineProperty(widget, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 80, width: 300, height: 80, toJSON: () => ({}) }),
    });
    const snapshot = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/1.html");
    expect(snapshot.challenge).toBe("interactive");
  });

  it("classifies an ordinary story page with no challenge signature as none", () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>第1章</title></head><body><div id="nr">正常正文内容</div></body></html>`, {
      url: "https://m.huliwang.net/1703891/1.html",
    });
    const snapshot = snapshotLib.collectStorySnapshot(dom.window.document, "https://m.huliwang.net/1703891/1.html");
    expect(snapshot.challenge).toBe("none");
  });

  it("contains no forbidden browser automation or sensitive-data API usage", async () => {
    const files = ["service-worker.js", "pairing-content.js", "huli-content.js", "xszj-content.js", "popup.js"];
    const source = (await Promise.all(files.map((file) => readFile(resolve(root, file), "utf8")))).join("\n");
    expect(source).not.toMatch(/chrome\.(?:cookies|history|debugger|webRequest)|remote-debugging|playwright|turnstile.*click/iu);
    expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage/iu);
  });

  it("keeps both manifest content scripts valid classic scripts", async () => {
    for (const file of ["pairing-content.js", "huli-content.js", "xszj-content.js"]) {
      const source = await readFile(resolve(root, file), "utf8");
      expect(source).not.toMatch(/^\s*(?:import|export)\s/mu);
      expect(() => new Function(source)).not.toThrow();
    }
  });

  it("strips the loopback pairing secret before sending it to the worker", async () => {
    const payload = { sessionId: "S234567890123456", token: "z".repeat(43) };
    const dom = new JSDOM("<!doctype html><title>Pair</title>", {
      url: `http://127.0.0.1:34567/v1/pair#tdt-pair=${encode(payload)}`,
      runScripts: "outside-only",
    });
    const messages: unknown[] = [];
    let portConnects = 0;
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: (options: unknown) => {
        expect(options).toEqual({ name: "huli-heartbeat" });
        portConnects += 1;
        return { onDisconnect: { addListener: () => undefined } };
      },
      sendMessage: (message: unknown) => { messages.push(message); },
    } } });
    const source = await readFile(resolve(root, "pairing-content.js"), "utf8");
    dom.window.eval(source);
    expect(dom.window.location.href).toBe("http://127.0.0.1:34567/v1/pair");
    expect(messages).toEqual([{ type: "pair", bridgeOrigin: "http://127.0.0.1:34567", ...payload }]);
    expect(portConnects).toBe(1);
  });

  it("runs the Huli content script in an isolated classic-script context", async () => {
    const dom = new JSDOM("<!doctype html><html><head><title>Chương 1</title></head><body><div id='nr_title'>第1章</div><div id='nr'>正文内容足够长<br>第二段</div></body></html>", {
      url: "https://m.huliwang.net/1703891/1.html",
      runScripts: "outside-only",
    });
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined;
    Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
    let portConnects = 0;
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: (options: unknown) => {
        expect(options).toEqual({ name: "huli-heartbeat" });
        portConnects += 1;
        return { onDisconnect: { addListener: () => undefined } };
      },
      onMessage: { addListener: (value: typeof listener) => { listener = value; } },
    } } });
    dom.window.eval(await readFile(resolve(root, "huli-content.js"), "utf8"));
    let response: any;
    expect(listener?.({ type: "collect-snapshot", requestedUrl: "https://m.huliwang.net/1703891/1.html" }, {}, (value) => { response = value; })).toBe(false);
    expect(response.ok).toBe(true);
    expect(response.snapshot.elements["#nr"]).toEqual(["正文内容足够长\n第二段"]);
    expect(response.snapshot.challenge).toBe("none");
    expect(portConnects).toBe(1);
  });

  it("registers only the matching broad-host content script on an ihuliwang page", async () => {
    const url = "https://m.ihuliwang.com/1703891/1.html";
    const dom = new JSDOM("<!doctype html><html><head><title>Chương 1</title></head><body><div id='nr_title'>第1章</div><div id='nr'>正文内容足够长<br>第二段</div></body></html>", {
      url,
      runScripts: "outside-only",
    });
    const listeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean> = [];
    let portConnects = 0;
    Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: (options: unknown) => {
        expect(options).toEqual({ name: "huli-heartbeat" });
        portConnects += 1;
        return { onDisconnect: { addListener: () => undefined } };
      },
      onMessage: { addListener: (value: (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) => { listeners.push(value); } },
    } } });
    for (const file of ["novel543-content.js", "huli-content.js", "xszj-content.js"]) {
      dom.window.eval(await readFile(resolve(root, file), "utf8"));
    }
    expect(listeners).toHaveLength(1);
    expect(portConnects).toBe(1);
    let response: any;
    expect(listeners[0]?.({ type: "collect-snapshot", requestedUrl: url }, {}, (value) => { response = value; })).toBe(false);
    expect(response.ok).toBe(true);
    expect(response.snapshot.url).toBe(url);
  });

  it("waits asynchronously for a safe Huli catalog list before taking its first snapshot", async () => {
    const dom = new JSDOM("<!doctype html><html><head><title>Catalog</title></head><body><main>Loading list</main></body></html>", {
      url: "https://m.huliwang.net/dir/1703891.html",
      runScripts: "outside-only",
    });
    let listener: ((message: unknown, sender: unknown, respond: (value: any) => void) => boolean) | undefined;
    let nextClicks = 0;
    Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: () => ({ onDisconnect: { addListener: () => undefined } }),
      onMessage: { addListener: (value: typeof listener) => { listener = value; } },
    } } });
    dom.window.eval(await readFile(resolve(root, "huli-content.js"), "utf8"));

    const responsePromise = new Promise<any>((resolveResponse) => {
      expect(listener?.({ type: "collect-snapshot", requestedUrl: "https://m.huliwang.net/dir/1703891.html" }, {}, resolveResponse)).toBe(true);
    });
    dom.window.setTimeout(() => {
      dom.window.document.body.innerHTML = "<ul id='chapterList'><li><a href='/999999/1.html'>Wrong book</a></li><li><a href='https://evil.test/chapter'>Unsafe</a></li></ul><div id='pagination'><button id='prevPage' disabled>Previous</button><button id='nextPage'>Next</button></div>";
      dom.window.document.querySelector("#nextPage")?.addEventListener("click", () => { nextClicks += 1; });
    }, 0);
    dom.window.setTimeout(() => {
      dom.window.document.querySelector("#chapterList")!.innerHTML = "<li><a href='/1703891/51.html'>Safe chapter</a></li>";
    }, 20);

    const response = await responsePromise;
    expect(response.ok).toBe(true);
    expect(response.snapshot.catalogPagination).toEqual({ hasNext: true, hasPrevious: false });
    expect(response.snapshot.links.map((item: { href: string }) => item.href)).toContain("https://m.huliwang.net/1703891/51.html");
    expect(nextClicks).toBe(0);
  });

  it("returns a passive Cloudflare catalog snapshot immediately without clicking or waiting for chapters", async () => {
    const dom = new JSDOM("<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser<div id='pagination'><button id='prevPage' disabled>Previous</button><button id='nextPage'>Next</button></div></body></html>", {
      url: "https://m.huliwang.net/dir/1703891.html",
      runScripts: "outside-only",
    });
    let listener: ((message: unknown, sender: unknown, respond: (value: any) => void) => boolean) | undefined;
    let nextClicks = 0;
    Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: () => ({ onDisconnect: { addListener: () => undefined } }),
      onMessage: { addListener: (value: typeof listener) => { listener = value; } },
    } } });
    dom.window.document.querySelector("#nextPage")?.addEventListener("click", () => { nextClicks += 1; });
    dom.window.eval(await readFile(resolve(root, "huli-content.js"), "utf8"));

    const response = await new Promise<any>((resolveResponse) => {
      expect(listener?.({ type: "collect-snapshot", requestedUrl: "https://m.huliwang.net/dir/1703891.html" }, {}, resolveResponse)).toBe(true);
    });
    expect(response).toMatchObject({ ok: true, snapshot: { challenge: "passive" } });
    expect(nextClicks).toBe(0);
  });

  it("advances only the fixed in-place catalog button and waits for a changed list", async () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>目录</title></head><body><ul id="chapterList"><li><a href="/1703891/1.html">第一章</a></li></ul><div id="pagination"><button id="prevPage" disabled>上一页</button><button id="nextPage">下一页</button></div></body></html>`, {
      url: "https://m.huliwang.net/dir/1703891.html",
      runScripts: "outside-only",
    });
    let listener: ((message: unknown, sender: unknown, respond: (value: any) => void) => boolean) | undefined;
    Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: () => ({ onDisconnect: { addListener: () => undefined } }),
      onMessage: { addListener: (value: typeof listener) => { listener = value; } },
    } } });
    dom.window.document.querySelector("#nextPage")?.addEventListener("click", () => {
      setTimeout(() => {
        dom.window.document.querySelector("#chapterList")!.innerHTML = "<li><a href='/1703891/2.html'>第二章</a></li>";
        dom.window.document.querySelector("#nextPage")?.setAttribute("disabled", "");
      }, 0);
    });
    dom.window.eval(await readFile(resolve(root, "huli-content.js"), "utf8"));
    const response = await new Promise<any>((resolveResponse) => {
      expect(listener?.({ type: "advance-catalog-page", requestedUrl: "https://m.huliwang.net/dir/1703891.html" }, {}, resolveResponse)).toBe(true);
    });
    expect(response.ok).toBe(true);
    expect(response.snapshot.catalogPagination).toEqual({ hasNext: false, hasPrevious: false });
    expect(response.snapshot.links.map((item: { href: string }) => item.href)).toContain("https://m.huliwang.net/1703891/2.html");
  });

  it("resolves only the verified reader data-url, including a multi-line footer, and never exposes a final/foreign target", async () => {
    const chapterUrl = "https://m.huliwang.net/1703891/50.html";
    // This is the exact reader footer observed on the mobile Huliwang
    // Chapter 50 page: it says `继续~`, without the optional `阅读` word.
    // Keep this regression so a seemingly tiny template variant cannot make
    // the helper silently return only the first internal page again.
    const footer = [
      "本章未完，点击下一页继续~",
      "此页为本章 第1页 / 共3页~",
      "如内容不全或无法翻页",
      "或提示是最新章节",
      "请退出[阅#读#模#式]",
      "(^ ^) (^ ^)",
    ].join("\n");
    const dom = new JSDOM(`<!doctype html><html lang="zh"><head><title>第50章</title></head><body>
      <div id="nr_title">第50章 第1页</div>
      <div id="nr"><p>第一段</p><p>${footer}</p></div>
      <div class="nr_page">
        <button id="pt_next" data-url="/1703891/50/2.html">下一页</button>
        <button id="pt_next" data-url="/1703891/50/2.html">下一页</button>
      </div>
    </body></html>`, {
      url: chapterUrl,
      runScripts: "outside-only",
    });
    let listener: ((message: unknown, sender: unknown, respond: (value: any) => void) => boolean) | undefined;
    Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
    Object.defineProperty(dom.window, "chrome", { value: { runtime: {
      connect: () => ({ onDisconnect: { addListener: () => undefined } }),
      onMessage: { addListener: (value: typeof listener) => { listener = value; } },
    } } });

    dom.window.eval(await readFile(resolve(root, "huli-content.js"), "utf8"));
    let resolved: any;
    expect(listener?.({ type: "resolve-chapter-next", requestedUrl: chapterUrl }, {}, (value) => { resolved = value; })).toBe(false);
    expect(resolved).toEqual({ ok: true, nextUrl: "https://m.huliwang.net/1703891/50/2.html" });

    // An apparent next control targeting another chapter is rejected even
    // though the terminal marker remains on the page.
    dom.window.document.querySelectorAll("#pt_next")[1]?.setAttribute("data-url", "/1703891/51.html");
    let foreign: any;
    expect(listener?.({ type: "resolve-chapter-next", requestedUrl: chapterUrl }, {}, (value) => { foreign = value; })).toBe(false);
    expect(foreign.ok).toBe(false);

    // A last reader part has no marker, so a control that would lead to Ch51
    // is not surfaced as a continuation.
    dom.window.document.querySelector("#nr")!.innerHTML = "<p>第三页结尾。</p>";
    let final: any;
    expect(listener?.({ type: "resolve-chapter-next", requestedUrl: chapterUrl }, {}, (value) => { final = value; })).toBe(false);
    expect(final.ok).toBe(false);
  });

  it("uses a persistent MV3 Port for one-shot polls instead of fire-and-forget messaging", async () => {
    const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
    const pairing = await readFile(resolve(root, "pairing-content.js"), "utf8");
    const huli = await readFile(resolve(root, "huli-content.js"), "utf8");
    const xszj = await readFile(resolve(root, "xszj-content.js"), "utf8");
    const novel543 = await readFile(resolve(root, "novel543-content.js"), "utf8");
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
    expect(worker).not.toMatch(/pollLoop|onStartup/u);
    expect(worker).not.toContain('message?.type === "poll"');
    expect(worker).toContain("chrome.runtime.onConnect.addListener");
    expect(worker).toContain("runHeartbeatPort(port, state)");
    expect(worker).toContain("await coalescedPoll()");
    expect(worker).toContain("awaitingPairing: true");
    expect(pairing).toContain("chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME })");
    expect(huli).toContain("chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME })");
    expect(xszj).toContain("chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME })");
    expect(novel543).toContain("chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME })");
    expect(pairing).not.toContain('sendMessage({ type: "poll" })');
    expect(huli).not.toContain('sendMessage({ type: "poll" })');
    expect(xszj).not.toContain('sendMessage({ type: "poll" })');
    expect(novel543).not.toContain('sendMessage({ type: "poll" })');
    expect(manifest.content_scripts.map((entry: { js: string[] }) => entry.js)).toEqual([
      ["novel543-content.js"],
      ["pairing-content.js"],
      ["huli-content.js"],
      ["xszj-content.js"],
    ]);
    expect(worker).toMatch(/retryAfterMs:\s*0,\s*commandProcessed/u);
  });

  it("uses a strict JSON POST so Edge sends Origin and adds no cache request headers", async () => {
    const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
    const timedPoll = /async function timedCommandPoll\([\s\S]*?\n\}/u.exec(worker)?.[0] ?? "";
    expect(timedPoll).toContain("/v1/extension/commands");
    expect(timedPoll).toContain('method: "POST"');
    expect(timedPoll).toContain("headers: authHeaders(pairing.token, true)");
    expect(timedPoll).toContain("body: JSON.stringify({ sessionId: pairing.sessionId })");
    expect(timedPoll).toContain("signal: controller.signal");
    expect(timedPoll).not.toContain("?sessionId=");
    expect(timedPoll).not.toMatch(/cache\s*:|Cache-Control|Pragma/iu);
  });

  it("keeps the JavaScript catalog pager to one fixed, fail-closed action", async () => {
    const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
    const content = await readFile(resolve(root, "huli-content.js"), "utf8");
    expect(worker).toContain('command.type === "catalog-next"');
    expect(worker).toContain('type: "advance-catalog-page", requestedUrl');
    expect(worker).toContain("validateCompanionCommand(rawCommand)");
    expect(content).toContain('document.querySelector("#pagination #nextPage")');
    expect(content).toContain("waitForCatalogChange(before");
    expect(content).toContain("current.catalogPagination?.hasNext");
    expect(`${worker}\n${content}`).not.toMatch(/(?:executeScript|chrome\.debugger|document\.cookie|eval\()/iu);
  });

  it("bounds lifecycle failure cleanup and protects replacement sessions", async () => {
    expect(protocol.classifyCommandPollStatus(200)).toBe("ok");
    for (const status of [401, 403, 404, 409, 410]) expect(protocol.classifyCommandPollStatus(status)).toBe("gone");
    expect(protocol.nextPollFailureState(0)).toEqual({ failures: 1, connected: true });
    expect(protocol.nextPollFailureState(2)).toEqual({ failures: 3, connected: false });
    const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
    expect(worker).toContain("assertCurrentPairing(pairing)");
    expect(worker).toContain("pairingGeneration");
    expect(worker).toContain("current.token !== pairing.token");
    expect(worker).toMatch(/response\.status === 204 \|\| response\.status === 409/u);
  });

  it("treats Huli host and page-one aliases as the same loaded page", () => {
    const canonical = "https://m.huliwang.net/1703891/36.html";
    expect(protocol.huliPageIdentity("https://www.huliwang.net/1703891/36/1.html")).toBe(canonical);
    expect(protocol.pairedTabAction("https://www.huliwang.net/1703891/36/1.html", canonical)).toEqual({
      type: "reuse",
      url: "https://www.huliwang.net/1703891/36/1.html",
    });
  });

  it("canonicalizes every supported catalog-page alias before deciding whether to reuse the paired tab", () => {
    const pageTwoCanonical = "https://m.huliwang.net/dir/1703891-2.html";
    for (const alias of [
      "https://m.huliwang.net/dir/1703891-2.html",
      "https://www.huliwang.net/dir/1703891-2.html",
      "https://m.huliwang.net/dir/1703891_2.html",
      "https://www.huliwang.net/dir/1703891_2.html",
      "https://m.huliwang.net/dir/1703891/2.html",
      "https://www.huliwang.net/dir/1703891/2.html",
    ]) {
      expect(protocol.huliPageIdentity(alias)).toBe(pageTwoCanonical);
    }

    const baseCatalog = "https://m.huliwang.net/dir/1703891.html";
    for (const explicitPageOneAlias of [
      "https://m.huliwang.net/dir/1703891-1.html",
      "https://www.huliwang.net/dir/1703891_1.html",
      "https://www.huliwang.net/dir/1703891/1.html",
    ]) {
      expect(protocol.huliPageIdentity(explicitPageOneAlias)).toBe(baseCatalog);
    }

    const alreadyLoadedAlias = "https://www.huliwang.net/dir/1703891_2.html";
    const action = protocol.pairedTabAction(alreadyLoadedAlias, "https://m.huliwang.net/dir/1703891/2.html");
    expect(action).toEqual({ type: "reuse", url: alreadyLoadedAlias });
    expect(protocol.mustWaitForPairedTab(action.type, "complete")).toBe(false);
  });
});
