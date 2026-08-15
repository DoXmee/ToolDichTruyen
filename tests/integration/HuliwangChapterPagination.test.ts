import { describe, expect, it } from "vitest";
import { StorySourceService } from "../../src/main/storySources/StorySourceService";
import type {
  StoryPageClient,
  StoryPageLink,
  StoryPageSnapshot,
} from "../../src/main/storySources/types";

const BOOK_ID = "1703891";
const CATALOG_URL = `https://m.huliwang.net/dir/${BOOK_ID}.html`;
const CHAPTER_FIFTY_PAGE_ONE = `https://m.huliwang.net/${BOOK_ID}/50.html`;
const CHAPTER_FIFTY_PAGE_TWO = `https://m.huliwang.net/${BOOK_ID}/50/2.html`;
const CHAPTER_FIFTY_PAGE_THREE = `https://m.huliwang.net/${BOOK_ID}/50/3.html`;
const CHAPTER_FIFTY_ONE = `https://m.huliwang.net/${BOOK_ID}/51.html`;

const PAGE_ONE_TEXT = "Trang một bắt đầu chương năm mươi với diễn biến đầu tiên đủ dài để được xem là nội dung truyện hợp lệ.";
const PAGE_TWO_TEXT = "Trang hai nối ngay tình tiết chương năm mươi, mở rộng câu chuyện bằng một đoạn nội dung độc lập và đủ dài.";
const PAGE_THREE_TEXT = "Trang ba khép lại chương năm mươi một cách hoàn chỉnh, rồi nhân vật mới chuẩn bị bước sang chương kế tiếp.";
const CHAPTER_FIFTY_ONE_TEXT = "Đây là câu mở đầu của chương năm mươi mốt và tuyệt đối không được ghép vào chương năm mươi.";
const INCOMPLETE_FOOTER = "本章未完，点击下一页继续阅读";

function link(href: string, text: string, scopes: string[] = ["#nr"]): StoryPageLink {
  return { href, text, scopes };
}

function snapshot(
  url: string,
  elements: Record<string, string[]>,
  links: StoryPageLink[] = [],
): StoryPageSnapshot {
  return {
    requestedUrl: url,
    url,
    status: 200,
    title: "Huliwang chapter fixture",
    charset: "UTF-8",
    htmlLanguage: "zh-Hans",
    bodyText: "Trang truyện hợp lệ đã qua xác minh trình duyệt thông thường.",
    elements,
    links,
    fontFamilies: [],
    fontUrls: [],
    fontHashes: [],
    challenge: "none",
  };
}

function catalog(): StoryPageSnapshot {
  return snapshot(CATALOG_URL, {
    h1: ["Kiểm thử phân trang chương Huliwang"],
  }, [
    link(CHAPTER_FIFTY_PAGE_ONE, "第50章 Kiểm thử ba trang", ["#chapterList"]),
    link(CHAPTER_FIFTY_ONE, "第51章 Chương kế tiếp", ["#chapterList"]),
  ]);
}

class FixtureClient implements StoryPageClient {
  public readonly visits: string[] = [];

  public constructor(private readonly pages: ReadonlyMap<string, StoryPageSnapshot>) {}

  public async visit(url: string): Promise<StoryPageSnapshot> {
    this.visits.push(url);
    const page = this.pages.get(url);
    if (!page) throw new Error(`Missing fixture page: ${url}`);
    return page;
  }
}

/**
 * Models the mobile reader variant whose fixed next-page button replaces
 * #nr in the paired tab but leaves location.href on the page-one URL.
 * The companion's bounded `chapterPagination.currentPage` is the only
 * trusted evidence that this really advanced from N to N+1.
 */
class InPlaceChapterFixtureClient implements StoryPageClient {
  public readonly visits: string[] = [];
  public readonly advances: string[] = [];
  private advanceIndex = 0;

  public constructor(
    private readonly firstPage: StoryPageSnapshot,
    private readonly advancedPages: readonly StoryPageSnapshot[],
  ) {}

  public async visit(url: string): Promise<StoryPageSnapshot> {
    this.visits.push(url);
    if (url === CATALOG_URL) return catalog();
    if (url === CHAPTER_FIFTY_PAGE_ONE) return this.firstPage;
    throw new Error(`Unexpected in-place fixture visit: ${url}`);
  }

  public async advanceChapterPage(url: string): Promise<StoryPageSnapshot> {
    this.advances.push(url);
    if (url !== CHAPTER_FIFTY_PAGE_ONE) throw new Error(`Unexpected chapter advance: ${url}`);
    const next = this.advancedPages[this.advanceIndex];
    this.advanceIndex += 1;
    if (!next) throw new Error("Unexpected extra chapter advance.");
    return next;
  }
}

function createService(client: StoryPageClient): StorySourceService {
  return new StorySourceService({
    pageClient: client,
    minRequestIntervalMs: 0,
    verificationWaitMs: 0,
  });
}

async function analyzeAndFetchChapterFifty(client: StoryPageClient) {
  const service = createService(client);
  const analysis = await service.analyzeUrl(CHAPTER_FIFTY_PAGE_ONE);
  const result = await service.fetchChapters({
    analysisId: analysis.analysisId,
    chapterIds: ["huliwang:1703891:50"],
  });
  return result.chapters[0];
}

describe("Huliwang chapter-internal pagination", () => {
  it("merges all three pages of one chapter, removes only its incomplete-page footers, and stops before chapter 51", async () => {
    const client = new FixtureClient(new Map([
      [CATALOG_URL, catalog()],
      [CHAPTER_FIFTY_PAGE_ONE, snapshot(CHAPTER_FIFTY_PAGE_ONE, {
        "#nr_title": ["第50章 Kiểm thử ba trang"],
        "#nr": [`${PAGE_ONE_TEXT}\n${INCOMPLETE_FOOTER}`],
      }, [
        // Real Huliwang wording is decorated; it is not the legacy exact
        // label \"下一页\". The verified same-chapter page URL is decisive.
        link(CHAPTER_FIFTY_PAGE_TWO, INCOMPLETE_FOOTER),
      ])],
      [CHAPTER_FIFTY_PAGE_TWO, snapshot(CHAPTER_FIFTY_PAGE_TWO, {
        "#nr_title": ["第50章 Kiểm thử ba trang 第2页"],
        "#nr": [`${PAGE_TWO_TEXT}\n${INCOMPLETE_FOOTER}`],
      }, [link(CHAPTER_FIFTY_PAGE_THREE, INCOMPLETE_FOOTER)])],
      [CHAPTER_FIFTY_PAGE_THREE, snapshot(CHAPTER_FIFTY_PAGE_THREE, {
        "#nr_title": ["第50章 Kiểm thử ba trang 第3页"],
        "#nr": [PAGE_THREE_TEXT],
      }, [link(CHAPTER_FIFTY_ONE, "下一章")])],
      [CHAPTER_FIFTY_ONE, snapshot(CHAPTER_FIFTY_ONE, {
        "#nr_title": ["第51章 Chương kế tiếp"],
        "#nr": [CHAPTER_FIFTY_ONE_TEXT],
      })],
    ]));

    const content = await analyzeAndFetchChapterFifty(client);

    expect(content).toMatchObject({
      number: 50,
      mergedPartCount: 3,
      sourceUrls: [
        CHAPTER_FIFTY_PAGE_ONE,
        CHAPTER_FIFTY_PAGE_TWO,
        CHAPTER_FIFTY_PAGE_THREE,
      ],
    });
    const text = content?.sourceText ?? "";
    expect(text).toContain(PAGE_ONE_TEXT);
    expect(text).toContain(PAGE_TWO_TEXT);
    expect(text).toContain(PAGE_THREE_TEXT);
    expect(text.indexOf(PAGE_ONE_TEXT)).toBeLessThan(text.indexOf(PAGE_TWO_TEXT));
    expect(text.indexOf(PAGE_TWO_TEXT)).toBeLessThan(text.indexOf(PAGE_THREE_TEXT));
    expect(text).not.toMatch(/(?:本章未完|点击下一页继续|第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页)/u);
    expect(text).not.toContain(CHAPTER_FIFTY_ONE_TEXT);
    expect(client.visits).toEqual([
      CATALOG_URL,
      CHAPTER_FIFTY_PAGE_ONE,
      CHAPTER_FIFTY_PAGE_TWO,
      CHAPTER_FIFTY_PAGE_THREE,
    ]);
  });

  it("uses the companion's fixed in-place reader pager only when it reports consecutive pages of the same chapter", async () => {
    const first = {
      ...snapshot(CHAPTER_FIFTY_PAGE_ONE, {
        "#nr_title": ["第50章 Kiểm thử pager tại chỗ"],
        "#nr": [`${PAGE_ONE_TEXT}\n${INCOMPLETE_FOOTER}`],
      }),
      chapterPagination: { hasNext: true, hasPrevious: false, currentPage: 1 },
    };
    const second = {
      ...snapshot(CHAPTER_FIFTY_PAGE_ONE, {
        "#nr_title": ["第50章 Kiểm thử pager tại chỗ 第2页"],
        "#nr": [`${PAGE_TWO_TEXT}\n${INCOMPLETE_FOOTER}`],
      }),
      chapterPagination: { hasNext: true, hasPrevious: true, currentPage: 2 },
    };
    const third = {
      ...snapshot(CHAPTER_FIFTY_PAGE_ONE, {
        "#nr_title": ["第50章 Kiểm thử pager tại chỗ 第3页"],
        "#nr": [PAGE_THREE_TEXT],
      }, [link(CHAPTER_FIFTY_ONE, "下一章")]),
      chapterPagination: { hasNext: false, hasPrevious: true, currentPage: 3 },
    };
    const client = new InPlaceChapterFixtureClient(first, [second, third]);

    const content = await analyzeAndFetchChapterFifty(client);

    expect(content).toMatchObject({ number: 50, mergedPartCount: 3 });
    const text = content?.sourceText ?? "";
    expect(text.indexOf(PAGE_ONE_TEXT)).toBeLessThan(text.indexOf(PAGE_TWO_TEXT));
    expect(text.indexOf(PAGE_TWO_TEXT)).toBeLessThan(text.indexOf(PAGE_THREE_TEXT));
    expect(text).not.toMatch(/(?:本章未完|点击下一页继续)/u);
    expect(text).not.toContain(CHAPTER_FIFTY_ONE_TEXT);
    // No guessed URL nor click outside the verified reader pager is allowed.
    expect(client.visits).toEqual([CATALOG_URL, CHAPTER_FIFTY_PAGE_ONE]);
    expect(client.advances).toEqual([CHAPTER_FIFTY_PAGE_ONE, CHAPTER_FIFTY_PAGE_ONE]);
  });

  it("fails closed instead of exporting a truncated page when the incomplete sentinel has no verified next page of the same chapter", async () => {
    const client = new FixtureClient(new Map([
      [CATALOG_URL, catalog()],
      [CHAPTER_FIFTY_PAGE_ONE, snapshot(CHAPTER_FIFTY_PAGE_ONE, {
        "#nr_title": ["第50章 Kiểm thử thiếu trang"],
        "#nr": [`${PAGE_ONE_TEXT}\n${INCOMPLETE_FOOTER}`],
      }, [
        // A normal next-chapter link must not be mistaken for page two.
        link(CHAPTER_FIFTY_ONE, "下一章"),
      ])],
    ]));
    const service = createService(client);
    const analysis = await service.analyzeUrl(CHAPTER_FIFTY_PAGE_ONE);

    await expect(service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: ["huliwang:1703891:50"],
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_URL, CHAPTER_FIFTY_PAGE_ONE]);
  });
});
