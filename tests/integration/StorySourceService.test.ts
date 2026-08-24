import { describe, expect, it, vi } from "vitest";
import { splitStory, validateTranslation } from "../../src/core";
import { StorySourceService } from "../../src/main/storySources/StorySourceService";
import {
  launchDefaultBrowserPairingPage,
} from "../../src/main/storySources/manualVerification";
import {
  TIMOTXT_BQG_FONT_HASH,
  TimotxtF24092Decoder,
} from "../../src/main/storySources/timotxtDecoder";
import type {
  StoryPageClient,
  StoryPageLink,
  StoryPageSnapshot,
  StoryTranscodeResponse,
} from "../../src/main/storySources/types";

function link(href: string, text: string, scopes: string[] = []): StoryPageLink {
  return { href, text, scopes };
}

function page(
  url: string,
  overrides: Partial<StoryPageSnapshot> = {},
): StoryPageSnapshot {
  return {
    requestedUrl: url,
    url,
    status: 200,
    title: "Trang truyện",
    canonicalUrl: url,
    charset: "UTF-8",
    htmlLanguage: "zh-hans",
    bodyText: "Nội dung trang truyện hợp lệ và không có xác minh.",
    elements: {},
    links: [],
    fontFamilies: [],
    fontUrls: [],
    fontHashes: [],
    challenge: "none",
    ...overrides,
  };
}

class FakeClient implements StoryPageClient {
  public readonly visits: string[] = [];
  public readonly inspections: string[] = [];
  public readonly transcodes: Array<{ bookId: string; chapterId: string; sourceId: string; referer: string }> = [];
  public closed = false;
  private currentUrl?: string;

  public constructor(
    private readonly pages: Map<string, StoryPageSnapshot | StoryPageSnapshot[] | Error | (() => Promise<StoryPageSnapshot>)>,
    private readonly transcoder?: (
      request: { bookId: string; chapterId: string; sourceId: string; referer: string },
    ) => StoryTranscodeResponse | Promise<StoryTranscodeResponse>,
  ) {}

  public async visit(url: string, signal?: AbortSignal): Promise<StoryPageSnapshot> {
    this.visits.push(url);
    this.currentUrl = url;
    return this.read(url, signal);
  }

  public async inspectCurrent(signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (!this.currentUrl) throw new Error("No fake page is currently open");
    this.inspections.push(this.currentUrl);
    return this.read(this.currentUrl, signal);
  }

  private async read(url: string, signal?: AbortSignal): Promise<StoryPageSnapshot> {
    if (signal?.aborted) throw signal.reason;
    const value = this.pages.get(url);
    if (!value) throw new Error(`Missing fake page: ${url}`);
    if (value instanceof Error) throw value;
    if (typeof value === "function") return value();
    if (Array.isArray(value)) {
      const next = value.shift();
      if (!next) throw new Error(`No fake response left: ${url}`);
      return next;
    }
    return value;
  }

  public async transcode(
    request: { bookId: string; chapterId: string; sourceId: string; referer: string },
  ): Promise<StoryTranscodeResponse> {
    this.transcodes.push(request);
    if (!this.transcoder) throw new Error("Malformed transcode JSON");
    return this.transcoder(request);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

function service(client: StoryPageClient, extra: Partial<ConstructorParameters<typeof StorySourceService>[0]> = {}) {
  return new StorySourceService({
    pageClient: client,
    minRequestIntervalMs: 0,
    verificationWaitMs: 0,
    ...extra,
  });
}

function huliCatalog(): StoryPageSnapshot {
  const url = "https://m.huliwang.net/dir/1703891.html";
  return page(url, {
    title: "要命！首长的小娇妻夜夜闹离婚目录",
    canonicalUrl: undefined,
    elements: { h1: ["要命！首长的小娇妻夜夜闹离婚章节列表"] },
    links: [
      link("https://m.huliwang.net/1703891/35.html", "35.第35章 周美玉寻死"),
      link("https://m.huliwang.net/1703891/36.html", "36.第36章 板凳团长"),
      link("https://m.huliwang.net/1703891/37.html", "37.第 37章 何秀秀挑唆"),
    ],
  });
}

const XBANXIA_BOOK_URL = "https://www.xbanxia.cc/books/143300.html";
const XBANXIA_INTRO_URL = "https://www.xbanxia.cc/books/143300/28251880.html";
const XBANXIA_CHAPTER_ONE_URL = "https://www.xbanxia.cc/books/143300/28251886.html";
const XSZJ_BOOK_URL = "https://xszj.org/b/485734";
const XSZJ_CATALOG_URL = "https://xszj.org/b/485734/cs/1";
const XSZJ_CHAPTER_URL = "https://xszj.org/b/485734/c/856451";
const IXDZS_BOOK_URL = "https://ixdzs8.com/read/646225/";

function xbanxiaCatalog(overrides: Partial<StoryPageSnapshot> = {}): StoryPageSnapshot {
  const chapterLinks = Array.from({ length: 164 }, (_, index) => {
    const number = index + 1;
    const url = number === 1
      ? XBANXIA_CHAPTER_ONE_URL
      : `https://www.xbanxia.cc/books/143300/${29_000_000 + number}.html`;
    return link(url, number === 1 ? "【第1章 替婚】" : `【第${number}章 測試章節${number}】`, [".book-list"]);
  });
  return page(XBANXIA_BOOK_URL, {
    title: "嫁給殘疾皇子後, 嫁給殘疾皇子後小說全文在線閱讀 - 半夏小說",
    canonicalUrl: "http://www.xbanxia.cc/books/143300.html",
    bodyText: "半夏小說 首頁 每日推薦 錯誤提交，這些頁面外圍文字絕不能成為書名或正文。",
    elements: {
      h1: ["半夏小說", "每日推薦"],
      ".book-describe h1": ["嫁給殘疾皇子後"],
      ".book-describe a[href^='/author/']": ["李寂v5"],
    },
    links: [
      // Same-book links outside .book-list model the latest-chapter duplicate
      // and other page chrome. Neither may enter the canonical catalog.
      link(XBANXIA_CHAPTER_ONE_URL, "最新章節 第1章 替婚", [".book-describe"]),
      link("https://www.xbanxia.cc/books/143300/39999999.html", "第999章 外圍假章節", [".book-describe"]),
      link(XBANXIA_INTRO_URL, "作品相關", [".book-list"]),
      ...chapterLinks,
      link("https://www.xbanxia.cc/books/423391/99999999.html", "第1章 推薦書籍", [".book-list"]),
    ],
    ...overrides,
  });
}

const XBANXIA_CHAPTER_ONE_TEXT = "榮國公府的清晨十分安靜，寶寧收好行囊後推開房門，決定坦然面對即將到來的新生活。";

function xbanxiaChapterOne(overrides: Partial<StoryPageSnapshot> = {}): StoryPageSnapshot {
  return page(XBANXIA_CHAPTER_ONE_URL, {
    title: "嫁給殘疾皇子後 第1章 替婚 - 半夏小說",
    canonicalUrl: "http://www.xbanxia.cc/books/143300/28251886.html",
    charset: "UTF-8",
    bodyText: [
      "上一章︰作品相關 下一章︰第2章 出嫁",
      XBANXIA_CHAPTER_ONE_TEXT,
      "錯誤提交 問題類型 每日推薦 more>> Privacy Policy",
    ].join("\n"),
    elements: {
      "#nr_title": ["第1章 替婚"],
      "#nr1": [[
        "第1章 替婚",
        XBANXIA_CHAPTER_ONE_TEXT,
        "作者有話要說：這是站點附加註記，不屬於小說正文。",
        "每日推薦：這一行同樣不得進入正文。",
        "半夏小說，快樂很多",
      ].join("\n")],
      h1: ["半夏小說", "每日推薦"],
    },
    links: [
      link("https://www.xbanxia.cc/books/143300/29000002.html", "下一章︰第2章 出嫁", [".nav2"]),
    ],
    ...overrides,
  });
}

describe("StorySourceService integration", () => {
  it("keeps unnumbered and duplicate-number catalog items as distinct output chapters", async () => {
    const bookUrl = "https://www.qingrenyouxi.com/book/115013.html";
    const chapterUrls = [
      "https://www.qingrenyouxi.com/book/115013/33160151.html",
      "https://www.qingrenyouxi.com/book/115013/33160152.html",
      "https://www.qingrenyouxi.com/book/115013/33160153.html",
    ];
    const labels = ["番外 梦醒", "第1章 初见", "第1章 再会"];
    const pages = new Map<string, StoryPageSnapshot>([[bookUrl, page(bookUrl, {
      elements: { ".bookTitle": ["章节边界测试"] },
      links: chapterUrls.map((url, index) => link(url, labels[index]!, ["#list-chapterAll"])),
    })]]);
    chapterUrls.forEach((url, index) => {
      const heading = labels[index]!;
      pages.set(url, page(url, {
        elements: {
          ".readTitle": [heading],
          "#htmlContent": [`${heading}\n夜色渐深，他们终于看清了眼前的道路，然后并肩继续向前走去。`],
        },
      }));
    });

    const source = service(new FakeClient(pages));
    const analysis = await source.analyzeUrl(bookUrl);
    expect(analysis.chapters.map((chapter) => chapter.number)).toEqual([undefined, 1, 1]);

    const fetched = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    const headers = fetched.combinedSource
      .split(/\r\n|\r|\n/u)
      .filter((line) => /^Chương\s/u.test(line));
    expect(headers).toEqual([
      "Chương 1: 番外 梦醒",
      "Chương 2: 初见",
      "Chương 3: 再会",
    ]);

    const split = splitStory(fetched.combinedSource, {
      targetWords: 800,
      prefix: "",
      suffix: "",
      startIndex: 1,
      inputLanguage: "zh",
      autoDetectTitle: true,
    });
    expect(split.map((chapter) => chapter.index)).toEqual([1, 2, 3]);
    expect(split.map((chapter) => chapter.title)).toEqual([
      "Chương 1: 番外 梦醒",
      "Chương 2: 初见",
      "Chương 3: 再会",
    ]);

    const validation = validateTranslation(
      fetched.combinedSource,
      "Chương 1: Ngoại truyện\n\nNội dung một.\n\nChương 2: Gặp gỡ\n\nNội dung hai.\n\nChương 3: Tái ngộ\n\nNội dung ba.",
      {
        requireNoHan: false,
        minimumSourceLengthForRatioCheck: Number.MAX_SAFE_INTEGER,
        checkPreamble: false,
        checkTruncation: false,
        checkRepetition: false,
      },
    );
    expect(validation.issues.map((issue) => issue.code)).not.toContain("chapter_structure");
  });

  it("analyzes a Huliwang chapter URL, selects only that chapter, and merges verified pages", async () => {
    const catalog = huliCatalog();
    const p1 = "https://m.huliwang.net/1703891/36.html";
    const p2 = "https://m.huliwang.net/1703891/36/2.html";
    const p3 = "https://m.huliwang.net/1703891/36/3.html";
    const client = new FakeClient(new Map([
      [catalog.url, catalog],
      [p1, page(p1, {
        // Host aliases and the explicit /1.html page-one alias represent the
        // same normalized Huliwang chapter and must remain accepted.
        url: "https://www.huliwang.net/1703891/36/1.html",
        canonicalUrl: "https://www.huliwang.net/1703891/36.html",
        elements: {
          "#nr_title": ["第36章 板凳团长"],
          "#nr": ["第一页正文足够长，这是故事开始的一段内容。\n点击下一页继续~ 此页为本章 第1页 / 共3页~"],
        },
        links: [link(p2, "下一页")],
      })],
      [p2, page(p2, {
        elements: {
          "#nr_title": ["第36章 板凳团长 第2页"],
          "#nr": ["第二页正文也足够长，人物继续向前走并发生了新事情。\n点击下一页继续~ 此页为本章 第2页 / 共3页~"],
        },
        links: [link(p3, "下一页")],
      })],
      [p3, page(p3, {
        elements: {
          "#nr_title": ["第36章 板凳团长 第3页"],
          "#nr": ["第三页正文作为结尾，所有人终于明白了事情的来龙去脉。"],
        },
        links: [link("https://m.huliwang.net/1703891/37.html", "下一章")],
      })],
    ]));
    const source = service(client);
    const progress = vi.fn();
    source.onProgress(progress);

    const analysis = await source.analyzeUrl("https://www.huliwang.net/1703891/36/3.html");
    expect(analysis.inputKind).toBe("chapter");
    expect(analysis.defaultSelectedChapterIds).toEqual(["huliwang:1703891:36"]);
    expect(analysis.chapters.map((chapter) => chapter.number)).toEqual([35, 36, 37]);

    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters[0]).toMatchObject({ mergedPartCount: 3, number: 36 });
    expect(result.chapters[0]?.sourceText).toContain("第一页正文");
    expect(result.chapters[0]?.sourceText).toContain("第三页正文");
    expect(result.chapters[0]?.sourceText).not.toContain("点击下一页");
    expect(client.visits).not.toContain("https://m.huliwang.net/1703891/36/4.html");
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "completed" }));
  });

  it("releases a factory-owned non-Huli source browser after fetch and opens a fresh one", async () => {
    const firstClient = new FakeClient(new Map([
      [XBANXIA_BOOK_URL, xbanxiaCatalog()],
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne()],
    ]));
    const secondClient = new FakeClient(new Map([[XBANXIA_BOOK_URL, xbanxiaCatalog()]]));
    const pageClientFactory = vi.fn()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    const source = new StorySourceService({
      pageClientFactory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });

    const analysis = await source.analyzeUrl(XBANXIA_CHAPTER_ONE_URL);
    await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(firstClient.closed).toBe(true);
    expect(pageClientFactory).toHaveBeenCalledTimes(1);

    await source.analyzeUrl(XBANXIA_BOOK_URL);
    expect(pageClientFactory).toHaveBeenCalledTimes(2);
    expect(secondClient.visits).toContain(XBANXIA_BOOK_URL);
    await source.close();
    expect(secondClient.closed).toBe(true);
  });

  it("requires the paired daily browser before creating any automated Huliwang client", async () => {
    const catalog = huliCatalog();
    const companionClient = new FakeClient(new Map([[catalog.url, catalog]]));
    const pageClientFactory = vi.fn(async () => new FakeClient(new Map()));
    const manualVerificationLauncher = vi.fn(async () => undefined);
    const companionClose = vi.fn(async () => undefined);
    const waitUntilPaired = vi.fn(async () => undefined);
    const pairingUrl = "http://127.0.0.1:45678/v1/pair#tdt-pair=test-payload";
    const huliwangCompanionFactory = vi.fn(async () => ({
      bridgeOrigin: "http://127.0.0.1:45678",
      pairingUrl,
      client: companionClient,
      waitUntilPaired,
      close: companionClose,
    }));
    const source = new StorySourceService({
      pageClientFactory,
      manualVerificationLauncher,
      huliwangCompanionFactory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });

    await expect(source.analyzeUrl("https://m.huliwang.net/1703891/"))
      .rejects.toMatchObject({
        code: "USER_ACTION_REQUIRED",
        message: "Huliwang chỉ được đọc bằng trình duyệt mặc định và hồ sơ bạn dùng hằng ngày. Hãy bấm Kết nối trình duyệt mặc định; tool không mở trình duyệt tự động cho Huliwang.",
      });
    expect(pageClientFactory).not.toHaveBeenCalled();

    await source.openManualVerification("https://www.huliwang.net/1703891/1.html?ignored=1#ignored");
    const analysis = await source.analyzeUrl("https://m.huliwang.net/1703891/");
    expect(analysis.chapters).toHaveLength(3);
    expect(manualVerificationLauncher).toHaveBeenCalledTimes(1);
    expect(manualVerificationLauncher).toHaveBeenCalledWith({
      url: pairingUrl,
    });
    expect(waitUntilPaired).toHaveBeenCalledTimes(1);
    expect(pageClientFactory).not.toHaveBeenCalled();
    await source.close();
    expect(companionClose).toHaveBeenCalledTimes(1);
  });

  it("uses the paired daily-browser companion for Huliwang analyze and fetch without reopening Playwright", async () => {
    const catalog = huliCatalog();
    const chapterUrl = "https://m.huliwang.net/1703891/36.html";
    const companionClient = new FakeClient(new Map([
      [catalog.url, catalog],
      [chapterUrl, page(chapterUrl, {
        elements: {
          "#nr_title": ["第36章 板凳团长"],
          "#nr": ["这是已经通过普通浏览器读取并检查的正文内容，人物继续向前走，故事里没有网页导航或广告。"],
        },
        links: [link("https://m.huliwang.net/1703891/37.html", "下一章")],
      })],
    ]));
    const playwrightFactory = vi.fn(async () => new FakeClient(new Map()));
    const session = {
      bridgeOrigin: "http://127.0.0.1:45678",
      pairingUrl: "http://127.0.0.1:45678/v1/pair#tdt-pair=test-payload",
      client: companionClient,
      waitUntilPaired: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const source = new StorySourceService({
      pageClientFactory: playwrightFactory,
      huliwangCompanionFactory: vi.fn(async () => session),
      manualVerificationLauncher: vi.fn(async () => undefined),
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });

    await source.openManualVerification(chapterUrl);
    const analysis = await source.analyzeUrl(chapterUrl);
    const fetched = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });

    expect(playwrightFactory).not.toHaveBeenCalled();
    expect(companionClient.visits).toContain(catalog.url);
    expect(companionClient.visits).toContain(chapterUrl);
    expect(fetched.chapters).toHaveLength(1);
    expect(fetched.chapters[0]?.sourceText).toContain("普通浏览器");
    // releasePageClient after fetch closes only the Playwright boundary; the
    // paired companion persists for the full book until service shutdown.
    expect(session.close).not.toHaveBeenCalled();
    await source.close();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("requires the paired daily browser for XSZJ and reads it without launching Playwright", async () => {
    const storyText = "这是由日常浏览器读取的 XSZJ 正文，人物在雨夜里做出了新的决定，故事继续向前发展。";
    const catalog = page(XSZJ_CATALOG_URL, {
      title: "XSZJ 目录",
      elements: { h1: ["XSZJ 测试小说"] },
      links: [link(XSZJ_CHAPTER_URL, "第1章 测试开篇", ["#list"])],
    });
    const companionClient = new FakeClient(new Map([
      [XSZJ_BOOK_URL, page(XSZJ_BOOK_URL, {
        title: "XSZJ 测试小说",
        elements: { h1: ["XSZJ 测试小说"] },
      })],
      [XSZJ_CATALOG_URL, catalog],
      [XSZJ_CHAPTER_URL, page(XSZJ_CHAPTER_URL, {
        elements: {
          h1: ["第1章 测试开篇"],
          "#content": [storyText],
        },
      })],
    ]));
    const playwrightFactory = vi.fn(async () => new FakeClient(new Map()));
    const session = {
      bridgeOrigin: "http://127.0.0.1:45678",
      pairingUrl: "http://127.0.0.1:45678/v1/pair#tdt-pair=test-payload",
      client: companionClient,
      waitUntilPaired: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const source = new StorySourceService({
      pageClientFactory: playwrightFactory,
      huliwangCompanionFactory: vi.fn(async () => session),
      manualVerificationLauncher: vi.fn(async () => undefined),
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });

    await expect(source.analyzeUrl(XSZJ_BOOK_URL)).rejects.toMatchObject({
      code: "USER_ACTION_REQUIRED",
      message: expect.stringMatching(/XSZJ\/爱下电子书/u),
    });
    expect(playwrightFactory).not.toHaveBeenCalled();

    await source.openManualVerification(XSZJ_BOOK_URL);
    const analysis = await source.analyzeUrl(XSZJ_BOOK_URL);
    const fetched = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });

    expect(playwrightFactory).not.toHaveBeenCalled();
    expect(companionClient.visits).toEqual(expect.arrayContaining([
      XSZJ_BOOK_URL,
      XSZJ_CATALOG_URL,
      XSZJ_CHAPTER_URL,
    ]));
    expect(fetched.chapters).toHaveLength(1);
    expect(fetched.chapters[0]?.sourceText).toContain("日常浏览器");
    expect(session.close).not.toHaveBeenCalled();
    await source.close();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("opens only a validated loopback pairing page through the OS default browser", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const payload = Buffer.from(JSON.stringify({
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      token: "t".repeat(43),
    }), "utf8").toString("base64url");
    const pairingUrl = `http://127.0.0.1:45678/v1/pair#tdt-pair=${payload}`;

    await launchDefaultBrowserPairingPage({ url: pairingUrl }, { openExternal });

    expect(openExternal).toHaveBeenCalledWith(pairingUrl);
    for (const unsafe of [
      "https://m.huliwang.net/1703891/1.html",
      pairingUrl.replace("127.0.0.1", "localhost"),
      pairingUrl.replace("/v1/pair", "/other"),
      "http://127.0.0.1:45678/v1/pair#tdt-pair=short",
    ]) {
      await expect(launchDefaultBrowserPairingPage({ url: unsafe }, { openExternal }))
        .rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
    }
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("launches the Windows HTTPS Edge association directly instead of delegating to Cốc Cốc", async () => {
    const payload = Buffer.from(JSON.stringify({
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      token: "u".repeat(43),
    }), "utf8").toString("base64url");
    const pairingUrl = `http://127.0.0.1:45679/v1/pair#tdt-pair=${payload}`;
    const readString = vi.fn(async (key: string, valueName?: string) => {
      if (key.endsWith("UserChoice") && valueName === "ProgId") return "MSEdgeHTM";
      if (key === "HKCR\\MSEdgeHTM\\shell\\open\\command") {
        return '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument "%1"';
      }
      return undefined;
    });
    const launch = vi.fn(async (_executable: string, _args: readonly string[]) => undefined);
    const shellOpenExternal = vi.fn(async (_url: string) => undefined);

    await launchDefaultBrowserPairingPage(
      { url: pairingUrl },
      {
        platform: "win32",
        windowsRegistryReader: { readString },
        browserProcessLauncher: { launch },
        shellOpenExternal,
      },
    );

    expect(launch).toHaveBeenCalledWith(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ["--single-argument", pairingUrl],
    );
    expect(shellOpenExternal).not.toHaveBeenCalled();
  });

  it("refuses a Cốc Cốc HTTPS association rather than silently opening the helper there", async () => {
    const payload = Buffer.from(JSON.stringify({
      sessionId: "123e4567-e89b-42d3-a456-426614174002",
      token: "v".repeat(43),
    }), "utf8").toString("base64url");
    const pairingUrl = `http://127.0.0.1:45680/v1/pair#tdt-pair=${payload}`;
    const launch = vi.fn(async (_executable: string, _args: readonly string[]) => undefined);
    const shellOpenExternal = vi.fn(async (_url: string) => undefined);

    await expect(launchDefaultBrowserPairingPage(
      { url: pairingUrl },
      {
        platform: "win32",
        windowsRegistryReader: {
          readString: async (key: string, valueName?: string) => {
            if (key.endsWith("UserChoice") && valueName === "ProgId") return "CocCocHTML";
            if (key === "HKCR\\CocCocHTML\\shell\\open\\command") {
              return '"C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe" --single-argument "%1"';
            }
            return undefined;
          },
        },
        browserProcessLauncher: { launch },
        shellOpenExternal,
      },
    )).rejects.toThrow(/Microsoft Edge hoặc Google Chrome/u);

    expect(launch).not.toHaveBeenCalled();
    expect(shellOpenExternal).not.toHaveBeenCalled();
  });

  it("rejects manual verification for another site or while a source operation is active without launching Edge", async () => {
    const launcher = vi.fn(async () => undefined);
    const source = new StorySourceService({
      manualVerificationLauncher: launcher,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });
    await expect(source.openManualVerification("https://www.timotxt.com/1509589610/13.html"))
      .rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
    expect(launcher).not.toHaveBeenCalled();

    const catalog = huliCatalog();
    let releaseCatalog: (() => void) | undefined;
    const catalogGate = new Promise<void>((resolve) => { releaseCatalog = resolve; });
    const gatedClient = new FakeClient(new Map([[catalog.url, async () => {
      await catalogGate;
      return catalog;
    }]]));
    const gatedSource = new StorySourceService({
      pageClient: gatedClient,
      manualVerificationLauncher: launcher,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });
    const pending = gatedSource.analyzeUrl("https://m.huliwang.net/1703891/");
    await Promise.resolve();
    await expect(gatedSource.openManualVerification("https://m.huliwang.net/1703891/1.html"))
      .rejects.toThrow(/Đang có một thao tác nguồn truyện khác/u);
    expect(launcher).not.toHaveBeenCalled();
    releaseCatalog?.();
    await pending;
  });

  it("replaces a factory-owned closed non-Huli page client once", async () => {
    const closedClient = new FakeClient(new Map<string, StoryPageSnapshot | Error>([
      [XBANXIA_BOOK_URL, xbanxiaCatalog()],
      [XBANXIA_CHAPTER_ONE_URL, new Error("page.goto: Target page, context or browser has been closed")],
    ]));
    const replacementClient = new FakeClient(new Map([
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne()],
    ]));
    const pageClientFactory = vi.fn()
      .mockResolvedValueOnce(closedClient)
      .mockResolvedValueOnce(replacementClient);
    const source = new StorySourceService({
      pageClientFactory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });

    const analysis = await source.analyzeUrl(XBANXIA_CHAPTER_ONE_URL);
    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });

    expect(result.chapters[0]?.sourceText).toContain(XBANXIA_CHAPTER_ONE_TEXT);
    expect(pageClientFactory).toHaveBeenCalledTimes(2);
    expect(closedClient.visits).toEqual([XBANXIA_BOOK_URL, XBANXIA_CHAPTER_ONE_URL]);
    expect(closedClient.closed).toBe(true);
    expect(replacementClient.visits).toEqual([XBANXIA_CHAPTER_ONE_URL]);
    expect(replacementClient.closed).toBe(true);
  });

  it("does not recreate a caller-supplied client or retry non-closed visit failures", async () => {
    const catalog = huliCatalog();
    const closedSupplied = new FakeClient(new Map([[
      catalog.url,
      new Error("page.goto: Target page, context or browser has been closed"),
    ]]));
    const unusedFactory = vi.fn(async () => new FakeClient(new Map([[catalog.url, catalog]])));
    const suppliedSource = new StorySourceService({
      pageClient: closedSupplied,
      pageClientFactory: unusedFactory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });
    await expect(suppliedSource.analyzeUrl("https://m.huliwang.net/1703891/"))
      .rejects.toThrow(/Target page, context or browser has been closed/u);
    expect(unusedFactory).not.toHaveBeenCalled();
    expect(closedSupplied.closed).toBe(false);

    const networkFailure = new FakeClient(new Map([[
      XBANXIA_BOOK_URL,
      new Error("net::ERR_CONNECTION_RESET"),
    ]]));
    const fallback = new FakeClient(new Map([[XBANXIA_BOOK_URL, xbanxiaCatalog()]]));
    const factory = vi.fn()
      .mockResolvedValueOnce(networkFailure)
      .mockResolvedValueOnce(fallback);
    const source = new StorySourceService({
      pageClientFactory: factory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });
    await expect(source.analyzeUrl(XBANXIA_BOOK_URL))
      .rejects.toThrow(/ERR_CONNECTION_RESET/u);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(networkFailure.closed).toBe(false);
    expect(fallback.visits).toEqual([]);
  });

  it("turns a second closed replacement context into a clear retry instruction", async () => {
    const firstClosed = new FakeClient(new Map([[
      XBANXIA_BOOK_URL,
      new Error("page.goto: Target page, context or browser has been closed"),
    ]]));
    const replacementClosed = new FakeClient(new Map([[
      XBANXIA_BOOK_URL,
      new Error("page.goto: Target page, context or browser has been closed"),
    ]]));
    const factory = vi.fn()
      .mockResolvedValueOnce(firstClosed)
      .mockResolvedValueOnce(replacementClosed);
    const source = new StorySourceService({
      pageClientFactory: factory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 0,
    });

    await expect(source.analyzeUrl(XBANXIA_BOOK_URL))
      .rejects.toMatchObject({
        code: "SOURCE_BLOCKED",
        message: expect.stringMatching(/Phiên trình duyệt đọc nguồn vừa bị đóng[\s\S]*Phân tích lại/iu),
      });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(firstClosed.closed).toBe(true);
    expect(replacementClosed.closed).toBe(true);
  });

  it("merges adjacent Huliwang catalog continuations and deduplicates their content overlap", async () => {
    const catalogUrl = "https://m.huliwang.net/dir/1703891.html";
    const firstUrl = "https://m.huliwang.net/1703891/40.html";
    const continuationUrl = "https://m.huliwang.net/1703891/41.html";
    const nextUrl = "https://m.huliwang.net/1703891/42.html";
    const overlap = "他们终于走到了熟悉的木门口";
    const client = new FakeClient(new Map([
      [catalogUrl, page(catalogUrl, {
        canonicalUrl: undefined,
        elements: { h1: ["测试故事章节列表"] },
        links: [
          link(firstUrl, "第1章 今日归家"),
          link(continuationUrl, "第1章 续"),
          link(nextUrl, "第2章 新的旅程"),
        ],
      })],
      [firstUrl, page(firstUrl, {
        elements: {
          "#nr_title": ["第1章 今日归家"],
          "#nr": [`故事从安静的晨光中开始，${overlap}`],
        },
      })],
      [continuationUrl, page(continuationUrl, {
        elements: {
          "#nr_title": ["第1章 续"],
          "#nr": [`${overlap}，并听见屋里传来了熟悉的笑声。`],
        },
      })],
    ]));
    const source = service(client);
    const analysis = await source.analyzeUrl(continuationUrl);
    expect(analysis.chapters).toHaveLength(2);
    expect(analysis.defaultSelectedChapterIds).toEqual(["huliwang:1703891:40"]);
    expect(analysis.chapters[0]?.partUrls).toEqual([firstUrl, continuationUrl]);

    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters[0]).toMatchObject({ title: "今日归家", mergedPartCount: 2 });
    expect(result.chapters[0]?.sourceText.match(new RegExp(overlap, "gu"))).toHaveLength(1);
    expect(result.chapters[0]?.warnings.join("\n")).toContain("Đã loại");
  });

  it("polls passive Cloudflare until it clears but never attempts an interactive challenge", async () => {
    const catalog = huliCatalog();
    const passive = page(catalog.url, { challenge: "passive", title: "Just a moment", bodyText: "Checking your browser" });
    const sleeper = vi.fn(async (_milliseconds: number, _signal?: AbortSignal) => undefined);
    const client = new FakeClient(new Map([[catalog.url, [passive, passive, catalog]]]));
    const source = service(client, { verificationWaitMs: 5_000, sleep: sleeper });
    const analysis = await source.analyzeUrl("https://m.huliwang.net/1703891/");
    expect(analysis.chapters).toHaveLength(3);
    expect(sleeper.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([2_000, 2_000]);
    // Regression: the passive challenge is opened once, then sampled in the
    // same tab. Repeated goto calls would reset Cloudflare indefinitely.
    expect(client.visits).toEqual([catalog.url]);
    expect(client.inspections).toEqual([catalog.url, catalog.url]);

    const interactiveClient = new FakeClient(new Map([[
      catalog.url,
      page(catalog.url, { challenge: "interactive", bodyText: "Turnstile" }),
    ]]));
    await expect(service(interactiveClient).analyzeUrl("https://m.huliwang.net/1703891/"))
      .rejects.toMatchObject({
        code: "USER_ACTION_REQUIRED",
        message: expect.stringMatching(/đã đóng phiên đọc tự động[\s\S]*không bấm CAPTCHA\/Turnstile/iu),
      });
  });

  it("never launches a factory-owned automated browser for an unpaired Huliwang URL", async () => {
    const pageClientFactory = vi.fn(async () => new FakeClient(new Map()));
    const source = new StorySourceService({
      pageClientFactory,
      minRequestIntervalMs: 0,
      verificationWaitMs: 30_000,
    });

    await expect(source.analyzeUrl("https://m.huliwang.net/1703891/"))
      .rejects.toMatchObject({
        code: "USER_ACTION_REQUIRED",
        message: expect.stringMatching(/Huliwang/iu),
      });
    expect(pageClientFactory).not.toHaveBeenCalled();
  });

  it("allows a clean user retry after an interactive Huliwang verification failure", async () => {
    const catalog = huliCatalog();
    const interactive = page(catalog.url, { challenge: "interactive", bodyText: "Turnstile" });
    const client = new FakeClient(new Map([[catalog.url, [interactive, catalog]]]));
    const source = service(client);
    await expect(source.analyzeUrl("https://m.huliwang.net/1703891/"))
      .rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    const retry = await source.analyzeUrl("https://m.huliwang.net/1703891/");
    expect(retry.chapters).toHaveLength(3);
    expect(client.visits).toEqual([catalog.url, catalog.url]);
  });

  it("rejects invalid Huliwang page sequences instead of enumerating beyond total", async () => {
    const catalog = huliCatalog();
    const p1 = "https://m.huliwang.net/1703891/36.html";
    const p4 = "https://m.huliwang.net/1703891/36/4.html";
    const client = new FakeClient(new Map([
      [catalog.url, catalog],
      [p1, page(p1, {
        elements: { "#nr_title": ["第36章"], "#nr": ["足够长的正文内容，这里故意给出错误的分页链接。"] },
        links: [link(p4, "下一页")],
      })],
    ]));
    const source = service(client);
    const analysis = await source.analyzeUrl(p1);
    await expect(source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: analysis.defaultSelectedChapterIds }))
      .rejects.toMatchObject({ code: "UNSAFE_REDIRECT" });
    expect(client.visits).not.toContain(p4);
  });

  it("rejects a Huliwang catalog response that lands on another catalog page", async () => {
    const firstCatalogUrl = "https://m.huliwang.net/dir/1703891.html";
    const secondCatalogUrl = "https://m.huliwang.net/dir/1703891-2.html";
    const thirdCatalogUrl = "https://m.huliwang.net/dir/1703891-3.html";
    const firstCatalog = page(firstCatalogUrl, {
      canonicalUrl: undefined,
      elements: { h1: ["要命！首长的小娇妻夜夜闹离婚章节列表"] },
      links: [
        link("https://m.huliwang.net/1703891/35.html", "第35章 周美玉寻死"),
        link(secondCatalogUrl, "下一页"),
      ],
    });
    const redirectedCatalog = page(thirdCatalogUrl, {
      requestedUrl: secondCatalogUrl,
      canonicalUrl: undefined,
      elements: { h1: ["要命！首长的小娇妻夜夜闹离婚章节列表"] },
      links: [link("https://m.huliwang.net/1703891/37.html", "第37章 何秀秀挑唆")],
    });
    const client = new FakeClient(new Map([
      [firstCatalogUrl, firstCatalog],
      [secondCatalogUrl, redirectedCatalog],
    ]));

    await expect(service(client).analyzeUrl("https://www.huliwang.net/1703891/"))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([firstCatalogUrl, secondCatalogUrl]);
  });

  it("rejects Huliwang and TimoTXT redirects to another chapter in the same book", async () => {
    const huliCatalogPage = huliCatalog();
    const huliExpected = "https://m.huliwang.net/1703891/36.html";
    const huliClient = new FakeClient(new Map([
      [huliCatalogPage.url, huliCatalogPage],
      [huliExpected, page("https://m.huliwang.net/1703891/37.html", {
        elements: { "#nr_title": ["第36章"], "#nr": ["这段正文看似合法，但最终 URL 已经跳到同一本书的其他章节。"] },
      })],
    ]));
    const huliSource = service(huliClient);
    const huliAnalysis = await huliSource.analyzeUrl(huliExpected);
    await expect(huliSource.fetchChapters({
      analysisId: huliAnalysis.analysisId,
      chapterIds: huliAnalysis.defaultSelectedChapterIds,
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });

    const timoCatalogUrl = "https://www.timotxt.com/0108567756/dir";
    const timoExpected = "https://www.timotxt.com/0108567756/332.html";
    const timoCatalog = page(timoCatalogUrl, {
      canonicalUrl: undefined,
      elements: { h1: ["測試書 章節列表"] },
      links: [link(timoExpected, "第332章 測試", [".all"])],
    });
    const timoClient = new FakeClient(new Map([
      [timoCatalogUrl, timoCatalog],
      [timoExpected, page("https://www.timotxt.com/0108567756/333.html", {
        elements: { ".chapter-content .content": ["第332章\n这段正文足够长，但最终 URL 已经跳到同一本书的其他章节。"] },
      })],
    ]));
    const timoSource = service(timoClient);
    const timoAnalysis = await timoSource.analyzeUrl(timoExpected);
    await expect(timoSource.fetchChapters({
      analysisId: timoAnalysis.analysisId,
      chapterIds: timoAnalysis.defaultSelectedChapterIds,
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });

  it("uses TimoTXT official transcode metadata and rejects malformed/Hangul responses", async () => {
    const catalogUrl = "https://www.timotxt.com/0108567756/dir";
    const chapterUrl = "https://www.timotxt.com/0108567756/332.html";
    const catalog = page(catalogUrl, {
      canonicalUrl: undefined,
      elements: { h1: ["快穿：惡毒未婚妻成了萬人迷 章節列表"], h2: ["作者 / 瞭春寒"] },
      links: [link(chapterUrl, "第332章 狀元未婚妻10", [".all"])],
    });
    const chapter = page(chapterUrl, {
      elements: { ".chapter-content .content": ["第332章\n剛떚回來了，놛走누書房，這是一段被字體編碼的足夠長內容。"] },
      readerMetadata: { bookId: "0108567756", chapterId: "332", sourceId: "8096" },
      fontFamilies: ["bqg"],
      fontHashes: [TIMOTXT_BQG_FONT_HASH],
    });
    const clean = "第332章 狀元未婚妻10\n剛子回來了，他走到書房，這是 endpoint 返回的乾淨正文內容。";
    const client = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, chapter]]), async () => ({ status: 200, content: clean }));
    const source = service(client);
    const analysis = await source.analyzeUrl(chapterUrl);
    const result = await source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: analysis.defaultSelectedChapterIds });
    expect(result.chapters[0]?.sourceText).toContain("剛子回來了");
    expect(result.chapters[0]?.sourceText).not.toMatch(/[\uAC00-\uD7AF]/u);
    expect(client.transcodes).toEqual([{ bookId: "0108567756", chapterId: "332", sourceId: "8096", referer: chapterUrl }]);

    const malformedClient = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, chapter]]));
    const malformedSource = service(malformedClient);
    const malformedAnalysis = await malformedSource.analyzeUrl(chapterUrl);
    await expect(malformedSource.fetchChapters({ analysisId: malformedAnalysis.analysisId, chapterIds: malformedAnalysis.defaultSelectedChapterIds }))
      .rejects.toThrow(/Malformed transcode JSON/u);

    const hangulClient = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, chapter]]), async () => ({ status: 200, content: `${clean} 가` }));
    const hangulSource = service(hangulClient);
    const hangulAnalysis = await hangulSource.analyzeUrl(chapterUrl);
    await expect(hangulSource.fetchChapters({ analysisId: hangulAnalysis.analysisId, chapterIds: hangulAnalysis.defaultSelectedChapterIds }))
      .rejects.toMatchObject({ code: "TIMOTXT_DECODE_FAILED" });
  });

  it("accepts plain-Han Timo content without invoking a decoder or transcode endpoint", async () => {
    const catalogUrl = "https://www.timotxt.com/0108567756/dir";
    const chapterUrl = "https://www.timotxt.com/0108567756/13.html";
    const catalog = page(catalogUrl, {
      canonicalUrl: undefined,
      elements: { h1: ["測試書 章節列表"] },
      links: [link(chapterUrl, "第十三章 回家", [".all"])],
    });
    const chapter = page(chapterUrl, {
      elements: {
        ".chapter-content .content": ["第十三章\n刚子看着小妹流下了眼泪，这是已经解码干净且足够长的正文内容。"],
      },
    });
    const decoder = { id: "must-not-run", version: "1", supportedFontHashes: [TIMOTXT_BQG_FONT_HASH], decode: vi.fn(() => { throw new Error("decoder called"); }) };
    const client = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, chapter]]));
    const source = service(client, { textDecoders: [decoder] });
    const analysis = await source.analyzeUrl(chapterUrl);
    expect(analysis.chapters[0]?.number).toBe(13);
    const result = await source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: analysis.defaultSelectedChapterIds });
    expect(result.chapters[0]?.sourceText).toContain("刚子看着小妹");
    expect(decoder.decode).not.toHaveBeenCalled();
    expect(client.transcodes).toHaveLength(0);
  });

  it("merges Timo 332 and 332_2 catalog continuations in URL order", async () => {
    const catalogUrl = "https://www.timotxt.com/0108567756/dir";
    const catalog = page(catalogUrl, {
      canonicalUrl: undefined,
      elements: { h1: ["測試書 章節列表"] },
      links: [
        link("https://www.timotxt.com/0108567756/333.html", "第333章 新章", [".all"]),
        link("https://www.timotxt.com/0108567756/332_2.html", "第332章 下", [".all"]),
        link("https://www.timotxt.com/0108567756/332.html", "第332章 上", [".all"]),
      ],
    });
    const analysis = await service(new FakeClient(new Map([[catalogUrl, catalog]])))
      .analyzeUrl(catalogUrl);
    expect(analysis.chapters).toHaveLength(2);
    expect(analysis.chapters[0]?.partUrls).toEqual([
      "https://www.timotxt.com/0108567756/332.html",
      "https://www.timotxt.com/0108567756/332_2.html",
    ]);
    expect(analysis.chapters[1]?.number).toBe(333);
  });

  it("falls back only to an exact Timo font hash/decoder and rejects unknown codepoints", async () => {
    const catalogUrl = "https://www.timotxt.com/0108567756/dir";
    const chapterUrl = "https://www.timotxt.com/0108567756/332.html";
    const catalog = page(catalogUrl, {
      canonicalUrl: undefined,
      elements: { h1: ["測試書 章節列表"] },
      links: [link(chapterUrl, "第332章 測試", [".all"])],
    });
    const encoded = page(chapterUrl, {
      fontFamilies: ["bqg"],
      fontAssets: [{ family: "bqg", url: "https://www.timotxt.com/fonts/f24092.woff2", sha256: TIMOTXT_BQG_FONT_HASH }],
      elements: { ".chapter-content .content": ["第332章\n剛떚回來了，놛走누書房，這是足夠長的編碼內容用來測試。"] },
      fontHashes: [TIMOTXT_BQG_FONT_HASH],
    });
    const client = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, encoded]]), async () => ({ status: 503, content: "" }));
    const source = service(client, { textDecoders: [new TimotxtF24092Decoder()] });
    const analysis = await source.analyzeUrl(chapterUrl);
    const result = await source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: analysis.defaultSelectedChapterIds });
    expect(result.chapters[0]?.sourceText).toContain("剛子回來了，他走到書房");

    const unknown = page(chapterUrl, {
      fontFamilies: ["bqg"],
      fontAssets: [{ family: "bqg", url: "https://www.timotxt.com/fonts/f24092.woff2", sha256: TIMOTXT_BQG_FONT_HASH }],
      elements: { ".chapter-content .content": ["第332章\n가這是足夠長的內容，但開頭有未知字體碼所以必須失敗。"] },
      fontHashes: [TIMOTXT_BQG_FONT_HASH],
    });
    const unknownClient = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, unknown]]), async () => ({ status: 503, content: "" }));
    const unknownSource = service(unknownClient);
    const unknownAnalysis = await unknownSource.analyzeUrl(chapterUrl);
    await expect(unknownSource.fetchChapters({ analysisId: unknownAnalysis.analysisId, chapterIds: unknownAnalysis.defaultSelectedChapterIds }))
      .rejects.toThrow(/U\+AC00/u);

    const decoy = page(chapterUrl, {
      elements: { ".chapter-content .content": ["第332章\n剛뗚回來了，這是足夠長的字體編碼內容，必須拒絕錯誤映射。"] },
      fontHashes: [TIMOTXT_BQG_FONT_HASH],
      fontFamilies: ["bqg"],
      fontAssets: [{ family: "bqg", url: "https://www.timotxt.com/fonts/new.woff2", sha256: "a".repeat(64) }],
    });
    const decoyClient = new FakeClient(new Map([[catalogUrl, catalog], [chapterUrl, decoy]]), async () => ({ status: 503, content: "" }));
    const decoySource = service(decoyClient);
    const decoyAnalysis = await decoySource.analyzeUrl(chapterUrl);
    await expect(decoySource.fetchChapters({ analysisId: decoyAnalysis.analysisId, chapterIds: decoyAnalysis.defaultSelectedChapterIds }))
      .rejects.toMatchObject({ code: "TIMOTXT_FONT_UNVERIFIED" });
  });

  it("handles Qing GBK DOM, canonical guards, introduction defaults, and soft-200", async () => {
    const bookUrl = "https://www.qingrenyouxi.com/book/115013.html";
    const introUrl = "https://www.qingrenyouxi.com/book/115013/33160151.html";
    const c1Url = "https://www.qingrenyouxi.com/book/115013/33160152.html";
    const book = page(bookUrl, {
      charset: "GBK",
      elements: { ".bookTitle": ["男主小厮，但科举逆袭！"], ".booktag": ["南木松昀 穿越重生"] },
      links: [
        link(introUrl, "内容简介", ["#list-chapterAll"]),
        link(c1Url, "第1章", ["#list-chapterAll"]),
      ],
    });
    const c1 = page(c1Url, {
      charset: "GBK",
      title: "第1章(1/2)_男主小厮",
      elements: {
        ".readTitle": ["第1章"],
        "#htmlContent": ["第1章\n这是经过浏览器按 GBK 正确解码的中文正文，长度足够用于验证。"],
      },
    });
    const client = new FakeClient(new Map([[bookUrl, book], [c1Url, c1]]));
    const source = service(client);
    const analysis = await source.analyzeUrl(bookUrl);
    expect(analysis.defaultSelectedChapterIds).toEqual(["qingrenyouxi:115013:33160152"]);
    expect(analysis.chapters[0]?.isIntroduction).toBe(true);
    const result = await source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: analysis.defaultSelectedChapterIds });
    expect(result.chapters[0]?.sourceText).toContain("浏览器按 GBK 正确解码");
    expect(result.chapters[0]?.sourceText).not.toMatch(/^第1章\n第1章/u);

    const mismatchClient = new FakeClient(new Map([[bookUrl, { ...book, canonicalUrl: "https://www.qingrenyouxi.com/book/999.html" }]]));
    await expect(service(mismatchClient).analyzeUrl(bookUrl)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });

    const softClient = new FakeClient(new Map([[bookUrl, page(bookUrl, {
      title: "御书屋_自由的小说阅读网", bodyText: "I'm very sorry 非常抱歉！ 找不到您请求的页面！", canonicalUrl: undefined,
    })]]));
    await expect(service(softClient).analyzeUrl(bookUrl)).rejects.toMatchObject({ code: "SOFT_200" });
  });

  it("merges adjacent Qingrenyouxi upper/lower catalog parts into one logical chapter", async () => {
    const bookUrl = "https://www.qingrenyouxi.com/book/114551.html";
    const upperUrl = "https://www.qingrenyouxi.com/book/114551/33074751.html";
    const lowerUrl = "https://www.qingrenyouxi.com/book/114551/33074752.html";
    const nextUrl = "https://www.qingrenyouxi.com/book/114551/33074753.html";
    const overlap = "她在安静的屋檐下停住了脚步";
    const book = page(bookUrl, {
      charset: "GBK",
      elements: { ".bookTitle": ["雨夜归人"] },
      links: [
        link(upperUrl, "第一章 雨夜（上）", ["#list-chapterAll"]),
        link(lowerUrl, "第一章 雨夜（下）", ["#list-chapterAll"]),
        link(nextUrl, "第二章 天明", ["#list-chapterAll"]),
      ],
    });
    const upper = page(upperUrl, {
      charset: "GBK",
      elements: {
        ".readTitle": ["第一章 雨夜（上）"],
        "#htmlContent": [`第一章 雨夜（上）\n细雨打湿了幽静的石板巷，${overlap}`],
      },
    });
    const lower = page(lowerUrl, {
      charset: "GBK",
      elements: {
        ".readTitle": ["第一章 雨夜（下）"],
        "#htmlContent": [`第一章 雨夜（下）\n${overlap}，随后轻轻叩响了面前的木门。`],
      },
    });
    const source = service(new FakeClient(new Map([
      [bookUrl, book], [upperUrl, upper], [lowerUrl, lower],
    ])));
    const analysis = await source.analyzeUrl(lowerUrl);
    expect(analysis.chapters).toHaveLength(2);
    expect(analysis.defaultSelectedChapterIds).toEqual(["qingrenyouxi:114551:33074751"]);
    expect(analysis.chapters[0]).toMatchObject({ title: "雨夜（上）", partUrls: [upperUrl, lowerUrl] });

    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters[0]).toMatchObject({ mergedPartCount: 2, number: 1 });
    expect(result.chapters[0]?.sourceText.match(new RegExp(overlap, "gu"))).toHaveLength(1);
    expect(result.combinedSource.match(/^Chương 1:/gmu)).toHaveLength(1);
  });

  it("scopes the 165-entry Xbanxia catalog, excludes intro by default, and ignores outside duplicates", async () => {
    const client = new FakeClient(new Map([[XBANXIA_BOOK_URL, xbanxiaCatalog()]]));
    const source = service(client);
    const analysis = await source.analyzeUrl(XBANXIA_BOOK_URL);

    expect(analysis).toMatchObject({
      site: "xbanxia",
      inputKind: "book",
      bookId: "143300",
      bookTitle: "嫁給殘疾皇子後",
      author: "李寂v5",
      bookUrl: XBANXIA_BOOK_URL,
      catalogUrl: XBANXIA_BOOK_URL,
    });
    expect(analysis.chapters).toHaveLength(165);
    expect(analysis.defaultSelectedChapterIds).toHaveLength(164);
    expect(analysis.chapters[0]).toMatchObject({
      id: "xbanxia:143300:28251880",
      title: "作品相關",
      isIntroduction: true,
      selectedByDefault: false,
    });
    expect(analysis.chapters[1]).toMatchObject({
      id: "xbanxia:143300:28251886",
      number: 1,
      title: "替婚",
      selectedByDefault: true,
    });
    expect(analysis.chapters.at(-1)).toMatchObject({ number: 164, selectedByDefault: true });
    expect(analysis.chapters.map((chapter) => chapter.id)).not.toContain("xbanxia:143300:39999999");
    expect(new Set(analysis.chapters.map((chapter) => chapter.id)).size).toBe(165);
    expect(client.visits).toEqual([XBANXIA_BOOK_URL]);
  });

  it("selects one direct Xbanxia chapter and fetches only clean #nr1 text", async () => {
    const client = new FakeClient(new Map([
      [XBANXIA_BOOK_URL, xbanxiaCatalog()],
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne()],
    ]));
    const source = service(client);
    const analysis = await source.analyzeUrl(XBANXIA_CHAPTER_ONE_URL);

    expect(analysis.inputKind).toBe("chapter");
    expect(analysis.chapters).toHaveLength(165);
    expect(analysis.defaultSelectedChapterIds).toEqual(["xbanxia:143300:28251886"]);

    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      number: 1,
      title: "替婚",
      sourceText: XBANXIA_CHAPTER_ONE_TEXT,
      sourceUrls: [XBANXIA_CHAPTER_ONE_URL],
      mergedPartCount: 1,
      characterCount: XBANXIA_CHAPTER_ONE_TEXT.length,
    });
    expect(result.combinedSource).toBe(`Chương 1: 替婚\n\n${XBANXIA_CHAPTER_ONE_TEXT}`);
    expect(result.combinedSource).not.toMatch(
      /(?:半夏小說|作者有話要說|每日推薦|錯誤提交|問題類型|上一章|下一章|Privacy Policy)/u,
    );
    // The next-chapter navigation is page chrome, not same-chapter pagination.
    expect(client.visits).toEqual([XBANXIA_BOOK_URL, XBANXIA_CHAPTER_ONE_URL]);
  });

  it("preserves the real Xbanxia number when the entire catalog title is wrapped in 【】", async () => {
    const wrappedText = "喬桑回到家後開始查閱資料，認真準備挑選自己的第一隻寵獸，故事內容完整且連續。";
    const client = new FakeClient(new Map([
      [XBANXIA_BOOK_URL, xbanxiaCatalog({
        links: [link(XBANXIA_CHAPTER_ONE_URL, "【第3章 換房子】", [".book-list"])],
      })],
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne({
        elements: {
          "#nr_title": ["【第3章 換房子】"],
          "#nr1": [`【第3章 換房子】\n${wrappedText}\n半夏小說，快樂很多`],
        },
      })],
    ]));
    const source = service(client);
    const analysis = await source.analyzeUrl(XBANXIA_BOOK_URL);

    expect(analysis.chapters).toHaveLength(1);
    expect(analysis.chapters[0]).toMatchObject({ number: 3, numberLabel: "第3章", title: "換房子" });
    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.combinedSource).toBe(`Chương 3: 換房子\n\n${wrappedText}`);
    expect(result.combinedSource).not.toMatch(/Chương\s+1\s*:\s*【/u);
  });

  it("recovers a clean Xbanxia title from the reader when catalog text is corrupt", async () => {
    const body = [
      "【第507章「禦獸從零分開始cx129」 這種感覺......】",
      "第一段正文完整保留，人物進入醫務室接受檢查。",
      "第二段正文接續前文，對話和動作都沒有中斷。",
      "第三段正文自然結束，情節已經交代完整。",
      "\u000e\u000e\u000e",
      "ps：下一章稍後更新。",
    ].join("\n");
    const client = new FakeClient(new Map([
      [XBANXIA_BOOK_URL, xbanxiaCatalog({
        links: [link(XBANXIA_CHAPTER_ONE_URL, "【第507章????????????????????】", [".book-list"])],
      })],
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne({
        elements: { "#nr_title": ["第507章 這種感覺......"], "#nr1": [body] },
      })],
    ]));
    const source = service(client);
    const analysis = await source.analyzeUrl(XBANXIA_BOOK_URL);
    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });

    expect(result.combinedSource).toBe([
      "Chương 507: 這種感覺......",
      "",
      "第一段正文完整保留，人物進入醫務室接受檢查。",
      "第二段正文接續前文，對話和動作都沒有中斷。",
      "第三段正文自然結束，情節已經交代完整。",
    ].join("\n"));
  });

  it("fails closed when required Xbanxia catalog or chapter selectors disappear", async () => {
    const missingCatalogClient = new FakeClient(new Map([[
      XBANXIA_BOOK_URL,
      xbanxiaCatalog({
        elements: {
          h1: ["半夏小說", "每日推薦"],
          ".book-describe h1": ["嫁給殘疾皇子後"],
        },
        links: [
          link(XBANXIA_CHAPTER_ONE_URL, "第1章 替婚", [".book-describe"]),
          link("https://www.xbanxia.cc/books/423391/99999999.html", "第1章 推薦書籍", [".recommend-list"]),
        ],
        bodyText: "每日推薦與網站導覽雖然很長，但沒有經過驗證的 .book-list。",
      }),
    ]]));
    await expect(service(missingCatalogClient).analyzeUrl(XBANXIA_BOOK_URL))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });

    for (const missingSelector of ["#nr_title", "#nr1"] as const) {
      const chapter = xbanxiaChapterOne();
      delete chapter.elements[missingSelector];
      const client = new FakeClient(new Map([
        [XBANXIA_BOOK_URL, xbanxiaCatalog()],
        [XBANXIA_CHAPTER_ONE_URL, chapter],
      ]));
      const source = service(client);
      const analysis = await source.analyzeUrl(XBANXIA_CHAPTER_ONE_URL);
      await expect(source.fetchChapters({
        analysisId: analysis.analysisId,
        chapterIds: analysis.defaultSelectedChapterIds,
      })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    }
  });

  it("accepts same-path HTTP canonicals but rejects Xbanxia canonical mismatches", async () => {
    // The successful book/fetch tests above deliberately use the live site's
    // HTTP canonical while every actual navigation remains HTTPS.
    const badBookClient = new FakeClient(new Map([[
      XBANXIA_BOOK_URL,
      xbanxiaCatalog({ canonicalUrl: "http://www.xbanxia.cc/books/999999.html" }),
    ]]));
    await expect(service(badBookClient).analyzeUrl(XBANXIA_BOOK_URL))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });

    const badChapterClient = new FakeClient(new Map([
      [XBANXIA_BOOK_URL, xbanxiaCatalog()],
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne({
        canonicalUrl: "http://www.xbanxia.cc/books/143300/29000002.html",
      })],
    ]));
    const source = service(badChapterClient);
    const analysis = await source.analyzeUrl(XBANXIA_CHAPTER_ONE_URL);
    await expect(source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });

  it("detects Xbanxia soft-200 pages during both catalog analysis and chapter fetch", async () => {
    const softBookClient = new FakeClient(new Map([[
      XBANXIA_BOOK_URL,
      xbanxiaCatalog({ title: "頁面不存在", bodyText: "抱歉，該文章不存在。" }),
    ]]));
    await expect(service(softBookClient).analyzeUrl(XBANXIA_BOOK_URL))
      .rejects.toMatchObject({ code: "SOFT_200" });

    const softChapterClient = new FakeClient(new Map([
      [XBANXIA_BOOK_URL, xbanxiaCatalog()],
      [XBANXIA_CHAPTER_ONE_URL, xbanxiaChapterOne({
        title: "文章不存在",
        bodyText: "網站導覽\n該文章不存在\n版權資訊",
      })],
    ]));
    const source = service(softChapterClient);
    const analysis = await source.analyzeUrl(XBANXIA_CHAPTER_ONE_URL);
    await expect(source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    })).rejects.toMatchObject({ code: "SOFT_200" });
  });

  it("rate-limits navigation, cancels a gated visit, emits cancelled, and closes the client", async () => {
    const catalog = huliCatalog();
    let now = 0;
    const waits: number[] = [];
    const rateClient = new FakeClient(new Map([[catalog.url, catalog]]));
    const rateService = service(rateClient, {
      minRequestIntervalMs: 100,
      now: () => now,
      sleep: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
    });
    const rateAnalysis = await rateService.analyzeUrl("https://m.huliwang.net/1703891/");
    const c35 = "https://m.huliwang.net/1703891/35.html";
    rateClient["pages"].set(c35, page(c35, {
      elements: { "#nr_title": ["第35章 周美玉寻死"], "#nr": ["这是足够长的第三十五章正文，用来确认两次请求之间确实限速。"] },
    }));
    await rateService.fetchChapters({ analysisId: rateAnalysis.analysisId, chapterIds: [rateAnalysis.chapters[0]!.id] });
    expect(waits).toEqual([100]);

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedClient = new FakeClient(new Map([[catalog.url, async () => {
      await gate;
      return catalog;
    }]]));
    const gatedService = service(gatedClient);
    const events: string[] = [];
    gatedService.onProgress((event) => events.push(event.phase));
    const pending = gatedService.analyzeUrl("https://m.huliwang.net/1703891/");
    await Promise.resolve();
    await gatedService.cancel();
    release?.();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(events).toContain("cancelled");
    await gatedService.close();
    expect(gatedClient.closed).toBe(true);
  });

  it("fetches a whole book beyond the former 1,000-chapter limit and caps requests at 10,000", async () => {
    const catalogUrl = "https://m.huliwang.net/dir/1703891.html";
    const chapterCount = 1_001;
    const chapters = Array.from({ length: chapterCount }, (_, index) => {
      const number = index + 1;
      const url = `https://m.huliwang.net/1703891/${number}.html`;
      return { number, url };
    });
    const pages = new Map<string, StoryPageSnapshot>([[catalogUrl, page(catalogUrl, {
      elements: { h1: ["长篇故事章节列表"] },
      links: chapters.map(({ number, url }) => link(url, `第${number}章 故事继续`)),
    })]]);
    for (const { number, url } of chapters) {
      pages.set(url, page(url, {
        elements: {
          "#nr_title": [`第${number}章 故事继续`],
          "#nr": [`这是第${number}章的完整正文，内容长度足够并且不含广告或翻页污染。`],
        },
      }));
    }
    const source = service(new FakeClient(pages));
    const analysis = await source.analyzeUrl("https://m.huliwang.net/1703891/");

    expect(analysis.defaultSelectedChapterIds).toHaveLength(chapterCount);
    const result = await source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters).toHaveLength(chapterCount);
    expect(result.chapters.at(-1)).toMatchObject({ number: chapterCount });

    await expect(source.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: Array.from({ length: 10_001 }, (_, index) => `chapter-${index}`),
    })).rejects.toThrow(/10\.000/u);
  });

  it("rejects unknown/duplicate chapter IDs without visiting another page", async () => {
    const catalog = huliCatalog();
    const client = new FakeClient(new Map([[catalog.url, catalog]]));
    const source = service(client);
    const analysis = await source.analyzeUrl("https://m.huliwang.net/1703891/");
    const visitCount = client.visits.length;
    await expect(source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: ["other"] })).rejects.toThrow(/không thuộc/u);
    await expect(source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: [analysis.chapters[0]!.id, analysis.chapters[0]!.id] }))
      .rejects.toThrow(/trùng ID/u);
    expect(client.visits).toHaveLength(visitCount);
  });

  it("collects the full XSZJ catalog and merges all three verified pages of one chapter", async () => {
    const secondPage = `${XSZJ_CHAPTER_URL}?page=2`;
    const thirdPage = `${XSZJ_CHAPTER_URL}?page=3`;
    const pages = new Map<string, StoryPageSnapshot>([
      [XSZJ_BOOK_URL, page(XSZJ_BOOK_URL, {
        title: "年代港姐挺孕肚，大佬夜夜急红眼全文免费阅读",
        elements: { h1: ["年代港姐挺孕肚，大佬夜夜急红眼"] },
      })],
      [XSZJ_CATALOG_URL, page(XSZJ_CATALOG_URL, {
        elements: { h1: ["年代港姐挺孕肚，大佬夜夜急红眼"] },
        links: [
          link(XSZJ_CHAPTER_URL, "第1章 炮灰前妻怀孕了", ["#list"]),
          link("https://xszj.org/b/485734/c/856452", "第2章 后续", ["#list"]),
        ],
      })],
      [XSZJ_CHAPTER_URL, page(XSZJ_CHAPTER_URL, {
        title: "第1章 炮灰前妻怀孕了",
        elements: { h1: ["第1章 炮灰前妻怀孕了 （1/3）"], "#content": ["第一段正文，承接人物和事件，也交代了故事开始时的重要背景。"] },
        links: [link(secondPage, "下一页", [".bottem1"])],
      })],
      [secondPage, page(secondPage, {
        title: "第1章 炮灰前妻怀孕了",
        canonicalUrl: secondPage,
        elements: { h1: ["第1章 炮灰前妻怀孕了 （2/3）"], "#content": ["第二段正文，必须紧接第一段，并继续描写人物之间的矛盾发展。"] },
        links: [link(thirdPage, "下一页", [".bottem1"])],
      })],
      [thirdPage, page(thirdPage, {
        title: "第1章 炮灰前妻怀孕了",
        canonicalUrl: thirdPage,
        elements: { h1: ["第1章 炮灰前妻怀孕了 （3/3）"], "#content": ["第三段正文，完整收束本章，同时留下自然的后续情节线索。"] },
      })],
    ]);
    const source = service(new FakeClient(pages));
    const analysis = await source.analyzeUrl(XSZJ_BOOK_URL);
    expect(analysis).toMatchObject({ site: "xszj", bookId: "485734" });
    expect(analysis.chapters).toHaveLength(2);
    const result = await source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: [analysis.chapters[0]!.id] });
    expect(result.chapters[0]).toMatchObject({ mergedPartCount: 3 });
    expect(result.chapters[0]?.sourceText).toBe("第一段正文，承接人物和事件，也交代了故事开始时的重要背景。\n\n第二段正文，必须紧接第一段，并继续描写人物之间的矛盾发展。\n\n第三段正文，完整收束本章，同时留下自然的后续情节线索。");
  });

  it("fails closed if XSZJ declares more chapter pages but omits the exact next-page link", async () => {
    const pages = new Map<string, StoryPageSnapshot>([
      [XSZJ_BOOK_URL, page(XSZJ_BOOK_URL, { elements: { h1: ["Sách XSZJ"] } })],
      [XSZJ_CATALOG_URL, page(XSZJ_CATALOG_URL, {
        elements: { h1: ["Sách XSZJ"] }, links: [link(XSZJ_CHAPTER_URL, "第1章 Mở đầu", ["#list"])],
      })],
      [XSZJ_CHAPTER_URL, page(XSZJ_CHAPTER_URL, {
        elements: { h1: ["第1章 Mở đầu （1/3）"], "#content": ["Đây là nội dung hợp lệ nhưng chưa phải trang cuối."] },
      })],
    ]);
    const source = service(new FakeClient(pages));
    const analysis = await source.analyzeUrl(XSZJ_BOOK_URL);
    await expect(source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: analysis.defaultSelectedChapterIds }))
      .rejects.toThrow(/chưa hết.*trang kế tiếp/u);
  });

  it("uses the already-expanded Ixdzs catalog without requiring an absent canonical tag", async () => {
    const chapterUrl = "https://ixdzs8.com/read/646225/p1.html";
    const pages = new Map<string, StoryPageSnapshot>([
      [IXDZS_BOOK_URL, page(IXDZS_BOOK_URL, {
        canonicalUrl: undefined,
        elements: { h1: ["Truyện Ixdzs"] },
        links: [
          link(chapterUrl, "第一章 拒婚", [".u-chapter"]),
          link("https://ixdzs8.com/read/646225/p2.html", "第二章 后续", [".u-chapter"]),
        ],
      })],
      [chapterUrl, page(chapterUrl, {
        canonicalUrl: undefined,
        elements: { h1: ["第一章 拒婚"], "article.page-content": ["第一章 拒婚\n\n这是完整正文，不包含推荐、目录或下一章。"] },
      })],
    ]);
    const source = service(new FakeClient(pages));
    const analysis = await source.analyzeUrl(IXDZS_BOOK_URL);
    expect(analysis.chapters).toHaveLength(2);
    const fetched = await source.fetchChapters({ analysisId: analysis.analysisId, chapterIds: [analysis.chapters[0]!.id] });
    expect(fetched.chapters[0]?.sourceText).toBe("这是完整正文，不包含推荐、目录或下一章。");
  });
});
