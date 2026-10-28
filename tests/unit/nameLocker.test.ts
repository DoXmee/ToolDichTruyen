import { describe, expect, it } from 'vitest';
import {
  batchRenameInTranslation,
  inspectNameLocks,
  lockNamesInSource,
  unlockNamesInTranslation,
} from '../../src/core/nameLocker';

describe('nameLocker module', () => {
  it('locks names using longest match first to avoid partial replacement', () => {
    const source = '顾国强看着顾国强的大儿子顾谨书，对沈玉兰说了一句话。';
    const entities = [
      { chinese: '国强', vietnamese: 'Quốc Cường' },
      { chinese: '顾国强', vietnamese: 'Cố Quốc Cường' },
      { chinese: '顾谨书', vietnamese: 'Cố Cẩn Thư' },
      { chinese: '沈玉兰', vietnamese: 'Thẩm Ngọc Lan' },
    ];

    const result = lockNamesInSource(source, entities);

    // "顾国强" must be replaced with ⟦Cố Quốc Cường⟧, not 顾⟦Quốc Cường⟧
    expect(result.lockedSourceText).toBe(
      '⟦Cố Quốc Cường⟧看着⟦Cố Quốc Cường⟧的大儿子⟦Cố Cẩn Thư⟧，对⟦Thẩm Ngọc Lan⟧说了一句话。',
    );
    expect(result.lockedCount).toBe(4);
    expect(result.lockedEntities.map((e) => e.chinese)).toEqual([
      '顾国强',
      '顾谨书',
      '沈玉兰',
    ]);
  });

  it('skips ambiguous entities and keeps them as raw Chinese', () => {
    const source = '小强走了过来。';
    const entities = [
      { chinese: '小强', vietnamese: 'Tiểu Cường', ambiguous: true },
    ];

    const result = lockNamesInSource(source, entities);
    expect(result.lockedSourceText).toBe('小强走了过来。');
    expect(result.lockedCount).toBe(0);
  });

  it('unlocks bracketed names and trims accidental inner whitespace', () => {
    const translation =
      '⟦Cố Quốc Cường⟧ nhìn ⟦ Cố Cẩn Thư ⟧, sau đó nói với ⟦  Thẩm Ngọc Lan  ⟧ một câu.';
    const unlocked = unlockNamesInTranslation(translation);

    expect(unlocked).toBe(
      'Cố Quốc Cường nhìn Cố Cẩn Thư, sau đó nói với Thẩm Ngọc Lan một câu.',
    );
  });

  it('inspects translation for unclosed brackets', () => {
    const valid = '⟦Cố Quốc Cường⟧ và ⟦Thẩm Ngọc Lan⟧';
    const invalid = '⟦Cố Quốc Cường và ⟦Thẩm Ngọc Lan⟧';

    expect(inspectNameLocks(valid, ['⟦Cố Quốc Cường⟧', '⟦Thẩm Ngọc Lan⟧'])).toEqual([]);
    const issues = inspectNameLocks(invalid, ['⟦Cố Quốc Cường⟧', '⟦Thẩm Ngọc Lan⟧']);
    expect(issues.length).toBe(1);
    expect(issues[0]?.code).toBe('unclosed_lock');
  });

  it('batch renames old name to new name across already-translated text without re-translation', () => {
    const oldText = 'Cố Quốc Cường dẫn theo Cố Cẩn Thư đi làm.';
    const updated = batchRenameInTranslation(oldText, 'Cố Quốc Cường', 'Cố Đại Cường');

    expect(updated).toBe('Cố Đại Cường dẫn theo Cố Cẩn Thư đi làm.');
  });

  it('automatically locks Traditional Chinese names in source when entity registered in Simplified (and vice versa)', () => {
    // Entities registered in Simplified Chinese
    const entities = [
      { chinese: '陈翠英', vietnamese: 'Trần Thúy Anh' },
      { chinese: '邹芳芬', vietnamese: 'Trâu Phương Phân' },
      { chinese: '刘大户', vietnamese: 'Lưu Đại Hộ' },
    ];

    // Source novel has Traditional Chinese
    const traditionalSource = '“前面的熱鬧是怎麼回事？”鄒芳芬好奇地問。陳翠英伸長脖子看著劉大戶家。';
    const result = lockNamesInSource(traditionalSource, entities);

    expect(result.lockedSourceText).toBe(
      '“前面的熱鬧是怎麼回事？”⟦Trâu Phương Phân⟧好奇地問。⟦Trần Thúy Anh⟧伸長脖子看著⟦Lưu Đại Hộ⟧家。',
    );
    expect(result.lockedCount).toBe(3);
  });

  it('Safe Alias Guard prevents relationship sub-entities and teams from hijacking parent terms', () => {
    const source = '村長走進來，身後跟着村長妻子。另外，豐揚村的村民們也來了。';
    const entities = [
      {
        chinese: '村長妻子',
        vietnamese: 'Vợ Trưởng Thôn',
        aliases: ['村長'], // DANGEROUS ALIAS: drops relationship qualifier "妻子"
      },
      {
        chinese: '豐揚村小小孩分隊',
        vietnamese: 'Đội Trẻ Nhỏ Thôn Phong Dương',
        aliases: ['豐揚村'], // DANGEROUS ALIAS: drops team qualifier "小小孩分隊"
      },
    ];

    const result = lockNamesInSource(source, entities);

    // "村長" at the beginning must NOT be replaced with "Vợ Trưởng Thôn"
    // "豐揚村" must NOT be replaced with "Đội Trẻ Nhỏ"
    // Only exact matches "村長妻子" can be replaced
    expect(result.lockedSourceText).toBe(
      '村長走進來，身後跟着⟦Vợ Trưởng Thôn⟧。另外，豐揚村的村民們也來了。',
    );
    expect(result.lockedCount).toBe(1);
    expect(result.lockedEntities.map((e) => e.chinese)).toEqual(['村長妻子']);
  });

  it('unlocks bracketed names and automatically inserts word boundary space to prevent sticky words', () => {
    const rawAiOutput = 'Lúc này, Tống⟦Thư Thư⟧cũng bước tới và nói: "⟦Thư Thư⟧rất thích món này."';
    const unlocked = unlockNamesInTranslation(rawAiOutput);

    // "Tống⟦Thư Thư⟧" -> "Tống Thư Thư" (space between Tống and Thư)
    // "⟦Thư Thư⟧cũng" -> "Thư Thư cũng" (space between Thư and cũng)
    // "⟦Thư Thư⟧rất" -> "Thư Thư rất" (space between Thư and rất)
    expect(unlocked).toBe(
      'Lúc này, Tống Thư Thư cũng bước tới và nói: "Thư Thư rất thích món này."',
    );
  });

  it('correctly locks co-existing full Chinese names, shortened given names and nicknames without prefix collisions', () => {
    const source = '李學剛让剛子去见吳秀麗和秀麗，安然也跟着李安然一起。';
    const entities = [
      { chinese: '吳秀麗', vietnamese: 'Ngô Tú Lệ' },
      { chinese: '秀麗', vietnamese: 'Tú Lệ' },
      { chinese: '李學剛', vietnamese: 'Lý Học Cương' },
      { chinese: '剛子', vietnamese: 'Cương Tử' },
      { chinese: '李安然', vietnamese: 'Lý An Nhiên' },
      { chinese: '安然', vietnamese: 'An Nhiên' },
    ];

    const result = lockNamesInSource(source, entities);
    expect(result.lockedSourceText).toBe(
      '⟦Lý Học Cương⟧让⟦Cương Tử⟧去见⟦Ngô Tú Lệ⟧和⟦Tú Lệ⟧，⟦An Nhiên⟧也跟着⟦Lý An Nhiên⟧一起。',
    );
    expect(result.lockedCount).toBe(6);
  });
});
