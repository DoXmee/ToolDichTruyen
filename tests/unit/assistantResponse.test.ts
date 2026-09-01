import { describe, expect, it } from 'vitest';
import { sanitizeTranslationResponse } from '../../src/core';

describe('sanitizeTranslationResponse', () => {
  it('removes the localized writing-block label before the matching chapter', () => {
    const source = 'Chương 7: 出发\n\n原文。';
    const response = 'Bài viết\r\n\r\n---\r\n\r\nChương 7: Lên đường\r\n\r\nNội dung.';

    expect(sanitizeTranslationResponse(source, response))
      .toBe('Chương 7: Lên đường\r\n\r\nNội dung.');
  });

  it('keeps prose and suspicious labels when the source/header context does not match', () => {
    expect(sanitizeTranslationResponse('原文。', 'Bài viết\nNội dung.'))
      .toBe('Bài viết\nNội dung.');
    expect(sanitizeTranslationResponse(
      'Chương 7: 出发\n原文。',
      'Bài viết\nChương 8: Khác chương\nNội dung.',
    )).toBe('Bài viết\nChương 8: Khác chương\nNội dung.');
    expect(sanitizeTranslationResponse(
      'Chương 7: 出发\n原文。',
      'Chương 7: Lên đường\nĐây là một bài viết trong truyện.',
    )).toBe('Chương 7: Lên đường\nĐây là một bài viết trong truyện.');
  });
});
