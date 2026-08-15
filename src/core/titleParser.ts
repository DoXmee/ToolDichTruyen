import type { ChapterHeaderKeyword, DetectedHeader } from '../shared';

const ROMAN_NUMBER_PATTERN =
  /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

const HEADER_PATTERN =
  /^(Chương|Chapter|Hồi|Tập|Bài|Phần)[\t ]+(?:thứ[\t ]+)?(\d{1,7}|[IVXLCDM]{1,15})(?:[\t ]*([:\-–—.])[\t ]*(.*))?$/iu;

const MAX_HEADER_LENGTH = 500;
const MAX_CHAPTER_NUMBER = 999_999;

const KEYWORD_MAP: Record<string, ChapterHeaderKeyword> = {
  'chương': 'chương',
  chapter: 'chapter',
  'hồi': 'hồi',
  'tập': 'tập',
  'bài': 'bài',
  'phần': 'phần',
};

/** Convert a canonical Roman numeral (I..MMMCMXCIX) to an integer. */
export function romanToInteger(value: string): number | null {
  const roman = value.trim().toUpperCase();
  if (!roman || !ROMAN_NUMBER_PATTERN.test(roman)) return null;

  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };

  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values[roman.charAt(index)] ?? 0;
    const next = values[roman.charAt(index + 1)] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

function stripMarkdownDecoration(line: string): string {
  let result = line.normalize('NFC').replace(/^\uFEFF/, '').trim();

  // Markdown heading and blockquote syntax are structural, not part of a title.
  result = result.replace(/^#{1,6}[\t ]+/, '');
  result = result.replace(/^>[\t ]?/, '');
  result = result.replace(/[\t ]+#{1,6}$/, '').trim();

  const symmetricWrappers = ['**', '__', '~~', '*', '_'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const wrapper of symmetricWrappers) {
      if (
        result.length > wrapper.length * 2 &&
        result.startsWith(wrapper) &&
        result.endsWith(wrapper)
      ) {
        result = result.slice(wrapper.length, -wrapper.length).trim();
        changed = true;
        break;
      }
    }
  }

  return result;
}

function parseChapterNumber(rawNumber: string): number | null {
  if (/^\d+$/.test(rawNumber)) {
    const value = Number(rawNumber);
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_CHAPTER_NUMBER
      ? value
      : null;
  }
  return romanToInteger(rawNumber);
}

/**
 * Parse a complete chapter-heading line.
 *
 * A number is deliberately mandatory. Requiring a number and either end-of-line
 * or an explicit separator prevents ordinary prose such as "Chương trình hôm
 * nay", "Bài học đầu tiên", and "Tập thể..." from being deleted as headings.
 */
export function parseChapterHeaderLine(line: string): DetectedHeader | null {
  if (!line || !line.trim() || line.length > MAX_HEADER_LENGTH) return null;

  const normalizedLine = stripMarkdownDecoration(line);
  const match = HEADER_PATTERN.exec(normalizedLine);
  if (!match) return null;

  const rawKeyword = match[1];
  const rawChapterNumber = match[2];
  if (!rawKeyword || !rawChapterNumber) return null;

  const chapterNumber = parseChapterNumber(rawChapterNumber);
  if (chapterNumber === null) return null;

  const keyword = KEYWORD_MAP[rawKeyword.toLocaleLowerCase('vi-VN')];
  if (!keyword) return null;

  return {
    isHeader: true,
    chapterNumber,
    rawChapterNumber,
    keyword,
    separator: match[3] ?? '',
    extractedTitle: (match[4] ?? '').trim(),
    originalLine: line.trim(),
    normalizedLine,
  };
}

function splitLineEnding(value: string): { line: string; ending: string } {
  const endingMatch = value.match(/(?:\r\n|\r|\n)$/);
  const ending = endingMatch?.[0] ?? '';
  return { line: ending ? value.slice(0, -ending.length) : value, ending };
}

/** Remove only safely recognized complete header lines while retaining other EOLs. */
export function cleanTextOfChapterHeaders(text: string): {
  cleanedText: string;
  removedCount: number;
  firstHeader: DetectedHeader | null;
} {
  if (!text) {
    return { cleanedText: '', removedCount: 0, firstHeader: null };
  }

  const records = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  let removedCount = 0;
  let firstHeader: DetectedHeader | null = null;
  const kept: string[] = [];

  for (const record of records) {
    if (!record) continue;
    const { line } = splitLineEnding(record);
    const header = parseChapterHeaderLine(line);
    if (header) {
      removedCount += 1;
      firstHeader ??= header;
    } else {
      kept.push(record);
    }
  }

  return { cleanedText: kept.join(''), removedCount, firstHeader };
}

export function constructTitle(index: number, suffix = '', prefix = ''): string {
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.trunc(index) : 1;
  const main = `Chương ${safeIndex}`;
  const cleanPrefix = prefix.trim();
  const cleanSuffix = suffix.trim();

  let chapterPart = main;
  if (cleanSuffix) {
    chapterPart = /^[:\-–—.]/u.test(cleanSuffix)
      ? `${main}${cleanSuffix}`
      : `${main}: ${cleanSuffix}`;
  }

  return cleanPrefix ? `${cleanPrefix} ${chapterPart}` : chapterPart;
}
