/**
 * Gemini occasionally restarts a long answer while it is still streaming: the
 * page keeps the abandoned opening and continues with a fresh one, so a single
 * `<message-content>` ends up holding both. Reproduced from a real chapter run:
 *
 *   Chương 1: Sáng sớm ở căn nhà cũ
 *
 *   Lâm Vãn đẩy cánh cửa gỗ đã tróc sơn ra, hương hoa quế trong sân nương theo gió ùa vào ngập trànChương 1: Buổi sớm nơi nhà cũ
 *
 *   Lâm Vãn đẩy cánh cửa gỗ đã tróc sơn, hương hoa quế trong sân nương theo ngọn gió ùa vào.
 *   ...
 *
 * Note how the restarted heading is glued straight onto the abandoned sentence
 * with no line break: the page concatenated two text nodes. Only the finished
 * copy is wanted, so the first restarted heading wins and everything before it
 * is dropped.
 */

const HEADING = /chương\s+(\d+)/giu;
/** A restart happens immediately; anything further in is real story text. */
const RESTART_WINDOW_CHARS = 1_500;
/** A heading is a short opening line, not a cross-reference inside a paragraph. */
const MAX_HEADING_LINE_CHARS = 120;

export function stripRestartedOpening(text: string): string {
  const window = text.slice(0, RESTART_WINDOW_CHARS);
  const headings = [...window.matchAll(HEADING)];
  if (headings.length < 2) return text;

  const chapterNumber = headings[0]?.[1];
  if (!chapterNumber) return text;

  for (const candidate of headings.slice(1)) {
    if (candidate[1] !== chapterNumber) continue;
    const index = candidate.index;
    if (index === undefined || index <= 0) continue;
    // A restarted heading either starts its own line or is glued straight onto
    // the abandoned sentence. A normal mention inside prose is preceded by a
    // space ("... ở chương 1, ..."), which is never a restart.
    const previous = text[index - 1] ?? "";
    if (previous !== "\n" && /\s/u.test(previous)) continue;
    const lineEnd = window.indexOf("\n", index);
    const headingLength = (lineEnd < 0 ? window.length : lineEnd) - index;
    if (headingLength > MAX_HEADING_LINE_CHARS) continue;
    return text.slice(index).trim();
  }
  return text;
}
