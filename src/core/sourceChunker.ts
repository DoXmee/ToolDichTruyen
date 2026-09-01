import type { SourceChunk, SourceChunkOptions } from '../shared';

function normalizeOptions(options: number | SourceChunkOptions): Required<SourceChunkOptions> {
  const value = typeof options === 'number' ? { maxChars: options } : options;
  if (!Number.isFinite(value.maxChars) || value.maxChars < 1) {
    throw new RangeError('maxChars must be a positive number.');
  }

  const ratio = value.minimumFillRatio ?? 0.35;
  return {
    maxChars: Math.max(1, Math.trunc(value.maxChars)),
    minimumFillRatio: Number.isFinite(ratio)
      ? Math.min(1, Math.max(0, ratio))
      : 0.35,
  };
}

function safeHardEnd(text: string, start: number, proposedEnd: number): number {
  let end = proposedEnd;

  // Do not split a UTF-16 surrogate pair.
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  ) {
    end -= 1;
  }

  // Keep CRLF together and avoid separating combining marks from their base.
  if (end > start && text[end - 1] === '\r' && text[end] === '\n') end -= 1;
  let nextCharacter = text[end];
  while (
    end > start &&
    end < text.length &&
    nextCharacter !== undefined &&
    /\p{M}/u.test(nextCharacter)
  ) {
    end -= 1;
    nextCharacter = text[end];
  }

  return end > start ? end : proposedEnd;
}

function lastBoundary(
  text: string,
  start: number,
  hardEnd: number,
  minimumEnd: number,
  pattern: RegExp,
): number | null {
  const sample = text.slice(start, hardEnd);
  let candidate: number | null = null;
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(sample)) !== null) {
    const absoluteEnd = start + match.index + match[0].length;
    if (absoluteEnd >= minimumEnd && absoluteEnd <= hardEnd) candidate = absoluteEnd;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return candidate;
}

function chooseEnd(
  text: string,
  start: number,
  maxChars: number,
  minimumFillRatio: number,
): number {
  const proposedEnd = Math.min(text.length, start + maxChars);
  if (proposedEnd === text.length) return proposedEnd;

  const hardEnd = safeHardEnd(text, start, proposedEnd);
  const minimumEnd = Math.min(
    hardEnd,
    start + Math.max(1, Math.floor(maxChars * minimumFillRatio)),
  );

  // Prefer complete paragraphs, then sentences, then words. All matched
  // whitespace belongs to the preceding chunk so concatenation remains exact.
  return (
    lastBoundary(text, start, hardEnd, minimumEnd, /(?:\r\n|\r|\n)+/g) ??
    lastBoundary(
      text,
      start,
      hardEnd,
      minimumEnd,
      /[。！？!?；;.](?:["'”’»』」）)\]]*)[\t ]*/gu,
    ) ??
    lastBoundary(text, start, hardEnd, minimumEnd, /\s+/gu) ??
    hardEnd
  );
}

/**
 * Website imports inject a stable `Chương N:` heading before every source
 * chapter. Keep an ordinary chapter intact so the model receives the same
 * coherent context as a manual full-chapter translation. Oversized chapters
 * still fall back to the generic lossless splitter below.
 */
function chapterStarts(text: string): number[] {
  const starts: number[] = [];
  const pattern = /(^|\n)[\t ]*chương[\t ]+\d+(?:[\t ]*(?::|：|-|–|—)[^\r\n]*)?[\t ]*(?=\r?$)/gimu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    starts.push(match.index + (match[1] === '\n' ? 1 : 0));
  }
  return starts;
}

function addGenericChunks(
  text: string,
  start: number,
  end: number,
  maxChars: number,
  minimumFillRatio: number,
  chunks: SourceChunk[],
): void {
  let offset = start;
  while (offset < end) {
    const chunkEnd = chooseEnd(text.slice(0, end), offset, maxChars, minimumFillRatio);
    if (chunkEnd <= offset) throw new Error('Chunker failed to make progress.');
    chunks.push({
      id: `segment-${chunks.length + 1}`,
      index: chunks.length,
      start: offset,
      end: chunkEnd,
      text: text.slice(offset, chunkEnd),
    });
    offset = chunkEnd;
  }
}

/**
 * Split source into exact, lossless slices no larger than maxChars. Paragraph and
 * sentence boundaries are preferred; an oversized paragraph eventually falls
 * back to a Unicode-safe hard boundary.
 */
export function chunkSourceText(
  text: string,
  options: number | SourceChunkOptions,
): SourceChunk[] {
  if (!text) return [];
  const { maxChars, minimumFillRatio } = normalizeOptions(options);
  const chunks: SourceChunk[] = [];
  const starts = chapterStarts(text);

  if (starts.length > 0) {
    if (starts[0]! > 0) addGenericChunks(text, 0, starts[0]!, maxChars, minimumFillRatio, chunks);
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]!;
      const end = starts[index + 1] ?? text.length;
      if (end - start <= maxChars) {
        chunks.push({
          id: `segment-${chunks.length + 1}`,
          index: chunks.length,
          start,
          end,
          text: text.slice(start, end),
        });
      } else {
        addGenericChunks(text, start, end, maxChars, minimumFillRatio, chunks);
      }
    }
    return chunks;
  }

  addGenericChunks(text, 0, text.length, maxChars, minimumFillRatio, chunks);

  return chunks;
}
