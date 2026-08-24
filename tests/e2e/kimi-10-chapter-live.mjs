import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const realData = process.env.TOOL_DICH_TRUYEN_REAL_DATA?.trim()
  || 'C:\\Users\\dthuo\\AppData\\Roaming\\tool-dich-truyen'
const seedProfile = path.join(realData, 'kimi-browser-profile')
const realDraft = path.join(realData, 'draft.json')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-kimi-live-'))
const reportPath = path.join(workspace, 'test-results', 'kimi-10-chapter-live-report.json')
const liveChapterCount = Math.max(1, Number.parseInt(process.env.KIMI_LIVE_CHAPTERS || '10', 10))
const liveResponseTimeoutMs = Math.max(
  30_000,
  Number.parseInt(process.env.KIMI_LIVE_RESPONSE_TIMEOUT_MS || '600000', 10),
)
const liveMaxRetries = Math.max(1, Number.parseInt(process.env.KIMI_LIVE_MAX_RETRIES || '3', 10))

function extractFirstChapters(source, chapterCount) {
  const matches = [...source.matchAll(/^Chương\s+\d+\s*:/gmu)]
  if (matches.length < chapterCount + 1) {
    throw new Error(`Bản nguồn không đủ ${chapterCount + 1} mốc để lấy trọn ${chapterCount} chương.`)
  }
  return source.slice(matches[0].index, matches[chapterCount].index).trim()
}

function countHan(value) {
  return [...value.matchAll(/\p{Script=Han}/gu)].length
}

function durationStats(job) {
  return job.segments.map((segment) => {
    const entries = (job.activityLog || []).filter((entry) => entry.segmentId === segment.id)
    const first = entries.find((entry) => /(?:Gửi|Thử lại) đoạn/u.test(entry.message))
    const done = [...entries].reverse().find((entry) => /đạt kiểm tra và đã lưu checkpoint/u.test(entry.message))
    const durationMs = first && done
      ? Math.max(0, new Date(done.at).getTime() - new Date(first.at).getTime())
      : undefined
    return {
      index: segment.index + 1,
      status: segment.status,
      attempts: segment.attempts,
      sourceCharacters: segment.sourceText.length,
      translatedCharacters: segment.translatedText.length,
      remainingHanCharacters: segment.validation?.metrics?.remainingHanCharacters,
      lengthRatio: segment.validation?.metrics?.lengthRatio,
      durationMs,
      error: segment.error,
    }
  })
}

let application
let page
let jobId
let terminalJob
let primaryError
const startedAt = Date.now()

try {
  const draft = JSON.parse(await readFile(realDraft, 'utf8'))
  const source = extractFirstChapters(String(draft.source || ''), liveChapterCount)
  const sourceHeadings = [...source.matchAll(/^Chương\s+(\d+)\s*:/gmu)].map((match) => Number(match[1]))

  await cp(seedProfile, path.join(userData, 'kimi-browser-profile'), { recursive: true, force: true })
  await writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({ version: 1, aiProvider: 'kimi' }, null, 2),
    'utf8',
  )

  application = await electron.launch({
    executablePath: electronExecutable,
    args: [workspace],
    cwd: workspace,
    env: {
      ...process.env,
      TOOL_DICH_TRUYEN_USER_DATA: userData,
      KIMI_BASE_URL: 'https://www.kimi.ai/',
    },
  })
  application.process().stdout?.on('data', (chunk) => process.stdout.write(`[electron] ${chunk}`))
  application.process().stderr?.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`))
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })

  const selected = await page.evaluate(async () => {
    const tool = window.storyTool
    await tool.setAiProvider('kimi')
    return await tool.connectAi()
  })

  let connection = selected
  const connectionDeadline = Date.now() + 90_000
  while (connection.status !== 'ready' && Date.now() < connectionDeadline) {
    if (connection.status === 'login-required') break
    await page.waitForTimeout(1_000)
    connection = await page.evaluate(async () => window.storyTool.getAiStatus())
  }
  if (connection.status !== 'ready') {
    throw new Error(`Hồ sơ Kimi kiểm thử chưa sẵn sàng: ${connection.status} - ${connection.message || ''}`)
  }

  const startResult = await page.evaluate(async ({ source, maxRetries, responseTimeoutMs }) => window.storyTool.startTranslation({
    source,
    promptMode: 'modern',
    aiProvider: 'kimi',
    settings: {
      maxCharsPerSegment: 12_000,
      maxRetries,
      responseTimeoutMs,
    },
  }), {
    source,
    maxRetries: liveMaxRetries,
    responseTimeoutMs: liveResponseTimeoutMs,
  })
  jobId = startResult.jobId

  let previousProgress = ''
  const translationDeadline = Date.now() + 90 * 60_000
  while (Date.now() < translationDeadline) {
    const job = await page.evaluate(async (id) => window.storyTool.getTranslation(id), jobId)
    const progress = `${job.status}:${job.completedSegments}/${job.totalSegments}:${job.currentSegmentIndex ?? ''}`
    if (progress !== previousProgress) {
      process.stdout.write(`${JSON.stringify({
        at: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        status: job.status,
        completedSegments: job.completedSegments,
        totalSegments: job.totalSegments,
        currentSegmentIndex: job.currentSegmentIndex,
        latestLog: job.activityLog?.at(-1)?.message,
      })}\n`)
      previousProgress = progress
    }
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      terminalJob = job
      break
    }
    await page.waitForTimeout(2_000)
  }
  if (!terminalJob) throw new Error('Quá 90 phút nhưng lượt dịch 10 chương chưa kết thúc.')

  const persisted = JSON.parse(await readFile(path.join(userData, 'jobs', `${jobId}.json`), 'utf8'))
  const segments = durationStats(persisted)
  const durations = segments.map((segment) => segment.durationMs).filter(Number.isFinite)
  const outputHeadings = [...persisted.translatedText.matchAll(/^Chương\s+(\d+)\s*:/gmu)].map((match) => Number(match[1]))
  const report = {
    ok: persisted.status === 'completed',
    testedAt: new Date().toISOString(),
    provider: persisted.aiProvider,
    baseUrl: 'https://www.kimi.ai/',
    sourceChapterNumbers: sourceHeadings,
    sourceCharacters: source.length,
    outputChapterNumbers: outputHeadings,
    outputCharacters: persisted.translatedText.length,
    remainingHanCharacters: countHan(persisted.translatedText),
    totalDurationMs: Date.now() - startedAt,
    averageSegmentDurationMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : undefined,
    retryingSegments: segments.filter((segment) => segment.attempts > 1).length,
    failedSegments: segments.filter((segment) => segment.status !== 'completed').length,
    jobStatus: persisted.status,
    jobError: persisted.error,
    segments,
    activityLog: persisted.activityLog,
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify({ reportPath, ...report })}\n`)
  if (!report.ok) throw new Error(`Lượt dịch kết thúc ở trạng thái ${persisted.status}: ${persisted.error || ''}`)
} catch (error) {
  primaryError = error
  await writeFile(reportPath, JSON.stringify({
    ok: false,
    testedAt: new Date().toISOString(),
    jobId,
    terminalStatus: terminalJob?.status,
    error: error instanceof Error ? error.stack || error.message : String(error),
  }, null, 2), 'utf8')
} finally {
  try {
    await application?.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
}

if (primaryError) throw primaryError
