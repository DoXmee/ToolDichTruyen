import { describe, expect, it } from "vitest";
import { assertSnapshotUrl, parseStoryUrl } from "../../src/main/storySources/urlRules";

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
    ["https://xszj.org/b/485734", "xszj", "book", "485734", undefined, undefined],
    ["https://xszj.org/b/485734/cs/2", "xszj", "catalog", "485734", undefined, undefined],
    ["https://xszj.org/b/485734/c/856451?page=2", "xszj", "chapter", "485734", "856451", 2],
    ["https://ixdzs8.com/read/646225/", "xszj", "book", "646225", undefined, undefined],
    ["https://ixdzs8.com/read/646225/p1.html", "xszj", "chapter", "646225", "1", undefined],
    ["https://m.liehuozw.com/74/74628/", "liehuozw", "book", "74/74628", undefined, undefined],
    ["https://m.liehuozw.com/74/74628/12.html", "liehuozw", "chapter", "74/74628", "12", undefined],
    ["https://m.liehuozw.com/74/74628/12_2.html", "liehuozw", "chapter", "74/74628", "12", 2],
    ["https://m.uaa002.com/novel/intro?id=11306159", "uaa002", "book", "11306159", undefined, undefined],
    ["https://m.uaa002.com/novel/read/11306159/8", "uaa002", "chapter", "11306159", "8", undefined],
    ["https://www.c6k6.com/book/138252.html", "c6k6", "book", "138252", undefined, undefined],
    ["https://www.c6k6.com/book/138252/8.html", "c6k6", "chapter", "138252", "8", undefined],
    ["https://m.c6k6.com/3/138252/", "c6k6", "book", "138252", undefined, undefined],
    ["https://m.c6k6.com/138/138252/35142154.html", "c6k6", "chapter", "138252", "35142154", undefined],
    ["https://czbooks.net/n/pmeef4", "czbooks", "book", "pmeef4", undefined, undefined],
    ["https://czbooks.net/n/pmeef4/8", "czbooks", "chapter", "pmeef4", "8", undefined],
    ["https://www.novel543.com/1013669909/", "novel543", "book", "1013669909", undefined, undefined],
    ["https://novel543.com/1013669909/dir", "novel543", "catalog", "1013669909", undefined, undefined],
    ["https://www.novel543.com/1013669909/8096_1.html", "novel543", "chapter", "1013669909", "8096_1", 1],
    ["https://novel543.com/1013669909/8096_1_2.html", "novel543", "chapter", "1013669909", "8096_1", 2],
    ["https://www.xbanxia.cc/books/143300.html", "xbanxia", "book", "143300", undefined, undefined],
    ["https://xbanxia.cc/books/143300/28251886.html", "xbanxia", "chapter", "143300", "28251886", undefined],
  ] as const)("classifies %s", (url, site, kind, bookId, chapterKey, page) => {
    const parsed = parseStoryUrl(url);
    expect(parsed).toMatchObject({ site, kind, bookId });
    expect(parsed.chapterKey).toBe(chapterKey);
    expect(parsed.page).toBe(page);
  });

  it("canonicalizes a desktop C6K6 book URL to its working mobile catalog", () => {
    const parsed = parseStoryUrl("https://www.c6k6.com/book/124560.html");
    expect(parsed.bookUrl).toBe("https://m.c6k6.com/124/124560/");
    expect(parsed.catalogUrl).toBe("https://m.c6k6.com/124/124560/");
    expect(parsed.normalizedUrl).toBe("https://m.c6k6.com/124/124560/");
  });

  it.each([
    ["https://www.ihuliwang.com/dir/1703891.html", "huliwang", "https://m.ihuliwang.com/dir/1703891.html"],
    ["https://m.huliwang.ai/1703891/36/3.html", "huliwang", "https://m.huliwang.ai/1703891/36/3.html"],
    ["https://www.timotxt.net/0108567756/332.html", "timotxt", "https://www.timotxt.net/0108567756/332.html"],
    ["https://qingrenyouxi.vn/book/115013/33160353.html", "qingrenyouxi", "https://www.qingrenyouxi.vn/book/115013/33160353.html"],
    ["https://www.xbanxia.xyz/books/143300.html", "xbanxia", "https://www.xbanxia.xyz/books/143300.html"],
    ["https://xszj.com/b/485734/c/856451?page=2", "xszj", "https://xszj.com/b/485734/c/856451?page=2"],
    ["https://ixdzs8.ai/read/646225/p1.html", "xszj", "https://ixdzs8.ai/read/646225/p1.html"],
    ["https://m.liehuozw.net/74/74628/12_2.html", "liehuozw", "https://m.liehuozw.net/74/74628/12_2.html"],
    ["https://www.uaa002.xyz/novel/read/11306159/8", "uaa002", "https://m.uaa002.xyz/novel/read/11306159/8"],
    ["https://www.c6k6.ai/book/138252/8.html", "c6k6", "https://m.c6k6.ai/138/138252/8.html"],
    ["https://czbooks.com/n/pmeef4/8", "czbooks", "https://czbooks.com/n/pmeef4/8"],
    ["https://novel543.net/1013669909/8096_1_2.html", "novel543", "https://www.novel543.net/1013669909/8096_1_2.html"],
  ] as const)("accepts changed domain for unchanged %s structure", (url, site, normalizedUrl) => {
    expect(parseStoryUrl(url)).toMatchObject({ site, normalizedUrl });
  });

  it.each([
    ["https://anything.example/dir/1703891.html", "huliwang", "https://m.anything.example/dir/1703891.html"],
    ["https://reader.example/book12/dir", "timotxt", "https://www.reader.example/book12/dir"],
    ["https://source.example/book/115013/33160353.html", "qingrenyouxi", "https://www.source.example/book/115013/33160353.html"],
    ["https://mirror.example/books/143300/28251886.html", "xbanxia", "https://www.mirror.example/books/143300/28251886.html"],
    ["https://mirror.example/b/485734/c/856451?page=2", "xszj", "https://mirror.example/b/485734/c/856451?page=2"],
    ["https://archive.example/read/646225/p1.html", "xszj", "https://archive.example/read/646225/p1.html"],
    ["https://novel.example/74/74628/12_2.html", "liehuozw", "https://m.novel.example/74/74628/12_2.html"],
    ["https://app.example/novel/read/11306159/8", "uaa002", "https://m.app.example/novel/read/11306159/8"],
    ["https://books.example/book/138252/8.html", "c6k6", "https://m.books.example/138/138252/8.html"],
    ["https://reader.example/n/pmeef4/8", "czbooks", "https://reader.example/n/pmeef4/8"],
    ["https://text.example/1013669909/8096_1_2.html", "novel543", "https://www.text.example/1013669909/8096_1_2.html"],
  ] as const)("infers %s from unchanged path structure on arbitrary host", (url, site, normalizedUrl) => {
    expect(parseStoryUrl(url)).toMatchObject({ site, normalizedUrl });
  });

  it("normalizes Novel543 chapters and keeps its verified same-chapter page suffix", () => {
    const parsed = parseStoryUrl("http://novel543.com/1013669909/8096_1_2.html?from=history#chapter");
    expect(parsed).toMatchObject({
      site: "novel543",
      kind: "chapter",
      bookId: "1013669909",
      chapterKey: "8096_1",
      page: 2,
      normalizedUrl: "https://www.novel543.com/1013669909/8096_1_2.html",
      bookUrl: "https://www.novel543.com/1013669909/",
      catalogUrl: "https://www.novel543.com/1013669909/dir",
    });
  });

  it.each([
    "https://www.timotxt.com.evil.test/0108567756/dir",
    "https://user:pass@www.timotxt.com/0108567756/dir",
    "file:///1703891/",
    "https://m.huliwang.net/1703891/36/3.html.evil",
    "https://www.qingrenyouxi.com/list/1.html",
    "https://www.timotxt.com./0108567756/dir",
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
    "https://www.xbanxia.cc.evil.test/books/143300.html",
    "https://user:pass@www.xbanxia.cc/books/143300.html",
    "https://www.xbanxia.cc:444/books/143300.html",
    "https://www.xbanxia.cc./books/143300.html",
    "https://www.xbanxia.cc/book/143300.html",
    "https://www.xbanxia.cc/books/not-a-number.html",
    "https://www.xbanxia.cc/books/143300/not-a-chapter.html",
    "https://www.xbanxia.cc/books/143300/28251886/extra.html",
    "https://www.xbanxia.cc/books/143300%2F28251886.html",
    "https://www.novel543.com.evil.test/1013669909/",
    "https://user:pass@www.novel543.com/1013669909/",
    "https://www.novel543.com:444/1013669909/",
    "https://www.novel543.com./1013669909/",
    "https://www.novel543.com/not-a-book/",
    "https://www.novel543.com/1013669909/not-a-chapter.html",
    "https://www.novel543.com/1013669909/8096_1.html/extra",
    "https://www.novel543.com/1013669909%2F8096_1.html",
  ])("rejects non-allowlisted or unsupported URL %s", (url) => {
    expect(() => parseStoryUrl(url)).toThrow();
  });

  it("rejects Novel543 redirects to another domain or another book", () => {
    expect(() => assertSnapshotUrl(
      "https://www.novel543.com.evil.test/1013669909/8096_1.html",
      "novel543",
      "1013669909",
    )).toThrow(/ngoài phạm vi an toàn/u);
    expect(() => assertSnapshotUrl(
      "https://www.novel543.com/1022699969/8096_1.html",
      "novel543",
      "1013669909",
    )).toThrow(/sách khác/u);
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

  it("keeps only XSZJ's allowed page query and canonicalizes both supported host families", () => {
    expect(parseStoryUrl("https://xszj.org/b/485734/c/856451?page=2&utm=no#x")).toMatchObject({
      site: "xszj", normalizedUrl: "https://xszj.org/b/485734/c/856451?page=2", page: 2,
      bookUrl: "https://xszj.org/b/485734", catalogUrl: "https://xszj.org/b/485734/cs/1",
    });
    expect(parseStoryUrl("https://ixdzs8.com/read/646225/p1.html?junk=1").normalizedUrl)
      .toBe("https://ixdzs8.com/read/646225/p1.html");
  });
});
