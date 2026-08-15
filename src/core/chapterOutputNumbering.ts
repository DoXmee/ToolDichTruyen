import type { Chapter, FinalChapterExportInput } from '../shared';

const MAX_CHAPTER_NUMBER = 999_999;

function assertOutputStart(value: number | undefined, chapterCount: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CHAPTER_NUMBER) {
    throw new RangeError('Số chương xuất bắt đầu không hợp lệ.');
  }
  if (chapterCount > 0 && value + chapterCount - 1 > MAX_CHAPTER_NUMBER) {
    throw new RangeError('Dải số chương xuất vượt quá giới hạn cho phép.');
  }
  return value;
}

/** The website chapter that owns a generated split slice. */
export function sourceChapterNumberOf(chapter: Pick<Chapter, 'index' | 'source'>): number {
  const candidate = chapter.source?.sourceChapterNumber
    ?? chapter.source?.header?.chapterNumber
    ?? chapter.index;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > MAX_CHAPTER_NUMBER) {
    throw new RangeError('Không xác định được số chương gốc an toàn.');
  }
  return candidate;
}

/**
 * Return the descriptive portion of an existing generated title. The splitter
 * uses both `Chương 7 Tên` and `Chương 7: Tên`, so accept either delimiter.
 */
function titleSuffix(title: string): string {
  const normalized = title.normalize('NFC').trim();
  const prefix = /^(?:Chương|Chapter|Hồi|Tập|Bài|Phần)[\t ]+\d{1,7}(?=$|[\t :.\-–—])/iu.exec(normalized);
  if (!prefix) return normalized;
  return normalized
    .slice(prefix[0].length)
    .replace(/^[\t ]+/u, '')
    .replace(/^[:.\-–—][\t ]*/u, '')
    .trim();
}

function renamedTitle(title: string, index: number): string {
  const suffix = titleSuffix(title);
  return `Chương ${index}${suffix ? `: ${suffix}` : ''}`;
}

function asExportInput(chapter: Chapter, index: number, sourceChapterNumber?: number): FinalChapterExportInput {
  return {
    index,
    ...(sourceChapterNumber === undefined ? {} : { sourceChapterNumber }),
    title: sourceChapterNumber === undefined ? chapter.title : renamedTitle(chapter.title, index),
    content: chapter.content,
    wordCount: chapter.wordCount,
  };
}

/**
 * Maps every final split file to a sequential user-visible number. Omitting
 * `outputChapterStart` deliberately returns the legacy values byte-for-byte,
 * including the absence of a `c.gốc` filename prefix.
 */
export function renumberFinalExportChapters(
  chapters: readonly Chapter[],
  outputChapterStart: number | undefined,
): FinalChapterExportInput[] {
  const start = assertOutputStart(outputChapterStart, chapters.length);
  return chapters.map((chapter, ordinal) => (
    start === undefined
      ? asExportInput(chapter, chapter.index)
      : asExportInput(chapter, start + ordinal, sourceChapterNumberOf(chapter))
  ));
}

function firstFinalPartIndexForOriginal(
  original: Chapter,
  finalChapters: readonly Chapter[],
): number | undefined {
  const originalStart = original.source?.start;
  const originalEnd = original.source?.end;
  if (typeof originalStart === 'number' && typeof originalEnd === 'number') {
    const byOffset = finalChapters.find((chapter) => {
      const start = chapter.source?.start;
      const end = chapter.source?.end;
      return typeof start === 'number' && typeof end === 'number'
        && start >= originalStart && end <= originalEnd;
    });
    if (byOffset) return finalChapters.indexOf(byOffset);
  }

  const sourceNumber = sourceChapterNumberOf(original);
  const bySource = finalChapters.findIndex((chapter) => sourceChapterNumberOf(chapter) === sourceNumber);
  return bySource >= 0 ? bySource : undefined;
}

/**
 * Original, unsplit TXT files use the number of their first final split file.
 * This means an original source chapter that became parts 101 and 102 is
 * itself labelled 101, while the next source chapter starts at 103.
 */
export function renumberOriginalExportChapters(
  originalChapters: readonly Chapter[],
  finalChapters: readonly Chapter[],
  outputChapterStart: number | undefined,
): FinalChapterExportInput[] {
  const start = assertOutputStart(outputChapterStart, finalChapters.length);
  if (start === undefined) return originalChapters.map((chapter) => asExportInput(chapter, chapter.index));

  let fallbackOrdinal = 0;
  return originalChapters.map((chapter) => {
    const finalOrdinal = firstFinalPartIndexForOriginal(chapter, finalChapters);
    const ordinal = finalOrdinal === undefined ? fallbackOrdinal : finalOrdinal;
    fallbackOrdinal = Math.max(fallbackOrdinal, ordinal + 1);
    return asExportInput(chapter, start + ordinal, sourceChapterNumberOf(chapter));
  });
}

