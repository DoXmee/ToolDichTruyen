import { describe, expect, it } from 'vitest';
import { validateTranslation } from '../../src/core';

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

  it('detects assistant preambles, error responses, and source echo', () => {
    expect(
      issueCodes('她走进房间。', 'Dưới đây là bản dịch: Cô bước vào phòng.'),
    ).toContain('assistant_preamble');
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

  it('detects likely truncation and repeated output', () => {
    expect(issueCodes('她说了很多话', 'Cô ấy nói rằng mọi chuyện sẽ ổn…')).toContain(
      'likely_truncated',
    );
    expect(issueCodes('她打开门', 'Cô mở (cánh cửa.')).toContain('likely_truncated');
    expect(issueCodes('他转身对主任说道：', 'Anh quay người, nói với chủ nhiệm…'))
      .not.toContain('likely_truncated');
    expect(issueCodes('她若真的只是一個二十來歲的小姑娘，', 'Nếu cô thật sự chỉ là một cô gái hơn hai mươi tuổi,'))
      .not.toContain('likely_truncated');
    expect(issueCodes('就是不知道沈流芳说话管用不管用。\n……', 'Chỉ không biết lời Thẩm Lưu Phương nói có tác dụng hay không.\n\n……'))
      .not.toContain('likely_truncated');
    expect(issueCodes('他说：“', 'Anh nói: “'))
      .not.toContain('likely_truncated');

    const repeated = Array(3).fill('Cô quay người bước ra khỏi căn phòng.').join('\n');
    expect(issueCodes('她离开了房间。', repeated)).toContain('repetition');
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
