import { describe, expect, it } from 'vitest';
import {
  compileStoryDigestPrompt,
  createCharacterClusters,
  harvestCharacterContext,
  harvestLocationContext,
  isNonEntityOrCommonWord,
  parseStoryDigestResponse,
  scanBookForEntities,
  scanBookForLocations,
} from '../../src/core/storyDigestScanner';

describe('Story Digest Scanner Unit Tests', () => {
  const sampleChapters = [
    {
      index: 0,
      sourceText: `
        1964年，申城。
        深秋的風帶着寒意，蜷縮在床上的岑明悅猛地坐直身，警惕地看着旁邊。
        床上的男人叫江望津，和她一樣是被算計的倒黴蛋。
        江望津冷靜地開口：“這件事我會負責。”
        “負責？你怎麼負責？”岑明悅皺眉問道。
      `,
    },
    {
      index: 1,
      sourceText: `
        趙小紅聽說女兒回來了，抄起掃把就沖出門。
        趙靜蘭連忙攔住母親：“媽，別打了！”
        岑明悅冷眼看着她們母女倆表演。
        這時，江望津開着吉普車過來了。
        江望津看着岑明悅：“走吧，跟我回部隊。”
      `,
    },
    {
      index: 2,
      sourceText: `
        到了部隊家屬院，李靜笑着迎了出來：“這就是小江媳婦吧？我是你大嫂李靜，這是你大哥江邵雲。”
        岑明悅笑着喊了一聲：“大哥，大嫂。”
        江望津也點頭：“大哥，大嫂，這是我媳婦岑明悅。”
      `,
    },
  ];

  it('correctly discovers character candidates from Chinese text and transcribes to Vietnamese', () => {
    const candidates = scanBookForEntities(sampleChapters, { minOccurrences: 1 });
    const zhs = candidates.map((c) => c.chinese);

    expect(zhs).toContain('岑明悅');
    expect(zhs).toContain('江望津');
    expect(zhs).toContain('李靜');
    expect(zhs).toContain('江邵雲');
    expect(zhs).toContain('趙小紅');
    expect(zhs).toContain('趙靜蘭');

    const sam = candidates.find((c) => c.chinese === '岑明悅');
    expect(sam?.vietnamese).toBe('Sầm Minh Duyệt');

    const giang = candidates.find((c) => c.chinese === '江望津');
    expect(giang?.vietnamese).toBe('Giang Vọng Tân');
  });

  it('harvests first appearance, kinship, and dialogue context accurately', () => {
    const candidates = scanBookForEntities(sampleChapters, { minOccurrences: 1 });
    const profiles = harvestCharacterContext(sampleChapters, candidates);

    const sam = profiles.find((p) => p.chinese === '岑明悅');
    expect(sam).toBeDefined();
    expect(sam?.firstAppearanceSnippet).toContain('岑明悅');
    expect(sam?.dialogueSnippets.length).toBeGreaterThan(0);

    const lyTinh = profiles.find((p) => p.chinese === '李靜');
    expect(lyTinh).toBeDefined();
    expect(lyTinh?.kinshipSnippets.some((k) => k.includes('大嫂') || k.includes('媳婦'))).toBe(true);
    expect(lyTinh?.dialogueSnippets.some((d) => d.includes('大嫂李靜'))).toBe(true);
  });

  it('clusters profiles properly for multi-turn chat if needed', () => {
    const candidates = scanBookForEntities(sampleChapters, { minOccurrences: 1 });
    const profiles = harvestCharacterContext(sampleChapters, candidates);

    const clusters = createCharacterClusters(profiles, 2);
    expect(clusters.length).toBe(Math.ceil(profiles.length / 2));
    expect(clusters[0]?.length).toBeLessThanOrEqual(2);
  });

  it('strictly filters out common nouns, architecture, and grammar fragments like 房子, 全村, 小學, 宿舍, 都會, 舒的小', () => {
    const dirtyChapters = [
      {
        index: 0,
        sourceText: `
          他在房子裏走動，全村的人都跑到了小學校門口。
          宿舍裏沒有人，都會生活很繁華。舒的小手抓着衣服。
          王燕看着岑明悅說話。
        `,
      },
    ];

    const candidates = scanBookForEntities(dirtyChapters, { minOccurrences: 1 });
    const zhs = candidates.map((c) => c.chinese);

    expect(zhs).not.toContain('房子');
    expect(zhs).not.toContain('全村');
    expect(zhs).not.toContain('小學');
    expect(zhs).not.toContain('宿舍');
    expect(zhs).not.toContain('都會');
    expect(zhs).not.toContain('舒的小');

    // Người thật như Vương Yến hay Sầm Minh Duyệt vẫn được giữ lại
    expect(zhs).toContain('王燕');
    expect(zhs).toContain('岑明悅');
  });

  it('compiles a structured prompt for ChatGPT Thinking mode', () => {
    const candidates = scanBookForEntities(sampleChapters, { minOccurrences: 1 });
    const profiles = harvestCharacterContext(sampleChapters, candidates);

    const prompt = compileStoryDigestPrompt(profiles, {
      bookTitle: 'Thập Niên 60 Thế Thân',
      genre: 'period',
      synopsis: 'Nữ chính xuyên thư gả thay cho quân nhân.',
    });

    expect(prompt).toContain('Thập Niên 60 Thế Thân');
    expect(prompt).toContain('Nữ chính xuyên thư gả thay cho quân nhân.');
    expect(prompt).toContain('岑明悅 -> Sầm Minh Duyệt');
    expect(prompt).toContain('Bằng chứng xưng hô đối thoại trực tiếp:');
    expect(prompt).toContain('schema');
  });

  it('robustly parses and recovers from truncated or malformed LLM JSON outputs', () => {
    const malformedOrTruncatedResponse = `
\`\`\`json
{
  "characters": [
    {
      "chinese": "岑明悅",
      "vietnamese": "Sầm Minh Duyệt",
      "gender": "female",
      "role": "Nữ chính, vợ của Giang Vọng Tân",
      "narrationPronoun": "cô",
      "notes": "Được gọi là "Tiểu Sầm" trong đơn vị"
    },
    {
      "chinese": "江望津",
      "vietnamese": "Giang Vọng Tân",
      "gender": "male",
      "role": "Nam chính / Phó doanh trưởng",
      "narrationPronoun": "anh"
    }
  ],
  "relationships": [
    {
      "sourceCharacter": "Sầm Minh Duyệt",
      "targetCharacter": "Giang Vọng Tân",
      "relationType": "Vợ - Chồng",
      "pronounSample": "Em - Anh"
    }
`;

    const parsed = parseStoryDigestResponse(malformedOrTruncatedResponse);
    expect(parsed.characters.length).toBeGreaterThanOrEqual(1);
    expect(parsed.characters.some((c) => c.vietnamese === 'Giang Vọng Tân')).toBe(true);
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0]?.sourceCharacter).toBe('Sầm Minh Duyệt');
    expect(parsed.relationships[0]?.targetCharacter).toBe('Giang Vọng Tân');
  });

  it('scans and harvests locations accurately and parses location response', () => {
    const chaptersWithLocations = [
      {
        index: 0,
        sourceText: '這裡是紅星大隊，向陽村的村民都在地裏幹活。李靜今天要去縣醫院看病。',
      },
      {
        index: 1,
        sourceText: '向陽村離紅旗公社不遠，紅星大隊的社員們都很勤勞。他剛剛從縣醫院回來。',
      },
    ];

    const locCandidates = scanBookForLocations(chaptersWithLocations, { minOccurrences: 1 });
    const zhs = locCandidates.map((l) => l.chinese);
    expect(zhs).toContain('向陽村');
    expect(zhs).toContain('紅星大隊');
    expect(zhs).toContain('縣醫院');

    const locProfiles = harvestLocationContext(chaptersWithLocations, locCandidates);
    const hyc = locProfiles.find((l) => l.chinese === '向陽村');
    expect(hyc).toBeDefined();
    expect(hyc?.firstAppearanceSnippet).toContain('向陽村');

    const responseWithLocations = `
\`\`\`json
{
  "characters": [],
  "relationships": [],
  "locations": [
    {
      "chinese": "向陽村",
      "vietnamese": "Thôn Hướng Dương",
      "category": "location",
      "notes": "Thôn làng bối cảnh chính của câu chuyện"
    },
    {
      "chinese": "紅星大隊",
      "vietnamese": "Đại đội Hồng Tinh",
      "category": "faction",
      "notes": "Đại đội sản xuất nông nghiệp"
    }
  ]
}
\`\`\`
    `;

    const parsed = parseStoryDigestResponse(responseWithLocations);
    expect(parsed.locations).toHaveLength(2);
    expect(parsed.locations[0]?.vietnamese).toBe('Thôn Hướng Dương');
    expect(parsed.locations[0]?.category).toBe('location');
    expect(parsed.locations[1]?.vietnamese).toBe('Đại đội Hồng Tinh');
    expect(parsed.locations[1]?.category).toBe('faction');
  });

  it('correctly filters non-proper entities and common words with isNonEntityOrCommonWord', () => {
    // 1-char tokens
    expect(isNonEntityOrCommonWord('单')).toBe(true);
    expect(isNonEntityOrCommonWord('白')).toBe(true);

    // Common words / items / pronouns / adverbs
    expect(isNonEntityOrCommonWord('东西')).toBe(true);
    expect(isNonEntityOrCommonWord('毛衣')).toBe(true);
    expect(isNonEntityOrCommonWord('马路')).toBe(true);
    expect(isNonEntityOrCommonWord('家门')).toBe(true);
    expect(isNonEntityOrCommonWord('那你')).toBe(true);
    expect(isNonEntityOrCommonWord('那么')).toBe(true);
    expect(isNonEntityOrCommonWord('简直')).toBe(true);
    expect(isNonEntityOrCommonWord('老桂同')).toBe(true);
    expect(isNonEntityOrCommonWord('朱阿')).toBe(true);
    expect(isNonEntityOrCommonWord('县城')).toBe(true);

    // Negative notes or roles
    expect(
      isNonEntityOrCommonWord('测试', 'Thử Nghiệm', 'Không phải nhân vật, là danh từ chỉ đồ vật', 'Chỉ đồ đạc')
    ).toBe(true);
    expect(
      isNonEntityOrCommonWord('某地', 'Mỗ Địa', undefined, 'Đây là danh từ chỉ vị trí, không phải địa danh riêng')
    ).toBe(true);

    // Real proper characters and locations
    expect(isNonEntityOrCommonWord('袁和颂', 'Viên Hòa Tụng', 'Bác sĩ quân y', 'Nam chính')).toBe(false);
    expect(isNonEntityOrCommonWord('向阳村', 'Thôn Hướng Dương', undefined, 'Địa danh chính')).toBe(false);
  });

  it('prevents scanBookForEntities from generating chopped title fragments like 老桂同 or 朱阿', () => {
    const chapters = [
      {
        index: 0,
        sourceText: `
          老桂同志今天心情很好，跟老伴说话。
          老桂同志又去买菜了。
          朱阿姨也在大院里散步，朱阿姨笑着打招呼。
          袁和颂从医院回来了。袁和颂去找林子夜。
        `,
      },
    ];

    const candidates = scanBookForEntities(chapters, { minOccurrences: 1 });
    const zhs = candidates.map((c) => c.chinese);

    // Chopped fragments must NOT be present
    expect(zhs).not.toContain('老桂同');
    expect(zhs).not.toContain('朱阿');

    // Real candidate is kept
    expect(zhs).toContain('林子夜');
  });

  it('automatically skips non-proper entities when parsing story digest response', () => {
    const responseWithDirtyEntities = `
\`\`\`json
{
  "characters": [
    {
      "chinese": "袁和颂",
      "vietnamese": "Viên Hòa Tụng",
      "gender": "male",
      "role": "Nam chính",
      "notes": "Bác sĩ quân y"
    },
    {
      "chinese": "东西",
      "vietnamese": "Đông Tây",
      "gender": "male",
      "role": "Không phải nhân vật, là danh từ chỉ đồ vật",
      "notes": "Chỉ đồ đạc hoặc vật dụng cá nhân. Không phải tên riêng và không được đưa vào phả hệ."
    },
    {
      "chinese": "毛衣",
      "vietnamese": "Mao Y",
      "gender": "male",
      "role": "Danh từ chỉ áo len, không phải nhân vật",
      "notes": "Chiếc áo len mà Viên Hòa Tụng mong Trữ Khiết đan tặng."
    },
    {
      "chinese": "老桂同",
      "vietnamese": "Lão Quế Đồng",
      "gender": "female",
      "role": "Bà nội của Trữ Khiết"
    }
  ],
  "relationships": [],
  "locations": [
    {
      "chinese": "向阳村",
      "vietnamese": "Thôn Hướng Dương",
      "category": "location",
      "notes": "Thôn làng bối cảnh"
    },
    {
      "chinese": "马路",
      "vietnamese": "Mã Lộ",
      "category": "location",
      "notes": "Đường phố hoặc đường giao thông... không phải địa danh riêng."
    },
    {
      "chinese": "家门",
      "vietnamese": "Gia Môn",
      "category": "location",
      "notes": "Cách gọi cổng hoặc lối vào nhà. Đây là danh từ chỉ vị trí, không phải địa danh riêng."
    }
  ]
}
\`\`\`
    `;

    const parsed = parseStoryDigestResponse(responseWithDirtyEntities);

    // Characters: Only Viên Hòa Tụng is kept, all dirty ones skipped
    expect(parsed.characters).toHaveLength(1);
    expect(parsed.characters[0]?.chinese).toBe('袁和颂');
    expect(parsed.characters[0]?.vietnamese).toBe('Viên Hòa Tụng');

    // Locations: Only Thôn Hướng Dương is kept, Mã Lộ and Gia Môn skipped
    expect(parsed.locations).toHaveLength(1);
    expect(parsed.locations[0]?.chinese).toBe('向阳村');
    expect(parsed.locations[0]?.vietnamese).toBe('Thôn Hướng Dương');
  });

  it('normalizes convert location names like 京市 -> Bắc Kinh and filters 县城', () => {
    const rawAiResponse = `
\`\`\`json
{
  "characters": [],
  "relationships": [],
  "locations": [
    {
      "chinese": "京市",
      "vietnamese": "Kinh Thị",
      "category": "location"
    },
    {
      "chinese": "广省",
      "vietnamese": "Quảng Tỉnh",
      "category": "location"
    },
    {
      "chinese": "港区",
      "vietnamese": "Khu cảng",
      "category": "location"
    },
    {
      "chinese": "县城",
      "vietnamese": "Huyện Thành",
      "category": "location"
    }
  ]
}
\`\`\`
    `;

    const parsed = parseStoryDigestResponse(rawAiResponse);
    // 县城 is filtered out
    expect(parsed.locations.some((l) => l.chinese === '县城')).toBe(false);

    // 京市, 广省, 港区 are normalized to standard Vietnamese
    const beijing = parsed.locations.find((l) => l.chinese === '京市');
    expect(beijing?.vietnamese).toBe('Bắc Kinh');

    const guangdong = parsed.locations.find((l) => l.chinese === '广省');
    expect(guangdong?.vietnamese).toBe('tỉnh Quảng Đông');

    const hk = parsed.locations.find((l) => l.chinese === '港区');
    expect(hk?.vietnamese).toBe('Hồng Kông');
  });
});
