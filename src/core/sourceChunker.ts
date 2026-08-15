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
  let start = 0;

  while (start < text.length) {
    const end = chooseEnd(text, start, maxChars, minimumFillRatio);
    if (end <= start) {
      throw new Error('Chunker failed to make progress.');
    }

    const index = chunks.length;
    chunks.push({
      id: `segment-${index + 1}`,
      index,
      start,
      end,
      text: text.slice(start, end),
    });
    start = end;
  }

  return chunks;
}
