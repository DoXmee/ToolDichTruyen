import { describe, expect, it } from 'vitest';
import {
  analyzeTextLanguage,
  countWords,
  locateHanCharacters,
} from '../../src/core';

describe('language analysis', () => {
  it('normalizes to NFC and counts Han characters as individual units', () => {
    const analysis = analyzeTextLanguage('cha\u0300o 世界', 'vi');

    expect(analysis.normalizedText).toBe('chào 世界');
    expect(analysis.totalWords).toBe(3);
    expect(analysis.mismatchedCount).toBe(2);
    expect(analysis.hanCount).toBe(2);
    expect(analysis.tokens.map((token) => token.text).join('')).toBe('chào 世界');
  });

  it('returns precise UTF-16 offsets, lines, and Unicode columns for Han', () => {
    const locations = locateHanCharacters('😀a\r\n中\n文');

    expect(locations).toEqual([
      { character: '中', start: 5, end: 6, line: 2, column: 1 },
      { character: '文', start: 7, end: 8, line: 3, column: 1 },
    ]);
  });

  it('retains whitespace tokens but does not count them as words', () => {
    const analysis = analyzeTextLanguage('  xin\nchào  ', 'vi');
    expect(analysis.totalWords).toBe(2);
    expect(analysis.tokens.map((token) => token.text).join('')).toBe('  xin\nchào  ');
    expect(countWords('  xin\nchào  ')).toBe(2);
  });

  it('uses the selected script as a warning detector', () => {
    expect(analyzeTextLanguage('hello Việt', 'en').mismatchedCount).toBe(1);
    expect(analyzeTextLanguage('中文 ABC', 'zh').mismatchedCount).toBe(0);
    expect(analyzeTextLanguage('かな 漢字 ABC', 'ja').mismatchedCount).toBe(0);
    expect(analyzeTextLanguage('한글 漢字 ABC', 'ko').mismatchedCount).toBe(0);
  });

  it('handles empty and whitespace-only input', () => {
    expect(analyzeTextLanguage('', 'vi')).toMatchObject({
      totalWords: 0,
      mismatchedCount: 0,
      hanCount: 0,
    });
    expect(analyzeTextLanguage('\n  ', 'vi').tokens).toHaveLength(1);
  });
});
