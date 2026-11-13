/** Read one complete, non-streaming generateContent candidate without losing text parts. */
export function readGeminiTextResponse(data: unknown): string {
  const payload = data as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: unknown; thought?: boolean }> };
    }>;
  } | null;
  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const fail = (reason: string): never => {
    const error = new Error(`Gemini API: ${reason}. Không dùng phản hồi này làm bản dịch hoàn chỉnh.`);
    Object.assign(error, { name: 'GeminiGenerationResponseError', code: 'GEMINI_INCOMPLETE_RESPONSE', finishReason });
    throw error;
  };
  if (payload?.promptFeedback?.blockReason) {
    fail(`yêu cầu bị chặn (${payload.promptFeedback.blockReason})`);
  }
  if (!candidate) fail('không có ứng viên trả lời');
  if (finishReason !== 'STOP') {
    fail(finishReason === 'MAX_TOKENS'
      ? 'phản hồi bị cắt do đạt giới hạn đầu ra (MAX_TOKENS)'
      : `phản hồi chưa kết thúc hợp lệ (${finishReason || 'thiếu finishReason'})`);
  }
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) fail('thiếu phần nội dung trả lời');
  // A boundary may be inside a word or a tag: do not insert separators or trim each part.
  const text = parts!
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();
  if (!text) fail('không có nội dung văn bản sau khi bỏ phần suy nghĩ');
  return text;
}
