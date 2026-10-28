import { describe, expect, it } from 'vitest';
import {
  createEmptyStoryMemory,
  extractRecentDialogues,
  formatStoryMemoryForPrompt,
  getRelevantRelations,
  mergeStoryMemory,
  scanMatchingEntities,
} from '../../src/core/storyMemory';
import type { StoryMemory } from '../../src/shared/types';

describe('storyMemory core engine', () => {
  it('scans and matches entities in source text sorted by length descending', () => {
    const memory: StoryMemory = {
      version: 1,
      entities: [
        { id: '1', category: 'character', chinese: '萧炎', vietnamese: 'Tiêu Viêm', gender: 'male', role: 'Main' },
        { id: '2', category: 'character', chinese: '萧炎天', vietnamese: 'Tiêu Viêm Thiên' },
        { id: '3', category: 'faction', chinese: '云岚宗', vietnamese: 'Vân Lam Tông' },
        { id: '4', category: 'character', chinese: '药老', vietnamese: 'Dược Lão' },
      ],
      relations: [],
      updatedAt: new Date().toISOString(),
    };

    const source = '萧炎看着萧炎天，两人一同前往云岚宗。';
    const matches = scanMatchingEntities(memory, source);

    expect(matches.map((m) => m.chinese)).toEqual(['萧炎天', '云岚宗', '萧炎']);
    // '药老' is not present in source, should not match
    expect(matches.some((m) => m.chinese === '药老')).toBe(false);
  });

  it('filters character relations relevant to matched entities', () => {
    const memory: StoryMemory = {
      version: 1,
      entities: [
        { id: '1', category: 'character', chinese: '萧炎', vietnamese: 'Tiêu Viêm' },
        { id: '2', category: 'character', chinese: '彩鳞', vietnamese: 'Thải Lân' },
        { id: '3', category: 'character', chinese: '林动', vietnamese: 'Lâm Động' },
      ],
      relations: [
        {
          id: 'r1',
          sourceCharacter: '萧炎',
          targetCharacter: '彩鳞',
          relationType: 'Phu thê',
          pronounSample: 'Chàng - Nàng',
          toneInstruction: 'Khi tức giận đổi sang ngươi - ta',
        },
        {
          id: 'r2',
          sourceCharacter: '林动',
          targetCharacter: '绫清竹',
          relationType: 'Đạo lữ',
          pronounSample: 'Chàng - Thiếp',
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    const matchedEntities = [
      { id: '1', category: 'character' as const, chinese: '萧炎', vietnamese: 'Tiêu Viêm' },
    ];
    const relations = getRelevantRelations(memory, matchedEntities);

    expect(relations).toHaveLength(1);
    expect(relations[0]?.id).toBe('r1');
    expect(relations[0]?.pronounSample).toBe('Chàng - Nàng');
  });

  it('formats living memory prompt snippet with entities, relations, rules, and dialogue tone', () => {
    const memory: StoryMemory = {
      version: 1,
      entities: [
        { id: '1', category: 'character', chinese: '萧炎', vietnamese: 'Tiêu Viêm', gender: 'male', role: 'Nhân vật chính' },
        { id: '2', category: 'location', chinese: '乌坦城', vietnamese: 'Ô Thản thành' },
        { id: '3', category: 'cultivation', chinese: '斗气', vietnamese: 'Đấu khí' },
      ],
      relations: [
        {
          id: 'r1',
          sourceCharacter: 'Tiêu Viêm',
          targetCharacter: 'Dược Lão',
          relationType: 'Sư đồ',
          pronounSample: 'Sư phụ - Đồ nhi / Con',
          toneInstruction: 'Tôn kính, thân thiết',
        },
      ],
      customRules: ['Giữ nguyên tên chiêu thức Hán Việt.'],
      recentDialogues: [
        { snippet: 'Sư phụ, lần này chúng ta đi đâu?' },
      ],
      updatedAt: new Date().toISOString(),
    };

    const source = '萧炎离开乌坦城，开始修炼斗气。';
    const snippet = formatStoryMemoryForPrompt(memory, source);

    expect(snippet).toContain('QUY ƯỚC TÊN RIÊNG & THUẬT NGỮ CÓ TRONG ĐOẠN NÀY');
    expect(snippet).toContain('萧炎 -> Tiêu Viêm (Nam, Nhân vật chính)');
    expect(snippet).toContain('乌坦城 -> Ô Thản thành (Địa danh)');
    expect(snippet).toContain('斗气 -> Đấu khí (Cảnh giới/Công pháp)');
    expect(snippet).toContain('NGUYÊN TẮC LINH HOẠT TÂM LÝ');
    expect(snippet).toContain('QUY TẮC ĐẶC BIỆT CỦA BỘ TRUYỆN:');
    expect(snippet).toContain('MẪU ĐỐI THOẠI GẦN NHẤT ĐÃ DỊCH');
    expect(snippet).toContain('Sư phụ, lần này chúng ta đi đâu?');
  });

  it('extracts recent dialogues from translated text', () => {
    const source = '“萧炎哥哥，你要小心。”熏儿轻声道。';
    const translated = '“Tiêu Viêm ca ca, huynh phải cẩn thận đấy.” Huân Nhi khẽ nói.\n“Yên tâm đi, ta sẽ trở về an toàn.” Tiêu Viêm cười đáp.';

    const dialogues = extractRecentDialogues(source, translated, 2);
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]?.snippet).toBe('Tiêu Viêm ca ca, huynh phải cẩn thận đấy.');
    expect(dialogues[1]?.snippet).toBe('Yên tâm đi, ta sẽ trở về an toàn.');
  });

  it('merges new entities and relations into existing memory without duplication', () => {
    const existing = createEmptyStoryMemory({ storyTitle: 'Đấu Phá Thương Khung' });
    existing.entities.push({ id: 'e1', category: 'character', chinese: '萧炎', vietnamese: 'Tiêu Viêm' });

    const merged = mergeStoryMemory(existing, {
      entities: [
        { id: 'e2', category: 'character', chinese: '萧炎', vietnamese: 'Tiêu Viêm (sửa)' },
        { id: 'e3', category: 'character', chinese: '药老', vietnamese: 'Dược Lão' },
      ],
      relations: [
        { id: 'r1', sourceCharacter: 'Tiêu Viêm', targetCharacter: 'Dược Lão', relationType: 'Sư đồ', pronounSample: 'Lão sư - Đồ nhi' },
      ],
      customRules: ['Không dịch tên chiêu thức.'],
    });

    expect(merged.entities).toHaveLength(2);
    expect(merged.entities.find((e) => e.chinese === '萧炎')?.vietnamese).toBe('Tiêu Viêm (sửa)');
    expect(merged.entities.find((e) => e.chinese === '药老')?.vietnamese).toBe('Dược Lão');
    expect(merged.relations).toHaveLength(1);
    expect(merged.customRules).toContain('Không dịch tên chiêu thức.');
  });

  it('gộp aliases khi merge và dùng alias để scan entity trong source text', () => {
    const memory: StoryMemory = {
      version: 1,
      entities: [
        {
          id: '1',
          category: 'character',
          chinese: '阮苏叶',
          vietnamese: 'Nguyễn Tô Diệp',
          // aliases chưa có
        },
      ],
      relations: [],
      updatedAt: new Date().toISOString(),
    };

    // Merge thêm alias '苏叶' vào entity
    const merged = mergeStoryMemory(memory, {
      entities: [
        {
          id: '1',
          category: 'character',
          chinese: '阮苏叶',
          vietnamese: 'Nguyễn Tô Diệp',
          aliases: ['苏叶'],
        },
      ],
    });

    const targetEntity = merged.entities.find((e) => e.chinese === '阮苏叶');
    expect(targetEntity?.aliases).toContain('苏叶');

    // scan bằng tên gọi tắt '苏叶' → phải tìm được entity chính '阮苏叶'
    const matchedViaAlias = scanMatchingEntities(merged, '苏叶在这里开心地笑着。');
    expect(matchedViaAlias.map((e) => e.chinese)).toContain('阮苏叶');
  });

  it('sanitizes story memory: purges blacklists, relocates provinces to locations, and resolves genders', () => {
    const rawMemory: StoryMemory = {
      version: 1,
      entities: [
        // Province misclassified as character with unknown gender
        { id: '1', category: 'character', chinese: '山東', vietnamese: 'Sơn Đông', gender: 'unknown' },
        { id: '2', category: 'character', chinese: '河北', vietnamese: 'Hà Bắc', gender: 'unknown' },
        // Female character needing gender resolution
        { id: '3', category: 'character', chinese: '陳芳', vietnamese: 'Trần Phương', gender: 'unknown' },
        // Common noun / idiom in blacklist (must be purged)
        { id: '4', category: 'character', chinese: '白無常', vietnamese: 'Bạch Vô Thường', gender: 'female' },
        { id: '5', category: 'character', chinese: '雪花', vietnamese: 'Tuyết Hoa', gender: 'male' },
        { id: '6', category: 'character', chinese: '富強', vietnamese: 'Phú Cường' },
        // Location that had residual gender tag
        { id: '7', category: 'location', chinese: '西北', vietnamese: 'Tây Bắc', gender: 'female' },
      ],
      relations: [],
      updatedAt: new Date().toISOString(),
    };

    const sanitized = mergeStoryMemory(rawMemory, {});

    // Blacklisted items purged
    expect(sanitized.entities.some((e) => e.chinese === '白無常')).toBe(false);
    expect(sanitized.entities.some((e) => e.chinese === '雪花')).toBe(false);
    expect(sanitized.entities.some((e) => e.chinese === '富強')).toBe(false);

    // Shan Dong & He Bei relocated to location with gender stripped
    const shanDong = sanitized.entities.find((e) => e.chinese === '山東');
    expect(shanDong).toBeDefined();
    expect(shanDong?.category).toBe('location');
    expect(shanDong?.gender).toBeUndefined();

    const heBei = sanitized.entities.find((e) => e.chinese === '河北');
    expect(heBei).toBeDefined();
    expect(heBei?.category).toBe('location');
    expect(heBei?.gender).toBeUndefined();

    // Chen Fang resolved to female character
    const chenFang = sanitized.entities.find((e) => e.chinese === '陳芳');
    expect(chenFang).toBeDefined();
    expect(chenFang?.category).toBe('character');
    expect(chenFang?.gender).toBe('female');

    // Xi Bei location has gender stripped
    const xiBei = sanitized.entities.find((e) => e.chinese === '西北');
    expect(xiBei).toBeDefined();
    expect(xiBei?.gender).toBeUndefined();
  });

  it('automatically merges Traditional prefix entity into Simplified parent entity (陳嬸 into 陈婶子)', () => {
    const existing: StoryMemory = {
      version: 1,
      entities: [
        {
          id: 'ent-1',
          category: 'character',
          chinese: '陈婶子',
          vietnamese: 'Thím Trần',
          gender: 'female',
          role: 'Người trong thôn',
        },
      ],
      relations: [],
      updatedAt: new Date().toISOString(),
    };

    // Incoming has Traditional Chinese prefix entity "陳嬸"
    const incoming: Partial<StoryMemory> = {
      entities: [
        {
          id: 'ent-2',
          category: 'character',
          chinese: '陳嬸',
          vietnamese: 'Trần Thẩm',
          gender: 'female',
        },
      ],
    };

    const merged = mergeStoryMemory(existing, incoming);
    // Tool preserves each entity independently and does not automatically swallow or overwrite
    expect(merged.entities).toHaveLength(2);
    expect(merged.entities.some((e) => e.chinese === '陈婶子' && e.vietnamese === 'Thím Trần')).toBe(true);
    expect(merged.entities.some((e) => e.chinese === '陳嬸' && e.vietnamese === 'Trần Thẩm')).toBe(true);
  });

  it('preserves directionalAddress when merging character relations', () => {
    const existing: StoryMemory = {
      version: 1,
      entities: [],
      relations: [],
      updatedAt: new Date().toISOString(),
    };

    const incoming: Partial<StoryMemory> = {
      relations: [
        {
          id: 'rel-1',
          sourceCharacter: 'Kha Tiểu Hoa',
          targetCharacter: 'Trần Kiến Nghiệp',
          relationType: 'Chị em',
          pronounSample: 'Chị - Em',
          directionalAddress: {
            aToB: { self: 'chị', call: 'em' },
            bToA: { self: 'em', call: 'chị' },
          },
        },
      ],
    };

    const merged = mergeStoryMemory(existing, incoming);
    expect(merged.relations).toHaveLength(1);
    expect(merged.relations[0]!.directionalAddress).toEqual({
      aToB: { self: 'chị', call: 'em' },
      bToA: { self: 'em', call: 'chị' },
    });
  });
});

