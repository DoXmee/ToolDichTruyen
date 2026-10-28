import { describe, expect, it, vi } from 'vitest';
import { TranslationJobRunner } from '../../src/main/translation/TranslationJobRunner';
import type { TranslationJob } from '../../src/shared/types';

describe('TranslationJobRunner - Story Bible v2 Integration', () => {
  it('automatically scans entities, locks names with ⟦...⟧ in prompt, and sanitizes output', async () => {
    const sentPrompts: string[] = [];

    const mockChatGpt = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      startNewConversation: vi.fn().mockResolvedValue(undefined),
      sendAndWait: vi.fn().mockImplementation(async (prompt: string) => {
        sentPrompts.push(prompt);
        // Phase 1: AI Story Digest Prompt -> return JSON with characters & 2-way relationships
        if (prompt.includes('Hồ Sơ Ngữ Cảnh Trinh Sát')) {
          return `\`\`\`json
{
  "characters": [
    { "id": "char-1", "chinese": "柯小花", "vietnamese": "Kha Tiểu Hoa", "gender": "female", "role": "Chị gái", "narrationPronoun": "cô" },
    { "id": "char-2", "chinese": "陈建业", "vietnamese": "Trần Kiến Nghiệp", "gender": "male", "role": "Em trai", "narrationPronoun": "cậu" }
  ],
  "relationships": [
    {
      "id": "rel-1",
      "sourceCharacter": "Kha Tiểu Hoa",
      "targetCharacter": "Trần Kiến Nghiệp",
      "relationType": "Chị em",
      "pronounSample": "Chị - Em",
      "directionalAddress": {
        "aToB": { "self": "chị", "call": "em" },
        "bToA": { "self": "em", "call": "chị" }
      }
    }
  ]
}
\`\`\``;
        }

        // Phase 2: Translation Prompt -> return translation with BAN_DICH tag and preserved ⟦...⟧ names
        return `<BAN_DICH id="seg-1">
Chương 1: Bắt đầu

⟦Kha Tiểu Hoa⟧ nắm tay ⟦Trần Kiến Nghiệp⟧ đi trên bờ ruộng, tiếng cười vang rộn rã.
</BAN_DICH>`;
      }),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
    };

    const savedJobs = new Map<string, TranslationJob>();
    const mockPersistence = {
      saveJob: vi.fn(async (job: TranslationJob) => {
        savedJobs.set(job.id, JSON.parse(JSON.stringify(job)));
      }),
      loadJob: vi.fn(async (id: string) => savedJobs.get(id) ?? null),
      listJobSummaries: vi.fn(async () => []),
    };

    const runner = new TranslationJobRunner({
      chatGpt: mockChatGpt as any,
      persistence: mockPersistence as any,
    });

    // Two chapters with recurring characters 陈建业 (Trần Kiến Nghiệp) and 柯小花 (Kha Tiểu Hoa)
    const source = `Chương 1: Bắt đầu
烈日炎炎，麥浪金黃。柯小花拉著陈建业的手走在田埂上。
陈建业笑著說：“小花姐姐，喝水。”

Chương 2: Toàn thôn trọng sinh
柯小花看著陈建业，眼裡滿是心疼。
陈建业乖巧地點了點頭。`;

    const { jobId } = await runner.start({
      source,
      aiProvider: 'chatgpt',
      promptMode: 'period',
      resolvedPrompt: 'PROMPT GỐC NIÊN ĐẠI',
      settings: {
        maxCharsPerSegment: 100, // force multiple segments
      },
    });

    // Wait until Phase 1 (Digest) and at least 1 Translation Segment are sent
    await vi.waitFor(() => expect(sentPrompts.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });

    const digestPrompt = sentPrompts[0]!;
    // 1. Phase 1: Pre-translation AI Story Digest MUST be sent first
    expect(digestPrompt).toContain('Hồ Sơ Ngữ Cảnh Trinh Sát');
    expect(digestPrompt).toContain('陈建业 -> Trần Kiến Nghiệp');
    expect(digestPrompt).toContain('Bằng chứng xưng hô đối thoại trực tiếp');

    const firstTransPrompt = sentPrompts[1]!;
    // 2. Phase 2: Translation prompt MUST contain Story Bible v2 8 blocks
    expect(firstTransPrompt).toContain('### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC');
    expect(firstTransPrompt).toContain('### KHỐI B: THẺ BỐI CẢNH');
    expect(firstTransPrompt).toContain('### KHỐI G: NGUỒN CẦN DỊCH (ĐÃ KHÓA TÊN BẰNG ⟦ ⟧)');
    expect(firstTransPrompt).toContain('### KHỐI H: YÊU CẦU ĐẦU RA');

    // 3. Names in source text MUST be locked with ⟦...⟧ brackets
    expect(firstTransPrompt).toContain('⟦Trần Kiến Nghiệp⟧');
    expect(firstTransPrompt).toContain('⟦Kha Tiểu Hoa⟧');

    // 4. Directional relationships extracted in Phase 1 MUST appear in Phase 2's Block E
    expect(firstTransPrompt).toContain('Kha Tiểu Hoa -> Trần Kiến Nghiệp: Tự xưng "chị", gọi đối phương "em"');

    // Wait for the job or segment to finish validating
    await vi.waitFor(async () => {
      const snap = await runner.get(jobId);
      const seg0 = snap.segments.find((s) => s.index === 0);
      expect(seg0?.status).toBe('completed');
    }, { timeout: 5000 });

    const persistedJob = savedJobs.get(jobId)!;
    const seg0 = persistedJob.segments[0]!;

    // 5. Sanitized output MUST NOT contain <BAN_DICH> tags and MUST NOT contain ⟦...⟧ brackets
    expect(seg0.translatedText).not.toContain('<BAN_DICH');
    expect(seg0.translatedText).not.toContain('</BAN_DICH>');
    expect(seg0.translatedText).not.toContain('⟦');
    expect(seg0.translatedText).not.toContain('⟧');
    expect(seg0.translatedText).toContain('Kha Tiểu Hoa nắm tay Trần Kiến Nghiệp đi trên bờ ruộng');

    // 6. Memory must have AI-extracted entities and relations
    expect(persistedJob.memory?.entities?.length).toBeGreaterThan(0);
    expect(persistedJob.memory?.relations?.length).toBeGreaterThan(0);
    const hasKhaTieuHoa = persistedJob.memory?.entities?.some((e) => e.vietnamese === 'Kha Tiểu Hoa');
    expect(hasKhaTieuHoa).toBe(true);

    // 7. Subsequent segment (segment 1) MUST ALSO be locked with ⟦...⟧ and contain Story Bible v2
    await vi.waitFor(() => expect(sentPrompts.length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    const secondTransPrompt = sentPrompts[2]!;
    expect(secondTransPrompt).toContain('### KHỐI A: QUY TẮC KỸ THUẬT BẮT BUỘC');
    expect(secondTransPrompt).toContain('### KHỐI G: NGUỒN CẦN DỊCH (ĐÃ KHÓA TÊN BẰNG ⟦ ⟧)');
    expect(secondTransPrompt).toContain('⟦Trần Kiến Nghiệp⟧');
    expect(secondTransPrompt).toContain('⟦Kha Tiểu Hoa⟧');
  });
});
