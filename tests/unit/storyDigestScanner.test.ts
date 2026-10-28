import { describe, expect, it } from 'vitest';
import {
  compileStoryDigestPrompt,
  createCharacterClusters,
  harvestCharacterContext,
  harvestLocationContext,
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
});
