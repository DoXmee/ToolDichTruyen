import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileStoryDigestPrompt,
  createCharacterClusters,
  harvestCharacterContext,
  parseStoryDigestResponse,
  scanBookForEntities,
} from '../../src/core/storyDigestScanner';

describe('Story Digest Scanner REAL BOOK Integration Test (261 Chapters)', () => {
  it('scans all 261 chapters of the real novel and extracts complete character profiles & kinship evidence', () => {
    const jobPath = path.join(
      process.env.APPDATA || '',
      'tool-dich-truyen',
      'jobs',
      '9fc7daeb-455b-4ed1-8912-3c38914df286.json',
    );

    expect(fs.existsSync(jobPath)).toBe(true);
    const raw = fs.readFileSync(jobPath, 'utf8');
    const job = JSON.parse(raw);

    const chapters = job.segments.map((s: { index: number; sourceText: string }) => ({
      index: s.index,
      sourceText: s.sourceText,
    }));

    expect(chapters).toHaveLength(261);

    // 1. Scan Book For Entities
    const candidates = scanBookForEntities(chapters, { minOccurrences: 3, maxCandidates: 60 });
    console.log(`\n[REAL BOOK SCAN] Discovered ${candidates.length} candidates across 261 chapters.`);

    const foundZh = candidates.map((c) => c.chinese);

    // Core protagonists and family must be discovered
    expect(foundZh).toContain('岑明悅');
    expect(foundZh).toContain('江望津');
    expect(foundZh).toContain('許寧');
    expect(foundZh).toContain('李靜');
    expect(foundZh).toContain('江邵雲');
    expect(foundZh).toContain('方源');
    expect(foundZh).toContain('劉曉娟');
    expect(foundZh).toContain('鄭梅');
    expect(foundZh).toContain('趙靜蘭');
    expect(foundZh).toContain('譚秋禾');

    const sam = candidates.find((c) => c.chinese === '岑明悅');
    expect(sam?.vietnamese).toBe('Sầm Minh Duyệt');
    expect(sam?.occurrences).toBeGreaterThanOrEqual(100);

    const giang = candidates.find((c) => c.chinese === '江望津');
    expect(giang?.vietnamese).toBe('Giang Vọng Tân');
    expect(giang?.occurrences).toBeGreaterThanOrEqual(100);

    // 2. Harvest Rich Context
    const profiles = harvestCharacterContext(chapters, candidates);
    console.log(`[REAL BOOK SCAN] Context harvested for ${profiles.length} characters.`);

    // Check Hứa Ninh (Mẹ)
    const huaNinh = profiles.find((p) => p.chinese === '許寧');
    expect(huaNinh).toBeDefined();
    expect(huaNinh?.firstAppearanceSnippet).toBeTruthy();
    expect(huaNinh?.kinshipSnippets.length).toBeGreaterThan(0);

    // Check Phương Nguyên & Lưu Hiểu Quyên (Vợ chồng)
    const phuongNguyen = profiles.find((p) => p.chinese === '方源');
    expect(phuongNguyen).toBeDefined();
    const hasVo = phuongNguyen?.kinshipSnippets.some((k) => k.includes('妻子') || k.includes('媳婦'));
    expect(hasVo).toBe(true);

    // Check Trịnh Mai (Mẹ phó doanh trưởng)
    const trinhMai = profiles.find((p) => p.chinese === '鄭梅');
    expect(trinhMai).toBeDefined();
    const hasMother = trinhMai?.kinshipSnippets.some((k) => k.includes('母親') || k.includes('兒子'));
    expect(hasMother).toBe(true);

    // 3. Prompt Compilation
    const prompt = compileStoryDigestPrompt(profiles.slice(0, 15), {
      bookTitle: 'Bộ 38 - Xuyên Sách Thập Niên 60 Thế Thân',
      genre: 'period',
      clusterIndex: 1,
      totalClusters: 2,
    });

    expect(prompt).toContain('岑明悅 -> Sầm Minh Duyệt');
    expect(prompt).toContain('江望津 -> Giang Vọng Tân');
    expect(prompt).toContain('Bằng chứng quan hệ gia đình / thân tộc:');
    expect(prompt.length).toBeGreaterThan(1500);

    // 4. Cluster Grouping
    const clusters = createCharacterClusters(profiles, 15);
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    console.log(`[REAL BOOK SCAN] Success: Generated ${clusters.length} multi-turn clusters.`);
  });
});
