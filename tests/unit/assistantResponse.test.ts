import { describe, expect, it } from 'vitest';
import {
  extractDiscoveredDataFromResponse,
  extractDiscoveredEntitiesFromResponse,
  sanitizeTranslationResponse,
} from '../../src/core';

describe('sanitizeTranslationResponse', () => {
  it('removes the localized writing-block label before the matching chapter', () => {
    const source = 'Chương 7: 出发\n\n原文。';
    const response = 'Bài viết\r\n\r\n---\r\n\r\nChương 7: Lên đường\r\n\r\nNội dung.';

    expect(sanitizeTranslationResponse(source, response))
      .toBe('Chương 7: Lên đường\r\n\r\nNội dung.');
  });

  it('keeps prose and suspicious labels when the source/header context does not match', () => {
    expect(sanitizeTranslationResponse('原文。', 'Bài viết\nNội dung.'))
      .toBe('Bài viết\nNội dung.');
    expect(sanitizeTranslationResponse(
      'Chương 7: 出发\n原文。',
      'Bài viết\nChương 8: Khác chương\nNội dung.',
    )).toBe('Bài viết\nChương 8: Khác chương\nNội dung.');
    expect(sanitizeTranslationResponse(
      'Chương 7: 出发\n原文。',
      'Chương 7: Lên đường\nĐây là một bài viết trong truyện.',
    )).toBe('Chương 7: Lên đường\nĐây là một bài viết trong truyện.');
  });

  it('unwraps BAN_DICH container and unlocks locked character names', () => {
    const source = 'Chương 1: 舒舒\n原文。';
    const response = `<BAN_DICH id="seg-1">
Chương 1: ⟦Thư Thư⟧

⟦Kha Tiểu Hoa⟧ nắm tay ⟦Thư Thư⟧ vui vẻ bước đi.
</BAN_DICH>`;

    expect(sanitizeTranslationResponse(source, response)).toBe(
      'Chương 1: Thư Thư\n\nKha Tiểu Hoa nắm tay Thư Thư vui vẻ bước đi.',
    );
  });

  it('completely isolates BAN_DICH content and excludes THUC_THE_MOI tag from translation', () => {
    const source = '原文。';
    const response = `<BAN_DICH id="seg-1">
Tôn Hưng Quốc và Lâm Tú Bình đang gặt lúa ở cánh đồng.
</BAN_DICH>

<THUC_THE_MOI>
[
  {"zh": "孙兴国", "vi": "Tôn Hưng Quốc", "gender": "Nam", "role": null},
  {"zh": "林秀平", "vi": "Lâm Tú Bình", "gender": "Nữ", "role": "Thanh niên trí thức"}
]
</THUC_THE_MOI>`;

    const cleaned = sanitizeTranslationResponse(source, response);
    expect(cleaned).toBe('Tôn Hưng Quốc và Lâm Tú Bình đang gặt lúa ở cánh đồng.');
    expect(cleaned).not.toContain('THUC_THE_MOI');
    expect(cleaned).not.toContain('孙兴国');
  });

  it('Active JSON Stripper removes bare JSON array even when AI omits THUC_THE_MOI tags', () => {
    const source = '原文。';
    const responseWithBareJson = `<BAN_DICH id="seg-385">
Chương 385: Thư Thư đi học tại trường.
Cô bé chăm chỉ học tập mỗi ngày.
[
  {
    "category": "organization",
    "zh": "莫斯科大學",
    "vi": "Đại học Mạc Tư Khoa",
    "notes": "Trường đại học nơi Thư Thư theo học."
  }
]
</BAN_DICH>`;

    const cleaned = sanitizeTranslationResponse(source, responseWithBareJson);
    expect(cleaned).toBe('Chương 385: Thư Thư đi học tại trường.\nCô bé chăm chỉ học tập mỗi ngày.');
    expect(cleaned).not.toContain('category');
    expect(cleaned).not.toContain('莫斯科大學');
    expect(cleaned).not.toContain('[');
  });

  it('strips accidental trailing brackets and unclosed stream brackets at end of translation', () => {
    const source = '原文。';
    const responseWithTrailingBracket = `<BAN_DICH id="seg-1">
Đây là câu văn cuối cùng của chương.
[
</BAN_DICH>`;

    const cleaned = sanitizeTranslationResponse(source, responseWithTrailingBracket);
    expect(cleaned).toBe('Đây là câu văn cuối cùng của chương.');
    expect(cleaned).not.toContain('[');
  });

  it('cleans accidental trailing bracket debris leftover from response', () => {
    const source = 'Chương 108: 原文。';
    const response = `<BAN_DICH id="segment-108">
Chương 108: Bách Hóa Đại Lầu

Còn tưởng ông ấy bị ma nhập nữa cơ.

[
</BAN_DICH>`;
    expect(sanitizeTranslationResponse(source, response)).toBe(
      'Chương 108: Bách Hóa Đại Lầu\n\nCòn tưởng ông ấy bị ma nhập nữa cơ.',
    );
  });
});

describe('extractDiscoveredEntitiesFromResponse', () => {
  it('extracts new valid characters from THUC_THE_MOI tag', () => {
    const response = `<BAN_DICH id="seg-1">
Nội dung bản dịch.
</BAN_DICH>

<THUC_THE_MOI>
[
  {
    "zh": "孙兴国",
    "vi": "Tôn Hưng Quốc",
    "gender": "Nam",
    "role": null
  },
  {
    "zh": "林秀平",
    "vi": "Lâm Tú Bình",
    "gender": "Nữ",
    "role": "Thanh niên trí thức mới đến thôn"
  }
]
</THUC_THE_MOI>`;

    const entities = extractDiscoveredEntitiesFromResponse(response);
    expect(entities).toHaveLength(2);
    expect(entities[0]).toEqual({
      category: 'character',
      zh: '孙兴国',
      vi: 'Tôn Hưng Quốc',
      gender: 'male',
      role: undefined,
      notes: undefined,
    });
    expect(entities[1]).toEqual({
      category: 'character',
      zh: '林秀平',
      vi: 'Lâm Tú Bình',
      gender: 'female',
      role: 'Thanh niên trí thức mới đến thôn',
      notes: undefined,
    });
  });

  it('extracts new locations from THUC_THE_MOI tag', () => {
    const response = `<THUC_THE_MOI>
[
  {
    "category": "location",
    "zh": "清河村",
    "vi": "Thôn Thanh Hà",
    "notes": "Ngôi làng ven sông nơi các thanh niên trí thức làm việc"
  }
]
</THUC_THE_MOI>`;

    const entities = extractDiscoveredEntitiesFromResponse(response);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toEqual({
      category: 'location',
      zh: '清河村',
      vi: 'Thôn Thanh Hà',
      gender: undefined,
      role: undefined,
      notes: 'Ngôi làng ven sông nơi các thanh niên trí thức làm việc',
    });
  });

  it('handles markdown code fences inside THUC_THE_MOI tag', () => {
    const response = `<THUC_THE_MOI>
\`\`\`json
[
  {
    "zh": "陈铁蛋",
    "vi": "Trần Thiết Đản",
    "gender": "nam",
    "role": "con trai thứ hai nhà họ Trần"
  }
]
\`\`\`
</THUC_THE_MOI>`;

    const entities = extractDiscoveredEntitiesFromResponse(response);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.zh).toBe('陈铁蛋');
    expect(entities[0]!.vi).toBe('Trần Thiết Đản');
    expect(entities[0]!.gender).toBe('male');
    expect(entities[0]!.role).toBe('con trai thứ hai nhà họ Trần');
  });

  it('filters out blacklisted common words and invalid endings even if returned by AI', () => {
    const response = `<THUC_THE_MOI>
[
  {"zh": "高考", "vi": "Cao Khảo", "gender": "Chưa rõ", "role": null},
  {"zh": "秋千", "vi": "Thu Thiên", "gender": "Nữ", "role": null},
  {"zh": "通知", "vi": "Thông Tri", "gender": "Nam", "role": null},
  {"zh": "孙兴国的", "vi": "Tôn Hưng Quốc Đích", "gender": "Nam", "role": null},
  {"zh": "周建军", "vi": "Chu Kiến Quân", "gender": "Nam", "role": "Cán bộ huyện"}
]
</THUC_THE_MOI>`;

    const entities = extractDiscoveredEntitiesFromResponse(response);
    // Only 周建军 is a valid character!
    expect(entities).toHaveLength(1);
    expect(entities[0]!.zh).toBe('周建军');
    expect(entities[0]!.vi).toBe('Chu Kiến Quân');
    expect(entities[0]!.role).toBe('Cán bộ huyện');
  });

  it('discards placeholder roles such as "—", "không rõ", "chưa rõ", "none"', () => {
    const response = `<THUC_THE_MOI>
[
  {"zh": "刘石头", "vi": "Lưu Thạch Đầu", "gender": "nam", "role": "—"},
  {"zh": "张桂花", "vi": "Trương Quế Hoa", "gender": "nữ", "role": "không rõ"}
]
</THUC_THE_MOI>`;

    const entities = extractDiscoveredEntitiesFromResponse(response);
    expect(entities).toHaveLength(2);
    expect(entities[0]!.role).toBeUndefined();
    expect(entities[1]!.role).toBeUndefined();
  });

  it('returns empty array when THUC_THE_MOI is missing or empty', () => {
    expect(extractDiscoveredEntitiesFromResponse('<BAN_DICH id="1">Dịch</BAN_DICH>')).toEqual([]);
    expect(extractDiscoveredEntitiesFromResponse('<THUC_THE_MOI>[]</THUC_THE_MOI>')).toEqual([]);
    expect(extractDiscoveredEntitiesFromResponse('')).toEqual([]);
  });

  it('extracts school and organization entities up to 8 CJK characters', () => {
    const response = `<THUC_THE_MOI>
[
  {
    "category": "organization",
    "zh": "江鴻高中",
    "vi": "Trường cấp ba Giang Hồng",
    "notes": "Trường cấp ba trọng điểm mà Thư Thư thi đỗ"
  },
  {
    "category": "organization",
    "zh": "首都醫科大學",
    "vi": "Đại học Y khoa Thủ Đô",
    "notes": "Trường đại học y khoa hàng đầu"
  }
]
</THUC_THE_MOI>`;
    const entities = extractDiscoveredEntitiesFromResponse(response);
    expect(entities).toHaveLength(2);
    expect(entities[0]!.zh).toBe('江鴻高中');
    expect(entities[0]!.vi).toBe('Trường Cấp Ba Giang Hồng');
    expect(entities[0]!.category).toBe('faction');
    expect(entities[1]!.zh).toBe('首都醫科大學');
    expect(entities[1]!.vi).toBe('Đại Học Y Khoa Thủ Đô');
  });

  it('fallback extracts entities from bare JSON array when AI omits THUC_THE_MOI tag', () => {
    const responseWithBareJson = `Bản dịch văn bản...
[
  {
    "category": "organization",
    "zh": "江鴻高中",
    "vi": "Trường cấp ba Giang Hồng",
    "notes": "Trường cấp ba trọng điểm"
  }
]`;
    const entities = extractDiscoveredEntitiesFromResponse(responseWithBareJson);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.zh).toBe('江鴻高中');
    expect(entities[0]!.vi).toBe('Trường Cấp Ba Giang Hồng');
  });

  it('extracts character relations and bidirectional address mappings from THUC_THE_MOI', () => {
    const response = `<BAN_DICH id="1">Nội dung dịch</BAN_DICH>
<THUC_THE_MOI>
[
  {
    "category": "character",
    "zh": "晏梓安",
    "vi": "Yến Tử An",
    "gender": "nam"
  },
  {
    "category": "relation",
    "charA": "Yến Tử An",
    "charB": "Tống Thư Thư",
    "relation": "Người yêu",
    "aToB": "anh - em",
    "bToA": "em - anh"
  }
]
</THUC_THE_MOI>`;

    const data = extractDiscoveredDataFromResponse(response);
    expect(data.entities).toHaveLength(1);
    expect(data.entities[0]!.vi).toBe('Yến Tử An');
    expect(data.relations).toHaveLength(1);
    expect(data.relations[0]!.charA).toBe('Yến Tử An');
    expect(data.relations[0]!.charB).toBe('Tống Thư Thư');
    expect(data.relations[0]!.relationType).toBe('Người yêu');
    expect(data.relations[0]!.aToB).toEqual({ self: 'anh', call: 'em' });
    expect(data.relations[0]!.bToA).toEqual({ self: 'em', call: 'anh' });
  });

  it('correctly parses foreign character with Latin name and aliases from THUC_THE_MOI', () => {
    const response = `<BAN_DICH id="1">Nội dung dịch</BAN_DICH>
<THUC_THE_MOI>
[
  {
    "category": "character",
    "zh": "耶莲娜",
    "vi": "Jelina",
    "gender": "nữ",
    "role": "Bạn học người Nga",
    "aliases": ["耶莲卡"]
  }
]
</THUC_THE_MOI>`;

    const data = extractDiscoveredDataFromResponse(response);
    expect(data.entities).toHaveLength(1);
    expect(data.entities[0]!.zh).toBe('耶莲娜');
    expect(data.entities[0]!.vi).toBe('Jelina');
    expect(data.entities[0]!.gender).toBe('female');
    expect(data.entities[0]!.aliases).toEqual(['耶莲卡']);
  });

  it('correctly extracts shortened names and fixed nicknames from THUC_THE_MOI', () => {
    const response = `<BAN_DICH id="434">
Chương 434: Tú Lệ chuẩn bị về thôn thu mua gạo
Tú Lệ chợt thắt lòng. Cô mang sách vở của Cương Tử giao cho cậu ấy.
</BAN_DICH>
<THUC_THE_MOI>
[
  {
    "category": "character",
    "zh": "秀麗",
    "vi": "Tú Lệ",
    "gender": "Nữ",
    "role": "Tên gọi của Ngô Tú Lệ"
  },
  {
    "category": "character",
    "zh": "剛子",
    "vi": "Cương Tử",
    "gender": "Nam",
    "role": "Biệt danh của Lý Học Cương"
  }
]
</THUC_THE_MOI>`;

    const data = extractDiscoveredDataFromResponse(response);
    expect(data.entities).toHaveLength(2);
    expect(data.entities[0]).toMatchObject({
      zh: '秀麗',
      vi: 'Tú Lệ',
      gender: 'female',
      role: 'Tên gọi của Ngô Tú Lệ',
    });
    expect(data.entities[1]).toMatchObject({
      zh: '剛子',
      vi: 'Cương Tử',
      gender: 'male',
      role: 'Biệt danh của Lý Học Cương',
    });
  });
});
