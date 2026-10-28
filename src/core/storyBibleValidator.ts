import type { GenreProfile } from './genreProfile.js';
import type { StoryBibleEntity } from './storyBible.js';

export interface BibleValidationIssue {
  code:
    | 'stray_han'
    | 'unclosed_lock'
    | 'altered_lock'
    | 'wrong_narration_pronoun'
    | 'forbidden_modern_term';
  severity: 'block' | 'warn';
  message: string;
  sample?: string;
}

export interface BibleValidationResult {
  valid: boolean;
  issues: readonly BibleValidationIssue[];
  cleanedText: string;
}

/**
 * Validates translated text against Story Bible v2 constraints:
 * - Checks for remaining Han characters
 * - Checks that bracketed tokens ⟦...⟧ are strictly preserved and not modified
 * - Checks for forbidden modern terminology (for Period genre)
 * - Checks narration pronoun consistency
 */
export function validateStoryBibleOutput(
  translatedText: string,
  options: {
    expectedLockedNames?: readonly string[];
    presentEntities?: readonly StoryBibleEntity[];
    genreProfile?: GenreProfile;
  } = {},
): BibleValidationResult {
  const issues: BibleValidationIssue[] = [];
  const text = translatedText || '';

  // 1. Check for unclosed brackets ⟦...⟧
  const openCount = (text.match(/⟦/gu) || []).length;
  const closeCount = (text.match(/⟧/gu) || []).length;
  if (openCount !== closeCount) {
    issues.push({
      code: 'unclosed_lock',
      severity: 'block',
      message: `Dấu ngoặc khóa tên ⟦ (${openCount}) không khớp với ⟧ (${closeCount}).`,
      sample: `Số lượng mở: ${openCount}, đóng: ${closeCount}`,
    });
  }

  // 2. Check for altered lock contents
  if (options.expectedLockedNames?.length) {
    const expectedSet = new Set(options.expectedLockedNames.map((n) => n.trim().toLowerCase()));
    const actualTokens = Array.from(text.matchAll(/⟦\s*([^⟦⟧\n]+?)\s*⟧/gu), (m) => m[1]?.trim());

    for (const token of actualTokens) {
      if (token && !expectedSet.has(token.toLowerCase())) {
        issues.push({
          code: 'altered_lock',
          severity: 'block',
          message: `Nội dung trong ngoặc ⟦${token}⟧ không khớp với danh sách tên đã khóa.`,
          sample: `⟦${token}⟧`,
        });
      }
    }
  }

  // 3. Check for stray Han characters outside brackets
  // Han unicode range: \u4e00-\u9fa5
  const hanMatches = text.match(/[\u4e00-\u9fa5]+/gu) || [];
  if (hanMatches.length > 0) {
    issues.push({
      code: 'stray_han',
      severity: 'block',
      message: `Bản dịch còn sót ${hanMatches.length} cụm ký tự Hán chưa được dịch.`,
      sample: hanMatches.slice(0, 3).join(', '),
    });
  }

  // 4. Check for forbidden modern terms if profile specifies them
  if (options.genreProfile?.worldRules.forbiddenModernTerms?.length) {
    const textLower = text.toLowerCase();
    for (const forbidden of options.genreProfile.worldRules.forbiddenModernTerms) {
      if (textLower.includes(forbidden.toLowerCase())) {
        issues.push({
          code: 'forbidden_modern_term',
          severity: 'warn',
          message: `Xuất hiện thuật ngữ hiện đại không phù hợp bối cảnh niên đại: "${forbidden}".`,
          sample: forbidden,
        });
      }
    }
  }

  // 5. Check for wrong narration pronoun
  if (options.presentEntities?.length) {
    for (const ent of options.presentEntities) {
      if (ent.category === 'character' && ent.narrationPronoun) {
        // Example: if narrationPronoun is "cậu ấy" or "anh", but translation says "hắn" right near the name
        if (ent.narrationPronoun !== 'hắn') {
          const pattern = new RegExp(`⟦?${ent.vi}⟧?\\s*[,.]?\\s*hắn\\b`, 'iu');
          if (pattern.test(text)) {
            issues.push({
              code: 'wrong_narration_pronoun',
              severity: 'warn',
              message: `Nhân vật ${ent.vi} được quy định dùng đại từ "${ent.narrationPronoun}", nhưng bản dịch dùng "hắn".`,
              sample: `${ent.vi} ... hắn`,
            });
          }
        }
      }
    }
  }

  // Auto clean text: unlock brackets
  const cleanedText = text.replace(/⟦\s*([^⟦⟧\n]+?)\s*⟧/gu, '$1');

  const hasBlockingIssues = issues.some((i) => i.severity === 'block');

  return {
    valid: !hasBlockingIssues,
    issues,
    cleanedText,
  };
}
