import { describe, expect, it } from 'vitest';
import { lockNamesInSource } from '../../src/core/nameLocker';
import { compileStoryBiblePrompt } from '../../src/core/promptCompilerV2';
import { createEmptyStoryBible } from '../../src/core/storyBible';
import { createEmptyStoryMemory, scanMatchingEntities } from '../../src/core/storyMemory';
import { getGenreProfile } from '../../src/core/genreProfile';

describe('script-equivalent names through the actual prompt selection path', () => {
  it('locks case/spacing/NFC-equivalent Vietnamese displays without mutating records', () => {
    const entities = [{ id: 'a', chinese: '王嬤嬤', vietnamese: 'Vương Ma Ma' },
      { id: 'b', chinese: '王嬷嬷', vietnamese: 'vương  ma\u00a0ma'.normalize('NFD') }];
    const before = JSON.stringify(entities);
    expect(lockNamesInSource('王嬤嬤和王嬷嬷。', entities).lockedSourceText)
      .toBe('⟦Vương Ma Ma⟧和⟦Vương Ma Ma⟧。');
    expect(JSON.stringify(entities)).toBe(before);
  });

  it('keeps genuinely different accented names in conflict', () => {
    expect(lockNamesInSource('王晞來了。', [
      { id: 'a', chinese: '王晞', vietnamese: 'Vương Hy' },
      { id: 'b', chinese: '王晞', vietnamese: 'Vương Hỷ' },
    ]).lockedCount).toBe(0);
  });
  it('selects and locks the audited 陈珞 entity before translation of 陳珞', () => {
    const bible = createEmptyStoryBible('ancient');
    bible.entities.push({ id: 'c1', category: 'character', zh: '陈珞', vi: 'Trần Lạc', status: 'locked' });
    const result = compileStoryBiblePrompt({ segmentId: 'test', segmentIndex: 0, totalSegments: 1,
      sourceText: '嫁給陳愚之後生了一個兒子，叫陳珞。這個陳珞十二歲。', bible, genreProfile: getGenreProfile('ancient') });
    expect(result.presentEntities.map(e => e.id)).toEqual(['c1']);
    expect(result.lockedSourceText).toBe('嫁給陳愚之後生了一個兒子，叫⟦Trần Lạc⟧。這個⟦Trần Lạc⟧十二歲。');
    expect(bible.entities[0]?.zh).toBe('陈珞');
  });

  it('selects aliases across scripts without mutating the stored identity', () => {
    const memory = createEmptyStoryMemory();
    memory.entities.push({ id: 'c1', category: 'character', chinese: '吴秀丽', vietnamese: 'Ngô Tú Lệ', aliases: ['秀丽'] });
    const original = JSON.stringify(memory);
    expect(scanMatchingEntities(memory, '秀麗來了。').map(e => e.id)).toEqual(['c1']);
    expect(JSON.stringify(memory)).toBe(original);
  });

  it('locks mixed-script names and preserves all non-name source text and existing locks', () => {
    const source = '“陈瓔”與陳璎說話。⟦陳瓔⟧保留；風景不變。';
    expect(lockNamesInSource(source, [{ id: 'a', chinese: '陈璎', vietnamese: 'Trần Anh' }]).lockedSourceText)
      .toBe('“⟦Trần Anh⟧”與⟦Trần Anh⟧說話。⟦陳瓔⟧保留；風景不變。');
  });

  it('leaves lossy-conversion collisions unlocked and does not merge identities', () => {
    const entities = [{ id: 'a', chinese: '陳後', vietnamese: 'Người A' }, { id: 'b', chinese: '陈后', vietnamese: 'Người B' }];
    const copy = JSON.stringify(entities);
    expect(lockNamesInSource('陳後和陈后。', entities)).toMatchObject({ lockedCount: 0, lockedSourceText: '陳後和陈后。' });
    expect(JSON.stringify(entities)).toBe(copy);
  });

  it('does not choose the first of two entities sharing an equivalent alias', () => {
    const result = lockNamesInSource('阿麗和阿丽。吳秀麗來了。', [
      { id: 'a', chinese: '吴秀丽', vietnamese: 'Ngô Tú Lệ', aliases: ['阿丽'] },
      { id: 'b', chinese: '张小丽', vietnamese: 'Trương Tiểu Lệ', aliases: ['阿麗'] },
    ]);
    expect(result.lockedSourceText).toBe('阿麗和阿丽。⟦Ngô Tú Lệ⟧來了。');
  });

  it('preserves locking when old memory has two script records with the same display, without merging them', () => {
    const entities = [{ id: 'a', chinese: '陈珞', vietnamese: 'Trần Lạc' },
      { id: 'b', chinese: '陳珞', vietnamese: 'Trần Lạc' }];
    const before = JSON.stringify(entities);
    expect(lockNamesInSource('陳珞看著陈珞。', entities).lockedSourceText)
      .toBe('⟦Trần Lạc⟧看著⟦Trần Lạc⟧。');
    expect(JSON.stringify(entities)).toBe(before);
    expect(entities.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('does not combine two distinct names just because their Vietnamese spellings coincide', () => {
    const memory = createEmptyStoryMemory();
    memory.entities.push({ id: 'a', category: 'character', chinese: '陈后', vietnamese: 'Trần Hậu' },
      { id: 'b', category: 'character', chinese: '陈厚', vietnamese: 'Trần Hậu' });
    expect(scanMatchingEntities(memory, '陳后與陳厚。').map(e => e.id)).toEqual(['a', 'b']);
    expect(memory.entities).toHaveLength(2);
  });
});
