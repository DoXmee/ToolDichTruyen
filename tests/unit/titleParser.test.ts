import { describe, expect, it } from 'vitest';
import {
  cleanTextOfChapterHeaders,
  constructTitle,
  parseChapterHeaderLine,
  romanToInteger,
} from '../../src/core';

describe('title parser', () => {
  it('parses Arabic chapter numbers wrapped in Markdown', () => {
    expect(parseChapterHeaderLine('  **Chương 22: Tất cả đều bắt nạt tôi**  ')).toMatchObject({
      chapterNumber: 22,
      keyword: 'chương',
      separator: ':',
      extractedTitle: 'Tất cả đều bắt nạt tôi',
    });
  });

  it('parses canonical Roman numerals and Markdown headings', () => {
    expect(parseChapterHeaderLine('## Chapter XIV — The long road')).toMatchObject({
      chapterNumber: 14,
      keyword: 'chapter',
      separator: '—',
      extractedTitle: 'The long road',
    });
    expect(romanToInteger('MMMCMXCIX')).toBe(3999);
    expect(romanToInteger('IIII')).toBeNull();
  });

  it('matches decomposed Vietnamese after NFC normalization', () => {
    const decomposed = 'Chương 3: Mở đầu';
    expect(parseChapterHeaderLine(decomposed)).toMatchObject({
      chapterNumber: 3,
      extractedTitle: 'Mở đầu',
    });
  });

  it.each([
    'Chương trình hôm nay rất hay',
    'Bài học đầu tiên',
    'Tập thể chúng ta',
    'Phần mềm này hoạt động',
    'Chương IVX: số La Mã sai',
    'Chương 0: không hợp lệ',
    'Chương 2 tiêu đề không có dấu phân cách',
  ])('does not treat prose as a header: %s', (line) => {
    expect(parseChapterHeaderLine(line)).toBeNull();
  });

  it('removes only recognized header records and retains original EOLs', () => {
    const source =
      '**Chương 1: Mở đầu**\r\nChương trình hôm nay\r\n\r\nChapter II - Next\r\nNội dung\r\n';
    const result = cleanTextOfChapterHeaders(source);

    expect(result.removedCount).toBe(2);
    expect(result.firstHeader?.chapterNumber).toBe(1);
    expect(result.cleanedText).toBe('Chương trình hôm nay\r\n\r\nNội dung\r\n');
  });

  it('constructs stable Vietnamese titles', () => {
    expect(constructTitle(7, 'Khởi đầu', 'Quyển 2')).toBe(
      'Quyển 2 Chương 7: Khởi đầu',
    );
    expect(constructTitle(7, ': Khởi đầu')).toBe('Chương 7: Khởi đầu');
    expect(constructTitle(0, '')).toBe('Chương 1');
  });
});
