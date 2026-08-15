import { describe, expect, it } from "vitest";
import { mergeContinuationEntries } from "../../src/main/storySources/adapters";
import {
  cleanXbanxiaStoryText,
  mergeTextParts,
  normalizeText,
  parseChapterLabel,
} from "../../src/main/storySources/text";
import {
  TimotxtF24092Decoder,
  TIMOTXT_BQG_FONT_HASH,
} from "../../src/main/storySources/timotxtDecoder";
import type { StoryChapterReference } from "../../src/shared/types";

describe("story source text safety", () => {
  it("strips Huliwang page footer contamination", () => {
    expect(normalizeText("正文第一段\n正文第二段\n点击下一页继续~ 此页为本章 第1页 / 共3页~ 如内容不全"))
      .toBe("正文第一段\n正文第二段");
  });

  it("deduplicates exact overlap while joining continuation pages", () => {
    expect(mergeTextParts(["abcdefghijklmNOPQRST", "NOPQRSTuvwxyz012345"]))
      .toEqual({ text: "abcdefghijklmNOPQRST\n\nNOPQRSTuvwxyz012345", overlapsRemoved: 0 });
    expect(mergeTextParts(["prefix-abcdefghijklmnop", "abcdefghijklmnop-suffix"]))
      .toEqual({ text: "prefix-abcdefghijklmnop\n\n-suffix", overlapsRemoved: 16 });
  });

  it.each(["作品相關", "作品相关"])("marks Xbanxia auxiliary entry %s as an introduction", (label) => {
    expect(parseChapterLabel(label)).toMatchObject({
      isIntroduction: true,
      numberLabel: "简介",
      title: label,
    });
  });

  it("removes only the exact Xbanxia trailing watermark", () => {
    expect(cleanXbanxiaStoryText([
      "第一段正文仍在繼續。",
      "第二段正文在這裡結束。",
      "半夏小說，快樂很多",
    ].join("\n"))).toBe("第一段正文仍在繼續。\n第二段正文在這裡結束。");
  });

  it.each(["作者有話要說", "作者有话要说"])("removes a trailing Xbanxia %s note only from the latter half", (marker) => {
    const story = [
      "夜色漸深，他們沿著山路繼續前行，誰也沒有回頭。",
      "風穿過樹梢，遠處的燈火終於出現在眼前。",
      "她輕輕點頭，把最後一封信收進行囊，故事在此完整收束。",
    ].join("\n");
    expect(cleanXbanxiaStoryText([
      story,
      `${marker}：謝謝大家一路陪伴`,
      "感謝讀者投出的營養液。",
      "半夏小說，快樂很多",
    ].join("\n"))).toBe(story);
  });

  it("preserves Xbanxia watermark and author-note phrases when narrative continues afterward", () => {
    const narrative = [
      "角色在書頁中央看到一句標語。",
      "半夏小說，快樂很多",
      "她把標語念完，故事仍然繼續。",
      "作者有話要說：這只是角色看到的紙條內容。",
      "下一段仍是正文，並不是章末作者附言。他們離開房間後穿過庭院，又走了很長一段路。",
      "月光照在石階上，新的對話和行動依次發生，剛才的字樣沒有中斷這個情節。",
      "直到天色將明，這一章的正文才真正結束。",
    ].join("\n");

    expect(cleanXbanxiaStoryText(narrative)).toBe(narrative);
  });

  it("merges consecutive catalog entries with the same chapter number", () => {
    const ref = (id: string, number: number, title: string): StoryChapterReference => ({
      id, number, title, numberLabel: `第${number}章`, order: number, url: `https://www.timotxt.com/book12/${id}.html`,
      partUrls: [`https://www.timotxt.com/book12/${id}.html`], isIntroduction: false, selectedByDefault: true,
    });
    const merged = mergeContinuationEntries([
      ref("12", 12, "入宫上"), ref("12_2", 12, "入宫下"), ref("13", 13, "新章"),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.partUrls).toEqual([
      "https://www.timotxt.com/book12/12.html",
      "https://www.timotxt.com/book12/12_2.html",
    ]);
  });

  it("does not merge two Huliwang chapters that only happen to reuse a display number", () => {
    const entries: StoryChapterReference[] = ["22", "23"].map((key, index) => ({
      id: key, number: 22, numberLabel: "第22章", title: index ? "候场" : "化妆间八卦二",
      order: index, url: `https://m.huliwang.net/1703891/${key}.html`,
      partUrls: [`https://m.huliwang.net/1703891/${key}.html`], isIntroduction: false, selectedByDefault: true,
    }));
    expect(mergeContinuationEntries(entries)).toHaveLength(2);
  });

  it("merges an adjacent Huliwang entry explicitly marked as a continuation", () => {
    const ref = (key: string, title: string): StoryChapterReference => ({
      id: key, number: 1, numberLabel: "第1章", title,
      order: Number.parseInt(key, 10), url: `https://m.huliwang.net/1703891/${key}.html`,
      partUrls: [`https://m.huliwang.net/1703891/${key}.html`], isIntroduction: false, selectedByDefault: true,
    });
    const merged = mergeContinuationEntries([ref("40", "今日归家"), ref("41", "续")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ title: "今日归家", order: 0 });
    expect(merged[0]?.partUrls).toEqual([
      "https://m.huliwang.net/1703891/40.html",
      "https://m.huliwang.net/1703891/41.html",
    ]);
  });

  it("merges paired Qingrenyouxi catalog titles but preserves the first title", () => {
    const ref = (key: string, title: string): StoryChapterReference => ({
      id: key, number: 7, numberLabel: "第七章", title,
      order: Number.parseInt(key, 10), url: `https://www.qingrenyouxi.com/book/114551/${key}.html`,
      partUrls: [`https://www.qingrenyouxi.com/book/114551/${key}.html`], isIntroduction: false, selectedByDefault: true,
    });
    const merged = mergeContinuationEntries([ref("33074751", "雨夜（上）"), ref("33074752", "雨夜（下）")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("雨夜（上）");
    expect(merged[0]?.partUrls).toHaveLength(2);
  });

  it("does not merge continuation-looking words, non-adjacent repeats, or reversed source IDs", () => {
    const ref = (key: string, number: number, title: string): StoryChapterReference => ({
      id: key, number, numberLabel: `第${number}章`, title,
      order: Number.parseInt(key, 10), url: `https://www.qingrenyouxi.com/book/114551/${key}.html`,
      partUrls: [`https://www.qingrenyouxi.com/book/114551/${key}.html`], isIntroduction: false, selectedByDefault: true,
    });
    expect(mergeContinuationEntries([
      ref("100", 1, "初见"), ref("101", 1, "续命之夜"), ref("102", 1, "下山"),
    ])).toHaveLength(3);
    expect(mergeContinuationEntries([
      ref("200", 1, "初见"), ref("201", 2, "新章"), ref("202", 1, "续"),
    ])).toHaveLength(3);
    expect(mergeContinuationEntries([
      ref("301", 1, "初见"), ref("300", 1, "续"),
    ])).toHaveLength(2);
  });

  it.each([
    ["第十二章 开端", 12],
    ["第一百零三章 重逢", 103],
    ["第两千一百章 终章", 2_100],
    ["第一万零二章 番外", 10_002],
    ["第〇九章 夜雨", 9],
  ])("parses Chinese chapter number %s", (label, number) => {
    expect(parseChapterLabel(label).number).toBe(number);
  });

  it("decodes pinned bqg sample and rejects an unknown Hangul codepoint", () => {
    const decoder = new TimotxtF24092Decoder();
    const decoded = decoder.decode({
      site: "timotxt",
      url: "https://www.timotxt.com/1509589610/13.html",
      // 剛子... 的... 他... 到...
      text: "剛떚看著小妹流下了眼淚，這是놛누家後놅心聲。",
      fontHash: TIMOTXT_BQG_FONT_HASH,
    });
    expect(decoded).toBe("剛子看著小妹流下了眼淚，這是他到家後的心聲。");
    expect(() => decoder.decode({
      site: "timotxt", url: "https://www.timotxt.com/1/1.html", text: "가", fontHash: TIMOTXT_BQG_FONT_HASH,
    })).toThrow(/U\+AC00/u);
  });

  it("rejects a different font hash", () => {
    const decoder = new TimotxtF24092Decoder();
    expect(() => decoder.decode({
      site: "timotxt", url: "https://www.timotxt.com/1/1.html", text: "놅", fontHash: "0".repeat(64),
    })).toThrow(/Hash font/u);
  });
});
