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
      'quét mã QR', 'laptop', 'máy tính xách tay'
    ],
    unitSystem: {
      currency: ['đồng', 'hào', 'xu'],
      measurement: ['cân', 'thước', 'tấc', 'dặm', 'mẫu đất'],
    },
  },
  basePromptRules: `BỐI CẢNH NIÊN ĐẠI (1960-1980):
- Tuyệt đối không hiện đại hóa ngôn ngữ.
- Giữ đúng hệ thống từ vựng, vật dụng, cách gọi tổ chức của thời kỳ này.
- Tiền tệ dùng: đồng, hào, xu. Đo lường dùng: cân, thước, tấc, mẫu.
- Chủ thể - Động từ - Đối tượng rõ ràng, câu thoại tự nhiên, thuần Việt, đúng phong thái thời đại.`,
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
      self: 'cha / mẹ',
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
    { chinese: '介绍信', vietnamese: 'thư giới thiệu', category: 'term' },
    { chinese: '赤脚医生', vietnamese: 'bác sĩ chân đất', category: 'role' },
    { chinese: '同志', vietnamese: 'đồng chí', category: 'term' },
    { chinese: '自留地', vietnamese: 'đất tự lưu', category: 'term', notes: 'Đất canh tác riêng của hộ gia đình' },
    { chinese: '自留', vietnamese: 'tự lưu', category: 'term' },
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
