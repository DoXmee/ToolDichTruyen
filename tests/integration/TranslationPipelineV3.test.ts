import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TranslationJobRunner } from '../../src/main/translation/TranslationJobRunner';
import { installTranslationPipelineV3 } from '../../src/main/translation/TranslationPipelineV3';

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
});
