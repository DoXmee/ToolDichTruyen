import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TranslationJobRunner } from '../../src/main/translation/TranslationJobRunner';
import { installTranslationPipelineV3 } from '../../src/main/translation/TranslationPipelineV3';
import { ChatGptSafetyRefusalError } from '../../src/main/chatgpt/ChatGptWebAdapter';

describe('installed-runner-compatible two-turn workflow (Turn 1: Scout & Turn 2: Translation)', () => {
  beforeAll(() => {
    process.env.SKIP_DIGEST_IN_TEST = 'true';
  });

  afterAll(() => {
    delete process.env.SKIP_DIGEST_IN_TEST;
  });
  it('scouts characters, cuts garbage, translates with locked names, and strips brackets', async () => {
    const values = new Map<string, any>(), calls: string[] = [];
    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_SCOUT]') || prompt.startsWith('[TDT_V3_ANALYSIS]')) {
          calls.push('scout');
          return JSON.stringify({
            integrity: { status: 'ok', reason: '' },
            garbage: [{ text: 'Đọc truyện tại website abc', reason: 'quảng cáo' }],
            newCharacters: [{ source: '柳如煙', vi: 'Liễu Như Yên', gender: 'female', role: 'nhân vật chính' }],
            relations: [],
          });
        }
        calls.push('translation');
        expect(prompt).toContain('⟦Liễu Như Yên⟧');
        expect(prompt).not.toContain('Đọc truyện tại website abc');
        expect(prompt).not.toContain('<THUC_THE_MOI>');
        return `<BAN_DICH id="V3-CH1-CH2">\nChương 1\n⟦Liễu Như Yên⟧ đi đến chợ. ⟦Liễu Như Yên⟧ nói chuyện.\n\nChương 2\n⟦Liễu Như Yên⟧ đi đến chợ.\n</BAN_DICH>`;
      },
    };

    const runner = new TranslationJobRunner({
      chatGpt: adapter as any,
      persistence: {
        async saveJob(j: any) {
          values.set(j.id, structuredClone(j));
        },
        async loadJob(id: string) {
          return values.get(id) || null;
        },
      },
    });

    installTranslationPipelineV3(runner);
    const { jobId } = await runner.start({
      source: 'Chương 1\n柳如煙走來。柳如煙說話。\nĐọc truyện tại website abc\nChương 2\n柳如煙走來。',
      promptMode: 'ancient',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 2,
      settings: { maxRetries: 1 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    expect(j.status, j.error).toBe('completed');
    expect(j.segments).toHaveLength(1);
    expect(j.pipelineV3.bootstrapDone).toBe(true);
    expect(j.translatedText).toContain('Liễu Như Yên');
    expect(j.translatedText).not.toMatch(/[⟦⟧]/u);
    expect(j.translatedText).not.toContain('Đọc truyện tại website abc');
    expect(calls).toEqual(['scout', 'translation']);
  });

  it('falls back gracefully if Turn 1 scout JSON fails repeatedly and completes translation', async () => {
    const values = new Map<string, any>(), calls: string[] = [];
    let scoutFailures = 0;
    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_SCOUT]') || prompt.startsWith('[TDT_V3_ANALYSIS]')) {
          calls.push('scout');
          scoutFailures++;
          // Simulate AI returning non-JSON story text
          return 'Đây là bản dịch tiếng Việt ngẫu nhiên không có JSON.';
        }
        calls.push('translation');
        return `<BAN_DICH id="V3-CH1-CH2">\nChương 1\nBản dịch chương 1.\n\nChương 2\nBản dịch chương 2.\n</BAN_DICH>`;
      },
    };

    const runner = new TranslationJobRunner({
      chatGpt: adapter as any,
      persistence: {
        async saveJob(j: any) {
          values.set(j.id, structuredClone(j));
        },
        async loadJob(id: string) {
          return values.get(id) || null;
        },
      },
    });

    installTranslationPipelineV3(runner);
    const { jobId } = await runner.start({
      source: 'Chương 1\nNội dung một.\nChương 2\nNội dung hai.',
      promptMode: 'ancient',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 2,
      settings: { maxRetries: 1 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    // The job MUST complete without failing!
    // 2 cluster scout attempts fail without faking integrity -> safely fallbacks to single-segment scout (2 attempts) -> completes translation
    expect(j.status, j.error).toBe('completed');
    expect(j.translatedText).toContain('Bản dịch chương 1.');
    expect(j.translatedText).toContain('Bản dịch chương 2.');
    expect(calls).toEqual(['scout', 'scout', 'scout', 'scout', 'translation']);
  });

  it('repairs localized stray Han characters without retranslating full chapters', async () => {
    const values = new Map<string, any>(), calls: string[] = [];
    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_SCOUT]') || prompt.startsWith('[TDT_V3_ANALYSIS]')) {
          calls.push('scout');
          return JSON.stringify({
            integrity: { status: 'ok', reason: '' },
            garbage: [],
            newCharacters: [],
            relations: [],
          });
        }
        if (prompt.includes('<CAU_CAN_SUA')) {
          calls.push('repair');
          const idMatch = prompt.match(/<CAU_CAN_SUA\s+id="([^"]+)">/);
          const targetId = idMatch ? idMatch[1] : 'target-1';
          return `<CAU_DA_SUA id="${targetId}">Cô ấy nhìn hắn rồi khẽ gật đầu một tiếng.</CAU_DA_SUA>`;
        }
        calls.push('translation');
        return `<BAN_DICH id="V3-CH1-CH2">\nChương 1\nCô ấy nhìn hắn rồi khẽ 嗯 một tiếng.\n\nChương 2\nNội dung chương 2 bình thường.\n</BAN_DICH>`;
      },
    };

    const runner = new TranslationJobRunner({
      chatGpt: adapter as any,
      persistence: {
        async saveJob(j: any) {
          values.set(j.id, structuredClone(j));
        },
        async loadJob(id: string) {
          return values.get(id) || null;
        },
      },
    });

    installTranslationPipelineV3(runner);
    const { jobId } = await runner.start({
      source: 'Chương 1\n她看著他。\nChương 2\n第二章內容。',
      promptMode: 'ancient',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 2,
      settings: { maxRetries: 1 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    expect(j.status, j.error).toBe('completed');
    expect(j.translatedText).toContain('Cô ấy nhìn hắn rồi khẽ gật đầu một tiếng.');
    expect(j.translatedText).not.toContain('嗯');
    expect(calls).toEqual(['scout', 'translation', 'repair']);
  });

  it('recovers from ChatGptSafetyRefusalError without self-poisoning warningBlock and strips entity role notes', async () => {
    const values = new Map<string, any>();
    const translationPrompts: string[] = [];
    let newChatCount = 0;

    const adapter = {
      async ensureReady() {},
      async startNewConversation() {
        newChatCount++;
      },
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_SCOUT]') || prompt.startsWith('[TDT_V3_ANALYSIS]')) {
          return JSON.stringify({
            integrity: { status: 'ok', reason: '' },
            garbage: [],
            newCharacters: [
              {
                source: '韓靖琛',
                vi: 'Hàn Tĩnh Sâm',
                gender: 'male',
                role: 'Bị tính kế để phát sinh quan hệ nhạy cảm với người khác',
              },
            ],
            relations: [],
          });
        }
        translationPrompts.push(prompt);
        if (translationPrompts.length === 1) {
          throw new ChatGptSafetyRefusalError(
            'ChatGPT từ chối vì lý do an toàn: "Không thể hiển thị nội dung này vì lý do an toàn."',
          );
        }
        return `<BAN_DICH id="V3-CH1">\nChương 1: Bình an trở về\n⟦Hàn Tĩnh Sâm⟧ mỉm cười nhìn cả nhà và bước vào sân.\n</BAN_DICH>`;
      },
    };

    const runner = new TranslationJobRunner({
      chatGpt: adapter as any,
      persistence: {
        async saveJob(j: any) {
          values.set(j.id, structuredClone(j));
        },
        async loadJob(id: string) {
          return values.get(id) || null;
        },
      },
    });

    installTranslationPipelineV3(runner);
    const { jobId } = await runner.start({
      source: 'Chương 1: 終于是安心了\n韓靖琛微笑着看向家人，緩步走進院子裏。',
      promptMode: 'period',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 1,
      settings: { maxRetries: 3 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    expect(j.status, j.error).toBe('completed');
    expect(translationPrompts).toHaveLength(2);
    expect(translationPrompts[0]).toContain('Bị tính kế để phát sinh quan hệ nhạy cảm');
    expect(translationPrompts[1]).toContain('NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN');
    expect(translationPrompts[1]).not.toContain('CẢNH BÁO QUAN TRỌNG KHI DỊCH LẠI');
    expect(translationPrompts[1]).not.toContain('ChatGptSafetyRefusalError');
    expect(translationPrompts[1]).not.toContain('Bị tính kế để phát sinh quan hệ nhạy cảm');
    expect(newChatCount).toBeGreaterThanOrEqual(3);
    expect(j.translatedText).toContain('Hàn Tĩnh Sâm mỉm cười');
  });

  it('escalates to balanced half-splitting when full-segment retries continue receiving safety refusals', async () => {
    const values = new Map<string, any>();
    const translationPrompts: string[] = [];

    const longSource = [
      'Chương 954: 終于是安心了',
      '為了安全起見，他們只能在這裏待一天。張奶奶打發了過來打探消息的鄰裏，示意他們進屋說話，自己則提了菜坐到了大門口擇起了菜，當然，目的就是為了放風。',
      '屋裏的幾人沒有過多寒暄，分析了當前的形勢與接下來的安排，大家都希望一切順利平安。',
      '等車子駛出馬蘭鎮，顧婉晴看向女兒：“妍妍，明天就要回學校，你要不要再請一天假休息一下？”',
      '心妍搖頭笑了笑：“媽，不用請假，再休息一晚，這腳也就沒問題了，我們很快就會平安回去的。”',
    ].join('\n');

    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_SCOUT]') || prompt.startsWith('[TDT_V3_ANALYSIS]')) {
          return JSON.stringify({
            integrity: { status: 'ok', reason: '' },
            garbage: [],
            newCharacters: [],
            relations: [],
          });
        }
        translationPrompts.push(prompt);
        if (prompt.includes('id="V3-CH954-S1"')) {
          return `<BAN_DICH id="V3-CH954-S1">\nChương 954: Cuối cùng cũng yên lòng rồi\nĐể đảm bảo an toàn, họ chỉ có thể ở lại đây một ngày. Bà Trương tiễn hàng xóm sang hỏi thăm về, ra hiệu cho mọi người vào nhà nói chuyện, còn mình thì xách rổ rau ra cổng ngồi nhặt để canh chừng.\nMấy người trong nhà không khách sáo nhiều, cùng phân tích tình hình hiện tại và kế hoạch sắp tới, ai cũng mong mọi việc thuận lợi bình an.\n</BAN_DICH>`;
        }
        if (prompt.includes('id="V3-CH954-S2"')) {
          return `<BAN_DICH id="V3-CH954-S2">\nKhi xe rời khỏi trấn Mã Lan, Cố Uyển Tình nhìn con gái hỏi: “Nghiên Nghiên, ngày mai phải về trường rồi, con có cần xin nghỉ thêm một ngày không?”\nTâm Nghiên lắc đầu mỉm cười: “Mẹ à, không cần xin nghỉ đâu, nghỉ thêm một đêm là chân con sẽ ổn thôi, chúng ta sẽ nhanh chóng về nhà bình an.”\n</BAN_DICH>`;
        }
        // Refuse full-chapter prompts (including visible assistant text refusal on attempt 2)
        if (translationPrompts.length === 2) {
          return 'Không thể hiển thị nội dung này vì lý do an toàn. Tìm hiểu thêm về cách chúng tôi tiếp cận các cuộc trò chuyện nhạy cảm.';
        }
        throw new ChatGptSafetyRefusalError('ChatGPT từ chối vì lý do an toàn: "Không thể hiển thị nội dung này"');
      },
    };

    const runner = new TranslationJobRunner({
      chatGpt: adapter as any,
      persistence: {
        async saveJob(j: any) {
          values.set(j.id, structuredClone(j));
        },
        async loadJob(id: string) {
          return values.get(id) || null;
        },
      },
    });

    installTranslationPipelineV3(runner);
    const { jobId } = await runner.start({
      source: longSource,
      promptMode: 'period',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 1,
      settings: { maxRetries: 3 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    expect(j.status, j.error).toBe('completed');
    expect(translationPrompts.some((p) => p.includes('id="V3-CH954-S1"'))).toBe(true);
    expect(translationPrompts.some((p) => p.includes('id="V3-CH954-S2"'))).toBe(true);
    expect(j.translatedText).toContain('Chương 954: Cuối cùng cũng yên lòng rồi');
    expect(j.translatedText).toContain('Tâm Nghiên lắc đầu mỉm cười');
  });
});
