import { describe, expect, it } from 'vitest';
import {
  renumberFinalExportChapters,
  renumberOriginalExportChapters,
} from '../../src/core';
import type { Chapter } from '../../src/shared';

function chapter(
  index: number,
  title: string,
  sourceChapterNumber: number,
  start: number,
  end: number,
): Chapter {
  return {
    id: `${sourceChapterNumber}-${index}-${start}`,
    index,
    title,
    content: `Nội dung ${index}.`,
    wordCount: 3,
    source: {
      ordinal: index,
      start,
      end,
      leadingSeparator: '',
      trailingSeparator: '',
      sourceChapterNumber,
    },
  };
}

describe('chapter output renumbering', () => {
  it('keeps each final split file sequential while preserving its original source chapter', () => {
    const finalChapters = [
      chapter(40, 'Chương 40: Mở đầu', 40, 10, 20),
      chapter(41, 'Chương 41: Mở đầu', 40, 20, 30),
      chapter(42, 'Chương 42: Tiếp theo', 41, 40, 50),
    ];

    expect(renumberFinalExportChapters(finalChapters, 101)).toEqual([
      expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101: Mở đầu' }),
      expect.objectContaining({ index: 102, sourceChapterNumber: 40, title: 'Chương 102: Mở đầu' }),
      expect.objectContaining({ index: 103, sourceChapterNumber: 41, title: 'Chương 103: Tiếp theo' }),
    ]);
  });

  it('labels each original un-split chapter with the first output part it owns', () => {
    const originals = [
      chapter(40, 'Chương 40: Mở đầu', 40, 10, 30),
      chapter(41, 'Chương 41: Tiếp theo', 41, 40, 50),
    ];
    const finalChapters = [
      chapter(40, 'Chương 40: Mở đầu', 40, 10, 20),
      chapter(41, 'Chương 41: Mở đầu', 40, 20, 30),
      chapter(42, 'Chương 42: Tiếp theo', 41, 40, 50),
    ];

    expect(renumberOriginalExportChapters(originals, finalChapters, 101)).toEqual([
      expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101: Mở đầu' }),
      expect.objectContaining({ index: 103, sourceChapterNumber: 41, title: 'Chương 103: Tiếp theo' }),
    ]);
  });

  it('leaves legacy output labels and file provenance absent when the field is untouched', () => {
    const source = chapter(40, 'Chương 40 Mở đầu', 40, 10, 20);

    expect(renumberFinalExportChapters([source], undefined)).toEqual([{
      index: 40,
      title: 'Chương 40 Mở đầu',
      content: 'Nội dung 40.',
      wordCount: 3,
    }]);
  });

  it('removes descriptive titles while retaining sequential output and source provenance', () => {
    const finalChapters = [
      chapter(40, 'Chương 40: Mở đầu', 40, 10, 20),
      chapter(41, 'Chương 41: Tiếp theo', 41, 20, 30),
    ];

    expect(renumberFinalExportChapters(finalChapters, 101, true)).toEqual([
      expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101' }),
      expect.objectContaining({ index: 102, sourceChapterNumber: 41, title: 'Chương 102' }),
    ]);
    expect(renumberOriginalExportChapters(finalChapters, finalChapters, 101, true)).toEqual([
      expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101' }),
      expect.objectContaining({ index: 102, sourceChapterNumber: 41, title: 'Chương 102' }),
    ]);
  });
});
