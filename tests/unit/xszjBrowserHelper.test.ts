// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// @ts-expect-error jsdom is available through Vitest in the packaged workspace.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const root = resolve("resources/huli-browser-helper");
const protocol = await import(new URL("../../resources/huli-browser-helper/lib/protocol.js", import.meta.url).href);

function installChrome(dom: JSDOM) {
  let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined;
  let portConnects = 0;
  Object.defineProperty(dom.window, "TextEncoder", { value: TextEncoder });
  Object.defineProperty(dom.window, "chrome", { value: { runtime: {
    connect: (options: unknown) => {
      expect(options).toEqual({ name: "huli-heartbeat" });
      portConnects += 1;
      return { onDisconnect: { addListener: () => undefined } };
    },
    onMessage: { addListener: (value: typeof listener) => { listener = value; } },
  } } });
  return {
    get listener() { return listener; },
    get portConnects() { return portConnects; },
  };
}

describe("XSZJ normal-browser helper", () => {
  it("normalizes only the fixed XSZJ and 爱下电子书 URL families", () => {
    expect(protocol.EXTENSION_VERSION).toBe("1.0.6");
    expect(protocol.normalizeXszjUrl("https://www.xszj.org/b/485734/c/856451?page=2&utm=no#x"))
      .toBe("https://xszj.org/b/485734/c/856451?page=2");
    expect(protocol.normalizeXszjUrl("https://xszj.org/b/485734/cs/2"))
      .toBe("https://xszj.org/b/485734/cs/2");
    expect(protocol.normalizeXszjUrl("https://www.ixdzs8.com/read/646225/p1.html?utm=no"))
      .toBe("https://ixdzs8.com/read/646225/p1.html");
    expect(protocol.normalizeXszjUrl("https://ixdzs8.com/read/646225"))
      .toBe("https://ixdzs8.com/read/646225/");
    for (const url of [
      "http://xszj.org/b/485734",
      "https://xszj.org.evil.test/b/485734",
      "https://xszj.org/anything-else",
      "https://ixdzs8.com/b/485734",
      "https://xszj.org/read/646225/",
    ]) expect(() => protocol.normalizeXszjUrl(url)).toThrow();
  });

  it("allows XSZJ only for fixed visits, never Huli's fixed DOM actions", () => {
    expect(protocol.validateVisitCommand({
      id: "xszj_1",
      type: "visit",
      url: "https://xszj.org/b/485734/c/856451?page=2",
    })).toEqual({
      id: "xszj_1",
      type: "visit",
      url: "https://xszj.org/b/485734/c/856451?page=2",
    });
    expect(() => protocol.validateCompanionCommand({
      id: "xszj_2", type: "catalog-next", url: "https://xszj.org/b/485734/cs/1",
    })).toThrow();
    expect(() => protocol.validateCompanionCommand({
      id: "xszj_3", type: "chapter-next", url: "https://xszj.org/b/485734/c/856451",
    })).toThrow();
    expect(protocol.pairedTabAction(
      "https://www.xszj.org/b/485734/c/856451?page=2",
      "https://xszj.org/b/485734/c/856451?page=2",
    )).toEqual({ type: "reuse", url: "https://xszj.org/b/485734/c/856451?page=2" });
  });

  it("takes a passive allow-listed XSZJ reader snapshot with paragraph-safe text", async () => {
    const url = "https://xszj.org/b/485734/c/856451?page=2";
    const dom = new JSDOM(`<!doctype html><html lang="zh"><head><title>第1章（2/3）</title><link rel="canonical" href="${url}"></head><body>
      <h1>第1章 炮灰前妻怀孕了（2/3）</h1>
      <article class="page-content"><p>第一段。</p><p>第二段。</p><div class="ad">广告</div></article>
      <a href="?page=3">下一页</a>
    </body></html>`, { url, runScripts: "outside-only" });
    const state = installChrome(dom);
    dom.window.eval(await readFile(resolve(root, "xszj-content.js"), "utf8"));

    let response: any;
    expect(state.listener?.({ type: "collect-snapshot", requestedUrl: url }, {}, (value) => { response = value; })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.ok).toBe(true);
    expect(response.snapshot.elements.h1).toEqual(["第1章 炮灰前妻怀孕了（2/3）"]);
    expect(response.snapshot.elements["article.page-content"]).toEqual(["第一段。\n第二段。"]);
    expect(response.snapshot.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "https://xszj.org/b/485734/c/856451?page=3", text: "下一页" }),
    ]));
    expect(response.snapshot.challenge).toBe("none");
    expect(state.portConnects).toBe(1);
  });

  it("returns #list links and a Cloudflare state without operating any verification control", async () => {
    const url = "https://xszj.org/b/485734/cs/1";
    const dom = new JSDOM(`<!doctype html><html><head><title>Just a moment...</title></head><body>
      Checking your browser
      <ul id="list"><li><a href="/b/485734/c/856451">第1章</a></li></ul>
    </body></html>`, { url, runScripts: "outside-only" });
    const state = installChrome(dom);
    dom.window.eval(await readFile(resolve(root, "xszj-content.js"), "utf8"));

    let response: any;
    expect(state.listener?.({ type: "collect-snapshot", requestedUrl: url }, {}, (value) => { response = value; })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.ok).toBe(true);
    expect(response.snapshot.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "https://xszj.org/b/485734/c/856451", scopes: expect.arrayContaining(["#list"]) }),
    ]));
    expect(response.snapshot.challenge).toBe("passive");
  });

  it("opens only IXDZS's fixed full-catalog control before taking a book snapshot", async () => {
    const url = "https://ixdzs8.com/read/646225/";
    const dom = new JSDOM(`<!doctype html><html><body>
      <h1>Sách</h1><ul class="u-chapter"><li><a href="/read/646225/p1.html">第1章</a></li></ul>
      <li class="catalog-all">Hiện tất cả</li>
    </body></html>`, { url, runScripts: "outside-only" });
    const state = installChrome(dom);
    const trigger = dom.window.document.querySelector("li.catalog-all")!;
    trigger.addEventListener("click", () => {
      const chapter = dom.window.document.createElement("li");
      chapter.innerHTML = '<a href="/read/646225/p2.html">第2章</a>';
      dom.window.document.querySelector(".u-chapter")!.append(chapter);
      trigger.remove();
    });
    dom.window.eval(await readFile(resolve(root, "xszj-content.js"), "utf8"));
    let response: any;
    expect(state.listener?.({ type: "collect-snapshot", requestedUrl: url }, {}, (value) => { response = value; })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.ok).toBe(true);
    expect(response.snapshot.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "https://ixdzs8.com/read/646225/p1.html" }),
      expect.objectContaining({ href: "https://ixdzs8.com/read/646225/p2.html" }),
    ]));
  });

  it("keeps the XSZJ content script constrained to the fixed IXDZS catalog action", async () => {
    const source = await readFile(resolve(root, "xszj-content.js"), "utf8");
    expect(() => new Function(source)).not.toThrow();
    expect(source).not.toMatch(/(?:chrome\.(?:cookies|history|debugger|webRequest)|remote-debugging|playwright|executeScript|document\.cookie|localStorage|sessionStorage)/iu);
    expect(source).toMatch(/document\.querySelector\("li\.catalog-all"\)/u);
    expect(source).not.toMatch(/(?:eval\(|Function\(|executeScript|querySelector\(message)/u);
    expect(source).toContain('message?.type !== "collect-snapshot"');
  });
});
