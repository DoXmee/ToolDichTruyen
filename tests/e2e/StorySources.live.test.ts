import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorySourceService } from '../../src/main/storySources';
import { StorySourceError } from '../../src/main/storySources';

const live = process.env.RUN_STORY_SOURCE_LIVE === '1' ? describe : describe.skip;

const XBANXIA_BOOK_URL = 'https://www.xbanxia.cc/books/143300.html';
const XBANXIA_CHAPTER_1_URL = 'https://www.xbanxia.cc/books/143300/28251886.html';
const XBANXIA_REGRESSION_CHAPTER_URL = 'https://www.xbanxia.cc/books/420871/73048292.html';
const XBANXIA_EXTRA_CHAPTER_URLS = [
  'https://www.xbanxia.cc/books/420871/73048293.html',
  'https://www.xbanxia.cc/books/420871/73048294.html',
  'https://www.xbanxia.cc/books/143300/28251894.html',
] as const;

function expectCleanXbanxiaText(text: string): void {
  expect(text.length).toBeGreaterThan(500);
  expect(text).not.toContain('\uFFFD');
  expect(text).not.toMatch(/[\uAC00-\uD7AF]/u);
  expect(text).not.toMatch(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u);
  expect(text).not.toMatch(
    /(?:半夏小說\s*[，,]\s*快樂很多|每日推薦|錯誤提交|問題類型|章節錯誤|上一章|下一章|閱讀全文|作者有(?:話|话)(?:要)?(?:說|说)|感謝在|感谢在|營養液|营养液)/iu,
  );
  expect(text).not.toMatch(/<(?:script|style|iframe|ins|figure)\b|\bon(?:error|load)\s*=/iu);
}

live('nguồn truyện thật (opt-in)', () => {
  let directory = '';
  let service: StorySourceService;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'story-source-live-'));
    service = new StorySourceService({
      profileDirectory: directory,
      headless: true,
      minRequestIntervalMs: 250,
    });
  });

  afterAll(async () => {
    await service?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('TimoTXT phân tích đúng link chương và lấy text transcode sạch', async () => {
    const analysis = await service.analyzeUrl('https://www.timotxt.com/1509589610/13.html');
    expect(analysis.inputKind).toBe('chapter');
    expect(analysis.defaultSelectedChapterIds).toHaveLength(1);
    const result = await service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]?.sourceUrls).toContain('https://www.timotxt.com/1509589610/13.html');
    expect(result.chapters[0]?.characterCount).toBeGreaterThan(500);
    expect(result.combinedSource).not.toMatch(/[\uAC00-\uD7AF]/u);
    expect(result.combinedSource).not.toMatch(
      /(?:adBlock|Tamedia|Google|OneAD|溫馨提示|上一章|下一章|返回目錄|章節目錄)/iu,
    );
    expect(result.combinedSource).not.toContain('\uFFFD');
  }, 90_000);

  it('Qingrenyouxi xác minh canonical/GBK và chỉ lấy #htmlContent', async () => {
    const analysis = await service.analyzeUrl('https://www.qingrenyouxi.com/book/114551/33074751.html');
    expect(analysis.inputKind).toBe('chapter');
    expect(analysis.defaultSelectedChapterIds).toHaveLength(1);
    const result = await service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters[0]).toMatchObject({ number: 11 });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]?.characterCount).toBeGreaterThan(500);
    expect(result.combinedSource).not.toMatch(
      /(?:_ad_top|_ad_hf|_ad_bottom|panel-chapterlist|linkPrev|linkNext|I'm very sorry|上一章|下一章|返回目录)/iu,
    );
    expect(result.combinedSource).not.toContain('\uFFFD');
  }, 90_000);

  it('Huliwang chỉ trả truyện khi Cloudflare đã qua; nếu bị giữ thì fail rõ, không nhận challenge là nội dung', async () => {
    try {
      const analysis = await service.analyzeUrl('https://m.huliwang.net/1703891/36/3.html');
      expect(analysis.inputKind).toBe('chapter');
      expect(analysis.defaultSelectedChapterIds).toHaveLength(1);
      expect(analysis.bookTitle).not.toMatch(/Just a moment|Cloudflare/iu);
      const result = await service.fetchChapters({
        analysisId: analysis.analysisId,
        chapterIds: analysis.defaultSelectedChapterIds,
      });
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0]?.characterCount).toBeGreaterThan(500);
      expect(result.combinedSource).not.toMatch(
        /(?:Just a moment|Cloudflare|Performing security verification|Ray ID|点击下一页继续|此页为本章|阅#读#模#式|上一章|下一章|返回目录)/iu,
      );
      expect(result.combinedSource).not.toContain('\uFFFD');
    } catch (error) {
      expect(error).toBeInstanceOf(StorySourceError);
      expect((error as StorySourceError).code).toMatch(/^(?:SOURCE_BLOCKED|USER_ACTION_REQUIRED)$/u);
      expect((error as Error).message).toMatch(/Cloudflare|xác minh/iu);
    }
  }, 90_000);
  it('Xbanxia phân tích đủ link bộ và chỉ lấy sạch chương 1, 82, 164', async () => {
    const analysis = await service.analyzeUrl(XBANXIA_BOOK_URL);
    expect(analysis).toMatchObject({
      site: 'xbanxia',
      inputKind: 'book',
      bookId: '143300',
      bookTitle: '嫁給殘疾皇子後',
      author: '李寂v5',
      bookUrl: XBANXIA_BOOK_URL,
      catalogUrl: XBANXIA_BOOK_URL,
    });
    expect(analysis.chapters).toHaveLength(165);
    expect(analysis.defaultSelectedChapterIds).toHaveLength(164);
    expect(new Set(analysis.chapters.map((chapter) => chapter.id)).size).toBe(165);
    expect(new Set(analysis.chapters.flatMap((chapter) => chapter.partUrls)).size).toBe(165);

    const introduction = analysis.chapters.find((chapter) => chapter.isIntroduction);
    expect(introduction).toMatchObject({
      title: '作品相關',
      selectedByDefault: false,
    });
    expect(analysis.defaultSelectedChapterIds).not.toContain(introduction?.id);

    const numbered = analysis.chapters.filter((chapter) => chapter.number !== undefined);
    expect(numbered).toHaveLength(164);
    expect(numbered.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: 164 }, (_, index) => index + 1),
    );

    const representatives = [1, 82, 164].map((number) => {
      const chapter = analysis.chapters.find((candidate) => candidate.number === number);
      expect(chapter, `Thiếu chương ${number} trong mục lục Xbanxia`).toBeDefined();
      return chapter!;
    });
    const result = await service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: representatives.map((chapter) => chapter.id),
    });

    expect(result.chapters).toHaveLength(3);
    expect(result.chapters.map((chapter) => chapter.number)).toEqual([1, 82, 164]);
    expect(result.chapters.map((chapter) => chapter.sourceUrls)).toEqual(
      representatives.map((chapter) => chapter.partUrls),
    );
    for (const chapter of result.chapters) {
      expect(chapter.characterCount).toBe(chapter.sourceText.length);
      expect(chapter.mergedPartCount).toBe(1);
      expectCleanXbanxiaText(chapter.sourceText);
    }
    expectCleanXbanxiaText(result.combinedSource);
  }, 120_000);

  it('Xbanxia nhận link chương trực tiếp, chọn đúng chương 1 và không dính phần lề', async () => {
    const analysis = await service.analyzeUrl(XBANXIA_CHAPTER_1_URL);
    expect(analysis).toMatchObject({
      site: 'xbanxia',
      inputKind: 'chapter',
      bookId: '143300',
      bookTitle: '嫁給殘疾皇子後',
    });
    expect(analysis.chapters).toHaveLength(165);
    expect(analysis.defaultSelectedChapterIds).toHaveLength(1);

    const selected = analysis.chapters.find(
      (chapter) => chapter.id === analysis.defaultSelectedChapterIds[0],
    );
    expect(selected).toMatchObject({
      number: 1,
      numberLabel: '第1章',
      title: '替婚',
      url: XBANXIA_CHAPTER_1_URL,
      partUrls: [XBANXIA_CHAPTER_1_URL],
      isIntroduction: false,
      selectedByDefault: true,
    });

    const result = await service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      number: 1,
      title: '替婚',
      sourceUrls: [XBANXIA_CHAPTER_1_URL],
      mergedPartCount: 1,
    });
    expect(result.chapters[0]?.characterCount).toBe(result.chapters[0]?.sourceText.length);
    expect(result.chapters[0]?.sourceText).not.toMatch(/^\s*第\s*1\s*章/u);
    expect(result.combinedSource.match(/^Chương\s+1\s*:/gmu)).toHaveLength(1);
    expectCleanXbanxiaText(result.chapters[0]?.sourceText ?? '');
    expectCleanXbanxiaText(result.combinedSource);
  }, 120_000);

  it('Xbanxia mẫu 420871 chỉ giữ trọn #nr1, không lấy đầu/cuối trang', async () => {
    const analysis = await service.analyzeUrl(XBANXIA_REGRESSION_CHAPTER_URL);
    expect(analysis).toMatchObject({ site: 'xbanxia', inputKind: 'chapter' });
    expect(analysis.defaultSelectedChapterIds).toHaveLength(1);
    const result = await service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    const text = result.chapters[0]?.sourceText ?? '';
    expect(text).toContain('自從林美言從海島下鄉回到江城後');
    expect(text).toContain('迫切地想要見到闊別一天的女兒');
    expect(text).not.toMatch(/^\s*第\s*1\s*章/u);
    expectCleanXbanxiaText(text);
  }, 120_000);

  it.each(XBANXIA_EXTRA_CHAPTER_URLS)('Xbanxia %s giữ sạch toàn bộ chương trực tiếp', async (url) => {
    const analysis = await service.analyzeUrl(url);
    expect(analysis).toMatchObject({ site: 'xbanxia', inputKind: 'chapter' });
    expect(analysis.defaultSelectedChapterIds).toHaveLength(1);
    const result = await service.fetchChapters({
      analysisId: analysis.analysisId,
      chapterIds: analysis.defaultSelectedChapterIds,
    });
    const text = result.chapters[0]?.sourceText ?? '';
    expect(result.chapters[0]?.mergedPartCount).toBe(1);
    expect(text).not.toMatch(/^\s*第\s*\d+\s*章/u);
    expectCleanXbanxiaText(text);
  }, 120_000);
});
