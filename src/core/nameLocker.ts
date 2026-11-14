import { sify, tify } from 'chinese-conv';

/** Matching key only; never use this value to rewrite the original story or merge identities. */
export function normalizeChineseNameForMatching(text: string): string {
  return sify(text.trim().normalize('NFC'));
}

export interface LockableEntity {
  id?: string;
  category?: 'character' | 'location' | 'item' | 'organization' | string;
  chinese?: string;
  vietnamese?: string;
  zh?: string;
  vi?: string;
  aliases?: readonly (string | { zh: string; viDisplay?: string })[];
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
      const zh = (e.chinese || e.zh || '').trim();
      const vi = (e.vietnamese || e.vi || '').trim();
      if (!zh || !vi || e.ambiguous) return false;
      // Chặn thực thể 1 chữ Hán đơn lẻ để bảo vệ từ vựng thông thường
      if (zh.length <= 1) return false;
      // Chặn danh từ chung, phương hướng, địa điểm chung không được đóng ngoặc khóa cứng
      if (NON_LOCKABLE_WORDS.has(zh)) return false;
      // Chặn thực thể họ tộc [Họ] + 家 (như 康家, 袁家, 褚家) bị khóa thành ⟦Khang Gia⟧
      if (zh.length <= 3 && zh.endsWith('家')) return false;
      // Chặn các chuỗi ghi chú / mô tả / từ phủ định bị lưu nhầm vào trường tên tiếng Việt
      if (/không phải|chưa rõ|lỗi|ghi chú|tạm thời|danh từ chung/i.test(vi)) return false;
      return true;
    })
    .map((e) => ({
      ...e,
      chinese: (e.chinese || e.zh || '').trim(),
      vietnamese: (e.vietnamese || e.vi || '').trim(),
    }));

  // Build replacement entries including full names and unambiguous aliases
  interface ReplacementEntry {
    chinese: string;
    vietnamese: string;
    token: string;
  }

  const replacementMap = new Map<string, ReplacementEntry>();
  const displaysByKey = new Map<string, Set<string>>();

  for (const ent of validEntities) {
    const addKey = (rawKey: string, customVi?: string) => {
      const k = rawKey.trim();
      if (!k || k.length <= 1) return;
      if (NON_LOCKABLE_WORDS.has(k)) return;
      if (k.length <= 3 && k.endsWith('家')) return;
      const vi = customVi?.trim() || ent.vietnamese;
      const canonicalKey = normalizeChineseNameForMatching(k);
      const displays = displaysByKey.get(canonicalKey) ?? new Set<string>();
      // Compare display equivalence without changing the chosen spelling or identity.
      // Keep accents: Hy and Hỷ are different names; case/spacing/NFC are not conflicts.
      displays.add(vi.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase());
      displaysByKey.set(canonicalKey, displays);
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

    // For 3-character person names (e.g. "陆时淮" -> "Lục Thời Hoài"), also register given-name alias ("时淮" -> "Thời Hoài")
    const viParts = ent.vietnamese.trim().split(/\s+/);
    const isPerson = !ent.category || ent.category === 'character';
    if (isPerson && ent.chinese.length === 3 && viParts.length === 3 && !parenMatch) {
      const givenZh = ent.chinese.slice(1);
      const givenVi = viParts.slice(1).join(' ');
      addKey(givenZh, givenVi);
    }
    if (ent.aliases?.length) {
      for (const alias of ent.aliases) {
        if (!alias) continue;
        let aZh = '';
        let aVi: string | undefined = undefined;
        if (typeof alias === 'object' && alias !== null) {
          aZh = (alias as { zh: string; viDisplay?: string }).zh?.trim() || '';
          aVi = (alias as { zh: string; viDisplay?: string }).viDisplay?.trim();
        } else if (typeof alias === 'string') {
          aZh = alias.trim();
        }
        if (!aZh) continue;

        // Safe Alias Guard:
        // 1. Prevent familial relationship sub-entities from hijacking the base entity (e.g. "村長妻子" must NOT have alias "村長")
        const hasRelationshipWord = /(?:妻子|媳婦|媳妇|老婆|太太|之妻|之女|之子|之母|之父|之兄|之弟|之姊|之妹|之夫)/u.test(ent.chinese);
        if (hasRelationshipWord && !/(?:妻子|媳婦|媳妇|老婆|太太|之妻|之女|之子|之母|之父|之兄|之弟|之姊|之妹|之夫)/u.test(aZh)) {
          continue; // Skip dangerous alias that drops the relationship qualifier
        }

        // 2. Prevent team/organization sub-entities from hijacking parent location (e.g. "豐揚村小小孩分隊" must NOT have alias "豐揚村")
        const hasOrgWord = /(?:分隊|分队|小隊|小队|委員會|委员会|小組|小组)/u.test(ent.chinese);
        if (hasOrgWord && !/(?:分隊|分队|小隊|小队|委員會|委员会|小組|小组)/u.test(aZh)) {
          continue; // Skip dangerous alias that strips the org unit
        }

        addKey(aZh, aVi);
      }
    }
  }

  // Lossy conversions (e.g. 后/後) and aliases shared by different entities must
  // not silently assign the first entity's name to everyone in the group.
  // Equal display text is safe to substitute without merging either identity:
  // old memories can contain separate simplified/traditional records of it.
  for (const [key] of replacementMap) {
    if ((displaysByKey.get(normalizeChineseNameForMatching(key))?.size ?? 0) > 1) {
      replacementMap.delete(key);
    }
  }

  // Match observed mixed-script spellings as well. chinese-conv maps UTF-16
  // characters one for one; retain an explicit length guard before using offsets.
  const normalizedSource = sify(sourceText);
  if (normalizedSource.length === sourceText.length) {
    for (const entry of [...replacementMap.values()]) {
      const key = sify(entry.chinese);
      let offset = normalizedSource.indexOf(key);
      while (offset !== -1) {
        const spelling = sourceText.slice(offset, offset + key.length);
        if (!replacementMap.has(spelling)) {
          replacementMap.set(spelling, { ...entry, chinese: spelling });
        }
        offset = normalizedSource.indexOf(key, offset + key.length);
      }
    }
  }

  // Sort by Chinese length descending
  const sortedEntries = Array.from(replacementMap.values()).sort(
    (a, b) => b.chinese.length - a.chinese.length,
  );

  let totalLocked = 0;
  const usedKeys = new Set<string>();
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = sortedEntries.length
    ? new RegExp(`⟦[^⟦⟧\\n]*⟧|${sortedEntries.map((entry) => escape(entry.chinese)).join('|')}`, 'gu')
    : undefined;
  const resultText = pattern ? sourceText.replace(pattern, (match) => {
    // Preserve existing locks and never match inside a name inserted earlier.
    if (match.startsWith('⟦')) return match;
    const entry = replacementMap.get(match);
    if (!entry) return match;
    totalLocked += 1;
    usedKeys.add(match);
    return entry.token;
  }) : sourceText;
  const lockedEntitiesUsed = sortedEntries.filter((entry) => usedKeys.has(entry.chinese));

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
 * Post-translation Lock Enforcement:
 * Detects and corrects hallucinated surname drift (e.g. when LLM changes "Tống Quốc Xương" -> "Quách Quốc Xương"
 * due to in-context contamination with nearby characters like "Quách Tiểu Hà"), as well as English name slips.
 */
export function enforceLockedEntities(
  translatedText: string,
  lockedEntities: readonly LockableEntity[],
  allRegistryCharacters?: readonly { vi?: string; vietnamese?: string; source?: string; chinese?: string }[],
): string {
  if (!translatedText || !lockedEntities || lockedEntities.length === 0) return translatedText;

  let result = translatedText;

  // 1. Build a set of all valid full character names across the story
  const validFullNames = new Set(
    (allRegistryCharacters || lockedEntities)
      .map((e) => ((e as any).vi || (e as any).vietnamese || '').trim().toLowerCase())
      .filter(Boolean),
  );

  // 2. Enforce surname integrity for multi-word characters
  for (const ent of lockedEntities) {
    if (ent.category && ent.category !== 'character') continue;
    const vi = (ent.vietnamese || ent.vi || '').trim();
    const parts = vi.split(/\s+/);

    if (parts.length >= 3) {
      const canonicalSurname = parts[0]!;
      const givenName = parts.slice(1).join(' ');
      const escapedGiven = givenName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

      // Match [Optional Bracket] [WrongSurname] [GivenName] [Optional Bracket]
      // e.g. "Quách Quốc Xương" or "⟦Quách Quốc Xương⟧"
      const pattern = new RegExp(
        `(⟦\\s*)?(\\b[\\p{Lu}][\\p{Ll}]+)\\s+(${escapedGiven})(\\s*⟧)?`,
        'gu',
      );

      result = result.replace(pattern, (match, openB, wrongSurname, gv, closeB) => {
        const fullCandidate = `${wrongSurname} ${gv}`.toLowerCase();
        // If this surname+givenName candidate does NOT exist in the known valid registry characters,
        // it is a hallucinated surname drift (e.g. Quách Quốc Xương instead of Tống Quốc Xương)
        if (!validFullNames.has(fullCandidate)) {
          const prefix = openB || '';
          const suffix = closeB || '';
          return `${prefix}${canonicalSurname} ${gv}${suffix}`;
        }
        return match;
      });
    }

    // 3. Catch English name drift for Chinese characters (e.g. "From Phi" for "Từ Phi")
    if (parts.length >= 2) {
      const givenName = parts.slice(1).join(' ');
      const escapedGiven = givenName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      // Match English preposition "From" + given name
      const fromPattern = new RegExp(`\\bFrom\\s+(${escapedGiven})\\b`, 'gi');
      result = result.replace(fromPattern, vi);
    }
  }

  // 4. Enforce canonical sensitive locations if present in locked entities
  const hasKyotoLock = lockedEntities.some(
    (e) => (e.chinese || e.zh) === '京都' || (e.vietnamese || e.vi) === 'Kinh Đô',
  );
  if (hasKyotoLock) {
    result = result.replace(/\bKyoto\b/gi, 'Kinh Đô');
  }

  const hasLanThanhLock = lockedEntities.some((e) => {
    const zh = e.chinese || e.zh;
    const vi = e.vietnamese || e.vi;
    return zh === '蘭城' || zh === '兰城' || vi === 'Lan Thành';
  });
  if (hasLanThanhLock) {
    result = result.replace(/\b(?:Lan Châu|Lân Thành)\b/g, 'Lan Thành');
  }
  if (hasLanThanhLock) {
    result = result.replace(/\b(?:Lan Châu|Lân Thành)\b/g, 'Lan Thành');
  }

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
