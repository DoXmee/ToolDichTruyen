import { access, cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-deepseek-live-'))
const destinationProfile = process.env.TOOL_DICH_TRUYEN_DEEPSEEK_PROFILE?.trim()
const testProfile = path.join(userData, 'deepseek-browser-profile')

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

let application
let page
let result
let succeeded = false

try {
  if (destinationProfile && await exists(destinationProfile)) {
    await cp(destinationProfile, testProfile, { recursive: true, force: true })
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

  const deepSeekChoice = page.getByRole('radio', { name: 'DeepSeek AI' })
  await deepSeekChoice.click()
  if (await deepSeekChoice.getAttribute('aria-checked') !== 'true') {
    throw new Error('Nút DeepSeek AI không lưu được trạng thái được chọn.')
  }

  // Đổi nhà cung cấp đã tự kiểm tra kết nối để người dùng không phải bấm thêm
  // nút Kết nối. Đây cũng là hành vi cần được kiểm chứng ở bản chạy thật.
  await page.waitForFunction(
    () => document.body.innerText.includes('DeepSeek AI đã kết nối')
      || document.body.innerText.includes('Chờ đăng nhập DeepSeek AI')
      || document.body.innerText.includes('Kết nối có lỗi'),
    undefined,
    { timeout: 60_000 },
  )

  let statusText = await page.locator('.connection-box').innerText()
  if (statusText.includes('Chờ đăng nhập DeepSeek AI')) {
    process.stdout.write(`DEEPSEEK_LOGIN_REQUIRED userData=${userData}\n`)
    await page.waitForFunction(
      () => document.body.innerText.includes('DeepSeek AI đã kết nối')
        || document.body.innerText.includes('Kết nối có lỗi'),
      undefined,
      { timeout: 30 * 60_000 },
    )
    statusText = await page.locator('.connection-box').innerText()
  }
  if (!statusText.includes('DeepSeek AI đã kết nối')) {
    throw new Error(`DeepSeek không kết nối được: ${statusText}`)
  }

  const sourceText = '第一章 初次见面\n你好。今天天气很好，我们一起去图书馆看书。'
  const source = page.getByLabel('Nội dung tiếng Trung cần dịch')
  const output = page.getByLabel('Nội dung truyện đã dịch')
  await source.fill(sourceText)
  await page.getByRole('button', { name: 'Bắt đầu dịch' }).click()

  let jobId
  let terminalJob
  const deadline = Date.now() + 25 * 60_000
  do {
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
        provider: job?.checkpoint?.aiProvider || job?.aiProvider,
      }
    }, jobId)
    jobId ||= probe.id
    if (['completed', 'failed', 'cancelled'].includes(probe.status)) {
      terminalJob = probe
      break
    }
    await page.waitForTimeout(2_000)
  } while (Date.now() < deadline)

  if (!terminalJob) throw new Error('DeepSeek không hoàn tất chương kiểm thử trong 25 phút.')
  if (terminalJob.status !== 'completed') {
    throw new Error(`DeepSeek kết thúc ở trạng thái ${terminalJob.status}: ${terminalJob.error || 'không rõ lỗi'}`)
  }
  if (terminalJob.completedSegments !== 1 || terminalJob.totalSegments !== 1) {
    throw new Error(`Số đoạn kiểm thử không khớp: ${JSON.stringify(terminalJob)}`)
  }

  const translatedText = (await output.inputValue()).trim()
  if (!translatedText) throw new Error('DeepSeek trả về nội dung trống.')
  if (/\p{Script=Han}/u.test(translatedText)) {
    throw new Error(`Bản dịch DeepSeek còn chữ Hán: ${translatedText}`)
  }

  result = {
    ok: true,
    providerSelected: await deepSeekChoice.getAttribute('aria-checked') === 'true',
    connected: true,
    completedSegments: terminalJob.completedSegments,
    totalSegments: terminalJob.totalSegments,
    translatedText,
  }
  succeeded = true
} finally {
  await application?.close().catch(() => undefined)
  if (succeeded && destinationProfile && await exists(testProfile)) {
    await cp(testProfile, destinationProfile, { recursive: true, force: true })
  }
  if (succeeded) await rm(userData, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
