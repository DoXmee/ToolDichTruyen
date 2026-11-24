import { describe, it, expect } from 'vitest';
import {
  compileStoryBiblePrompt,
  getGenreProfile,
  isSafetyRefusalError,
  isSafetyRefusalResponse,
  splitSourceIntoBalancedHalves,
  type StoryBible,
} from '../../src/core/index.js';
import { ChatGptSafetyRefusalError } from '../../src/main/chatgpt/ChatGptWebAdapter.js';

describe('safetyRefusal helpers & prompt de-escalation', () => {
  it('detects Vietnamese and English safety refusal messages', () => {
    expect(
      isSafetyRefusalResponse(
        'Không thể hiển thị nội dung này vì lý do an toàn. Tìm hiểu thêm về cách chúng tôi tiếp cận các cuộc trò chuyện nhạy cảm.',
      ),
    ).toBe(true);
    expect(
      isSafetyRefusalResponse(
        "This content can’t be shown for safety reasons. Learn more about our approach to sensitive conversations.",
      ),
    ).toBe(true);
    expect(isSafetyRefusalResponse('Cô bước vào phòng và mỉm cười vì lý do an toàn công việc.')).toBe(false);
  });

  it('detects ChatGptSafetyRefusalError and cause chains without false positives on ordinary errors', () => {
    expect(isSafetyRefusalError(new ChatGptSafetyRefusalError('ChatGPT từ chối vì lý do an toàn: "..."'))).toBe(true);
    expect(isSafetyRefusalError({ isSafetyRefusal: true, message: 'blocked' })).toBe(true);
    expect(isSafetyRefusalError(new Error('Network timeout'))).toBe(false);
    expect(isSafetyRefusalError(new Error('han_remaining: sót chữ Hán'))).toBe(false);
  });

  it('splits source text cleanly into balanced halves without dropping any characters', () => {
    const source = [
      'Chương 954: Cuộc sống bình yên',
      'Đoạn văn thứ nhất kể về buổi sáng trong lành ở thôn quê với tiếng chim hót ríu rít ngoài sân.',
      'Đoạn văn thứ hai kể về bà Trương đang nhặt rau ngoài hiên và dặn dò mọi người nghỉ ngơi.',
      'Đoạn văn thứ ba nói về kế hoạch công việc tại hợp tác xã tín dụng gần nhà để tiện chăm sóc gia đình.',
      'Đoạn văn thứ tư kết thúc chuyến đi bằng lời chúc bình an và hẹn ngày đoàn tụ sắp tới.',
    ].join('\n');

    const halves = splitSourceIntoBalancedHalves(source);
    expect(halves).not.toBeNull();
    expect(`${halves![0]}\n${halves![1]}`).toBe(source);
    expect(halves![0].startsWith('Chương 954:')).toBe(true);
    expect(halves![1].length).toBeGreaterThanOrEqual(100);
  });

  it('omits sensitive entity role notes and tense markers only when safety recovery flags are enabled', () => {
    const bible: StoryBible = {
      schemaVersion: 2,
      profileId: 'period',
      entities: [
        {
          id: 'C1',
          category: 'character',
          zh: '韓靖琛',
          vi: 'Hàn Tĩnh Sâm',
          gender: 'male',
          role: 'Bị tính kế phát sinh quan hệ nhạy cảm',
          status: 'active',
        },
        {
          id: 'C2',
          category: 'character',
          zh: '顧婉晴',
          vi: 'Cố Uyển Tình',
          gender: 'female',
          role: 'Vợ của Hàn Tĩnh Sâm',
          status: 'active',
        },
      ],
      relations: [
        {
          id: 'R1',
          from: 'C1',
          to: 'C2',
          type: 'Vợ chồng',
          samples: ['mẫu 1', 'mẫu 2'],
          address: {
            aToB: { self: 'anh', call: 'em', tenseSelf: 'tôi', tenseCall: 'cô' },
            bToA: { self: 'em', call: 'anh', tenseSelf: 'tôi', tenseCall: 'anh' },
          },
        },
      ],
      timeline: [],
      pending: [],
      updatedAt: '2026-11-25T00:00:00.000Z',
    };

    const normal = compileStoryBiblePrompt({
      segmentId: 'V3-CH954',
      segmentIndex: 0,
      totalSegments: 1,
      sourceText: '韓靖琛看向顧婉晴。',
      bible,
      genreProfile: getGenreProfile('period'),
      sceneState: 'tense',
      executionMode: 'web',
      skipEntityExtraction: true,
    });
    expect(normal.fullPrompt).toContain('Vai vế: Bị tính kế phát sinh quan hệ nhạy cảm');
    expect(normal.fullPrompt).toContain('[CẢNH CĂNG THẲNG]');

    const sanitized = compileStoryBiblePrompt({
      segmentId: 'V3-CH954',
      segmentIndex: 0,
      totalSegments: 1,
      sourceText: '韓靖琛看向顧婉晴。',
      bible,
      genreProfile: getGenreProfile('period'),
      sceneState: 'tense',
      executionMode: 'web',
      skipEntityExtraction: true,
      omitEntityRoles: true,
      minimalSafetyContext: true,
    });
    expect(sanitized.fullPrompt).not.toContain('Bị tính kế phát sinh quan hệ nhạy cảm');
    expect(sanitized.fullPrompt).not.toContain('[CẢNH CĂNG THẲNG]');
    expect(sanitized.fullPrompt).toContain('⟦Hàn Tĩnh Sâm⟧');
    expect(sanitized.fullPrompt).toContain('⟦Cố Uyển Tình⟧');
  });
});
