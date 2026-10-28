import { sify } from 'chinese-conv';
import type {
  CharacterRelation,
  EntityCategory,
  StoryEntity,
  StoryMemory,
  StoryRecentDialogue,
} from '../shared/types.js';
import {
  COMMON_NOUN_BLACKLIST,
  DIRECTIONS_AND_REGIONS,
  INVALID_NAME_ENDINGS,
  INVALID_NAME_PREFIXES,
  URBAN_ARCHITECTURAL_LOCATIONS,
  detectCharacterGender,
  isChineseSurname,
  isCultivationGenre,
} from './storyMemoryExtractor.js';
import { getGenreProfile } from './genreProfile.js';
import { isAddressHonorificOrPrefix } from './storyBible.js';

export function createEmptyStoryMemory(options?: {
  storyId?: string;
  storyTitle?: string;
  genre?: string;
}): StoryMemory {
  return {
    version: 1,
    storyId: options?.storyId,
    storyTitle: options?.storyTitle,
    genre: options?.genre,
    entities: [],
    relations: [],
    recentDialogues: [],
    customRules: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Scans Chinese source text for entities recorded in memory.
 * Sorts candidates by Chinese character length descending to prevent
 * shorter substrings from stealing match precedence (e.g. "林动" vs "林动天").
 * Also matches entity aliases (tên gọi tắt) — khi source chứa '苏叶' và entity
 * chính là '阮苏叶' với aliases=['苏叶'], entity chính vẫn được trả về.
 */
export function scanMatchingEntities(
  memory: StoryMemory,
  sourceText: string,
): StoryEntity[] {
  if (!memory?.entities?.length || !sourceText) return [];

  const normalizedSource = sourceText.normalize('NFC');
  const sortedEntities = [...memory.entities].sort(
    (a, b) => (b.chinese?.length ?? 0) - (a.chinese?.length ?? 0),
  );

  const matched: StoryEntity[] = [];
  const seenIds = new Set<string>();

  for (const entity of sortedEntities) {
    if (!entity.chinese || seenIds.has(entity.id)) continue;

    // Khớp theo tên chính hoặc bất kỳ alias nào
    const directMatch = normalizedSource.includes(entity.chinese);
    const aliasMatch = entity.aliases?.some((alias) => normalizedSource.includes(alias)) ?? false;

    if (directMatch || aliasMatch) {
      matched.push(entity);
      seenIds.add(entity.id);
    }
  }

  return matched;
}


/**
 * Retrieves character relationship and pronoun rules relevant to the matched entities.
 */
export function getRelevantRelations(
  memory: StoryMemory,
  matchedEntities: readonly StoryEntity[],
): CharacterRelation[] {
  if (!memory?.relations?.length || !matchedEntities.length) return [];

  const matchedNames = new Set<string>();
  for (const entity of matchedEntities) {
    if (entity.chinese) matchedNames.add(entity.chinese.trim());
    if (entity.vietnamese) matchedNames.add(entity.vietnamese.trim().toLowerCase());
  }

  return memory.relations.filter((relation) => {
    const src = relation.sourceCharacter?.trim();
    const tgt = relation.targetCharacter?.trim();
    if (!src || !tgt) return false;

    const srcMatch = matchedNames.has(src) || matchedNames.has(src.toLowerCase());
    const tgtMatch = matchedNames.has(tgt) || matchedNames.has(tgt.toLowerCase());
    return srcMatch || tgtMatch;
  });
}

/**
 * Formats dynamic living memory into a structured, high-priority instruction block
 * for the translation prompt envelope.
 */
export function formatStoryMemoryForPrompt(
  memory: StoryMemory,
  sourceText: string,
  options?: {
    maxEntities?: number;
    maxRecentDialogues?: number;
    genre?: string;
  },
): string {
  if (!memory) return '';

  const matchedEntities = scanMatchingEntities(memory, sourceText);
  const relevantRelations = getRelevantRelations(memory, matchedEntities);
  const maxEntities = options?.maxEntities ?? 40;
  const maxDialogues = options?.maxRecentDialogues ?? 2;

  const sections: string[] = [];

  // 1. Matched Proper Nouns & Entities
  if (matchedEntities.length > 0) {
    const limitedEntities = matchedEntities.slice(0, maxEntities);
    const entityLines = limitedEntities.map((entity) => {
      const details: string[] = [];
      if (entity.gender === 'male') details.push('Nam');
      else if (entity.gender === 'female') details.push('Nữ');
      if (entity.narrationPronoun) details.push(`Đại từ dẫn truyện: "${entity.narrationPronoun}"`);
      if (entity.role) details.push(entity.role);
      if (entity.category === 'location') details.push('Địa danh');
      else if (entity.category === 'faction') details.push('Tông môn/Thế lực');
      else if (entity.category === 'cultivation') details.push('Cảnh giới/Công pháp');
      else if (entity.category === 'term') details.push('Thuật ngữ');
      if (entity.notes) details.push(entity.notes);

      const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
      return `- ${entity.chinese} -> ${entity.vietnamese}${detailStr}`;
    });

    sections.push(
      `QUY ƯỚC TÊN RIÊNG & THUẬT NGỮ CÓ TRONG ĐOẠN NÀY (BẮT BUỘC DỊCH ĐÚNG NHƯ SAU):\n${entityLines.join('\n')}`,
    );

    // Phát hiện tên gọi tắt/hậu tố có thể ứng với 2+ nhân vật cùng xuất hiện trong đoạn
    const ambigHints: string[] = [];
    for (const entity of limitedEntities) {
      if (entity.ambiguousAliasOf) {
        for (const alias of entity.ambiguousAliasOf) {
          if (sourceText.includes(alias)) {
            const candidates = limitedEntities.filter(
              (e) => e.chinese.endsWith(alias) || e.aliases?.includes(alias) || e.ambiguousAliasOf?.includes(alias),
            );
            if (candidates.length > 1) {
              const names = candidates.map((c) => `${c.chinese} -> ${c.vietnamese}`).join(' HOẶC ');
              const hint = `- Tên gọi tắt "${alias}" trong đoạn này có thể là ${names}. Hãy căn cứ ngữ cảnh để phân biệt; giữ nguyên đại từ/tên gọi tắt phù hợp theo bản gốc.`;
              if (!ambigHints.includes(hint)) ambigHints.push(hint);
            }
          }
        }
      }
    }
    if (ambigHints.length > 0) {
      sections.push(
        `LƯU Ý PHÂN BIỆT NHÂN VẬT GỌI TẮT TRÙNG NHAU:\n${ambigHints.join('\n')}`,
      );
    }
  }

  // 2. Character Pronoun & Relationship Rules
  if (relevantRelations.length > 0) {
    const relationLines = relevantRelations.map((rel) => {
      if (rel.directionalAddress) {
        const dir = rel.directionalAddress;
        return `- ${rel.sourceCharacter} -> ${rel.targetCharacter}: Tự xưng "${dir.aToB.self}", gọi đối phương "${dir.aToB.call}"\n- ${rel.targetCharacter} -> ${rel.sourceCharacter}: Tự xưng "${dir.bToA.self}", gọi đối phương "${dir.bToA.call}"`;
      }
      const tone = rel.toneInstruction
        ? ` | Lưu ý cảm xúc: ${rel.toneInstruction}`
        : '';
      return `- ${rel.sourceCharacter} x ${rel.targetCharacter} [${rel.relationType}]: Xưng hô chuẩn "${rel.pronounSample}"${tone}`;
    });

    sections.push(
      `QUY ƯỚC QUAN HỆ & XƯNG HÔ Ở GIAI ĐOẠN HIỆN TẠI:\n${relationLines.join(
        '\n',
      )}\n* NGUYÊN TẮC LINH HOẠT TÂM LÝ: Giữ đúng ngôi xưng mặc định khi bình thường; khi nhân vật cãi vã, tức giận, đối đầu hoặc cần ẩn giấu thân phận thì tự động chuyển ngôi xưng (ngươi - ta, các hạ) cho tự nhiên và đúng cảm xúc ngữ cảnh.`,
    );
  }

  // 3. Matched Genre Glossary Terms (e.g. 生产队, 知青, 供销社...)
  const genreId = options?.genre || memory.genre || 'period';
  const profile = getGenreProfile(genreId);
  const matchedGlossary: string[] = [];
  if (profile?.glossary?.length) {
    const existingChinese = new Set(memory.entities?.map((e) => e.chinese) || []);
    for (const item of profile.glossary) {
      if (sourceText.includes(item.chinese) && !existingChinese.has(item.chinese)) {
        matchedGlossary.push(`- ${item.chinese} -> ${item.vietnamese}`);
      }
    }
  }
  if (matchedGlossary.length > 0) {
    sections.push(
      `THUẬT NGỮ THỂ LOẠI / NIÊN ĐẠI TRONG ĐOẠN (BẮT BUỘC DỊCH ĐÚNG NHƯ SAU):\n${matchedGlossary.join('\n')}`,
    );
  }

  // 4. Custom Story Rules
  if (memory.customRules?.length) {
    sections.push(
      `QUY TẮC ĐẶC BIỆT CỦA BỘ TRUYỆN:\n${memory.customRules
        .map((r) => `- ${r}`)
        .join('\n')}`,
    );
  }

  // 5. Recent Dialogue Horizon (Few-shot dialogue tone memory)
  if (memory.recentDialogues?.length) {
    const recent = memory.recentDialogues.slice(-maxDialogues);
    const dialogueLines = recent.map((d) => d.snippet.trim()).filter(Boolean);
    if (dialogueLines.length > 0) {
      sections.push(
        `MẪU ĐỐI THOẠI GẦN NHẤT ĐÃ DỊCH (THAM KHẢO VĂN PHONG VÀ KHÍ CHẤT):\n${dialogueLines
          .map((d) => `"${d}"`)
          .join('\n')}`,
      );
    }
  }

  return sections.join('\n\n');
}

export { extractRecentDialogues } from './storyMemoryExtractor.js';

/**
 * Rigorously cleanses and synchronizes a StoryMemory object:
 * 1. Purges any blacklisted common nouns, figurative tropes, or meteorological words.
 * 2. Re-categorizes geographic locations, administrative regions, and architectural terms
 *    to 'location' (and strips any residual gender).
 * 3. Removes gender from any non-character entities.
 * 4. Resolves gender for characters whose gender was recorded as 'unknown' or undefined.
 * 5. Cleans invalid aliases.
 */
export function sanitizeStoryMemory(memory: StoryMemory): StoryMemory {
  if (!memory) return createEmptyStoryMemory();

  const sanitized: StoryMemory = {
    ...memory,
    updatedAt: memory.updatedAt || new Date().toISOString(),
  };

  if (Array.isArray(memory.entities)) {
    const cleanedEntities: StoryEntity[] = [];
    for (const ent of memory.entities) {
      const zh = ent.chinese?.trim();
      if (!zh) continue;

      // 1. Purge blacklisted common nouns, state words, food, vehicles, slogans, and invalid fragments
      if (
        COMMON_NOUN_BLACKLIST.has(zh) ||
        (ent.category === 'character' && INVALID_NAME_ENDINGS.has(zh[zh.length - 1]!)) ||
        INVALID_NAME_PREFIXES.some((p) => zh.startsWith(p))
      ) {
        continue;
      }

      // Purge run-on strings of character Shu Shu (e.g. 舒舒畢業, 舒舒跟, 舒舒要, 舒舒自, 舒舒的小)
      if (zh.startsWith('舒舒') && zh.length > 2) {
        continue;
      }

      // Purge community collective wrongly saved as individual character
      if (zh === '全村村民' && ent.category === 'character') {
        continue;
      }

      // Purge invalid faction
      if ((zh === '房子都會' || zh === '房子都会') && ent.category === 'faction') {
        continue;
      }

      const copy: StoryEntity = {
        ...ent,
        chinese: zh,
        vietnamese: ent.vietnamese?.trim() || '',
      };

      // 2. Classify geographic directions, regions, cities, provinces, architectures
      if (
        DIRECTIONS_AND_REGIONS.has(zh) ||
        URBAN_ARCHITECTURAL_LOCATIONS.has(zh)
      ) {
        copy.category = 'location';
        delete copy.gender;
      } else if (
        copy.category === 'cultivation' &&
        (!isCultivationGenre(memory.genre) || (isChineseSurname(zh) && zh.length >= 2 && zh.length <= 4))
      ) {
        // Misclassified cultivation in non-cultivation genres or person names starting with Chinese surname
        copy.category = 'character';
      }

      if (copy.category !== 'character') {
        // Any non-character should never have gender
        delete copy.gender;
      } else {
        // Character: Fix specific misattributed roles for pillar characters
        if (zh === '晏梓安') {
          copy.gender = 'male';
          copy.role = 'Thanh mai trúc mã của Thư Thư (nam chính)';
        } else if (zh === '陳大飛' || zh === '陈大飞') {
          copy.gender = 'male';
          copy.role = 'Con trai cả của Trương tẩu tử (thanh niên trong thôn)';
        } else if (zh === '鄒芳芬' || zh === '邹芳芬') {
          copy.gender = 'female';
          copy.role = 'Vợ Trưởng thôn';
        } else if (zh === '陳振興' || zh === '陈振兴') {
          copy.gender = 'male';
          copy.role = 'Con trai thứ của Trưởng thôn và Trâu Phương Phân';
        } else if (zh === '鄭東林' || zh === '郑东林') {
          copy.gender = 'male';
          copy.role = 'Cậu bé 4 tuổi trong thôn (bạn của Thư Thư)';
        } else if (zh === '張姨' || zh === '张姨') {
          copy.gender = 'female';
          copy.role = 'Người phụ nữ trong thôn';
        } else if (zh === '晏德正') {
          copy.gender = 'male';
          copy.role = 'Ông nội của Yến Tử An';
        } else if (zh === '劉二妞' || zh === '刘二妞') {
          copy.gender = 'female';
          copy.role = 'Con gái thứ hai của Lưu Thạch Đầu và Trần Diệp Phương (Lưu Mẫn Tuệ)';
        } else if (zh === '陳大糧' || zh === '陈大粮') {
          copy.gender = 'male';
          copy.role = 'Con trai của Trương tẩu tử';
        } else {
          // Normalize invalid contradictory roles
          if (copy.gender === 'male' && copy.role === 'Cô bé trong thôn') {
            delete copy.role;
          }
          if (copy.gender === 'female' && copy.role === 'Cậu bé trong thôn') {
            delete copy.role;
          }
          if (copy.gender === 'male' && copy.role === 'Vợ') {
            delete copy.role;
          }
          if (copy.gender === 'female' && copy.role === 'Chồng') {
            delete copy.role;
          }
          if (copy.role && (copy.role.includes('Tên Là Gì') || copy.role.includes('của Tên'))) {
            delete copy.role;
          }
        }

        // Detect gender if unknown
        if (!copy.gender || copy.gender === 'unknown') {
          const detected = detectCharacterGender(zh, copy.vietnamese, '', '', copy.role);
          if (detected !== 'unknown') {
            copy.gender = detected;
          }
        }
      }

      // 3. Filter aliases
      if (copy.aliases?.length) {
        copy.aliases = copy.aliases.filter(
          (a) => a && !COMMON_NOUN_BLACKLIST.has(a.trim()),
        );
        if (copy.aliases.length === 0) delete copy.aliases;
      }

      cleanedEntities.push(copy);
    }
    sanitized.entities = cleanedEntities;
  }

  return sanitized;
}

function normalizeVnName(text: string): string {
  return text.trim().toLowerCase().normalize('NFC').replace(/[\s\-_]+/g, ' ');
}

/**
 * Merges updated entities and relations into existing story memory cleanly without duplicates.
 */
export function mergeStoryMemory(
  existing: StoryMemory,
  incoming: Partial<StoryMemory>,
): StoryMemory {
  const sanitizedExisting = sanitizeStoryMemory(existing);
  const merged: StoryMemory = {
    ...sanitizedExisting,
    updatedAt: new Date().toISOString(),
  };

  if (incoming.storyTitle) merged.storyTitle = incoming.storyTitle;
  if (incoming.genre) merged.genre = incoming.genre;

  if (incoming.entities?.length) {
    const entityMap = new Map<string, StoryEntity>();
    const vnNameMap = new Map<string, string>(); // normVn -> chineseKey

    for (const e of existing.entities || []) {
      const key = e.chinese.trim();
      entityMap.set(key, e);
      if (e.vietnamese?.trim()) {
        vnNameMap.set(normalizeVnName(e.vietnamese), key);
      }
    }

    for (const e of incoming.entities) {
      const key = e.chinese?.trim();
      if (!key) continue;

      // 1. Try finding existing entity by exact Chinese key
      let prevKey = key;
      let prev = entityMap.get(key);

      // 2. Try finding existing entity by Simplified Chinese equivalence (e.g. 陳大飛 <=> 陈大飞)
      if (!prev) {
        const sKey = sify(key);
        for (const [existingKey, existingEnt] of entityMap.entries()) {
          if (sify(existingKey) === sKey) {
            prevKey = existingKey;
            prev = existingEnt;
            break;
          }
        }
      }

      // 3. If not found by Chinese, try finding by normalized Vietnamese name
      // This immediately connects Traditional (陳大飛) to Simplified (陈大飞)
      if (!prev && e.vietnamese?.trim()) {
        const normVn = normalizeVnName(e.vietnamese);
        const matchedKey = vnNameMap.get(normVn);
        if (matchedKey) {
          prevKey = matchedKey;
          prev = entityMap.get(matchedKey);
        }
      }

      if (prev) {
        const existingAliases = prev.aliases ?? [];
        const incomingAliases = e.aliases ?? [];
        const extraAliases = key !== prevKey ? [key] : [];
        const mergedAliases = Array.from(new Set([...existingAliases, ...incomingAliases, ...extraAliases]));

        entityMap.set(prevKey, {
          ...prev,
          category: prev.category || e.category || 'character',
          vietnamese: e.vietnamese?.trim() || prev.vietnamese || '',
          gender: e.gender || prev.gender,
          role: e.role || prev.role,
          notes: e.notes || prev.notes,
          milestoneChapter: e.milestoneChapter ?? prev.milestoneChapter,
          aliases: mergedAliases.length > 0 ? mergedAliases : undefined,
        });
      } else {
        entityMap.set(key, {
          id: e.id || `ent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          category: e.category || 'character',
          chinese: key,
          vietnamese: e.vietnamese?.trim() || '',
          gender: e.gender,
          role: e.role,
          notes: e.notes,
          milestoneChapter: e.milestoneChapter,
          aliases: e.aliases,
        });
        if (e.vietnamese?.trim()) {
          vnNameMap.set(normalizeVnName(e.vietnamese), key);
        }
      }
    }

    // Giữ nguyên toàn bộ thực thể do ChatGPT trả về hoặc do người dùng tạo,
    // tuyệt đối không tự ý gộp, nuốt hoặc gán alias cướp tên của nhau.
    merged.entities = Array.from(entityMap.values());
  }

  if (incoming.relations?.length) {
    const relationMap = new Map<string, CharacterRelation>();
    for (const r of existing.relations || []) {
      const key = `${r.sourceCharacter.trim()}_x_${r.targetCharacter.trim()}`;
      relationMap.set(key, r);
    }
    for (const r of incoming.relations) {
      const key = `${r.sourceCharacter?.trim()}_x_${r.targetCharacter?.trim()}`;
      if (!r.sourceCharacter || !r.targetCharacter) continue;
      const prev = relationMap.get(key);
      relationMap.set(key, {
        id: prev?.id || r.id || `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sourceCharacter: r.sourceCharacter.trim(),
        targetCharacter: r.targetCharacter.trim(),
        relationType: r.relationType || prev?.relationType || 'Bằng hữu',
        pronounSample: r.pronounSample || prev?.pronounSample || 'Ngươi - Ta',
        directionalAddress: r.directionalAddress || prev?.directionalAddress,
        toneInstruction: r.toneInstruction || prev?.toneInstruction,
        milestoneChapter: r.milestoneChapter ?? prev?.milestoneChapter,
      });
    }
    merged.relations = Array.from(relationMap.values());
  }

  if (incoming.customRules?.length) {
    const set = new Set([...(existing.customRules || []), ...incoming.customRules]);
    merged.customRules = Array.from(set);
  }

  if (incoming.recentDialogues?.length) {
    const allDialogues = [
      ...(existing.recentDialogues || []),
      ...incoming.recentDialogues,
    ];
    // Keep only the most recent 10 snippets
    merged.recentDialogues = allDialogues.slice(-10);
  }

  return sanitizeStoryMemory(merged);
}
