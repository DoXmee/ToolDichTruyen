import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-gemini-add-account-'))
const profileDirectory = path.join(userData, 'accounts')
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

async function rootsForAccountProfiles() {
  const escaped = profileDirectory.replace(/'/g, "''")
  return psJson(`
    $items = Get-CimInstance Win32_Process |
      Where-Object {
        $_.CommandLine -like '*--user-data-dir=${escaped}*' -and
        $_.CommandLine -notlike '*--type=*'
      } |
      Select-Object ProcessId, Name, CommandLine
    @($items) | ConvertTo-Json -Compress
  `)
}

async function cleanupBrowsers() {
  const escaped = userData.replace(/'/g, "''")
  await psJson(`
    Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -like '*--user-data-dir=${escaped}*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    @() | ConvertTo-Json -Compress
  `).catch(() => undefined)
}

async function stopProcesses(ids) {
  if (!ids.length) return
  const idList = ids.map((id) => Number(id)).filter(Number.isInteger).join(',')
  if (!idList) return
  await psJson(`
    foreach ($id in @(${idList})) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
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
  await page.evaluate(() => window.storyTool?.setAiProvider?.('gemini'))
  await page.waitForFunction(() => window.storyTool?.getAiProvider?.().then((provider) => provider === 'gemini'))
  const beforeAccounts = await page.evaluate(() => window.storyTool?.listAccounts?.())

  await page.getByRole('button', { name: /Tài khoản/u }).click()
  await page.getByRole('dialog', { name: 'Tài khoản đã lưu' }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: /Thêm tài khoản/u }).click()
  const afterAddAccounts = await page.evaluate(() => window.storyTool?.listAccounts?.())
  if ((afterAddAccounts?.accounts?.length ?? 0) !== (beforeAccounts?.accounts?.length ?? 0)) {
    throw new Error(`Thêm Gemini đã tạo account trước khi xác minh: ${JSON.stringify({ beforeAccounts, afterAddAccounts })}`)
  }

  const samples = []
  const deadline = Date.now() + 8_000
  do {
    const roots = await rootsForAccountProfiles()
    samples.push(...(Array.isArray(roots) ? roots : [roots]))
    if (samples.length > 0) break
    await page.waitForTimeout(250)
  } while (Date.now() < deadline)

  await page.screenshot({ path: path.join(artifacts, 'gemini-add-account-new-profile-check.png') })

  if (samples.length === 0) {
    throw new Error('Không thấy browser đăng nhập Gemini được mở khi bấm Thêm tài khoản.')
  }
  const badRoots = samples.filter((item) =>
    !/--new-window/i.test(item.CommandLine || '')
    || /gemini-browser-profile/i.test(item.CommandLine || '')
    || !/[\\/]accounts[\\/]gemini-/i.test(item.CommandLine || '')
    || /--remote-debugging-port|--remote-debugging-pipe/i.test(item.CommandLine || ''),
  )
  if (badRoots.length) {
    throw new Error(`Gemini Thêm tài khoản không mở profile mới riêng: ${JSON.stringify(badRoots)}`)
  }

  await stopProcesses(samples.map((item) => item.ProcessId))
  await page.waitForTimeout(6_000)
  const afterCloseAccounts = await page.evaluate(() => window.storyTool?.listAccounts?.())
  if ((afterCloseAccounts?.accounts?.length ?? 0) !== (beforeAccounts?.accounts?.length ?? 0)) {
    throw new Error(`Đóng cửa sổ Gemini chưa đăng nhập vẫn tạo account: ${JSON.stringify({ beforeAccounts, afterCloseAccounts })}`)
  }

  console.log(JSON.stringify({
    ok: true,
    roots: samples,
    beforeAccounts,
    afterAddAccounts,
    afterCloseAccounts,
    screenshot: path.join(artifacts, 'gemini-add-account-new-profile-check.png'),
  }, null, 2))
} finally {
  await application.close().catch(() => undefined)
  await cleanupBrowsers()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}
