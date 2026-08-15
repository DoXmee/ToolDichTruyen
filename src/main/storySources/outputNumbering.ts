const MAX_OUTPUT_CHAPTER_NUMBER = 999_999;

type NumberedChapterMetadata = Readonly<{
  number?: number;
}>;

/**
 * Allocate parser-safe, strictly increasing chapter numbers for the internal
 * source headers sent through the translation/splitting pipeline.
 *
 * A trustworthy site number is retained when it is still ahead of the prior
 * output number. Missing, duplicate, decreasing, or out-of-range metadata is
 * replaced with the next available number. Reserving enough values for the
 * remaining chapters keeps every generated header recognizable by the title
 * parser, even when a site exposes an implausibly large number.
 */
export function assignOutputChapterNumbers(
  chapters: readonly NumberedChapterMetadata[],
): number[] {
  if (chapters.length > MAX_OUTPUT_CHAPTER_NUMBER) {
    throw new RangeError('Quá nhiều chương để gán số xuất an toàn.');
  }

  let nextAvailable = 1;
  return chapters.map((chapter, index) => {
    const remaining = chapters.length - index - 1;
    const maximumAllowed = MAX_OUTPUT_CHAPTER_NUMBER - remaining;
    const candidate = chapter.number;
    const canKeepCandidate = typeof candidate === 'number'
      && Number.isSafeInteger(candidate)
      && candidate >= nextAvailable
      && candidate <= maximumAllowed;
    const outputNumber = canKeepCandidate ? candidate : nextAvailable;
    nextAvailable = outputNumber + 1;
    return outputNumber;
  });
}
