import type {
  Chapter,
  DetectedHeader,
  InputLanguage,
  ParagraphBlock,
  SplitConfig,
} from '../shared';
import { countWords } from './language';
import { constructTitle, parseChapterHeaderLine } from './titleParser';

interface LineRecord {
  text: string;
  start: number;
  end: number;
  ending: string;
}

interface ChapterRegion {
  paragraphs: ParagraphBlock[];
  chapterIndex: number;
  suffix: string;
  header?: DetectedHeader;
}

interface SplitCandidate {
  offset: number;
  cumulativeWords: number;
}

interface BalancedSlice {
  start: number;
  end: number;
  wordCount: number;
}

const DEFAULT_TARGET_WORDS = 800;
const TARGET_WORD_RANGE = 50;

function readLines(text: string): LineRecord[] {
  const lines: LineRecord[] = [];
  const newlinePattern = /\r\n|\r|\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = newlinePattern.exec(text)) !== null) {
    lines.push({
      text: text.slice(cursor, match.index),
      start: cursor,
      end: match.index,
      ending: match[0],
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    lines.push({ text: text.slice(cursor), start: cursor, end: text.length, ending: '' });
  } else if (text.length === 0) {
    return [];
  }

  return lines;
}

/**
 * Convert non-empty source lines into paragraphs while retaining exact source
 * offsets and every newline/blank-line run on both sides.
 */
export function parseParagraphs(
  text: string,
  language: InputLanguage = 'vi',
  detectHeaders = true,
): ParagraphBlock[] {
  const paragraphs: ParagraphBlock[] = [];
  let pendingSeparator = '';

  for (const line of readLines(text ?? '')) {
    if (!line.text.trim()) {
      pendingSeparator += line.text + line.ending;
      continue;
    }

    const paragraph: ParagraphBlock = {
      index: paragraphs.length,
      text: line.text,
      start: line.start,
      end: line.end,
      separatorBefore: pendingSeparator,
      separatorAfter: '',
      wordCount: countWords(line.text, language),
      header: detectHeaders ? parseChapterHeaderLine(line.text) ?? undefined : undefined,
    };

    const previousParagraph = paragraphs.at(-1);
    if (previousParagraph) previousParagraph.separatorAfter = pendingSeparator;
    paragraphs.push(paragraph);
    pendingSeparator = line.ending;
  }

  const lastParagraph = paragraphs.at(-1);
  if (lastParagraph) lastParagraph.separatorAfter = pendingSeparator;

  return paragraphs;
}

function safePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/**
 * Candidate boundaries are paragraph starts only. A chapter can never end
 * inside a line/paragraph: dialogue, a sentence, and every character in that
 * paragraph always stay together. Inter-paragraph separators belong to the
 * preceding slice, so concatenating chapter contents recreates the region
 * byte-for-byte (UTF-16 code-unit-for-code-unit).
 */
function buildCandidates(
  content: string,
  paragraphs: readonly ParagraphBlock[],
  language: InputLanguage,
): SplitCandidate[] {
  const first = paragraphs[0];
  const last = paragraphs.at(-1);
  if (!first || !last) return [];

  const offsets = new Set<number>([first.start, last.end]);

  for (let index = 0; index < paragraphs.length; index += 1) {
    const next = paragraphs[index + 1];
    if (next) offsets.add(next.start);
  }

  const ordered = [...offsets].sort((left, right) => left - right);
  const candidates: SplitCandidate[] = [];
  let previousOffset = first.start;
  let cumulativeWords = 0;

  for (const offset of ordered) {
    if (offset > previousOffset) {
      cumulativeWords += countWords(content.slice(previousOffset, offset), language);
    }
    candidates.push({ offset, cumulativeWords });
    previousOffset = offset;
  }

  return candidates;
}

function maximumGroupsFrom(
  candidates: readonly SplitCandidate[],
  minimumWords: number,
): number[] {
  const maximum = Array<number>(candidates.length).fill(0);

  for (let index = candidates.length - 2; index >= 0; index -= 1) {
    const threshold = (candidates[index]?.cumulativeWords ?? 0) + minimumWords;
    let low = index + 1;
    let high = candidates.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((candidates[middle]?.cumulativeWords ?? 0) >= threshold) high = middle;
      else low = middle + 1;
    }
    if (low < candidates.length) maximum[index] = 1 + (maximum[low] ?? 0);
  }

  return maximum;
}

function balancedSlices(
  content: string,
  paragraphs: readonly ParagraphBlock[],
  language: InputLanguage,
  targetWords: number,
  minimumWords: number,
): BalancedSlice[] {
  const candidates = buildCandidates(content, paragraphs, language);
  const start = candidates[0];
  const end = candidates.at(-1);
  if (!start || !end) return [];

  const totalWords = end.cumulativeWords;
  if (totalWords < minimumWords) {
    return [{ start: start.offset, end: end.offset, wordCount: totalWords }];
  }

  const desiredChapterCount = Math.max(1, Math.floor(totalWords / minimumWords));

  const selectSlices = (
    candidates: readonly SplitCandidate[],
    requestedChapterCount: number,
  ): BalancedSlice[] => {
    const candidateStart = candidates[0];
    const candidateEnd = candidates.at(-1);
    if (!candidateStart || !candidateEnd) return [];

    const maximum = maximumGroupsFrom(candidates, minimumWords);
    const chapterCount = Math.max(1, Math.min(requestedChapterCount, maximum[0] ?? 1));
    if (chapterCount === 1) {
      return [{
        start: candidateStart.offset,
        end: candidateEnd.offset,
        wordCount: candidateEnd.cumulativeWords,
      }];
    }

    const selected = [0];
    let previousIndex = 0;

    for (let group = 1; group < chapterCount; group += 1) {
      const groupsIncludingCurrent = chapterCount - group + 1;
      const remainingWords = totalWords - (candidates[previousIndex]?.cumulativeWords ?? 0);
      const idealCurrentWords = remainingWords / groupsIncludingCurrent;
      const remainingGroups = chapterCount - group;
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let index = previousIndex + 1; index < candidates.length - 1; index += 1) {
        const candidate = candidates[index];
        const previous = candidates[previousIndex];
        if (!candidate || !previous) continue;
        const currentWords = candidate.cumulativeWords - previous.cumulativeWords;
        if (currentWords < minimumWords) continue;
        if ((maximum[index] ?? 0) < remainingGroups) continue;

        const distance = Math.abs(currentWords - idealCurrentWords);
        if (
          distance < bestDistance
          || (distance === bestDistance && index < bestIndex)
        ) {
          bestIndex = index;
          bestDistance = distance;
        }
      }

      if (bestIndex < 0) break;
      selected.push(bestIndex);
      previousIndex = bestIndex;
    }

    selected.push(candidates.length - 1);
    if (selected.length !== chapterCount + 1) {
      return [{
        start: candidateStart.offset,
        end: candidateEnd.offset,
        wordCount: candidateEnd.cumulativeWords,
      }];
    }

    return selected.slice(0, -1).map((candidateIndex, index) => {
      const from = candidates[candidateIndex];
      const to = candidates[selected[index + 1] ?? -1];
      if (!from || !to) throw new Error('Không thể xác định ranh giới chương.');
      return {
        start: from.offset,
        end: to.offset,
        wordCount: to.cumulativeWords - from.cumulativeWords,
      };
    });
  };

  // Do not add sentence- or token-level fallback boundaries here. The target
  // range is intentionally a guide, never permission to split a paragraph or
  // dialogue. When the writer used fewer/larger paragraphs, emit fewer or
  // oversized chapters and preserve the prose intact.
  return selectSlices(candidates, desiredChapterCount);
}

function paragraphFragments(
  content: string,
  paragraphs: readonly ParagraphBlock[],
  slice: BalancedSlice,
  language: InputLanguage,
): ParagraphBlock[] {
  const fragments: ParagraphBlock[] = [];

  for (const paragraph of paragraphs) {
    const start = Math.max(paragraph.start, slice.start);
    const end = Math.min(paragraph.end, slice.end);
    if (start >= end) continue;
    const text = content.slice(start, end);
    fragments.push({
      ...paragraph,
      index: fragments.length,
      text,
      start,
      end,
      separatorBefore: '',
      separatorAfter: '',
      wordCount: countWords(text, language),
      header: undefined,
    });
  }

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    if (!fragment) continue;
    const previous = fragments[index - 1];
    const next = fragments[index + 1];
    fragment.separatorBefore = previous ? content.slice(previous.end, fragment.start) : '';
    fragment.separatorAfter = next
      ? content.slice(fragment.end, next.start)
      : content.slice(fragment.end, slice.end);
  }

  return fragments;
}

function regionsFromParagraphs(
  paragraphs: readonly ParagraphBlock[],
  config: SplitConfig,
  initialIndex: number,
): ChapterRegion[] {
  const regions: ChapterRegion[] = [];
  let current: ParagraphBlock[] = [];
  let chapterIndex = initialIndex;
  let suffix = config.suffix;
  let header: DetectedHeader | undefined;

  const flush = (): void => {
    if (!current.length) return;
    regions.push({ paragraphs: current, chapterIndex, suffix, ...(header ? { header } : {}) });
    current = [];
    header = undefined;
  };

  for (const paragraph of paragraphs) {
    const detected = config.autoDetectTitle ? paragraph.header : undefined;
    if (detected) {
      flush();
      chapterIndex = detected.chapterNumber;
      suffix = detected.extractedTitle || config.suffix;
      header = detected;
      continue;
    }
    current.push(paragraph);
  }
  flush();
  return regions;
}

/**
 * Split each header-delimited region into the largest feasible number of
 * balanced chapters. The minimum is targetWords - 50; with the default target
 * this yields the requested 750–800-word range whenever whole paragraphs make
 * that possible. A large paragraph is deliberately kept whole rather than
 * cutting a sentence or dialogue to force the numeric target.
 */
export function splitStory(content: string, config: SplitConfig): Chapter[] {
  if (!content?.trim()) return [];

  const targetWords = safePositiveInteger(config.targetWords, DEFAULT_TARGET_WORDS);
  const minimumWords = Math.max(1, targetWords - TARGET_WORD_RANGE);
  const initialIndex = safePositiveInteger(config.startIndex, 1);
  const language = config.inputLanguage;
  const paragraphs = parseParagraphs(content, language, config.autoDetectTitle);
  const regions = regionsFromParagraphs(paragraphs, config, initialIndex);
  const chapters: Chapter[] = [];
  let nextAvailableIndex = initialIndex;

  for (const region of regions) {
    // A source chapter may become several balanced output chapters. If the
    // next source header is consecutive (e.g. source chapter 2 after source
    // chapter 1 split into two), blindly resetting to its number would create
    // duplicate output indexes and duplicate Windows filenames. Preserve
    // intentional forward jumps while keeping every emitted index monotonic.
    const regionStartIndex = Math.max(region.chapterIndex, nextAvailableIndex);
    const slices = balancedSlices(
      content,
      region.paragraphs,
      language,
      targetWords,
      minimumWords,
    );
    for (let part = 0; part < slices.length; part += 1) {
      const slice = slices[part];
      if (!slice) continue;
      const chapterIndex = regionStartIndex + part;
      const ordinal = chapters.length;
      const fragments = paragraphFragments(content, region.paragraphs, slice, language);
      const isFirstPart = part === 0;
      const isLastPart = part === slices.length - 1;
      const firstParagraph = region.paragraphs[0];
      const lastParagraph = region.paragraphs.at(-1);

      chapters.push({
        id: `chapter-${ordinal + 1}-${chapterIndex}`,
        index: chapterIndex,
        title: constructTitle(chapterIndex, region.suffix, config.prefix),
        content: content.slice(slice.start, slice.end),
        wordCount: slice.wordCount,
        paragraphs: fragments,
        source: {
          ordinal,
          start: slice.start,
          end: slice.end,
          leadingSeparator: isFirstPart ? (firstParagraph?.separatorBefore ?? '') : '',
          trailingSeparator: isLastPart ? (lastParagraph?.separatorAfter ?? '') : '',
          // Keep the owning website chapter on every emitted slice. The
          // first slice also retains the complete parsed header below, but a
          // continuation slice must not lose its `c.gốc` provenance merely
          // because it has no duplicated heading.
          sourceChapterNumber: region.header?.chapterNumber ?? region.chapterIndex,
          ...(isFirstPart && region.header ? { header: region.header } : {}),
        },
      });
    }
    nextAvailableIndex = Math.max(nextAvailableIndex, regionStartIndex + slices.length);
  }

  return chapters;
}

export const splitIntoChapters = splitStory;
