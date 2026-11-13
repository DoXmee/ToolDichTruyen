export interface GenreProfileWorldRules {
  eraRange?: string;
  forbiddenModernTerms?: readonly string[];
  unitSystem?: {
    currency?: readonly string[];
    measurement?: readonly string[];
  };
}

export interface GenreGlossaryItem {
  chinese: string;
  vietnamese: string;
  category?: 'term' | 'location' | 'role' | 'organization';
  notes?: string;
}

export interface GenreAddressDefault {
  relationType: string;
  speakerGender?: 'male' | 'female';
  listenerGender?: 'male' | 'female';
  self: string;
  call: string;
  tenseSelf?: string;
  tenseCall?: string;
}

export interface GenreProfile {
  id: string;
  name: string;
  version: number;
  basedOn?: string;
  basePromptRules: string;
  entityCategories: readonly string[];
  relationTypes: readonly string[];
  addressDefaults: readonly GenreAddressDefault[];
  glossary: readonly GenreGlossaryItem[];
  worldRules: GenreProfileWorldRules;
}

export const PERIOD_GENRE_PROFILE: GenreProfile = {
  id: 'period',
  name: 'Ngôn tình Niên đại Trung Quốc',
  version: 2,
  worldRules: {
    eraRange: 'Thập niên 1960 - 1980',
    forbiddenModernTerms: [
      'smartphone', 'điện thoại thông minh', 'wifi', 'internet', 'thẻ tín dụng',
      'xe hơi đời mới', 'thang máy', 'siêu thị mini', 'mạng xã hội', 'chuyển khoản',
      'quét mã QR', 'laptop', 'máy tính xách tay', 'online', 'offline', 'spotlight', 'scandal',
      'kang', 'chiếc kang', 'giường kang', 'hậu sơn', 'cao lãnh'
    ],
    unitSystem: {
      currency: ['đồng', 'hào', 'xu'],
      measurement: ['cân', 'thước', 'tấc', 'dặm', 'mẫu đất'],
    },
  },
  basePromptRules: `BỐI CẢNH NIÊN ĐẠI (1960-1980):
- Tuyệt đối không hiện đại hóa ngôn ngữ. CẤM từ lạc thời: online, offline, spotlight, scandal.
- CẤM bính âm: "kang" (炕) dịch là "giường sưởi"/"bệ sưởi". "后山" dịch "núi phía sau", "高冷" dịch "lạnh lùng".
- "甜甜一笑" dịch "cười ngọt ngào" (CẤM biến thành tên người "Điềm Điềm").
- TUYỆT ĐỐI CẤM TỪ XƯNG HÔ CỔ TRANG / KIẾM HIỆP: "nàng" -> "cô" / "cô ấy", "chàng" -> "anh" / "anh ấy", "huynh" -> "anh", "muội" -> "em", "đệ" -> "em". Chỉ giữ "sư huynh/sư muội" khi là đồng môn nghệ thuật.
- TIÊU CHUẨN THUẬT NGỮ LỊCH SỬ:
  + "臭老九" -> "đám trí thức thối tha" / "lũ trí thức" (CẤM dịch là "chín loại người").
  + "布拉吉" -> "váy liền kiểu Liên Xô (Bragi)".
  + "嫂子" -> dịch thuần Việt "chị dâu" hoặc "thím" (như "thím Trương", CẤM "Trương Tẩu Tử").
- Giữ đúng hệ thống từ vựng, vật dụng, cách gọi tổ chức:
  + "厂长" BẮT BUỘC dịch là "xưởng trưởng" hoặc "giám đốc xưởng" (NGHIÊM CẤM "Hán Trưởng").
  + "副厂长" BẮT BUỘC dịch là "phó xưởng trưởng".
  + "书记" -> "bí thư", "大队长" -> "đại đội trưởng", "营长" -> "doanh trưởng" / "tiểu đoàn trưởng".
- Tiền tệ dùng: đồng, hào, xu. Đo lường dùng: cân, thước, tấc, mẫu.
- CHÍNH TẢ NGHIÊM NGẶT: 100% đúng chính tả tiếng Việt. CẤM dính chữ, rụng dấu, lặp từ. Mọi thoại phải đủ ngoặc kép “...”.`,
  entityCategories: [
    'thanh_nien_tri_thuc',
    'dai_doi',
    'san_xuat_doi',
    'cong_xa',
    'khu_tap_the',
    'can_bo',
    'dia_danh',
  ],
  relationTypes: [
    'parent_child',
    'spouses',
    'siblings',
    'kin_extended',
    'cadre_villager',
    'fellow_educated_youth',
    'friends',
    'enemies',
  ],
  addressDefaults: [
    {
      relationType: 'parent_child',
      self: 'bố / mẹ',
      call: 'con',
      tenseSelf: 'tao',
      tenseCall: 'mày',
    },
    {
      relationType: 'spouses',
      self: 'anh / em',
      call: 'em / anh',
      tenseSelf: 'tôi',
      tenseCall: 'cô / anh',
    },
    {
      relationType: 'siblings',
      self: 'anh / chị / em',
      call: 'em / anh / chị',
      tenseSelf: 'mày',
      tenseCall: 'tao',
    },
    {
      relationType: 'fellow_educated_youth',
      self: 'tôi',
      call: 'cậu / đồng chí',
      tenseSelf: 'tôi',
      tenseCall: 'anh / cô',
    },
  ],
  glossary: [
    { chinese: '知青', vietnamese: 'thanh niên trí thức', category: 'role', notes: 'Tri thức trẻ về nông thôn' },
    { chinese: '生产队', vietnamese: 'đội sản xuất', category: 'organization', notes: 'Tổ chức cơ sở nông nghiệp' },
    { chinese: '大队', vietnamese: 'đại đội', category: 'organization', notes: 'Cấp trên của đội sản xuất' },
    { chinese: '大队长', vietnamese: 'đại đội trưởng', category: 'role' },
    { chinese: '支书', vietnamese: 'bí thư chi bộ', category: 'role' },
    { chinese: '公社', vietnamese: 'công xã', category: 'organization' },
    { chinese: '供销社', vietnamese: 'hợp tác xã mua bán', category: 'organization' },
    { chinese: '粮票', vietnamese: 'phiếu lương thực', category: 'term' },
    { chinese: '布票', vietnamese: 'phiếu vải', category: 'term' },
    { chinese: '肉票', vietnamese: 'phiếu thịt', category: 'term' },
    { chinese: '工分', vietnamese: 'điểm công', category: 'term', notes: 'Đơn vị tính công lao động' },
    { chinese: '大院', vietnamese: 'khu tập thể', category: 'location' },
    { chinese: '炕', vietnamese: 'giường sưởi', category: 'term', notes: 'Bệ sưởi Đông Bắc' },
    { chinese: '后山', vietnamese: 'núi phía sau', category: 'location' },
    { chinese: '高冷', vietnamese: 'lạnh lùng', category: 'term' },
    { chinese: '介绍信', vietnamese: 'thư giới thiệu', category: 'term' },
    { chinese: '赤脚医生', vietnamese: 'bác sĩ chân đất', category: 'role' },
    { chinese: '同志', vietnamese: 'đồng chí', category: 'term' },
    { chinese: '自留地', vietnamese: 'đất tự lưu', category: 'term', notes: 'Đất canh tác riêng của hộ gia đình' },
    { chinese: '自留', vietnamese: 'tự lưu', category: 'term' },
    { chinese: '厂长', vietnamese: 'xưởng trưởng', category: 'role', notes: 'Giám đốc / xưởng trưởng nhà máy, cấm dịch là Hán Trưởng' },
    { chinese: '副厂长', vietnamese: 'phó xưởng trưởng', category: 'role' },
    { chinese: '书记', vietnamese: 'bí thư', category: 'role' },
    { chinese: '营长', vietnamese: 'doanh trưởng', category: 'role', notes: 'Chỉ huy cấp tiểu đoàn / doanh' },
    { chinese: '副营长', vietnamese: 'phó doanh trưởng', category: 'role' },
    { chinese: '团长', vietnamese: 'đoàn trưởng', category: 'role', notes: 'Chỉ huy cấp trung đoàn' },
    { chinese: '臭老九', vietnamese: 'đám trí thức thối tha', category: 'role', notes: 'Tiếng lóng miệt thị trí thức thời CMVH, cấm dịch là chín loại người' },
    { chinese: '布拉吉', vietnamese: 'váy liền kiểu Liên Xô (Bragi)', category: 'term', notes: 'Váy hoa liền thân kiểu Nga thời thập niên 50-70' },
  ],
};

export const CULTIVATION_GENRE_PROFILE: GenreProfile = {
  id: 'cultivation',
  name: 'Tiên hiệp / Tu chân',
  version: 2,
  worldRules: {
    unitSystem: {
      currency: ['linh thạch', 'linh tinh'],
      measurement: ['dặm', 'trượng', 'thước'],
    },
  },
  basePromptRules: `HỆ THỐNG TU CHÂN & KHÍ CHẤT TIÊN HIỆP:
- Giữ đúng tôn ti: Sư tôn/Sư phụ, Đồ nhi, Sư huynh/Sư muội, Đạo hữu, Tiền bối/Vãn bối.
- Thuật ngữ nhất quán: linh căn, linh khí, đan dược, pháp bảo, trận pháp, công pháp.
- Tuyệt đối không hiện đại hóa ngữ nghĩa.`,
  entityCategories: ['sect', 'cultivation_rank', 'artifact', 'pill', 'location'],
  relationTypes: ['master_disciple', 'sect_peers', 'dao_companions', 'enemies'],
  addressDefaults: [
    {
      relationType: 'master_disciple',
      self: 'vi sư',
      call: 'đồ nhi',
      tenseSelf: 'bổn tọa',
      tenseCall: 'nghiệt đồ',
    },
    {
      relationType: 'dao_companions',
      self: 'chàng / thiếp',
      call: 'thiếp / chàng',
      tenseSelf: 'ngươi',
      tenseCall: 'ta',
    },
  ],
  glossary: [
    { chinese: '灵石', vietnamese: 'linh thạch', category: 'term' },
    { chinese: '宗门', vietnamese: 'tông môn', category: 'organization' },
    { chinese: '师尊', vietnamese: 'sư tôn', category: 'role' },
    { chinese: '道友', vietnamese: 'đạo hữu', category: 'term' },
  ],
};

export const UNIVERSAL_GENRE_PROFILE: GenreProfile = {
  id: 'universal',
  name: 'Đa thể loại (Toàn năng)',
  version: 2,
  worldRules: {},
  basePromptRules: `VĂN PHONG ĐA NĂNG & THUẦN VIỆT:
- Dịch mượt mà, lưu loát, tự nhiên, đúng ngữ pháp và thói quen diễn đạt của người Việt.
- Giữ đúng giọng văn, sắc thái cảm xúc và bối cảnh cốt truyện của tác giả.
- Chủ ngữ - Vị ngữ - Bổ ngữ rõ ràng, lời thoại sinh động và phù hợp với tính cách nhân vật.
- Dịch thoát nghĩa, tuyệt đối không dịch thô ráp kiểu convert, không để sót Hán tự.`,
  entityCategories: ['character', 'location', 'faction', 'organization', 'term'],
  relationTypes: ['family', 'friends', 'colleagues', 'enemies'],
  addressDefaults: [],
  glossary: [],
};

const PROFILES: Record<string, GenreProfile> = {
  period: PERIOD_GENRE_PROFILE,
  cultivation: CULTIVATION_GENRE_PROFILE,
  universal: UNIVERSAL_GENRE_PROFILE,
  custom: UNIVERSAL_GENRE_PROFILE,
  modern: UNIVERSAL_GENRE_PROFILE,
  ancient: UNIVERSAL_GENRE_PROFILE,
};

export function getGenreProfile(profileId: string): GenreProfile {
  return PROFILES[profileId] ?? UNIVERSAL_GENRE_PROFILE;
}
