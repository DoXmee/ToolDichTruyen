import { describe, expect, it } from 'vitest';
import { assignOutputChapterNumbers } from '../../src/main/storySources/outputNumbering';

describe('story source output numbering', () => {
  it('keeps increasing site numbers and repairs missing, duplicate, and decreasing metadata', () => {
    const chapters = [
      { number: 10 },
      {},
      { number: 10 },
      { number: 15 },
      { number: 3 },
    ];

    expect(assignOutputChapterNumbers(chapters)).toEqual([10, 11, 12, 15, 16]);
    expect(chapters).toEqual([
      { number: 10 },
      {},
      { number: 10 },
      { number: 15 },
      { number: 3 },
    ]);
  });

  it('reserves a parser-safe range when a site number is too close to the limit', () => {
    expect(assignOutputChapterNumbers([
      { number: 999_999 },
      {},
      {},
    ])).toEqual([1, 2, 3]);

    expect(assignOutputChapterNumbers([
      { number: 999_997 },
      {},
      {},
    ])).toEqual([999_997, 999_998, 999_999]);
  });
});
