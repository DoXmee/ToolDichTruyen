import { describe, expect, it } from 'vitest';
import { PERIOD_GENRE_PROFILE } from '../../src/core/genreProfile';
import { validateStoryBibleOutput } from '../../src/core/storyBibleValidator';

describe('storyBibleValidator module', () => {
  it('blocks translation when stray Han characters remain', () => {
    const text = '⟦Cố Quốc Cường⟧ đi đến 生产队 để nhận điểm công.';
    const result = validateStoryBibleOutput(text, {
      expectedLockedNames: ['Cố Quốc Cường'],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'stray_han')).toBe(true);
  });

  it('blocks translation when brackets are unclosed or mismatched', () => {
    const text = '⟦Cố Quốc Cường nhìn Thẩm Ngọc Lan⟧.';
    const result = validateStoryBibleOutput(text, {
      expectedLockedNames: ['Cố Quốc Cường', 'Thẩm Ngọc Lan'],
    });

    // Both are trapped in one pair or altered
    expect(result.issues.some((i) => i.code === 'altered_lock')).toBe(true);
  });

  it('warns when forbidden modern terms appear in period genre', () => {
    const text = '⟦Cố Cẩn Thư⟧ lấy smartphone ra để kiểm tra tin nhắn.';
    const result = validateStoryBibleOutput(text, {
      expectedLockedNames: ['Cố Cẩn Thư'],
      genreProfile: PERIOD_GENRE_PROFILE,
    });

    expect(result.issues.some((i) => i.code === 'forbidden_modern_term')).toBe(true);
  });

  it('cleanses text by unlocking brackets when valid', () => {
    const text = '⟦Cố Quốc Cường⟧ và ⟦Thẩm Ngọc Lan⟧ cùng nhau đi bộ.';
    const result = validateStoryBibleOutput(text, {
      expectedLockedNames: ['Cố Quốc Cường', 'Thẩm Ngọc Lan'],
    });

    expect(result.valid).toBe(true);
    expect(result.cleanedText).toBe('Cố Quốc Cường và Thẩm Ngọc Lan cùng nhau đi bộ.');
  });
});
