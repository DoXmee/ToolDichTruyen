import { sify, tify } from 'chinese-conv';

export interface LockableEntity {
  id?: string;
  chinese: string;
  vietnamese: string;
  aliases?: readonly string[];
  ambiguous?: boolean;
}

export interface LockResult {
  lockedSourceText: string;
  lockedCount: number;
  lockedEntities: Array<{
    chinese: string;
    vietnamese: string;
    token: string;
  }>;
}

export interface ValidationLockIssue {
  code: 'missing_lock' | 'corrupted_lock' | 'unclosed_lock';
  message: string;
  sample?: string;
}

const NON_LOCKABLE_WORDS = new Set([
  '大院', '军区', '軍區', '大队', '大隊', '公社', '兵团', '兵團',
  '南方', '北方', '内地', '內地', '东北', '東北', '西北', '东南', '東南', '西南',
  '医院', '醫院', '工厂', '工廠', '厂房', '廠房', '车间', '車間',
  '学校', '學校', '招待所', '饭店', '飯店', '供销社', '食堂',
  '家属院', '家屬院', '筒子楼', '筒子樓', '卫生所', '衛生所', '卫生院', '衛生院',
  '火车站', '火車站', '车站', '車站', '机场', '機場', '码头', '碼頭',
]);

/**
 * Replaces recognized Chinese proper names with bracketed Vietnamese placeholders
 * using mechanical code substitution before sending to AI.
 *
 * Rule: Longest Chinese string matches first to prevent substring collisions
 * (e.g., "顾国强" matches before "国强").
 * Ambiguous aliases are skipped and kept as raw Chinese with a warning prompt.
 */
export function lockNamesInSource(
  sourceText: string,
  entities: readonly LockableEntity[],
): LockResult {
  if (!sourceText || !entities || entities.length === 0) {
    return {
      lockedSourceText: sourceText,
      lockedCount: 0,
      lockedEntities: [],
    };
  }

  // Filter valid entities with both Chinese and Vietnamese names
  const validEntities = entities
    .filter((e) => {
      if (!e.chinese?.trim() || !e.vietnamese?.trim() || e.ambiguous) return false;
      const zh = e.chinese.trim();
      // Chặn thực thể 1 chữ Hán đơn lẻ để bảo vệ từ vựng thông thường
      if (zh.length <= 1) return false;
      // Chặn danh từ chung, phương hướng, địa điểm chung không được đóng ngoặc khóa cứng
      if (NON_LOCKABLE_WORDS.has(zh)) return false;
      // Chặn thực thể họ tộc [Họ] + 家 (như 康家, 袁家, 褚家) bị khóa thành ⟦Khang Gia⟧
      if (zh.length <= 3 && zh.endsWith('家')) return false;
      const vi = e.vietnamese.trim();
      // Chặn các chuỗi ghi chú / mô tả / từ phủ định bị lưu nhầm vào trường tên tiếng Việt
      if (/không phải|chưa rõ|lỗi|ghi chú|tạm thời|danh từ chung/i.test(vi)) return false;
      return true;
    })
    .map((e) => ({
      ...e,
      chinese: e.chinese.trim(),
      vietnamese: e.vietnamese.trim(),
    }));

  // Build replacement entries including full names and unambiguous aliases
  interface ReplacementEntry {
    chinese: string;
    vietnamese: string;
    token: string;
  }

  const replacementMap = new Map<string, ReplacementEntry>();

  for (const ent of validEntities) {
    const addKey = (rawKey: string, customVi?: string) => {
      const k = rawKey.trim();
      if (!k || k.length <= 1) return;
      if (NON_LOCKABLE_WORDS.has(k)) return;
      if (k.length <= 3 && k.endsWith('家')) return;
      const vi = customVi?.trim() || ent.vietnamese;
      if (!replacementMap.has(k)) {
        replacementMap.set(k, {
          chinese: k,
          vietnamese: vi,
          token: `⟦${vi}⟧`,
        });
      }
      // Add both Simplified and Traditional Chinese equivalents for multi-character keys
      if (k.length >= 2) {
        const sKey = sify(k);
        if (!replacementMap.has(sKey)) {
          replacementMap.set(sKey, {
            chinese: sKey,
            vietnamese: vi,
            token: `⟦${vi}⟧`,
          });
        }
        const tKey = tify(k);
        if (!replacementMap.has(tKey)) {
          replacementMap.set(tKey, {
            chinese: tKey,
            vietnamese: vi,
            token: `⟦${vi}⟧`,
          });
        }
      }
    };

    addKey(ent.chinese);

    // If entity has parenthetical notation like "宁峥嵘（蓝鹤清）" -> "Ninh Tranh Vanh (Lam Hạc Thanh)"
    const parenMatch = /^([^（(]+)[（(]([^）)]+)[）)]$/u.exec(ent.chinese);
    if (parenMatch) {
      const baseZh = parenMatch[1]?.trim();
      const innerZh = parenMatch[2]?.trim();
      const viParenMatch = /^([^（(]+)[（(]([^）)]+)[）)]$/u.exec(ent.vietnamese);
      const baseVi = viParenMatch ? viParenMatch[1]?.trim() : ent.vietnamese;
      const innerVi = viParenMatch ? viParenMatch[2]?.trim() : undefined;
      if (baseZh) addKey(baseZh, baseVi);
      if (innerZh && innerVi) addKey(innerZh, innerVi);
    }
    if (ent.aliases?.length) {
      for (const alias of ent.aliases) {
        if (!alias) continue;
        const aTrim = alias.trim();
        if (!aTrim) continue;

        // Safe Alias Guard:
        // 1. Prevent familial relationship sub-entities from hijacking the base entity (e.g. "村長妻子" must NOT have alias "村長")
        const hasRelationshipWord = /(?:妻子|媳婦|媳妇|老婆|太太|之妻|之女|之子|之母|之父|之兄|之弟|之姊|之妹|之夫)/u.test(ent.chinese);
        if (hasRelationshipWord && !/(?:妻子|媳婦|媳妇|老婆|太太|之妻|之女|之子|之母|之父|之兄|之弟|之姊|之妹|之夫)/u.test(aTrim)) {
          continue; // Skip dangerous alias that drops the relationship qualifier
        }

        // 2. Prevent team/organization sub-entities from hijacking parent location (e.g. "豐揚村小小孩分隊" must NOT have alias "豐揚村")
        const hasOrgWord = /(?:分隊|分队|小隊|小队|委員會|委员会|小組|小组)/u.test(ent.chinese);
        if (hasOrgWord && !/(?:分隊|分队|小隊|小队|委員會|委员会|小組|小组)/u.test(aTrim)) {
          continue; // Skip dangerous alias that strips the org unit
        }

        addKey(aTrim);
      }
    }
  }

  // Sort by Chinese length descending
  const sortedEntries = Array.from(replacementMap.values()).sort(
    (a, b) => b.chinese.length - a.chinese.length,
  );

  let resultText = sourceText;
  let totalLocked = 0;
  const lockedEntitiesUsed: ReplacementEntry[] = [];

  for (const entry of sortedEntries) {
    if (resultText.includes(entry.chinese)) {
      // Global literal replacement
      const parts = resultText.split(entry.chinese);
      const count = parts.length - 1;
      if (count > 0) {
        totalLocked += count;
        resultText = parts.join(entry.token);
        lockedEntitiesUsed.push(entry);
      }
    }
  }

  return {
    lockedSourceText: resultText,
    lockedCount: totalLocked,
    lockedEntities: lockedEntitiesUsed,
  };
}

/**
 * Strips the mechanical brackets `⟦` and `⟧` from the translated output.
 * Normalizes any accidental inner whitespace left by the LLM (e.g. `⟦ Cố Quốc Cường ⟧`).
 */
export function unlockNamesInTranslation(translatedText: string): string {
  if (!translatedText) return '';

  // 1. Ensure word boundary spacing before and after brackets to prevent sticky words like "TốngThư Thư"
  let result = translatedText
    .replace(/([\p{L}\p{N}])⟦/gu, '$1 ⟦')
    .replace(/⟧([\p{L}\p{N}])/gu, '⟧ $1');

  // 2. Remove brackets while trimming spaces directly inside brackets:
  // e.g. ⟦ Cố Quốc Cường ⟧ -> Cố Quốc Cường
  result = result.replace(/⟦\s*([^⟦⟧\n]+?)\s*⟧/gu, '$1');

  // 3. Normalize multiple horizontal spaces into a single space (preserving newlines)
  result = result.replace(/([^\S\r\n]){2,}/gu, ' ');

  return result;
}

/**
 * Validates that all locks inserted into the source text were properly preserved by the AI
 * and not corrupted, deleted, or partially mangled.
 */
export function inspectNameLocks(
  translatedText: string,
  expectedTokens: readonly string[],
): ValidationLockIssue[] {
  const issues: ValidationLockIssue[] = [];
  if (!translatedText) return issues;

  // Check for mismatched/unclosed bracket occurrences
  const openCount = (translatedText.match(/⟦/gu) || []).length;
  const closeCount = (translatedText.match(/⟧/gu) || []).length;

  if (openCount !== closeCount) {
    issues.push({
      code: 'unclosed_lock',
      message: `Số lượng dấu mở ngoặc ⟦ (${openCount}) không khớp với dấu đóng ngoặc ⟧ (${closeCount}).`,
      sample: `Mở: ${openCount}, Đóng: ${closeCount}`,
    });
  }

  return issues;
}

/**
 * Replaces a character name globally across pre-existing translated text
 * without needing to call the LLM to re-translate the entire chapter.
 */
export function batchRenameInTranslation(
  text: string,
  oldName: string,
  newName: string,
): string {
  const cleanOld = oldName.trim();
  const cleanNew = newName.trim();
  if (!text || !cleanOld || !cleanNew || cleanOld === cleanNew) return text;

  // Escape special regex characters
  const escaped = cleanOld.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const regex = new RegExp(escaped, 'gu');
  return text.replace(regex, cleanNew);
}
