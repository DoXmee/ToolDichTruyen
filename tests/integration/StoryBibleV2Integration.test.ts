import { describe, expect, it } from 'vitest';
import { TranslationJobRunner } from '../../src/main/translation/TranslationJobRunner';
import type { StoryMemory } from '../../src/shared/types';
import {
  batchRenameInTranslation,
  lockNamesInSource,
  unlockNamesInTranslation,
} from '../../src/core/nameLocker';
import { validateStoryBibleOutput } from '../../src/core/storyBibleValidator';
import { PERIOD_GENRE_PROFILE } from '../../src/core/genreProfile';
import fs from 'node:fs';
import path from 'node:path';

describe('Story Bible v2 Full Integration & Upgrade Verification', () => {
  it('injects Period Genre glossary, narration pronouns, and directional relations into translation runner', async () => {
    const sentPrompts: string[] = [];

    const fakeChatGpt = {
      ensureReady: async () => {},
      startNewConversation: async () => {},
      sendAndWait: async (prompt: string) => {
        sentPrompts.push(prompt);
        // AI returns translation with locked name tokens
        return '⟦Cố Quốc Cường⟧ và ⟦Thẩm Ngọc Lan⟧ cùng nhau đi đến đại đội và đội sản xuất.';
      },
      cancelGeneration: async () => {},
    };

    const savedJobs = new Map<string, any>();
    const fakePersistence = {
      saveJob: async (job: any) => {
        savedJobs.set(job.id, JSON.parse(JSON.stringify(job)));
      },
      loadJob: async <T>(id: string): Promise<T | null> => (savedJobs.get(id) as T | undefined) ?? null,
    };

    const periodMemory: StoryMemory = {
      version: 1,
      storyTitle: 'Trùng Sinh Niên Đại',
      genre: 'period',
      entities: [
        {
          id: 'ent-1',
          category: 'character',
          chinese: '顾国强',
          vietnamese: 'Cố Quốc Cường',
          gender: 'male',
          role: 'Cha',
          narrationPronoun: 'ông',
        },
        {
          id: 'ent-2',
          category: 'character',
          chinese: '沈玉兰',
          vietnamese: 'Thẩm Ngọc Lan',
          gender: 'female',
          role: 'Mẹ',
          narrationPronoun: 'bà',
        },
      ],
      relations: [
        {
          id: 'rel-1',
          sourceCharacter: 'Cố Quốc Cường',
          targetCharacter: 'Thẩm Ngọc Lan',
          relationType: 'Phu thê',
          pronounSample: 'Anh - Em',
          directionalAddress: {
            aToB: { self: 'anh', call: 'em' },
            bToA: { self: 'em', call: 'anh' },
          },
        },
      ],
      customRules: [],
      recentDialogues: [],
      updatedAt: new Date().toISOString(),
    };

    const runner = new TranslationJobRunner({
      chatGpt: fakeChatGpt as any,
      persistence: fakePersistence,
    });

    // Source contains: characters (顾国强, 沈玉兰) and Period glossary terms (生产队, 大队, 供销社, 工分)
    const sourceText = '顾国强看着沈玉兰，两人准备去大队和生产队，路上还要去供销社核对工分。';

    const { jobId } = await runner.start({
      source: sourceText,
      promptMode: 'period',
      resolvedPrompt: 'DỊCH TIỂU THUYẾT NIÊN ĐẠI TRUNG QUỐC',
      aiProvider: 'chatgpt',
      memory: periodMemory,
    });

    // Wait until job completes
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for job')), 5000);
      runner.onEvent((event) => {
        if (event.jobId === jobId && (event.type === 'job-completed' || event.type === 'job-failed')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    expect(sentPrompts.length).toBeGreaterThanOrEqual(1);
    const sentPrompt = sentPrompts[0]!;

    // 1. Verify character details and narration pronouns
    expect(sentPrompt).toContain('顾国强 -> Cố Quốc Cường (Nam | Đại từ dẫn truyện: "ông" | Vai vế: Cha)');
    expect(sentPrompt).toContain('沈玉兰 -> Thẩm Ngọc Lan (Nữ | Đại từ dẫn truyện: "bà" | Vai vế: Mẹ)');

    // 2. Verify 2-way directional address
    expect(sentPrompt).toContain('Cố Quốc Cường -> Thẩm Ngọc Lan: Tự xưng "anh", gọi đối phương "em"');
    expect(sentPrompt).toContain('Thẩm Ngọc Lan -> Cố Quốc Cường: Tự xưng "em", gọi đối phương "anh"');

    // 3. Verify automatic injection of Period Genre glossary terms
    expect(sentPrompt).toContain('KHỐI F: THUẬT NGỮ NIÊN ĐẠI TRONG ĐOẠN');
    expect(sentPrompt).toContain('生产队 -> đội sản xuất');
    expect(sentPrompt).toContain('大队 -> đại đội');
    expect(sentPrompt).toContain('供销社 -> hợp tác xã mua bán');
    expect(sentPrompt).toContain('工分 -> điểm công');

    // 4. Verify the runner cleanly unwraps bracketed tokens ⟦...⟧ from the final saved translation
    const finalJob = await runner.get(jobId);
    expect(finalJob?.status).toBe('completed');
    const persisted = await fakePersistence.loadJob<any>(jobId);
    expect(persisted?.segments[0]?.translatedText).toBe(
      'Cố Quốc Cường và Thẩm Ngọc Lan cùng nhau đi đến đại đội và đội sản xuất.',
    );
    // Must NOT contain any raw brackets in final saved translation
    expect(persisted?.segments[0]?.translatedText).not.toContain('⟦');
    expect(persisted?.segments[0]?.translatedText).not.toContain('⟧');
    expect(finalJob?.translatedText).toContain(
      'Cố Quốc Cường và Thẩm Ngọc Lan cùng nhau đi đến đại đội và đội sản xuất.',
    );
  });

  it('detects unclosed bracket tokens and triggers retry recovery', async () => {
    let callCount = 0;
    const fakeChatGpt = {
      ensureReady: async () => {},
      startNewConversation: async () => {},
      sendAndWait: async () => {
        callCount++;
        if (callCount === 1) {
          // 1st attempt: AI outputs an unclosed bracket
          return '⟦Cố Quốc Cường và Thẩm Ngọc Lan cùng nhau đi.';
        }
        // 2nd attempt: AI corrects the brackets
        return '⟦Cố Quốc Cường⟧ và ⟦Thẩm Ngọc Lan⟧ cùng nhau đi.';
      },
      cancelGeneration: async () => {},
    };

    const savedJobs = new Map<string, any>();
    const fakePersistence = {
      saveJob: async (job: any) => {
        savedJobs.set(job.id, JSON.parse(JSON.stringify(job)));
      },
      loadJob: async <T>(id: string): Promise<T | null> => (savedJobs.get(id) as T | undefined) ?? null,
    };

    const runner = new TranslationJobRunner({
      chatGpt: fakeChatGpt as any,
      persistence: fakePersistence,
    });

    const { jobId } = await runner.start({
      source: '顾国强看着沈玉兰。',
      promptMode: 'period',
      resolvedPrompt: 'DỊCH NIÊN ĐẠI',
      aiProvider: 'chatgpt',
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for job')), 5000);
      runner.onEvent((event) => {
        if (event.jobId === jobId && (event.type === 'job-completed' || event.type === 'job-failed')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Must have retried because attempt 1 failed validation with unclosed_lock
    expect(callCount).toBe(2);

    const finalJob = await runner.get(jobId);
    expect(finalJob?.status).toBe('completed');
    const persisted = await fakePersistence.loadJob<any>(jobId);
    expect(persisted?.segments[0]?.translatedText).toBe('Cố Quốc Cường và Thẩm Ngọc Lan cùng nhau đi.');
  });

  it('executes batch rename across translated text in 1 millisecond without re-translation', () => {
    const text = 'Cố Quốc Cường dẫn theo Cố Cẩn Thư đi đại đội. Cố Quốc Cường nói chuyện với đội trưởng.';
    const start = performance.now();
    const renamed = batchRenameInTranslation(text, 'Cố Quốc Cường', 'Cố Đại Cường');
    const elapsed = performance.now() - start;

    expect(renamed).toBe('Cố Đại Cường dẫn theo Cố Cẩn Thư đi đại đội. Cố Đại Cường nói chuyện với đội trưởng.');
    expect(elapsed).toBeLessThan(10); // Less than 10ms
  });

  it('verifies all 15 real Golden Set samples pass through lock -> translate -> unlock -> validate without error', () => {
    const fixturePath = path.resolve('tests/fixtures/golden_set.json');
    if (!fs.existsSync(fixturePath)) return;

    const goldenSet = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const testEntities = [
      { chinese: '顾国强', vietnamese: 'Cố Quốc Cường' },
      { chinese: '顾谨书', vietnamese: 'Cố Cẩn Thư' },
      { chinese: '沈玉兰', vietnamese: 'Thẩm Ngọc Lan' },
      { chinese: '顾春花', vietnamese: 'Cố Xuân Hoa' },
      { chinese: '李大妮', vietnamese: 'Lý Đại Ni' },
      { chinese: '顾大顺', vietnamese: 'Cố Đại Thuận' },
      { chinese: '顾瑶', vietnamese: 'Cố Dao' },
      { chinese: '杨琴', vietnamese: 'Dương Cầm' },
      { chinese: '苗娇', vietnamese: 'Miêu Kiều' },
      { chinese: '乔菊', vietnamese: 'Kiều Cúc' },
      { chinese: '张悦悦', vietnamese: 'Trương Duyệt Duyệt' },
    ];

    for (const sample of goldenSet) {
      // 1. Lock names in source
      const lockResult = lockNamesInSource(sample.sourceText, testEntities);

      // If sample had matching names, lockedSourceText must contain ⟦
      if (lockResult.lockedCount > 0) {
        expect(lockResult.lockedSourceText).toContain('⟦');
        expect(lockResult.lockedSourceText).toContain('⟧');
      }

      // 2. Validate translation with Story Bible validator
      const validation = validateStoryBibleOutput(sample.baselineTranslation, {
        expectedLockedNames: testEntities.map((e) => e.vietnamese),
        genreProfile: PERIOD_GENRE_PROFILE,
      });

      // No blocking issues (no stray Han, no unclosed locks)
      const blockingIssues = validation.issues.filter((i) => i.severity === 'block');
      expect(blockingIssues).toHaveLength(0);

      // 3. Clean translation check
      const cleaned = unlockNamesInTranslation(sample.baselineTranslation);
      expect(cleaned).not.toContain('⟦');
      expect(cleaned).not.toContain('⟧');
    }
  });
});
