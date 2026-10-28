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
  return `${basePrompt}\n\n---\nYÊU CẦU CHO ĐOẠN HIỆN TẠI:
- Dịch đầy đủ toàn bộ phần nằm trong thẻ NGUYEN_BAN sang tiếng Việt, không để lại chữ Hán.
- BẢO TOÀN TIÊU ĐỀ CHƯƠNG: Nếu trong NGUYEN_BAN có tiêu đề chương (ví dụ 'Chương 108: ...'), bản dịch BẮT BUỘC dịch đúng số chương đó, tuyệt đối không lặp lại số chương của đoạn trước.
- ÁP DỤNG XƯNG HÔ THUẦN VIỆT: Đảo danh xưng lên trước họ tên (ông/bà/chú/bác/thím/anh/chị), tuyệt đối không dịch âm Hán Việt thô cứng (tẩu, thẩm, thúc, nãi nãi, ca). Giữ đồng nhất cách gọi của từng nhân vật từ đầu đến cuối bản dịch.
- QUY ƯỚC TÊN NGOẠI QUỐC: Tên người ngoại quốc (phương Tây, Liên Xô/Nga...) BẮT BUỘC dùng chữ cái Latinh quốc tế chuẩn duy nhất (ví dụ: Jelina, Aina, Karijia, Edlian, John), TUYỆT ĐỐI CẤM dùng âm Hán Việt thô (Ái Na, Ca Lệ Giai, Giê-lin-ca, Na Mâu Nhĩ, E-đơ-lin). Mọi tên gọi thân mật kết thúc bằng đuôi -ka (như 耶莲卡 / 耶莲娜) BẮT BUỘC quy về MỘT tên Latinh duy nhất (Jelina).
- Không thêm lời dẫn, giải thích hay ghi chú.
- Chỉ trả về bản dịch hoàn chỉnh bên trong thẻ <BAN_DICH id="${safeSegmentId(input)}">...</BAN_DICH>. Bản dịch phải kết thúc sạch sẽ, tuyệt đối không chèn dấu "[" hay mã JSON vào cuối bài dịch.
- BẮT BUỘC TRÍCH XUẤT TẤT CẢ TÊN RIÊNG, TÊN RÚT GỌN VÀ BIỆT DANH CHƯA KHÓA: Mọi tên riêng người thật (bao gồm cả tên gọi rút gọn bỏ họ như 秀麗 -> Tú Lệ, biệt danh cố định như 剛子 -> Cương Tử dù nhân vật đã từng xuất hiện), địa danh, hoặc trường học, cơ quan, đoàn thể, xí nghiệp, bệnh viện trong đoạn nguồn mà chưa có trong ngoặc ⟦ ⟧, dù chỉ xuất hiện 1 lần, BẮT BUỘC phải xuất vào thẻ <THUC_THE_MOI>[{"category": "character"|"location"|"organization", "zh": "tên Hán", "vi": "Tên Latinh (người ngoại quốc) hoặc Hán-Việt (người TQ)", "aliases": ["tên biến thể/thân mật Hán tự nếu có"], "gender": "Nam/Nữ/Chưa rõ", "role": "vai vế nếu có, chưa rõ thì ghi null", "notes": "mô tả nếu có, chưa rõ thì ghi null"}]</THUC_THE_MOI>. Không được vì chưa rõ thân phận mà bỏ qua tên riêng. Nếu không có tên mới nào thì trả về <THUC_THE_MOI>[]</THUC_THE_MOI>.\n\n${commonEnvelope(input)}`;
}

export function buildContinuationTranslationPrompt(input: TranslationPromptInput): string {
  return `TIẾP TỤC TRONG CÙNG TÁC VỤ DỊCH:
- Áp dụng toàn bộ quy tắc đã thống nhất ở đầu chat; giữ nguyên hệ thống tên riêng, thuật ngữ, cách xưng hô và giọng văn từ các đoạn trước.
- BẢO TOÀN TIÊU ĐỀ CHƯƠNG: Dịch đúng số tiêu đề chương có trong thẻ NGUYEN_BAN, tuyệt đối không lặp lại số chương của đoạn trước.
- XƯNG HÔ THUẦN VIỆT ĐỒNG NHẤT: Đảo danh xưng lên trước họ tên (ông/bà/chú/bác/thím/anh/chị), tránh âm Hán Việt thô (tẩu, thẩm, thúc, nãi nãi, ca).
- QUY ƯỚC TÊN NGOẠI QUỐC: Tên người ngoại quốc (phương Tây, Nga...) BẮT BUỘC dùng chữ cái Latinh quốc tế chuẩn duy nhất (ví dụ: Jelina, Aina, Karijia, Edlian, John), TUYỆT ĐỐI CẤM dùng âm Hán Việt thô và quy các biến thể thân mật (-ka) về một tên Latinh duy nhất.
- Dịch đầy đủ phần trong thẻ NGUYEN_BAN, không để lại chữ Hán.
- Không thêm lời dẫn, giải thích hay ghi chú.
- Chỉ trả về bản dịch hoàn chỉnh của đoạn hiện tại bên trong thẻ <BAN_DICH id="${safeSegmentId(input)}">...</BAN_DICH>. Tuyệt đối không để dấu "[" ở cuối bản dịch.
- BẮT BUỘC XUẤT THỰC THỂ MỚI: Mọi tên riêng người thật (bao gồm cả tên gọi rút gọn bỏ họ như 秀麗 -> Tú Lệ, biệt danh cố định như 剛子 -> Cương Tử dù nhân vật đã từng xuất hiện), địa danh, trường học, cơ quan, xí nghiệp chưa có trong ngoặc ⟦ ⟧ BẮT BUỘC phải trích xuất vào thẻ <THUC_THE_MOI>[...]</THUC_THE_MOI> (dùng tên Latinh cho người ngoại quốc; chưa rõ vai vế ghi null, không được bỏ qua tên; nếu không có tên mới trả về <THUC_THE_MOI>[]</THUC_THE_MOI>).\n\n${commonEnvelope(input)}`;
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
  const stillFaultyNotice = attempt > 1
    ? '\nVẪN LỖI: Phản hồi trước chưa dịch hết chữ Hán hoặc câu trả về vẫn còn ký tự Hán. Hãy dịch triệt để các chữ Hán sang tiếng Việt thuần túy.'
    : '';

  const targetBlocks = targets
    .map((target) => `<CAU_CAN_SUA id="${target.targetId}">\n${target.sentence}\n</CAU_CAN_SUA>`)
    .join('\n\n');
  const responseBlocks = targets
    .map((target) => `<CAU_DA_SUA id="${target.targetId}">câu tiếng Việt đã sửa</CAU_DA_SUA>`)
    .join('\n');

  return `${promptPrefix}\n\n---\nSỬA CỤC BỘ ${targets.length} CÂU LỖI (LẦN ${attempt})${hanSample}${stillFaultyNotice}\n\nMỗi câu trong các thẻ CAU_CAN_SUA dưới đây có chữ Hán còn sót.\n- Dịch triệt để, thoát ý các chữ Hán còn sót sang từ ngữ tiếng Việt tự nhiên, phù hợp với ngữ cảnh câu chuyện (tuyệt đối KHÔNG giữ lại bất kỳ ký tự Hán nào, không phiên âm thô cứng nhắc, giữ nguyên các tên riêng và thuật ngữ đã dịch).\n- Sửa tất cả các câu, giữ nguyên ý nghĩa, giọng văn, tên riêng và dấu câu của từng câu.\n- Không viết lại bất kỳ nội dung nào ngoài các câu đã đưa.\n- Không thêm lời dẫn, giải thích, ghi chú, đánh số hoặc văn bản ngoài các thẻ trả lời.\n- Mỗi thẻ trả lời phải chứa đúng MỘT câu tiếng Việt đã sửa, không có chữ Hán.\n- Trả về đủ ${targets.length} thẻ CAU_DA_SUA, đúng mã id tương ứng, mỗi mã chỉ một lần, theo mẫu:\n${responseBlocks}\n\n${targetBlocks}\n\nChỉ trả về các thẻ CAU_DA_SUA đã sửa.`;
}

export const buildRepairPrompt = buildRetryPrompt;
