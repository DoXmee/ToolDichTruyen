import { describe, expect, it } from 'vitest';
import { splitSealedChapters, splitSealedOriginalChapters } from '../../src/core';
import type { SplitConfig } from '../../src/shared';

const config: SplitConfig = {
  targetWords: 800,
  prefix: '',
  suffix: '',
  startIndex: 1,
  inputLanguage: 'vi',
  autoDetectTitle: true,
};

function words(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

describe('splitSealedChapters', () => {
  it('does not export an open final source chapter while a job is running', () => {
    const content = `Chương 1: Mở đầu\n${words(800, 'mot')}`;

    expect(splitSealedChapters(content, config, false)).toEqual([]);
  });

  it('exports only regions closed by a later chapter header while keeping paragraphs whole', () => {
    const first = words(800, 'mot');
    const second = words(500, 'hai');
    const content = `Chương 1: Mở đầu\n${first}\n\nChương 2: Tiếp tục\n${second}`;

    const sealed = splitSealedChapters(content, config, false);

    expect(sealed).toHaveLength(1);
    expect(sealed[0]).toMatchObject({ index: 1, title: 'Chương 1: Mở đầu' });
    expect(sealed[0]?.content.trim()).toBe(first);
    expect(sealed[0]?.content).not.toContain('Chương 2');
  });

  it('exports the final open chapter after a terminal success or error checkpoint', () => {
    const content = `Chương 1: Mở đầu\n${words(800, 'mot')}\n\nChương 2: Tiếp tục\n${words(500, 'hai')}`;

    expect(splitSealedChapters(content, config, true).map((chapter) => chapter.index)).toEqual([1, 2]);
  });
});

describe('splitSealedOriginalChapters', () => {
  it('withholds the current source chapter until a later recognised header closes it', () => {
    const content = `Chapter 1: Opening\n${words(900, 'first')}`;

    expect(splitSealedOriginalChapters(content, config, false)).toEqual([]);
  });

  it('exports one un-split original chapter per closed header region', () => {
    const dialogue = `\u201c${words(900, 'dialogue')}\u201d`;
    const conclusion = 'The dialogue closes here.';
    const first = `${dialogue}\n\n${conclusion}`;
    const second = words(800, 'second');
    const content = `Chapter 7: Opening\n${first}\n\nChapter 8: Next\n${second}`;

    const originals = splitSealedOriginalChapters(content, config, false);
    const split = splitSealedChapters(content, config, false);

    expect(originals).toHaveLength(1);
    expect(originals[0]).toMatchObject({
      id: 'original-chapter-1-7',
      index: 7,
      title: 'Ch\u01b0\u01a1ng 7: Opening',
      content: first,
      source: { header: { chapterNumber: 7 } },
    });
    expect(originals[0]?.content).toContain(dialogue);
    expect(originals[0]?.content).not.toContain('Chapter 8');

    // The split export retains its existing paragraph-only 750--800 behaviour,
    // whereas the original export is exactly one source chapter.
    expect(split).toHaveLength(1);
    expect(split[0]?.content).toBe(first);
  });

  it('includes the trailing original region at terminal success or error and preserves paragraph boundaries', () => {
    const first = `${words(750, 'one')}\r\n\r\n${words(750, 'two')}`;
    const finalDialogue = `\u201c${words(1_100, 'final-dialogue')}\u201d`;
    const content = `Chapter 7: Opening\r\n${first}\r\n\r\nChapter 20: Finale\r\n${finalDialogue}\r\n`;

    const originals = splitSealedOriginalChapters(content, config, true);

    expect(originals.map((chapter) => chapter.index)).toEqual([7, 20]);
    expect(originals.map((chapter) => chapter.title)).toEqual([
      'Ch\u01b0\u01a1ng 7: Opening',
      'Ch\u01b0\u01a1ng 20: Finale',
    ]);
    expect(originals[0]?.content).toBe(first);
    expect(originals[1]?.content).toBe(finalDialogue);
    expect(originals[1]?.wordCount).toBeGreaterThan(800);
    expect(originals[1]?.content).toContain(finalDialogue);
    expect(originals[1]?.source).toMatchObject({
      header: { chapterNumber: 20 },
      trailingSeparator: '\r\n',
    });
  });

  it('treats heading-less pasted text as one original chapter only at a terminal checkpoint', () => {
    const content = `${words(800, 'manual')}\n\n${words(800, 'pasted')}`;

    expect(splitSealedOriginalChapters(content, config, false)).toEqual([]);

    const originals = splitSealedOriginalChapters(content, config, true);
    expect(originals).toHaveLength(1);
    expect(originals[0]).toMatchObject({
      index: 1,
      title: 'Ch\u01b0\u01a1ng 1',
      content,
    });
  });
});
