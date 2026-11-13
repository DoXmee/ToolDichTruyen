import { describe, expect, it } from 'vitest';
import { readGeminiTextResponse } from '../../src/main/gemini/geminiResponse';

const response = (parts: unknown[], finishReason = 'STOP') => ({ candidates: [{ content: { parts }, finishReason }] });

describe('Gemini non-streaming response reader', () => {
  it('joins parts without corrupting words, whitespace or split tags', () => {
    expect(readGeminiTextResponse(response([{ text: ' <BAN' }, { text: '_DICH>Tr' }, { text: 'ần Lạc' }, { text: '</BAN_DICH> ' }])))
      .toBe('<BAN_DICH>Trần Lạc</BAN_DICH>');
  });

  it('excludes thought and non-text parts while retaining later output', () => {
    expect(readGeminiTextResponse(response([{ text: 'private thought', thought: true }, { inlineData: {} }, { text: '  Nội ' }, { text: 'dung.  ' }])))
      .toBe('Nội dung.');
  });

  it('retains the single-part behavior and selects only the first candidate', () => {
    const data = response([{ text: '  Bản dịch.  ' }]);
    data.candidates.push({ content: { parts: [{ text: 'Không nối ứng viên khác.' }] }, finishReason: 'STOP' });
    expect(readGeminiTextResponse(data)).toBe('Bản dịch.');
  });

  it.each(['MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'FINISH_REASON_UNSPECIFIED'])('rejects %s even if text is present', (reason) => {
    expect(() => readGeminiTextResponse(response([{ text: 'Chưa xong' }], reason))).toThrow(reason);
  });

  it('rejects missing finish status instead of silently accepting potentially partial text', () => {
    expect(() => readGeminiTextResponse({ candidates: [{ content: { parts: [{ text: 'Một phần' }] } }] })).toThrow('thiếu finishReason');
  });

  it.each([null, {}, { candidates: [] }, response([]), response([{ text: 'reasoning only', thought: true }]), { promptFeedback: { blockReason: 'SAFETY' } }])('rejects empty or blocked responses', (data) => {
    expect(() => readGeminiTextResponse(data)).toThrow();
  });
});
