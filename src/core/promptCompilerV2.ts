import type { GenreProfile } from './genreProfile.js';
import { lockNamesInSource, normalizeChineseNameForMatching, type LockableEntity } from './nameLocker.js';
import { stripCrawlerNoise } from './crawlerSanitizer.js';
import {
  resolveDirectionalAddress,
  type SceneState,
  type StoryBible,
  type StoryBibleEntity,
} from './storyBible.js';

export interface PromptCompilerInput {
  segmentId: string;
  segmentIndex: number;
  totalSegments: number;
  sourceText: string;
  bible: StoryBible;
  genreProfile: GenreProfile;
  sceneState?: SceneState;
  povCharacter?: StoryBibleEntity;
  previousSegmentTailZh?: string;
  previousSegmentTailVi?: string;
  previousSummary?: string;
  maxCharacters?: number;
  customPrompt?: string;
  isContinuationTurn?: boolean;
  skipEntityExtraction?: boolean;
  executionMode?: 'web' | 'api';
}

export interface CompiledPromptResult {
  fullPrompt: string;
  lockedSourceText: string;
  presentEntities: StoryBibleEntity[];
  matchedGlossaryTerms: Array<{ chinese: string; vietnamese: string }>;
  characterCount: number;
}

export function compileStoryBiblePrompt(input: PromptCompilerInput): CompiledPromptResult {
  const {
    segmentId,
    segmentIndex,
    totalSegments,
    sourceText,
    bible,
    genreProfile,
    sceneState = 'normal',
    povCharacter,
    previousSegmentTailZh,
    previousSegmentTailVi,
    previousSummary,
    maxCharacters: customMaxChars,
    customPrompt,
  } = input;
  const maxCharacters = input.executionMode === 'web' ? 11_000 : (customMaxChars ?? 13_000);

  // 0. Sanitize crawler noise & interactive ads from source text
  const cleanSourceText = stripCrawlerNoise(sourceText);

  // 1. Scan entities present in source text (Longest match first)
  const activeEntities = bible.entities.filter((e) => e.status !== 'candidate');
  const matchingSource = normalizeChineseNameForMatching(cleanSourceText);
  const presentEntities = activeEntities.filter(
    (e) => Boolean(e.zh.trim()) && (matchingSource.includes(normalizeChineseNameForMatching(e.zh))
      || e.aliases?.some((a) => Boolean(a.zh.trim()) && matchingSource.includes(normalizeChineseNameForMatching(a.zh)))),
  );

  // 2. Lock names mechanically in source text: 顾国强 -> ⟦Cố Quốc Cường⟧
  const lockableEntities: LockableEntity[] = presentEntities.map((e) => ({
    id: e.id,
    chinese: e.zh,
    vietnamese: e.vi,
    aliases: e.aliases?.map((a) => ({ zh: a.zh, viDisplay: a.viDisplay })),
    ambiguous: e.aliases?.some((a) => a.ambiguousWith?.length),
  }));

  const { lockedSourceText } = lockNamesInSource(cleanSourceText, lockableEntities);

  // 3. Scan Genre Glossary terms present in source text
  const matchedGlossaryTerms: Array<{ chinese: string; vietnamese: string }> = [];
  if (genreProfile.glossary?.length) {
    for (const term of genreProfile.glossary) {
      if (cleanSourceText.includes(term.chinese)) {
        matchedGlossaryTerms.push({
          chinese: term.chinese,
          vietnamese: term.vietnamese,
        });
      }
    }
  }

  // --- BUILD 8 CANONICAL BLOCKS ---

  // KHỐI A: LUẬT KỸ THUẬT LÕI & CHỈ ĐẠO DỊCH THUẬT
  const hasCustomPrompt = Boolean(customPrompt?.trim());
  const maxCustomPromptLen = input.executionMode === 'web' ? 3000 : 8000;
  const sanitizedCustomPrompt = customPrompt ? customPrompt.trim().slice(0, maxCustomPromptLen) : '';

  const technicalRules = [
    `1. DỊCH ĐỦ 100% NỘI DUNG THUẦN VIỆT: Dịch trọn vẹn, không tóm tắt, không bỏ sót câu/đoạn, không để lại bất kỳ chữ Hán nào. CHỈ XUẤT TIẾNG VIỆT THUẦN TÚY: Tuyệt đối không chèn câu chào/lời dẫn tiếng Anh (như 'Let's', 'Here is') vào bài dịch.`,
    `2. BẢO TOÀN TIÊU ĐỀ & SỐ THỨ TỰ CHƯƠNG (BẮT BUỘC): Nếu trong nguồn <NGUYEN_BAN> có tiêu đề chương (ví dụ "Chương 108: ..."), bản dịch BẮT BUỘC phải dịch đúng số chương đó. TUYỆT ĐỐI KHÔNG lặp lại số chương của đoạn trước và không tự ý nhảy số chương. Nếu trong nguồn KHÔNG có tiêu đề chương (đoạn tiếp diễn của chương dài), TUYỆT ĐỐI KHÔNG tự bịa ra tiêu đề chương mới!`,
    `3. NGUYÊN TẮC GIỮ NGUYÊN TÊN TRONG NGOẶC (BẮT BUỘC): Mọi danh từ riêng đã được đóng ngoặc ⟦...⟧ BẮT BUỘC PHẢI GIỮ NGUYÊN vẹn cả dấu ngoặc và nội dung bên trong. NGHIÊM CẤM TỰ Ý SỬA TÊN, VIẾT TẮT HOẶC LÀM RỤNG KÝ TỰ: Tuyệt đối giữ nguyên vẹn từng ký tự và dấu thanh tiếng Việt ('Lục Thời Dã' CẤM thành 'Lục Thời D', 'Chu Húc' CẤM thành 'Châu').
   - CẤM TỰ Ý ĐỔI HỌ HOẶC SỬA TÊN NHÂN VẬT ĐÃ KHÓA: Nếu tên đóng ngoặc là ⟦Tống Quốc Xương⟧, NGHIÊM CẤM tự ý đổi thành 'Quách Quốc Xương' hay bất kỳ họ nào khác. Tên trong ngoặc là định danh tuyệt đối bất khả xâm phạm!
   - TUYỆT ĐỐI CẤM DỊCH TÊN NGƯỜI / CHỮ HÁN SANG TIẾNG ANH: Không bao giờ được dịch chữ Hán thành từ tiếng Anh (CẤM '从飞' -> 'From Phi', CẤM 'Jack', 'Mary'...), trừ khi nguyên tác chữ Hán ghi rõ là người phương Tây có tên tiếng Anh rõ ràng.
   - CHÍNH TẢ & ĐỊA DANH BẮT BUỘC: '京都' BẮT BUỘC là 'Kinh Đô' (TUYỆT ĐỐI CẤM 'Kyoto'); '蘭城'/'兰城' BẮT BUỘC là 'Lan Thành' (CẤM 'Lan Châu', CẤM 'Lân Thành'); '深圳'/'深市' BẮT BUỘC là 'Thâm Quyến' (CẤM 'Thâm Puyến', 'Thâm Cuyến'); 'Thương Tuyết' (CẤM 'Thường Tuyết'); 'Từ Ngọc Trân' (CẤM 'Tú Ngọc Trân'); Họ '周' nhân vật bắt buộc là 'Chu' (Chu Doanh Trưởng, anh Chu, Lão Chu), CẤM dịch thành 'Châu' (trừ 'Quảng Châu'); '苞米屯' BẮT BUỘC là 'thôn Bắp Ngô' (CẤM 'Bắp Ngô Tấn').
   - CHUẨN MỰC CHÍNH TẢ TIẾNG VIỆT: Nghiêm cấm xuất ra các chuỗi ký tự lỗi gõ phím Telex (như 'alwcf', 'chajy', 'rz', 'dnah', 'dug', 'ldim', 'monic'). Toàn bộ câu từ phải là tiếng Việt chuẩn mực, đúng ngữ pháp và từ ngữ từ điển.`,
  ];

  const customPromptSection = `4. CHỈ ĐẠO VĂN PHONG RIÊNG TỪ NGƯỜI DÙNG (ƯU TIÊN TUÂN THỦ CAO NHẤT):\n${sanitizedCustomPrompt}`;

  const defaultGenreRules = `4. QUY ƯỚC TỪ LÓNG THỜI ĐẠI & TÊN NGOẠI QUỐC:
   - Từ lóng & địa danh: "漂亮国" -> "Mỹ" (CẤM "Bình Lượng Quốc"); "老大哥" -> "Liên Xô"; "华国" -> "Trung Quốc"; "海市" -> "Thượng Hải"; "广市" -> "Quảng Châu"; "深市" -> "Thâm Quyến"; "港城" -> "Hồng Kông"; "澳门" -> "Ma Cao".
   - Chức danh thời đại: "厂长" BẮT BUỘC dịch là "xưởng trưởng" / "giám đốc xưởng" (NGHIÊM CẤM "Hán Trưởng"); "副厂长" -> "phó xưởng trưởng"; "书记" -> "bí thư"; "大队长" -> "đại đội trưởng"; "营长" -> "doanh trưởng".
   - Tên người ngoại quốc: BẮT BUỘC dùng chữ cái Latinh quốc tế duy nhất (Jelina, Aina, Karijia, Edlian, John), CẤM dùng âm Hán Việt thô (Kiệt Lâm Ca, Ca Lệ Giai, Ái Na...) và quy biến thể thân mật (-ka) về một tên Latinh duy nhất.
   - BIỆT DANH & TÊN THÂN MẬT (THUẦN VIỆT): Dịch nghĩa tiếng Việt dễ thương hoặc âm Hán Việt quen thuộc (泡芙 -> Bánh Su Nhỏ, 豆豆 -> Đậu Đậu...), CẤM dịch sang tiếng Anh. Nhất quán họ tên chuẩn (họ 曹 là Tào, họ 郝 là Hách, chữ 荣 là Vinh, chữ 橙 là Tranh).
   - QUY TẮC CHÍNH TẢ & VIẾT HOA (BẮT BUỘC):
      + CHỈ VIẾT HOA: Tên riêng người cụ thể, địa danh hành chính cấp quốc gia/tỉnh/thành phố.
      + TUYỆT ĐỐI VIẾT THƯỜNG:
        * Danh từ chung nơi chốn/cơ quan: đại viện, quân khu, công xưởng, bệnh viện, trường học; miền nam, đại lục; chức vụ (bác sĩ, tiểu đoàn trưởng).
        * Cụm gia đình họ tộc: nhà họ Khang, nhà họ Viên (chữ "nhà họ" BẮT BUỘC viết thường, TUYỆT ĐỐI KHÔNG dịch thành "Khang Gia", "Viên Gia" hay viết hoa "Nhà họ").
5. QUY CHUẨN XƯNG HÔ THUẦN VIỆT TOÀN DIỆN (BẮT BUỘC ĐẢO VỊ TRÍ & THUẦN HÓA 100%):
   - NGUYÊN TẮC CỐT LÕI: Tiếng Trung đặt danh xưng thân tộc/vai vế ở SAU họ tên ([Tên/Họ] + Danh xưng), Tiếng Việt BẮT BUỘC ĐẢO LÊN TRƯỚC ([Danh xưng thuần Việt] + [Tên/Họ]).
   - QUY TẮC XƯNG HÔ THEO NGỮ CẢNH & BƯỚC NGOẶT CỐT TRUYỆN:
      + Mọi quy ước xưng hô cung cấp ở KHỐI E là MẪU XƯNG HÔ THAM KHẢO ghi nhận từ các phân cảnh trước.
      + Khi có BƯỚC NGOẶT CỐT TRUYỆN (kết hôn sang vợ - chồng, mâu thuẫn sang tôi - anh), BẮT BUỘC ưu tiên mạch truyện thực tế, KHÔNG bị gò ép bởi mẫu cũ.
   - TUYỆT ĐỐI CẤM giữ nguyên âm Hán-Việt thô cứng theo 3 tầng bậc toàn diện sau:
     + TẦNG 1: BẬC ÔNG BÀ / CỤ (TRÊN 2 THẾ HỆ):
       * [Họ/Tên] + 爺 / 爺爺 / 姥爺: BẮT BUỘC dịch là "ông [Tên/Họ]" hoặc "cụ [Tên/Họ]" (TUYỆT ĐỐI CẤM: Gia gia, Lão gia).
       * [Họ/Tên] + 奶 / 奶奶 / 婆 / 婆婆 / 姥姥: BẮT BUỘC dịch là "bà [Tên/Họ]", "bà nội [Họ]", "bà ngoại [Họ]" hoặc "bà cụ [Họ]" (Ví dụ: 陳奶奶 -> dịch là "bà Trần" hoặc "bà nội họ Trần"; TUYỆT ĐỐI CẤM: "Trần nãi nãi", "Nãi nãi", "Bà bà").
     + TẦNG 2: BẬC CHA CHÚ BÁC CÔ DÌ THÍM MỢ DƯỢNG (TRÊN 1 THẾ HỆ):
       * Cha/Bố: 爸 / 爸爸 / 父亲 / [Họ]+父: BẮT BUỘC dùng từ "bố" (bố, bố mẹ, hai bố con, bố chồng, bố vợ...). TUYỆT ĐỐI CẤM dùng "cha". Với [Họ]+父 (như 秦父): dịch là "bố [Họ]" (bố Tần), CẤM âm Hán-Việt "Tần Phụ".
       * Nam: 叔/叔叔/小叔 -> "chú [Họ]"; 伯/大伯/伯父 -> "bác [Họ]"; 舅/舅舅 -> "cậu [Họ]"; 姑父/姨夫/姑丈/姨丈 -> "dượng [Họ]" (CẤM: Thúc, Bá phụ, Cữu cữu, Cô trượng).
       * Nữ: 嬸/嬸子/嬸嬸 -> "thím [Họ]"; 娘/大娘/伯母 -> "bác gái [Họ]"; 姑/姑姑/姑媽 -> "cô [Họ]"; 姨/姨媽/小姨 -> "dì [Họ]"; 舅媽/舅母 -> "mợ [Họ]" (CẤM: Thẩm, Đại Nương, Cô cô, Di mụ, Cữu mẫu).
       * [Họ] + 嫂 / 嫂子: BẮT BUỘC dịch là "thím [Họ]" hoặc "chị dâu [Họ]" (Ví dụ: 張嫂子 -> dịch là "thím Trương" hoặc "chị dâu Trương"; TUYỆT ĐỐI CẤM: "Trương Tẩu Tử", "Trương Tẩu").
     + TẦNG 3: BẬC ĐỒNG LỨA / NGANG VAI:
       * Lớn hơn: [Tên] + 哥 / 哥哥 -> "anh [Tên]" (Ví dụ: 大飛哥 -> "anh Đại Phi"; TUYỆT ĐỐI CẤM: "Đại Phi Ca", "Ca"); [Tên] + 姐 / 姐姐 -> "chị [Tên]" (Ví dụ: 小花姐 -> "chị Tiểu Hoa"; TUYỆT ĐỐI CẤM: "Tiểu Hoa Tỷ", "Tỷ").
       * Nhỏ hơn: [Tên] + 弟 / 弟弟 -> "em trai [Tên]" hoặc "em [Tên]" (TUYỆT ĐỐI CẤM: "Đệ"); [Tên] + 妹 / 妹妹 -> "em gái [Tên]" hoặc "em [Tên]" (TUYỆT ĐỐI CẤM: "Muội").
       * ĐỐI THOẠI GIA ĐÌNH (EM - CHỊ): Em trai nói chuyện thân mật với chị gái BẮT BUỘC xưng "em", CẤM tự xưng "tôi".`;

  const ruleGarbage = `${hasCustomPrompt ? '5' : '6'}. BỎ QUA NỘI DUNG RÁC & LỜI NHẮN TÁC GIẢ (BẮT BUỘC): Bỏ qua hoàn toàn các dòng ghi chú, lời nhắn của tác giả ở cuối chương/đoạn (như xin vé tháng, xin hoa, phát bao lì xì, trò chuyện ngoài truyện, ??99, ??66...). Chỉ dịch phần nội dung cốt truyện chính, tuyệt đối không dịch những lời nhắn tác giả này vào bản dịch.`;
  const ruleOutput = `${hasCustomPrompt ? '6' : '7'}. ĐẦU RA BẮT BUỘC: Đặt toàn bộ bản dịch tiếng Việt bên trong cặp thẻ <BAN_DICH id="${segmentId}"> ... </BAN_DICH>. Bản dịch phải kết thúc sạch sẽ và trọn vẹn, TUYỆT ĐỐI KHÔNG CHÈN DẤU NGOẶC VUÔNG "[" HOẶC MÃ JSON VÀO CUỐI BẢN DỊCH.`;

  const blockA = [
    `### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC`,
    ...technicalRules,
    hasCustomPrompt ? customPromptSection : defaultGenreRules,
    ruleGarbage,
    ruleOutput,
  ].join('\n');

  // KHỐI B: THẺ BỐI CẢNH (Context Card)
  const povStr = povCharacter ? `${povCharacter.vi} (${povCharacter.zh})` : 'Góc nhìn ngôi thứ ba';
  const presentNamesStr = presentEntities.length
    ? presentEntities.map((e) => `${e.vi} (${e.zh})`).join(', ')
    : 'Chưa xác định';
  const blockB = `### KHỐI B: THẺ BỐI CẢNH
- Thể loại: ${genreProfile.name}
- Thời kỳ: ${genreProfile.worldRules.eraRange || 'Theo nguyên tác'}
- Điểm nhìn (POV): ${povStr}
- Nhân vật xuất hiện trong đoạn: ${presentNamesStr}
- Trạng thái cảnh: ${sceneState === 'tense' || sceneState === 'hostile' ? 'ĐỐI ĐẦU / CĂNG THẲNG' : 'Bình thường'}`;

  // KHỐI A & B RÚT GỌN CHO LƯỢT TIẾP TỤC TRONG CÙNG CHAT (BẢO LƯU 100% CẤM KỴ & MỎ NEO CỐT LÕI)
  const technicalContinuationRules = [
    `1. Dịch đủ 100% nội dung, không tóm tắt, không bỏ sót câu/đoạn, không để lại bất kỳ chữ Hán nào.`,
    `2. BẢO TOÀN TIÊU ĐỀ & SỐ THỨ TỰ CHƯƠNG (BẮT BUỘC): Nếu trong nguồn <NGUYEN_BAN> có tiêu đề chương (ví dụ "Chương ${segmentIndex + 1}: ..."), bản dịch BẮT BUỘC dịch đúng số chương đó. TUYỆT ĐỐI KHÔNG lặp lại số chương của đoạn trước và không tự ý nhảy số chương. Nếu trong nguồn KHÔNG có tiêu đề chương (đoạn tiếp diễn của chương dài), TUYỆT ĐỐI KHÔNG tự bịa ra tiêu đề chương mới!`,
    `3. BẢO TOÀN 100% DANH TỪ TRONG NGOẶC ⟦...⟧: Mọi danh từ riêng đã được đóng ngoặc ⟦...⟧ BẮT BUỘC PHẢI GIỮ NGUYÊN vẹn cả dấu ngoặc và nội dung bên trong (Ví dụ: ⟦Cố Quốc Cường⟧ phải xuất hiện đúng dạng ⟦Cố Quốc Cường⟧ trong bản dịch). CẤM làm rụng chữ (như Lục Thời D), CẤM đổi họ Chu thành Châu. '深圳'/'深市' BẮT BUỘC là 'Thâm Quyến' (CẤM 'Thâm Puyến', 'Thâm Cuyến'). Em trai nói chuyện thân mật với chị gái xưng 'em', CẤM xưng 'tôi'.`,
  ];

  const defaultContinuationRules = `4. QUY ƯỚC TÊN NGOẠI QUỐC: Tên người ngoại quốc (phương Tây, Liên Xô/Nga...) BẮT BUỘC dùng chữ cái Latinh quốc tế chuẩn duy nhất (ví dụ: Jelina, Aina, Karijia, Edlian, John), TUYỆT ĐỐI CẤM dùng âm Hán-Việt (Ái Na, Ca Lệ Giai, Giê-lin-ca, E-đơ-lin) và quy biến thể thân mật (-ka) về một tên Latinh duy nhất.
   - BIỆT DANH / TÊN THÂN MẬT (泡芙 -> Bánh Su Nhỏ...): Dịch nghĩa tiếng Việt dễ thương, TUYỆT ĐỐI CẤM dịch sang tiếng Anh (như Puff...). Nhất quán họ tên chuẩn (họ 曹 là Tào, họ 郝 là Hách, chữ 荣 là Vinh, chữ 橙 là Tranh).
5. QUY CHUẨN XƯNG HÔ THUẦN VIỆT & MẪU XƯNG HÔ THAM KHẢO:
   - XƯNG HÔ GIA ĐÌNH (BỐ/MẸ): Danh xưng người cha (爸/爸爸/父亲/[Họ]+父) LUÔN dùng từ "bố" (bố, bố mẹ, hai bố con, bố [Họ] như bố Tần...), TUYỆT ĐỐI KHÔNG dùng "cha" hay âm Hán-Việt "Tần Phụ".
   - ĐẢO VỊ TRÍ DANH XƯNG LÊN TRƯỚC: [Danh xưng thuần Việt] + [Tên/Họ] (ông/bà/chú/bác/cô/dì/thím/anh/chị...; TUYỆT ĐỐI CẤM giữ nguyên âm Hán-Việt thô như thẩm, thúc, tẩu, nãi nãi, bá phụ, tỷ, ca).
   - MẪU XƯNG HÔ THAM KHẢO TỪ CÁC PHÂN CẢNH TRƯỚC: Mọi xưng hô cung cấp ở KHỐI E là mẫu tham khảo. Khi cốt truyện có BƯỚC NGOẶT QUAN HỆ (kết hôn chuyển sang gọi vợ - chồng, cãi vã mâu thuẫn chuyển sang tôi - anh...) có đầy đủ dữ kiện, BẮT BUỘC ưu tiên mạch truyện thực tế, KHÔNG bị gò ép bởi mẫu cũ.
   - QUY TẮC CHÍNH TẢ & VIẾT HOA: Không viết hoa danh từ chung (đại viện, quân khu, công xưởng, miền nam, đại lục, nhà họ...). Chỉ viết hoa tên riêng người và địa danh hành chính.
6. BẢO ĐỒNG BỘ ĐẠI TỪ DẪN TRUYỆN: Đại từ ngôi thứ ba trần thuật (anh/chị/hắn/nàng...) phải đồng bộ tuyệt đối với xưng hô trong đối thoại của phân cảnh.`;

  const blockAContinuation = [
    `### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC (MỎ NEO CỐT LÕI)`,
    ...technicalContinuationRules,
    hasCustomPrompt ? customPromptSection : defaultContinuationRules,
    `${hasCustomPrompt ? '5' : '7'}. BỎ QUA NỘI DUNG RÁC & LỜI NHẮN TÁC GIẢ: Bỏ qua hoàn toàn các dòng ghi chú, lời nhắn của tác giả ở cuối chương/đoạn (như xin vé tháng, xin hoa, phát bao lì xì, ??99, ??66...). Chỉ dịch phần nội dung cốt truyện chính, tuyệt đối không dịch những lời nhắn tác giả này vào bản dịch.`,
    `${hasCustomPrompt ? '6' : '8'}. ĐẦU RA BẮT BUỘC: Đặt toàn bộ bản dịch tiếng Việt bên trong cặp thẻ <BAN_DICH id="${segmentId}"> ... </BAN_DICH>. Bản dịch phải kết thúc sạch sẽ, TUYỆT ĐỐI KHÔNG CHÈN DẤU NGOẶC VUÔNG "[" HOẶC MÃ JSON VÀO CUỐI BẢN DỊCH.`,
  ].join('\n');

  const blockBContinuation = `### KHỐI B: THẺ BỐI CẢNH
- Thể loại: ${genreProfile.name} | Thời kỳ: ${genreProfile.worldRules.eraRange || 'Theo nguyên tác'} | POV: ${povStr} | Nhân vật trong đoạn: ${presentNamesStr} | Trạng thái: ${sceneState === 'tense' || sceneState === 'hostile' ? 'ĐỐI ĐẦU / CĂNG THẲNG' : 'Bình thường'}`;

  // KHỐI C: GÓI LIÊN TỤC (Continuity Packet)
  const continuityLines: string[] = [];
  if (previousSummary) {
    continuityLines.push(`- Tóm tắt diễn biến vừa qua: ${previousSummary}`);
  }
  if (previousSegmentTailVi) {
    continuityLines.push(`- Câu cuối đoạn trước (bản dịch): "...${previousSegmentTailVi}"`);
  }
  let blockC = continuityLines.length
    ? `### KHỐI C: MẠCH TRUYỆN LIÊN TỤC\n${continuityLines.join('\n')}`
    : `### KHỐI C: MẠCH TRUYỆN LIÊN TỤC\n- Bắt đầu phân đoạn mới / Mạch truyện tiếp diễn liền mạch.`;

  // KHỐI D: NHÂN VẬT & ĐẠI TỪ DẪN TRUYỆN
  const charEntities = presentEntities.filter((e) => e.category === 'character');
  // Sắp xếp nhân vật theo tần suất xuất hiện trong đoạn nguồn để ưu tiên nhân vật chính khi cần rút gọn
  charEntities.sort((a, b) => {
    const countA = (cleanSourceText.match(new RegExp(a.zh, 'g')) || []).length;
    const countB = (cleanSourceText.match(new RegExp(b.zh, 'g')) || []).length;
    return countB - countA;
  });

  const buildBlockD = (entities: StoryBibleEntity[]) => {
    const lines: string[] = [];
    for (const ent of entities) {
      const genderStr = ent.gender === 'male' ? 'Nam' : ent.gender === 'female' ? 'Nữ' : 'Chưa rõ';
      const pronounStr = ent.narrationPronoun ? ` | Đại từ dẫn truyện: "${ent.narrationPronoun}"` : '';
      const roleStr = ent.role ? ` | Vai vế: ${ent.role}` : '';
      const aliasStr = ent.aliases?.length ? ` [Bí danh/tên gọi khác: ${ent.aliases.map((a) => a.zh).join(', ')}]` : '';
      lines.push(`- ${ent.zh} -> ${ent.vi}${aliasStr} (${genderStr}${pronounStr}${roleStr})`);
    }
    return lines.length
      ? `### KHỐI D: QUY ƯỚC NHÂN VẬT & ĐẠI TỪ DẪN TRUYỆN\n${lines.join('\n')}`
      : `### KHỐI D: QUY ƯỚC NHÂN VẬT & ĐẠI TỪ DẪN TRUYỆN\n- Chưa có nhân vật cần khóa trong phân đoạn này.`;
  };

  let blockD = buildBlockD(charEntities);

  // KHỐI E: MA TRẬN XƯNG HÔ CÓ HƯỚNG (2 CHIỀU) & ĐỒNG BỘ NGÔI KỂ
  interface MatchedRelation {
    charA: StoryBibleEntity;
    charB: StoryBibleEntity;
    rel: any;
  }
  const matchedRelations: MatchedRelation[] = [];
  for (let i = 0; i < presentEntities.length; i++) {
    for (let j = i + 1; j < presentEntities.length; j++) {
      const charA = presentEntities[i]!;
      const charB = presentEntities[j]!;
      if (charA.category !== 'character' || charB.category !== 'character') continue;

      const rel = bible.relations.find(
        (r) =>
          (r.from === charA.id && r.to === charB.id) ||
          (r.from === charB.id && r.to === charA.id),
      );
      if (!rel) continue; // Chỉ đưa vào các cặp nhân vật thực sự có thiết lập quan hệ

      matchedRelations.push({ charA, charB, rel });
    }
  }

  const buildBlockE = (relations: MatchedRelation[]) => {
    const header =
      `### KHỐI E: MẪU XƯNG HÔ THAM KHẢO (GỢI Ý LINH HOẠT - TUYỆT ĐỐI KHÔNG KHÓA CỨNG)\n` +
      `- Dưới đây là MẪU GỢI Ý THAM KHẢO theo ngữ cảnh. Khi có BƯỚC NGOẶT CỐT TRUYỆN (kết hôn sang vợ - chồng, mâu thuẫn sang tôi - anh...), BẮT BUỘC ưu tiên mạch truyện thực tế, KHÔNG gò ép bởi mẫu cũ.\n` +
      `- Đại từ ngôi thứ ba trần thuật (anh/chị/hắn/nàng) PHẢI ĐỒNG BỘ với xưng hô trong đối thoại.`;
    if (relations.length === 0) {
      return `${header}\n- Không có quan hệ tương tác đặc biệt cần tham khảo trong đoạn này.`;
    }

    const lines: string[] = [];
    for (const { charA, charB, rel } of relations) {
      const addrAB = resolveDirectionalAddress(charA, charB, rel, sceneState, genreProfile);
      const addrBA = resolveDirectionalAddress(charB, charA, rel, sceneState, genreProfile);

      const extraSamples = rel.samples && rel.samples.length > 1 ? ` (Mẫu đã ghi nhận: ${rel.samples.join(' / ')})` : '';

      lines.push(
        `- ${charA.vi} -> ${charB.vi}: Tự xưng "${addrAB.self}", gọi đối phương "${addrAB.call}"${extraSamples}${
          addrAB.isTense ? ' [CẢNH CĂNG THẲNG]' : ''
        }`,
      );
      lines.push(
        `- ${charB.vi} -> ${charA.vi}: Tự xưng "${addrBA.self}", gọi đối phương "${addrBA.call}"${
          addrBA.isTense ? ' [CẢNH CĂNG THẲNG]' : ''
        }`,
      );
    }
    return `${header}\n${lines.join('\n')}`;
  };

  let activeRelations = matchedRelations.slice(0, 8);
  let blockE = buildBlockE(activeRelations);

  // KHỐI F: THUẬT NGỮ THỂ LOẠI XUẤT HIỆN TRONG ĐOẠN
  const termLines: string[] = [];
  for (const t of matchedGlossaryTerms) {
    termLines.push(`- ${t.chinese} -> ${t.vietnamese}`);
  }
  const termCategory = genreProfile.id === 'period' ? 'NIÊN ĐẠI' : 'THỂ LOẠI';
  let blockF = termLines.length
    ? `### KHỐI F: THUẬT NGỮ ${termCategory} TRONG ĐOẠN (BẮT BUỘC DỊCH CHUẨN)\n${termLines.join('\n')}`
    : '';

  // KHỐI G: NGUỒN TIẾNG HÁN ĐÃ KHÓA TÊN BẰNG ⟦ ⟧
  const blockG = `### KHỐI G: NGUỒN CẦN DỊCH (ĐÃ KHÓA TÊN BẰNG ⟦ ⟧)\nVỊ TRÍ: ${segmentIndex + 1}/${totalSegments}\n\n<NGUYEN_BAN id="${segmentId}">\n${lockedSourceText}\n</NGUYEN_BAN>`;

  // KHỐI H: KHUNG ĐẦU RA BẮT BUỘC
  const blockHNoExtraction = `### KHỐI H: YÊU CẦU ĐẦU RA
ĐẶT TOÀN BỘ BẢN DỊCH TIẾNG VIỆT HOÀN CHỈNH BÊN TRONG CẶP THẺ:
<BAN_DICH id="${segmentId}">
bản dịch tiếng Việt tại đây
</BAN_DICH>
(Quy tắc tuyệt đối: Chỉ trả về nội dung bản dịch bên trong thẻ BAN_DICH, không thêm lời chào, giải thích, hay bất kỳ nội dung nào ngoài truyện).`;

  const blockHWithExtraction = `### KHỐI H: YÊU CẦU ĐẦU RA
1. BẢN DỊCH CHÍNH: Đặt toàn bộ bản dịch tiếng Việt hoàn chỉnh bên trong thẻ:
<BAN_DICH id="${segmentId}">
bản dịch tiếng Việt tại đây
</BAN_DICH>
(LƯU Ý CỰC KỲ QUAN TRỌNG: Không được để dấu "[" hoặc bất kỳ nội dung nào khác ở cuối thẻ <BAN_DICH>).

2. BẮT BUỘC TRÍCH XUẤT TẤT CẢ CÁC TÊN RIÊNG, TÊN RÚT GỌN VÀ BIỆT DANH CHƯA ĐƯỢC KHÓA BẰNG ⟦ ⟧:
Cuối mỗi lượt dịch (bên ngoài thẻ BAN_DICH), BẮT BUỘC xuất thẻ <THUC_THE_MOI>...</THUC_THE_MOI>.
Nếu trong đoạn không có tên riêng/biệt danh mới nào chưa khóa thì BẮT BUỘC TRẢ VỀ <THUC_THE_MOI>[]</THUC_THE_MOI>. TUYỆT ĐỐI KHÔNG xuất mã JSON trần, không để sót dấu ngoặc "[" và không để khối JSON trần ở cuối bản dịch.

- NGUYÊN TẮC BÓC TÁCH:
  + QUY TẮC NHÂN VẬT CÓ NHIỀU THÂN PHẬN / TÊN GIẢ / BÍ DANH (BẮT BUỘC): Nếu một nhân vật trong truyện sử dụng 2 thân phận, tên giả hoặc bí danh (ví dụ: tên thật là Ninh Tranh Vinh 宁峥嵘, thân phận bí mật/cải trang là Lam Hạc Thanh 蓝鹤清), TUYỆT ĐỐI CẤM gộp chung kèm dấu ngoặc như "宁峥嵘（蓝鹤清）". BẮT BUỘC PHẢI TÁCH THÀNH 2 BẢN GHI JSON RIÊNG BIỆT trong mảng (mỗi bản ghi chỉ có đúng 1 mặt chữ Hán và 1 tên tiếng Việt tương ứng: một bản ghi cho "宁峥嵘" -> "Ninh Tranh Vinh", một bản ghi cho "蓝鹤清" -> "Lam Hạc Thanh").
  + QUY TẮC CHỐNG TỪ ĐA NGHĨA & TỪ VỰNG THÔNG THƯỜNG:
    * CẤM XUẤT TỪ 1 CHỮ HÁN ĐƠN LẺ: Tuyệt đối không xuất thực thể chỉ gồm đúng 1 chữ Hán đơn lẻ (ví dụ: cấm chỉ xuất "单", "解", "乐", "白"). Nếu là họ người, BẮT BUỘC phải trích xuất kèm họ tên đầy đủ hoặc vai vế danh xưng (như "单雄信" -> Thiện Hùng Tín, "单先生" -> Thiện tiên sinh).
    * CẤM XUẤT TỪ NGỮ THÔNG THƯỜNG: Tuyệt đối không trích xuất các từ đóng vai trò tính từ, động từ, danh từ chung trong câu (như "夏天" mùa hè, "平凡" bình thường, "微笑" mỉm cười, "大家" mọi người, "同志" đồng chí...). Chỉ trích xuất khi từ đó 100% được dùng làm danh từ riêng chỉ người/địa danh.
  + ĐỐI VỚI NHÂN VẬT NGƯỜI TRUNG QUỐC:
    * Tên đầy đủ/chính thức: Điền tên Hán-Việt chuẩn (Proper Name: "Trần Đại Phi", "Kha Tiểu Hoa", "Ngô Tú Lệ").
    * TÊN GỌI RÚT GỌN (BỎ HỌ) VÀ BIỆT DANH / TÊN THÂN MẬT CỐ ĐỊNH CHƯA KHÓA BẰNG ⟦ ⟧: Dù nhân vật gốc đã xuất hiện từ trước, nếu trong đoạn văn nhân vật được gọi độc lập bằng tên rút gọn bỏ họ (ví dụ: "秀麗" của Ngô Tú Lệ, "安然" của Lý An Nhiên) hoặc biệt danh/tên thân mật cố định (ví dụ: "剛子" của Lý Học Cương), BẮT BUỘC phải trích xuất thành thực thể riêng với âm Hán-Việt tương ứng ("秀麗" -> "Tú Lệ", "剛子" -> "Cương Tử", "安然" -> "An Nhiên") để hệ thống khóa mỏ neo đồng bộ cho các chương tiếp theo.
    * TUYỆT ĐỐI CẤM đưa từ mô tả, nhãn hệ thống hoặc danh từ chung (大家夥兒, 小家夥, 小腦袋, 孩子, 姑娘) vào trường "vi".
  + ĐỐI VỚI NHÂN VẬT NGOẠI QUỐC (Phương Tây, Liên Xô/Nga...): BẮT BUỘC ĐIỀN TÊN CHỮ CÁI LATINH QUỐC TẾ CHUẨN DUY NHẤT (ví dụ: "Jelina", "Aina", "Karijia", "Edlian", "John"). TUYỆT ĐỐI KHÔNG dùng âm Hán Việt (như Ái Na, Ca Lệ Giai, Giê-lin-ca). Nếu nhân vật có tên thân mật (như 耶莲卡 của 耶莲娜), điền tên Latinh chính thức ("Jelina") vào "vi" và đưa biến thể Hán tự ("耶莲卡") vào mảng "aliases".
  + BẮT BUỘC TƯỚC BỎ TỪ XƯNG HÔ THÂN TỘC KHỎI TÊN RIÊNG: Chỉ trích xuất tên gốc hoặc biệt danh vào "character" (陳大飛, 向海松, 柯小花, 剛子). Không kẹp 哥, 姐, 叔, 嬸, 嫂, 娘, 爺, 奶 vào tên riêng; quan hệ xưng hô đưa vào category: "relation".
    * "大飛哥" -> trích xuất tên gốc "陳大飛" (Trần Đại Phi) hoặc "大飛" (Đại Phi), CẤM "Đại Phi Ca".
    * "海松叔" -> "向海松" (Hướng Hải Tùng), CẤM "Hải Tùng Thúc".
    * "小花姐" -> "柯小花" (Kha Tiểu Hoa), CẤM "Tiểu Hoa Tỷ".
    * "張嫂子" / "趙大娘" -> Danh xưng quan hệ/vai vế, KHÔNG PHẢI tên riêng; CẤM "Trương Tẩu Tử", "Đại Nương".
  + Tương tác xưng hô thân tộc hoặc bước ngoặt xưng hô mới (như kết hôn, đổi vai vế) đưa vào category "relation" (ví dụ: charA: "Thư Thư", charB: "Trần Đại Phi", relation: "Vợ chồng", aToB: "em - anh", bToA: "anh - em") để hệ thống tự động ghi nhận thêm mẫu xưng hô mới.
- XỬ LÝ THÔNG TIN THIẾU HOẶC CHƯA RÕ:
  + Nếu chưa rõ nam hay nữ: để "gender": "Chưa rõ" (hoặc "Không").
  + Thân phận/vai vế: nếu có dữ kiện thì ghi rõ, NẾU CHƯA CÓ THÌ ĐỂ null HOẶC CHUỖI RỖNG "". TUYỆT ĐỐI KHÔNG ĐƯỢC ĐOÁN MÒ.
- ĐỊNH DẠNG XUẤT BẮT BUỘC:
<THUC_THE_MOI>
[
  { "category": "character", "zh": "Tên chữ Hán", "vi": "Tên Latinh (người ngoại quốc) hoặc Hán-Việt (người TQ)", "aliases": ["tên biến thể/thân mật Hán tự nếu có"], "gender": "Nam" | "Nữ" | "Chưa rõ", "role": "Thân phận hoặc null" },
  { "category": "location", "zh": "Tên địa danh", "vi": "Phiên âm Hán-Việt chuẩn", "notes": "Mô tả nếu có hoặc null" },
  { "category": "organization", "zh": "Tên cơ quan/tổ chức", "vi": "Phiên âm Hán-Việt chuẩn", "notes": "Mô tả vai trò hoặc null" },
  { "category": "relation", "charA": "Tên A", "charB": "Tên B", "relation": "Quan hệ giữa hai người", "aToB": "cách A xưng - gọi B", "bToA": "cách B xưng - gọi A" }
]
</THUC_THE_MOI>
- NẾU TRONG ĐOẠN 100% KHÔNG CÓ TÊN RIÊNG / TÊN RÚT GỌN / BIỆT DANH MỚI NÀO CHƯA KHÓA (tất cả đã nằm gọn trong ngoặc ⟦ ⟧): BẮT BUỘC TRẢ VỀ <THUC_THE_MOI>[]</THUC_THE_MOI>.`;

  const blockH = input.skipEntityExtraction ? blockHNoExtraction : blockHWithExtraction;

  // ASSEMBLE WITH PROGRESSIVE FIT-TO-BUDGET LOGIC
  const selectedBlockA = (input.isContinuationTurn || input.executionMode === 'web') ? blockAContinuation : blockA;
  let selectedBlockB = (input.isContinuationTurn || input.executionMode === 'web') ? blockBContinuation : blockB;
  let currentBlockH = blockH;
  const assemble = (includeC: boolean) => {
    const list = [selectedBlockA, selectedBlockB, includeC ? blockC : '', blockD, blockE, blockF, blockG, currentBlockH];
    return list.filter(Boolean).join('\n\n---\n\n');
  };

  let assembled = assemble(true);

  if (assembled.length > maxCharacters && continuityLines.length > 0) {
    // 1st trim: condense continuity packet to compact single line
    blockC = `### KHỐI C: MẠCH TRUYỆN LIÊN TỤC\n- Mạch truyện tiếp diễn liền mạch.`;
    assembled = assemble(true);
  }

  if (assembled.length > maxCharacters) {
    // 2nd trim: streamline block B context card
    selectedBlockB = `### KHỐI B: THẺ BỐI CẢNH\n- Thể loại: ${genreProfile.name} | POV: ${povStr} | Trạng thái: ${sceneState === 'tense' || sceneState === 'hostile' ? 'ĐỐI ĐẦU' : 'Bình thường'}`;
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && currentBlockH.length > 1500) {
    // 3rd trim: Streamline block H extraction guidelines while strictly preserving all rule assertions
    currentBlockH = `### KHỐI H: YÊU CẦU ĐẦU RA
1. BẢN DỊCH CHÍNH: Đặt toàn bộ bản dịch tiếng Việt hoàn chỉnh bên trong thẻ:
<BAN_DICH id="${segmentId}">
bản dịch tiếng Việt tại đây
</BAN_DICH>
(LƯU Ý CỰC KỲ QUAN TRỌNG: Không được để dấu "[" hoặc bất kỳ nội dung nào khác ở cuối thẻ <BAN_DICH>).

2. BẮT BUỘC TRÍCH XUẤT TẤT CẢ CÁC TÊN RIÊNG, TÊN RÚT GỌN VÀ BIỆT DANH CHƯA ĐƯỢC KHÓA BẰNG ⟦ ⟧:
Cuối mỗi lượt dịch (bên ngoài thẻ BAN_DICH), BẮT BUỘC xuất thẻ <THUC_THE_MOI>...</THUC_THE_MOI>.
Nếu trong đoạn không có tên riêng/biệt danh mới nào chưa khóa thì BẮT BUỘC TRẢ VỀ <THUC_THE_MOI>[]</THUC_THE_MOI>. TUYỆT ĐỐI KHÔNG xuất mã JSON trần, không để sót dấu ngoặc "[" và không để khối JSON trần ở cuối bản dịch.
- TÊN GỌI RÚT GỌN (BỎ HỌ) VÀ BIỆT DANH / TÊN THÂN MẬT CỐ ĐỊNH CHƯA KHÓA BẰNG ⟦ ⟧: Dù nhân vật gốc đã xuất hiện từ trước, nếu trong đoạn văn nhân vật được gọi độc lập bằng tên rút gọn bỏ họ hoặc biệt danh/tên thân mật cố định ("秀麗" -> "Tú Lệ", "剛子" -> "Cương Tử", "安然" -> "An Nhiên"), BẮT BUỘC phải trích xuất thành thực thể riêng.
- ĐỐI VỚI NHÂN VẬT NGOẠI QUỐC (Phương Tây, Liên Xô/Nga...): BẮT BUỘC ĐIỀN TÊN CHỮ CÁI LATINH QUỐC TẾ CHUẨN DUY NHẤT (ví dụ: "Jelina", "Aina", "Karijia", "Edlian", "John"). TUYỆT ĐỐI KHÔNG dùng âm Hán Việt (như Ái Na, Ca Lệ Giai, Giê-lin-ca).
- XỬ LÝ THÔNG TIN THIẾU HOẶC CHƯA RÕ: TUYỆT ĐỐI KHÔNG ĐƯỢC ĐOÁN MÒ.
- ĐỊNH DẠNG XUẤT BẮT BUỘC:
<THUC_THE_MOI>
[
  { "category": "character", "zh": "Tên chữ Hán", "vi": "Tên tiếng Việt hoặc Latinh", "gender": "Nam" | "Nữ" | "Chưa rõ", "role": "Thân phận hoặc null" }
]
</THUC_THE_MOI>`;
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && activeRelations.length > 4) {
    // 4th trim: cap relations to top 4
    activeRelations = activeRelations.slice(0, 4);
    blockE = buildBlockE(activeRelations);
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 8) {
    // 5th trim: cap characters to top 8 most frequent
    blockD = buildBlockD(charEntities.slice(0, 8));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && blockF) {
    // 6th trim: drop glossary terms
    blockF = '';
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 4) {
    // 7th trim: cap characters to top 4 most frequent
    blockD = buildBlockD(charEntities.slice(0, 4));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 2) {
    // 8th trim: cap characters to top 2 most frequent
    blockD = buildBlockD(charEntities.slice(0, 2));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 1) {
    // 9th trim: cap characters to top 1 most frequent
    blockD = buildBlockD(charEntities.slice(0, 1));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && activeRelations.length > 2) {
    // 10th trim: cap relations to top 2
    activeRelations = activeRelations.slice(0, 2);
    blockE = buildBlockE(activeRelations);
    assembled = assemble(false);
  }

  return {
    fullPrompt: assembled,
    lockedSourceText,
    presentEntities,
    matchedGlossaryTerms,
    characterCount: assembled.length,
  };
}

export interface ChapterScoutPromptInput {
  segmentId: string;
  sourceText: string;
  knownEntities?: Array<{ chinese: string; vietnamese: string }>;
  knownLocations?: Array<{ chinese: string; vietnamese: string }>;
}

export function compileChapterScoutPrompt(input: ChapterScoutPromptInput): string {
  const { segmentId, sourceText, knownEntities = [], knownLocations = [] } = input;
  const knownStr = knownEntities.length
    ? `DANH SÁCH NHÂN VẬT ĐÃ BIẾT (KHÔNG CẦN BÁO LẠI TRỪ KHI CÓ QUAN HỆ/XƯNG HÔ MỚI):\n${knownEntities.slice(0, 30).map(e => `- ${e.chinese} -> ${e.vietnamese}`).join('\n')}\n`
    : '';
  const knownLocStr = knownLocations.length
    ? `DANH SÁCH ĐỊA DANH ĐÃ BIẾT (KHÔNG CẦN BÁO LẠI):\n${knownLocations.slice(0, 20).map(l => `- ${l.chinese} -> ${l.vietnamese}`).join('\n')}\n`
    : '';

  return `[TDT_V3_ANALYSIS] [TDT_SCOUT]
Nhiệm vụ: Trinh sát nội dung chương truyện, kiểm tra tính toàn vẹn, phát hiện rác và trích xuất nhân vật/địa danh/quan hệ mới.

CÁC NHIỆM VỤ CỤ THỂ:
1. KIỂM TRA TÍNH TOÀN VẸN (integrity):
   - Đánh giá xem chương có bị ngắt ngang giữa câu, thiếu trang, mất đoạn hay không (status: "truncated").
   - Chương có bị lẫn truyện khác, hoặc toàn bộ là quảng cáo/lỗi không (status: "corrupted").
   - Nếu chương hoàn chỉnh bình thường: status: "ok".
2. ĐỊNH VỊ RÁC / QUẢNG CÁO (garbage):
   - KHÔNG chép lại truyện. CHỈ trích xuất chuỗi rác nguyên văn (text) để Tool tự động cắt bỏ.
   - Các loại rác cần xóa: Lời nhắn tác giả xin hoa/vé, quảng cáo website, liên kết điều hướng, mã game.
   - Nếu không có rác, để mảng rỗng [].
3. NHÂN VẬT MỚI (newCharacters):
   - Quét TOÀN DIỆN 100% nhân vật xuất hiện trong văn bản (chưa có trong danh sách đã biết), BAO GỒM CẢ NHÂN VẬT PHỤ XUẤT HIỆN THOÁNG QUA 1 LẦN (như người đi đường, cán sự, đồng nghiệp, người thân... ví dụ: 从飞 -> Từ Phi, 曹大伟 -> Tào Đại Vĩ, 李小娟 -> Lý Tiểu Quyên). Tuyệt đối không được bỏ sót!
   - "source": Tên chữ Hán nguyên văn.
   - "vi": Phiên âm Hán-Việt thuần Việt chuẩn xác 100% (CẤM âm Pinyin, CẤM tiếng Anh, CẤM 'From Phi').
   - "gender": "male" | "female" | "unknown".
   - "role": Thân phận hoặc vai vế nếu có, không có thì để "".
4. ĐỊA DANH & ĐƠN VỊ CÔNG XƯỞNG (locations):
   - Trích xuất toàn bộ địa danh (thành phố, thị xã, huyện, thôn, trấn, địa danh giả tưởng/có thật như 京都 -> Kinh Đô, 蘭城 -> Lan Thành) và đơn vị, công xưởng xuất hiện trong văn bản.
   - "source": Chữ Hán nguyên văn.
   - "vi": Phiên âm Hán-Việt thuần Việt chuẩn xác (CẤM tiếng Anh như Kyoto).
   - "type": "city" | "town" | "village" | "org" | "other".
5. QUAN HỆ & GỢI Ý XƯNG HÔ (relations):
   - Nhận diện các mối quan hệ và gợi ý xưng hô giữa các nhân vật xuất hiện trong phân cảnh này.
   - "charA": Tên người thứ nhất.
   - "charB": Tên người thứ hai.
   - "relation": Mối quan hệ (ví dụ: Bạn bè, Vợ chồng, Bố con, Anh em...).
   - "suggestion": GỢI Ý xưng hô tham khảo (ví dụ: "anh - em", "bố - con", "tôi - cậu"). LƯU Ý: Đây chỉ là gợi ý tham khảo linh hoạt, KHÔNG khóa cứng.

${knownStr}${knownLocStr}
ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (DUY NHẤT 1 KHỐI JSON HỢP LỆ, KHÔNG KÈM LỜI DẪN NGOÀI):
\`\`\`json
{
  "integrity": { "status": "ok", "reason": "" },
  "garbage": [],
  "newCharacters": [],
  "locations": [],
  "relations": []
}
\`\`\`

VĂN BẢN CẦN TRINH SÁT (id: ${segmentId}):
${sourceText}`;
}
