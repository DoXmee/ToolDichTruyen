import { validateTranslation, type TranslationValidationResult } from './translationValidator.js';

export interface SentenceTarget {
  start: number;
  end: number;
  text: string;
}

export interface LocalizedHanTarget extends SentenceTarget {
  targetId: string;
}

export const MAX_LOCALIZED_HAN_RUNS = 15;
export const MAX_LOCALIZED_HAN_TARGETS = 15;

export function isSentenceBoundary(character: string): boolean {
  return /[.!?。！？…]/u.test(character);
}

export function sentenceContainingOffset(text: string, offset: number): SentenceTarget {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    throw new RangeError('Vị trí chữ Hán cần sửa không hợp lệ.');
  }

  let start = 0;
  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = text[index] ?? '';
    if (character === '\n' || character === '\r' || isSentenceBoundary(character)) {
      start = index + 1;
      break;
    }
  }
  while (start < offset && /\s/u.test(text[start] ?? '')) start += 1;

  let end = text.length;
  for (let index = offset; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (character === '\n' || character === '\r') {
      end = index;
      break;
    }
    if (!isSentenceBoundary(character)) continue;
    end = index + 1;
    while (end < text.length && /["'”’»）)\]]/u.test(text[end] ?? '')) end += 1;
    break;
  }
  while (end > start && /\s/u.test(text[end - 1] ?? '')) end -= 1;

  const sentence = text.slice(start, end);
  if (!sentence.trim()) throw new Error('Không tìm được câu chứa chữ Hán cần sửa.');
  return { start, end, text: sentence };
}

export function localizedHanRunCount(validation: TranslationValidationResult): number {
  let runs = 0;
  let previousEnd = -1;
  for (const character of validation.hanCharacters) {
    if (character.start !== previousEnd) runs += 1;
    previousEnd = character.end;
  }
  return runs;
}

export function isLocalizedHanOnly(validation: TranslationValidationResult): boolean {
  return (
    validation.issues.length === 1 &&
    validation.issues[0]?.code === 'han_remaining' &&
    validation.hanCharacters.length > 0 &&
    localizedHanRunCount(validation) <= MAX_LOCALIZED_HAN_RUNS
  );
}

export function localizedHanTargets(
  text: string,
  validation: TranslationValidationResult,
  segmentId: string,
): LocalizedHanTarget[] | null {
  if (!isLocalizedHanOnly(validation)) return null;

  const targets: LocalizedHanTarget[] = [];
  const seenRanges = new Set<string>();
  for (const han of validation.hanCharacters) {
    const target = sentenceContainingOffset(text, han.start);
    const rangeKey = `${target.start}:${target.end}`;
    if (seenRanges.has(rangeKey)) continue;
    seenRanges.add(rangeKey);
    targets.push({
      ...target,
      targetId: `${segmentId}-han-${target.start}-${target.end}`,
    });
  }

  return targets.length > 0 && targets.length <= MAX_LOCALIZED_HAN_TARGETS
    ? targets
    : null;
}

export function localizedRepairResponseError(
  target: SentenceTarget,
  response: string,
  targetId: string,
): string | null {
  const candidate = response.normalize('NFC').trim();
  if (!candidate) return 'AI trả về câu sửa trống.';
  if (/\r|\n/u.test(candidate)) return 'Phản hồi sửa cục bộ chứa nhiều dòng.';
  if (candidate.toLocaleLowerCase('en-US').includes(targetId.toLocaleLowerCase('en-US'))) {
    return 'Phản hồi làm lộ mã target sửa cục bộ.';
  }
  if (
    /<\/?[A-Za-z_][^>]*>|^(?:[-*#>]\s*)?(?:mã\s+target|target|câu\s+(?:đã\s+)?sửa|bản\s+(?:đã\s+)?sửa|(?:đây|dưới\s+đây)\s+là\s+(?:câu|bản|phần)\s+(?:dịch|(?:đã\s+)?sửa)|corrected\s+sentence|here(?:'s|\s+is))/iu.test(
      candidate,
    )
  ) {
    return 'Phản hồi sửa cục bộ có chứa thẻ giả hoặc lời dẫn.';
  }

  const stableTokens = (value: string): string[] => (
    value
      .normalize('NFC')
      .replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, ' ')
      .toLocaleLowerCase('vi-VN')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
  const originalTokens = stableTokens(target.text);
  const candidateTokens = stableTokens(candidate);
  if (originalTokens.length >= 3) {
    const row = new Array<number>(candidateTokens.length + 1).fill(0);
    for (const originalToken of originalTokens) {
      let diagonal = 0;
      for (let index = 1; index <= candidateTokens.length; index += 1) {
        const previous = row[index] ?? 0;
        row[index] = originalToken === candidateTokens[index - 1]
          ? diagonal + 1
          : Math.max(row[index] ?? 0, row[index - 1] ?? 0);
        diagonal = previous;
      }
    }
    const retainedRatio = (row[candidateTokens.length] ?? 0) / originalTokens.length;
    if (retainedRatio < 0.6) {
      return 'AI trả về không đúng câu đang cần sửa.';
    }
  }

  const validation = validateTranslation(target.text, candidate, {
    requireNoHan: true,
    minimumSourceLengthForRatioCheck: Number.MAX_SAFE_INTEGER,
    minimumLengthRatio: 0,
    checkPreamble: true,
    checkTruncation: false,
    checkRepetition: false,
  });
  const issue = validation.issues[0];
  return issue ? issue.message : null;
}

export function localizedRepairBatchResponseError(
  response: string,
  targets: readonly LocalizedHanTarget[],
): { error?: string; replacements?: Map<string, string> } {
  const candidate = response.normalize('NFC').trim();
  if (!candidate) return { error: 'AI trả về phần sửa cục bộ trống.' };

  const matches = [...candidate.matchAll(
    /<CAU_DA_SUA\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/CAU_DA_SUA>/giu,
  )];

  if (matches.length !== targets.length) {
    const candidateLines = candidate
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('<') && !line.startsWith('#'));
    if (candidateLines.length === targets.length) {
      const replacements = new Map<string, string>();
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]!;
        const cleaned = candidateLines[i]!.replace(/^\d+[\.\:\-\s]+/, '').trim();
        replacements.set(t.targetId, cleaned);
      }
      return { replacements };
    }
    return { error: 'Phản hồi sửa cục bộ không chứa đủ các câu theo mã target.' };
  }

  const expected = new Map(targets.map((target) => [target.targetId, target]));
  const replacements = new Map<string, string>();
  for (const match of matches) {
    const targetId = match[1]?.trim() ?? '';
    const target = expected.get(targetId);
    if (!target || replacements.has(targetId)) {
      return { error: 'Phản hồi sửa cục bộ có mã target không hợp lệ hoặc trùng lặp.' };
    }
    const responseError = localizedRepairResponseError(target, match[2] ?? '', targetId);
    if (responseError) return { error: responseError };
    replacements.set(targetId, (match[2] ?? '').normalize('NFC').trim());
  }
  return { replacements };
}

export function replaceLocalizedTargets(
  text: string,
  targets: readonly LocalizedHanTarget[],
  replacements: ReadonlyMap<string, string>,
): string {
  let result = text;
  for (const target of [...targets].sort((left, right) => right.start - left.start)) {
    const replacement = replacements.get(target.targetId);
    if (!replacement) continue;
    result = result.slice(0, target.start) + replacement + result.slice(target.end);
  }
  return result;
}
