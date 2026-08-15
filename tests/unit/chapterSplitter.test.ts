import { describe, expect, it } from 'vitest';
import { parseParagraphs, splitStory } from '../../src/core';
import type { SplitConfig } from '../../src/shared';

const baseConfig: SplitConfig = {
  targetWords: 800,
  prefix: '',
  suffix: '',
  startIndex: 1,
  inputLanguage: 'vi',
  autoDetectTitle: false,
};

function words(count: number, prefix = 't'): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');
}

function assertExactBody(source: string, contents: readonly string[]): void {
  expect(contents.join('')).toBe(source);
}

describe('chapter splitter — paragraph boundaries only', () => {
  it.each([1, 749, 750, 800, 1_500, 2_400])(
    'keeps a single %i-word paragraph whole regardless of the target',
    (wordCount) => {
      const source = words(wordCount);
      const result = splitStory(source, baseConfig);

      expect(result).toHaveLength(1);
      expect(result[0]?.wordCount).toBe(wordCount);
      expect(result[0]?.content).toBe(source);
    },
  );

  it('splits two 750-word paragraphs into two chapters without touching either paragraph', () => {
    const first = words(750, 'first');
    const second = words(750, 'second');
    const source = `${first}\n\n${second}`;
    const result = splitStory(source, baseConfig);

    expect(result.map((chapter) => chapter.wordCount)).toEqual([750, 750]);
    expect(result[0]?.content).toBe(`${first}\n\n`);
    expect(result[1]?.content).toBe(second);
    assertExactBody(source, result.map((chapter) => chapter.content));
  });

  it('creates an additional chapter only when the available whole paragraphs can satisfy the minimum', () => {
    const total2249 = [words(750, 'a'), words(749, 'b'), words(750, 'c')].join('\n');
    const total2250 = [words(750, 'd'), words(750, 'e'), words(750, 'f')].join('\n');
    const result2249 = splitStory(total2249, baseConfig);
    const result2250 = splitStory(total2250, baseConfig);

    expect(result2249).toHaveLength(2);
    expect(result2249.map((chapter) => chapter.wordCount)).toEqual([750, 1_499]);
    expect(result2250.map((chapter) => chapter.wordCount)).toEqual([750, 750, 750]);
    assertExactBody(total2249, result2249.map((chapter) => chapter.content));
    assertExactBody(total2250, result2250.map((chapter) => chapter.content));
  });

  it('keeps a complete long dialogue together even when it exceeds the target', () => {
    const dialogue = `“${words(900, 'lời')}, cô nói, rồi im lặng chờ mọi người trả lời.”`;
    const afterDialogue = words(800, 'sau');
    const source = `${dialogue}\n\n${afterDialogue}`;
    const result = splitStory(source, baseConfig);

    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe(`${dialogue}\n\n`);
    expect(result[0]?.content).toContain('rồi im lặng chờ mọi người trả lời.”');
    expect(result[1]?.content).toBe(afterDialogue);
    expect(result[0]!.wordCount).toBeGreaterThan(800);
    assertExactBody(source, result.map((chapter) => chapter.content));
  });

  it('does not split at a sentence or word boundary when paragraphs are uneven', () => {
    const first = words(850, 'a');
    const second = words(500, 'b');
    const third = words(900, 'c');
    const source = [first, second, third].join('\n');
    const result = splitStory(source, baseConfig);

    expect(result.map((chapter) => chapter.wordCount)).toEqual([1_350, 900]);
    expect(result[0]?.content).toBe(`${first}\n${second}\n`);
    expect(result[1]?.content).toBe(third);
    assertExactBody(source, result.map((chapter) => chapter.content));
  });

  it('uses targetWords as a guide while retaining complete paragraphs', () => {
    const source = `${words(800, 'a')}\n${words(800, 'b')}`;
    const result = splitStory(source, { ...baseConfig, targetWords: 850 });

    expect(result.map((chapter) => chapter.wordCount)).toEqual([800, 800]);
  });

  it('balances each explicit-header region while omitting only recognized headers', () => {
    const source = [
      'Chương 7: Mở đầu',
      words(750, 'a'),
      words(750, 'b'),
      'Chương 20: Kết thúc',
      words(749, 'c'),
    ].join('\n');
    const result = splitStory(source, { ...baseConfig, autoDetectTitle: true });

    expect(result.map((chapter) => chapter.index)).toEqual([7, 8, 20]);
    expect(result.map((chapter) => chapter.wordCount)).toEqual([750, 750, 749]);
    expect(result.map((chapter) => chapter.title)).toEqual([
      'Chương 7: Mở đầu',
      'Chương 8: Mở đầu',
      'Chương 20: Kết thúc',
    ]);
    expect(result[0]?.source?.header?.chapterNumber).toBe(7);
    expect(result[1]?.source?.header).toBeUndefined();
    expect(result[2]?.source?.header?.chapterNumber).toBe(20);
    expect(result.every((chapter) => !chapter.content.includes('Chương '))).toBe(true);
  });

  it('never duplicates output indexes when consecutive source headers contain multiple paragraph parts', () => {
    const source = [
      'Chương 1: Mở đầu',
      words(750, 'a'),
      words(750, 'b'),
      'Chương 2: Tiếp nối',
      words(750, 'c'),
    ].join('\n');
    const result = splitStory(source, { ...baseConfig, autoDetectTitle: true });

    expect(result.map((chapter) => chapter.index)).toEqual([1, 2, 3]);
    expect(new Set(result.map((chapter) => chapter.id)).size).toBe(3);
    expect(result.map((chapter) => chapter.title)).toEqual([
      'Chương 1: Mở đầu',
      'Chương 2: Mở đầu',
      'Chương 3: Tiếp nối',
    ]);
  });

  it('preserves paragraph separators, Unicode and source metadata exactly', () => {
    const source = '\r\nĐoạn một đủ dấu.\r\n \r\n你好 🌿 e\u0301.\r\n';
    const paragraphs = parseParagraphs(source);
    const result = splitStory(source, baseConfig);

    expect(paragraphs[0]?.separatorBefore).toBe('\r\n');
    expect(paragraphs[1]?.separatorBefore).toBe('\r\n \r\n');
    expect(paragraphs[1]?.separatorAfter).toBe('\r\n');
    expect(result[0]?.content).toBe('Đoạn một đủ dấu.\r\n \r\n你好 🌿 e\u0301.');
    expect(result[0]?.source).toMatchObject({
      start: 2,
      end: source.length - 2,
      leadingSeparator: '\r\n',
      trailingSeparator: '\r\n',
    });
  });

  it('never deletes common false positives and can disable real header recognition', () => {
    const falsePositives = 'Chương trình hôm nay rất hay\nBài học đầu tiên\nTập thể đồng lòng';
    const disabledHeader = 'Chương 9: Tiêu đề\nNội dung';

    expect(splitStory(falsePositives, { ...baseConfig, autoDetectTitle: true })[0]?.content)
      .toBe(falsePositives);
    expect(splitStory(disabledHeader, baseConfig)[0]?.content).toBe(disabledHeader);
  });

  it('is deterministic and falls back to target 800 and start index 1', () => {
    const config = { ...baseConfig, targetWords: 0, startIndex: -5 };
    const first = splitStory('Một đoạn ngắn.', config);
    const second = splitStory('Một đoạn ngắn.', config);

    expect(first).toEqual(second);
    expect(first[0]?.id).toBe('chapter-1-1');
    expect(first[0]?.index).toBe(1);
  });

  it('stress-tests conservation and proves every input paragraph remains whole through 10,000 words', () => {
    const paragraphs = Array.from({ length: 20 }, (_, index) => words(500, `p${index}-`));
    const source = paragraphs.join('\n\n');
    const result = splitStory(source, baseConfig);

    expect(result.length).toBeGreaterThan(1);
    expect(result.reduce((sum, chapter) => sum + chapter.wordCount, 0)).toBe(
      parseParagraphs(source, 'vi').reduce((sum, paragraph) => sum + paragraph.wordCount, 0),
    );
    for (const paragraph of paragraphs) {
      expect(result.filter((chapter) => chapter.content.includes(paragraph))).toHaveLength(1);
    }
    assertExactBody(source, result.map((chapter) => chapter.content));
  }, 30_000);
});
