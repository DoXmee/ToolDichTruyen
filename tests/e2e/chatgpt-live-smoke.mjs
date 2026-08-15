import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-live-'))
const ownershipStatePath = path.join(userData, 'chatgpt-tool-conversation.json')
const seedProfile = process.env.TOOL_DICH_TRUYEN_SEED_PROFILE?.trim()

async function readOwnershipState() {
  let state
  try {
    state = JSON.parse(await readFile(ownershipStatePath, 'utf8'))
  } catch (error) {
    throw new Error(`Không đọc được state sở hữu chat live tại ${ownershipStatePath}.`, {
      cause: error,
    })
  }
  if (!state || state.version !== 3 || !Object.hasOwn(state, 'conversation')) {
    throw new Error('State sở hữu chat live không phải định dạng fail-safe v3.')
  }
  return state
}

async function cleanupOwnedLiveConversation(page) {
  await page.evaluate(async () => {
    const tool = window.storyTool
    if (!tool?.cleanupToolChat) throw new Error('Preload bridge thiếu cleanupToolChat.')

    // A failed UI assertion can leave a translation request streaming. Cancel
    // it and wait for the adapter to become ready before exact-owned cleanup.
    const jobs = await tool.getActiveTranslations()
    for (const job of jobs) {
      if (!['completed', 'cancelled'].includes(job.status)) {
        // Cancellation is persisted before the adapter reports whether the
        // current ChatGPT Stop button could be confirmed. Cleanup below
        // reopens and verifies the exact owned conversation, so a stop warning
        // must not prevent that safe deletion attempt.
        await tool.cancelTranslation(job.id).catch(() => undefined)
      }
    }

    let status
    const deadline = Date.now() + 20_000
    do {
      status = await tool.getChatGPTStatus()
      if (status.status === 'ready') break
      await new Promise((resolve) => setTimeout(resolve, 250))
    } while (Date.now() < deadline)
    if (status?.status !== 'ready') {
      throw new Error(`ChatGPT không sẵn sàng để cleanup: ${status?.message || status?.status || 'unknown'}`)
    }
  })

  const before = await readOwnershipState()
  if (!before.conversation) {
    throw new Error('Live smoke đã có thể gửi prompt nhưng không còn state sở hữu để xóa an toàn.')
  }

  await page.evaluate(async () => window.storyTool.cleanupToolChat())

  const after = await readOwnershipState()
  if (after.conversation !== null) {
    throw new Error('Adapter không clear state sau khi xác minh và xóa chat live.')
  }
}

// Authenticated smoke tests must never use the real application data folder:
// the renderer edits its draft while exercising the UI. Copy only the browser
// profile into a disposable user-data directory so cookies can be verified
// without changing the user's saved story or checkpoints.
let application
let page
let result
let primaryError
let cleanupError
let closeError
let translationMayHaveSubmitted = false
const translationSnapshots = []

try {
  if (seedProfile) {
    await cp(seedProfile, path.join(userData, 'chatgpt-browser-profile'), {
      recursive: true,
      force: true,
    })
  }

  application = await electron.launch({
    executablePath: electronExecutable,
    args: [workspace],
    cwd: workspace,
    env: {
      ...process.env,
      TOOL_DICH_TRUYEN_USER_DATA: userData,
    },
  })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Kết nối', exact: true }).click()

  await page.waitForFunction(
    () => document.body.innerText.includes('ChatGPT đã kết nối')
      || document.body.innerText.includes('Chờ đăng nhập ChatGPT')
      || document.body.innerText.includes('Kết nối có lỗi'),
    undefined,
    { timeout: 60_000 },
  )

  const statusText = await page.locator('.connection-box').innerText()
  if (statusText.includes('Kết nối có lỗi')) {
    throw new Error(`Không mở được ChatGPT Web: ${statusText}`)
  }

  if (statusText.includes('Chờ đăng nhập ChatGPT')) {
    await page.waitForFunction(
      () => document.body.innerText.includes('cửa sổ Edge bình thường')
        && document.body.innerText.includes('ĐÓNG cửa sổ Edge'),
      undefined,
      { timeout: 30_000 },
    )
    await page.waitForTimeout(750)
    const escapedProfile = path.join(userData, 'chatgpt-browser-profile').replaceAll("'", "''")
    const browserCommandLines = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like '*${escapedProfile}*' } | Select-Object -ExpandProperty CommandLine) -join "\n"`,
      ],
      { encoding: 'utf8' },
    )
    if (!browserCommandLines.trim()) {
      throw new Error('Không tìm thấy tiến trình Edge/Chrome đăng nhập bình thường.')
    }
    if (/--enable-automation|--remote-debugging-(?:pipe|port)/iu.test(browserCommandLines)) {
      throw new Error(`Cửa sổ đăng nhập vẫn có cờ automation: ${browserCommandLines}`)
    }
    result = {
      ok: true,
      browserOpened: true,
      manualBrowserNoAutomation: true,
      status: 'login-required',
      translationTested: false,
      reason: 'Phiên kiểm thử sạch cần người dùng đăng nhập ChatGPT.',
    }
  } else {
    const source = page.getByLabel('Nội dung tiếng Trung cần dịch')
    const output = page.getByLabel('Nội dung truyện đã dịch')
    await source.fill('你好。')
    translationMayHaveSubmitted = true
    await page.getByRole('button', { name: 'Bắt đầu dịch' }).click()
    let jobId
    let terminalJob
    const translationDeadline = Date.now() + 240_000
    do {
      const probe = await page.evaluate(async (knownJobId) => {
        const tool = window.storyTool
        const active = await tool.getActiveTranslations()
        const id = knownJobId || active[0]?.id
        let job
        if (id) {
          try {
            job = await tool.getTranslation(id)
          } catch {
            // The start invocation and first checkpoint can race by a few ms.
          }
        }
        return {
          id,
          status: job?.status,
          error: job?.error,
          completedSegments: job?.completedSegments,
          totalSegments: job?.totalSegments,
          segments: job?.segments?.map((segment) => ({
            index: segment.index,
            status: segment.status,
            error: segment.error,
          })),
          translatedLength: typeof job?.translatedText === 'string' ? job.translatedText.length : undefined,
          controls: document.querySelector('.translation-controls')?.textContent?.replace(/\s+/gu, ' ').trim(),
          outputLength: document.querySelector('[aria-label="Nội dung truyện đã dịch"]')?.value?.length,
        }
      }, jobId)
      jobId ||= probe.id
      translationSnapshots.push({ elapsedMs: 240_000 - (translationDeadline - Date.now()), ...probe })
      if (translationSnapshots.length > 20) translationSnapshots.shift()
      if (probe.status === 'completed') {
        terminalJob = probe
        break
      }
      if (probe.status === 'failed' || probe.status === 'cancelled') {
        const stopSafetyFailure = probe.status === 'failed'
          && typeof probe.error === 'string'
          && probe.error.includes('Đã chặn retry để tránh chồng response')
        if (stopSafetyFailure) {
          terminalJob = probe
          break
        }
        throw new Error(`Tác vụ live kết thúc ở trạng thái ${probe.status}: ${JSON.stringify(probe)}`)
      }
      await page.waitForTimeout(2_000)
    } while (Date.now() < translationDeadline)
    if (!terminalJob) {
      throw new Error(`Tác vụ live không hoàn tất trong 240 giây: ${JSON.stringify(translationSnapshots)}`)
    }
    if (terminalJob.status === 'failed') {
      result = {
        ok: true,
        browserOpened: true,
        status: 'ready',
        translationTested: true,
        translatedText: null,
        safetyFallbackVerified: true,
        reason: terminalJob.error,
      }
    } else {
      await page.getByText('Dịch hoàn tất').waitFor({ timeout: 15_000 })
      const translatedText = (await output.inputValue()).trim()
      if (!translatedText || /\p{Script=Han}/u.test(translatedText)) {
        throw new Error(`Phản hồi live không hợp lệ: ${translatedText || '(trống)'}`)
      }
      result = {
        ok: true,
        browserOpened: true,
        status: 'ready',
        translationTested: true,
        translatedText,
      }
    }
  }
} catch (error) {
  primaryError = new Error(
    `Live smoke thất bại; giữ lại userData để chẩn đoán: ${userData}. ` +
      `Snapshots: ${JSON.stringify(translationSnapshots)}`,
    { cause: error },
  )
} finally {
  if (translationMayHaveSubmitted) {
    try {
      if (!page || page.isClosed()) throw new Error('Cửa sổ app đã đóng trước khi cleanup chat live.')
      await cleanupOwnedLiveConversation(page)
    } catch (error) {
      cleanupError = new Error(
        `Không cleanup được chat live do tool tạo; giữ lại userData để kiểm tra: ${userData}`,
        { cause: error },
      )
    }
  }

  try {
    await application?.close()
  } catch (error) {
    closeError = new Error(`Không đóng được Electron live smoke; giữ lại userData: ${userData}`, {
      cause: error,
    })
  }

  if (!primaryError && !cleanupError && !closeError) {
    await rm(userData, { recursive: true, force: true })
  }
}

const failures = [primaryError, cleanupError, closeError].filter(Boolean)
if (failures.length > 1) throw new AggregateError(failures, 'Live smoke hoặc cleanup chat gặp nhiều lỗi.')
if (failures[0]) throw failures[0]
process.stdout.write(JSON.stringify(result, null, 2))
