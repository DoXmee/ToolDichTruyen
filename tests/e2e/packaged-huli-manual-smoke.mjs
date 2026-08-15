import { execFile } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright-core'

const execFileAsync = promisify(execFile)
const executable = process.argv[2]
if (!executable) throw new Error('Cần truyền đường dẫn ToolDichTruyen.exe đã đóng gói.')

// electron-builder extraFiles puts the unpacked extension beside the Windows executable.
// Keep this assertion in the packaged smoke test so a future config change cannot hide it
// below resources again.
const helperDirectory = path.join(path.dirname(path.resolve(executable)), 'Huli Browser Helper')
await access(path.join(helperDirectory, 'manifest.json'))

const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-huli-manual-'))
const sourceProfile = path.join(userData, 'story-source-browser-profile')
const application = await electron.launch({
  executablePath: path.resolve(executable),
  env: { ...process.env, TOOL_DICH_TRUYEN_USER_DATA: userData },
})

async function sourceBrowserProcesses() {
  const escaped = sourceProfile.replaceAll("'", "''")
  const script = [
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -in @('msedge.exe','chrome.exe') -and",
    `  $_.CommandLine -like '*${escaped}*'`,
    '}',
    '@($items | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress',
  ].join('\n')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
  })
  const text = stdout.trim()
  if (!text) return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

try {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('tab', { name: 'Nhập link truyện' }).click()
  await page.getByLabel('Link bộ truyện hoặc chương truyện').fill(
    'https://m.huliwang.net/1703891/1.html',
  )
  await page.getByRole('button', { name: /^Phân tích$/u }).click()

  const connectButton = page.getByRole('button', { name: 'Kết nối trình duyệt mặc định' })
  await connectButton.waitFor({ timeout: 75_000 })
  const afterChallenge = await sourceBrowserProcesses()
  if (afterChallenge.length !== 0) {
    throw new Error(`Phiên Playwright nguồn chưa đóng sau Cloudflare: ${JSON.stringify(afterChallenge)}`)
  }

  await page.getByRole('button', { name: 'Mở thư mục tiện ích' }).waitFor()
  await page.getByRole('button', { name: 'Chuyển sang Dán nội dung' }).waitFor()
  const bridgeMethods = await page.evaluate(() => ({
    open: typeof window.storyTool?.openManualStoryVerification,
    reveal: typeof window.storyTool?.revealHuliBrowserHelper,
  }))
  if (bridgeMethods.open !== 'function' || bridgeMethods.reveal !== 'function') {
    throw new Error(`Thiếu API companion trong preload: ${JSON.stringify(bridgeMethods)}`)
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    url: 'https://m.huliwang.net/1703891/1.html',
    botClosedBeforeManualAction: true,
    botProfileProcessesAfterChallenge: 0,
    defaultBrowserCompanionUiAvailable: true,
    helperRevealUiAvailable: true,
    helperDirectory,
  }, null, 2))
} finally {
  await application.close().catch(() => undefined)
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}
