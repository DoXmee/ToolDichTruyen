import { describe, expect, it } from "vitest";
import { adapterFor } from "../../src/main/storySources/adapters";
import { parseStoryUrl } from "../../src/main/storySources/urlRules";
import type { StoryPageSnapshot } from "../../src/main/storySources/types";
import type { StorySourceAnalysis, StoryChapterReference } from "../../src/shared/types";

const snapshot = (url: string, elements: Record<string, string[]>, links: StoryPageSnapshot["links"] = []): StoryPageSnapshot => ({
  requestedUrl: url, url, title: "Sách", bodyText: Object.values(elements).flat().join("\n"),
  elements, links, fontFamilies: [], fontUrls: [], fontHashes: [], challenge: "none",
});
const runtime = (pages: Record<string, StoryPageSnapshot>) => ({
  client: {} as never, signal: new AbortController().signal,
  visit: async (url: string) => pages[url]!, reportCatalogProgress: () => {},
  maxCatalogPages: 20, maxChapterPages: 10, decoders: [],
});

describe("static novel source adapters", () => {
  it("extracts Liehuo chapters and removes only reader chrome", async () => {
    const bookUrl = "https://m.liehuozw.com/74/74628/";
    const catalogUrl = "https://m.liehuozw.com/74/74628/all_1/";
    const chapterUrl = "https://m.liehuozw.com/74/74628/5591191.html";
    const book = snapshot(bookUrl, { h1: ["烈火中文网"], h3: ["替身演员的洗白之路"], ".cataloginfo": ["替身演员的洗白之路 作者：聿无忧 类型：都市小说"], ".infotype": ["作者：聿无忧 类型：都市小说"], ".infotype a[href*='/author/']": ["聿无忧"] }, [{ href: chapterUrl, text: "1.开始", scopes: [] }]);
    const catalog = snapshot(catalogUrl, { h1: ["烈火中文网"], ".cataloginfo": ["替身演员的洗白之路"] }, [{ href: chapterUrl, text: "1.开始", scopes: [] }]);
    const chapter = snapshot(chapterUrl, { ".content_title": ["第1章 开始"], ".novelcontent": ["第一段正文内容足够长以通过安全长度校验。\n下一章\n第二段正文内容足够长以通过安全长度校验。"] });
    const adapter = adapterFor("liehuozw");
    const analysisData = await adapter.analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book, [catalogUrl]: catalog }));
    expect(analysisData.chapters).toHaveLength(1);
    expect(analysisData.bookTitle).toBe("替身演员的洗白之路");
    expect(analysisData.author).toBe("聿无忧");
    const analysis = { ...analysisData, analysisId: "a", site: "liehuozw", inputKind: "book", inputUrl: bookUrl, bookId: "74/74628", bookUrl, catalogUrl, defaultSelectedChapterIds: [analysisData.chapters[0]!.id], verification: "not-needed" } as StorySourceAnalysis;
    const result = await adapter.fetch(analysis, analysisData.chapters[0]!, runtime({ [chapterUrl]: chapter }));
    expect(result.sourceText).toContain("第一段正文");
    expect(result.sourceText).not.toContain("下一章");
  });

  it("follows and merges every verified Liehuo page of the same chapter", async () => {
    const bookUrl = "https://m.liehuozw.com/74/74628/";
    const catalogUrl = "https://m.liehuozw.com/74/74628/all_1/";
    const pageOneUrl = "https://m.liehuozw.com/74/74628/5591191.html";
    const pageTwoUrl = "https://m.liehuozw.com/74/74628/5591191_2.html";
    const pageThreeUrl = "https://m.liehuozw.com/74/74628/5591191_3.html";
    const book = snapshot(bookUrl, { h3: ["测试书"] }, [{ href: pageOneUrl, text: "第1章 开始", scopes: [] }]);
    const catalog = snapshot(catalogUrl, { ".cataloginfo": ["测试书"] }, [{ href: pageOneUrl, text: "第1章 开始", scopes: [] }]);
    const first = snapshot(pageOneUrl, { ".content_title": ["第1章 开始(第1/3页)"], ".novelcontent": ["第一页正文足够长，确保这一段会被完整保留下来，而且不会因为长度检查而丢失内容。人物继续交谈，故事情节仍然向前发展。\n本章未完，请点击下一页继续阅读 》》"] }, [{ href: pageTwoUrl, text: "下一页", scopes: [] }]);
    const second = snapshot(pageTwoUrl, { ".content_title": ["第1章 开始(第2/3页)"], ".novelcontent": ["第二页正文足够长，确保中间页面不会被遗漏，而且会按原来的先后顺序正确拼接。人物继续行动，故事情节保持连贯。\n本章未完，请点击下一页继续阅读 》》"] }, [{ href: pageThreeUrl, text: "下一页", scopes: [] }]);
    const third = snapshot(pageThreeUrl, { ".content_title": ["第1章 开始(第3/3页)"], ".novelcontent": ["第三页正文足够长，故事在这里正常结束并通过校验，最后一页不再包含未完提示。人物完成对话，这一章的情节完整收束。"] });
    const adapter = adapterFor("liehuozw");
    const data = await adapter.analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book, [catalogUrl]: catalog }));
    const analysis = { ...data, analysisId: "a", site: "liehuozw", inputKind: "book", inputUrl: bookUrl, bookId: "74/74628", bookUrl, catalogUrl, defaultSelectedChapterIds: [data.chapters[0]!.id], verification: "not-needed" } as StorySourceAnalysis;

    const result = await adapter.fetch(analysis, data.chapters[0]!, runtime({ [pageOneUrl]: first, [pageTwoUrl]: second, [pageThreeUrl]: third }));

    expect(result.mergedPartCount).toBe(3);
    expect(result.sourceUrls).toEqual([pageOneUrl, pageTwoUrl, pageThreeUrl]);
    expect(result.sourceText).toContain("第一页正文");
    expect(result.sourceText).toContain("第二页正文");
    expect(result.sourceText).toContain("第三页正文");
    expect(result.sourceText).not.toContain("本章未完");
  });

  it("marks known CZBooks author-only catalog entries as non-story", async () => {
    const bookUrl = "https://czbooks.net/n/cr3e38";
    const storyUrl = "https://czbooks.net/n/cr3e38/crd0k";
    const promoUrl = "https://czbooks.net/n/cr3e38/crdcb";
    const book = snapshot(bookUrl, { h1: ["测试小说"] }, [
      { href: storyUrl, text: "第18章 正文", scopes: [] },
      { href: promoUrl, text: "019-我的用心", scopes: [] },
    ]);

    const data = await adapterFor("czbooks").analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book }));

    expect(data.chapters).toHaveLength(2);
    expect(data.chapters[0]?.isIntroduction).toBe(false);
    expect(data.chapters[1]?.isIntroduction).toBe(true);
    expect(data.chapters[1]?.selectedByDefault).toBe(false);
  });

  it("reads UAA002 chapter ids without accepting a different host", async () => {
    const bookUrl = "https://m.uaa002.com/novel/intro?id=11306159";
    const chapterUrl = "https://m.uaa002.com/novel/chapter?id=388595";
    const book = snapshot(bookUrl, { ".reader-top__title": ["书名"] }, [{ href: chapterUrl, text: "第1章 开始", scopes: [] }]);
    const chapter = snapshot(chapterUrl, { ".reader-top__title": ["第1章 开始"], ".reader-content": ["正文第一段内容足够长以通过安全长度校验。\n正文第二段内容足够长以通过安全长度校验。"] });
    const adapter = adapterFor("uaa002");
    const data = await adapter.analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book }));
    expect(data.chapters[0]!.partUrls[0]).toContain("novel/chapter?id=388595");
    const analysis = { ...data, analysisId: "a", site: "uaa002", inputKind: "book", inputUrl: bookUrl, bookId: "11306159", bookUrl, catalogUrl: bookUrl, defaultSelectedChapterIds: [data.chapters[0]!.id], verification: "not-needed" } as StorySourceAnalysis;
    const result = await adapter.fetch(analysis, data.chapters[0]!, runtime({ [chapterUrl]: chapter }));
    expect(result.sourceText).toContain("正文第一段内容");
  });

  it("uses only Novel543 全部章节, validates the complete sequence, and joins all reader pages", async () => {
    const bookUrl = "https://www.novel543.com/1013669909/";
    const catalogUrl = "https://www.novel543.com/1013669909/dir";
    const firstUrl = "https://www.novel543.com/1013669909/8096_1.html";
    const secondUrl = "https://www.novel543.com/1013669909/8096_2.html";
    const firstPageTwo = "https://www.novel543.com/1013669909/8096_1_2.html";
    const firstPageThree = "https://www.novel543.com/1013669909/8096_1_3.html";
    const book = snapshot(bookUrl, { ".title": ["测试书"] });
    const catalog = snapshot(catalogUrl, { h1: ["测试书 章節列表"], ".meta-dir": ["章節：2 更新：2026-08-30"] }, [
      { href: secondUrl, text: "第2章 最新重复", scopes: [".chaplist"] },
      { href: firstUrl, text: "第1章 开始", scopes: [".all", ".chaplist"] },
      { href: secondUrl, text: "第2章 后续", scopes: [".all", ".chaplist"] },
      { href: "https://www.novel543.com/1022699969/8096_1.html", text: "第1章 推荐书", scopes: [".all"] },
    ]);
    const first = snapshot(firstUrl, { h1: ["第1章 开始 (1/3)"], ".chapter-content .content": ["【同志们请拿起手机，加书架，按催更！】\n第一页正文足够长，人物和事件都在继续发展，内容必须完整保留下来。"] }, [
      { href: firstPageTwo, text: "下一章", scopes: [".foot-nav"] },
    ]);
    const second = snapshot(firstPageTwo, { h1: ["第1章 开始 (2/3)"], ".chapter-content .content": ["第二页正文足够长，承接上一页的情节，而且不能被遗漏或交换顺序。"] }, [
      { href: firstPageThree, text: "下一章", scopes: [".foot-nav"] },
    ]);
    const third = snapshot(firstPageThree, { h1: ["第1章 开始 (3/3)"], ".chapter-content .content": ["第三页正文足够长，在这里自然结束本章，并且完整保留人物最后的行动与对话。\n溫馨提示: 優化了VIP會員的閱讀體驗，可以設定上一頁和下一頁。"] }, [
      { href: secondUrl, text: "下一章", scopes: [".foot-nav"] },
    ]);
    const adapter = adapterFor("novel543");
    const data = await adapter.analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book, [catalogUrl]: catalog }));
    expect(data.chapters.map((chapter) => chapter.url)).toEqual([firstUrl, secondUrl]);
    const analysis = { ...data, analysisId: "n", site: "novel543", inputKind: "book", inputUrl: bookUrl, bookId: "1013669909", bookUrl, catalogUrl, defaultSelectedChapterIds: data.chapters.map((chapter) => chapter.id), verification: "not-needed" } as StorySourceAnalysis;
    const result = await adapter.fetch(analysis, data.chapters[0]!, runtime({ [firstUrl]: first, [firstPageTwo]: second, [firstPageThree]: third }));
    expect(result.sourceUrls).toEqual([firstUrl, firstPageTwo, firstPageThree]);
    expect(result.mergedPartCount).toBe(3);
    expect(result.sourceText).toMatch(/第一页正文[\s\S]*第二页正文[\s\S]*第三页正文/u);
    expect(result.sourceText).not.toMatch(/加书架|溫馨提示|VIP|ONEAD_TEXT/u);
  });

  it("fails closed when Novel543's declared count or chapter sequence is incomplete", async () => {
    const bookUrl = "https://www.novel543.com/1013669909/";
    const catalogUrl = "https://www.novel543.com/1013669909/dir";
    const book = snapshot(bookUrl, { ".title": ["测试书"] });
    const badCount = snapshot(catalogUrl, { h1: ["测试书 章節列表"], ".meta-dir": ["章節：3"] }, [
      { href: "https://www.novel543.com/1013669909/8096_1.html", text: "第1章 开始", scopes: [".all"] },
      { href: "https://www.novel543.com/1013669909/8096_2.html", text: "第2章 后续", scopes: [".all"] },
    ]);
    await expect(adapterFor("novel543").analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book, [catalogUrl]: badCount })))
      .rejects.toThrow(/công bố 3 chương.*2/u);

    const gap = snapshot(catalogUrl, { h1: ["测试书 章節列表"], ".meta-dir": ["章節：2"] }, [
      { href: "https://www.novel543.com/1013669909/8096_1.html", text: "第1章 开始", scopes: [".all"] },
      { href: "https://www.novel543.com/1013669909/8096_3.html", text: "第3章 跳号", scopes: [".all"] },
    ]);
    await expect(adapterFor("novel543").analyze(parseStoryUrl(bookUrl), runtime({ [bookUrl]: book, [catalogUrl]: gap })))
      .rejects.toThrow(/thiếu, đảo hoặc nhảy số/u);
  });
});
