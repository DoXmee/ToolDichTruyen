import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-chatgpt-login-ui-'))
const profileDirectory = path.join(userData, 'chatgpt-browser-profile')
const artifacts = path.join(workspace, 'test-results')
await mkdir(artifacts, { recursive: true })

function psJson(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        const text = stdout.trim()
        if (!text) {
          resolve([])
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (parseError) {
          reject(new Error(`Không đọc được JSON PowerShell: ${text}`, { cause: parseError }))
        }
      },
    )
  })
}

async function browserRootsForProfile() {
  const escaped = profileDirectory.replace(/'/g, "''")
  return psJson(`
    $items = Get-CimInstance Win32_Process |
      Where-Object {
        $_.CommandLine -like '*--user-data-dir=${escaped}*' -and
        $_.CommandLine -like '*--new-window*'
      } |
      Select-Object ProcessId, CommandLine
    @($items) | ConvertTo-Json -Compress
  `)
}

async function waitForBrowserRoot() {
  const deadline = Date.now() + 30_000
  let roots = []
  do {
    roots = await browserRootsForProfile()
    if (roots.length > 0) return roots
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (Date.now() < deadline)
  throw new Error('Không thấy cửa sổ browser đăng nhập thủ công của ChatGPT được mở.')
}

async function cleanupProfileBrowsers() {
  const escaped = profileDirectory.replace(/'/g, "''")
  await psJson(`
    Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -like '*--user-data-dir=${escaped}*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    @() | ConvertTo-Json -Compress
  `).catch(() => undefined)
}

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
  await page.evaluate(() => window.storyTool?.setAiProvider?.('chatgpt'))
  await page.waitForFunction(() => window.storyTool?.getAiProvider?.().then((provider) => provider === 'chatgpt'))

  await page.getByRole('button', { name: /Tài khoản/u }).click()
  await page.getByRole('dialog', { name: 'Tài khoản đã lưu' }).waitFor({ timeout: 10_000 })
  const connectButton = page.getByRole('button', { name: 'Kiểm tra kết nối' })
  await connectButton.click()
  const firstRoots = await waitForBrowserRoot()
  const firstRootIds = new Set(firstRoots.map((item) => item.ProcessId))

  await page.waitForTimeout(1_500)
  await connectButton.click()
  await page.waitForTimeout(3_000)
  const secondRoots = await browserRootsForProfile()
  const secondRootIds = new Set(secondRoots.map((item) => item.ProcessId))
  const stillHasFirstWindow = [...firstRootIds].some((id) => secondRootIds.has(id))
  const allCommandLines = [...firstRoots, ...secondRoots].map((item) => item.CommandLine || '').join('\n')
  const statusText = await page.locator('.connection-box').innerText().catch(() => '')

  await page.screenshot({ path: path.join(artifacts, 'chatgpt-manual-login-ui-check.png') })

  if (!stillHasFirstWindow) {
    throw new Error(
      `Bấm Kiểm tra kết nối lần hai đã làm mất cửa sổ login đầu tiên. `
      + `Trước: ${JSON.stringify(firstRoots)} Sau: ${JSON.stringify(secondRoots)}`,
    )
  }
  if (/--remote-debugging-port/i.test(allCommandLines)) {
    throw new Error(`Browser đăng nhập thủ công vẫn bị mở với remote debugging: ${allCommandLines}`)
  }
  if (secondRoots.length > firstRoots.length + 1) {
    throw new Error(
      `Bấm Kiểm tra kết nối lần hai có vẻ mở thêm browser mới. `
      + `Trước: ${JSON.stringify(firstRoots)} Sau: ${JSON.stringify(secondRoots)}`,
    )
  }
  if (!/cửa sổ đó|đăng nhập/i.test(statusText)) {
    throw new Error(`Thông báo UI không hướng người dùng về cửa sổ đang mở: ${statusText}`)
  }

  console.log(JSON.stringify({
    ok: true,
    firstRootIds: [...firstRootIds],
    secondRootIds: [...secondRootIds],
    statusText,
    screenshot: path.join(artifacts, 'chatgpt-manual-login-ui-check.png'),
  }, null, 2))
} finally {
  await application.close().catch(() => undefined)
  await cleanupProfileBrowsers()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}
