import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = process.env.TOOL_DICH_TRUYEN_REAL_USER_DATA
  || path.join(process.env.APPDATA || '', 'tool-dich-truyen')
const artifacts = path.join(workspace, 'test-results')
await mkdir(artifacts, { recursive: true })

const application = await electron.launch({
  executablePath: electronExecutable,
  args: [workspace],
  cwd: workspace,
  env: {
    ...process.env,
    TOOL_DICH_TRUYEN_USER_DATA: userData,
  },
})

try {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1366, 760))

  await page.getByRole('radio', { name: 'DeepSeek AI' }).click()
  await page.waitForFunction(() =>
    document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes('DeepSeek AI'),
  )
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: /Tài khoản/u }).click()
  await page.getByRole('dialog', { name: 'Tài khoản đã lưu' }).waitFor({ timeout: 10_000 })
  const targetAccountId = await page.evaluate(async () => {
    const snapshot = await window.storyTool.listAccounts()
    return snapshot.accounts.find((account) =>
      account.provider === 'deepseek' && /[\\/]accounts[\\/]/iu.test(account.profileDirectory))?.id
      ?? snapshot.accounts.find((account) =>
        account.provider === 'deepseek' && /^Tài khoản \d+$/u.test(account.label))?.id
  })
  if (targetAccountId) {
    await page.evaluate((id) => window.storyTool.selectAccount(id), targetAccountId)
    await page.waitForFunction((id) =>
      window.storyTool.listAccounts().then((snapshot) => snapshot.activeAccountId === id),
      targetAccountId,
      { timeout: 20_000 },
    )
  }
  const before = await page.evaluate(async () => {
    const snapshot = await window.storyTool.listAccounts()
    const accounts = snapshot.accounts.filter((account) => account.provider === 'deepseek')
    return {
      activeAccountId: snapshot.activeAccountId,
      stamps: accounts.map((account) => `${account.id}:${account.label}:${account.lastVerifiedAt ?? ''}`),
    }
  })
  await page.screenshot({ path: path.join(artifacts, 'deepseek-account-before-check.png') })

  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
  await page.waitForFunction(() =>
    document.body.innerText.includes('Đang mở DeepSeek AI')
    || document.body.innerText.includes('DeepSeek AI đã kết nối')
    || document.body.innerText.includes('Chờ đăng nhập DeepSeek AI')
    || document.body.innerText.includes('Kết nối có lỗi'),
    undefined,
    { timeout: 20_000 },
  ).catch(() => undefined)
  await page.waitForTimeout(30_000)

  const result = await page.evaluate(async () => ({
    provider: await window.storyTool.getAiProvider(),
    status: document.querySelector('.connection-box')?.textContent ?? '',
    notice: document.querySelector('.app-notice')?.textContent ?? '',
    panel: document.querySelector('.account-panel')?.textContent ?? '',
    accounts: await window.storyTool.listAccounts(),
  }))
  await page.screenshot({ path: path.join(artifacts, 'deepseek-account-after-check.png') })

  const deepseekAccounts = result.accounts.accounts.filter((account) => account.provider === 'deepseek')
  const active = deepseekAccounts.find((account) => account.id === result.accounts.activeAccountId)
    ?? deepseekAccounts.find((account) => account.lastVerifiedAt)
  const problems = []
  if (!result.status.includes('DeepSeek AI đã kết nối')) {
    problems.push(`DeepSeek chưa ready sau Kiểm tra kết nối: ${result.status} ${result.notice}`)
  }
  if (!active?.lastVerifiedAt) {
    problems.push(`DeepSeek chưa có lastVerifiedAt: ${JSON.stringify(deepseekAccounts)}`)
  }
  if (!active?.label || /^Tài khoản \d+$/u.test(active.label)) {
    problems.push(`DeepSeek chưa đọc được tên account: ${JSON.stringify(active)}`)
  }
  if (/^DeepSeek AI$/iu.test(active?.label ?? '')) {
    problems.push(`DeepSeek chỉ lưu nhãn mặc định, chưa đọc được tên account: ${JSON.stringify(active)}`)
  }
  if (/__|appkit|storage|\/chat_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(active?.label ?? '')) {
    problems.push(`DeepSeek đọc nhầm tên nội bộ thay vì tên account: ${JSON.stringify(active)}`)
  }
  if (/chào buổi sáng|bắt đầu trò chuyện|suy nghĩ sâu|tìm kiếm thông minh/iu.test(active?.label ?? '')) {
    problems.push(`DeepSeek đọc nhầm text ô nhập thay vì tên account: ${JSON.stringify(active)}`)
  }
  if (/trò chuyện mới|hôm qua|\b7 ngày\b|\b30 ngày\b/iu.test(active?.label ?? '')) {
    problems.push(`DeepSeek đọc nhầm text điều hướng thay vì tên account: ${JSON.stringify(active)}`)
  }
  if (!result.panel.includes('Đang hoạt động')) {
    problems.push(`Panel chưa hiện Đang hoạt động: ${result.panel}`)
  }

  const output = {
    ok: problems.length === 0,
    userData,
    ...result,
    active,
    screenshots: [
      path.join(artifacts, 'deepseek-account-before-check.png'),
      path.join(artifacts, 'deepseek-account-after-check.png'),
    ],
    problems,
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (problems.length) throw new Error(problems.join('\n'))
} finally {
  await application.close().catch(() => undefined)
}
