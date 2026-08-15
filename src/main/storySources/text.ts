const SITE_NOISE = [
  /^\s*(?:返回|首页|關灯|护眼|字体：|设置)\s*$/iu,
  /^\s*(?:上一章|下一章|上一页|下一页|返回目录|章节目录|目錄)\s*$/iu,
  /^\s*(?:投票推荐|加入书签|留言反馈|加入收藏|换源)\s*$/iu,
];

const INLINE_NOISE = [
  /\s*点击下一页继续[\s\S]*$/iu,
  /\s*此页为本章\s*第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页[\s\S]*$/iu,
  /\s*溫馨提示\s*:\s*網站即將改版[\s\S]*$/iu,
  /\s*(?:本站所收录|本站所收錄|所有内容均来自互联网)[\s\S]*$/iu,
];

export function normalizeText(raw: string): string {
  let text = raw.normalize("NFC")
    .replace(/\u00a0/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v]+/gu, " ")
    .replace(/[ ]+\n/gu, "\n")
    .replace(/\n[ ]+/gu, "\n");
  for (const pattern of INLINE_NOISE) text = text.replace(pattern, "");
  text = text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !SITE_NOISE.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return text;
}

export function removeRepeatedHeading(text: string, title: string): string {
  const lines = text.split("\n");
  const normalizedTitle = title.replace(/\s+/gu, "").toLowerCase();
  while (lines[0] && lines[0].replace(/\s+/gu, "").toLowerCase() === normalizedTitle) lines.shift();
  return lines.join("\n").trim();
}

/**
 * Xbanxia puts its own brand and, in some chapters, a trailing author note
 * inside the story container. Only exact line-boundary tails are removed so
 * an occurrence inside the actual narrative is preserved.
 */
export function cleanXbanxiaStoryText(raw: string): string {
  let text = normalizeText(raw)
    .replace(/(?:^|\n)\s*半夏小說\s*[，,]\s*快樂很多\s*$/iu, "")
    .trim();
  const authorNote = /(?:^|\n)\s*作者有[話话]要[說说](?:\s*[：:]\s*[^\n]*)?/iu.exec(text);
  if (authorNote?.index !== undefined && authorNote.index >= Math.floor(text.length / 2)) {
    text = text.slice(0, authorNote.index).trim();
  }
  return text;
}

function longestOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length, 2_000);
  for (let size = max; size >= 12; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}

export function mergeTextParts(parts: string[]): { text: string; overlapsRemoved: number } {
  let text = "";
  let overlapsRemoved = 0;
  for (const raw of parts) {
    const part = normalizeText(raw);
    if (!part) continue;
    if (!text) {
      text = part;
      continue;
    }
    if (text.includes(part)) {
      overlapsRemoved += part.length;
      continue;
    }
    const overlap = longestOverlap(text, part);
    overlapsRemoved += overlap;
    text = `${text}\n\n${part.slice(overlap).trimStart()}`.trim();
  }
  return { text, overlapsRemoved };
}

export function assertPlausibleStoryText(text: string, sourceLabel: string): void {
  if (text.length < 20) throw new Error(`Nội dung ${sourceLabel} quá ngắn hoặc rỗng.`);
  const replacements = (text.match(/\uFFFD/gu) ?? []).length;
  if (replacements > Math.max(2, text.length * 0.001)) {
    throw new Error(`Nội dung ${sourceLabel} có dấu hiệu giải mã ký tự lỗi.`);
  }
  if (/Just a moment|Checking your browser|cf-chl-|Cloudflare Ray ID/iu.test(text)) {
    throw new Error(`${sourceLabel} là trang xác minh chứ không phải nội dung truyện.`);
  }
}

export function parseChapterLabel(label: string): {
  number?: number;
  numberLabel: string;
  title: string;
  isIntroduction: boolean;
} {
  const clean = label.normalize("NFC").replace(/^\s*\d+\s*[.\u3001]\s*/u, "").trim();
  const introduction = /^(?:内容简介|內容簡介|作品相关|作品相關|序章|楔子|引子|前言|简介|簡介)$/iu.test(clean);
  const numbered = /^\s*第\s*(\d+|[零〇一二三四五六七八九十百千万萬两兩]+)\s*章\s*(.*)$/iu.exec(clean);
  if (numbered?.[1]) {
    const number = /^\d+$/u.test(numbered[1])
      ? Number.parseInt(numbered[1], 10)
      : parseChineseNumber(numbered[1]);
    return {
      ...(number === undefined ? {} : { number }),
      numberLabel: `第${numbered[1]}章`,
      title: numbered[2]?.trim() || `第${numbered[1]}章`,
      isIntroduction: false,
    };
  }
  return {
    numberLabel: introduction ? "简介" : clean.slice(0, 80),
    title: clean.slice(0, 160) || "Chương không tiêu đề",
    isIntroduction: introduction,
  };
}

function parseChineseNumber(raw: string): number | undefined {
  const normalized = raw.replace(/〇/gu, "零").replace(/兩/gu, "两").replace(/萬/gu, "万");
  const digits: Readonly<Record<string, number>> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (![..."十百千万"].some((unit) => normalized.includes(unit))) {
    const joined = Array.from(normalized, (character) => digits[character]).join("");
    return /^\d+$/u.test(joined) ? Number.parseInt(joined, 10) : undefined;
  }
  const units: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1_000 };
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of normalized) {
    if (character in digits) {
      digit = digits[character] ?? 0;
      continue;
    }
    if (character === "万") {
      section += digit;
      total += section * 10_000;
      section = 0;
      digit = 0;
      continue;
    }
    const unit = units[character];
    if (!unit) return undefined;
    section += (digit || 1) * unit;
    digit = 0;
  }
  const result = total + section + digit;
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}
