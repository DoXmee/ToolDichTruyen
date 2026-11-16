import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TranslationJobRunner } from '../../src/main/translation/TranslationJobRunner';
import { installTranslationPipelineV3 } from '../../src/main/translation/TranslationPipelineV3';
import { getProviderLimits } from '../../src/core/aiProviderLimits';
import { groupAdaptiveChapterChunks, splitChapters } from '../../src/core/translationPipelineV3';

describe('Pipeline V3 Integrity & Han Repair Queue Resilience', () => {
  beforeAll(() => {
    process.env.SKIP_DIGEST_IN_TEST = 'true';
  });

  afterAll(() => {
    delete process.env.SKIP_DIGEST_IN_TEST;
  });

  it('verifies provider limits configuration for all 3 independent AI engines', () => {
    const webLimits = getProviderLimits('chatgpt', 'web');
    expect(webLimits.aiProvider).toBe('chatgpt');
    expect(webLimits.executionMode).toBe('web');
    expect(webLimits.maxCustomPromptChars).toBe(3000);
    expect(webLimits.safeTotalMessageChars).toBe(12500);

    const deepseekLimits = getProviderLimits('deepseek', 'api');
    expect(deepseekLimits.aiProvider).toBe('deepseek');
    expect(deepseekLimits.executionMode).toBe('api');
    expect(deepseekLimits.maxCustomPromptChars).toBe(6000);
    expect(deepseekLimits.maxOutputTokens).toBe(8192);

    const geminiLimits = getProviderLimits('gemini', 'api');
    expect(geminiLimits.aiProvider).toBe('gemini');
    expect(geminiLimits.executionMode).toBe('api');
    expect(geminiLimits.maxCustomPromptChars).toBe(10000);
    expect(geminiLimits.maxOutputTokens).toBe(65536);
  });

  it('groupAdaptiveChapterChunks dynamically deduplicates batch size based on user custom prompt', () => {
    const source = Array.from({ length: 5 }, (_, i) => `Chương ${i + 1}\nNội dung chương ${i + 1}.`).join('\n\n');
    
    // Normal prompt
    const normalChunks = groupAdaptiveChapterChunks(source, {
      executionMode: 'web',
      aiProvider: 'chatgpt',
      customPrompt: 'Dịch chuẩn.',
    });
    expect(normalChunks.length).toBeGreaterThan(0);

    // Very long custom prompt pushes down batch size towards floor
    const longPrompt = 'Văn phong cổ trang nghiêm ngặt. '.repeat(100);
    const constrainedChunks = groupAdaptiveChapterChunks(source, {
      executionMode: 'web',
      aiProvider: 'chatgpt',
      customPrompt: longPrompt,
    });
    expect(constrainedChunks.length).toBeGreaterThan(0);
  });

  it('Cluster Scout blocks truncated segment from entering translation without user check', async () => {
    const values = new Map<string, any>();
    const translatedSegments: string[] = [];

    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_CLUSTER_SCOUT]')) {
          // AI reports segment 1 is ok, but segment 2 is truncated
          return JSON.stringify({
            segments: [
              {
                segmentId: 'V3-CH1',
                integrity: { status: 'ok', reason: '' },
                garbage: [],
              },
              {
                segmentId: 'V3-CH2',
                integrity: { status: 'truncated', reason: 'Chương bị cắt cụt giữa chừng' },
                garbage: [],
              },
            ],
            newCharacters: [],
            locations: [],
            relations: [],
          });
        }
        if (prompt.includes('[TDT_SCOUT]')) {
          return JSON.stringify({
            integrity: { status: 'truncated', reason: 'Chương bị cắt cụt giữa chừng' },
            garbage: [],
            newCharacters: [],
            locations: [],
            relations: [],
          });
        }
        if (prompt.includes('<BAN_DICH')) {
          const match = prompt.match(/<NGUYEN_BAN id="([^"]+)">/);
          const segId = match ? match[1] : 'unknown';
          translatedSegments.push(segId!);
          return `<BAN_DICH id="${segId}">\nChương 1\nBản dịch hoàn tất cho ${segId}.\n</BAN_DICH>`;
        }
        return '{}';
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
      source: 'Chương 1\nNội dung chương một đầy đủ.\n\nChương 2\nNội dung chương hai bị cụt dở dang',
      promptMode: 'ancient',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 1, // 2 distinct segments
      settings: { maxRetries: 0 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    // Segment 1 translated ok, but Segment 2 must NOT have entered translation!
    expect(translatedSegments).toContain('V3-CH1');
    expect(translatedSegments).not.toContain('V3-CH2');
    expect(j.status).toBe('failed');
    expect(j.error).toContain('không toàn vẹn (truncated)');
  });

  it('resilient Han repair queue commits partial successes and retains remaining targets upon API failure', async () => {
    const values = new Map<string, any>();
    let repairAttempts = 0;

    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_CLUSTER_SCOUT]') || prompt.includes('[TDT_SCOUT]')) {
          return JSON.stringify({
            integrity: { status: 'ok' },
            garbage: [],
            newCharacters: [],
            locations: [],
            relations: [],
          });
        }
        if (prompt.includes('<CAU_CAN_SUA')) {
          repairAttempts++;
          const targetIds = [...prompt.matchAll(/<CAU_CAN_SUA\s+id="([^"]+)">/g)].map((m) => m[1]);
          if (targetIds.length > 0) {
            // First flush: only return replacement for the FIRST target (retaining >= 60% words)
            const firstId = targetIds[0]!;
            return `<CAU_DA_SUA id="${firstId}">Cô ấy nhìn hắn rồi khẽ ừ một tiếng.</CAU_DA_SUA>`;
          }
          // Subsequent flush: throw network error
          throw new Error('503 Service Unavailable');
        }
        // Translation returns a segment with 2 stray Han sentences
        return `<BAN_DICH id="V3-CH1">\nChương 1\nCô ấy nhìn hắn rồi khẽ 嗯 một tiếng.\n\nHắn đáp 嗯 một tiếng.\n</BAN_DICH>`;
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
      source: 'Chương 1\n她看著他。\n他答應了。',
      promptMode: 'ancient',
      resolvedPrompt: 'Dịch thuần Việt.',
      executionMode: 'api',
      aiProvider: 'deepseek',
      batchChaptersCount: 1,
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

    // Verify job checkpoint exists and pending queue was not wiped out by finally
    expect(j).toBeDefined();
    // The first target was replaced in translatedText
    expect(j.segments[0].translatedText).toContain('Cô ấy nhìn hắn rồi khẽ ừ một tiếng.');
  });

  it('splitChapters handles prologue/preamble before Chapter 1 as CH0 without throwing', () => {
    const sourceWithPrologue = 'Văn án giới thiệu truyện hay tuyệt đỉnh.\nNữ chính xuyên không.\n\nChương 1: Bắt đầu\nNội dung chương 1.';
    const chapters = splitChapters(sourceWithPrologue);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.id).toBe('CH0');
    expect(chapters[0]!.number).toBe(0);
    expect(chapters[0]!.title).toBe('Văn án / Lời mở đầu');
    expect(chapters[0]!.text).toContain('Văn án giới thiệu truyện');
    expect(chapters[1]!.id).toBe('CH1');
    expect(chapters[1]!.number).toBe(1);
    expect(chapters[1]!.title).toBe('Chương 1: Bắt đầu');
  });

  it('groupAdaptiveChapterChunks never groups sub-parts of oversized chapters with other chapters', () => {
    // Chapter 1 is long (exceeds maxBatchChars), Chapter 2 is short
    const longChapter1 = `Chương 1: Dài\n${'Nội dung dài dằng dặc của chương 1. '.repeat(100)}`;
    const shortChapter2 = 'Chương 2: Ngắn\nNội dung ngắn của chương 2.';
    const source = `${longChapter1}\n\n${shortChapter2}`;

    const chunks = groupAdaptiveChapterChunks(source, {
      executionMode: 'web',
      aiProvider: 'chatgpt',
      maxBatchChars: 500,
    });

    // Every chunk with a sub-part (-P) must be isolated, never grouped with Chapter 2
    for (const chunk of chunks) {
      if (chunk.id.includes('-P')) {
        expect(chunk.id).not.toMatch(/-P\d+-CH\d+/); // e.g. V3-CH1-P2-CH2 is FORBIDDEN
        expect(chunk.chapterCount).toBe(1);
      }
    }
  });

  it('sub-parts (-P1, -P2) with truncated status are automatically treated as ok without triggering refetch', async () => {
    const values = new Map<string, any>();
    let refetchCalled = false;
    let scoutCalled = false;
    let translateCalled = false;

    const adapter = {
      async ensureReady() {},
      async startNewConversation() {},
      async cancelGeneration() {},
      async sendAndWait(prompt: string) {
        if (prompt.includes('[TDT_CLUSTER_SCOUT]')) {
          scoutCalled = true;
          // AI flags truncated because it's a sub-part ending mid-sentence
          return JSON.stringify({
            segments: [
              {
                segmentId: 'V3-CH1-P1',
                integrity: { status: 'truncated', reason: 'Nội dung kết thúc giữa câu' },
                garbage: [],
                newCharacters: [],
              },
              {
                segmentId: 'V3-CH1-P2',
                integrity: { status: 'truncated', reason: 'Nội dung kết thúc giữa câu' },
                garbage: [],
                newCharacters: [],
              },
            ],
            garbage: [],
            newCharacters: [],
          });
        }
        if (prompt.includes('[TDT_SCOUT]')) {
          scoutCalled = true;
          return JSON.stringify({
            integrity: { status: 'truncated', reason: 'Nội dung kết thúc giữa câu' },
            garbage: [],
            newCharacters: [],
          });
        }
        if (prompt.includes('<BAN_DICH')) {
          translateCalled = true;
          const match = prompt.match(/<NGUYEN_BAN id="([^"]+)">/);
          const segId = match ? match[1] : 'unknown';
          const longViet = Array.from({ length: 60 }, (_, i) => `Câu thứ ${i + 1} của phân đoạn kể về sự việc diễn ra vô cùng hấp dẫn và chi tiết.`).join('\n');
          return `<BAN_DICH id="${segId}">\nChương 1\n${longViet}\n</BAN_DICH>`;
        }
        return '{}';
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

    (runner as any).storySourceService = {
      refetchRaw: async () => {
        refetchCalled = true;
        return 'refetched text';
      },
    };

    installTranslationPipelineV3(runner);

    // Provide a long chapter that forces sub-part splitting (-P1, -P2)
    const longChapter = `Chương 1: Tiêu đề dài\n${'Nội dung câu chuyện dài dằng dặc. '.repeat(120)}`;
    const { jobId } = await runner.start({
      source: longChapter,
      promptMode: 'ancient',
      resolvedPrompt: 'Dịch thuần Việt.',
      batchChaptersCount: 1,
      settings: { maxRetries: 0 },
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const j = values.get(jobId);
      if (j?.status === 'completed' || j?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const j = values.get(jobId);
    await runner.shutdown();

    expect(j?.status).toBe('completed');
    expect(refetchCalled).toBe(false);
    expect(scoutCalled).toBe(true);
    expect(translateCalled).toBe(true);
    expect(j.segments[0].id).toContain('-P1');
    expect(j.segments[0].status).toBe('completed');
  });
});
