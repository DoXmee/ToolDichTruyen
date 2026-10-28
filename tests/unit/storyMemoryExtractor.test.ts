import { describe, expect, it } from 'vitest';
import {
  autoExtractStoryMemory,
  extractRelationships,
  extractSmartRelationships,
  extractVietnameseProperNouns,
  inferEntityMetadata,
  isLikelyCharacter,
  verifyHanVietMatch,
} from '../../src/core/storyMemoryExtractor';

describe('storyMemoryExtractor', () => {
  // ─────────────────────────────────────────────────────────────────
  // verifyHanVietMatch
  // ─────────────────────────────────────────────────────────────────
  it('verifies Han-Viet syllable matching with high precision', () => {
    expect(verifyHanVietMatch('Nguyễn Tô Diệp', '阮苏叶')).toBe(true);
    expect(verifyHanVietMatch('Vương Tú Cần', '王秀芹')).toBe(true);
    expect(verifyHanVietMatch('Tiêu Viêm', '萧炎')).toBe(true);
    expect(verifyHanVietMatch('Lâm Động', '林动')).toBe(true);
    expect(verifyHanVietMatch('Quan Y Y', '關依依')).toBe(true);
    expect(verifyHanVietMatch('Quan Y Y', '关依依')).toBe(true);
    expect(verifyHanVietMatch('Mãng Ca', '莽哥')).toBe(true);
    expect(verifyHanVietMatch('Lý Quốc', '李國')).toBe(true);

    // Mismatches
    expect(verifyHanVietMatch('Nguyễn Tô Diệp', '林动')).toBe(false);
    expect(verifyHanVietMatch('Trần Văn A', '阮苏叶')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // extractVietnameseProperNouns
  // ─────────────────────────────────────────────────────────────────
  it('extracts Vietnamese capitalized proper nouns and filters stopwords', () => {
    const text = 'Sáng hôm sau, Nguyễn Tô Diệp bước ra ngõ Cát Tường gặp Vương Tú Cần và Nguyễn Xuân Ni.';
    const properNouns = extractVietnameseProperNouns(text);

    expect(properNouns.has('Nguyễn Tô Diệp')).toBe(true);
    expect(properNouns.has('Vương Tú Cần')).toBe(true);
    expect(properNouns.has('Nguyễn Xuân Ni')).toBe(true);
    expect(properNouns.has('Sáng')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // inferEntityMetadata & isLikelyCharacter
  // ─────────────────────────────────────────────────────────────────
  it('infers metadata such as gender and role for genuine characters', () => {
    const metaFemale = inferEntityMetadata(
      '阮苏叶',
      'Nguyễn Tô Diệp',
      '阮苏叶转过头看着屋子',
      'Cô Nguyễn Tô Diệp mỉm cười nhẹ nhàng',
    );
    expect(metaFemale.category).toBe('character');
    expect(metaFemale.gender).toBe('female');

    const metaLoc = inferEntityMetadata(
      '吉祥胡同',
      'ngõ Cát Tường',
      '住在吉祥胡同',
      'ở ngõ Cát Tường',
    );
    expect(metaLoc.category).toBe('location');
    expect(metaLoc.gender).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────
  // Loại bỏ danh từ chung, hướng địa lý, hiện tượng thiên nhiên, thành ngữ
  // ─────────────────────────────────────────────────────────────────
  it('loại trừ hoặc phân loại chính xác danh từ chung, không biến thành nhân vật và không gán giới tính', () => {
    // 1. Hướng địa lý: "Tây Bắc" (西北) -> category: location, gender: undefined
    const metaTayBac = inferEntityMetadata(
      '西北',
      'Tây Bắc',
      '她一个人去了西北下乡',
      'Cô ấy một mình đi đến vùng Tây Bắc để xuống nông thôn.',
    );
    expect(metaTayBac.category).toBe('location');
    expect(metaTayBac.gender).toBeUndefined();
    expect(isLikelyCharacter('西北', 'Tây Bắc', '她一个人去了西北下乡', 'đi đến vùng Tây Bắc')).toBe(false);

    // 2. Kiến trúc/vị trí: "Thành Căn" (城根) -> category: location, gender: undefined
    const metaThanhCan = inferEntityMetadata(
      '城根',
      'Thành Căn',
      '他坐在城根底下抽烟',
      'Hắn ngồi dưới chân thành Thành Căn hút thuốc.',
    );
    expect(metaThanhCan.category).toBe('location');
    expect(metaThanhCan.gender).toBeUndefined();

    // 3. Hiện tượng thiên nhiên: "Tuyết Hoa" (雪花) -> isBlacklisted: true, không tạo entity
    const metaTuyetHoa = inferEntityMetadata(
      '雪花',
      'Tuyết Hoa',
      '天空中飘着雪花，她感到很冷',
      'Trên trời bay lượn những bông Tuyết Hoa, cô cảm thấy rất lạnh.',
    );
    expect(metaTuyetHoa.isBlacklisted).toBe(true);

    // 4. Thành ngữ / ví von: "Bạch Vô Thường" (白无常 / 白無常) -> isBlacklisted: true
    const metaBachVoThuong = inferEntityMetadata(
      '白无常',
      'Bạch Vô Thường',
      '她的脸色白得像白无常一样',
      'Khuôn mặt cô trắng bệch như Bạch Vô Thường.',
    );
    expect(metaBachVoThuong.isBlacklisted).toBe(true);

    // 5. Khẩu hiệu thời đại: "Phú Cường" (富强) -> isBlacklisted khi là khẩu hiệu, nhưng là location khi là đại đội
    const metaPhuCuongSlogan = inferEntityMetadata(
      '富强',
      'Phú Cường',
      '建设富强民主的家园',
      'Xây dựng quê hương Phú Cường dân chủ.',
    );
    expect(metaPhuCuongSlogan.isBlacklisted).toBe(true);

    const metaPhuCuongDaiDoi = inferEntityMetadata(
      '富强',
      'Phú Cường',
      '富强大队的社员们',
      'Xã viên đại đội Phú Cường đang làm việc.',
    );
    expect(metaPhuCuongDaiDoi.category).toBe('location');
    expect(metaPhuCuongDaiDoi.isBlacklisted).toBeFalsy();

    // 6. Khái niệm hòa bình: "Thái Bình" (太平) -> isBlacklisted khi chỉ sự bình yên
    const metaThaiBinhAbstract = inferEntityMetadata(
      '太平',
      'Thái Bình',
      '天下太平才是好日子',
      'Thiên hạ Thái Bình mới là ngày lành.',
    );
    expect(metaThaiBinhAbstract.isBlacklisted).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────
  // autoExtractStoryMemory — Lọc sạch danh từ chung trong đoạn thực tế
  // ─────────────────────────────────────────────────────────────────
  it('autoExtractStoryMemory không lưu các danh từ chung (Tây Bắc, Thành Căn, Tuyết Hoa, Bạch Vô Thường) làm nhân vật', () => {
    const chineseSource = `
    阮苏叶冒着风雪，空中飘着雪花。
    王秀芹把她送到城根底下，拉着她的手说："孩子，到了西北一定要照顾好自己。"
    那个恶毒婶子脸色白得像白无常，还在旁边冷笑。
    她们大队叫做富强。
    `;

    const vietnameseTarget = `
    Nguyễn Tô Diệp đội gió tuyết, trên không trung bay lượn những bông Tuyết Hoa.
    Vương Tú Cần tiễn cô đến dưới chân thành Thành Căn, nắm tay cô dặn dò: "Con ơi, đến Tây Bắc nhất định phải tự chăm sóc mình."
    Bà thím độc ác kia sắc mặt trắng bệch như Bạch Vô Thường, vẫn đứng bên cạnh cười khẩy.
    Đại đội của họ tên là Phú Cường.
    `;

    const extracted = autoExtractStoryMemory(chineseSource, vietnameseTarget, { genre: 'period' });

    const entityNames = extracted.entities.map((e) => e.vietnamese);
    const characters = extracted.entities.filter((e) => e.category === 'character');
    const charNames = characters.map((c) => c.vietnamese);

    // Nhân vật thật phải có mặt
    expect(charNames).toContain('Nguyễn Tô Diệp');
    expect(charNames).toContain('Vương Tú Cần');

    // Các danh từ chung TUYỆT ĐỐI KHÔNG ĐƯỢC làm nhân vật
    expect(charNames).not.toContain('Tây Bắc');
    expect(charNames).not.toContain('Thành Căn');
    expect(charNames).not.toContain('Tuyết Hoa');
    expect(charNames).not.toContain('Bạch Vô Thường');

    // Tuyết Hoa & Bạch Vô Thường bị loại bỏ hoàn toàn
    expect(entityNames).not.toContain('Tuyết Hoa');
    expect(entityNames).not.toContain('Bạch Vô Thường');

    // Tây Bắc & Thành Căn nếu có thì là location và KHÔNG CÓ GIỚI TÍNH
    const tayBac = extracted.entities.find((e) => e.vietnamese === 'Tây Bắc');
    if (tayBac) {
      expect(tayBac.category).toBe('location');
      expect(tayBac.gender).toBeUndefined();
    }
    const thanhCan = extracted.entities.find((e) => e.vietnamese === 'Thành Căn');
    if (thanhCan) {
      expect(thanhCan.category).toBe('location');
      expect(thanhCan.gender).toBeUndefined();
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Chống va chạm substring — "Tô Diệp" không bị tạo entity riêng
  // khi "Nguyễn Tô Diệp" (阮苏叶) đã tồn tại.
  // ─────────────────────────────────────────────────────────────────
  it('không tạo entity riêng cho tên gọi tắt khi tên đầy đủ đã tồn tại (chống va chạm substring)', () => {
    const chineseSource = '阮苏叶在家，苏叶很开心。';
    const vietnameseTarget = 'Nguyễn Tô Diệp ở nhà, Tô Diệp rất vui.';

    const extracted = autoExtractStoryMemory(chineseSource, vietnameseTarget);

    const chineseKeys = extracted.entities.map((e) => e.chinese);

    // Không được có entity riêng '苏叶' — phải gộp vào alias của '阮苏叶'
    expect(chineseKeys).not.toContain('苏叶');
    expect(chineseKeys).toContain('阮苏叶');

    // Alias phải được đính vào entity chính
    const nguyenToDiep = extracted.entities.find((e) => e.chinese === '阮苏叶');
    expect(nguyenToDiep?.aliases).toContain('苏叶');
  });

  // ─────────────────────────────────────────────────────────────────
  // Đồng tên khác họ — "阮苏叶" và "叶苏叶" phải là 2 entity riêng biệt
  // ─────────────────────────────────────────────────────────────────
  it('giữ nguyên 2 entity riêng biệt khi đồng tên khác họ', () => {
    const chineseSource = '阮苏叶是姐姐，叶苏叶是妹妹。';
    const vietnameseTarget = 'Nguyễn Tô Diệp là chị, Diệp Tô Diệp là em gái sinh đôi.';

    const extracted = autoExtractStoryMemory(chineseSource, vietnameseTarget);

    const chineseKeys = extracted.entities.map((e) => e.chinese);
    expect(chineseKeys).toContain('阮苏叶');
    expect(chineseKeys).toContain('叶苏叶');
  });

  // ─────────────────────────────────────────────────────────────────
  // Tên gọi tắt nhập nhằng — '苏叶' có thể là '阮苏叶' hoặc '叶苏叶'
  // → sinh contextHint, không tạo entity riêng cho '苏叶'
  // ─────────────────────────────────────────────────────────────────
  it('sinh contextHint khi tên gọi tắt nhập nhằng với nhiều nhân vật', () => {
    const chineseSource = '阮苏叶和叶苏叶都在，苏叶笑了。';
    const vietnameseTarget = 'Nguyễn Tô Diệp và Diệp Tô Diệp đều ở đây, Tô Diệp cười.';

    const extracted = autoExtractStoryMemory(chineseSource, vietnameseTarget);

    const chineseKeys = extracted.entities.map((e) => e.chinese);
    expect(chineseKeys).not.toContain('苏叶');
    expect(extracted.contextHint).toBeDefined();
    expect(extracted.contextHint).toContain('Tô Diệp');
  });

  // ─────────────────────────────────────────────────────────────────
  // Trích xuất quan hệ thông minh (Smart Relationships Extraction)
  // ─────────────────────────────────────────────────────────────────
  it('trích xuất quan hệ thân tộc chính xác khi có câu quan hệ rõ ràng giữa 2 nhân vật xác thực', () => {
    const sourceText = '王秀芹是阮苏叶的母亲，看着她。阮苏叶说道："妈。"';
    const targetText = 'Vương Tú Cần là mẹ của Nguyễn Tô Diệp, nhìn cô. Nguyễn Tô Diệp bảo: "Mẹ."';

    const extracted = autoExtractStoryMemory(sourceText, targetText);

    expect(extracted.relations.length).toBeGreaterThan(0);
    const rel = extracted.relations.find(
      (r) => r.sourceCharacter === 'Vương Tú Cần' && r.targetCharacter === 'Nguyễn Tô Diệp',
    );
    expect(rel).toBeDefined();
    expect(rel?.relationType).toBe('Mẹ - Con');
    expect(rel?.pronounSample).toBe('Mẹ - Con');
  });

  it('không sinh quan hệ khi chỉ có đại từ hoặc không có quan hệ thân tộc rõ ràng', () => {
    const entities = [
      { id: '1', category: 'character' as const, chinese: '阮苏叶', vietnamese: 'Nguyễn Tô Diệp' },
      { id: '2', category: 'character' as const, chinese: '王秀芹', vietnamese: 'Vương Tú Cần' },
    ];
    // Không có mẫu "A là mẹ/cha/vợ/chồng của B"
    const result = extractSmartRelationships('', 'Nguyễn Tô Diệp và Vương Tú Cần cùng nhau đi chợ.', entities);
    expect(result).toHaveLength(0);
  });

  it('không bao giờ sinh quan hệ giữa một nhân vật và chính họ hoặc alias của họ', () => {
    const entities = [
      { id: '1', category: 'character' as const, chinese: '阮苏叶', vietnamese: 'Nguyễn Tô Diệp', aliases: ['Tô Diệp'] },
    ];
    const result = extractSmartRelationships('', 'Nguyễn Tô Diệp là mẹ của Tô Diệp.', entities);
    expect(result).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Địa danh / thuật ngữ không bị tạo quan hệ
  // ─────────────────────────────────────────────────────────────────
  it('địa danh như Thái Bình Dương / Yến Kinh không sinh quan hệ với nhân vật', () => {
    const chineseSource = '阮苏叶站在太平洋边看着燕京。';
    const vietnameseTarget = 'Nguyễn Tô Diệp đứng bên Thái Bình Dương nhìn về Yến Kinh.';

    const extracted = autoExtractStoryMemory(chineseSource, vietnameseTarget);
    expect(extracted.relations).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Siêu từ điển Hán-Việt 15,520 ký tự & Khớp tên Phồn-Giản
  // ─────────────────────────────────────────────────────────────────
  it('nhận diện chính xác các ký tự tên người hiếm (翠, 妞, 戶, 邵, 雲)', () => {
    expect(verifyHanVietMatch('Trần Thúy Anh', '陳翠英')).toBe(true);
    expect(verifyHanVietMatch('Trần Thuý Anh', '陈翠英')).toBe(true);
    expect(verifyHanVietMatch('Trâu Phương Phân', '鄒芳芬')).toBe(true);
    expect(verifyHanVietMatch('Lưu Đại Hộ', '劉大戶')).toBe(true);
    expect(verifyHanVietMatch('Giang Thiệu Vân', '江邵雲')).toBe(true);

    // Inverted 2-word title / honorific (e.g. "Thím Trần" <=> "陈婶")
    expect(verifyHanVietMatch('Thím Trần', '陈婶')).toBe(true);
    expect(verifyHanVietMatch('Bác Trương', '张伯')).toBe(true);
  });

  it('chặn triệt để mảnh cắt 2 chữ họ + số thứ tự (劉大) không có chức vụ hoặc vai vế', () => {
    // Đoạn văn nhắc tới "Lưu Đại Hộ ... cô con dâu", nhưng vì lý do nào đó chỉ trích ra "Lưu Đại"
    const chineseSource = '那是劉大戶家。';
    const vietnameseTarget = 'Đó là nhà Lưu Đại, cô con dâu đứng đó.';

    const extracted = autoExtractStoryMemory(chineseSource, vietnameseTarget);
    // Không được tạo entity '劉大' (Lưu Đại)
    expect(extracted.entities.some((e) => e.chinese === '劉大')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // Thể loại Niên đại (period): Không bao giờ nhận nhầm thành Cảnh giới/Công pháp
  // và nhận diện chính xác giới tính, vai vế cho Lưu Thành Công, Trịnh Đông Lâm...
  // ─────────────────────────────────────────────────────────────────
  it('truyện Niên đại không nhận diện nhầm Lưu Thành Công (劉成功) thành Cảnh giới/Công pháp', () => {
    const sContext = '舒舒被留在狗蛋家由他的弟弟妹妹們照顧。狗蛋弟弟叫劉成功，妹妹叫劉珍。';
    const tContext = 'Em trai Cẩu Đản tên là Lưu Thành Công, em gái tên là Lưu Trân.';

    const meta = inferEntityMetadata('劉成功', 'Lưu Thành Công', sContext, tContext, 'period');
    expect(meta.category).toBe('character');
    expect(meta.gender).toBe('male');
    expect(meta.role).toBe('Em trai của Cẩu Đản');
  });

  it('nhận diện chính xác giới tính nam và vai vế của Trịnh Đông Lâm (鄭東林)', () => {
    const sContext = '後面還有兩個瞧着比舒舒大一點的小男孩在推車。他們一個叫鄭東林，前不久才過的四歲生日。';
    const tContext = 'Phía sau còn có hai cậu bé trông lớn hơn Thư Thư một chút đang đẩy xe. Một người tên là Trịnh Đông Lâm, vừa mới đón sinh nhật bốn tuổi cách đây không lâu.';

    const meta = inferEntityMetadata('鄭東林', 'Trịnh Đông Lâm', sContext, tContext, 'period');
    expect(meta.category).toBe('character');
    expect(meta.gender).toBe('male');
    expect(meta.role).toBe('Cậu bé 4 tuổi trong thôn');
  });

  it('nhận diện chính xác giới tính nam và vai vế của Lưu Thành Kiệt (劉成傑)', () => {
    const sContext = '“我也想要。”一個有點胖的四歲小男孩附和道。他叫劉成傑，小名狗蛋，也是經常和舒舒他們一起玩的一員。';
    const tContext = '“Tôi cũng muốn.” Một cậu bé bốn tuổi hơi mập phụ họa. Cậu bé tên là Lưu Thành Kiệt, tên ở nhà là Cẩu Đản, cũng là một thành viên thường xuyên chơi cùng bọn Thư Thư.';

    const meta = inferEntityMetadata('劉成傑', 'Lưu Thành Kiệt', sContext, tContext, 'period');
    expect(meta.category).toBe('character');
    expect(meta.gender).toBe('male');
    expect(meta.role).toBe('Cậu bé 4 tuổi trong thôn');
  });

  it('nhận diện chính xác giới tính nữ và vai vế của Lưu Lệ Quyên (劉麗娟)', () => {
    const sContext = '“你實話跟嫂子說，現在對那人，你是什麽感覺？” 也是小姑子上輩子的戀愛腦太讓人印象深刻，導致劉麗娟到現在都還有點怕她對人渣餘情未了。';
    const tContext = '“Em nói thật với chị dâu xem, bây giờ với người đó, em có cảm giác gì?” Đến tận bây giờ, Lưu Lệ Quyên vẫn hơi lo cô còn lưu luyến tên cặn bã kia.';

    const meta = inferEntityMetadata('劉麗娟', 'Lưu Lệ Quyên', sContext, tContext, 'period');
    expect(meta.category).toBe('character');
    expect(meta.gender).toBe('female');
    expect(meta.role).toBe('Chị dâu');
  });

  // ─────────────────────────────────────────────────────────────────
  // Chặn đứng triệt để thực thể rác (Từ thông dụng, cụm từ dính chữ)
  // ─────────────────────────────────────────────────────────────────
  it('chặn triệt để các từ đời sống thông dụng không bị nhận diện nhầm thành nhân vật', () => {
    // Thành tích, Cao khảo, Thông báo, Bánh bao, Xích đu, Xe buýt, Tiêu tiền, Sân phơi thóc, Yên tĩnh...
    expect(isLikelyCharacter('成績', 'Thành Tích', '', '')).toBe(false);
    expect(isLikelyCharacter('高考', 'Cao Khảo', '', '')).toBe(false);
    expect(isLikelyCharacter('通知', 'Thông Tri', '', '')).toBe(false);
    expect(isLikelyCharacter('包子', 'Bao Tử', '', '')).toBe(false);
    expect(isLikelyCharacter('秋千', 'Thu Thiên', '', '')).toBe(false);
    expect(isLikelyCharacter('公交', 'Công Giao', '', '')).toBe(false);
    expect(isLikelyCharacter('花錢', 'Hoa Tiền', '', '')).toBe(false);
    expect(isLikelyCharacter('安靜', 'An Tĩnh', '', '')).toBe(false);
    expect(isLikelyCharacter('舒服', 'Thư Phục', '', '')).toBe(false);
    expect(isLikelyCharacter('黃狗', 'Hoàng Cẩu', '', '')).toBe(false);
    expect(isLikelyCharacter('左右', 'Tả Hữu', '', '')).toBe(false);
    expect(isLikelyCharacter('家庭', 'Gia Đình', '', '')).toBe(false);
    expect(isLikelyCharacter('成年', 'Thành Niên', '', '')).toBe(false);
  });

  it('chặn triệt để các biến thể dính chữ của nhân vật chính Thư Thư (舒舒+động từ/trợ từ)', () => {
    expect(isLikelyCharacter('舒舒跟', 'Thư Thư Cân', '', '')).toBe(false);
    expect(isLikelyCharacter('舒舒要', 'Thư Thư Yêu', '', '')).toBe(false);
    expect(isLikelyCharacter('舒舒自', 'Thư Thư Tự', '', '')).toBe(false);
    expect(isLikelyCharacter('舒舒畢業', 'Thư Thư Tất Nghiệp', '', '')).toBe(false);
    expect(isLikelyCharacter('那時候陳', 'Na Thời Hậu Trần', '', '')).toBe(false);
    expect(isLikelyCharacter('周圍那麽', 'Chu Vi Na Ma', '', '')).toBe(false);
  });

  it('không tự gán bừa bãi nhãn "Cô bé trong thôn" cho Yến Tử An khi cùng đoạn văn với bé Thư Thư', () => {
    const sContext = '舒舒是個可愛的小女孩。晏梓安默默站在她旁邊守護着她。';
    const tContext = 'Thư Thư là một cô bé đáng yêu. Yến Tử An đứng lặng lẽ bên cạnh bảo vệ cô bé.';

    const meta = inferEntityMetadata('晏梓安', 'Yến Tử An', sContext, tContext, 'period');
    expect(meta.category).toBe('character');
    expect(meta.gender).toBe('male');
    expect(meta.role).not.toBe('Cô bé trong thôn');
  });

  it('tự động nhận diện khi đã có nhân vật Thư Thư và bỏ qua mọi biến thể dính chữ', () => {
    const sSource = '舒舒畢業了，她很高興。舒舒跟小夥伴一起玩。';
    const sTarget = 'Thư Thư Tốt Nghiệp rồi, cô bé rất vui. Thư Thư Cùng bạn nhỏ cùng chơi.';

    const existingEntities = [
      { id: '1', category: 'character' as const, chinese: '舒舒', vietnamese: 'Thư Thư' }
    ];

    const extracted = autoExtractStoryMemory(sSource, sTarget, {
      genre: 'period',
      existingEntities
    });

    // Không được tạo entity '舒舒畢業' hay '舒舒跟'
    expect(extracted.entities.some(e => e.chinese === '舒舒畢業')).toBe(false);
    expect(extracted.entities.some(e => e.chinese === '舒舒跟')).toBe(false);
  });
});
