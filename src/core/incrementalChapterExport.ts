import type { Chapter, SplitConfig } from '../shared';
import { parseParagraphs, splitStory } from './chapterSplitter';
import { isAssistantChromeLabel, isHorizontalRule } from './assistantResponse';
import { constructTitle } from './titleParser';

interface OriginalChapterRegion {
  /** Paragraphs after a recognised chapter heading (the heading itself is not body text). */
  paragraphs: ReturnType<typeof parseParagraphs>;
  header?: NonNullable<ReturnType<typeof parseParagraphs>[number]['header']>;
}

function safeStartIndex(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

/**
 * Build the source-level regions used by the optional "original translated
 * chapters" export.  This intentionally does not use the 750--800 word
 * splitter: a recognised source heading owns every following paragraph until
 * the next recognised heading.
 */
function originalChapterRegions(content: string, config: SplitConfig): OriginalChapterRegion[] {
  const paragraphs = parseParagraphs(content, config.inputLanguage, config.autoDetectTitle);
  const regions: OriginalChapterRegion[] = [];
  let current: OriginalChapterRegion | undefined;
  let unheaded: ReturnType<typeof parseParagraphs> = [];
  let foundHeader = false;

  const removeTrailingAssistantChrome = (region: OriginalChapterRegion): void => {
    let labelIndex = region.paragraphs.length - 1;
    while (labelIndex >= 0 && isHorizontalRule(region.paragraphs[labelIndex]?.text ?? '')) {
      labelIndex -= 1;
    }
    if (labelIndex >= 0 && isAssistantChromeLabel(region.paragraphs[labelIndex]?.text ?? '')) {
      region.paragraphs = region.paragraphs.slice(0, labelIndex);
    }
  };

  for (const paragraph of paragraphs) {
    const header = config.autoDetectTitle ? paragraph.header : undefined;
    if (header) {
      if (current) {
        removeTrailingAssistantChrome(current);
        if (current.paragraphs.length) regions.push(current);
      } else if (unheaded.length) {
        const preface = { paragraphs: unheaded };
        removeTrailingAssistantChrome(preface);
        unheaded = preface.paragraphs;
      }
      current = { paragraphs: [], header };
      foundHeader = true;
      continue;
    }

    if (current) current.paragraphs.push(paragraph);
    else unheaded.push(paragraph);
  }

  if (current) {
    removeTrailingAssistantChrome(current);
    if (current.paragraphs.length) regions.push(current);
  }

  // Manual pasted text need not have a chapter heading.  Treat it as one
  // logical original chapter only when there are no recognised headings at
  // all; prefaces preceding a later heading are deliberately not mistaken for
  // a completed source chapter.
  if (!foundHeader && unheaded.length) regions.push({ paragraphs: unheaded });

  return regions.filter((region) => region.paragraphs.length > 0);
}

/**
 * Return complete source-level translated chapters without applying the
 * 750--800 word split.  While a job is running, the last header-delimited
 * region is still growing and is withheld.  At a terminal checkpoint, that
 * final region is sealed too.
 *
 * Body text is sliced exclusively between whole paragraph boundaries.  This
 * preserves every dialogue line and sentence exactly; the export layer adds
 * the generated chapter heading to the TXT document.
 */
export function splitSealedOriginalChapters(
  content: string,
  config: SplitConfig,
  terminal: boolean,
): Chapter[] {
  if (!content?.trim()) return [];

  const regions = originalChapterRegions(content, config);
  const sealedRegions = terminal ? regions : regions.slice(0, -1);
  const fallbackIndex = safeStartIndex(config.startIndex);

  return sealedRegions.map((region, ordinal) => {
    const first = region.paragraphs[0];
    const last = region.paragraphs.at(-1);
    if (!first || !last) throw new Error('Kh\u00f4ng th\u1ec3 x\u00e1c \u0111\u1ecbnh n\u1ed9i dung ch\u01b0\u01a1ng g\u1ed1c.');

    const index = region.header?.chapterNumber ?? fallbackIndex + ordinal;
    const suffix = region.header?.extractedTitle || config.suffix;
    const chapterContent = content.slice(first.start, last.end);

    return {
      id: `original-chapter-${ordinal + 1}-${index}`,
      index,
      title: constructTitle(index, suffix, config.prefix),
      content: chapterContent,
      wordCount: region.paragraphs.reduce((total, paragraph) => total + paragraph.wordCount, 0),
      paragraphs: region.paragraphs.map((paragraph, paragraphIndex) => ({
        ...paragraph,
        index: paragraphIndex,
      })),
      source: {
        ordinal,
        start: first.start,
        end: last.end,
        leadingSeparator: first.separatorBefore,
        trailingSeparator: last.separatorAfter,
        sourceChapterNumber: region.header?.chapterNumber ?? index,
        ...(region.header ? { header: region.header } : {}),
      },
    };
  });
}

/**
 * Return only output chapters whose source region is known to be complete.
 *
 * While a translation job is still running, the final logical source chapter
 * can gain more paragraphs in the next checkpoint.  Rebalancing that open
 * region could move its paragraph-only split boundary, so exporting it early
 * would make an incomplete or duplicate TXT.  A later recognised chapter
 * header is the durable boundary: every chapter that ends before it is sealed
 * and can be atomically exported.  At a terminal job state there is no open
 * continuation, therefore every chapter is sealed.
 */
export function splitSealedChapters(
  content: string,
  config: SplitConfig,
  terminal: boolean,
): Chapter[] {
  const chapters = splitStory(content, config);
  if (terminal || !chapters.length) return chapters;

  const laterHeaderOffsets = parseParagraphs(content, config.inputLanguage, config.autoDetectTitle)
    .filter((paragraph) => Boolean(paragraph.header))
    .map((paragraph) => paragraph.start)
    .sort((left, right) => left - right);

  if (!laterHeaderOffsets.length) return [];

  return chapters.filter((chapter) => {
    const end = chapter.source?.end;
    return typeof end === 'number' && laterHeaderOffsets.some((headerStart) => headerStart >= end);
  });
}
