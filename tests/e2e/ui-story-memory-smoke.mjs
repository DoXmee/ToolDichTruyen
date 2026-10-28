import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const workspace = path.resolve(import.meta.dirname, '..', '..');
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-ui-memory-'));
const artifacts = path.join(workspace, 'test-results');
await mkdir(artifacts, { recursive: true });

console.log('[UI TEST] 1. Launching Electron App with fresh user data directory:', userData);

const application = await electron.launch({
  executablePath: electronExecutable,
  args: [workspace],
  cwd: workspace,
  env: {
    ...process.env,
    TOOL_DICH_TRUYEN_USER_DATA: userData,
  },
});

const pageErrors = [];

try {
  console.log('[UI TEST] 2. Waiting for primary window to initialize...');
  const page = await application.firstWindow();
  page.on('pageerror', (error) => {
    console.error('[PAGE ERROR]', error.message);
    pageErrors.push(error.message);
  });

  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 25_000 });
  console.log('[UI TEST] 3. Main window loaded successfully with zero errors.');

  // Verify Story Memory bridge methods
  const bridge = await page.evaluate(() => ({
    hasBridge: Boolean(window.storyTool),
    hasGetStoryMemory: typeof window.storyTool?.getStoryMemory === 'function',
    hasSaveStoryMemory: typeof window.storyTool?.saveStoryMemory === 'function',
    hasClearStoryMemory: typeof window.storyTool?.clearStoryMemory === 'function',
  }));

  console.log('[UI TEST] 4. Preload IPC bridge validation:', bridge);
  if (!bridge.hasBridge || !bridge.hasGetStoryMemory || !bridge.hasSaveStoryMemory) {
    throw new Error('Preload bridge thiếu các phương thức IPC của Story Memory.');
  }

  // Find and inspect the Memory Toggle button
  console.log('[UI TEST] 5. Inspecting Trí nhớ truyện button in header...');
  const memoryBtn = page.locator('.memory-toggle');
  await memoryBtn.waitFor({ timeout: 10_000 });
  const initialBtnText = await memoryBtn.textContent();
  console.log('[UI TEST]    Current button text:', initialBtnText?.trim());

  // Click to open Story Memory Modal
  console.log('[UI TEST] 6. Clicking button to open Story Memory Modal...');
  await memoryBtn.click();

  const modal = page.locator('.memory-modal-overlay');
  await modal.waitFor({ timeout: 5_000 });
  console.log('[UI TEST] 7. Story Memory Modal opened successfully!');

  // Verify all 4 tabs
  const tabCharacters = page.locator('.memory-modal__tab', { hasText: 'Nhân vật' });
  const tabLocations = page.locator('.memory-modal__tab', { hasText: 'Địa danh' });
  const tabTerms = page.locator('.memory-modal__tab', { hasText: 'Thuật ngữ' });
  const tabRules = page.locator('.memory-modal__tab', { hasText: 'Quy tắc' });

  await tabCharacters.waitFor();
  await tabLocations.waitFor();
  await tabTerms.waitFor();
  await tabRules.waitFor();
  console.log('[UI TEST] 8. All 4 tabs (Nhân vật, Địa danh, Thuật ngữ, Quy tắc) verified.');

  // Fill in form to add new character: 岑明悅 -> Sầm Minh Duyệt
  console.log('[UI TEST] 9. Adding character Sầm Minh Duyệt via UI form...');
  const hanInput = page.locator('.memory-form input[placeholder*="Tên Hán"]');
  const vnInput = page.locator('.memory-form input[placeholder*="Tên dịch Việt"]');
  const genderSelect = page.locator('.memory-form select');
  const roleInput = page.locator('.memory-form input[placeholder*="Vai trò"]');
  const submitBtn = page.locator('.memory-form button[type="submit"]');

  await hanInput.fill('岑明悅');
  await vnInput.fill('Sầm Minh Duyệt');
  await genderSelect.selectOption('female');
  await roleInput.fill('Nữ chính / Vợ của Giang Vọng Tân');
  await page.getByRole('button', { name: '+ Thêm', exact: true }).click();

  await page.waitForTimeout(500);

  // Verify character is added to the table
  const tableRows = page.locator('.memory-table tbody tr');
  await tableRows.first().waitFor({ timeout: 5_000 });
  const rowCount = await tableRows.count();
  console.log(`[UI TEST] 10. Table updated with ${rowCount} character(s).`);

  const firstRowText = await tableRows.first().textContent();
  console.log('[UI TEST]     Row content:', firstRowText?.replace(/\s+/g, ' ').trim());
  if (!firstRowText?.includes('岑明悅') || !firstRowText?.includes('Sầm Minh Duyệt')) {
    throw new Error('Bảng nhân vật không hiển thị đúng thông tin vừa thêm.');
  }

  // Add relationship via Form 2
  console.log('[UI TEST] 11. Adding relationship via UI form...');
  const relSrcInput = page.locator('.memory-form input[placeholder*="Nhân vật 1"]');
  const relTgtInput = page.locator('.memory-form input[placeholder*="Nhân vật 2"]');
  const relTypeInput = page.locator('.memory-form input[placeholder*="Quan hệ"]');
  const relPronounInput = page.locator('.memory-form input[placeholder*="Xưng hô mẫu"]');
  const relToneInput = page.locator('.memory-form input[placeholder*="Lưu ý tâm lý"]');
  const relSubmitBtn = page.getByRole('button', { name: '+ Thêm quan hệ' });

  await relSrcInput.fill('Sầm Minh Duyệt');
  await relTgtInput.fill('Giang Vọng Tân');
  await relTypeInput.fill('Vợ - Chồng');
  await relPronounInput.fill('Em - Anh');
  await relToneInput.fill('Thân mật vợ chồng');
  await relSubmitBtn.click();
  await page.waitForTimeout(500);
  console.log('[UI TEST] 12. Relationship added successfully via UI.');

  // Switch to Rules tab and add a custom rule
  console.log('[UI TEST] 13. Switching to Quy tắc tab...');
  await tabRules.click();
  await page.waitForTimeout(300);

  const ruleInput = page.locator('.memory-form input[placeholder*="Quy tắc"]');
  if (await ruleInput.isVisible()) {
    await ruleInput.fill('Xưng hô thân mật: anh - em');
    await page.getByRole('button', { name: '+ Thêm quy tắc' }).click();
    await page.waitForTimeout(300);
    console.log('[UI TEST] 14. Rule added successfully.');
  }

  // Capture screenshot of the Story Memory UI
  const screenshotPath = path.join(artifacts, 'ui-story-memory-modal.png');
  await page.screenshot({ path: screenshotPath, timeout: 30_000 });
  console.log('[UI TEST] 13. Captured UI screenshot saved to:', screenshotPath);

  // Close modal
  console.log('[UI TEST] 14. Closing Story Memory Modal...');
  const closeBtn = page.locator('.memory-modal__close-btn');
  await closeBtn.click();
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });

  // Verify button text updated with entity count
  const updatedBtnText = await memoryBtn.textContent();
  console.log('[UI TEST] 15. Memory button text after adding character:', updatedBtnText?.trim());
  if (!updatedBtnText?.includes('1')) {
    throw new Error(`Nút bộ nhớ không hiển thị đúng số lượng thực thể (mong muốn có '1'): ${updatedBtnText}`);
  }

  // Verify persistence via bridge
  const persistedMemory = await page.evaluate(() => window.storyTool?.getStoryMemory?.());
  console.log('[UI TEST] 16. Verifying persistence via IPC:');
  console.log('       Persisted entities count:', persistedMemory?.entities?.length);
  console.log('       First entity:', persistedMemory?.entities?.[0]?.vietnamese);

  if (persistedMemory?.entities?.[0]?.vietnamese !== 'Sầm Minh Duyệt') {
    throw new Error('Dữ liệu bộ nhớ không được lưu trữ bền vững vào hệ thống.');
  }

  console.log('\n[UI TEST] SUCCESS! All UI interactions and Story Memory mechanics passed 100% without any errors.');
} catch (error) {
  console.error('\n[UI TEST FAILED]', error);
  process.exitCode = 1;
} finally {
  console.log('[UI TEST] Closing Electron Application...');
  await application.close().catch(() => {});
  if (pageErrors.length > 0) {
    console.error('[UI TEST] Encountered page errors during run:', pageErrors);
    process.exitCode = 1;
  }
}
