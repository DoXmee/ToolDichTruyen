import type {
  PromptCatalog,
  PromptMode,
  PromptSelection,
  RetryPromptInput,
  TranslationPromptInput,
} from '../shared';

export interface LocalizedHanRepairTarget {
  targetId: string;
  sentence: string;
}

export interface LocalizedHanRepairPromptInput {
  basePrompt: string;
  /**
   * Legacy single-target fields.  They deliberately remain supported because
   * a one-sentence repair can be answered as plain text without a wrapper.
   */
  sentence?: string;
  targetId?: string;
  /** All faulty sentences for one bounded local repair request. */
  targets?: readonly LocalizedHanRepairTarget[];
  attempt: number;
  hanSample?: string;
  includeBasePrompt?: boolean;
}

function requireText(value: string, name: string): string {
  const result = (value ?? '').normalize('NFC').trim();
  if (!result) throw new Error(`${name} must not be empty.`);
  return result;
}

function safeSegmentId(input: TranslationPromptInput): string {
  const fallback = `segment-${input.segmentIndex + 1}`;
  const value = (input.segmentId || fallback).replace(/[^A-Za-z0-9_-]/g, '-');
  return value || fallback;
}

function segmentLabel(input: TranslationPromptInput): string {
  const current = Math.max(1, Math.trunc(input.segmentIndex) + 1);
  const total = Math.max(current, Math.trunc(input.totalSegments) || current);
  return `${current}/${total}`;
}

/** The custom option takes effect only when it contains a usable prompt. */
export function inferPromptMode(customPrompt: string, currentMode: PromptMode): PromptMode {
  return customPrompt.trim() ? 'custom' : currentMode;
}

export function resolvePrompt(selection: PromptSelection, catalog: PromptCatalog): string {
  switch (selection.mode) {
    case 'period':
      return requireText(catalog.period, 'period prompt');
    case 'modern':
      return requireText(catalog.modern, 'modern prompt');
    case 'ancient':
      return requireText(catalog.ancient, 'ancient prompt');
    case 'cultivation':
      return requireText(catalog.cultivation, 'cultivation prompt');
    case 'custom':
      return requireText(selection.customPrompt ?? '', 'custom prompt');
  }
}

function commonEnvelope(input: TranslationPromptInput): string {
  const sourceText = requireText(input.sourceText, 'sourceText');
  const id = safeSegmentId(input);
  const glossary = input.glossary?.trim()
    ? `\n\nTHUẬT NGỮ / QUY ƯỚC BỔ SUNG:\n${input.glossary.trim()}`
    : '';

  return `MÃ ĐOẠN: ${id}\nVỊ TRÍ: ${segmentLabel(input)}${glossary}\n\n<NGUYEN_BAN id="${id}">\n${sourceText}\n</NGUYEN_BAN>`;
}

export function buildTranslationPrompt(input: TranslationPromptInput): string {
  const basePrompt = requireText(input.basePrompt, 'basePrompt');
  return `${basePrompt}\n\n---\nYÊU CẦU CHO ĐOẠN HIỆN TẠI:\n- Dịch đầy đủ toàn bộ phần nằm trong thẻ NGUYEN_BAN sang tiếng Việt.\n- Giữ nhất quán tên riêng, thuật ngữ và cách xưng hô với các đoạn trước.\n- Không để lại chữ Hán, không thêm lời dẫn, giải thích, ghi chú hay thẻ đánh dấu.\n- Chỉ trả về bản dịch hoàn chỉnh của đoạn này.\n\n${commonEnvelope(input)}`;
}

export function buildContinuationTranslationPrompt(input: TranslationPromptInput): string {
  return `TIẾP TỤC TRONG CÙNG TÁC VỤ DỊCH:\n- Áp dụng toàn bộ quy tắc đã thống nhất ở đầu chat; giữ nguyên hệ thống tên riêng, thuật ngữ, cách xưng hô và giọng văn từ các đoạn trước.\n- Dịch đầy đủ phần trong thẻ NGUYEN_BAN, không để lại chữ Hán.\n- Không thêm lời dẫn, giải thích, ghi chú hay thẻ đánh dấu.\n- Chỉ trả về bản dịch hoàn chỉnh của đoạn hiện tại.\n\n${commonEnvelope(input)}`;
}

export function buildRetryPrompt(input: RetryPromptInput): string {
  const basePrompt = requireText(input.basePrompt, 'basePrompt');
  const attempt = Math.max(1, Math.trunc(input.attempt));
  const issues = input.validation.issues.length
    ? input.validation.issues
        .map(
          (issue, index) =>
            `${index + 1}. [${issue.code}] ${issue.message}${
              issue.sample ? ` (mẫu: ${issue.sample})` : ''
            }`,
        )
        .join('\n')
    : '1. [unknown] Bản dịch chưa vượt qua bước kiểm tra.';

  // Do not paste an entire bad answer back into the conversation. It can make
  // the model anchor on a repeated/truncated answer and it buries the base
  // translation rules. Validation samples identify the parts that need extra
  // attention; the complete source remains the sole text to translate.
  return `${basePrompt}\n\n---\nDỊCH LẠI ĐOẠN NÀY (LẦN ${attempt}):\nCác lỗi/phần cần chú ý:\n${issues}\n\nHãy áp dụng lại đầy đủ prompt gốc, dịch TOÀN BỘ đoạn nguồn dưới đây từ đầu và đặc biệt sửa các lỗi/phần vừa liệt kê. Không tham chiếu, lặp lại hay sửa nối tiếp bản dịch cũ. Không thêm lời dẫn, giải thích, ghi chú hoặc thẻ đánh dấu.\n\n${commonEnvelope(input)}\n\nChỉ trả về bản dịch tiếng Việt hoàn chỉnh đã sửa.`;
}

export function buildContinuationRetryPrompt(input: RetryPromptInput): string {
  const attempt = Math.max(1, Math.trunc(input.attempt));
  const issues = input.validation.issues.length
    ? input.validation.issues
        .map(
          (issue, index) =>
            `${index + 1}. [${issue.code}] ${issue.message}${
              issue.sample ? ` (mẫu: ${issue.sample})` : ''
            }`,
        )
        .join('\n')
    : '1. [unknown] Bản dịch chưa vượt qua bước kiểm tra.';

  return `TIẾP TỤC SỬA ĐOẠN HIỆN TẠI TRONG CÙNG CHAT (LẦN ${attempt}):\n- Giữ toàn bộ quy tắc, tên riêng, thuật ngữ và cách xưng hô đã thống nhất.\n- Các lỗi/phần cần chú ý:\n${issues}\n\nHãy dịch lại TOÀN BỘ đoạn nguồn từ đầu, đặc biệt sửa các lỗi/phần vừa liệt kê. Không tham chiếu hoặc sửa nối tiếp bản dịch cũ. Không thêm lời dẫn, giải thích, ghi chú hoặc thẻ đánh dấu.\n\n${commonEnvelope(input)}\n\nChỉ trả về bản dịch tiếng Việt hoàn chỉnh đã sửa.`;
}

function safeTargetId(value: string): string {
  const normalized = (value ?? '').normalize('NFC').trim().replace(/[^A-Za-z0-9_-]/g, '-');
  return normalized || 'han-repair';
}

function localizedRepairTargets(input: LocalizedHanRepairPromptInput): LocalizedHanRepairTarget[] {
  if (input.targets?.length) {
    return input.targets.map((target) => ({
      targetId: safeTargetId(target.targetId),
      sentence: requireText(target.sentence, 'target sentence'),
    }));
  }

  return [{
    targetId: safeTargetId(input.targetId ?? ''),
    sentence: requireText(input.sentence ?? '', 'sentence'),
  }];
}

/**
 * Builds a deliberately narrow follow-up for a translation with a small
 * number of stray Han characters.  The complete source/translation remains
 * absent so ChatGPT cannot rewrite the rest of the segment.  A batch request
 * carries every faulty sentence at once, and the runner applies the returned
 * replacements by their stable target IDs.
 */
export function buildLocalizedHanRepairPrompt(
  input: LocalizedHanRepairPromptInput,
): string {
  const promptPrefix = input.includeBasePrompt === false
    ? 'TIẾP TỤC ÁP DỤNG TOÀN BỘ QUY TẮC ĐÃ THỐNG NHẤT TRONG CHAT NÀY.'
    : requireText(input.basePrompt, 'basePrompt');
  const targets = localizedRepairTargets(input);
  const attempt = Math.max(1, Math.trunc(input.attempt));
  const hanSample = input.hanSample?.trim()
    ? `\nKÝ TỰ HÁN CẦN LOẠI BỎ: ${input.hanSample.trim()}`
    : '';

  const targetBlocks = targets
    .map((target) => `<CAU_CAN_SUA id="${target.targetId}">\n${target.sentence}\n</CAU_CAN_SUA>`)
    .join('\n\n');
  const responseBlocks = targets
    .map((target) => `<CAU_DA_SUA id="${target.targetId}">câu tiếng Việt đã sửa</CAU_DA_SUA>`)
    .join('\n');

  return `${promptPrefix}\n\n---\nSỬA CỤC BỘ ${targets.length} CÂU LỖI (LẦN ${attempt})${hanSample}\n\nMỗi câu trong các thẻ CAU_CAN_SUA dưới đây có chữ Hán còn sót.\n- Sửa tất cả các câu, giữ nguyên ý nghĩa, giọng văn, tên riêng và dấu câu của từng câu.\n- Không viết lại bất kỳ nội dung nào ngoài các câu đã đưa.\n- Không thêm lời dẫn, giải thích, ghi chú, đánh số hoặc văn bản ngoài các thẻ trả lời.\n- Mỗi thẻ trả lời phải chứa đúng MỘT câu tiếng Việt đã sửa, không có chữ Hán.\n- Trả về đủ ${targets.length} thẻ CAU_DA_SUA, đúng mã id tương ứng, mỗi mã chỉ một lần, theo mẫu:\n${responseBlocks}\n\n${targetBlocks}\n\nChỉ trả về các thẻ CAU_DA_SUA đã sửa.`;
}

export const buildRepairPrompt = buildRetryPrompt;
