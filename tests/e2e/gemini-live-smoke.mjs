/**
 * Live Gemini translation smoke test.
 *
 * Runs the real app against the real gemini.google.com session and checks what
 * actually comes back: the translation text, the wall-clock time, and that no
 * Gemini interface chrome leaked into the captured answer.
 *
 * The Gemini browser profile must be free, so close the app (and any browser
 * window it opened) before running this. Point TOOL_DICH_TRUYEN_GEMINI_PROFILE
 * at a signed-in profile to copy the session in.
 *
 *   pnpm run build
 *   node tests/e2e/gemini-live-smoke.mjs
 */
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-gemini-live-'))
const sourceProfile = process.env.TOOL_DICH_TRUYEN_GEMINI_PROFILE?.trim()
const testProfile = path.join(userData, 'gemini-browser-profile')

const SOURCE_TEXT = '第一章 初次见面\n你好。今天天气很好，我们一起去图书馆看书。'
const sourceFile = process.env.TOOL_DICH_TRUYEN_GEMINI_SOURCE_FILE?.trim()
const sourceText = sourceFile ? await readFile(sourceFile, 'utf8') : SOURCE_TEXT

// Strings that only exist in Gemini's interface. If any of them shows up in the
// captured answer, the adapter grabbed surrounding chrome instead of the model
// response.
const GEMINI_UI_NOISE = [
  'Ask Gemini',
  'Enter a prompt',
  'Gemini can make mistakes',
  'Google Terms',
  'Privacy Policy',
  'New chat',
  'Show thinking',
  'Hide thinking',
  'Copy code',
  'Conversation with Gemini',
  'Sign in',
  'Upgrade',
]

// Words a faithful Vietnamese translation of SOURCE_TEXT must contain at least
// one of. Their absence means the tool captured something other than the answer.
const EXPECTED_VIETNAMESE = ['thư viện', 'thời tiết', 'đọc sách', 'hôm nay', 'cùng nhau']

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function inspectTranslation(text) {
  const problems = []
  const value = text.trim()
  if (!value) problems.push('Bản dịch rỗng.')
  if (/\p{Script=Han}/u.test(value)) problems.push('Bản dịch còn chữ Hán.')
  for (const noise of GEMINI_UI_NOISE) {
    if (value.toLowerCase().includes(noise.toLowerCase())) {
      problems.push(`Lẫn chữ giao diện Gemini: "${noise}".`)
    }
  }
  if (/TDTOWN_[0-9a-f]{32}/u.test(value)) problems.push('Lẫn dấu xác minh nội bộ của tool.')
  // The keyword list describes the bundled short sample only; a custom chapter
  // fixture legitimately contains none of those words.
  if (!sourceFile && !EXPECTED_VIETNAMESE.some((word) => value.toLowerCase().includes(word))) {
    problems.push('Không thấy từ khoá tiếng Việt nào đúng với nguồn.')
  }
  return problems
}

/**
 * Gemini occasionally restarts a long answer mid-stream and the page keeps the
 * abandoned opening. This looks for the chapter heading appearing twice near
 * the top, which is what that artifact produced in practice.
 */
function detectRestartedOpening(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const heading = lines.find((line) => /^chương\s+\d+/iu.test(line))
  if (!heading) return false
  const rest = lines.slice(lines.indexOf(heading) + 1, lines.indexOf(heading) + 12)
  return rest.some((line) => /^chương\s+\d+/iu.test(line))
}

let application
let result
let succeeded = false

try {
  if (sourceProfile && await exists(sourceProfile)) {
    await cp(sourceProfile, testProfile, { recursive: true, force: true })
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
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })

  const geminiChoice = page.getByRole('radio', { name: 'Gemini AI' })
  await geminiChoice.click()

  // Restrict the pool to Gemini alone so a failover cannot silently answer with
  // a different chatbot and still make this test pass.
  for (const label of ['ChatGPT', 'Kimi AI', 'DeepSeek AI']) {
    const checkbox = page.getByRole('checkbox', { name: label })
    if (await checkbox.isChecked()) await checkbox.click()
  }

  await page.waitForFunction(
    () => document.body.innerText.includes('Gemini AI đã kết nối')
      || document.body.innerText.includes('Chờ đăng nhập Gemini AI')
      || document.body.innerText.includes('Kết nối có lỗi'),
    undefined,
    { timeout: 120_000 },
  )

  let statusText = await page.locator('.connection-box').innerText()
  if (statusText.includes('Chờ đăng nhập Gemini AI')) {
    process.stdout.write(`GEMINI_LOGIN_REQUIRED userData=${userData}\n`)
    await page.waitForFunction(
      () => document.body.innerText.includes('Gemini AI đã kết nối')
        || document.body.innerText.includes('Kết nối có lỗi'),
      undefined,
      { timeout: 30 * 60_000 },
    )
    statusText = await page.locator('.connection-box').innerText()
  }
  if (!statusText.includes('Gemini AI đã kết nối')) {
    throw new Error(`Gemini không kết nối được: ${statusText}`)
  }

  const source = page.getByLabel('Nội dung tiếng Trung cần dịch')
  const output = page.getByLabel('Nội dung truyện đã dịch')
  await source.fill(sourceText)

  const startedAt = Date.now()
  await page.getByRole('button', { name: 'Bắt đầu dịch' }).click()

  // Optional pause/resume leg: interrupting a live Gemini generation must leave
  // a resumable checkpoint instead of losing the chapter.
  const pauseAfterMs = Number.parseInt(process.env.TOOL_DICH_TRUYEN_GEMINI_PAUSE_MS ?? '', 10)
  let pausedAtMs
  if (Number.isFinite(pauseAfterMs) && pauseAfterMs > 0) {
    await page.waitForTimeout(pauseAfterMs)
    await page.getByRole('button', { name: 'Tạm dừng' }).click()
    let paused
    const pauseDeadline = Date.now() + 120_000
    do {
      paused = await page.evaluate(async () => {
        const active = await window.storyTool.getActiveTranslations()
        const id = active[0]?.id
        const job = id ? await window.storyTool.getTranslation(id).catch(() => undefined) : undefined
        return { id, status: job?.status, completedSegments: job?.completedSegments }
      })
      if (paused.status === 'paused') break
      await page.waitForTimeout(1_000)
    } while (Date.now() < pauseDeadline)
    if (paused.status !== 'paused') {
      throw new Error(`Tạm dừng Gemini không tạo checkpoint "paused": ${JSON.stringify(paused)}`)
    }
    pausedAtMs = Date.now() - startedAt
    await page.getByRole('button', { name: 'Tiếp tục' }).click()
  }

  let jobId
  let terminalJob
  let firstOutputMs
  const deadline = Date.now() + 25 * 60_000
  do {
    if (firstOutputMs === undefined) {
      const typed = (await output.inputValue().catch(() => '')).trim()
      if (typed) firstOutputMs = Date.now() - startedAt
    }
    const probe = await page.evaluate(async (knownJobId) => {
      const tool = window.storyTool
      const active = await tool.getActiveTranslations()
      const id = knownJobId || active[0]?.id
      const job = id ? await tool.getTranslation(id).catch(() => undefined) : undefined
      return {
        id,
        status: job?.status,
        error: job?.error,
        completedSegments: job?.completedSegments,
        totalSegments: job?.totalSegments,
        provider: job?.aiProvider,
        activityLog: (job?.activityLog ?? []).slice(-8).map((entry) => entry.message),
      }
    }, jobId)
    jobId ||= probe.id
    if (['completed', 'failed', 'cancelled'].includes(probe.status)) {
      terminalJob = probe
      break
    }
    await page.waitForTimeout(1_000)
  } while (Date.now() < deadline)

  const durationMs = Date.now() - startedAt
  if (!terminalJob) throw new Error('Gemini không hoàn tất chương kiểm thử trong 25 phút.')
  if (terminalJob.status !== 'completed') {
    throw new Error(
      `Gemini kết thúc ở trạng thái ${terminalJob.status}: ${terminalJob.error || 'không rõ lỗi'}\n`
      + `Nhật ký gần nhất:\n- ${(terminalJob.activityLog ?? []).join('\n- ')}`,
    )
  }
  if (terminalJob.provider !== 'gemini') {
    throw new Error(`Tiến trình đã chạy bằng ${terminalJob.provider} thay vì Gemini.`)
  }
  if (terminalJob.completedSegments !== 1 || terminalJob.totalSegments !== 1) {
    throw new Error(`Số đoạn kiểm thử không khớp: ${JSON.stringify(terminalJob)}`)
  }

  const translatedText = (await output.inputValue()).trim()
  const problems = inspectTranslation(translatedText)
  // A truncated answer would come back far shorter than the source. Chinese to
  // Vietnamese normally expands, so anything under 40% is a cut-off reply.
  if (translatedText.length < sourceText.length * 0.4) {
    problems.push(
      `Bản dịch ngắn bất thường: ${translatedText.length} ký tự cho nguồn ${sourceText.length} ký tự.`,
    )
  }
  if (problems.length) {
    throw new Error(
      `Nội dung Gemini trả về không đạt: ${problems.join(' ')}\n`
      + `Độ dài ${translatedText.length} ký tự. Đầu: ${translatedText.slice(0, 320)}\n`
      + `Cuối: ${translatedText.slice(-160)}`,
    )
  }

  result = {
    ok: true,
    provider: terminalJob.provider,
    completedSegments: terminalJob.completedSegments,
    totalSegments: terminalJob.totalSegments,
    durationMs,
    durationSeconds: Math.round(durationMs / 1000),
    ...(pausedAtMs === undefined ? {} : { pausedAtMs }),
    firstOutputMs,
    sourceChars: sourceText.length,
    translatedChars: translatedText.length,
    restartedOpening: detectRestartedOpening(translatedText),
    activityLog: terminalJob.activityLog,
    translatedText,
  }
  succeeded = true
} finally {
  await application?.close().catch(() => undefined)
  if (succeeded) await rm(userData, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
