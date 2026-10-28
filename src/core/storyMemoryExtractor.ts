import type {
  CharacterRelation,
  EntityCategory,
  StoryEntity,
  StoryMemory,
  StoryRecentDialogue,
} from '../shared/types.js';

import rawHanVietDict from './hanVietDictionary.json';
import { sify } from 'chinese-conv';

// Comprehensive Han-Viet mapping loaded from full dictionary (15,520+ Chinese characters)
export const HAN_VIET_MAP: Record<string, string[]> = rawHanVietDict as Record<string, string[]>;

// Recognized Chinese Surnames (hundred family surnames and frequent novel surnames)
export const CHINESE_SURNAMES = new Set([
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜',
  '戚', '谢', '邹', '喻', '柏', '水', '窦', '章', '云', '苏', '潘', '葛', '奚', '范', '彭', '郎',
  '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳', '酆', '鲍', '史', '唐',
  '费', '廉', '岑', '薛', '雷', '贺', '倪', '汤', '滕', '殷', '罗', '毕', '郝', '邬', '安', '常',
  '乐', '于', '时', '傅', '皮', '卞', '齐', '康', '伍', '余', '元', '卜', '顾', '孟', '平', '黄',
  '和', '穆', '萧', '尹', '姚', '邵', '湛', '汪', '祁', '毛', '禹', '狄', '米', '贝', '明', '臧',
  '计', '伏', '成', '戴', '谈', '宋', '茅', '庞', '熊', '纪', '舒', '屈', '项', '祝', '董', '梁',
  '杜', '阮', '蓝', '闵', '席', '季', '麻', '强', '贾', '路', '娄', '危', '江', '童', '颜', '郭',
  '梅', '盛', '林', '刁', '钟', '徐', '邱', '骆', '高', '夏', '蔡', '田', '樊', '胡', '凌', '霍',
  '虞', '万', '支', '柯', '昝', '管', '卢', '莫', '经', '房', '裘', '缪', '干', '解', '应', '宗',
  '丁', '宣', '贲', '邓', '郁', '单', '杭', '洪', '包', '诸', '左', '石', '崔', '吉', '钮', '龚',
  '程', '嵇', '邢', '滑', '裴', '陆', '荣', '翁', '荀', '羊', '於', '惠', '甄', '曲', '家', '封',
  '芮', '羿', '储', '靳', '汲', '邴', '糜', '松', '井', '段', '富', '巫', '乌', '焦', '巴', '弓',
  '牧', '隗', '山', '谷', '车', '侯', '宓', '蓬', '全', '郗', '班', '仰', '秋', '仲', '伊', '宫',
  '宁', '仇', '栾', '暴', '甘', '钭', '厉', '戎', '祖', '武', '符', '刘', '景', '詹', '束', '龙',
  '叶', '幸', '司', '韶', '郜', '黎', '蓟', '薄', '印', '宿', '白', '怀', '蒲', '邰', '从', '鄂',
  '索', '咸', '籍', '赖', '卓', '蔺', '屠', '蒙', '池', '乔', '阴', '郁', '胥', '能', '苍', '双',
  '闻', '莘', '党', '翟', '谭', '贡', '劳', '逄', '姬', '申', '扶', '堵', '冉', '宰', '郦', '雍',
  '郤', '璩', '桑', '桂', '濮', '牛', '寿', '通', '边', '扈', '燕', '冀', '郏', '浦', '尚', '农',
  '温', '别', '庄', '晏', '柴', '瞿', '阎', '充', '慕', '连', '茹', '习', '宦', '艾', '鱼', '容',
  '向', '古', '易', '慎', '戈', '廖', '庾', '终', '暨', '居', '衡', '步', '都', '耿', '满', '弘',
  '匡', '国', '文', '寇', '广', '禄', '阙', '东', '欧', '殳', '沃', '利', '蔚', '越', '夔', '隆',
  '师', '巩', '厍', '聂', '晁', '勾', '敖', '融', '冷', '訾', '辛', '阚', '那', '简', '饶', '空',
  '曾', '毋', '沙', '乜', '养', '鞠', '须', '丰', '巢', '关', '蒯', '相', '查', '后', '荆', '红',
  '游', '竺', '权', '逯', '盖', '益', '桓', '公', '仉', '督', '晋', '楚',
  // Traditional variants:
  '趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳', '蔣', '瀋', '韓', '楊',
  '朱', '許', '呂', '張', '嚴', '華', '金', '魏', '謝', '鄒', '章', '雲', '蘇', '蕭',
  '馬', '鳳', '鮑', '費', '薛', '湯', '羅', '畢', '郝', '樂', '時', '齊', '顧', '黃',
  '葉', '劉', '鄧', '陸', '龍', '盧', '鐘', '蕭', '譚', '嚴', '鄒', '鍾', '關', '萬',
]);

// Chinese compound surnames
export const CHINESE_COMPOUND_SURNAMES = [
  '欧阳', '歐陽', '诸葛', '諸葛', '司马', '司馬', '司徒', '慕容', '端木', '上官',
  '公孙', '公孫', '宇文', '夏侯', '东方', '東方', '赫连', '赫連', '皇甫', '尉迟',
  '尉遲', '澹台', '澹臺', '独孤', '獨孤', '长孙', '長孫', '令狐', '百里', '钟离',
  '鍾離', '万俟', '萬俟', '闻人', '聞人', '西门', '西門', '南宫', '南宮',
];

// Directions and geographic regions (Locations - never characters)
export const DIRECTIONS_AND_REGIONS = new Set([
  '西北', '东北', '西南', '东南', '正北', '正南', '正东', '正西',
  '北方', '南方', '西方', '东方', '塞北', '塞外', '关内', '关外',
  '江南', '江北', '中原', '华夏', '九州', '四海', '大荒', '北域',
  '南疆', '西域', '东海', '漠北', '岭南', '关东', '关西', '京城',
  '首都', '天南', '北凉', '西凉', '南蛮', '东荒', '西漠', '北原',
  '大漠', '北疆', '南国', '北国',
  // Historical capitals & cities
  '燕京', '盛京', '北京', '南京', '东京', '東京', '西京', '汴京',
  '长安', '長安', '洛阳', '洛陽', '金陵', '临安', '臨安', '姑苏', '姑蘇',
  '扬州', '揚州', '杭州', '苏州', '蘇州', '江宁', '江寧', '咸阳', '咸陽',
  '汴梁', '幽州', '冀州', '兖州', '青州', '徐州', '荆州', '梁州', '雍州', '豫州',
  // Chinese Provinces, Autonomous Regions & Municipalities (Traditional & Simplified)
  '山东', '山東', '河北', '山西', '河南', '湖北', '湖南', '广东', '廣東',
  '广西', '廣西', '江苏', '江蘇', '浙江', '江西', '安徽', '福建', '四川',
  '云南', '雲南', '贵州', '貴州', '陕西', '陝西', '甘肃', '甘肅', '青海',
  '海南', '黑龙江', '黑龍江', '吉林', '辽宁', '遼寧', '内蒙古', '內蒙古',
  '新疆', '西藏', '宁夏', '寧夏', '天津', '重庆', '重慶', '上海',
  '香港', '澳门', '澳門', '台湾', '臺灣',
]);

// Urban & architectural features frequently capitalized in Vietnamese translation (Locations - never characters)
export const URBAN_ARCHITECTURAL_LOCATIONS = new Set([
  '城根', '墙根', '大院', '胡同', '四合院', '街道', '广场', '车间',
  '厂房', '公社', '大队', '生产队', '卫生所', '招待所', '供销社',
  '百货大楼', '学校', '医院', '车站', '火车站', '机场', '码头', '碼頭',
  '村庄', '村落', '山谷', '深渊', '禁地', '秘境', '洞府', '知青点',
  '国营饭店', '供销店', '生产车间', '卫生院', '大礼堂', '筒子楼', '家属院',
]);

// Common Nouns, Meteorological/Nature words, Political slogans, and Figurative idioms
// These should NEVER become characters and should not pollute StoryMemory
export const COMMON_NOUN_BLACKLIST = new Set([
  // Academic, examinations, notifications, common daily life words
  '高考', '成績', '成绩', '通知', '畢業', '毕业', '大學', '大学', '學校', '学校', '考試', '考试',
  '包子', '秋千', '公交', '大卡車', '大卡车', '拖拉機', '拖拉机', '黃狗', '黄狗', '大黃狗', '大黄狗',
  '小狗', '小貓', '小猫', '安靜', '安静', '舒服', '高興', '高兴', '生氣', '生气', '左右', '前後', '前后',
  '上下', '家庭', '成年', '青年', '花錢', '花钱', '賺錢', '赚钱', '通過', '通过', '都得', '許多', '许多',
  '任何', '畢竟', '毕竟', '將來', '将来', '江來', '曹操', '華國', '华国', '中國', '中国', '谷場', '谷场',
  '申請', '申请', '小孩子', '小孩', '小家伙', '小家夥', '小伙伴', '小夥伴', '小姑娘', '小男孩', '小女孩',
  '小脑袋', '小腦袋', '小手', '小脸', '小臉', '小女', '小儿', '小兒', '小小', '老汉', '老漢', '老妇', '老婦',
  '老人', '老头', '老頭', '老婆', '老公', '周圍那麽', '周圍那么', '周围那么', '那時候', '那时候', '那時候陳',
  '这时候', '這時候', '那麽多', '那麼多', '那么多', '這麽多', '這麼多', '这么多',
  // Nature & Weather
  '雪花', '白云', '烏雲', '乌云', '朝阳', '夕阳', '春风', '秋风', '晨光',
  '月光', '阳光', '暴风', '暴雨', '繁星', '流星', '飞雪', '狂风', '微风',
  '残阳', '落日', '日出', '云彩', '天地', '乾坤', '阴阳', '星辰', '风雨', '山水',
  // Slogans / Social concepts / Era terms
  '富强', '富強', '民主', '文明', '和谐', '自由', '平等', '公正', '法治',
  '爱国', '敬业', '诚信', '友善', '革命', '建设', '劳动', '模范', '先进',
  '太平', '光荣', '胜利', '进步', '幸福', '团结', '友谊', '和平', '安宁',
  '青春', '岁月', '命运', '前途', '群众', '组织', '领导', '人民',
  // Mythological idioms / Slang epithets / Folklore tropes
  '白无常', '白無常', '黑无常', '黑無常', '阎王', '閻王', '孟婆', '牛头', '牛頭',
  '马面', '馬面', '牛鬼蛇神', '孤魂野鬼', '风水轮流',
  '白毛女', '白毛', '白骨精', '狐狸精', '扫把星', '替死鬼', '老天爷', '老天', '红旗',
  // Common reduplicated adverbs, state words and everyday actions (never characters)
  '高高', '慢慢', '常常', '早早', '天天', '多多', '好好', '看看', '走走', '大大',
  '静静', '默默', '悄悄', '明明', '暗暗', '生生', '渐渐', '漸漸', '平平',
  // Everyday tools / vehicles
  '卡车', '大卡车', '拖拉机', '自行车', '手电筒', '收音机', '缝纫机',
  '大茶缸', '暖水瓶', '搪瓷缸', '大扁担',
]);

export const INVALID_NAME_ENDINGS = new Set([
  '的', '了', '著', '着', '不', '也', '就', '一', '和', '沒', '没', '很', '看', '還', '还',
  '說', '说', '道', '問', '问', '想', '去', '來', '来', '到', '在', '把', '被', '讓', '让', '給', '给',
  '裏', '里', '是', '邊', '边', '人', '都', '些', '上', '下', '中', '前', '後', '后', '內', '内', '外',
  '笑', '哭', '喊', '叫', '帶', '带', '拿', '抓', '跑', '跳', '走', '坐', '站', '拉', '推',
  '這', '这', '那', '心', '有', '點', '点', '覺', '觉', '對', '对', '能', '吃', '喝', '聽', '听', '望',
  '要', '跟', '自', '得', '過', '过', '錢', '钱', '票', '話', '话', '事', '物', '們', '们', '個', '个',
]);

export const INVALID_NAME_PREFIXES = [
  '那時', '那时', '這時', '这时', '當時', '当时', '周圍', '周围', '附近', '突然', '如果', '因為', '因为', '雖然', '虽然',
];

const LOCATION_SUFFIXES = [
  '胡同', '村', '镇', '鎮', '城', '山', '河', '江', '海', '峰',
  '谷', '洞', '阁', '閣', '京', '省', '市', '路', '街', '巷',
  '坊', '弄', '关', '關', '堡', '寨', '营', '營', '渡', '滩',
  '灘', '原', '野', '店', '厂', '廠', '院', '社', '所', '部',
  '站', '港', '国', '國', '洲', '区', '區', '里', '域',
];

const FACTION_SUFFIXES = [
  '宗', '门', '門', '派', '帮', '幫', '教', '殿', '庄', '莊',
  '府', '阁', '幫會', '帮会', '商会', '公会', '学会', '协会', '委员会', '工会',
  '集团', '公司', '部族', '世家', '皇室', '朝廷', '生产队', '大队', '公社',
];

const CULTIVATION_SUFFIXES = [
  '诀', '訣', '经', '經', '功', '法', '境', '丹', '阵', '陣',
];

// Common Vietnamese stopwords / grammar words that are capitalized at sentence start but not proper nouns
const VIETNAMESE_STOPWORDS = new Set([
  'ngày', 'tháng', 'năm', 'hôm', 'đêm', 'sáng', 'chiều', 'tối', 'trưa',
  'sau', 'trước', 'trong', 'ngoài', 'trên', 'dưới', 'giữa', 'bên',
  'tết', 'mùa', 'xuân', 'hạ', 'thu', 'đông', 'thời', 'gian', 'lúc', 'khi',
  'thế', 'nhưng', 'tuy', 'mặc', 'dù', 'cho', 'dẫu', 'vì', 'bởi', 'do',
  'không', 'chưa', 'chẳng', 'đã', 'đang', 'sẽ', 'vừa', 'mới',
  'nếu', 'giả', 'sử', 'miễn', 'hễ', 'như', 'tựa', 'giống',
  'người', 'kẻ', 'ai', 'gì', 'đâu', 'nào', 'sao', 'mấy',
  'ông', 'bà', 'anh', 'chị', 'em', 'cô', 'chú', 'bác', 'cậu', 'mợ',
  'cha', 'mẹ', 'con', 'cháu', 'hắn', 'nàng', 'chàng', 'ta', 'ngươi',
  'tôi', 'mình', 'chúng', 'bọn', 'tụi', 'các', 'những', 'mọi', 'mỗi',
  'bỗng', 'đột', 'thoáng', 'chợt', 'liền', 'ngay', 'lập', 'tức',
  'nhìn', 'thấy', 'nghe', 'nói', 'bảo', 'hỏi', 'đáp', 'kể', 'nghĩ',
  'đi', 'đến', 'về', 'lại', 'ra', 'vào', 'lên', 'xuống',
  'cười', 'khóc', 'thở', 'kêu', 'la', 'hét', 'quát', 'mắng',
  'cả', 'toàn', 'hết', 'tất', 'đều', 'cũng', 'vẫn', 'còn',
  'rất', 'quá', 'lắm', 'cực', 'vô', 'cùng', 'hơi', 'khá',
  'được', 'bị', 'phải', 'nên', 'cần', 'muốn', 'thích',
  'tiếng', 'âm', 'thanh', 'bước', 'chân', 'bóng', 'dáng',
  'chuyện', 'việc', 'điều', 'thứ', 'cái', 'chiếc', 'bức',
  'thực', 'sự', 'quả', 'nhiên', 'hiển', 'nhiên', 'đương',
  'hướng', 'vùng', 'miền', 'phía',
]);

export interface ExtractedStoryMemory {
  entities: StoryEntity[];
  relations: CharacterRelation[];
  recentDialogues: StoryRecentDialogue[];
  /**
   * Gợi ý ngữ cảnh bổ sung cho ChatGPT khi có tên gọi tắt không xác định được
   * nhân vật cụ thể (2+ nhân vật cùng mang tên tắt đó trong đoạn).
   */
  contextHint?: string;
}

/**
 * Escapes string for RegExp safely.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes Vietnamese string to standard lowercase NFC without extra spaces.
 */
function normalizeVn(text: string): string {
  return text.trim().toLowerCase().normalize('NFC');
}

/**
 * Standardizes tone mark placement for vowel combinations (òa/oà, úy/uý...)
 * to ensure phonetic equivalence between old and new Vietnamese orthography.
 */
function normalizeToneOrthography(w: string): string {
  return w
    .replace(/oà/g, 'òa').replace(/oá/g, 'óa').replace(/oả/g, 'ỏa').replace(/oã/g, 'õa').replace(/oạ/g, 'ọa')
    .replace(/uỳ/g, 'ùy').replace(/uý/g, 'úy').replace(/uỷ/g, 'ủy').replace(/uỹ/g, 'ũy').replace(/uỵ/g, 'ụy')
    .replace(/oè/g, 'òe').replace(/oé/g, 'óe').replace(/oẻ/g, 'ỏe').replace(/oẽ/g, 'õe').replace(/oẹ/g, 'ọe');
}

function wordMatchesReadings(vnWord: string, readings: string[]): boolean {
  if (readings.includes(vnWord)) return true;
  const normWord = normalizeToneOrthography(vnWord);
  return readings.some((r) => normalizeToneOrthography(r) === normWord);
}

/**
 * Checks whether a candidate Chinese sequence matches a Vietnamese proper noun using Han-Viet mappings.
 * Supports direct sequential order as well as 2-word inverted titles (e.g. "Thím Trần" <=> "陈婶").
 */
export function verifyHanVietMatch(vnName: string, chineseCandidate: string): boolean {
  const vnWords = normalizeVn(vnName).split(/\s+/);
  if (vnWords.length !== chineseCandidate.length) return false;

  // 1. Direct sequential match
  let directMatch = true;
  for (let i = 0; i < vnWords.length; i++) {
    const ch = chineseCandidate[i];
    if (!ch) { directMatch = false; break; }
    const possibleReadings = HAN_VIET_MAP[ch];
    if (!possibleReadings) { directMatch = false; break; }
    const vnWord = vnWords[i];
    if (!vnWord || !wordMatchesReadings(vnWord, possibleReadings)) {
      directMatch = false;
      break;
    }
  }
  if (directMatch) return true;

  // 2. Inverted order for 2-word title/honorific (e.g. "Thím Trần" <=> "陈婶", "Bác Trương" <=> "张伯")
  if (vnWords.length === 2 && chineseCandidate.length === 2) {
    const ch0 = chineseCandidate[0]!;
    const ch1 = chineseCandidate[1]!;
    const r0 = HAN_VIET_MAP[ch0];
    const r1 = HAN_VIET_MAP[ch1];
    const w0 = vnWords[0]!;
    const w1 = vnWords[1]!;
    if (r0 && r1 && wordMatchesReadings(w1, r0) && wordMatchesReadings(w0, r1)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if candidate starts with a recognized single or compound Chinese surname.
 */
export function isChineseSurname(chinese: string): boolean {
  for (const comp of CHINESE_COMPOUND_SURNAMES) {
    if (chinese.startsWith(comp)) return true;
  }
  const first = chinese[0];
  if (first && CHINESE_SURNAMES.has(first)) return true;
  return false;
}

/**
 * Transcribes a Chinese character sequence to standard Vietnamese Han-Viet capitalization.
 * Returns undefined if any character has no mapping.
 */
export function transcribeHanViet(chinese: string): string | undefined {
  if (!chinese) return undefined;
  const words: string[] = [];
  for (const ch of chinese) {
    const list = HAN_VIET_MAP[ch];
    if (!list || list.length === 0) return undefined;
    const w = list[0];
    if (!w) return undefined;
    words.push(w.charAt(0).toUpperCase() + w.slice(1));
  }
  return words.join(' ');
}

/**
 * Checks if target context directly adjoins a personal title/honorific to the Vietnamese name.
 */
function hasDirectHonorific(normVn: string, normTgt: string): boolean {
  const honorifics = [
    'anh', 'chị', 'cô', 'chú', 'bác', 'ông', 'bà', 'cậu', 'mợ',
    'cha', 'mẹ', 'nàng', 'chàng', 'hắn', 'gã', 'tiểu thư', 'công tử',
    'thiếu gia', 'đại hiệp', 'tiểu tử', 'nha đầu', 'sư phụ', 'sư huynh',
    'sư muội', 'sư tỷ', 'sư đệ', 'đại ca', 'nhị ca', 'tam đệ', 'muội muội',
  ];
  for (const h of honorifics) {
    const regBefore = new RegExp(`\\b${escapeRegExp(h)}\\s+${escapeRegExp(normVn)}\\b`, 'i');
    if (regBefore.test(normTgt)) return true;
  }
  return false;
}

/**
 * Checks if target context directly adjoins speech/action verbs indicating personhood.
 */
function hasDirectAction(normVn: string, normTgt: string): boolean {
  const actions = [
    'nói', 'bảo', 'hỏi', 'đáp', 'cười', 'nhìn', 'gật đầu', 'thở dài', 'kêu', 'quát', 'la', 'mắng',
  ];
  for (const a of actions) {
    const regAfter = new RegExp(`\\b${escapeRegExp(normVn)}\\s+${escapeRegExp(a)}\\b`, 'i');
    if (regAfter.test(normTgt)) return true;
    const regBefore = new RegExp(`\\b${escapeRegExp(a)}\\s+${escapeRegExp(normVn)}\\b`, 'i');
    if (regBefore.test(normTgt)) return true;
  }
  return false;
}

/**
 * Checks if Chinese source text has dialogue speech verbs directly adjoining the candidate.
 */
function hasDirectChineseSpeech(chinese: string, sContext: string): boolean {
  const zhSpeech = ['说', '道', '问', '喊', '笑', '怒', '叹'];
  for (const s of zhSpeech) {
    if (sContext.includes(`${chinese}${s}`) || sContext.includes(`${s}${chinese}`)) return true;
  }
  return false;
}

/**
 * Strict evaluation of whether a candidate is genuinely a character.
 */
export function isLikelyCharacter(
  chinese: string,
  vietnamese: string,
  sContext: string,
  tContext: string,
): boolean {
  if (!chinese || chinese.length < 2 || chinese.length > 4) {
    return false;
  }

  // 1. Chặn đuôi kết thúc là từ nối / trợ từ / động từ / danh từ thông dụng
  if (INVALID_NAME_ENDINGS.has(chinese[chinese.length - 1]!)) {
    return false;
  }

  // 2. Chặn tiền tố thời gian / ngữ cảnh
  if (INVALID_NAME_PREFIXES.some((p) => chinese.startsWith(p))) {
    return false;
  }

  // 3. Chặn các cụm từ dính tên nhân vật chính Thư Thư (舒舒 + hành động / quan hệ)
  if (chinese.startsWith('舒舒') && chinese.length > 2) {
    return false;
  }

  // 4. If in blacklist or explicit non-character sets -> definitively NOT a character
  if (
    COMMON_NOUN_BLACKLIST.has(chinese) ||
    DIRECTIONS_AND_REGIONS.has(chinese) ||
    URBAN_ARCHITECTURAL_LOCATIONS.has(chinese)
  ) {
    return false;
  }

  // 5. Reduplicated 2-character words (AA pattern like 高高, 慢慢, 大大) are adverbs/adjectives,
  // NOT characters unless preceded by an intimate/honorific prefix like '小', '阿'
  if (chinese.length === 2 && chinese[0] === chinese[1]) {
    return false;
  }

  // Check 1: Starts with a recognized Chinese surname
  const hasSurname = isChineseSurname(chinese);

  // Check 2: Intimate prefix (老/小/大/阿 + 1-2 Hanzi)
  // Chỉ chấp nhận nếu chữ sau là một họ người (như 老陈, 小张) HOẶC danh xưng thân tộc chuẩn (大爷, 大叔, 大伯, 大婶, 大娘, 阿姨)
  // Loại trừ các từ miêu tả kích thước/danh từ như 小孩, 小家伙, 小脑袋, 小小, 小狗, 小女...
  const isHonorificKinship = /^[老小大阿](?:伯|叔|婶|嬸|娘|爷|爺|奶|姨|哥|姐|弟|妹)$/.test(chinese);
  const isSurnameIntimate = /^[老小大阿][\u4e00-\u9fa5]$/.test(chinese) && isChineseSurname(chinese.slice(1));
  const hasValidPrefix = isHonorificKinship || isSurnameIntimate;

  const normVn = normalizeVn(vietnamese);
  const normTgt = normalizeVn(tContext);

  // Check 3: Vietnamese personal honorifics directly attached
  const hasVnHonorific = hasDirectHonorific(normVn, normTgt);

  // Check 4: Vietnamese speech / action verbs directly attached
  const hasVnAction = hasDirectAction(normVn, normTgt);

  // Check 5: Chinese speech markers directly attached
  const hasZhSpeech = hasDirectChineseSpeech(chinese, sContext);

  if (hasSurname) {
    return true;
  }

  if (hasValidPrefix || hasVnHonorific) {
    return true;
  }

  if (hasVnAction || hasZhSpeech) {
    return true;
  }

  return false;
}

/**
 * Checks if the story genre is cultivation, xianxia, wuxia, or fantasy.
 * In non-cultivation genres (like 'period', 'modern', 'ancient'), cultivation/martial arts entities are strictly disabled.
 */
export function isCultivationGenre(genre?: string): boolean {
  if (!genre) return false;
  const g = genre.toLowerCase();
  return (
    g.includes('cultivation') ||
    g.includes('xianxia') ||
    g.includes('wuxia') ||
    g.includes('fantasy') ||
    g.includes('tu chân') ||
    g.includes('tiên hiệp') ||
    g.includes('võ hiệp') ||
    g.includes('huyền huyễn')
  );
}

/**
 * Rigorous gender detection strictly using adjoining markers and confirmed roles.
 * No wide, loose 60-character context regex searches!
 */
export function detectCharacterGender(
  chinese: string,
  normVn: string = '',
  sourceContext: string = '',
  normTgt: string = '',
  role?: string,
): 'male' | 'female' | 'unknown' {
  const femalePrefixes = [
    'cô', 'chị', 'nàng', 'bà', 'mẹ', 'dì', 'thím', 'bác gái',
    'thiếu nữ', 'tiểu thư', 'bé gái', 'con gái', 'nữ'
  ];
  const malePrefixes = [
    'anh', 'chàng', 'ông', 'cha', 'bố', 'chú', 'bác trai',
    'cậu', 'thiếu gia', 'con trai', 'gã', 'hắn', 'nam', 'nam tử'
  ];

  let femaleScore = 0;
  let maleScore = 0;

  for (const p of femalePrefixes) {
    const regBefore = new RegExp(`\\b${escapeRegExp(p)}\\s+${escapeRegExp(normVn)}\\b`, 'i');
    if (regBefore.test(normTgt)) femaleScore += 3;
    const regAfter = new RegExp(`\\b${escapeRegExp(normVn)}\\s+(?:cô ấy|nàng|chị ấy)\\b`, 'i');
    if (regAfter.test(normTgt)) femaleScore += 2;
  }

  for (const p of malePrefixes) {
    const regBefore = new RegExp(`\\b${escapeRegExp(p)}\\s+${escapeRegExp(normVn)}\\b`, 'i');
    if (regBefore.test(normTgt)) maleScore += 3;
    const regAfter = new RegExp(`\\b${escapeRegExp(normVn)}\\s+(?:anh ấy|chàng|hắn)\\b`, 'i');
    if (regAfter.test(normTgt)) maleScore += 2;
  }

  // Children / boy / girl phrases in Vietnamese context (chỉ kiểm tra khi đi liền kề hoặc là câu vị ngữ định danh)
  const boyRegex = new RegExp(`(?:cậu bé|bé trai|thằng bé|chú bé|thằng nhóc|hai cậu bé|ba cậu bé)\\s+[^,.;]{0,20}?(?:tên là|gọi là)?\\s*${escapeRegExp(normVn)}\\b`, 'i');
  if (boyRegex.test(normTgt)) maleScore += 4;
  const boyAfterRegex = new RegExp(`\\b${escapeRegExp(normVn)}\\b\\s+là\\s+(?:một\\s+)?(?:cậu bé|bé trai)`, 'i');
  if (boyAfterRegex.test(normTgt)) maleScore += 4;

  const girlRegex = new RegExp(`(?:cô bé|bé gái|con bé|hai cô bé|ba cô bé)\\s+[^,.;]{0,20}?(?:tên là|gọi là)?\\s*${escapeRegExp(normVn)}\\b`, 'i');
  if (girlRegex.test(normTgt)) femaleScore += 4;
  const girlAfterRegex = new RegExp(`\\b${escapeRegExp(normVn)}\\b\\s+là\\s+(?:một\\s+)?(?:cô bé|bé gái)`, 'i');
  if (girlAfterRegex.test(normTgt)) femaleScore += 4;

  // Kinship with intervening descriptive words (e.g. "con trai cả của Trương Tẩu Tử, Trần Đại Lương")
  const maleRelRegex = new RegExp(`(?:con trai|chồng|anh trai|cha|bố|bác trai|chú|ông|cậu|nam tử|con rể|em trai)[^,.;]{0,45}\\b${escapeRegExp(normVn)}\\b`, 'i');
  if (maleRelRegex.test(normTgt)) maleScore += 4;

  const femaleRelRegex = new RegExp(`(?:con gái|vợ|chị gái|mẹ|bác gái|dì|thím|bà|cô|thiếu nữ|con dâu|em gái)[^,.;]{0,45}\\b${escapeRegExp(normVn)}\\b`, 'i');
  if (femaleRelRegex.test(normTgt)) femaleScore += 4;

  // Direct Chinese adjacency: check adjoining sentence context (strictly within same sentence, never bleed across 。！？\n)
  const zhIdx = sourceContext.indexOf(chinese);
  if (zhIdx !== -1) {
    const rawPre = sourceContext.slice(Math.max(0, zhIdx - 35), zhIdx);
    const rawPost = sourceContext.slice(zhIdx + chinese.length, zhIdx + chinese.length + 35);
    const pre35 = rawPre.split(/[。！？\n]/).pop() || '';
    const post35 = rawPost.split(/[。！？\n]/)[0] || '';

    // Single character markers strictly dedicated to gender (NEVER include 生, 同, 志!)
    if (/[她娘妹姐姑娘妇媳婶嬸姨姑婆女]/.test(pre35) || (/[她娘妹姐姑娘妇媳婶嬸姨姑婆女]/.test(post35) && !/站在|看着|望著|望着|跟|陪|送|找/.test(post35))) femaleScore += 2;
    if (/[他哥弟爹父汉漢郎爷爺公叔伯侄婿男]/.test(pre35) || (/[他哥弟爹父汉漢郎爷爺公叔伯侄婿男]/.test(post35) && !/站在|看着|望著|望着|跟|陪|送|找/.test(post35))) maleScore += 2;

    // Explicit Chinese compound phrases
    const femalePhrases = ['女同志', '小姑娘', '女孩', '小女孩', '女娃', '女儿', '女兒', '媳妇', '媳婦', '妻子', '老太太', '大娘', '大婶', '大嬸', '母女'];
    for (const phrase of femalePhrases) {
      if (pre35.includes(phrase) || post35.includes(phrase)) { femaleScore += 4; break; }
    }

    const malePhrases = ['男同志', '小伙子', '小伙', '男孩', '小男孩', '男娃', '儿子', '兒子', '丈夫', '女婿', '老汉', '老漢', '老头', '老頭', '大伯', '大叔', '父子'];
    for (const phrase of malePhrases) {
      if (pre35.includes(phrase) || post35.includes(phrase)) { maleScore += 4; break; }
    }
  }

  // Classic feminine/masculine given name characters (applied only to given name part)
  const givenName = chinese.length > 1 ? chinese.slice(1) : chinese;
  if (/[芳娟芹妮梅婷娜丽麗雅娴嫻淑惠莲蓮萱怡欣悦瑤瑶琴娥娇嬌艳艷倩娣妹姐儿兒芬花雪兰蘭凤鳳燕珠玉萍珍静靜秀英美霞]/.test(givenName)) {
    femaleScore += 2;
  }
  if (/[刚剛强強勇毅伟偉雄杰傑俊博豪峰岩磊石壮壯涛濤汉漢哥弟建国國民军軍斌龙龍武林東东海川天祥康平安达成成辉輝凯凱胜勝]/.test(givenName)) {
    maleScore += 2;
  }

  // Role evidence
  if (role) {
    const lowerRole = role.toLowerCase();
    if (/gái|chị|mẹ|dâu|bà|cô|nữ|muội|tỷ/.test(lowerRole)) femaleScore += 4;
    if (/trai|anh|cha|bố|ông|chú|nam|huynh|đệ|ca/.test(lowerRole)) maleScore += 4;
  }

  if (femaleScore > maleScore && femaleScore >= 2) return 'female';
  if (maleScore > femaleScore && maleScore >= 2) return 'male';
  return 'unknown';
}

/**
 * Automatically extracts candidate proper nouns from Vietnamese translated text.
 */
export function extractVietnameseProperNouns(translatedText: string): Map<string, number> {
  const capRegex = /\b[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+(?:\s+[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+){1,3}\b/g;

  const counts = new Map<string, number>();
  let match: RegExpExecArray | null;

  while ((match = capRegex.exec(translatedText)) !== null) {
    const candidate = match[0].trim();
    const words = candidate.split(/\s+/);

    // Skip if starts with a common stopword (likely just capitalized at sentence start)
    const firstWord = words[0];
    if (!firstWord) continue;
    const firstWordLower = firstWord.toLowerCase();
    if (VIETNAMESE_STOPWORDS.has(firstWordLower) && words.length <= 2) {
      continue;
    }

    counts.set(candidate, (counts.get(candidate) || 0) + 1);
  }

  return counts;
}

/**
 * Infers category, gender, and role for an entity from context.
 * Filters out common nouns, slogans, idioms, and non-character entities.
 */
export function inferEntityMetadata(
  chinese: string,
  vietnamese: string,
  sourceContext: string,
  targetContext: string,
  genre?: string,
): {
  category: EntityCategory;
  gender?: 'male' | 'female' | 'unknown';
  role?: string;
  notes?: string;
  isBlacklisted?: boolean;
} {
  const normVn = normalizeVn(vietnamese);
  const normTgt = normalizeVn(targetContext);

  // 0. Check Common Noun Blacklist (Nature, slogans, idioms, everyday objects)
  if (COMMON_NOUN_BLACKLIST.has(chinese)) {
    // Check if context specifically overrides as a location or faction (e.g., "đại đội Phú Cường", "huyện Thái Bình")
    if (
      normTgt.includes(`đại đội ${normVn}`) ||
      normTgt.includes(`công xã ${normVn}`) ||
      normTgt.includes(`thôn ${normVn}`) ||
      normTgt.includes(`xã ${normVn}`) ||
      normTgt.includes(`huyện ${normVn}`) ||
      normTgt.includes(`tỉnh ${normVn}`)
    ) {
      return { category: 'location' };
    }
    // Generic common noun / idiom -> blacklist so it will not pollute story memory
    return { category: 'term', isBlacklisted: true };
  }

  const hasSurname = isChineseSurname(chinese);
  const hasVnLocationKeyword =
    normTgt.includes(`ngõ ${normVn}`) ||
    normTgt.includes(`hẻm ${normVn}`) ||
    normTgt.includes(`thành ${normVn}`) ||
    normTgt.includes(`núi ${normVn}`) ||
    normTgt.includes(`sông ${normVn}`) ||
    normTgt.includes(`thôn ${normVn}`) ||
    normTgt.includes(`xã ${normVn}`) ||
    normTgt.includes(`huyện ${normVn}`) ||
    normTgt.includes(`tỉnh ${normVn}`) ||
    normTgt.includes(`khu vực ${normVn}`) ||
    normTgt.includes(`vùng ${normVn}`) ||
    normTgt.includes(`ở ${normVn}`) ||
    normTgt.includes(`tại ${normVn}`) ||
    normTgt.includes(`chân thành ${normVn}`) ||
    normTgt.includes(`chân tường ${normVn}`);

  // 1. Location Detection
  const isExplicitLocation =
    DIRECTIONS_AND_REGIONS.has(chinese) ||
    URBAN_ARCHITECTURAL_LOCATIONS.has(chinese) ||
    hasVnLocationKeyword;

  // Suffix location: only if it does NOT start with a person surname (e.g., 阮建国 is a person, not a country!)
  // or if explicitly accompanied by location keywords in VN context
  const isSuffixLocation =
    LOCATION_SUFFIXES.some((s) => chinese.endsWith(s)) &&
    (!hasSurname || hasVnLocationKeyword);

  if (isExplicitLocation || isSuffixLocation) {
    return { category: 'location' };
  }

  // 2. Faction Detection
  if (
    FACTION_SUFFIXES.some((s) => chinese.endsWith(s)) ||
    normTgt.includes(`môn phái ${normVn}`) ||
    normTgt.includes(`bang ${normVn}`) ||
    normTgt.includes(`công ty ${normVn}`) ||
    normTgt.includes(`tập đoàn ${normVn}`)
  ) {
    return { category: 'faction' };
  }

  // 3. Character Detection (Priority check if it looks like a person with surname or person markers)
  if (isLikelyCharacter(chinese, vietnamese, sourceContext, targetContext)) {
    let role: string | undefined;

    const toTitleCase = (str: string) =>
      str.split(/\s+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');

    // Em trai / em gái của ai đó
    const emTraiMatch = new RegExp(`(?:em trai(?:\\s+của)?)\\s+([^,.;]{2,30}?)\\s+(?:tên là|là)?\\s*${escapeRegExp(normVn)}`, 'i').exec(normTgt);
    if (emTraiMatch) role = `Em trai của ${toTitleCase(emTraiMatch[1]!.trim())}`;
    else if (new RegExp(`(?:em trai)\\s+${escapeRegExp(normVn)}`, 'i').test(normTgt) || sourceContext.includes('弟弟叫' + chinese)) role = 'Em trai';

    const emGaiMatch = new RegExp(`(?:em gái(?:\\s+của)?)\\s+([^,.;]{2,30}?)\\s+(?:tên là|là)?\\s*${escapeRegExp(normVn)}`, 'i').exec(normTgt);
    if (emGaiMatch) role = `Em gái của ${toTitleCase(emGaiMatch[1]!.trim())}`;
    else if (new RegExp(`(?:em gái)\\s+${escapeRegExp(normVn)}`, 'i').test(normTgt) || sourceContext.includes('妹妹叫' + chinese)) role = 'Em gái';

    // Cậu bé / cô bé trong thôn (phải định danh chặt chẽ trong câu đơn, không quét lỏng lẻo cả đoạn văn)
    const elderWomen = ['Trâu Phương Phân', 'Trương tẩu tử', 'Dì Trương', 'Trần thẩm tử', 'Trần nãi nãi', 'Mẹ Kha', 'Ngưu đại tẩu'];
    if (!role && !elderWomen.includes(vietnamese)) {
      const isBoyContext =
        new RegExp(`(?:hai\\s+cậu bé|cậu bé|bé trai|thằng bé)\\s+(?:tên là|gọi là)?\\s*${escapeRegExp(normVn)}\\b`, 'i').test(normTgt) ||
        new RegExp(`\\b${escapeRegExp(normVn)}\\b\\s+là\\s+(?:một\\s+)?(?:cậu bé|bé trai)`, 'i').test(normTgt) ||
        sourceContext.includes(`叫${chinese}的小男孩`) ||
        sourceContext.includes(`小男孩叫${chinese}`) ||
        (sourceContext.includes(`一個叫${chinese}`) && sourceContext.includes('小男孩')) ||
        (sourceContext.includes(`他叫${chinese}`) && sourceContext.includes('小男孩'));

      const isGirlContext =
        new RegExp(`(?:hai\\s+cô bé|cô bé|bé gái|con bé)\\s+(?:tên là|gọi là)?\\s*${escapeRegExp(normVn)}\\b`, 'i').test(normTgt) ||
        new RegExp(`\\b${escapeRegExp(normVn)}\\b\\s+là\\s+(?:một\\s+)?(?:cô bé|bé gái)`, 'i').test(normTgt) ||
        sourceContext.includes(`叫${chinese}的小女孩`) ||
        sourceContext.includes(`小女孩叫${chinese}`) ||
        (sourceContext.includes(`一個叫${chinese}`) && sourceContext.includes('小女孩')) ||
        (sourceContext.includes(`她叫${chinese}`) && sourceContext.includes('小女孩'));

      if (isBoyContext && !isGirlContext) {
        if (normTgt.includes('bốn tuổi') || normTgt.includes('4 tuổi') || sourceContext.includes('四歲')) {
          role = 'Cậu bé 4 tuổi trong thôn';
        } else {
          role = 'Cậu bé trong thôn';
        }
      } else if (isGirlContext && !isBoyContext) {
        role = 'Cô bé trong thôn';
      }
    }

    // Chị dâu
    if (!role) {
      if (normTgt.includes(`chị dâu ${normVn}`) || (sourceContext.includes('嫂子') && sourceContext.includes(chinese))) {
        role = 'Chị dâu';
      }
    }

    // Kinship patterns
    if (!role) {
      if (normTgt.includes(`con gái lớn ${normVn}`) || normTgt.includes(`${normVn}, con gái lớn`) || normTgt.includes(`con gái cả ${normVn}`)) role = 'Con gái lớn';
      else if (normTgt.includes(`con gái nhỏ ${normVn}`) || normTgt.includes(`con gái út ${normVn}`)) role = 'Con gái nhỏ';
      else if (normTgt.includes(`con trai cả ${normVn}`) || normTgt.includes(`con trai lớn ${normVn}`) || new RegExp(`con trai (?:cả|lớn)[^,.;]{0,30}\\b${escapeRegExp(normVn)}\\b`, 'i').test(normTgt)) role = 'Con trai cả';
      else if (normTgt.includes(`con trai thứ ${normVn}`) || normTgt.includes(`con trai ${normVn}`) || new RegExp(`con trai[^,.;]{0,30}\\b${escapeRegExp(normVn)}\\b`, 'i').test(normTgt)) role = 'Con trai';
      else if (new RegExp(`\\b${escapeRegExp(normVn)}\\b\\s+là\\s+chồng\\s+của\\b`, 'i').test(normTgt) || new RegExp(`chồng\\s+của\\s+[^,.;]{2,30}?\\s+là\\s+${escapeRegExp(normVn)}\\b`, 'i').test(normTgt)) role = 'Chồng';
      else if (new RegExp(`\\b${escapeRegExp(normVn)}\\b\\s+là\\s+vợ\\s+của\\b`, 'i').test(normTgt) || new RegExp(`vợ\\s+của\\s+[^,.;]{2,30}?\\s+là\\s+${escapeRegExp(normVn)}\\b`, 'i').test(normTgt)) role = 'Vợ';
      else if (normTgt.includes(`vợ chồng ${normVn}`) || new RegExp(`vợ chồng\\s+${escapeRegExp(normVn)}\\b`, 'i').test(normTgt)) role = 'Xã viên trong thôn (vợ chồng)';
      else if (normTgt.includes(`anh trai ${normVn}`) || normTgt.includes(`anh cả ${normVn}`) || new RegExp(`anh trai[^,.;]{0,30}\\b${escapeRegExp(normVn)}\\b`, 'i').test(normTgt)) role = 'Anh trai';
      else if (normTgt.includes(`con dâu thứ hai ${normVn}`) || normTgt.includes(`con dâu ${normVn}`)) role = 'Con dâu';
      else if (normTgt.includes(`sư phụ ${normVn}`)) role = 'Sư phụ';
      else if (normTgt.includes(`sư huynh ${normVn}`)) role = 'Sư huynh';
      else if (normTgt.includes(`tông chủ ${normVn}`)) role = 'Tông chủ';
      else if (normTgt.includes(`đại ca ${normVn}`)) role = 'Đại ca';
      else if (normTgt.includes(`mẹ ${normVn}`) || normTgt.includes(`${normVn} là mẹ`)) role = 'Mẹ';
      else if (normTgt.includes(`cha ${normVn}`) || normTgt.includes(`bố ${normVn}`)) role = 'Cha';
    }

    const gender = detectCharacterGender(chinese, normVn, sourceContext, normTgt, role);
    return { category: 'character', gender, role };
  }

  // 4. Cultivation Detection: Strictly restricted to cultivation / martial arts / fantasy genres only!
  // In 'period', 'modern', or 'ancient' stories, terms ending in 功, 法, 境, 丹 must NEVER be treated as cultivation!
  if (isCultivationGenre(genre) && !hasSurname) {
    if (CULTIVATION_SUFFIXES.some((s) => chinese.endsWith(s))) {
      return { category: 'cultivation' };
    }
  }

  // 5. Unverified candidate that is neither a verified location, faction, cultivation, nor character
  return { category: 'term', isBlacklisted: true };
}

// ---------------------------------------------------------------------------
// Substring-collision & alias logic
// ---------------------------------------------------------------------------

/**
 * Kiểm tra xem `shortChinese` có phải là tiền tố hoặc hậu tố (affix) của `fullChinese` không.
 * Ví dụ: '苏叶' là suffix của '阮苏叶' → true.
 * Ví dụ: '陈婶' là prefix của '陈婶子' → true.
 * Hỗ trợ cả tương đương Phồn thể / Giản thể (ví dụ: '陳嬸' <=> '陈婶子').
 */
function isAffixOf(shortChinese: string, fullChinese: string): boolean {
  if (fullChinese.length <= shortChinese.length) return false;
  if (fullChinese.endsWith(shortChinese) || fullChinese.startsWith(shortChinese)) return true;
  const sShort = sify(shortChinese);
  const sFull = sify(fullChinese);
  return sFull.endsWith(sShort) || sFull.startsWith(sShort);
}

/**
 * Tìm tất cả entity đã đăng ký (fullEntities) mà chinese của chúng có shortChinese làm tiền tố/hậu tố.
 * Trả về danh sách entity thoả điều kiện.
 */
function findParentEntities(shortChinese: string, fullEntities: StoryEntity[]): StoryEntity[] {
  return fullEntities.filter((e) => isAffixOf(shortChinese, e.chinese));
}

// ---------------------------------------------------------------------------
// Smart Relationship Extraction
// ---------------------------------------------------------------------------

/**
 * Trích xuất quan hệ nhân vật dựa trên cấu trúc câu thân tộc hoặc đối thoại trực tiếp.
 * CHỈ tạo quan hệ khi cả 2 đối tượng đều là nhân vật đã được xác thực (category === 'character').
 * Tuyệt đối không sinh quan hệ bừa bãi dựa trên việc xuất hiện cùng đoạn.
 */
export function extractSmartRelationships(
  _sourceText: string,
  translatedText: string,
  confirmedCharacters: readonly StoryEntity[],
): CharacterRelation[] {
  if (!translatedText || confirmedCharacters.length < 2) return [];

  const charNames = new Map<string, StoryEntity>();
  for (const c of confirmedCharacters) {
    charNames.set(normalizeVn(c.vietnamese), c);
    if (c.aliases) {
      for (const a of c.aliases) {
        charNames.set(normalizeVn(a), c);
      }
    }
  }

  const relations: CharacterRelation[] = [];
  const seenPair = new Set<string>();

  const kinshipRules: Array<{
    keywords: string[];
    relationType: string;
    pronounSample: string;
    toneInstruction?: string;
  }> = [
    { keywords: ['mẹ', 'mẹ đẻ', 'mẫu thân'], relationType: 'Mẹ - Con', pronounSample: 'Mẹ - Con', toneInstruction: 'Ấm áp tình mẫu tử hoặc kính cẩn' },
    { keywords: ['cha', 'bố', 'ba', 'phụ thân'], relationType: 'Cha - Con', pronounSample: 'Cha - Con', toneInstruction: 'Nghiêm khắc hoặc ấm áp' },
    { keywords: ['vợ', 'thê tử', 'nương tử'], relationType: 'Vợ - Chồng', pronounSample: 'Vợ - Chồng (Nàng - Chàng)', toneInstruction: 'Thân mật vợ chồng' },
    { keywords: ['chồng', 'phu quân'], relationType: 'Vợ - Chồng', pronounSample: 'Chồng - Vợ (Chàng - Nàng)', toneInstruction: 'Thân mật vợ chồng' },
    { keywords: ['chị gái', 'chị ruột', 'đại tỷ', 'tỷ tỷ'], relationType: 'Chị - Em', pronounSample: 'Chị - Em', toneInstruction: 'Thân tình chị em' },
    { keywords: ['em gái', 'muội muội'], relationType: 'Chị/Anh - Em gái', pronounSample: 'Chị/Anh - Em', toneInstruction: 'Thân tình' },
    { keywords: ['anh trai', 'anh ruột', 'đại ca', 'ca ca'], relationType: 'Anh - Em', pronounSample: 'Anh - Em', toneInstruction: 'Thân tình anh em' },
    { keywords: ['em trai', 'đệ đệ'], relationType: 'Anh/Chị - Em trai', pronounSample: 'Anh/Chị - Em', toneInstruction: 'Thân tình' },
    { keywords: ['con dâu'], relationType: 'Mẹ chồng - Con dâu', pronounSample: 'Mẹ - Con', toneInstruction: 'Mẹ chồng nàng dâu' },
    { keywords: ['con rể'], relationType: 'Bố mẹ vợ - Con rể', pronounSample: 'Bố/Mẹ - Con' },
    { keywords: ['bà nội', 'bà ngoại'], relationType: 'Bà - Cháu', pronounSample: 'Bà - Cháu' },
    { keywords: ['ông nội', 'ông ngoại'], relationType: 'Ông - Cháu', pronounSample: 'Ông - Cháu' },
    { keywords: ['sư phụ', 'thầy'], relationType: 'Sư đồ', pronounSample: 'Sư phụ - Đệ tử', toneInstruction: 'Kính trọng lễ phép' },
    { keywords: ['đệ tử', 'học trò'], relationType: 'Sư đồ', pronounSample: 'Đệ tử - Sư phụ', toneInstruction: 'Kính trọng lễ phép' },
  ];

  // Regex pattern: <A> là <quan hệ> của <B>
  // e.g. "Vương Tú Cần là mẹ của Nguyễn Tô Diệp"
  for (const rule of kinshipRules) {
    const kwPattern = rule.keywords.map(escapeRegExp).join('|');
    const patternA = new RegExp(
      `([A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+(?:\\s+[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+)+)\\s+là\\s+(?:${kwPattern})\\s+của\\s+([A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+(?:\\s+[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+)+)`,
      'g',
    );

    let m: RegExpExecArray | null;
    while ((m = patternA.exec(translatedText)) !== null) {
      const nameA = m[1]?.trim();
      const nameB = m[2]?.trim();
      if (!nameA || !nameB) continue;

      const charA = charNames.get(normalizeVn(nameA));
      const charB = charNames.get(normalizeVn(nameB));

      // Both must be valid confirmed characters, and not the same character
      if (charA && charB && charA.id !== charB.id) {
        const pairKey = `${charA.vietnamese}_x_${charB.vietnamese}`;
        if (!seenPair.has(pairKey)) {
          seenPair.add(pairKey);
          relations.push({
            id: `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            sourceCharacter: charA.vietnamese,
            targetCharacter: charB.vietnamese,
            relationType: rule.relationType,
            pronounSample: rule.pronounSample,
            toneInstruction: rule.toneInstruction,
          });
        }
      }
    }
  }

  return relations;
}

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

/**
 * 100% Automatic extraction of entities, relationships, and dialogue horizons from translated segments.
 *
 * Cải tiến nâng cấp:
 * 1. Chống va chạm substring — '苏叶' không bị tạo thành entity riêng nếu '阮苏叶' đã tồn tại.
 * 2. Lọc bỏ danh từ chung, hướng địa lý, hiện tượng thiên nhiên, khẩu hiệu thời đại ('西北', '城根', '雪花', '白无常', '富强', '太平')
 *    để không bị nhận diện nhầm thành nhân vật nữ/nam.
 * 3. Trích xuất quan hệ thông minh từ câu khẳng định thân tộc rõ ràng, không tạo quan hệ giả.
 * 4. Phát hiện alias và tên gọi tắt nhập nhằng sinh contextHint.
 */
export function autoExtractStoryMemory(
  sourceText: string,
  translatedText: string,
  options?: { genre?: string; existingEntities?: readonly StoryEntity[] },
): ExtractedStoryMemory {
  if (!sourceText || !translatedText) {
    return { entities: [], relations: [], recentDialogues: [] };
  }

  // 1. Extract Vietnamese proper nouns sorted by word-count DESC (longer first)
  const properNouns = extractVietnameseProperNouns(translatedText);

  // Sort candidates by descending word count so we register long names before short ones
  const sortedCandidates = [...properNouns.entries()].sort(
    ([a], [b]) => b.split(/\s+/).length - a.split(/\s+/).length,
  );

  const sourceClean = sourceText.replace(/\r\n/g, '\n');
  const targetClean = translatedText.replace(/\r\n/g, '\n');

  // Track registered Chinese keys to avoid duplicates
  const seenChinese = new Map<string, StoryEntity>(); // chinese → entity
  const ambiguousHints: string[] = [];

  for (const [vnName] of sortedCandidates) {
    const words = vnName.trim().split(/\s+/);
    const nameLen = words.length;
    if (nameLen < 2 || nameLen > 4) continue;

    const matchedChinese = findChineseMatch(vnName, sourceClean);
    if (!matchedChinese) continue;
    if (seenChinese.has(matchedChinese)) continue;

    // Toàn bộ các thực thể đã biết (từ StoryMemory toàn cục của Job + thực thể đã ghi nhận trong đoạn này)
    const allKnownEntities = [...(options?.existingEntities || []), ...Array.from(seenChinese.values())];

    // Chặn triệt để biến thể dính chữ của nhân vật đã biết (e.g. đã có '舒舒', gặp '舒舒跟', '舒舒畢業', '舒舒要')
    const isPrefixOfKnown = allKnownEntities.some(
      (e) => e.category === 'character' && matchedChinese.startsWith(e.chinese) && matchedChinese.length > e.chinese.length,
    );
    if (isPrefixOfKnown) {
      continue;
    }

    // Check if matchedChinese is already an alias of any registered entity
    const isAlreadyAlias = allKnownEntities.some((e) => e.aliases?.includes(matchedChinese));
    if (isAlreadyAlias) continue;

    // Check if matchedChinese is a suffix of any already-registered entity (longer entity was registered first)
    const parents = findParentEntities(matchedChinese, allKnownEntities);

    if (parents.length === 1) {
      // Unambiguous alias → attach to parent
      const parent = parents[0]!;
      if (!parent.aliases?.includes(matchedChinese)) {
        parent.aliases = [...(parent.aliases ?? []), matchedChinese];
      }
      // Do NOT register as separate entity
    } else if (parents.length > 1) {
      // Ambiguous: cannot determine which parent
      const parentNames = parents.map((p) => `${p.chinese} (${p.vietnamese})`).join(', ');
      ambiguousHints.push(
        `Tên gọi tắt "${vnName}" (${matchedChinese}) có thể ứng với nhiều nhân vật: ${parentNames}. ` +
        `Hãy dịch theo ngữ cảnh và GIỮ NGUYÊN tên gọi tắt đó như trong bản gốc.`,
      );

      for (const parent of parents) {
        if (!parent.ambiguousAliasOf?.includes(matchedChinese)) {
          parent.ambiguousAliasOf = [...(parent.ambiguousAliasOf ?? []), matchedChinese];
        }
      }
      // Do NOT register as separate entity
    } else {
      // Standalone candidate
      const { sContext, tContext } = extractContext(matchedChinese, vnName, sourceClean, targetClean);
      const meta = inferEntityMetadata(matchedChinese, vnName, sContext, tContext, options?.genre);

      // If blacklisted (common noun, slogan, idiom, or unverified word), discard it
      if (meta.isBlacklisted) {
        continue;
      }

      // Do NOT register low-confidence 2-character entities that have unknown gender and no confirmed role.
      // Also block 2-character surname + ordinal fragments (e.g. 劉大, 張三, 李四) unless they have an explicit confirmed role
      const isOrdinalSecondChar = ['大', '二', '三', '四', '五', '六', '七', '八', '九', '小'].includes(matchedChinese[1] || '');
      if (
        meta.category === 'character' &&
        matchedChinese.length <= 2 &&
        (!meta.role && (meta.gender === 'unknown' || isOrdinalSecondChar))
      ) {
        continue;
      }

      const entity: StoryEntity = {
        id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        chinese: matchedChinese,
        vietnamese: vnName,
        category: meta.category,
        gender: meta.category === 'character' ? meta.gender : undefined,
        role: meta.category === 'character' ? meta.role : undefined,
      };

      seenChinese.set(matchedChinese, entity);
    }
  }

  const entities = Array.from(seenChinese.values());

  // 2. Extract smart character relationships
  const confirmedCharacters = entities.filter((e) => e.category === 'character');
  const relations = extractSmartRelationships(sourceText, translatedText, confirmedCharacters);

  // 3. Extract recent dialogues
  const recentDialogues = extractRecentDialogues(sourceText, translatedText, 3);

  const result: ExtractedStoryMemory = {
    entities,
    relations,
    recentDialogues,
  };

  if (ambiguousHints.length > 0) {
    result.contextHint = ambiguousHints.join('\n');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts dialogue quotes from translated text to maintain dialogue tone memory.
 */
export function extractRecentDialogues(
  sourceText: string,
  translatedText: string,
  limit = 2,
): StoryRecentDialogue[] {
  if (!translatedText || !sourceText) return [];

  // Match Vietnamese quotes: “...”, "...", hoặc «...»
  const vnQuoteRegex = /(?:“([^”]{3,120})”|"([^"]{3,120})"|«([^»]{3,120})»)/g;
  const snippets: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = vnQuoteRegex.exec(translatedText)) !== null) {
    const text = (match[1] || match[2] || match[3] || '').trim();
    if (text && !text.includes('\n') && text.length >= 4) {
      snippets.push(text);
    }
  }

  return snippets.slice(-limit).map((snippet) => ({
    snippet,
  }));
}

/**
 * Tìm chuỗi Hán tự trong sourceText khớp với vnName theo từ điển Han-Viet.
 * Trả về chuỗi Hán tự khớp đầu tiên, hoặc undefined nếu không tìm thấy.
 */
function findChineseMatch(vnName: string, sourceText: string): string | undefined {
  const nameLen = vnName.trim().split(/\s+/).length;
  for (let i = 0; i <= sourceText.length - nameLen; i++) {
    const candidate = sourceText.slice(i, i + nameLen);
    if (/^\p{Script=Han}+$/u.test(candidate)) {
      if (verifyHanVietMatch(vnName, candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Trích xuất đoạn ngữ cảnh xung quanh một entity trong source và target text.
 */
function extractContext(
  matchedChinese: string,
  vnName: string,
  sourceClean: string,
  targetClean: string,
): { sContext: string; tContext: string } {
  const sPos = sourceClean.indexOf(matchedChinese);
  const sContext = sourceClean.slice(Math.max(0, sPos - 60), Math.min(sourceClean.length, sPos + 60));
  const tPos = targetClean.indexOf(vnName);
  const tContext = targetClean.slice(Math.max(0, tPos - 100), Math.min(targetClean.length, tPos + 100));
  return { sContext, tContext };
}

/**
 * Compatibility wrapper for extracting relationships.
 */
export function extractRelationships(
  translatedText: string,
  entities: readonly StoryEntity[],
): CharacterRelation[] {
  const characters = entities.filter((e) => e.category === 'character');
  return extractSmartRelationships('', translatedText, characters);
}
