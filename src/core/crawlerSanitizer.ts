/**
 * Strips known Chinese novel crawler noise, advertisements, watermarks,
 * and adult web-game promotion junk from source text before sending to AI.
 */
export function stripCrawlerNoise(text: string): string {
  if (!text || typeof text !== 'string') return text ?? '';

  // Require the recommendation heading and a closing call to action. A
  // keyword in dialogue cannot start a deletion; prose after the ad survives.
  let cleaned = text.replace(
    /(?:^|\n)[ \t]*(?:🔥\s*)?读完本章的人(?:还在看|还在玩|都在看)[^\n]*\n[\s\S]*?(?=\n[ \t]*(?:第[0-9一二三四五六七八九十百千万]+章|Chương\s+\d+)|$)/gu,
    (block) => {
      const lines = block.split('\n');
      if (!/(?:真人互动多结局|免下载秒玩|立即入局)/u.test(block)) return block;
      let end = -1;
      for (let index = 1; index < lines.length; index += 1) {
        if (/^(?:立即入局\s*[▸▶>]?|[⚡🔥].*|.*免下载秒玩)\s*$/u.test(lines[index]!.trim())) end = index;
      }
      return end < 0 ? block : '\n' + lines.slice(end + 1).join('\n');
    },
  );

  // 2. Trailing or standalone crawler watermark lines (with optional parentheses)
  cleaned = cleaned.replace(/^[ \t]*[（(]?(?:本章完|本章未完[，,、]?请点击下一页继续阅读|未完待续)[)）]?[ \t]*$/gmu, '');

  // 3. Standalone author note lines, mojibake double question marks (??), and common author memo prefixes
  // Safety rule: NEVER filter lines starting with a single '?' to protect valid dialogue questions
  cleaned = cleaned.replace(/^[ \t]*\?{2,}[^\n]*$/gmu, '');
  cleaned = cleaned.replace(/^[ \t]*(?:PS|ps|Ps|Lời tác giả|Tác giả có lời muốn nói|【Tác giả】)[：:][^\n]*$/gmu, '');
  cleaned = cleaned.replace(/^[ \t]*(?:PS|ps|Ps|Lời tác giả|Tác giả có lời muốn nói|【Tác giả】)\s+[^\n]*$/gmu, '');

  // 4. Normalize multiple empty lines left behind by stripped ads
  cleaned = cleaned.replace(/\n{3,}/gu, '\n\n');

  return cleaned.trim();
}

export interface GarbageSnippet {
  text: string;
  reason?: string;
  paragraph?: number | string;
}

/**
 * Removes AI-identified garbage / ad snippets from source text cleanly and safely.
 * Never deletes chapter title lines (Chương N / 第N章) or very short snippets (< 3 chars).
 */
export function removeGarbageSnippets(sourceText: string, snippets: readonly GarbageSnippet[]): string {
  if (!sourceText || !snippets || !snippets.length) return sourceText ?? '';
  let result = sourceText;
  for (const item of snippets) {
    const raw = item?.text?.trim();
    if (!raw || raw.length < 3) continue;
    // Safety check: Never delete chapter title lines
    if (/^(?:Chương\s+\d+|第[0-9一二三四五六七八九十百千万]+章)/iu.test(raw)) continue;

    if (result.includes(raw)) {
      result = result.split(raw).join('');
    } else {
      // Try line-by-line whitespace-tolerant match
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');
      try {
        result = result.replace(new RegExp(escaped, 'gu'), '');
      } catch {}
    }
  }
  return result.replace(/\n{3,}/gu, '\n\n').trim();
}
