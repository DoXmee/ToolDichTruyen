import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatGptWebAdapter } from '../../src/main/chatgpt/ChatGptWebAdapter';
import {
  compileStoryDigestPrompt,
  harvestCharacterContext,
  parseStoryDigestResponse,
  scanBookForEntities,
} from '../../src/core/storyDigestScanner';

describe('Story Digest Scanner LIVE Real Execution with ChatGPT Web', () => {
  it(
    'executes real live extraction of characters and relationships using real book data with ChatGPT Web',
    { timeout: 300_000 },
    async () => {
      const realJobPath = path.join(
        process.env.APPDATA || '',
        'tool-dich-truyen',
        'jobs',
        '9fc7daeb-455b-4ed1-8912-3c38914df286.json',
      );
      const rawJob = await readFile(realJobPath, 'utf8');
      const job = JSON.parse(rawJob);

      const chapters = job.segments.map((s: { index: number; sourceText: string }) => ({
        index: s.index,
        sourceText: s.sourceText,
      }));

      // 1. Scan & Harvest from real 261 chapters
      console.log('\n[LIVE DIGEST TEST] 1. Scanning real 261 chapters for entity candidates...');
      const candidates = scanBookForEntities(chapters, { minOccurrences: 3, maxCandidates: 20 });
      console.log(`[LIVE DIGEST TEST] 2. Discovered ${candidates.length} candidates.`);

      const profiles = harvestCharacterContext(chapters, candidates);
      console.log(`[LIVE DIGEST TEST] 3. Context harvested for ${profiles.length} characters.`);

      // 2. Compile prompt for Cluster 1 (Top 8 key characters)
      const topProfiles = profiles.slice(0, 8);
      const prompt = compileStoryDigestPrompt(topProfiles, {
        bookTitle: 'Bộ 38 - Xuyên Sách Thập Niên 60 Thế Thân Chớp Nhoáng Kết Hôn Theo Quân Đội',
        genre: 'period',
        synopsis:
          '1964 năm Thân Thành, Sầm Minh Duyệt xuyên thành nữ phụ thế thân gả thay cho Triệu gia. Giang Vọng Tân là phó doanh trưởng quân đội bị hãm hại. Hai người đăng ký kết hôn rồi cùng theo quân đến vùng Tây Bắc sinh sống.',
        clusterIndex: 1,
        totalClusters: 1,
      });

      console.log('\n--- COMPILED DIGEST PROMPT PREVIEW ---');
      console.log(`Prompt length: ${prompt.length} characters.`);
      console.log('Top characters included:', topProfiles.map((p) => `${p.chinese} (${p.vietnamese})`).join(', '));

      // 3. Setup disposable browser session
      const realProfile = path.join(
        process.env.APPDATA || '',
        'tool-dich-truyen',
        'chatgpt-browser-profile',
      );
      const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-digest-live-'));
      const profile = path.join(userData, 'chatgpt-browser-profile');
      await cp(realProfile, profile, { recursive: true, force: true });

      const adapter = new ChatGptWebAdapter({
        profileDirectory: profile,
        headless: false,
      });

      let liveExtractionSucceeded = false;

      try {
        console.log('\n[LIVE DIGEST TEST] 4. Launching Edge and verifying ChatGPT session...');
        const status = await adapter.openLogin();
        expect(status.status).toBe('ready');

        console.log('[LIVE DIGEST TEST] 5. Starting new conversation in ChatGPT Web...');
        await adapter.startNewConversation();

        console.log('[LIVE DIGEST TEST] 6. Sending Story Digest prompt live to ChatGPT Web...');
        const startTime = Date.now();
        const aiResponse = await adapter.sendAndWait(prompt, { timeoutMs: 180_000 });
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[LIVE DIGEST TEST] 7. Received live response from ChatGPT in ${durationSec}s!`);

        const debugPath = path.join(tmpdir(), 'last_live_response.txt');
        await (await import('node:fs/promises')).writeFile(debugPath, aiResponse, 'utf8');

        console.log('\n--- RAW CHATGPT RESPONSE ---\n', aiResponse.slice(0, 800) + '...');

        console.log('\n[LIVE DIGEST TEST] 8. Parsing and validating AI response...');
        const parsed = parseStoryDigestResponse(aiResponse);

        console.log(`[LIVE DIGEST TEST] Parsed ${parsed.characters.length} characters and ${parsed.relationships.length} relationships.`);
        console.log('Parsed characters:');
        parsed.characters.forEach((c) => {
          console.log(`  - [${c.category}] ${c.chinese} -> ${c.vietnamese} | Gender: ${c.gender} | Role: ${c.role || 'none'} | Pronoun: ${c.narrationPronoun || 'none'}`);
        });

        console.log('Parsed relationships:');
        parsed.relationships.forEach((r) => {
          console.log(`  - ${r.sourceCharacter} <-> ${r.targetCharacter} [${r.relationType}] | Call: ${r.pronounSample}`);
        });

        // Assertions on real AI response
        expect(parsed.characters.length).toBeGreaterThanOrEqual(4);
        expect(parsed.relationships.length).toBeGreaterThanOrEqual(1);

        // Core protagonists must be recognized
        const samChar = parsed.characters.find((c) => c.vietnamese.includes('Sầm Minh Duyệt') || c.chinese.includes('岑明悅'));
        expect(samChar).toBeDefined();

        const giangChar = parsed.characters.find((c) => c.vietnamese.includes('Giang Vọng Tân') || c.chinese.includes('江望津'));
        expect(giangChar).toBeDefined();

        liveExtractionSucceeded = true;
      } finally {
        console.log('\n[LIVE DIGEST TEST] 9. Cleaning up test browser session...');
        await adapter.startNewConversation().catch(() => {});
        await adapter.close().catch(() => {});
        await rm(userData, { recursive: true, force: true }).catch(() => {});
        console.log('[LIVE DIGEST TEST] 10. Cleaned up safely.');
      }

      expect(liveExtractionSucceeded).toBe(true);
    },
  );
});
