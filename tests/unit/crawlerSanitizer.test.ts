import { describe, expect, it } from 'vitest';
import { stripCrawlerNoise } from '../../src/core/crawlerSanitizer.js';

describe('crawlerSanitizer', () => {
  it('loại bỏ khối quảng cáo web game nhạy cảm / sắc dục khỏi đoạn văn', () => {
    const raw = `李向东笑着鼓励了下拉过来的壮丁，李小竹。
“小鸡~小鸡~我要玩~”
🔥 读完本章的人还在玩 · 真人互动多结局爽剧（你的选择决定主角生死）
假太监权谋
《假太监：从冷宫替身到六宫掌权者》
你是北境镇北王遗孤沈厌，隐瞒假太监真男儿之身潜入深宫。华清汤池水雾缭绕，久旷的皇贵妃苏玉环湿着石榴红蝉翼纱裙、赤足系着金铃求你替病危老皇帝借种留嗣；屏风外，垂帘听政的冷艳皇太后萧惊鸿手握凤尾金鞭破门验身；诏狱里罪臣千金林清欢雪踝戴着银链泣血求饶，御书房内女扮男装的少年女帝姬无双束胸白绫崩裂……伴君如伴虎，看你如何执掌司礼监生杀大权，夜夜翻牌六宫！
假太监权谋六宫绝色修罗场免下载秒玩
立即入局 ▸
⚡ 藏贵妃入水下🔥 贴身替太后探脉`;

    const cleaned = stripCrawlerNoise(raw);
    expect(cleaned).toContain('“小鸡~小鸡~我要玩~”');
    expect(cleaned).not.toContain('读完本章的人还在玩');
    expect(cleaned).not.toContain('假太监权谋');
    expect(cleaned).not.toContain('六宫绝色');
    expect(cleaned).not.toContain('藏贵妃入水下');
    expect(cleaned).not.toContain('贴身替太后探脉');
  });

  it('giữ nguyên văn bản truyện sạch không có quảng cáo', () => {
    const cleanText = `Chương 100: Bắt đầu hành trình mới\n\nNắng sớm chiếu rọi xuống mặt đất, anh bước đi thật nhanh.`;
    expect(stripCrawlerNoise(cleanText)).toBe(cleanText);
  });

  it('loại bỏ các dòng watermark crawl (bản chương hoàn, vị hoàn đãi tục)', () => {
    const raw = `Nội dung chương chính.\n\n本章完\n\n(本章未完，请点击下一页继续阅读)`;
    const cleaned = stripCrawlerNoise(raw);
    expect(cleaned).toBe('Nội dung chương chính.');
  });
});
