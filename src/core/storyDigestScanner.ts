import {
  CHINESE_COMPOUND_SURNAMES,
  CHINESE_SURNAMES,
  COMMON_NOUN_BLACKLIST,
  DIRECTIONS_AND_REGIONS,
  URBAN_ARCHITECTURAL_LOCATIONS,
  transcribeHanViet,
} from './storyMemoryExtractor';
import type { CharacterRelation, StoryEntity } from '../shared/types';

export interface ScannedEntityCandidate {
  chinese: string;
  vietnamese: string;
  occurrences: number;
  chapterIndices: number[];
  firstChapterIndex: number;
}

export interface CharacterHarvestProfile {
  chinese: string;
  vietnamese: string;
  occurrences: number;
  firstChapterIndex: number;
  firstAppearanceSnippet: string;
  kinshipSnippets: string[];
  dialogueSnippets: string[];
}

export interface LocationHarvestProfile {
  chinese: string;
  vietnamese: string;
  occurrences: number;
  firstChapterIndex: number;
  firstAppearanceSnippet: string;
}

export interface ParsedStoryDigest {
  characters: StoryEntity[];
  relationships: CharacterRelation[];
  locations: StoryEntity[];
}

// Common Chinese words that start with surname characters or honorifics but are common words, not names
const CHINESE_COMMON_WORD_BLACKLIST = new Set([
  '如果', '突然', '因為', '他們', '她們', '我們', '自己', '雖然', '這個', '那個',
  '什麼', '怎麼', '已經', '開始', '現在', '時候', '看到', '聽到', '知道', '覺得',
  '沒有', '不是', '就是', '只是', '但是', '而且', '然後', '最後', '一邊', '一直',
  '一起', '一下', '一會', '一點', '今天', '明天', '昨天', '剛才', '過去', '出來',
  '進去', '起來', '過來', '回去', '回來', '地方', '東西', '事情', '問題', '辦法',
  '模樣', '聲音', '眼神', '臉色', '腳步', '房間', '門口', '窗戶', '桌子', '椅子',
  '床邊', '廚房', '院子', '門外', '屋裏', '裏面', '外面', '上門', '下來', '上去',
  '大家', '有人', '誰也', '那麼', '這麼', '這樣', '那樣', '有些', '那些', '這些',
  '很多', '不少', '一點', '一些', '一下', '一眼', '一口', '一身', '一聲', '一臉',
  '心裏', '手中', '眼前', '身邊', '身後', '頭上', '臉上', '地上', '半天', '半晌',
  '高高', '慢慢', '常常', '早早', '天天', '多多', '好好', '看看', '走走', '大大',
  '老天', '老家', '老人', '老漢', '老婦', '老爺', '老媽', '老婆', '老鄉', '老頭',
  '小聲', '小心', '小臉', '小手', '小孩', '小夥', '姑娘', '同誌', '同志', '領導',
  '隊長', '大隊', '書記', '主任', '經理', '幹事', '軍官', '營長', '連長', '團長',
  '時間', '时间', '家屬', '家属', '家屬院', '家属院', '都是', '都不', '都沒', '都没', '都很',
  '家裏', '家里', '家的', '家人', '家都', '那就', '那邊', '那边', '那些人', '明白', '能夠', '能够',
  '關系', '关系', '關係', '麻煩', '麻烦', '居然', '安排', '謝謝', '谢谢', '任務', '任务', '相信',
  '高興', '高兴', '能力', '容易', '段時間', '段时间', '和江望', '白了', '空間', '空间', '解釋',
  '解释', '錢票', '钱票', '水果', '方面', '解決', '解决', '明顯', '明显', '安全', '那麽',
  '那我', '那種', '都有', '都沒有', '家屬們', '蔬菜', '季蔬菜', '文工團', '文工团', '武器',
  '方便', '成功', '辛苦', '相互', '公安', '松了口', '松了口气', '任何', '畢竟', '毕竟',
  '全村', '房子', '小學', '小学', '宿舍', '都會', '都会', '舒的小', '房間', '房间', '門口', '门口',
  '小道', '小路', '小院', '大院', '院子', '學校', '学校', '課堂', '课堂', '食堂', '大堂', '禮堂', '礼堂',
  '大門', '大门', '正門', '正门', '後門', '后门', '木屋', '磚房', '砖房', '草屋', '茅屋', '屋子', '瓦房',
  '廚房', '厨房', '床頭', '床头', '門外', '门外', '屋裏', '屋里', '裏面', '里面', '外面', '大隊部', '大队部',
]);

const NON_PERSON_SUFFIXES = new Set([
  '房', '屋', '舍', '院', '校', '堂', '館', '馆', '所', '局', '廠', '厂', '店',
  '村', '鎮', '镇', '市', '縣', '县', '路', '街', '巷', '門', '门', '車', '车',
]);

const INVALID_NAME_ENDINGS = new Set([
  '的', '了', '著', '着', '不', '也', '就', '一', '和', '沒', '没', '很', '看', '還', '还',
  '說', '说', '道', '問', '问', '想', '去', '來', '来', '到', '在', '把', '被', '讓', '让', '給', '给',
  '裏', '里', '是', '邊', '边', '人', '都', '些', '上', '下', '中', '前', '後', '后', '內', '内', '外',
  '笑', '哭', '喊', '叫', '帶', '带', '拿', '抓', '跑', '跳', '走', '坐', '站', '拉', '推',
  '這', '这', '那', '心', '有', '點', '点', '覺', '觉', '對', '对', '能', '吃', '喝', '聽', '听', '望',
]);

const TITLE_SUFFIXES = [
  '組長', '组长', '院長', '院长', '團長', '团长', '主任', '隊長', '队长',
  '書記', '书记', '經理', '经理', '幹事', '干事', '同誌', '同志', '領導', '领导',
  '老師', '老师', '師傅', '师傅', '大夫', '營長', '营长', '連長', '连长', '排長', '排长',
  '指導', '指导', '阿姨', '伯伯', '副營', '副营', '副團', '副团', '副連', '副连', '副排',
  '副局', '副處', '副处', '副隊', '副队', '科長', '科长', '處長', '处长', '局長', '局长',
];

const TITLE_CHARACTERS = new Set([
  '組', '组', '主', '院', '團', '团', '時', '时', '家', '長', '长', '員', '员',
  '者', '部', '所', '局', '處', '处', '同', '姐', '哥', '叔', '伯', '妹', '弟',
  '爺', '爷', '奶', '娘', '爹', '嫂', '師', '师', '導', '导', '官', '總', '总',
  '委', '記', '记'
]);

const KINSHIP_REGEX = /(母親|媽媽|父親|爸爸|妻子|媳婦|丈夫|老公|哥哥|弟弟|姐姐|妹妹|嫂子|大哥|大嫂|女兒|兒子|婆婆|公公|兩口子|弟妹|表哥|表姐|堂哥|堂姐|伯父|伯母|叔叔|嬸嬸|岳父|岳母|姑姑|舅舅|女婿|兒媳)/;

/**
 * Splits text into sentences while strictly preserving quoted dialogue blocks intact.
 */
export function splitSentences(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  let inQuote = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === '“' || ch === '「' || ch === '『') {
      inQuote = true;
    } else if (ch === '”' || ch === '」' || ch === '』') {
      inQuote = false;
    } else if (!inQuote && (ch === '。' || ch === '！' || ch === '？' || ch === '\n')) {
      const s = text.slice(start, i + 1).trim();
      if (s) result.push(s);
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) result.push(last);
  return result;
}

/**
 * Scans a book's chapters and discovers potential character name candidates with high occurrence.
 */
export function scanBookForEntities(
  chapters: Array<{ index: number; sourceText: string }>,
  options?: { minOccurrences?: number; maxCandidates?: number },
): ScannedEntityCandidate[] {
  const minOccurrences = options?.minOccurrences ?? 2;
  const maxCandidates = options?.maxCandidates ?? 50;

  const candidateOccurrences = new Map<string, { count: number; chapters: Set<number>; firstIdx: number }>();

  chapters.forEach((ch, chIdx) => {
    const text = ch.sourceText;
    if (!text) return;

    const len = text.length;
    let i = 0;
    while (i < len) {
      const ch1 = text[i];
      if (!ch1) {
        i++;
        continue;
      }

      // Check compound surname (length 2)
      let matchedSurnameLen = 0;
      if (i + 1 < len) {
        const twoChar = text.slice(i, i + 2);
        if (CHINESE_COMPOUND_SURNAMES.includes(twoChar)) {
          matchedSurnameLen = 2;
        }
      }

      // Check single surname or honorific prefix ('老', '小', '阿')
      if (matchedSurnameLen === 0 && (CHINESE_SURNAMES.has(ch1) || ch1 === '老' || ch1 === '小' || ch1 === '阿')) {
        matchedSurnameLen = 1;
      }

      if (matchedSurnameLen > 0) {
        // Try candidate lengths: 2 or 3 characters (or 4 for compound surnames)
        const minLen = matchedSurnameLen + 1;
        const maxLen = Math.min(matchedSurnameLen === 2 ? 4 : 3, len - i);

        for (let nameLen = minLen; nameLen <= maxLen; nameLen++) {
          const candidate = text.slice(i, i + nameLen);
          const firstChar = candidate[0]!;
          if (['和', '跟', '同', '與', '与', '及'].includes(firstChar)) continue;
          const lastChar = candidate[candidate.length - 1]!;
          if (INVALID_NAME_ENDINGS.has(lastChar)) continue;
          if (NON_PERSON_SUFFIXES.has(lastChar)) continue;
          if (candidate.length > 2 && (candidate.slice(1, -1).includes('的') || candidate.slice(1, -1).includes('了') || candidate.slice(1, -1).includes('著') || candidate.slice(1, -1).includes('着'))) continue;
          if (TITLE_SUFFIXES.some((t) => candidate.endsWith(t))) continue;
          if (candidate.length === 2 && TITLE_CHARACTERS.has(lastChar)) continue;
          if (candidate.endsWith('們') || candidate.endsWith('们')) continue;
          if (
            /^[\u4e00-\u9fa5]+$/.test(candidate) &&
            !CHINESE_COMMON_WORD_BLACKLIST.has(candidate) &&
            !COMMON_NOUN_BLACKLIST.has(candidate) &&
            !URBAN_ARCHITECTURAL_LOCATIONS.has(candidate) &&
            !DIRECTIONS_AND_REGIONS.has(candidate)
          ) {
            const vn = transcribeHanViet(candidate);
            if (vn) {
              const current = candidateOccurrences.get(candidate) ?? {
                count: 0,
                chapters: new Set<number>(),
                firstIdx: chIdx,
              };
              current.count++;
              current.chapters.add(chIdx);
              candidateOccurrences.set(candidate, current);
            }
          }
        }
      }
      i++;
    }
  });

  // Filter candidates by minOccurrences
  const results: ScannedEntityCandidate[] = [];
  for (const [chinese, meta] of candidateOccurrences.entries()) {
    if (meta.count < minOccurrences) continue;

    const vietnamese = transcribeHanViet(chinese);
    if (!vietnamese) continue;

    results.push({
      chinese,
      vietnamese,
      occurrences: meta.count,
      chapterIndices: Array.from(meta.chapters).sort((a, b) => a - b),
      firstChapterIndex: meta.firstIdx,
    });
  }

  // Deduplicate substrings when parent candidate exists with higher or similar frequency
  const filtered = filterSubstrings(results);

  // Sort by total occurrences descending
  filtered.sort((a, b) => b.occurrences - a.occurrences);

  return filtered.slice(0, maxCandidates);
}

/**
 * Filters out short suffix/prefix fragments if a longer parent candidate exists with high occurrence.
 */
function filterSubstrings(candidates: ScannedEntityCandidate[]): ScannedEntityCandidate[] {
  const keepers: ScannedEntityCandidate[] = [];

  for (const c of candidates) {
    let dominated = false;
    for (const other of candidates) {
      if (other.chinese !== c.chinese && other.chinese.includes(c.chinese)) {
        // If longer candidate occurs in >= 70% of the chapters of the shorter candidate
        if (other.occurrences >= c.occurrences * 0.7) {
          dominated = true;
          break;
        }
      }
    }
    if (!dominated) {
      keepers.push(c);
    }
  }

  return keepers;
}

/**
 * Harvests rich contextual evidence for each candidate across all chapters:
 * 1. First appearance paragraph.
 * 2. Kinship sentences.
 * 3. Direct dialogue quotes.
 */
export function harvestCharacterContext(
  chapters: Array<{ index: number; sourceText: string }>,
  candidates: ScannedEntityCandidate[],
  options?: { maxKinship?: number; maxDialogues?: number },
): CharacterHarvestProfile[] {
  const maxKinship = options?.maxKinship ?? 4;
  const maxDialogues = options?.maxDialogues ?? 4;

  const profiles: CharacterHarvestProfile[] = candidates.map((c) => ({
    chinese: c.chinese,
    vietnamese: c.vietnamese,
    occurrences: c.occurrences,
    firstChapterIndex: c.firstChapterIndex,
    firstAppearanceSnippet: '',
    kinshipSnippets: [],
    dialogueSnippets: [],
  }));

  for (const profile of profiles) {
    const name = profile.chinese;

    for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
      const text = chapters[chIdx]?.sourceText;
      if (!text || !text.includes(name)) continue;

      // 1. First appearance paragraph
      if (!profile.firstAppearanceSnippet) {
        const paragraphs = text.split(/\n+/);
        for (const p of paragraphs) {
          if (p.includes(name)) {
            profile.firstAppearanceSnippet = p.trim().slice(0, 220);
            break;
          }
        }
      }

      // 2. Kinship & Dialogue sentences using quote-preserving split
      const sentences = splitSentences(text);
      for (const s of sentences) {
        if (!s.includes(name) || s.length < 10 || s.length > 200) continue;

        // Kinship
        if (profile.kinshipSnippets.length < maxKinship && KINSHIP_REGEX.test(s)) {
          if (!profile.kinshipSnippets.includes(s)) {
            profile.kinshipSnippets.push(s);
          }
        }

        // Direct dialogue quote
        if (profile.dialogueSnippets.length < maxDialogues && /(“[^”]{3,120}”|「[^」]{3,120}」)/.test(s)) {
          if (!profile.dialogueSnippets.includes(s)) {
            profile.dialogueSnippets.push(s);
          }
        }
      }

      // If we have enough snippets, we can skip remaining chapters for this character
      if (
        profile.firstAppearanceSnippet &&
        profile.kinshipSnippets.length >= maxKinship &&
        profile.dialogueSnippets.length >= maxDialogues
      ) {
        break;
      }
    }
  }

  return profiles;
}

const LOCATION_SUFFIX_LIST = [
  '生產大隊', '生产大队', '大隊', '大队', '公社', '村子', '村', '鎮', '镇', '縣', '县',
  '莊', '庄', '省', '市', '城', '山', '嶺', '岭', '峰', '河', '江', '湖', '海',
  '灣', '湾', '坡', '峪', '洞', '寺', '廟', '庙', '宮', '宫', '門', '门', '派',
  '宗', '幫', '帮', '醫院', '医院', '學校', '学校', '廠', '厂', '營', '营', '路', '街', '巷',
];

const LOCATION_COMMON_BLACKLIST = new Set([
  '地方', '東西', '事情', '問題', '辦法', '房間', '門口', '窗戶', '桌子', '椅子',
  '床邊', '廚房', '院子', '門外', '屋裏', '裏面', '外面', '上門', '下來', '上去',
  '出山', '上山', '下山', '過河', '過江', '入海', '出門', '進門', '關門', '開門',
  '大門', '出城', '進城', '同門', '師門', '本幫', '本省', '本市', '本縣', '本鎮',
  '本村', '出院', '住院', '工廠', '軍營', '營長', '班長', '連長', '隊長', '大隊長',
  '老家', '時候', '半天', '半晌', '身邊', '身後', '頭上', '臉上', '地上', '家門',
  '半路', '順路', '全村', '回城', '回村', '村子', '公社', '學校', '醫院', '打開門',
  '走了門', '到了門', '回到學校', '去學校', '證券市', '買了門', '進了門', '出了門',
  '專門', '一路', '集市', '校門', '農村', '縣城', '城市', '這條路', '那條路',
]);

const LOCATION_INVALID_PREFIXES = new Set([
  '他', '她', '我', '你', '們', '的', '給', '着', '著', '個', '這', '那', '一', '專',
  '全', '開', '進', '出', '同', '在', '到', '去', '上', '下', '過', '入', '是', '打',
  '有', '認', '送', '看', '聽', '走', '回', '來', '拿', '帶', '找', '見', '了', '都',
  '跟', '和', '從',
]);

/**
 * Scans a book's chapters and discovers potential location & faction candidates with high occurrence.
 */
export function scanBookForLocations(
  chapters: Array<{ index: number; sourceText: string }>,
  options?: { minOccurrences?: number; maxCandidates?: number },
): ScannedEntityCandidate[] {
  const minOccurrences = options?.minOccurrences ?? 2;
  const maxCandidates = options?.maxCandidates ?? 40;
  const candidateOccurrences = new Map<string, { count: number; chapters: Set<number>; firstIdx: number }>();

  chapters.forEach((ch, chIdx) => {
    const text = ch.sourceText;
    if (!text) return;

    for (const suf of LOCATION_SUFFIX_LIST) {
      let pos = 0;
      while ((pos = text.indexOf(suf, pos)) !== -1) {
        for (let nameLen = suf.length + 1; nameLen <= Math.min(suf.length + 3, 5); nameLen++) {
          const startIdx = pos + suf.length - nameLen;
          if (startIdx < 0) continue;
          let cand = text.slice(startIdx, pos + suf.length);
          if (!/^[\u4e00-\u9fa5]+$/.test(cand)) continue;

          while (cand.length >= 3 && LOCATION_INVALID_PREFIXES.has(cand[0]!)) {
            cand = cand.slice(1);
          }

          if (
            cand.length >= 2 &&
            cand.endsWith(suf) &&
            !LOCATION_INVALID_PREFIXES.has(cand[0]!) &&
            !LOCATION_COMMON_BLACKLIST.has(cand)
          ) {
            const vn = transcribeHanViet(cand);
            if (vn) {
              const cur = candidateOccurrences.get(cand) ?? {
                count: 0,
                chapters: new Set<number>(),
                firstIdx: chIdx,
              };
              cur.count++;
              cur.chapters.add(chIdx);
              candidateOccurrences.set(cand, cur);
            }
          }
        }
        pos += suf.length;
      }
    }
  });

  const results: ScannedEntityCandidate[] = [];
  for (const [chinese, meta] of candidateOccurrences.entries()) {
    if (meta.count < minOccurrences) continue;
    const vietnamese = transcribeHanViet(chinese);
    if (!vietnamese) continue;
    results.push({
      chinese,
      vietnamese,
      occurrences: meta.count,
      chapterIndices: Array.from(meta.chapters).sort((a, b) => a - b),
      firstChapterIndex: meta.firstIdx,
    });
  }

  const filtered = filterSubstrings(results);
  filtered.sort((a, b) => b.occurrences - a.occurrences);
  return filtered.slice(0, maxCandidates);
}

/**
 * Harvests contextual first-appearance snippets for discovered locations across chapters.
 */
export function harvestLocationContext(
  chapters: Array<{ index: number; sourceText: string }>,
  candidates: ScannedEntityCandidate[],
): LocationHarvestProfile[] {
  const profiles: LocationHarvestProfile[] = candidates.map((c) => ({
    chinese: c.chinese,
    vietnamese: c.vietnamese,
    occurrences: c.occurrences,
    firstChapterIndex: c.firstChapterIndex,
    firstAppearanceSnippet: '',
  }));

  for (const profile of profiles) {
    const name = profile.chinese;
    for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
      const text = chapters[chIdx]?.sourceText;
      if (!text || !text.includes(name)) continue;

      const paragraphs = text.split(/\n+/);
      for (const p of paragraphs) {
        if (p.includes(name)) {
          profile.firstAppearanceSnippet = p.trim().slice(0, 200);
          break;
        }
      }
      if (profile.firstAppearanceSnippet) break;
    }
  }

  return profiles;
}

/**
 * Divides profiles into clusters of reasonable size (e.g. 12-15 characters) for multi-turn processing.
 */
export function createCharacterClusters(
  profiles: CharacterHarvestProfile[],
  clusterSize = 15,
): CharacterHarvestProfile[][] {
  const clusters: CharacterHarvestProfile[][] = [];
  for (let i = 0; i < profiles.length; i += clusterSize) {
    clusters.push(profiles.slice(i, i + clusterSize));
  }
  return clusters;
}

/**
 * Compiles a structured, comprehensive prompt for ChatGPT (Thinking Mode / o1 / o3-mini)
 * providing all context snippets and requiring full extraction of roles, pronouns, and relationships.
 */
export function compileStoryDigestPrompt(
  profiles: CharacterHarvestProfile[],
  options?: {
    bookTitle?: string;
    genre?: string;
    synopsis?: string;
    clusterIndex?: number;
    totalClusters?: number;
    locations?: LocationHarvestProfile[];
  },
): string {
  const bookTitle = options?.bookTitle || 'Tiểu thuyết';
  const genre = options?.genre || 'period';
  const synopsis = options?.synopsis ? `\n[VĂN ÁN / GIỚI THIỆU TÁC PHẨM]:\n${options.synopsis}\n` : '';
  const clusterNotice =
    options?.totalClusters && options.totalClusters > 1
      ? `(Phần ${options.clusterIndex || 1} / ${options.totalClusters} nhóm nhân vật)`
      : '';

  const profileBlocks = profiles.map((p, idx) => {
    const lines: string[] = [];
    lines.push(`### ${idx + 1}. [${p.chinese} -> ${p.vietnamese}] (Tần suất xuất hiện: ${p.occurrences} lần, từ Chương ${p.firstChapterIndex + 1})`);
    if (p.firstAppearanceSnippet) {
      lines.push(`- Ngữ cảnh giới thiệu đầu tiên: "${p.firstAppearanceSnippet}"`);
    }
    if (p.kinshipSnippets.length > 0) {
      lines.push('- Bằng chứng quan hệ gia đình / thân tộc:');
      p.kinshipSnippets.forEach((k) => lines.push(`  * ${k}`));
    }
    if (p.dialogueSnippets.length > 0) {
      lines.push('- Bằng chứng xưng hô đối thoại trực tiếp:');
      p.dialogueSnippets.forEach((d) => lines.push(`  * ${d}`));
    }
    return lines.join('\n');
  });

  let locationSection = '';
  if (options?.locations && options.locations.length > 0) {
    const locLines = options.locations.map((loc, idx) => {
      let l = `### ĐD-${idx + 1}. [${loc.chinese} -> ${loc.vietnamese}] (Tần suất: ${loc.occurrences} lần, từ Chương ${loc.firstChapterIndex + 1})`;
      if (loc.firstAppearanceSnippet) {
        l += `\n- Bối cảnh xuất hiện: "${loc.firstAppearanceSnippet}"`;
      }
      return l;
    });
    locationSection = `\n\n--- DANH SÁCH ĐỊA DANH, THẾ LỰC & BỐI CẢNH TRINH SÁT ---\n${locLines.join('\n\n')}`;
  }

  return `Bạn là Chuyên gia Biên tập Văn học và Phân tích Cốt truyện Tiểu thuyết Trung - Việt.
Dưới đây là "Hồ Sơ Ngữ Cảnh Trinh Sát" được trích xuất từ tác phẩm: "${bookTitle}" (Thể loại: ${genre}) ${clusterNotice}.${synopsis}

Dựa vào các ngữ cảnh xuất hiện đầu tiên, câu bằng chứng thân tộc và câu thoại trực tiếp dưới đây, hãy suy luận và phân tích sâu toàn bộ dàn nhân vật, địa danh/thế lực và mối quan hệ để lập "BẢNG PHẢ HỆ, ĐỊA DANH VÀ XƯNG HÔ CHUẨN".

--- DANH SÁCH NHÂN VẬT & NGỮ CẢNH TRINH SÁT ---
${profileBlocks.join('\n\n')}${locationSection}

--- YÊU CẦU ĐẦU RA ---
Hãy suy nghĩ sâu (Thinking process) và trả về kết quả dưới định dạng JSON duy nhất đặt trong \`\`\`json ... \`\`\` với schema sau:
\`\`\`json
{
  "characters": [
    {
      "chinese": "Tên tiếng Trung",
      "vietnamese": "Tên Hán Việt chuẩn xác",
      "gender": "male" | "female" | "unknown",
      "role": "Vai vế xã hội hoặc vị trí gia đình (Mẹ, Cha, Chồng, Vợ, Chị dâu, Anh cả, Đồng đội, Phó doanh trưởng, v.v.)",
      "narrationPronoun": "Đại từ ngôi thứ 3 dùng khi dẫn truyện (anh, cô, ông, bà, chị, cậu, hắn, nàng)",
      "notes": "Ghi chú ngắn về tính cách hoặc thân thế"
    }
  ],
  "relationships": [
    {
      "sourceCharacter": "Tên tiếng Việt nhân vật A",
      "targetCharacter": "Tên tiếng Việt nhân vật B",
      "relationType": "Mối quan hệ (Vợ - Chồng, Mẹ - Con, Chị dâu - Em dâu, Anh em, Đồng đội, v.v.)",
      "pronounSample": "Cách gọi nhau (Anh - Em, Mẹ - Con, Chị - Em, Bác - Cháu)",
      "directionalAddress": {
        "aToB": { "self": "A xưng", "call": "A gọi B" },
        "bToA": { "self": "B xưng", "call": "B gọi A" }
      },
      "toneInstruction": "Sắc thái tình cảm (Thân mật vợ chồng, Kính cẩn tình mẫu tử, Thân tình chị dâu em chồng, v.v.)"
    }
  ],
  "locations": [
    {
      "chinese": "Tên tiếng Trung (ví dụ: 向阳村, 丰扬村, 红星大队)",
      "vietnamese": "Tên Hán Việt chuẩn xác (ví dụ: Thôn Hướng Dương, Thôn Phong Dương, Đại đội Hồng Tinh)",
      "category": "location" | "faction",
      "notes": "Mô tả ngắn gọn về đặc điểm hoặc vai trò của địa danh/thế lực này trong tác phẩm"
    }
  ]
}
\`\`\`
CHÚ Ý:
1. Xác định đúng giới tính và vai vế dựa trên các từ ngữ thân tộc (\`母親\` -> Mẹ / Nữ; \`大嫂\` -> Chị dâu / Nữ; \`兩口子\` -> Vợ chồng; \`大哥\` -> Anh cả / Nam; \`營長/當兵\` -> Quân nhân).
2. Thiết lập đúng các cặp quan hệ 2 chiều rõ ràng, không để quan hệ bị bỏ trống.
3. Nhận diện chuẩn xác các địa danh/thế lực xuất hiện trong câu chuyện (làng thôn, đại đội, công xã, huyện, núi, sông, viện).
4. Chỉ xuất khối JSON hợp lệ, không kèm văn bản giải thích dài dòng bên ngoài khối JSON.`;
}

/**
 * Extracts balanced top-level JSON objects from an array block string.
 */
function extractObjectsFromBlock(blockStr: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let inStr = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < blockStr.length; i++) {
    const ch = blockStr[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          objects.push(blockStr.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objects;
}

/**
 * Robustly parses and validates the JSON response returned by ChatGPT.
 * Employs a 3-tier resilient parser:
 * 1. Full JSON.parse with quote and comma sanitization.
 * 2. Individual object-level extraction if the full block has syntax issues or is truncated.
 * 3. Regex property extraction fallback for individual malformed objects.
 */
export function parseStoryDigestResponse(aiResponse: string): ParsedStoryDigest {
  if (!aiResponse) {
    return { characters: [], relationships: [], locations: [] };
  }

  let jsonStr = '';
  const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const firstBrace = aiResponse.indexOf('{');
    const lastBrace = aiResponse.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = aiResponse.slice(firstBrace, lastBrace + 1).trim();
    } else if (firstBrace !== -1) {
      jsonStr = aiResponse.slice(firstBrace).trim();
    }
  }

  if (!jsonStr) {
    return { characters: [], relationships: [], locations: [] };
  }

  const sanitizedJson = jsonStr
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"');

  // Tier 1: Try direct full parse
  try {
    const raw = JSON.parse(sanitizedJson);
    const characters: StoryEntity[] = [];
    if (Array.isArray(raw.characters)) {
      for (const c of raw.characters) {
        if (!c.chinese || !c.vietnamese) continue;
        characters.push({
          id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          category: 'character',
          chinese: String(c.chinese).trim(),
          vietnamese: String(c.vietnamese).trim(),
          gender: c.gender === 'male' || c.gender === 'female' ? c.gender : 'unknown',
          role: c.role ? String(c.role).trim() : undefined,
          narrationPronoun: c.narrationPronoun ? String(c.narrationPronoun).trim() : undefined,
          notes: c.notes ? String(c.notes).trim() : undefined,
          status: 'verified',
        });
      }
    }

    const relationships: CharacterRelation[] = [];
    if (Array.isArray(raw.relationships)) {
      for (const r of raw.relationships) {
        if (!r.sourceCharacter || !r.targetCharacter) continue;
        relationships.push({
          id: `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          sourceCharacter: String(r.sourceCharacter).trim(),
          targetCharacter: String(r.targetCharacter).trim(),
          relationType: String(r.relationType || 'Quen biết').trim(),
          pronounSample: String(r.pronounSample || 'Tôi - Bạn').trim(),
          directionalAddress: r.directionalAddress,
          toneInstruction: r.toneInstruction ? String(r.toneInstruction).trim() : undefined,
        });
      }
    }

    const locations: StoryEntity[] = [];
    if (Array.isArray(raw.locations)) {
      for (const loc of raw.locations) {
        if (!loc.chinese || !loc.vietnamese) continue;
        locations.push({
          id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          category: loc.category === 'faction' ? 'faction' : 'location',
          chinese: String(loc.chinese).trim(),
          vietnamese: String(loc.vietnamese).trim(),
          notes: loc.notes ? String(loc.notes).trim() : undefined,
          status: 'verified',
        });
      }
    }

    if (characters.length > 0 || relationships.length > 0 || locations.length > 0) {
      return { characters, relationships, locations };
    }
  } catch {
    // Proceed to Tier 2 and Tier 3
  }

  // Tier 2 & 3: Resilient block & regex extraction
  const characters: StoryEntity[] = [];
  const relationships: CharacterRelation[] = [];
  const locations: StoryEntity[] = [];

  // Extract characters block
  const charBlockMatch = sanitizedJson.match(/"characters"\s*:\s*\[([\s\S]*?)(?:\]|\n\s*"(?:relationships|locations)")/);
  if (charBlockMatch && charBlockMatch[1]) {
    const rawObjs = extractObjectsFromBlock(charBlockMatch[1]);
    for (const rawObj of rawObjs) {
      try {
        const c = JSON.parse(rawObj);
        if (c.chinese && c.vietnamese) {
          characters.push({
            id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            category: 'character',
            chinese: String(c.chinese).trim(),
            vietnamese: String(c.vietnamese).trim(),
            gender: c.gender === 'male' || c.gender === 'female' ? c.gender : 'unknown',
            role: c.role ? String(c.role).trim() : undefined,
            narrationPronoun: c.narrationPronoun ? String(c.narrationPronoun).trim() : undefined,
            notes: c.notes ? String(c.notes).trim() : undefined,
            status: 'verified',
          });
          continue;
        }
      } catch {
        // Fallback to regex field matching
      }

      // Regex field extraction fallback
      const zh = rawObj.match(/"chinese"\s*:\s*"([^"]+)"/)?.[1];
      const vi = rawObj.match(/"vietnamese"\s*:\s*"([^"]+)"/)?.[1];
      if (zh && vi) {
        const gender = rawObj.match(/"gender"\s*:\s*"([^"]+)"/)?.[1];
        const role = rawObj.match(/"role"\s*:\s*"([^"]+)"/)?.[1];
        const narrationPronoun = rawObj.match(/"narrationPronoun"\s*:\s*"([^"]+)"/)?.[1];
        characters.push({
          id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          category: 'character',
          chinese: zh.trim(),
          vietnamese: vi.trim(),
          gender: gender === 'male' || gender === 'female' ? gender : 'unknown',
          role: role?.trim(),
          narrationPronoun: narrationPronoun?.trim(),
          status: 'verified',
        });
      }
    }
  }

  // Extract relationships block
  const relBlockMatch = sanitizedJson.match(/"relationships"\s*:\s*\[([\s\S]*?)(?:\]|\n\s*"locations"|$)/);
  if (relBlockMatch && relBlockMatch[1]) {
    const rawObjs = extractObjectsFromBlock(relBlockMatch[1]);
    for (const rawObj of rawObjs) {
      try {
        const r = JSON.parse(rawObj);
        if (r.sourceCharacter && r.targetCharacter) {
          relationships.push({
            id: `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            sourceCharacter: String(r.sourceCharacter).trim(),
            targetCharacter: String(r.targetCharacter).trim(),
            relationType: String(r.relationType || 'Quen biết').trim(),
            pronounSample: String(r.pronounSample || 'Tôi - Bạn').trim(),
            directionalAddress: r.directionalAddress,
            toneInstruction: r.toneInstruction ? String(r.toneInstruction).trim() : undefined,
          });
          continue;
        }
      } catch {
        // Fallback to regex field matching
      }

      // Regex field extraction fallback
      const src = rawObj.match(/"sourceCharacter"\s*:\s*"([^"]+)"/)?.[1];
      const tgt = rawObj.match(/"targetCharacter"\s*:\s*"([^"]+)"/)?.[1];
      if (src && tgt) {
        const relType = rawObj.match(/"relationType"\s*:\s*"([^"]+)"/)?.[1];
        const sample = rawObj.match(/"pronounSample"\s*:\s*"([^"]+)"/)?.[1];
        relationships.push({
          id: `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          sourceCharacter: src.trim(),
          targetCharacter: tgt.trim(),
          relationType: relType?.trim() || 'Quen biết',
          pronounSample: sample?.trim() || 'Tôi - Bạn',
        });
      }
    }
  }

  // Extract locations block
  const locBlockMatch = sanitizedJson.match(/"locations"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
  if (locBlockMatch && locBlockMatch[1]) {
    const rawObjs = extractObjectsFromBlock(locBlockMatch[1]);
    for (const rawObj of rawObjs) {
      try {
        const l = JSON.parse(rawObj);
        if (l.chinese && l.vietnamese) {
          locations.push({
            id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            category: l.category === 'faction' ? 'faction' : 'location',
            chinese: String(l.chinese).trim(),
            vietnamese: String(l.vietnamese).trim(),
            notes: l.notes ? String(l.notes).trim() : undefined,
            status: 'verified',
          });
          continue;
        }
      } catch {}

      const zh = rawObj.match(/"chinese"\s*:\s*"([^"]+)"/)?.[1];
      const vi = rawObj.match(/"vietnamese"\s*:\s*"([^"]+)"/)?.[1];
      const cat = rawObj.match(/"category"\s*:\s*"([^"]+)"/)?.[1];
      if (zh && vi) {
        locations.push({
          id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          category: cat === 'faction' ? 'faction' : 'location',
          chinese: zh.trim(),
          vietnamese: vi.trim(),
          status: 'verified',
        });
      }
    }
  }

  return { characters, relationships, locations };
}
