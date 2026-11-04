import type { GenreProfile } from './genreProfile.js';
import { lockNamesInSource, type LockableEntity } from './nameLocker.js';
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
    maxCharacters = 13_000,
    customPrompt,
  } = input;

  // 1. Scan entities present in source text (Longest match first)
  const activeEntities = bible.entities.filter((e) => e.status !== 'candidate');
  const presentEntities = activeEntities.filter(
    (e) => sourceText.includes(e.zh) || e.aliases?.some((a) => sourceText.includes(a.zh)),
  );

  // 2. Lock names mechanically in source text: 顾国强 -> ⟦Cố Quốc Cường⟧
  const lockableEntities: LockableEntity[] = presentEntities.map((e) => ({
    chinese: e.zh,
    vietnamese: e.vi,
    aliases: e.aliases?.map((a) => a.zh),
    ambiguous: e.aliases?.some((a) => a.ambiguousWith?.length),
  }));

  const { lockedSourceText } = lockNamesInSource(sourceText, lockableEntities);

  // 3. Scan Genre Glossary terms present in source text
  const matchedGlossaryTerms: Array<{ chinese: string; vietnamese: string }> = [];
  if (genreProfile.glossary?.length) {
    for (const term of genreProfile.glossary) {
      if (sourceText.includes(term.chinese)) {
        matchedGlossaryTerms.push({
          chinese: term.chinese,
          vietnamese: term.vietnamese,
        });
      }
    }
  }

  // --- BUILD 8 CANONICAL BLOCKS ---

  // KHỐI A: LUẬT KỸ THUẬT LÕI (Không bao giờ bị cắt giảm)
  const customDirective = customPrompt?.trim()
    ? `\n5. CHỈ ĐẠO VĂN PHONG RIÊNG TỪ NGƯỜI DÙNG (ƯU TIÊN TUÂN THỦ CAO NHẤT):\n${customPrompt.trim()}`
    : '';
  const blockA = `### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC
1. Dịch đủ 100% nội dung, không tóm tắt, không bỏ sót câu/đoạn, không để lại bất kỳ chữ Hán nào.
2. BẢO TOÀN TIÊU ĐỀ & SỐ THỨ TỰ CHƯƠNG (BẮT BUỘC): Nếu trong nguồn <NGUYEN_BAN> có tiêu đề chương (ví dụ "Chương 108: ..."), bản dịch BẮT BUỘC phải dịch đúng số chương đó ("Chương 108: ..."). TUYỆT ĐỐI KHÔNG lặp lại số chương của đoạn trước (như "Chương 107") và không tự ý nhảy số chương.
3. NGUYÊN TẮC GIỮ NGUYÊN TÊN TRONG NGOẶC: Mọi danh từ riêng đã được đóng ngoặc ⟦...⟧ BẮT BUỘC PHẢI GIỮ NGUYÊN vẹn cả dấu ngoặc và nội dung bên trong (Ví dụ: ⟦Cố Quốc Cường⟧ phải xuất hiện đúng dạng ⟦Cố Quốc Cường⟧ trong bản dịch).
4. QUY ƯỚC TỪ LÓNG THỜI ĐẠI & TÊN NGOẠI QUỐC:
   - "漂亮国" (Phiêu Lượng Quốc): dịch chuẩn xác là "Mỹ" hoặc "nước Mỹ" / "Hoa Kỳ" (tuyệt đối KHÔNG dịch "Bình Lượng Quốc").
   - "老大哥" (trong bối cảnh niên đại/lịch sử): dịch chuẩn xác là "Liên Xô".
   - "华国": dịch là "Trung Quốc".
   - Địa danh quy ước: "海市" dịch là "Thượng Hải", "广市" dịch là "Quảng Châu", "深市" dịch là "Thâm Quyến", "港城" dịch là "Hồng Kông", "澳门" dịch là "Ma Cao".
   - Tên người ngoại quốc (phương Tây, Liên Xô/Nga...): BẮT BUỘC thống nhất dùng chữ cái Latinh quốc tế duy nhất (ví dụ: Jelina, Aina, Karijia, Edlian, John), TUYỆT ĐỐI KHÔNG dùng âm Hán Việt thô (như Kiệt Lâm Ca, Ca Lệ Giai, Ái Na, Na Mâu Nhĩ, E-đơ-lin) và không đổi cách viết qua lại giữa các chương.
   - BIỆT DANH & TÊN THÂN MẬT (BẮT BUỘC THUẦN VIỆT): Biệt danh hoặc tên thân mật lúc nhỏ của nhân vật/thú cưng (như 泡芙 - Bánh Su Nhỏ / bé Bánh Su, 豆豆 - Đậu Đậu, 球球 - Cầu Cầu...): BẮT BUỘC dịch nghĩa tiếng Việt dễ thương hoặc âm Hán Việt quen thuộc, TUYỆT ĐỐI CẤM tự ý dịch sang tiếng Anh (như Puff, Beans, Ball...).
   - NHẤT QUÁN PHIÊN ÂM HÁN VIỆT: Luôn giữ nhất quán họ và tên nhân vật theo âm Hán Việt chuẩn xác (Họ 曹 là Tào, họ 郝 là Hách, chữ 荣 là Vinh, chữ 橙 trong tên người là Tranh như Mộc Tranh).
   - QUY TẮC TÊN THÂN MẬT NGOẠI QUỐC: Các biến thể tên gọi thân mật kết thúc bằng 卡 (-ka/ca) của cùng một nhân vật ngoại quốc (như 耶莲娜 và 耶莲卡) BẮT BUỘC quy về MỘT tên Latinh chính thức duy nhất (Jelina).
   - QUY TẮC CHÍNH TẢ & VIẾT HOA (BẮT BUỘC):
      + CHỈ VIẾT HOA: Tên riêng người cụ thể (Viên Hòa Tụng, Trữ Khiết), địa danh hành chính chính thức cấp quốc gia/tỉnh/thành phố (Bắc Kinh, Thượng Hải, Trung Quốc).
      + TUYỆT ĐỐI VIẾT THƯỜNG:
        * Danh từ chung nơi chốn/cơ quan: đại viện, quân khu, đại đội, binh đoàn, công xưởng, phân xưởng, bệnh viện, nhà khách, tiệm cơm, ký túc xá, cung tiêu xã, trường học.
        * Phương hướng & địa lý: miền nam, miền bắc, đông bắc, tây bắc, đại lục, nội địa.
        * Chức vụ & nghề nghiệp: tiểu đoàn trưởng, trung đoàn trưởng, tư lệnh, bác sĩ, y tá, viện trưởng, đầu bếp, tài xế.
        * Cụm gia đình, họ tộc: nhà họ Khang, nhà họ Viên, nhà họ Trữ (chỉ viết hoa tên họ, chữ "nhà họ" BẮT BUỘC viết thường, tuyệt đối KHÔNG dịch thành "Khang Gia", "Viên Gia" hay viết hoa "Nhà họ").
5. QUY CHUẨN XƯNG HÔ THUẦN VIỆT TOÀN DIỆN (BẮT BUỘC ĐẢO VỊ TRÍ & THUẦN HÓA 100%):
   - NGUYÊN TẮC CỐT LÕI: Tiếng Trung đặt danh xưng thân tộc/vai vế ở SAU họ tên ([Tên/Họ] + Danh xưng), Tiếng Việt BẮT BUỘC ĐẢO LÊN TRƯỚC ([Danh xưng thuần Việt] + [Tên/Họ]).
   - QUY TẮC XƯNG HÔ THEO NGỮ CẢNH & BƯỚC NGOẶT CỐT TRUYỆN:
      + Mọi quy ước xưng hô cung cấp ở KHỐI E là MẪU XƯNG HÔ THAM KHẢO ghi nhận từ các phân cảnh trước.
      + Khi có BƯỚC NGOẶT CỐT TRUYỆN (kết hôn sang vợ - chồng, mâu thuẫn sang tôi - anh), BẮT BUỘC ưu tiên mạch truyện thực tế, KHÔNG bị gò ép bởi mẫu cũ.
      + Khi phát hiện bước ngoặt xưng hô mới, hãy xuất quan hệ vào <THUC_THE_MOI> (category: "relation") để hệ thống tự động ghi nhận thêm.
   - TUYỆT ĐỐI CẤM giữ nguyên âm Hán-Việt thô cứng theo 3 tầng bậc toàn diện sau:
     + TẦNG 1: BẬC ÔNG BÀ / CỤ (TRÊN 2 THẾ HỆ):
       * [Họ/Tên] + 爺 / 爺爺 / 姥爺: BẮT BUỘC dịch là "ông [Tên/Họ]" hoặc "cụ [Tên/Họ]" (TUYỆT ĐỐI CẤM: Gia gia, Lão gia).
       * [Họ/Tên] + 奶 / 奶奶 / 婆 / 婆婆 / 姥姥: BẮT BUỘC dịch là "bà [Tên/Họ]", "bà nội [Họ]", "bà ngoại [Họ]" hoặc "bà cụ [Họ]" (Ví dụ: 陳奶奶 -> dịch là "bà Trần" hoặc "bà nội họ Trần"; TUYỆT ĐỐI CẤM: "Trần nãi nãi", "Nãi nãi", "Bà bà").
     + TẦNG 2: BẬC CHA CHÚ BÁC CÔ DÌ THÍM MỢ DƯỢNG (TRÊN 1 THẾ HỆ):
       * Nam: 叔 / 叔叔 / 小叔 -> "chú [Tên/Họ]"; 伯 / 大伯 / 伯父 -> "bác [Tên/Họ]"; 舅 / 舅舅 -> "cậu [Tên/Họ]"; 姑父 / 姨夫 / 姑丈 / 姨丈 -> "dượng [Tên/Họ]" (TUYỆT ĐỐI CẤM: Thúc, Bá phụ, Cữu cữu, Cô trượng).
       * Nữ: 嬸 / 嬸子 / 嬸嬸 -> "thím [Tên/Họ]"; 娘 / 大娘 -> "bác gái [Tên/Họ]"; 姑 / 姑姑 / 姑媽 -> "cô [Tên/Họ]"; 姨 / 姨媽 / 小姨 -> "dì [Tên/Họ]"; 舅媽 / 舅母 -> "mợ [Tên/Họ]"; 伯母 -> "bác gái [Tên/Họ]" (TUYỆT ĐỐI CẤM: Thẩm, Đại Nương, Cô cô, Di mụ, Cữu mẫu).
       * [Họ] + 嫂 / 嫂子: BẮT BUỘC dịch là "thím [Họ]" hoặc "chị dâu [Họ]" (Ví dụ: 張嫂子 -> dịch là "thím Trương" hoặc "chị dâu Trương"; TUYỆT ĐỐI CẤM: "Trương Tẩu Tử", "Trương Tẩu").
     + TẦNG 3: BẬC ĐỒNG LỨA / NGANG VAI:
       * Lớn hơn: [Tên] + 哥 / 哥哥 -> "anh [Tên]" (Ví dụ: 大飛哥 -> "anh Đại Phi"; TUYỆT ĐỐI CẤM: "Đại Phi Ca", "Ca"); [Tên] + 姐 / 姐姐 -> "chị [Tên]" (Ví dụ: 小花姐 -> "chị Tiểu Hoa"; TUYỆT ĐỐI CẤM: "Tiểu Hoa Tỷ", "Tỷ").
       * Nhỏ hơn: [Tên] + 弟 / 弟弟 -> "em trai [Tên]" hoặc "em [Tên]" (TUYỆT ĐỐI CẤM: "Đệ"); [Tên] + 妹 / 妹妹 -> "em gái [Tên]" hoặc "em [Tên]" (TUYỆT ĐỐI CẤM: "Muội").
6. BỎ QUA NỘI DUNG RÁC & LỜI NHẮN TÁC GIẢ (BẮT BUỘC): Bỏ qua hoàn toàn các dòng ghi chú, lời nhắn của tác giả ở cuối chương/đoạn (như xin vé tháng, xin hoa, phát bao lì xì, trò chuyện ngoài truyện, ??99, ??66...). Chỉ dịch phần nội dung cốt truyện chính, tuyệt đối không dịch những lời nhắn tác giả này vào bản dịch.
7. ĐẦU RA BẮT BUỘC: Đặt toàn bộ bản dịch tiếng Việt bên trong cặp thẻ <BAN_DICH id="${segmentId}"> ... </BAN_DICH>. Bản dịch phải kết thúc sạch sẽ và trọn vẹn, TUYỆT ĐỐI KHÔNG CHÈN DẤU NGOẶC VUÔNG "[" HOẶC MÃ JSON VÀO CUỐI BẢN DỊCH.${customDirective}`;

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
  const blockAContinuation = `### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC (MỎ NEO CỐT LÕI)
1. Dịch đủ 100% nội dung, không tóm tắt, không bỏ sót câu/đoạn, không để lại bất kỳ chữ Hán nào.
2. BẢO TOÀN TIÊU ĐỀ & SỐ THỨ TỰ CHƯƠNG (BẮT BUỘC): Nếu trong nguồn <NGUYEN_BAN> có tiêu đề chương (ví dụ "Chương ${segmentIndex + 1}: ..."), bản dịch BẮT BUỘC dịch đúng số chương đó. TUYỆT ĐỐI KHÔNG lặp lại số chương của đoạn trước và không tự ý nhảy số chương.
3. BẢO TOÀN 100% DANH TỪ TRONG NGOẶC ⟦...⟧: Mọi danh từ riêng đã được đóng ngoặc ⟦...⟧ BẮT BUỘC PHẢI GIỮ NGUYÊN vẹn cả dấu ngoặc và nội dung bên trong (Ví dụ: ⟦Cố Quốc Cường⟧ phải xuất hiện đúng dạng ⟦Cố Quốc Cường⟧ trong bản dịch).
4. QUY ƯỚC TÊN NGOẠI QUỐC: Tên người ngoại quốc (phương Tây, Liên Xô/Nga...) BẮT BUỘC dùng chữ cái Latinh quốc tế chuẩn duy nhất (ví dụ: Jelina, Aina, Karijia, Edlian, John), TUYỆT ĐỐI CẤM dùng âm Hán-Việt (Ái Na, Ca Lệ Giai, Giê-lin-ca, E-đơ-lin) và quy biến thể thân mật (-ka) về một tên Latinh duy nhất.
   - BIỆT DANH / TÊN THÂN MẬT (泡芙 -> Bánh Su Nhỏ...): Dịch nghĩa tiếng Việt dễ thương, TUYỆT ĐỐI CẤM dịch sang tiếng Anh (như Puff...). Nhất quán họ tên chuẩn (họ 曹 là Tào, họ 郝 là Hách, chữ 荣 là Vinh, chữ 橙 là Tranh).
5. QUY CHUẨN XƯNG HÔ THUẦN VIỆT & MẪU XƯNG HÔ THAM KHẢO:
   - ĐẢO VỊ TRÍ DANH XƯNG LÊN TRƯỚC: [Danh xưng thuần Việt] + [Tên/Họ] (ông/bà/chú/bác/cô/dì/thím/anh/chị...; TUYỆT ĐỐI CẤM giữ nguyên âm Hán-Việt thô như thẩm, thúc, tẩu, nãi nãi, bá phụ, tỷ, ca).
   - MẪU XƯNG HÔ THAM KHẢO TỪ CÁC PHÂN CẢNH TRƯỚC: Mọi xưng hô cung cấp ở KHỐI E là mẫu tham khảo. Khi cốt truyện có BƯỚC NGOẶT QUAN HỆ (kết hôn chuyển sang gọi vợ - chồng, cãi vã mâu thuẫn chuyển sang tôi - anh...) có đầy đủ dữ kiện, BẮT BUỘC ưu tiên mạch truyện thực tế, KHÔNG bị gò ép bởi mẫu cũ.
   - HỌC THÊM MẪU XƯNG HÔ MỚI: Nếu phân cảnh có bước ngoặt xưng hô mới, hãy xuất bản ghi quan hệ vào thẻ <THUC_THE_MOI> (loại "relation") để hệ thống tự động ghi nhận thêm mẫu xưng hô mới này cho các chương sau.
   - QUY TẮC CHÍNH TẢ & VIẾT HOA: Không viết hoa danh từ chung (đại viện, quân khu, công xưởng, miền nam, đại lục, nhà họ...). Chỉ viết hoa tên riêng người và địa danh hành chính.
6. BẢO ĐỒNG BỘ ĐẠI TỪ DẪN TRUYỆN: Đại từ ngôi thứ ba trần thuật (anh/chị/hắn/nàng...) phải đồng bộ tuyệt đối với xưng hô trong đối thoại của phân cảnh.
7. BỎ QUA NỘI DUNG RÁC & LỜI NHẮN TÁC GIẢ: Bỏ qua hoàn toàn các dòng ghi chú, lời nhắn của tác giả ở cuối chương/đoạn (như xin vé tháng, xin hoa, phát bao lì xì, ??99, ??66...). Chỉ dịch phần nội dung cốt truyện chính, tuyệt đối không dịch những lời nhắn tác giả này vào bản dịch.
8. ĐẦU RA BẮT BUỘC: Đặt toàn bộ bản dịch tiếng Việt bên trong cặp thẻ <BAN_DICH id="${segmentId}"> ... </BAN_DICH>. Bản dịch phải kết thúc sạch sẽ, TUYỆT ĐỐI KHÔNG CHÈN DẤU NGOẶC VUÔNG "[" HOẶC MÃ JSON VÀO CUỐI BẢN DỊCH.${customDirective}`;

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
    const countA = (sourceText.match(new RegExp(a.zh, 'g')) || []).length;
    const countB = (sourceText.match(new RegExp(b.zh, 'g')) || []).length;
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
      `### KHỐI E: MẪU XƯNG HÔ THAM KHẢO (TỪ CÁC PHÂN CẢNH TRƯỚC)\n` +
      `- Dưới đây là MẪU THAM KHẢO. Khi có BƯỚC NGOẶT CỐT TRUYỆN (kết hôn sang vợ - chồng, mâu thuẫn sang tôi - anh...), BẮT BUỘC ưu tiên mạch truyện thực tế, KHÔNG gò ép bởi mẫu cũ. Đồng thời xuất xưng hô mới vào <THUC_THE_MOI> (loại relation).\n` +
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
  const blockH = `### KHỐI H: YÊU CẦU ĐẦU RA
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

  // ASSEMBLE WITH PROGRESSIVE FIT-TO-BUDGET LOGIC
  const selectedBlockA = input.isContinuationTurn ? blockAContinuation : blockA;
  let selectedBlockB = input.isContinuationTurn ? blockBContinuation : blockB;
  const assemble = (includeC: boolean) => {
    const list = [selectedBlockA, selectedBlockB, includeC ? blockC : '', blockD, blockE, blockF, blockG, blockH];
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

  if (assembled.length > maxCharacters && activeRelations.length > 4) {
    // 3rd trim: cap relations to top 4
    activeRelations = activeRelations.slice(0, 4);
    blockE = buildBlockE(activeRelations);
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 8) {
    // 4th trim: cap characters to top 8 most frequent
    blockD = buildBlockD(charEntities.slice(0, 8));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && blockF) {
    // 5th trim: drop glossary terms
    blockF = '';
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 4) {
    // 6th trim: cap characters to top 4 most frequent
    blockD = buildBlockD(charEntities.slice(0, 4));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 2) {
    // 7th trim: cap characters to top 2 most frequent
    blockD = buildBlockD(charEntities.slice(0, 2));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && charEntities.length > 1) {
    // 8th trim: cap characters to top 1 most frequent
    blockD = buildBlockD(charEntities.slice(0, 1));
    assembled = assemble(false);
  }

  if (assembled.length > maxCharacters && activeRelations.length > 0) {
    // 9th trim (last resort): keep only the core rule for blockE
    activeRelations = [];
    blockE = buildBlockE([]);
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
