import { describe, expect, it } from 'vitest';
import { compileChapterScoutPrompt, compileStoryBiblePrompt } from '../../src/core/promptCompilerV2';
import { removeGarbageSnippets } from '../../src/core/crawlerSanitizer';
import { getGenreProfile } from '../../src/core/genreProfile';
import type { StoryBible } from '../../src/core/storyBible';

describe('Chapter Scout & Garbage Removal (Turn 1 & Turn 2)', () => {
  it('compiles chapter scout prompt asking for integrity, garbage, new characters and relations', () => {
    const prompt = compileChapterScoutPrompt({
      segmentId: 'CH1',
      sourceText: 'Chương 1\n顾国强走来。\n读完本章的人都在看...',
      knownEntities: [{ chinese: '顾国强', vietnamese: 'Cố Quốc Cường' }],
      knownLocations: [{ chinese: '京都', vietnamese: 'Kinh Đô' }],
    });

    expect(prompt).toContain('[TDT_SCOUT]');
    expect(prompt).toContain('KIỂM TRA TÍNH TOÀN VẸN (integrity)');
    expect(prompt).toContain('ĐỊNH VỊ RÁC / QUẢNG CÁO (garbage)');
    expect(prompt).toContain('NHÂN VẬT MỚI (newCharacters)');
    expect(prompt).toContain('ĐỊA DANH & ĐƠN VỊ CÔNG XƯỞNG (locations)');
    expect(prompt).toContain('QUAN HỆ & GỢI Ý XƯNG HÔ (relations)');
    expect(prompt).toContain('DANH SÁCH NHÂN VẬT ĐÃ BIẾT');
    expect(prompt).toContain('顾国强 -> Cố Quốc Cường');
    expect(prompt).toContain('DANH SÁCH ĐỊA DANH ĐÃ BIẾT');
    expect(prompt).toContain('京都 -> Kinh Đô');
  });

  it('safely removes garbage snippets without deleting story text or chapter titles', () => {
    const source = `Chương 1: Khởi đầu\n\nĐây là câu chuyện bắt đầu.\n\nĐọc truyện tại website abc miễn phí.\n\n顾国强 nhìn về phía trước.\n\nLời tác giả: Cảm ơn các bạn đã đọc.`;
    const garbage = [
      { text: 'Đọc truyện tại website abc miễn phí.', reason: 'ad' },
      { text: 'Lời tác giả: Cảm ơn các bạn đã đọc.', reason: 'author note' },
      { text: 'Chương 1: Khởi đầu', reason: 'accidental wrong delete request' }, // Must NOT be deleted!
    ];

    const cleaned = removeGarbageSnippets(source, garbage);

    expect(cleaned).toContain('Chương 1: Khởi đầu');
    expect(cleaned).toContain('Đây là câu chuyện bắt đầu.');
    expect(cleaned).toContain('顾国强 nhìn về phía trước.');
    expect(cleaned).not.toContain('Đọc truyện tại website abc miễn phí.');
    expect(cleaned).not.toContain('Lời tác giả: Cảm ơn các bạn đã đọc.');
  });

  it('omits THUC_THE_MOI from translation prompt when skipEntityExtraction is true', () => {
    const bible: StoryBible = {
      schemaVersion: 2,
      profileId: 'period',
      entities: [
        {
          id: 'C00001',
          category: 'character',
          zh: '顾国强',
          vi: 'Cố Quốc Cường',
          status: 'active',
        },
      ],
      relations: [],
      timeline: [],
      pending: [],
      updatedAt: new Date().toISOString(),
    };

    const genreProfile = getGenreProfile('period');
    const compiled = compileStoryBiblePrompt({
      segmentId: 'CH1',
      segmentIndex: 0,
      totalSegments: 1,
      sourceText: '顾国强走进房间。',
      bible,
      genreProfile,
      skipEntityExtraction: true,
    });

    expect(compiled.fullPrompt).toContain('<BAN_DICH id="CH1">');
    expect(compiled.fullPrompt).not.toContain('<THUC_THE_MOI>');
    expect(compiled.fullPrompt).toContain('⟦Cố Quốc Cường⟧');
  });
});
