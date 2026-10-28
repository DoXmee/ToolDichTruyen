import { describe, expect, it } from 'vitest';
import { PERIOD_GENRE_PROFILE } from '../../src/core/genreProfile';
import { compileStoryBiblePrompt } from '../../src/core/promptCompilerV2';
import { createEmptyStoryBible } from '../../src/core/storyBible';

describe('promptCompilerV2 module', () => {
  it('compiles a self-sufficient 8-block prompt with mechanically locked names', () => {
    const bible = createEmptyStoryBible('period');
    bible.entities.push(
      {
        id: 'c1',
        category: 'character',
        zh: '顾国强',
        vi: 'Cố Quốc Cường',
        gender: 'male',
        role: 'Cha',
        narrationPronoun: 'ông',
      },
      {
        id: 'c2',
        category: 'character',
        zh: '沈玉兰',
        vi: 'Thẩm Ngọc Lan',
        gender: 'female',
        role: 'Mẹ',
        narrationPronoun: 'bà',
      },
    );

    bible.relations.push({
      id: 'r1',
      from: 'c1',
      to: 'c2',
      type: 'spouses',
      address: {
        aToB: { self: 'anh', call: 'em', tenseSelf: 'tôi', tenseCall: 'bà' },
        bToA: { self: 'em', call: 'anh', tenseSelf: 'tôi', tenseCall: 'ông' },
      },
    });

    const source = '顾国强看着沈玉兰，两人准备去大队和供销社。';
    const compiled = compileStoryBiblePrompt({
      segmentId: 'segment-1',
      segmentIndex: 0,
      totalSegments: 10,
      sourceText: source,
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
      sceneState: 'normal',
    });

    // Check Block A
    expect(compiled.fullPrompt).toContain('### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC');
    expect(compiled.fullPrompt).toContain('⟦...⟧ BẮT BUỘC PHẢI GIỮ NGUYÊN');

    // Check Block B
    expect(compiled.fullPrompt).toContain('### KHỐI B: THẺ BỐI CẢNH');
    expect(compiled.fullPrompt).toContain('Cố Quốc Cường (顾国强)');
    expect(compiled.fullPrompt).toContain('Thẩm Ngọc Lan (沈玉兰)');

    // Check Block D
    expect(compiled.fullPrompt).toContain('### KHỐI D: QUY ƯỚC NHÂN VẬT & ĐẠI TỪ DẪN TRUYỆN');
    expect(compiled.fullPrompt).toContain('Đại từ dẫn truyện: "ông"');

    // Check Block E
    expect(compiled.fullPrompt).toContain('### KHỐI E: MA TRẬN XƯNG HÔ CÓ HƯỚNG');
    expect(compiled.fullPrompt).toContain('Cố Quốc Cường -> Thẩm Ngọc Lan: Tự xưng "anh", gọi đối phương "em"');

    // Check Block F (matched glossary terms: 大队, 供销社)
    expect(compiled.fullPrompt).toContain('### KHỐI F: THUẬT NGỮ NIÊN ĐẠI TRONG ĐOẠN');
    expect(compiled.matchedGlossaryTerms.map((t) => t.chinese)).toContain('大队');
    expect(compiled.matchedGlossaryTerms.map((t) => t.chinese)).toContain('供销社');

    // Check Block G (mechanically replaced)
    expect(compiled.lockedSourceText).toBe(
      '⟦Cố Quốc Cường⟧看着⟦Thẩm Ngọc Lan⟧，两人准备去大队和供销社。',
    );
    expect(compiled.fullPrompt).toContain(compiled.lockedSourceText);

    // Check Block H
    expect(compiled.fullPrompt).toContain('<BAN_DICH id="segment-1">');
    expect(compiled.fullPrompt).toContain('<THUC_THE_MOI>');
    expect(compiled.fullPrompt).toContain('TUYỆT ĐỐI KHÔNG ĐƯỢC ĐOÁN MÒ');
  });

  it('injects user custom prompt with highest priority when customPrompt is provided', () => {
    const bible = createEmptyStoryBible('custom');
    const userPrompt = 'Dịch giữ phong cách trinh thám u ám, câu văn ngắn gọn sắc bén.';

    const compiled = compileStoryBiblePrompt({
      segmentId: 'segment-1',
      segmentIndex: 0,
      totalSegments: 1,
      sourceText: '今天天气很好。',
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
      customPrompt: userPrompt,
    });

    expect(compiled.fullPrompt).toContain('CHỈ ĐẠO VĂN PHONG RIÊNG TỪ NGƯỜI DÙNG (ƯU TIÊN TUÂN THỦ CAO NHẤT)');
    expect(compiled.fullPrompt).toContain(userPrompt);
  });

  it('keeps prompt strictly within character budget and avoids combinatorial explosion in Khối E', () => {
    const bible = createEmptyStoryBible('period');
    // Add 15 characters
    for (let i = 1; i <= 15; i++) {
      bible.entities.push({
        id: `c${i}`,
        category: 'character',
        zh: `人物${i}`,
        vi: `Nhân vật ${i}`,
        gender: i % 2 === 0 ? 'male' : 'female',
      });
    }
    // Only 1 defined relation
    bible.relations.push({
      id: 'rel1',
      from: 'c1',
      to: 'c2',
      type: 'friends',
      address: {
        aToB: { self: 'tôi', call: 'bạn' },
        bToA: { self: 'tôi', call: 'bạn' },
      },
    });

    const sourceText = Array.from({ length: 15 }, (_, i) => `人物${i + 1}`).join(' và ') + ' cùng ngồi nói chuyện.';
    const compiled = compileStoryBiblePrompt({
      segmentId: 'seg-stress',
      segmentIndex: 0,
      totalSegments: 1,
      sourceText,
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
      maxCharacters: 12_000,
    });

    expect(compiled.characterCount).toBeLessThanOrEqual(12_000);
    expect(compiled.fullPrompt).toContain('### KHỐI E: MA TRẬN XƯNG HÔ CÓ HƯỚNG');
    expect(compiled.fullPrompt).toContain('Nhân vật 1 -> Nhân vật 2');
    // Ensure character pairs without relation were NOT generated
    expect(compiled.fullPrompt).not.toContain('Nhân vật 3 -> Nhân vật 4');
  });

  it('compiles streamlined prompt for continuation turn while preserving all core inviolable rules and entities', () => {
    const bible = createEmptyStoryBible('period');
    bible.entities.push({
      id: 'c1',
      category: 'character',
      zh: '顾国强',
      vi: 'Cố Quốc Cường',
      gender: 'male',
      role: 'Cha',
      narrationPronoun: 'ông',
    });

    const fullCompiled = compileStoryBiblePrompt({
      segmentId: 'segment-1',
      segmentIndex: 0,
      totalSegments: 10,
      sourceText: '顾国强在田里干活。',
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
      isContinuationTurn: false,
    });

    const continuationCompiled = compileStoryBiblePrompt({
      segmentId: 'segment-2',
      segmentIndex: 1,
      totalSegments: 10,
      sourceText: '顾国强在田里干活。',
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
      isContinuationTurn: true,
    });

    // Continuation prompt should be significantly more compact
    expect(continuationCompiled.characterCount).toBeLessThan(fullCompiled.characterCount);

    // But MUST strictly preserve core rules and entities
    expect(continuationCompiled.fullPrompt).toContain('### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC (MỎ NEO CỐT LÕI)');
    expect(continuationCompiled.fullPrompt).toContain('BẢO TOÀN 100% DANH TỪ TRONG NGOẶC ⟦...⟧');
    expect(continuationCompiled.fullPrompt).toContain('QUY ƯỚC TÊN NGOẠI QUỐC: Tên người ngoại quốc');
    expect(continuationCompiled.fullPrompt).toContain('chữ cái Latinh quốc tế chuẩn duy nhất');
    expect(continuationCompiled.fullPrompt).toContain('QUY CHUẨN XƯNG HÔ THUẦN VIỆT TOÀN DIỆN');
    expect(continuationCompiled.fullPrompt).toContain('TUYỆT ĐỐI CẤM giữ nguyên âm Hán-Việt thô: CẤM "Trương Tử", "Kha Tử"');
    expect(continuationCompiled.fullPrompt).toContain('Mẹ Kha Tiểu Hoa BẮT BUỘC gọi là "thím Kha"');
    expect(continuationCompiled.fullPrompt).toContain('bà góa phụ (chồng họ Phương) BẮT BUỘC gọi là "thím Phương"');
    expect(continuationCompiled.fullPrompt).toContain('Cố Quốc Cường');
    expect(continuationCompiled.fullPrompt).toContain('<BAN_DICH id="segment-2">');
    expect(continuationCompiled.fullPrompt).toContain('<THUC_THE_MOI>');
  });

  it('correctly formats foreign character with Latin name and pet-name aliases in Block D and enforces Block H Latin instruction', () => {
    const bible = createEmptyStoryBible('period');
    bible.entities.push({
      id: 'f1',
      category: 'character',
      zh: '耶莲娜',
      vi: 'Jelina',
      gender: 'female',
      role: 'Bạn học người Nga của Thư Thư',
      aliases: [{ zh: '耶莲卡' }],
    });

    const compiled = compileStoryBiblePrompt({
      segmentId: 'segment-foreign',
      segmentIndex: 0,
      totalSegments: 5,
      sourceText: '耶莲卡笑着对舒舒说：“你好！”',
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
    });

    // Block D should recognize the character through alias and output standard Latin name + alias
    expect(compiled.fullPrompt).toContain('### KHỐI D: QUY ƯỚC NHÂN VẬT & ĐẠI TỪ DẪN TRUYỆN');
    expect(compiled.fullPrompt).toContain('- 耶莲娜 -> Jelina [Bí danh/tên gọi khác: 耶莲卡] (Nữ | Vai vế: Bạn học người Nga của Thư Thư)');

    // Block H should explicitly instruct Latin name for foreign characters
    expect(compiled.fullPrompt).toContain('ĐỐI VỚI NHÂN VẬT NGOẠI QUỐC (Phương Tây, Liên Xô/Nga...): BẮT BUỘC ĐIỀN TÊN CHỮ CÁI LATINH QUỐC TẾ CHUẨN DUY NHẤT');
    expect(compiled.fullPrompt).toContain('TUYỆT ĐỐI KHÔNG dùng âm Hán Việt (như Ái Na, Ca Lệ Giai, Giê-lin-ca)');
  });

  it('instructs extraction of unbracketed shortened given names and nicknames in Block H', () => {
    const bible = createEmptyStoryBible('period');
    bible.entities.push({
      id: 'c1',
      category: 'character',
      zh: '吴秀丽',
      vi: 'Ngô Tú Lệ',
      gender: 'female',
      role: 'Chủ tiệm may',
    });

    const compiled = compileStoryBiblePrompt({
      segmentId: 'segment-nicknames',
      segmentIndex: 0,
      totalSegments: 1,
      sourceText: '秀丽和刚子一起回村收米。',
      bible,
      genreProfile: PERIOD_GENRE_PROFILE,
    });

    expect(compiled.fullPrompt).toContain('TÊN GỌI RÚT GỌN (BỎ HỌ) VÀ BIỆT DANH / TÊN THÂN MẬT CỐ ĐỊNH CHƯA KHÓA BẰNG ⟦ ⟧');
    expect(compiled.fullPrompt).toContain('"秀麗" -> "Tú Lệ"');
    expect(compiled.fullPrompt).toContain('"剛子" -> "Cương Tử"');
    expect(compiled.fullPrompt).toContain('"安然" -> "An Nhiên"');
  });
});
