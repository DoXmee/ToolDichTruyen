import { describe, expect, it } from 'vitest';
import { findCrossTranslationRepetition, validateTranslation } from '../../src/core';

function issueCodes(source: string, translation: string): string[] {
  return validateTranslation(source, translation).issues.map((issue) => issue.code);
}

describe('translation validator', () => {
  it('accepts a complete Vietnamese translation without Han characters', () => {
    const result = validateTranslation(
      '她走进房间。',
      'Cô bước vào căn phòng rồi khép cửa lại.',
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects empty responses and remaining Han characters', () => {
    expect(issueCodes('你好', '')).toContain('empty');

    const result = validateTranslation('她走了。', 'Cô ấy 走 rồi.');
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('han_remaining');
    expect(result.hanCharacters[0]).toMatchObject({ character: '走' });
  });

  it('detects abnormally short responses for substantial source text', () => {
    expect(issueCodes('中'.repeat(100), 'Xong.')).toContain('too_short');
  });

  it('detects a long Chinese chapter whose beginning was omitted from the translation', () => {
    const source = Array.from({ length: 42 }, (_, index) =>
      `這是第${index + 1}段原文，人物繼續交談並推動故事發展，還包含需要完整保留的重要細節。`,
    ).join('\n');
    const translation = Array.from({ length: 15 }, (_, index) =>
      `Đây là phần cuối số ${index + 1}, câu chuyện tiếp tục.`,
    ).join('\n');
    const result = validateTranslation(source, translation, {
      minimumLengthRatio: 0.2,
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'likely_truncated',
      sample: expect.stringContaining('đoạn 36%'),
    }));
  });

  it('allows a complete translation that merges source paragraphs', () => {
    const source = Array.from({ length: 20 }, (_, index) =>
      `這是第${index + 1}段完整原文，人物正在交談並繼續推動故事發展。`,
    ).join('\n');
    const translation = Array.from({ length: 8 }, (_, paragraphIndex) =>
      Array.from({ length: 3 }, (_, sentenceIndex) =>
        `Nội dung đầy đủ của nhóm ${paragraphIndex + 1}, câu ${sentenceIndex + 1}, được chuyển sang tiếng Việt rõ ràng.`,
      ).join(' '),
    ).join('\n');

    expect(issueCodes(source, translation)).not.toContain('likely_truncated');
  });

  it('detects assistant preambles, error responses, and source echo', () => {
    expect(
      issueCodes('她走进房间。', 'Dưới đây là bản dịch: Cô bước vào phòng.'),
    ).toContain('assistant_preamble');
    expect(issueCodes('Chương 1: 开始', 'Bài viết\n\nChương 1: Mở đầu\n\nNội dung.'))
      .toContain('assistant_preamble');
    expect(issueCodes('Chương 1: 开始', 'Article\nChapter 1: Opening\n\nContent.'))
      .toContain('assistant_preamble');
    expect(issueCodes('你好', 'Something went wrong.')).toContain('error_response');
    expect(issueCodes('你好', 'Bạn đã đạt giới hạn sử dụng, hãy thử lại sau.'))
      .toContain('error_response');
    expect(issueCodes('你好', 'Please take a break and try again later.'))
      .toContain('error_response');

    const source = '这是一个足够长的原文段落，用于检查模型是否直接重复原文。';
    expect(issueCodes(source, source)).toContain('source_echo');
  });

  it('rejects an internal ownership marker leaked into the translated output', () => {
    const marker = 'TDTOWN_0123456789abcdef0123456789abcdef';
    const result = validateTranslation(
      '她走进房间。',
      `Cô bước vào phòng. ${marker}`,
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'ownership_marker_leak',
      sample: marker,
    }));
  });

  it('does not reject valid output merely because a chunk ends at punctuation or an open quote', () => {
    expect(issueCodes('她说了很多话', 'Cô ấy nói rằng mọi chuyện sẽ ổn…')).not.toContain(
      'likely_truncated',
    );
    expect(issueCodes('她打开门', 'Cô mở (cánh cửa.')).not.toContain('likely_truncated');
    expect(issueCodes('他转身对主任说道：', 'Anh quay người, nói với chủ nhiệm…'))
      .not.toContain('likely_truncated');
    expect(issueCodes('她若真的只是一個二十來歲的小姑娘，', 'Nếu cô thật sự chỉ là một cô gái hơn hai mươi tuổi,'))
      .not.toContain('likely_truncated');
    expect(issueCodes('就是不知道沈流芳说话管用不管用。\n……', 'Chỉ không biết lời Thẩm Lưu Phương nói có tác dụng hay không.\n\n……'))
      .not.toContain('likely_truncated');
    expect(issueCodes('他说：“', 'Anh nói: “'))
      .not.toContain('likely_truncated');

    const repeated = Array(3).fill(
      'Cô quay người bước ra khỏi căn phòng, khép cánh cửa thật nhẹ rồi đi dọc hành lang vắng lặng. Ngoài cửa sổ, mưa phùn vẫn rơi đều trên mái hiên tối màu.',
    ).join('\n\n');
    expect(issueCodes('她离开了房间。', repeated)).toContain('repetition');
  });

  it('allows a short natural sentence repeated in different story contexts', () => {
    const translation = [
      'Lâm Mỹ Ngôn khẽ thở dài. Cô nhìn ra bến xe và chờ Từ Mẫn đến.',
      'Sau khi nghe về cô em gái, Lâm Mỹ Ngôn khẽ thở dài. Cô biết đứa trẻ ấy rất vất vả.',
      'Lâm Mỹ Ngôn khẽ thở dài. Sau đó cô nhắc Từ Mẫn phải nắm lấy cơ hội cuối cùng.',
    ].join('\n\n');

    expect(issueCodes('原文 đủ dài để kiểm tra', translation)).not.toContain('repetition');
  });

  it('detects a paraphrased replay of the previous chapter when the sources differ', () => {
    const previousTranslation = Array.from({ length: 180 }, (_, index) =>
      `Tô Uyển kiểm tra hũ muối số ${index}, sau đó nhắc mẹ Ngô cẩn thận với kế hoạch của Hiểu Tuệ.`).join('\n\n');
    const currentTranslation = [
      ...Array.from({ length: 15 }, (_, index) =>
        `Bữa cơm hiện tại bắt đầu với câu chuyện mới số ${index}.`),
      ...Array.from({ length: 180 }, (_, index) =>
        `Tô Uyển kiểm tra hũ muối số ${index}, sau đó nhắc mẹ Ngô cẩn thận với kế hoạch của Hiểu Tuệ.`),
    ].join('\n\n');
    const result = findCrossTranslationRepetition(
      `Chương 33\n\n${'新的晚餐情節'.repeat(120)}`,
      currentTranslation,
      [{
        segmentIndex: 31,
        sourceText: `Chương 32\n\n${'廠房與盐罐的故事'.repeat(120)}`,
        translatedText: previousTranslation,
      }],
    );

    expect(result).toMatchObject({ previousSegmentIndex: 31 });
    expect(result?.translationSimilarity).toBeGreaterThan(0.24);
    expect(result?.sourceSimilarity).toBeLessThan(0.18);
  });

  it('allows similar translations when the source itself is also repeated', () => {
    const translation = Array.from({ length: 90 }, (_, index) =>
      `Nhân vật tiếp tục cuộc trò chuyện dài số ${index} trong cùng một cảnh.`).join('\n\n');
    const source = '同一段原文內容'.repeat(150);
    expect(findCrossTranslationRepetition(source, translation, [{
      segmentIndex: 4,
      sourceText: source,
      translatedText: translation,
    }])).toBeNull();
  });

  it('bảo toàn số lượng và thứ tự tiêu đề chương trong nguồn web', () => {
    const source = 'Chương 10: 重逢\n\n原文一。\n\nChương 11: 回家\n\n原文二。';
    const valid = validateTranslation(
      source,
      'Chương 10: Gặp lại\n\nNội dung một.\n\nChương 11: Về nhà\n\nNội dung hai.',
      { minimumSourceLengthForRatioCheck: Number.MAX_SAFE_INTEGER },
    );
    const missing = validateTranslation(
      source,
      'Chương 10: Gặp lại\n\nNội dung một và hai.',
      { minimumSourceLengthForRatioCheck: Number.MAX_SAFE_INTEGER },
    );

    expect(valid.issues.map((issue) => issue.code)).not.toContain('chapter_structure');
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: 'chapter_structure' }));
  });

  it('supports selectively disabling heuristic checks', () => {
    const result = validateTranslation('你好', '你好…', {
      requireNoHan: false,
      checkTruncation: false,
    });
    expect(result.valid).toBe(true);
  });
});
