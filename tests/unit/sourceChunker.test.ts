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
});
