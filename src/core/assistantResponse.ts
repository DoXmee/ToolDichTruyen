import { parseChapterHeaderLine } from './titleParser';

interface ResponseLine {
  text: string;
  start: number;
}

const ASSISTANT_CHROME_LABEL = /^(?:Bài viết|Article)$/iu;
const HORIZONTAL_RULE = /^(?:-{3,}|_{3,}|\*{3,})$/u;

function responseLines(value: string): ResponseLine[] {
  const lines: ResponseLine[] = [];
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const raw = match[0];
    if (!raw) break;
    lines.push({
      text: raw.replace(/(?:\r\n|\r|\n)$/u, ''),
      start: match.index,
    });
  }

  return lines;
}

export function isAssistantChromeLabel(value: string): boolean {
  return ASSISTANT_CHROME_LABEL.test(value.trim());
}

export function isHorizontalRule(value: string): boolean {
  return HORIZONTAL_RULE.test(value.trim());
}

/**
 * ChatGPT can expose the localized writing-block label ("Bài viết") through
 * innerText even though it is browser chrome rather than model prose. Remove
 * it only when it is the first meaningful line and is immediately followed
 * by the same chapter heading as the source segment.
 */
export function sanitizeTranslationResponse(sourceText: string, responseText: string): string {
  const source = (sourceText ?? '').normalize('NFC');
  const response = (responseText ?? '').normalize('NFC').trim();
  if (!response) return response;

  const sourceHeader = source
    .split(/\r\n|\r|\n/u)
    .map((line) => parseChapterHeaderLine(line))
    .find((header) => Boolean(header));
  if (!sourceHeader) return response;

  const lines = responseLines(response);
  let cursor = lines.findIndex((line) => Boolean(line.text.trim()));
  if (cursor < 0 || !isAssistantChromeLabel(lines[cursor]?.text ?? '')) return response;

  cursor += 1;
  while (cursor < lines.length && !lines[cursor]?.text.trim()) cursor += 1;
  if (cursor < lines.length && isHorizontalRule(lines[cursor]?.text ?? '')) {
    cursor += 1;
    while (cursor < lines.length && !lines[cursor]?.text.trim()) cursor += 1;
  }

  const translatedHeader = parseChapterHeaderLine(lines[cursor]?.text ?? '');
  if (!translatedHeader || translatedHeader.chapterNumber !== sourceHeader.chapterNumber) {
    return response;
  }

  return response.slice(lines[cursor]?.start ?? 0).trim();
}
