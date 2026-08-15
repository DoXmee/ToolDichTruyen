import type {
  TranslationValidationIssue,
  TranslationValidationOptions,
  TranslationValidationResult,
} from '../shared';
import { locateHanCharacters } from './language';
import { parseChapterHeaderLine } from './titleParser';

export const DEFAULT_TRANSLATION_VALIDATION_OPTIONS: Required<TranslationValidationOptions> = {
  requireNoHan: true,
  minimumSourceLengthForRatioCheck: 40,
  minimumLengthRatio: 0.35,
  checkPreamble: true,
  checkTruncation: true,
  checkRepetition: true,
};

function codePointLength(value: string): number {
  return Array.from(value.trim()).length;
}

function mergeOptions(
  options?: TranslationValidationOptions,
): Required<TranslationValidationOptions> {
  const merged = { ...DEFAULT_TRANSLATION_VALIDATION_OPTIONS, ...options };
  return {
    ...merged,
    minimumSourceLengthForRatioCheck: Math.max(
      0,
      merged.minimumSourceLengthForRatioCheck,
    ),
    minimumLengthRatio: Math.max(0, merged.minimumLengthRatio),
  };
}

function normalizeForComparison(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function hasUnclosedDelimiter(value: string): boolean {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['“', '”'],
    ['‘', '’'],
    ['«', '»'],
  ];

  return pairs.some(([open, close]) => {
    let depth = 0;
    for (const character of value) {
      if (character === open) depth += 1;
      if (character === close && depth > 0) depth -= 1;
    }
    return depth > 0;
  });
}

function findRepeatedSample(value: string): string | null {
  const units = value
    .normalize('NFC')
    .split(/(?:\r\n|\r|\n)+|(?<=[.!?。！？])\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);

  const counts = new Map<string, number>();
  for (const unit of units) {
    const key = unit.toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ');
    const count = (counts.get(key) ?? 0) + 1;
    if (count >= 3) return unit.slice(0, 120);
    counts.set(key, count);
  }
  return null;
}

function chapterHeaderNumbers(value: string): number[] {
  return value.split(/\r\n|\r|\n/u).flatMap((line) => {
    const header = parseChapterHeaderLine(line);
    return header ? [header.chapterNumber] : [];
  });
}

export function validateTranslation(
  sourceText: string,
  translatedText: string,
  options?: TranslationValidationOptions,
): TranslationValidationResult {
  const rules = mergeOptions(options);
  const source = (sourceText ?? '').normalize('NFC');
  const translation = (translatedText ?? '').normalize('NFC');
  const sourceCharacters = codePointLength(source);
  const translatedCharacters = codePointLength(translation);
  const sourceHan = locateHanCharacters(source);
  const remainingHan = locateHanCharacters(translation);
  const issues: TranslationValidationIssue[] = [];

  if (!translation.trim()) {
    issues.push({
      code: 'empty',
      severity: 'error',
      message: 'ChatGPT trả về nội dung trống.',
    });
  } else {
    const leakedOwnershipMarker = /\bTDTOWN_[a-f0-9]{32}\b/iu.exec(translation)?.[0];
    if (leakedOwnershipMarker) {
      issues.push({
        code: 'ownership_marker_leak',
        severity: 'error',
        message: 'Bản dịch làm lộ metadata xác minh nội bộ của tool.',
        sample: leakedOwnershipMarker,
      });
    }

    if (
      /^(?:something went wrong|network error|an error occurred|unable to (?:process|respond)|too many requests|you(?:'ve| have) reached (?:the )?(?:your )?(?:(?:usage|rate|plan|message)s+)?limit|please take a break|try again later|xin lỗi[,! ]+(?:tôi|mình) (?:không thể|không)|bạn (?:đã đạt|cần ngưng|cần nghỉ)|đã đạt giới hạn(?: sử dụng)?|hệ thống đang bận|hãy thử lại sau)/iu.test(
        translation.trim(),
      )
    ) {
      issues.push({
        code: 'error_response',
        severity: 'error',
        message: 'Phản hồi có vẻ là thông báo lỗi hoặc lời từ chối, không phải bản dịch.',
        sample: translation.trim().slice(0, 160),
      });
    }

    if (rules.requireNoHan && remainingHan.length > 0) {
      const first = remainingHan[0];
      if (!first) throw new Error('Han locator returned an inconsistent result.');
      issues.push({
        code: 'han_remaining',
        severity: 'error',
        message: `Bản dịch còn ${remainingHan.length} ký tự Hán.`,
        range: { start: first.start, end: first.end },
        sample: remainingHan
          .slice(0, 12)
          .map((location) => location.character)
          .join(''),
      });
    }

    const sourceChapterNumbers = chapterHeaderNumbers(source);
    if (sourceChapterNumbers.length > 0) {
      const translatedChapterNumbers = chapterHeaderNumbers(translation);
      if (
        sourceChapterNumbers.length !== translatedChapterNumbers.length ||
        sourceChapterNumbers.some((number, index) => number !== translatedChapterNumbers[index])
      ) {
        issues.push({
          code: 'chapter_structure',
          severity: 'error',
          message: 'Bản dịch làm thiếu, thừa hoặc đổi thứ tự tiêu đề chương.',
          sample: `Nguồn: ${sourceChapterNumbers.join(', ')}; dịch: ${translatedChapterNumbers.join(', ') || 'không có'}`,
        });
      }
    }

    if (
      sourceCharacters >= rules.minimumSourceLengthForRatioCheck &&
      sourceCharacters > 0 &&
      translatedCharacters / sourceCharacters < rules.minimumLengthRatio
    ) {
      issues.push({
        code: 'too_short',
        severity: 'error',
        message: 'Bản dịch ngắn bất thường so với đoạn nguồn.',
      });
    }

    if (
      rules.checkPreamble &&
      /^(?:#{1,6}\s*)?(?:dưới đây là (?:bản dịch|phần dịch)|bản dịch(?: tiếng việt)?\s*[:：]|here(?:'s| is) the translation\s*[:：])/iu.test(
        translation.trim(),
      )
    ) {
      issues.push({
        code: 'assistant_preamble',
        severity: 'error',
        message: 'Phản hồi chứa lời dẫn của trợ lý thay vì chỉ có nội dung truyện.',
        sample: translation.trim().slice(0, 160),
      });
    }

    const normalizedSource = normalizeForComparison(source);
    const normalizedTranslation = normalizeForComparison(translation);
    if (
      normalizedSource.length >= 24 &&
      normalizedTranslation.includes(normalizedSource)
    ) {
      issues.push({
        code: 'source_echo',
        severity: 'error',
        message: 'Phản hồi lặp lại nguyên văn đoạn nguồn.',
        sample: normalizedSource.slice(0, 160),
      });
    }

    if (rules.checkTruncation) {
      const trimmed = translation.trimEnd();
      const trimmedSource = source.trimEnd();
      // Source chunks may stop at any punctuation or symbol: a full stop,
      // ellipsis, quote, dash, comma, etc.  When both source and translated
      // chunk end at a boundary mark, the mark cannot prove that the model
      // stopped early.  The actual source tail is the authority here; do not
      // reject a faithful chunk just because its final punctuation differs.
      const sourceEndsWithBoundaryMark = /[\p{P}\p{S}]$/u.test(trimmedSource);
      const translationEndsWithBoundaryMark = /[\p{P}\p{S}]$/u.test(trimmed);
      const faithfulChunkBoundary =
        sourceEndsWithBoundaryMark && translationEndsWithBoundaryMark;
      const sourceHasUnclosedDelimiter = hasUnclosedDelimiter(trimmedSource);
      const translationHasUnclosedDelimiter = hasUnclosedDelimiter(trimmed);
      const faithfulOpenDelimiterBoundary =
        sourceHasUnclosedDelimiter && translationHasUnclosedDelimiter;
      if (
        (!faithfulChunkBoundary && /(?:\.\.\.|…|[,;:，；：\-–—])$/u.test(trimmed)) ||
        (translationHasUnclosedDelimiter && !faithfulOpenDelimiterBoundary)
      ) {
        issues.push({
          code: 'likely_truncated',
          severity: 'error',
          message: 'Bản dịch có dấu hiệu bị ngắt giữa chừng.',
          sample: trimmed.slice(-160),
        });
      }
    }

    if (rules.checkRepetition) {
      const repeatedSample = findRepeatedSample(translation);
      if (repeatedSample) {
        issues.push({
          code: 'repetition',
          severity: 'error',
          message: 'Bản dịch lặp lại cùng một đoạn ít nhất ba lần.',
          sample: repeatedSample,
        });
      }
    }
  }

  const lengthRatio = sourceCharacters > 0
    ? translatedCharacters / sourceCharacters
    : translatedCharacters > 0
      ? 1
      : 0;

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    hanCharacters: remainingHan,
    metrics: {
      sourceCharacters,
      translatedCharacters,
      sourceHanCharacters: sourceHan.length,
      remainingHanCharacters: remainingHan.length,
      lengthRatio,
    },
  };
}
