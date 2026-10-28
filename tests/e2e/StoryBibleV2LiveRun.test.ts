import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatGptWebAdapter } from '../../src/main/chatgpt/ChatGptWebAdapter';
import { compileStoryBiblePrompt } from '../../src/core/promptCompilerV2';
import { createEmptyStoryBible } from '../../src/core/storyBible';
import { PERIOD_GENRE_PROFILE } from '../../src/core/genreProfile';
import { sanitizeTranslationResponse } from '../../src/core/assistantResponse';
import { validateTranslation } from '../../src/core/translationValidator';
import { mergeStoryMemory } from '../../src/core/storyMemory';
import { autoExtractStoryMemory } from '../../src/core/storyMemoryExtractor';

describe('Story Bible v2 LIVE Real Execution Test with ChatGPT Web', () => {
  it(
    'executes a real end-to-end translation with live ChatGPT Web using Story Bible v2',
    { timeout: 300_000 },
    async () => {
      const realProfile = path.join(
        process.env.APPDATA || '',
        'tool-dich-truyen',
        'chatgpt-browser-profile',
      );
      console.log('\n[LIVE TEST] 1. Preparing test environment with real profile:', realProfile);

      const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-story-bible-live-'));
      const profile = path.join(userData, 'chatgpt-browser-profile');
      await cp(realProfile, profile, { recursive: true, force: true });
      console.log('[LIVE TEST] 2. Profile cloned to disposable temporary dir:', profile);

      const adapter = new ChatGptWebAdapter({
        profileDirectory: profile,
        headless: false, // Keep visible so user can observe real browser interaction
      });

      let translationSucceeded = false;
      let rawAiResponse = '';
      let cleanedTranslation = '';

      try {
        console.log('[LIVE TEST] 3. Launching browser & verifying ChatGPT Web session...');
        const loginStatus = await adapter.openLogin();
        console.log('[LIVE TEST]    Status:', loginStatus.status, '| Message:', loginStatus.message || 'ready');
        expect(loginStatus.status).toBe('ready');

        console.log('[LIVE TEST] 4. Starting a fresh test conversation in ChatGPT Web...');
        await adapter.startNewConversation();

        console.log('[LIVE TEST] 5. Setting up Story Bible v2 data structure...');
        const bible = createEmptyStoryBible('period');
        bible.entities.push(
          {
            id: 'ent-1',
            category: 'character',
            zh: '顾国强',
            vi: 'Cố Quốc Cường',
            gender: 'male',
            role: 'Cha',
            narrationPronoun: 'ông',
          },
          {
            id: 'ent-2',
            category: 'character',
            zh: '沈玉兰',
            vi: 'Thẩm Ngọc Lan',
            gender: 'female',
            role: 'Mẹ',
            narrationPronoun: 'bà',
          },
          {
            id: 'ent-3',
            category: 'character',
            zh: '顾谨书',
            vi: 'Cố Cẩn Thư',
            gender: 'male',
            role: 'Con trai cả',
            narrationPronoun: 'cậu ấy',
          },
        );

        bible.relations.push(
          {
            id: 'rel-1',
            from: 'ent-1',
            to: 'ent-2',
            type: 'spouses',
            address: {
              aToB: { self: 'anh', call: 'em' },
              bToA: { self: 'em', call: 'anh' },
            },
          },
          {
            id: 'rel-2',
            from: 'ent-1',
            to: 'ent-3',
            type: 'parent_child',
            address: {
              aToB: { self: 'cha', call: 'con' },
              bToA: { self: 'con', call: 'cha' },
            },
          },
        );

        // Real text from the novel containing characters and historical period terms
        const realSourceText =
          '顾国强从外面急匆匆地回到家中，看着正在灶台前忙碌的沈玉兰，开口说道：“大队和生产队今天通知开全员大会，一会儿吃完饭，咱们还得去供销社核算一下上个月的工分。”这时，顾谨书掀开门帘从里屋走了出来，点了点头。';

        console.log('[LIVE TEST] 6. Compiling 8-Block Story Bible v2 Prompt...');
        const compiled = compileStoryBiblePrompt({
          segmentId: 'live-test-segment-1',
          segmentIndex: 0,
          totalSegments: 1,
          sourceText: realSourceText,
          bible,
          genreProfile: PERIOD_GENRE_PROFILE,
          sceneState: 'normal',
        });

        console.log('\n--- COMPILED PROMPT SUMMARY ---');
        console.log('- Độ dài prompt:', compiled.characterCount, 'ký tự');
        console.log('- Các nhân vật được phát hiện:', compiled.presentEntities.map((e) => e.vi).join(', '));
        console.log('- Thuật ngữ niên đại được ghim:', compiled.matchedGlossaryTerms.map((t) => `${t.chinese}->${t.vietnamese}`).join(', '));
        console.log('- Nguồn đã khóa tên cơ học (Khối G):\n', compiled.lockedSourceText);

        expect(compiled.lockedSourceText).toContain('⟦Cố Quốc Cường⟧');
        expect(compiled.lockedSourceText).toContain('⟦Thẩm Ngọc Lan⟧');
        expect(compiled.lockedSourceText).toContain('⟦Cố Cẩn Thư⟧');
        expect(compiled.matchedGlossaryTerms.map((t) => t.chinese)).toContain('生产队');
        expect(compiled.matchedGlossaryTerms.map((t) => t.chinese)).toContain('大队');
        expect(compiled.matchedGlossaryTerms.map((t) => t.chinese)).toContain('供销社');
        expect(compiled.matchedGlossaryTerms.map((t) => t.chinese)).toContain('工分');

        console.log('\n[LIVE TEST] 7. Sending prompt live to ChatGPT Web and waiting for streaming completion...');
        const startTime = Date.now();
        rawAiResponse = await adapter.sendAndWait(compiled.fullPrompt, {
          timeoutMs: 180_000,
        });
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[LIVE TEST] 8. Received live response from ChatGPT in ${durationSec}s!`);
        console.log('\n--- RAW CHATGPT RESPONSE ---\n', rawAiResponse);

        expect(rawAiResponse.trim().length).toBeGreaterThan(0);

        console.log('\n[LIVE TEST] 9. Validating and Sanitizing response...');
        cleanedTranslation = sanitizeTranslationResponse(realSourceText, rawAiResponse);
        console.log('\n--- SANITIZED TRANSLATION (UNWRAPPED) ---\n', cleanedTranslation);

        // Verify that brackets were cleanly removed
        expect(cleanedTranslation).not.toContain('⟦');
        expect(cleanedTranslation).not.toContain('⟧');

        // Verify that character names are fully intact in Vietnamese
        expect(cleanedTranslation).toContain('Cố Quốc Cường');
        expect(cleanedTranslation).toContain('Thẩm Ngọc Lan');
        expect(cleanedTranslation).toContain('Cố Cẩn Thư');

        // Verify no stray Han remained
        const validation = validateTranslation(realSourceText, cleanedTranslation, {
          requireNoHan: true,
        });
        console.log('[LIVE TEST]    Validation issues count:', validation.issues.length);
        expect(validation.issues.filter((i) => i.severity === 'error')).toHaveLength(0);

        console.log('[LIVE TEST] 10. Testing Story Memory auto-extraction on real translated text...');
        const extracted = autoExtractStoryMemory(realSourceText, cleanedTranslation, {
          genre: 'period',
        });
        console.log('[LIVE TEST]     Extracted entities:', extracted.entities.map((e) => `${e.chinese} -> ${e.vietnamese}`));

        translationSucceeded = true;
      } finally {
        console.log('\n[LIVE TEST] 11. Cleaning up live conversation in ChatGPT Web...');
        await adapter.startNewConversation().catch(() => {});
        await adapter.close().catch(() => {});
        await rm(userData, { recursive: true, force: true }).catch(() => {});
        console.log('[LIVE TEST] 12. Test completed & cleaned up safely.');
      }

      expect(translationSucceeded).toBe(true);
    },
  );
});
