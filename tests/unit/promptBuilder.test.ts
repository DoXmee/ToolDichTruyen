import { describe, expect, it } from 'vitest';
import {
  buildContinuationRetryPrompt,
  buildContinuationTranslationPrompt,
  buildLocalizedHanRepairPrompt,
  buildRetryPrompt,
  buildTranslationPrompt,
  inferPromptMode,
  resolvePrompt,
  validateTranslation,
} from '../../src/core';

const catalog = {
  period: 'PROMPT NIÊN ĐẠI',
  modern: 'PROMPT HIỆN ĐẠI',
  ancient: 'PROMPT CỔ TRANG',
  cultivation: 'PROMPT TU TIÊN',
};

describe('prompt builder', () => {
  it('resolves the selected prompt and rejects a blank custom prompt', () => {
    expect(resolvePrompt({ mode: 'period' }, catalog)).toBe('PROMPT NIÊN ĐẠI');
    expect(resolvePrompt({ mode: 'modern' }, catalog)).toBe('PROMPT HIỆN ĐẠI');
    expect(resolvePrompt({ mode: 'ancient' }, catalog)).toBe('PROMPT CỔ TRANG');
    expect(resolvePrompt({ mode: 'cultivation' }, catalog)).toBe('PROMPT TU TIÊN');
    expect(resolvePrompt({ mode: 'custom', customPrompt: '  Riêng  ' }, catalog)).toBe(
      'Riêng',
    );
    expect(() => resolvePrompt({ mode: 'custom', customPrompt: ' ' }, catalog)).toThrow();
    expect(inferPromptMode('prompt mới', 'period')).toBe('custom');
  });

  it('builds a complete segment prompt with stable boundaries and glossary', () => {
    const prompt = buildTranslationPrompt({
      basePrompt: catalog.period,
      sourceText: '她走了。',
      segmentIndex: 1,
      totalSegments: 3,
      segmentId: 'job/2',
      glossary: '林安 = Lâm An',
    });

    expect(prompt).toContain('PROMPT NIÊN ĐẠI');
    expect(prompt).toContain('VỊ TRÍ: 2/3');
    expect(prompt).toContain('MÃ ĐOẠN: job-2');
    expect(prompt).toContain('林安 = Lâm An');
    expect(prompt).toContain('<NGUYEN_BAN id="job-2">\n她走了。');
    expect(prompt).toContain('Chỉ trả về bản dịch hoàn chỉnh');
  });

  it('builds a retry prompt with the base prompt, source, and faulty samples only', () => {
    const source = '中'.repeat(60);
    const previousTranslation = 'Bản dịch: 中…';
    const validation = validateTranslation(source, previousTranslation);
    const prompt = buildRetryPrompt({
      basePrompt: catalog.modern,
      sourceText: source,
      previousTranslation,
      validation,
      attempt: 2,
      segmentIndex: 0,
      totalSegments: 1,
    });

    expect(prompt).toContain('DỊCH LẠI ĐOẠN NÀY (LẦN 2)');
    expect(prompt).toContain('[han_remaining]');
    expect(prompt).toContain('[too_short]');
    expect(prompt).toContain(catalog.modern);
    expect(prompt).toContain(source);
    expect(prompt).not.toContain('BẢN DỊCH TRƯỚC CÓ LỖI');
    expect(prompt).not.toContain('<BAN_DICH_LOI>');
    expect(prompt).toContain('dịch TOÀN BỘ đoạn nguồn dưới đây từ đầu');
  });

  it('builds a base-prompt batch Han repair with stable target codes', () => {
    const prompt = buildLocalizedHanRepairPrompt({
      basePrompt: catalog.modern,
      targets: [
        { targetId: 'segment/1:han:12', sentence: 'Cô nhìn 他 rồi quay đi.' },
        { targetId: 'segment/1:han:48', sentence: 'Cô ấy gọi 她 lại.' },
      ],
      attempt: 2,
      hanSample: '他她',
    });

    expect(prompt).toContain(catalog.modern);
    expect(prompt).toContain('SỬA CỤC BỘ 2 CÂU LỖI (LẦN 2)');
    expect(prompt).toContain('<CAU_CAN_SUA id="segment-1-han-12">');
    expect(prompt).toContain('<CAU_CAN_SUA id="segment-1-han-48">');
    expect(prompt).toContain('<CAU_DA_SUA id="segment-1-han-12">');
    expect(prompt).toContain('<CAU_DA_SUA id="segment-1-han-48">');
    expect(prompt).toContain('Cô nhìn 他 rồi quay đi.');
    expect(prompt).toContain('đủ 2 thẻ CAU_DA_SUA');
    expect(prompt).not.toContain('<NGUYEN_BAN');
    expect(prompt).not.toContain('<BAN_DICH_LOI>');
    expect(prompt).not.toContain('Nội dung còn lại của cả chương');
  });

  it('builds compact continuation prompts without repeating the base prompt', () => {
    const source = '她继续向前走。';
    const continuation = buildContinuationTranslationPrompt({
      basePrompt: catalog.modern,
      sourceText: source,
      segmentIndex: 1,
      totalSegments: 3,
    });
    const validation = validateTranslation(source, 'Bản dịch: Cô tiếp tục bước đi.');
    const retry = buildContinuationRetryPrompt({
      basePrompt: catalog.modern,
      sourceText: source,
      previousTranslation: 'Bản dịch: Cô tiếp tục bước đi.',
      validation,
      attempt: 2,
      segmentIndex: 1,
      totalSegments: 3,
    });

    expect(continuation).toContain('TIẾP TỤC TRONG CÙNG TÁC VỤ DỊCH');
    expect(continuation).toContain(source);
    expect(retry).toContain('TIẾP TỤC SỬA ĐOẠN HIỆN TẠI TRONG CÙNG CHAT');
    expect(retry).toContain('assistant_preamble');
    expect(continuation).not.toContain(catalog.modern);
    expect(retry).not.toContain(catalog.modern);
  });
});
