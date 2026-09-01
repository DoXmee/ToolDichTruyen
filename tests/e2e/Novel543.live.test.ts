import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPlaywrightStoryPageClient } from "../../src/main/storySources/PlaywrightStoryPageClient";
import { StorySourceService } from "../../src/main/storySources/StorySourceService";
import { normalizeText, parseChapterLabel, removeRepeatedHeading } from "../../src/main/storySources/text";
import { parseStoryUrl } from "../../src/main/storySources/urlRules";
import type { StoryChapterContent, StoryChapterReference } from "../../src/shared/types";

const live = process.env.RUN_NOVEL543_LIVE === "1" ? describe : describe.skip;

const BOOKS = [
  { id: "1013669909", expectedChapters: 542, url: "https://www.novel543.com/1013669909/" },
  { id: "0401702351", expectedChapters: 267, url: "https://www.novel543.com/0401702351/" },
  { id: "0526698164", expectedChapters: 164, url: "https://www.novel543.com/0526698164/" },
] as const;

const LEAKED_CHROME = /(?:ONEAD_TEXT|溫馨提示\s*[:：][\s\S]{0,300}(?:VIP|設定|上一頁|下一頁)|VIP會員免廣告|【[^】\n]{0,180}(?:加書架|加书架)[^】\n]{0,180}】|(?:^|\n)\s*(?:上一章|下一章|返回目錄|返回目录|字體設定|字体设置|回報錯誤|回报错误)\s*(?:\n|$))/iu;

function auditIndexes(chapterCount: number): number[] {
  const middle = Math.floor(chapterCount / 2);
  return [...new Set([
    ...Array.from({ length: 7 }, (_, index) => index),
    ...Array.from({ length: 6 }, (_, index) => middle - 3 + index),
    ...Array.from({ length: 7 }, (_, index) => chapterCount - 7 + index),
  ])].sort((left, right) => left - right);
}

function cleanIndependentSnapshotText(raw: string, heading: string): string {
  return removeRepeatedHeading(normalizeText(raw), heading)
    .replace(/【[^】\n]{0,180}(?:加書架|加书架)[^】\n]{0,180}】/gu, "")
    .replace(/\s*(?:溫馨提示\s*[:：][\s\S]*|應廣大讀者的要求[\s\S]*VIP會員免廣告功能[\s\S]*)\s*$/iu, "")
    .trim();
}

function compact(value: string): string {
  return value.replace(/\s+/gu, "");
}

interface FetchedAudit {
  reference: StoryChapterReference;
  content: StoryChapterContent;
}

live("Novel543 live acceptance: 3 books × 20 chapters", () => {
  it("downloads and independently compares all 60 chapters", async () => {
    const profileDirectory = await mkdtemp(path.join(tmpdir(), "novel543-live-"));
    const outputDirectory = path.resolve("test-output");
    const reportPath = path.join(outputDirectory, "novel543-live-audit.json");
    const report: {
      generatedAt: string;
      status: "running" | "passed" | "failed";
      requirements: { books: number; chaptersPerBook: number; totalChapters: number };
      books: Array<Record<string, unknown>>;
      error?: string;
    } = {
      generatedAt: new Date().toISOString(),
      status: "running",
      requirements: { books: 3, chaptersPerBook: 20, totalChapters: 60 },
      books: [],
    };
    let service: StorySourceService | undefined;
    let auditor: Awaited<ReturnType<typeof createPlaywrightStoryPageClient>> | undefined;
    try {
      service = new StorySourceService({
        profileDirectory,
        headless: process.env.RUN_NOVEL543_HEADED !== "1",
        minRequestIntervalMs: 650,
        verificationWaitMs: 60_000,
        manualVerificationWaitMs: 3 * 60_000,
      });
      const fetched: FetchedAudit[] = [];
      for (const book of BOOKS) {
        const analysis = await service.analyzeUrl(book.url);
        expect(analysis.site).toBe("novel543");
        expect(analysis.bookId).toBe(book.id);
        expect(analysis.chapters).toHaveLength(book.expectedChapters);
        expect(new Set(analysis.chapters.map((chapter) => chapter.id)).size).toBe(book.expectedChapters);
        expect(analysis.chapters.map((chapter) => chapter.number)).toEqual(
          Array.from({ length: book.expectedChapters }, (_, index) => index + 1),
        );
        const indexes = auditIndexes(book.expectedChapters);
        expect(indexes).toHaveLength(20);
        expect(indexes).toContain(0);
        expect(indexes).toContain(book.expectedChapters - 1);
        const selected = indexes.map((index) => analysis.chapters[index]!);
        const result = await service.fetchChapters({
          analysisId: analysis.analysisId,
          chapterIds: selected.map((chapter) => chapter.id),
        });
        expect(result.chapters).toHaveLength(20);
        for (const [index, content] of result.chapters.entries()) {
          const reference = selected[index]!;
          expect(content).toMatchObject({ id: reference.id, number: reference.number, title: reference.title });
          expect(content.sourceText.length).toBeGreaterThan(100);
          expect(content.sourceText).not.toMatch(LEAKED_CHROME);
          expect(content.sourceUrls.length).toBeGreaterThanOrEqual(1);
          fetched.push({ reference, content });
        }
        report.books.push({
          id: book.id,
          title: analysis.bookTitle,
          catalogChapters: analysis.chapters.length,
          selectedChapterNumbers: selected.map((chapter) => chapter.number),
          fetchedChapters: result.chapters.length,
          independentComparisons: 0,
          chapters: result.chapters.map((chapter) => ({
            number: chapter.number,
            title: chapter.title,
            characters: chapter.characterCount,
            pages: chapter.sourceUrls.length,
            sourceUrls: chapter.sourceUrls,
            sha256: createHash("sha256").update(chapter.sourceText).digest("hex"),
          })),
        });
      }

      await service.close();
      service = undefined;
      auditor = await createPlaywrightStoryPageClient({
        profileDirectory,
        headless: process.env.RUN_NOVEL543_HEADED !== "1",
      });
      for (const { reference, content } of fetched) {
        let previousPosition = -1;
        for (const [pageIndex, sourceUrl] of content.sourceUrls.entries()) {
          const requested = parseStoryUrl(sourceUrl);
          const snapshot = await auditor.visit(sourceUrl);
          expect(snapshot.challenge).toBe("none");
          const actual = parseStoryUrl(snapshot.url);
          expect(actual).toMatchObject({ site: "novel543", bookId: requested.bookId, chapterKey: requested.chapterKey });
          expect(actual.page ?? 1).toBe(pageIndex + 1);
          const heading = snapshot.elements.h1?.[0] ?? "";
          expect(parseChapterLabel(heading.replace(/\(\s*\d+\s*\/\s*\d+\s*\)/u, "").trim()).number)
            .toBe(reference.number);
          const raw = snapshot.elements[".chapter-content .content"]?.[0];
          expect(raw).toBeTruthy();
          const independent = cleanIndependentSnapshotText(raw ?? "", heading);
          expect(independent.length).toBeGreaterThan(20);
          const signature = compact(independent).slice(0, 36);
          expect(signature.length).toBeGreaterThanOrEqual(20);
          const position = compact(content.sourceText).indexOf(signature);
          expect(position).toBeGreaterThanOrEqual(0);
          expect(position).toBeGreaterThanOrEqual(previousPosition);
          previousPosition = position;
        }
        const bookReport = report.books.find((entry) => entry.id === requestedBookId(content.sourceUrls[0]!));
        if (bookReport) bookReport.independentComparisons = Number(bookReport.independentComparisons) + 1;
      }
      expect(fetched).toHaveLength(60);
      expect(report.books.every((book) => book.independentComparisons === 20)).toBe(true);
      report.status = "passed";
    } catch (error) {
      report.status = "failed";
      report.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (auditor?.close) await auditor.close().catch(() => undefined);
      await service?.close().catch(() => undefined);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await rm(profileDirectory, { recursive: true, force: true });
    }
  }, 30 * 60_000);
});

function requestedBookId(url: string): string {
  return parseStoryUrl(url).bookId;
}
