import { describe, expect, it } from "vitest";
import { StorySourceService } from "../../src/main/storySources/StorySourceService";
import type {
  StoryPageClient,
  StoryPageLink,
  StoryPageSnapshot,
  StorySourceServiceOptions,
} from "../../src/main/storySources/types";

const BOOK_ID = "1703891";
const CATALOG_PAGE_ONE = `https://m.huliwang.net/dir/${BOOK_ID}.html`;
const CATALOG_PAGE_TWO = `https://m.huliwang.net/dir/${BOOK_ID}-2.html`;
const CATALOG_PAGE_THREE = `https://m.huliwang.net/dir/${BOOK_ID}-3.html`;

function chapterUrl(number: number): string {
  return `https://m.huliwang.net/${BOOK_ID}/${number}.html`;
}

function link(href: string, text: string): StoryPageLink {
  return { href, text, scopes: [".chaplist"] };
}

function scopedLink(href: string, text: string, scopes: string[]): StoryPageLink {
  return { href, text, scopes };
}

function chapterLinks(first: number, last: number): StoryPageLink[] {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const number = first + index;
    return link(chapterUrl(number), `第${number}章 目录测试`);
  });
}

function catalogPage(
  url: string,
  links: StoryPageLink[],
  catalogPagination?: StoryPageSnapshot["catalogPagination"],
): StoryPageSnapshot {
  return {
    requestedUrl: url,
    url,
    status: 200,
    title: "分页目录测试",
    charset: "UTF-8",
    htmlLanguage: "zh-Hans",
    bodyText: "这是经过浏览器验证的小说目录。",
    elements: { h1: ["分页目录测试章节列表"] },
    links,
    fontFamilies: [],
    fontUrls: [],
    fontHashes: [],
    challenge: "none",
    ...(catalogPagination ? { catalogPagination } : {}),
  };
}

class CatalogClient implements StoryPageClient {
  public readonly visits: string[] = [];

  public constructor(private readonly pages: ReadonlyMap<string, StoryPageSnapshot>) {}

  public async visit(url: string): Promise<StoryPageSnapshot> {
    this.visits.push(url);
    const snapshot = this.pages.get(url);
    if (!snapshot) throw new Error(`Missing catalog page: ${url}`);
    return snapshot;
  }
}

/**
 * Huliwang's current mobile catalog does not navigate to `-2.html`: clicking
 * its native next button replaces #chapterList in place and leaves the
 * catalog URL unchanged.  This deterministic companion boundary models that
 * exact, deliberately narrow behavior without driving a real browser.
 */
class InPlaceCatalogClient implements StoryPageClient {
  public readonly visits: string[] = [];
  public readonly advances: string[] = [];
  private advanceIndex = 0;

  public constructor(
    private readonly firstSnapshot: StoryPageSnapshot,
    private readonly advancedSnapshots: readonly StoryPageSnapshot[],
  ) {}

  public async visit(url: string): Promise<StoryPageSnapshot> {
    this.visits.push(url);
    if (url !== CATALOG_PAGE_ONE) throw new Error(`Unexpected catalog visit: ${url}`);
    return this.firstSnapshot;
  }

  public async advanceCatalogPage(currentUrl: string): Promise<StoryPageSnapshot> {
    this.advances.push(currentUrl);
    if (currentUrl !== CATALOG_PAGE_ONE) throw new Error(`Unexpected catalog advance: ${currentUrl}`);
    const snapshot = this.advancedSnapshots[this.advanceIndex];
    this.advanceIndex += 1;
    if (!snapshot) throw new Error("Unexpected extra in-place catalog advance.");
    return snapshot;
  }
}

function sourceFor(client: StoryPageClient, extra: Partial<StorySourceServiceOptions> = {}): StorySourceService {
  // A supplied client is the deterministic companion-browser boundary used by
  // integration tests. It avoids launching an automated browser for Huliwang.
  return new StorySourceService({
    minRequestIntervalMs: 0,
    verificationWaitMs: 0,
    ...extra,
    pageClient: client,
  });
}

describe("Huliwang paginated catalogs", () => {
  it("aggregates 50-entry catalog pages through the final page and deduplicates boundary entries", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 50),
      // The normal pager also exposes the final-page shortcut. It must not
      // cause the final page to be read before page two.
      link(CATALOG_PAGE_THREE, "末页"),
      // Real Huliwang pagers can expose a numeric/decorated target rather
      // than the exact old 下一页 label.
      link(CATALOG_PAGE_TWO, "第 2 页 ›"),
    ]);
    const pageTwo = catalogPage(CATALOG_PAGE_TWO, [
      // Huliwang can repeat the last entry of the prior page at a boundary.
      link(chapterUrl(50), "第50章 目录测试"),
      ...chapterLinks(51, 100),
      link(CATALOG_PAGE_THREE, "第三頁"),
    ]);
    const finalPage = catalogPage(CATALOG_PAGE_THREE, [
      link(chapterUrl(100), "第100章 目录测试"),
      ...chapterLinks(101, 123),
    ]);
    const client = new CatalogClient(new Map([
      [CATALOG_PAGE_ONE, pageOne],
      [CATALOG_PAGE_TWO, pageTwo],
      [CATALOG_PAGE_THREE, finalPage],
    ]));

    const analysis = await sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    expect(client.visits).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_TWO, CATALOG_PAGE_THREE]);
    expect(analysis.chapters).toHaveLength(123);
    expect(analysis.defaultSelectedChapterIds).toHaveLength(123);
    expect(analysis.chapters.map((chapter) => chapter.id)).toEqual(
      Array.from({ length: 123 }, (_, index) => `huliwang:${BOOK_ID}:${index + 1}`),
    );
    expect(analysis.chapters.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: 123 }, (_, index) => index + 1),
    );
  });

  it("uses the companion's in-place JavaScript pager without revisiting the catalog URL", async () => {
    const pageOne = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(1, 50),
      { hasNext: true, hasPrevious: false },
    );
    // Huliwang leaves location.href at the base catalog URL after each click;
    // only #chapterList and the disabled state of #nextPage change.
    const pageTwo = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(51, 100),
      { hasNext: true, hasPrevious: true },
    );
    const finalPage = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(101, 123),
      { hasNext: false, hasPrevious: true },
    );
    const client = new InPlaceCatalogClient(pageOne, [pageTwo, finalPage]);

    const analysis = await sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    // The original catalog snapshot is loaded once.  Every subsequent slice
    // is reached only through the allow-listed catalog-next companion command.
    expect(client.visits).toEqual([CATALOG_PAGE_ONE]);
    expect(client.advances).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_ONE]);
    expect(analysis.chapters.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: 123 }, (_, index) => index + 1),
    );
  });

  it("accepts a full terminal in-place page when the native next button is disabled", async () => {
    const pageOne = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(1, 50),
      { hasNext: true, hasPrevious: false },
    );
    // The terminal page can itself contain exactly 50 entries.  The explicit
    // disabled state is authoritative, so it must not be mistaken for an
    // undiscovered link-based page three.
    const terminalPage = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(51, 100),
      { hasNext: false, hasPrevious: true },
    );
    const client = new InPlaceCatalogClient(pageOne, [terminalPage]);

    const analysis = await sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    expect(client.visits).toEqual([CATALOG_PAGE_ONE]);
    expect(client.advances).toEqual([CATALOG_PAGE_ONE]);
    expect(analysis.chapters).toHaveLength(100);
  });

  it("fails closed when an in-place next action does not replace the catalog entries", async () => {
    const pageOne = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(1, 50),
      { hasNext: true, hasPrevious: false },
    );
    // This models a page where a click appeared to finish but #chapterList
    // was not replaced.  Returning the first 50 entries would silently omit
    // the rest of the book, so the analysis must fail rather than complete.
    const unchangedPage = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(1, 50),
      { hasNext: true, hasPrevious: true },
    );
    const client = new InPlaceCatalogClient(pageOne, [unchangedPage]);

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE]);
    expect(client.advances).toEqual([CATALOG_PAGE_ONE]);
  });

  it("fails closed rather than claiming a complete catalog when the companion cannot advance its native pager", async () => {
    const pageOne = catalogPage(
      CATALOG_PAGE_ONE,
      chapterLinks(1, 50),
      { hasNext: true, hasPrevious: false },
    );
    // The deterministic legacy client deliberately has no
    // advanceCatalogPage capability.  A positive native-pager state must not
    // be treated as a terminal page merely because no href is available.
    const client = new CatalogClient(new Map([[CATALOG_PAGE_ONE, pageOne]]));

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE]);
  });

  it("fails closed instead of silently returning a partial catalog when a next-page link loops", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 50),
      link(CATALOG_PAGE_TWO, "下一页"),
    ]);
    const pageTwo = catalogPage(CATALOG_PAGE_TWO, [
      ...chapterLinks(51, 100),
      // A link labelled as the next page cannot point back to page one: doing
      // so would otherwise look like a completed 100-chapter book.
      link(CATALOG_PAGE_ONE, "下一页"),
    ]);
    const client = new CatalogClient(new Map([
      [CATALOG_PAGE_ONE, pageOne],
      [CATALOG_PAGE_TWO, pageTwo],
    ]));

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_TWO]);
  });

  it("fails closed when the pager advertises a later page but omits the required next page", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 50),
      link(CATALOG_PAGE_THREE, "末页"),
    ]);
    const client = new CatalogClient(new Map([[CATALOG_PAGE_ONE, pageOne]]));

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE]);
  });

  it("fails closed when a full 50-entry first page has no usable next-page control", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 50),
      // Same-book chapter chrome is not a catalog pager and must not make a
      // full page look like a complete book.
      scopedLink(chapterUrl(999), "最新章节", [".latest-chapter"]),
    ]);
    const client = new CatalogClient(new Map([[CATALOG_PAGE_ONE, pageOne]]));

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE]);
  });

  it.each([
    ["numeric pager before backward next", [
      link(CATALOG_PAGE_ONE, "1"),
      link(CATALOG_PAGE_ONE, "下一页"),
      link(CATALOG_PAGE_THREE, "3"),
    ]],
    ["backward next before numeric pager", [
      link(CATALOG_PAGE_ONE, "下一页"),
      link(CATALOG_PAGE_ONE, "1"),
      link(CATALOG_PAGE_THREE, "3"),
    ]],
  ])("fails closed for %s when duplicate pager targets include a backward next control", async (_name, pageTwoPager) => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 50),
      link(CATALOG_PAGE_TWO, "2"),
    ]);
    const pageTwo = catalogPage(CATALOG_PAGE_TWO, [
      ...chapterLinks(51, 100),
      ...pageTwoPager,
    ]);
    const client = new CatalogClient(new Map([
      [CATALOG_PAGE_ONE, pageOne],
      [CATALOG_PAGE_TWO, pageTwo],
    ]));

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_TWO]);
  });

  it("ignores same-book fake chapter links outside the catalog when .chaplist contains real chapters", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      // These are same-book links deliberately injected in surrounding page
      // chrome. They must not leak into an otherwise scoped catalog.
      scopedLink(chapterUrl(998), "第998章 假最新章节", [".latest-chapter"]),
      scopedLink(chapterUrl(999), "第999章 假推荐章节", [".recommend"]),
      ...chapterLinks(1, 3),
    ]);
    const client = new CatalogClient(new Map([[CATALOG_PAGE_ONE, pageOne]]));

    const analysis = await sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    expect(analysis.chapters.map((chapter) => chapter.id)).toEqual([
      `huliwang:${BOOK_ID}:1`,
      `huliwang:${BOOK_ID}:2`,
      `huliwang:${BOOK_ID}:3`,
    ]);
    expect(analysis.chapters.map((chapter) => chapter.url)).not.toContain(chapterUrl(998));
    expect(analysis.chapters.map((chapter) => chapter.url)).not.toContain(chapterUrl(999));
  });

  it("fails closed when catalog page two repeats only chapters already present on page one", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 50),
      link(CATALOG_PAGE_TWO, "2"),
    ]);
    const pageTwo = catalogPage(CATALOG_PAGE_TWO, [
      // A bad/redirected second page can preserve the pager but repeat the
      // whole first slice. Returning those 50 entries would silently omit the
      // remainder of the book.
      ...chapterLinks(1, 50),
    ]);
    const client = new CatalogClient(new Map([
      [CATALOG_PAGE_ONE, pageOne],
      [CATALOG_PAGE_TWO, pageTwo],
    ]));

    await expect(sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_TWO]);
  });

  it.each([
    ["underscore", `https://m.huliwang.net/dir/${BOOK_ID}_2.html`],
    ["slash", `https://m.huliwang.net/dir/${BOOK_ID}/2.html`],
  ])("accepts a %s catalog response alias for requested -2", async (_name, responseAlias) => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 1),
      link(CATALOG_PAGE_TWO, "2"),
    ]);
    const pageTwo = catalogPage(responseAlias, chapterLinks(2, 2));
    const client = new CatalogClient(new Map([
      [CATALOG_PAGE_ONE, pageOne],
      // The command is intentionally sent to the canonical -2 URL, while the
      // ordinary browser reports the site's equivalent spelling after load.
      [CATALOG_PAGE_TWO, pageTwo],
    ]));

    const analysis = await sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    expect(client.visits).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_TWO]);
    expect(analysis.chapters.map((chapter) => chapter.id)).toEqual([
      `huliwang:${BOOK_ID}:1`,
      `huliwang:${BOOK_ID}:2`,
    ]);
  });

  it("uses the larger default catalog budget rather than silently stopping at 30 pages", async () => {
    const pages = new Map<string, StoryPageSnapshot>();
    for (let pageNumber = 1; pageNumber <= 31; pageNumber += 1) {
      const url = pageNumber === 1
        ? CATALOG_PAGE_ONE
        : `https://m.huliwang.net/dir/${BOOK_ID}-${pageNumber}.html`;
      const links = [link(chapterUrl(pageNumber), `第${pageNumber}章 目录测试`)];
      if (pageNumber < 31) {
        links.push(link(`https://m.huliwang.net/dir/${BOOK_ID}-${pageNumber + 1}.html`, `${pageNumber + 1}`));
      }
      pages.set(url, catalogPage(url, links));
    }
    const client = new CatalogClient(pages);

    const analysis = await sourceFor(client).analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    expect(client.visits).toHaveLength(31);
    expect(analysis.chapters.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: 31 }, (_, index) => index + 1),
    );
  });

  it("treats a non-finite catalog-page option as the safe default rather than as an empty cap", async () => {
    const pages = new Map<string, StoryPageSnapshot>();
    for (let pageNumber = 1; pageNumber <= 31; pageNumber += 1) {
      const url = pageNumber === 1
        ? CATALOG_PAGE_ONE
        : `https://m.huliwang.net/dir/${BOOK_ID}-${pageNumber}.html`;
      const links = [link(chapterUrl(pageNumber), `第${pageNumber}章 目录测试`)];
      if (pageNumber < 31) {
        links.push(link(`https://m.huliwang.net/dir/${BOOK_ID}-${pageNumber + 1}.html`, `${pageNumber + 1}`));
      }
      pages.set(url, catalogPage(url, links));
    }
    const client = new CatalogClient(pages);

    const analysis = await sourceFor(client, { maxCatalogPages: Number.NaN })
      .analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`);

    expect(client.visits).toHaveLength(31);
    expect(analysis.chapters).toHaveLength(31);
  });

  it("honors an exact valid catalog-page cap and fails before returning a partial third page", async () => {
    const pageOne = catalogPage(CATALOG_PAGE_ONE, [
      ...chapterLinks(1, 1),
      link(CATALOG_PAGE_TWO, "2"),
    ]);
    const pageTwo = catalogPage(CATALOG_PAGE_TWO, [
      ...chapterLinks(2, 2),
      link(CATALOG_PAGE_THREE, "3"),
    ]);
    const pageThree = catalogPage(CATALOG_PAGE_THREE, chapterLinks(3, 3));
    const client = new CatalogClient(new Map([
      [CATALOG_PAGE_ONE, pageOne],
      [CATALOG_PAGE_TWO, pageTwo],
      [CATALOG_PAGE_THREE, pageThree],
    ]));

    await expect(sourceFor(client, { maxCatalogPages: 2 })
      .analyzeUrl(`https://m.huliwang.net/${BOOK_ID}/`))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(client.visits).toEqual([CATALOG_PAGE_ONE, CATALOG_PAGE_TWO]);
  });
});
