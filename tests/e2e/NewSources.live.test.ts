import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StorySourceService } from "../../src/main/storySources";

const live = process.env.RUN_NEW_SOURCE_LIVE === "1" ? describe : describe.skip;

const BOOKS = [
  ["liehuozw-75798", "https://m.liehuozw.com/75/75798/"],
  ["liehuozw-75793", "https://m.liehuozw.com/75/75793/"],
  ["liehuozw-73165", "https://m.liehuozw.com/73/73165/"],
  ["uaa002-1100866346247393280", "https://www.uaa.com/novel/intro?id=1100866346247393280"],
  ["uaa002-985768219669303296", "https://m.uaa002.com/novel/intro?id=985768219669303296"],
  ["uaa002-872742287782842368", "https://www.uaa.com/novel/intro?id=872742287782842368"],
  ["c6k6-124560", "https://www.c6k6.com/book/124560.html"],
  ["c6k6-1064", "https://www.c6k6.com/book/1064.html"],
  ["c6k6-117694", "https://www.c6k6.com/book/117694.html"],
  ["czbooks-pmeef4", "https://czbooks.net/n/pmeef4"],
  ["czbooks-cr3ef8", "https://czbooks.net/n/cr3ef8"],
  ["czbooks-cr3ee2", "https://czbooks.net/n/cr3ee2"],
] as const;

function expectClean(text: string): void {
  expect(text.length).toBeGreaterThan(100);
  expect(text).not.toContain("\uFFFD");
  expect(text).not.toMatch(/(?:\u4e0a\u4e00\u7ae0|\u4e0b\u4e00\u7ae0|\u8fd4\u56de\u76ee\u5f55|\u624b\u673a\u7248\u9605\u8bfb|\u8bf7\u6536\u85cf\u672c\u7ad9|\u70b9\u51fb\u4e0b\u4e00\u9875|Copyright|\u5e7f\u544a|\u4f5c\u8005\u6709\u8bdd\u8bf4|\u6c42\u6708\u7968|\u6c42\u6536\u85cf)/iu);
  expect(text).not.toMatch(/<(?:script|style|iframe|ins|figure)\b|\bon(?:error|load)\s*=/iu);
}

live("12 bo truyen that tren 4 nguon moi", () => {
  let directory = "";
  let service: StorySourceService;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "new-story-source-live-"));
    service = new StorySourceService({
      profileDirectory: directory,
      headless: process.env.RUN_NEW_SOURCE_HEADED !== "1",
      minRequestIntervalMs: 650,
    });
  });

  afterAll(async () => {
    await service?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each(BOOKS)("%s phan tich muc luc va lay sach 5 chuong dau", async (_label, url) => {
    const analysis = await service.analyzeUrl(url);
    expect(analysis.chapters.length).toBeGreaterThanOrEqual(5);
    expect(new Set(analysis.chapters.map((chapter) => chapter.id)).size).toBe(analysis.chapters.length);
    const selected = analysis.chapters.filter((chapter) => !chapter.isIntroduction).slice(0, 5);
    expect(selected).toHaveLength(5);
    const result = await service.fetchChapters({ analysisId: analysis.analysisId, chapterIds: selected.map((chapter) => chapter.id) });
    expect(result.chapters).toHaveLength(5);
    expect(result.chapters.map((chapter) => chapter.sourceUrls)).toEqual(selected.map((chapter) => chapter.partUrls));
    for (const chapter of result.chapters) {
      expect(chapter.characterCount).toBe(chapter.sourceText.length);
      expectClean(chapter.sourceText);
    }
    console.info(JSON.stringify({ label: _label, catalogChapters: analysis.chapters.length, fetchedLengths: result.chapters.map((chapter) => chapter.characterCount) }));
    expect(result.combinedSource.match(/^Chương\s+\d+/gmu)).toHaveLength(5);
    expectClean(result.combinedSource);
  }, 180_000);
});
