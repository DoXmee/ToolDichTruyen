import { describe, expect, it } from 'vitest';
import { TranslationJobRunner } from '../../src/main/translation/TranslationJobRunner';
import { AiAccountRotatedError } from '../../src/main/ai/AiProviderManager';
import type { StoryMemory, TranslationJob } from '../../src/shared/types';

describe('StoryMemory Integration in TranslationJobRunner', () => {
  it('injects matched living memory into prompt across segments and account rotation', async () => {
    const sentPrompts: string[] = [];
    let shouldRotate = true;

    const fakeChatGpt = {
      ensureReady: async () => {},
      startNewConversation: async () => {},
      sendAndWait: async (prompt: string) => {
        sentPrompts.push(prompt);
        if (shouldRotate) {
          shouldRotate = false;
          throw new AiAccountRotatedError('Tài khoản dự phòng 2');
        }
        return 'Tiêu Viêm rời khỏi Ô Thản thành cùng Dược Lão.';
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

    const initialMemory: StoryMemory = {
      version: 1,
      storyTitle: 'Đấu Phá Thương Khung',
      entities: [
        { id: '1', category: 'character', chinese: '萧炎', vietnamese: 'Tiêu Viêm', gender: 'male', role: 'Main' },
        { id: '2', category: 'character', chinese: '药老', vietnamese: 'Dược Lão', role: 'Sư phụ' },
        { id: '3', category: 'location', chinese: '乌坦城', vietnamese: 'Ô Thản thành' },
      ],
      relations: [
        {
          id: 'r1',
          sourceCharacter: 'Tiêu Viêm',
          targetCharacter: 'Dược Lão',
          relationType: 'Sư đồ',
          pronounSample: 'Sư phụ - Đồ nhi / Con',
          toneInstruction: 'Tôn kính và thân tình',
        },
      ],
      customRules: ['Giữ nguyên tên riêng Hán Việt.'],
      recentDialogues: [],
      updatedAt: new Date().toISOString(),
    };

    const runner = new TranslationJobRunner({
      chatGpt: fakeChatGpt as any,
      persistence: fakePersistence,
    });

    const { jobId } = await runner.start({
      source: '萧炎收拾行囊，跟随着药老离开了乌坦城。',
      promptMode: 'cultivation',
      resolvedPrompt: 'DỊCH TRUYỆN TU TIÊN',
      aiProvider: 'chatgpt',
      memory: initialMemory,
    });

    // Wait until job finishes
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for job')), 5000);
      runner.onEvent((event) => {
        if (event.jobId === jobId && (event.type === 'job-completed' || event.type === 'job-failed')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Verify prompts sent
    // 1st prompt failed with AiAccountRotatedError
    // 2nd prompt was sent to the new account!
    expect(sentPrompts.length).toBeGreaterThanOrEqual(2);

    // Both the first attempt and the rotated attempt must contain the Story Bible v2 blocks and locked names
    for (const prompt of sentPrompts) {
      expect(prompt).toContain('### KHỐI D: QUY ƯỚC NHÂN VẬT & ĐẠI TỪ DẪN TRUYỆN');
      expect(prompt).toContain('萧炎 -> Tiêu Viêm');
      expect(prompt).toContain('药老 -> Dược Lão');
      expect(prompt).toContain('⟦Tiêu Viêm⟧');
      expect(prompt).toContain('⟦Dược Lão⟧');
      expect(prompt).toContain('⟦Ô Thản thành⟧');
    }

    // Verify the saved job has the memory preserved
    const finalJob = await runner.get(jobId);
    expect(finalJob?.status).toBe('completed');
  });
});
