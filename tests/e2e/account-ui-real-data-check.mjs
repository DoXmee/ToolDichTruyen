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

  const initial = await page.evaluate(async () => ({
    provider: await window.storyTool.getAiProvider(),
    accounts: await window.storyTool.listAccounts(),
  }))

  await page.getByRole('radio', { name: 'Gemini AI' }).click()
  await page.waitForFunction(() =>
    document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes('Gemini AI'),
  )
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: /Tài khoản/u }).click()
  await page.getByRole('dialog', { name: 'Tài khoản đã lưu' }).waitFor()
  const panelBeforeCheck = await page.locator('.account-panel').innerText()
  const statusBeforeCheck = await page.locator('.connection-box').innerText()
  const headerText = await page.locator('.app-header').innerText()
  await page.screenshot({ path: path.join(artifacts, 'account-ui-real-gemini-before-check.png') })

  const problems = []
  if (!statusBeforeCheck.includes('Gemini AI đã kết nối')) {
    problems.push(`Header không coi Gemini verified là đã kết nối: ${statusBeforeCheck}`)
  }
  if (!panelBeforeCheck.includes('Thành Đông') && !panelBeforeCheck.includes('tdongg3072@gmail.com')) {
    problems.push(`Panel không hiện account Gemini thật: ${panelBeforeCheck}`)
  }
  if (!panelBeforeCheck.includes('Đang hoạt động')) {
    problems.push(`Panel không hiện tag Đang hoạt động: ${panelBeforeCheck}`)
  }
  if (!headerText.includes('Gemini AI') || !headerText.match(/Gemini AI\s+1/u)) {
    problems.push(`Header không hiện badge account hoạt động cho Gemini: ${headerText}`)
  }

  let checkResult = undefined
  try {
    await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
    await page.waitForFunction(() =>
      document.body.innerText.includes('Gemini AI đã kết nối')
      || document.body.innerText.includes('Chờ đăng nhập Gemini AI')
      || document.body.innerText.includes('Kết nối có lỗi'),
      undefined,
      { timeout: 120_000 },
    )
    await page.waitForTimeout(500)
    checkResult = {
      status: await page.locator('.connection-box').innerText(),
      panel: await page.locator('.account-panel').innerText().catch(() => ''),
      notice: await page.locator('.app-notice').innerText().catch(() => ''),
      accounts: await page.evaluate(() => window.storyTool.listAccounts()),
    }
    await page.screenshot({ path: path.join(artifacts, 'account-ui-real-gemini-after-check.png') })
    if (!checkResult.status.includes('Gemini AI đã kết nối')) {
      problems.push(`Sau Kiểm tra kết nối, Gemini không ready: ${checkResult.status} ${checkResult.notice}`)
    }
    const gemini = checkResult.accounts.accounts.find((account) => account.provider === 'gemini')
    if (!gemini?.lastVerifiedAt) {
      problems.push(`Sau Kiểm tra kết nối, account Gemini chưa có lastVerifiedAt: ${JSON.stringify(gemini)}`)
    }
  } catch (error) {
    checkResult = {
      error: error instanceof Error ? error.message : String(error),
      status: await page.locator('.connection-box').innerText().catch(() => ''),
      notice: await page.locator('.app-notice').innerText().catch(() => ''),
    }
    problems.push(`Thao tác Kiểm tra kết nối lỗi: ${JSON.stringify(checkResult)}`)
  }

  const result = {
    ok: problems.length === 0,
    userData,
    initial,
    statusBeforeCheck,
    panelBeforeCheck,
    checkResult,
    screenshots: [
      path.join(artifacts, 'account-ui-real-gemini-before-check.png'),
      path.join(artifacts, 'account-ui-real-gemini-after-check.png'),
    ],
    problems,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (problems.length) throw new Error(problems.join('\n'))
} finally {
  await application.close().catch(() => undefined)
}
