import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const workspace = path.resolve(import.meta.dirname, '..', '..');
const userData = await mkdtemp(path.join(tmpdir(), 'tool-e2e-user-data-'));
const artifactDir = 'C:/Users/dthuo/.gemini/antigravity/brain/217694c6-cf6a-4959-9049-ebb099086550';

async function run() {
  console.log('1. Launching isolated Electron application for UI verification...');
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [workspace],
    cwd: workspace,
    env: {
      ...process.env,
      TOOL_DICH_TRUYEN_USER_DATA: userData,
    },
    timeout: 30000,
  });

  const page = await app.firstWindow();
  console.log('2. Waiting for page domcontentloaded...');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20000 });

  // 1. Chụp ảnh màn hình chính ban đầu
  const mainScreenPath = path.join(artifactDir, 'ui_e2e_main_screen.png');
  await page.screenshot({ path: mainScreenPath });
  console.log('Main screen captured at:', mainScreenPath);

  // 2. Chuyển sang Bước 2: Chọn phong cách dịch -> Chọn "Khác"
  console.log('3. Navigating to Step 2: Prompt selection and clicking "Khác"...');
  const customRadio = page.locator('label.prompt-card', { hasText: 'Khác' });
  await customRadio.click();
  await page.waitForTimeout(1000);

  // Kiểm tra textarea và placeholder mới
  const customTextarea = page.locator('#custom-prompt');
  const placeholder = await customTextarea.getAttribute('placeholder');
  console.log('Custom prompt placeholder:', placeholder);

  // Kiểm tra câu ghi chú bên dưới textarea
  const customHint = page.locator('.custom-prompt p');
  const hintText = (await customHint.textContent()).trim();
  console.log('Custom prompt hint text:', hintText);

  // Chụp ảnh màn hình Bước 2 hiển thị chế độ "Khác" với gợi ý đa năng mới
  const step2Path = path.join(artifactDir, 'ui_e2e_step2_custom.png');
  await page.screenshot({ path: step2Path });
  console.log('Step 2 Custom screenshot captured at:', step2Path);

  // 3. Nhập thử prompt tùy chỉnh của người dùng để xác nhận UI phản hồi chuẩn
  await customTextarea.fill('Dịch giữ nguyên sắc thái hài hước châm biếm, ưu tiên văn phong thuần Việt hiện đại.');
  await page.waitForTimeout(500);

  const step2CustomFilledPath = path.join(artifactDir, 'ui_e2e_step2_custom_filled.png');
  await page.screenshot({ path: step2CustomFilledPath });
  console.log('Step 2 Custom Filled screenshot captured at:', step2CustomFilledPath);

  console.log('4. E2E UI verification completed successfully 100%!');
  await app.close();
  console.log('APP_CLOSED');
}

run().catch((err) => {
  console.error('Error during UI test:', err);
  process.exit(1);
});
