import { describe, expect, it } from 'vitest';
import { chunkSourceText } from '../../src/core';

describe('source chunker', () => {
  it('is lossless, ordered, and respects maxChars', () => {
    const source = 'Đoạn một.\n\nĐoạn hai dài hơn.\nĐoạn cuối.';
    const chunks = chunkSourceText(source, 14);

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks.every((chunk) => chunk.text.length <= 14)).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(
      chunks.map((_, index) => index),
    );
    expect(chunks[0]?.text).toBe('Đoạn một.\n\n');
  });

  it('prefers sentence and word boundaries inside an oversized paragraph', () => {
    const source = 'Câu thứ nhất. Câu thứ hai rất dài. Câu cuối.';
    const chunks = chunkSourceText(source, { maxChars: 24, minimumFillRatio: 0.3 });

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks[0]?.text.endsWith(' ')).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 24)).toBe(true);
  });

  it('never splits a surrogate pair at a hard boundary', () => {
    const source = 'aaaa😀bbbb';
    const chunks = chunkSourceText(source, 5);

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks.every((chunk) => !chunk.text.includes('\uFFFD'))).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 5)).toBe(true);
  });

  it('returns no chunks for empty input and rejects invalid limits', () => {
    expect(chunkSourceText('', 10)).toEqual([]);
    expect(() => chunkSourceText('abc', 0)).toThrow(RangeError);
    expect(() => chunkSourceText('abc', Number.NaN)).toThrow(RangeError);
  });

  it('keeps ordinary headed chapters whole and splits only an oversized chapter', () => {
    const source = [
      'Chương 1: Mở đầu\n' + '甲'.repeat(30),
      'Chương 2: Dài\n' + '乙'.repeat(95),
      'Chương 3: Kết\n' + '丙'.repeat(25),
    ].join('\n\n');
    const chunks = chunkSourceText(source, { maxChars: 60 });

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks[0]?.text).toContain('Chương 1: Mở đầu');
    expect(chunks.filter((chunk) => chunk.text.includes('Chương 2: Dài'))).toHaveLength(1);
    expect(chunks.filter((chunk) => chunk.text.includes('Chương 3: Kết'))).toHaveLength(1);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => chunk.text.length <= 60)).toBe(true);
  });

  it('keeps imported chapters whole when their headings have no separator or title', () => {
    const source = [
      'Chương 1\n' + '甲'.repeat(30),
      'Chương 2\n' + '乙'.repeat(30),
      'Chương 3\n' + '丙'.repeat(30),
    ].join('\n\n');
    const chunks = chunkSourceText(source, { maxChars: 60 });

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text.match(/^Chương \d+/u)?.[0])).toEqual([
      'Chương 1',
      'Chương 2',
      'Chương 3',
    ]);
    expect(chunks.every((chunk) => chunk.text.length <= 60)).toBe(true);
  });
});
