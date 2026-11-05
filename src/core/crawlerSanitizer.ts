/**
 * Strips known Chinese novel crawler noise, advertisements, watermarks,
 * and adult web-game promotion junk from source text before sending to AI.
 */
export function stripCrawlerNoise(text: string): string {
  if (!text || typeof text !== 'string') return text ?? '';

  let cleaned = text
    // 1. Interactive erotic harem/game ads (e.g. 读完本章的人还在玩, 假太监权谋, 六宫绝色)
    .replace(/(?:🔥\s*)?读完本章的人(?:还在看|还在玩|都在看)[\s\S]*?(?:$|(?=\n\s*(?:第[0-9一二三四五六七八九十百千万]+章|Chương|\b[0-9]+\b)))/gu, '')
    .replace(/(?:真人互动多结局爽剧|假太监权谋|六宫绝色修罗场|免下载秒玩|立即入局)[\s\S]*?(?:$|(?=\n\s*(?:第[0-9一二三四五六七八九十百千万]+章|Chương|\b[0-9]+\b)))/gu, '')
    .replace(/[⚡🔥]\s*藏贵妃入水下[\s\S]*?(?:$|(?=\n\s*(?:第[0-9一二三四五六七八九十百千万]+章|Chương|\b[0-9]+\b)))/gu, '')
    .replace(/[⚡🔥]\s*贴身替太后探脉[\s\S]*?(?:$|(?=\n\s*(?:第[0-9一二三四五六七八九十百千万]+章|Chương|\b[0-9]+\b)))/gu, '');

  // 2. Trailing or standalone crawler watermark lines (with optional parentheses)
  cleaned = cleaned.replace(/^[ \t]*[（(]?(?:本章完|本章未完[，,、]?请点击下一页继续阅读|未完待续)[)）]?[ \t]*$/gmu, '');

  // 3. Normalize multiple empty lines left behind by stripped ads
  cleaned = cleaned.replace(/\n{3,}/gu, '\n\n');

  return cleaned.trim();
}
