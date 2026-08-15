import { describe, expect, it } from "vitest";
import { parseStoryUrl } from "../../src/main/storySources/urlRules";

describe("story source URL rules", () => {
  it.each([
    ["https://m.huliwang.net/1703891/", "huliwang", "book", "1703891", undefined, undefined],
    ["https://www.huliwang.net/dir/1703891.html", "huliwang", "catalog", "1703891", undefined, undefined],
    ["https://m.huliwang.net/1703891/36/3.html", "huliwang", "chapter", "1703891", "36", 3],
    ["https://www.timotxt.com/0108567756/dir", "timotxt", "catalog", "0108567756", undefined, undefined],
    ["https://timotxt.com/0108567756/332.html", "timotxt", "chapter", "0108567756", "332", undefined],
    ["https://www.timotxt.com/0108567756/332_2.html", "timotxt", "chapter", "0108567756", "332_2", undefined],
    ["https://www.qingrenyouxi.com/book/115013.html", "qingrenyouxi", "book", "115013", undefined, undefined],
    ["https://qingrenyouxi.com/book/115013/33160353.html", "qingrenyouxi", "chapter", "115013", "33160353", undefined],
    ["https://www.xbanxia.cc/books/143300.html", "xbanxia", "book", "143300", undefined, undefined],
    ["https://xbanxia.cc/books/143300/28251886.html", "xbanxia", "chapter", "143300", "28251886", undefined],
    ["https://www.xbanxia.cc/books/143300.html", "xbanxia", "book", "143300", undefined, undefined],
    ["https://xbanxia.cc/books/143300/28251886.html", "xbanxia", "chapter", "143300", "28251886", undefined],
  ] as const)("classifies %s", (url, site, kind, bookId, chapterKey, page) => {
    const parsed = parseStoryUrl(url);
    expect(parsed).toMatchObject({ site, kind, bookId });
    expect(parsed.chapterKey).toBe(chapterKey);
    expect(parsed.page).toBe(page);
  });

  it.each([
    "https://evil.timotxt.com/0108567756/dir",
    "https://www.timotxt.com.evil.test/0108567756/dir",
    "https://user:pass@www.timotxt.com/0108567756/dir",
    "file:///1703891/",
    "https://m.huliwang.net/1703891/36/3.html.evil",
    "https://www.qingrenyouxi.com/list/1.html",
    "https://www.timotxt.com./0108567756/dir",
    "https://evil.xbanxia.cc/books/143300.html",
    "https://www.xbanxia.cc.evil.test/books/143300.html",
    "https://user:pass@www.xbanxia.cc/books/143300.html",
    "https://www.xbanxia.cc:444/books/143300.html",
    "https://www.xbanxia.cc./books/143300.html",
    "https://www.xbanxia.cc/book/143300.html",
    "https://www.xbanxia.cc/books/not-a-number.html",
    "https://www.xbanxia.cc/books/143300/not-a-chapter.html",
    "https://www.xbanxia.cc/books/143300/28251886/extra.html",
    "https://www.xbanxia.cc/books/143300%2F28251886.html",
    "https://www.timotxt.com./0108567756/dir",
    "https://evil.xbanxia.cc/books/143300.html",
    "https://www.xbanxia.cc.evil.test/books/143300.html",
    "https://user:pass@www.xbanxia.cc/books/143300.html",
    "https://www.xbanxia.cc:444/books/143300.html",
    "https://www.xbanxia.cc./books/143300.html",
    "https://www.xbanxia.cc/book/143300.html",
    "https://www.xbanxia.cc/books/not-a-number.html",
    "https://www.xbanxia.cc/books/143300/not-a-chapter.html",
    "https://www.xbanxia.cc/books/143300/28251886/extra.html",
    "https://www.xbanxia.cc/books/143300%2F28251886.html",
  ])("rejects non-allowlisted or unsupported URL %s", (url) => {
    expect(() => parseStoryUrl(url)).toThrow();
  });

  it("normalizes Huliwang page one alias to chapter canonical URL", () => {
    expect(parseStoryUrl("https://www.huliwang.net/1703891/36/1.html").normalizedUrl)
      .toBe("https://m.huliwang.net/1703891/36.html");
  });

  it("normalizes bare-host, HTTP, query, and fragment Xbanxia inputs to exact HTTPS URLs", () => {
    const book = parseStoryUrl("http://xbanxia.cc/books/143300.html?from=history#catalog");
    expect(book).toMatchObject({
      site: "xbanxia",
      kind: "book",
      bookId: "143300",
      normalizedUrl: "https://www.xbanxia.cc/books/143300.html",
      bookUrl: "https://www.xbanxia.cc/books/143300.html",
      catalogUrl: "https://www.xbanxia.cc/books/143300.html",
    });

    const chapter = parseStoryUrl(
      "https://xbanxia.cc/books/143300/28251886.html?utm_source=test#content",
    );
    expect(chapter).toMatchObject({
      site: "xbanxia",
      kind: "chapter",
      bookId: "143300",
      chapterKey: "28251886",
      normalizedUrl: "https://www.xbanxia.cc/books/143300/28251886.html",
      bookUrl: "https://www.xbanxia.cc/books/143300.html",
      catalogUrl: "https://www.xbanxia.cc/books/143300.html",
    });
    expect(chapter.normalizedUrl).not.toMatch(/[?#]/u);
  });
});
