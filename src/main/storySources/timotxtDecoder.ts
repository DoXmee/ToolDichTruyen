import { StorySourceError, type StoryTextDecoder } from "./types.js";

export const TIMOTXT_BQG_FONT_HASH =
  "4287ef986834d02762283c9265285cd7aa29b90c1dc1e7671d959359786c7db2";
export const TIMOTXT_BQG_DECODER_VERSION = "f24092-v1";

// Extracted from the cmap/glyph outlines of /fonts/f24092.woff2 and pinned to
// its SHA-256 above. These are Unicode slots deliberately drawn as basic Han.
const F24092_CODEPOINTS: Readonly<Record<number, string>> = {
  0xAD17: "二", 0xAD5B: "十", 0xAD5C: "丁", 0xAD9D: "七",
  0xADF7: "八", 0xADF8: "人", 0xADF9: "入", 0xAE47: "九",
  0xAE4A: "了", 0xAE85: "刀", 0xAE86: "力", 0xAE97: "又",
  0xAE98: "三", 0xAE9B: "干", 0xAEB1: "土", 0xAEB2: "工",
  0xAEB3: "才", 0xAEB4: "寸", 0xAEB5: "丈", 0xAEB6: "大",
  0xAED7: "上", 0xAED8: "小", 0xAED9: "口", 0xAEDA: "山",
  0xAEDB: "巾", 0xAEDC: "千", 0xAEE1: "亡", 0xAEE3: "之",
  0xAEE5: "已", 0xAEE6: "弓", 0xAEE7: "己", 0xAEE9: "也",
  0xAF06: "乞", 0xAF07: "上", 0xAF0A: "么", 0xAF0B: "久",
  0xAF0C: "勺", 0xAF0D: "丸", 0xAF0E: "凡", 0xAF10: "及",
  0xAF57: "叉", 0xAF6C: "夫", 0xAF6D: "天", 0xAF6E: "元",
  0xAF71: "扎", 0xAF89: "五", 0xAF8A: "支", 0xAFA6: "犬",
  0xAFA8: "尤", 0xAFA9: "匹", 0xAFAB: "巨", 0xAFAC: "牙",
  0xAFAD: "屯", 0xAFAE: "互", 0xAFBF: "切", 0xAFC0: "止",
  0xAFC1: "少", 0xAFC2: "日", 0xAFD7: "中", 0xAFDB: "手",
  0xAFE2: "午", 0xAFE4: "升", 0xAFE6: "仁", 0xAFE7: "片",
  0xAFE8: "化", 0xAFE9: "仇", 0xAFEB: "仍", 0xAFED: "斤",
  0xAFEE: "爪", 0xAFEF: "反", 0xAFF0: "介", 0xAFF5: "父",
  0xAFF7: "今", 0xAFF8: "凶", 0xAFF9: "之", 0xAFFB: "氏",
  0xB010: "欠", 0xB011: "丹", 0xB014: "勾", 0xB016: "六",
  0xB017: "文", 0xB018: "方", 0xB019: "火", 0xB01E: "心",
  0xB01F: "尺", 0xB027: "巴", 0xB02A: "以", 0xB02B: "允",
  0xB02C: "予", 0xB0EA: "幻", 0xB0EB: "玉", 0xB0EC: "末",
  0xB0ED: "未", 0xB148: "打", 0xB149: "巧", 0xB14A: "正",
  0xB14C: "功", 0xB14D: "扔", 0xB160: "甘", 0xB161: "世",
  0xB162: "古", 0xB164: "本", 0xB166: "可", 0xB167: "丙",
  0xB168: "左", 0xB16A: "石", 0xB17F: "右", 0xB180: "布",
  0xB182: "平", 0xB185: "的", 0xB186: "是", 0xB187: "在",
  0xB18A: "不", 0xB18B: "有", 0xB18C: "和", 0xB196: "我",
  0xB198: "由", 0xB199: "只", 0xB19A: "要", 0xB19B: "他",
  0xB1FD: "叫", 0xB1FE: "用", 0xB201: "四", 0xB202: "失",
  0xB203: "生", 0xB204: "到", 0xB211: "代", 0xB212: "作",
  0xB213: "地", 0xB215: "出", 0xB280: "就", 0xB281: "分",
  0xB282: "乎", 0xB284: "令", 0xB285: "成", 0xB289: "句",
  0xB28C: "外", 0xB2B3: "冬", 0xB2B5: "包", 0xB37F: "主",
  0xB380: "市", 0xB383: "年", 0xB3D7: "它", 0xB561: "百",
  0xB562: "同", 0xB563: "能", 0xB564: "而", 0xB598: "下",
  0xB59A: "子",
};

export function containsTimotxtEncodedCodepoints(text: string): boolean {
  return Array.from(text).some((character) => {
    const codepoint = character.codePointAt(0);
    return codepoint !== undefined && codepoint >= 0xAC00 && codepoint <= 0xD7AF;
  });
}

export class TimotxtF24092Decoder implements StoryTextDecoder {
  public readonly id = "timotxt-bqg";
  public readonly version = TIMOTXT_BQG_DECODER_VERSION;
  public readonly supportedFontHashes = [TIMOTXT_BQG_FONT_HASH] as const;

  public decode(input: Parameters<StoryTextDecoder["decode"]>[0]): string {
    if (input.fontHash.toLowerCase() !== TIMOTXT_BQG_FONT_HASH) {
      throw new StorySourceError("TIMOTXT_FONT_UNVERIFIED", "Hash font bqg của TimoTXT không khớp bộ giải mã đã ghim.");
    }
    let changed = false;
    const decoded = Array.from(input.text, (character) => {
      const codepoint = character.codePointAt(0);
      if (codepoint === undefined || codepoint < 0xAC00 || codepoint > 0xD7AF) return character;
      const replacement = F24092_CODEPOINTS[codepoint];
      if (!replacement) {
        throw new StorySourceError(
          "TIMOTXT_DECODE_FAILED",
          `Font bqg chứa mã lạ U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}; đã dừng để không xuất chữ sai.`,
        );
      }
      changed = true;
      return replacement;
    }).join("");
    if (!changed || containsTimotxtEncodedCodepoints(decoded)) {
      throw new StorySourceError("TIMOTXT_DECODE_FAILED", "Không giải mã được nội dung font bqg TimoTXT một cách an toàn.");
    }
    return decoded;
  }
}
