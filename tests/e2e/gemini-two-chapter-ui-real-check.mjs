import { mkdir, readFile } from 'node:fs/promises'
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

const sourceText = [
  'Chương 1: Gặp lại',
  '你好。今天天气很好，我们一起去图书馆看书。',
  '',
  'Chương 2: Trên đường',
  '她轻轻推开门，看见多年未见的朋友，然后露出了微笑。',
].join('\n')

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

  await page.getByRole('radio', { name: 'Gemini AI' }).click()
  await page.waitForFunction(() =>
    document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes('Gemini AI'),
  )
  await page.waitForTimeout(600)

  for (const label of ['ChatGPT', 'Kimi AI', 'DeepSeek AI']) {
    const checkbox = page.getByRole('checkbox', { name: label })
    if (await checkbox.isChecked().catch(() => false)) await checkbox.click()
  }
  const geminiPool = page.getByRole('checkbox', { name: 'Gemini AI' })
  if (!await geminiPool.isChecked().catch(() => false)) await geminiPool.click()

  await page.getByRole('tab', { name: 'Dán nội dung' }).click().catch(() => undefined)
  await page.getByLabel('Nội dung tiếng Trung cần dịch').waitFor({ timeout: 20_000 })
  await page.getByLabel('Nội dung tiếng Trung cần dịch').fill(sourceText)
  await page.screenshot({ path: path.join(artifacts, 'gemini-two-chapter-before-start.png') })
  await page.getByRole('button', { name: 'Bắt đầu dịch' }).click()

  let jobId
  let terminal
  const startedAt = Date.now()
  const deadline = Date.now() + 15 * 60_000
  do {
    const probe = await page.evaluate(async (knownJobId) => {
      const tool = window.storyTool
      const active = await tool.getActiveTranslations()
      const id = knownJobId || active[0]?.id
      const job = id ? await tool.getTranslation(id).catch(() => undefined) : undefined
      return {
        id,
        status: job?.status,
        provider: job?.aiProvider,
        error: job?.error,
        completedSegments: job?.completedSegments,
        totalSegments: job?.totalSegments,
        segments: job?.segments,
        activityLog: (job?.activityLog ?? []).slice(-12).map((entry) => entry.message),
      }
    }, jobId)
    jobId ||= probe.id
    if (['completed', 'failed', 'cancelled', 'paused'].includes(probe.status)) {
      terminal = probe
      break
    }
    await page.waitForTimeout(1_000)
  } while (Date.now() < deadline)

  await page.screenshot({ path: path.join(artifacts, 'gemini-two-chapter-after-finish.png'), fullPage: true })
  if (!terminal) throw new Error('Gemini UI two-chapter test timed out after 15 minutes.')
  if (terminal.status !== 'completed') {
    throw new Error(`Gemini two-chapter ended as ${terminal.status}: ${terminal.error || ''}\n${terminal.activityLog?.join('\n')}`)
  }
  if (terminal.provider !== 'gemini') throw new Error(`Job used ${terminal.provider} instead of Gemini.`)
  if (terminal.totalSegments !== 2 || terminal.completedSegments !== 2) {
    throw new Error(`Expected 2 completed Gemini segments, got ${JSON.stringify(terminal)}`)
  }

  const statePath = path.join(userData, 'gemini-tool-conversation.json')
  const conversationState = JSON.parse(await readFile(statePath, 'utf8'))
  const conversation = conversationState.conversation
  const output = await page.getByLabel('Nội dung truyện đã dịch').inputValue()
  const problems = []
  if (!conversation) problems.push('gemini-tool-conversation.json không còn conversation sau job.')
  if (conversation && !/^marker-[a-f0-9]{24}$/u.test(conversation.id)) {
    problems.push(`Gemini marker conversation id không hợp lệ: ${conversation.id}`)
  }
  if (conversation && (!Array.isArray(conversation.ownershipHashes) || conversation.ownershipHashes.length < 2)) {
    problems.push(`Gemini không giữ nhiều marker trong cùng chat: ${JSON.stringify(conversation)}`)
  }
  if (/\bTDTOWN_[a-f0-9]{32}\b/u.test(output)) problems.push('Output bị lộ marker TDTOWN.')
  if (!/Chương\s+1/iu.test(output) || !/Chương\s+2/iu.test(output)) {
    problems.push(`Output thiếu đủ hai chương: ${output.slice(0, 500)}`)
  }

  const result = {
    ok: problems.length === 0,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    job: terminal,
    conversation,
    ownershipHashCount: conversation?.ownershipHashes?.length,
    outputPreview: output.slice(0, 800),
    screenshots: [
      path.join(artifacts, 'gemini-two-chapter-before-start.png'),
      path.join(artifacts, 'gemini-two-chapter-after-finish.png'),
    ],
    problems,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (problems.length) throw new Error(problems.join('\n'))
} finally {
  await application.close().catch(() => undefined)
}
