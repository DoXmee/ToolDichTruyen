import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const realUserData = process.env.TOOL_DICH_TRUYEN_BENCHMARK_SOURCE
  || path.join(process.env.APPDATA || '', 'tool-dich-truyen')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-startup-'))
const artifacts = path.join(workspace, 'test-results')
await mkdir(artifacts, { recursive: true })

// Reproduce the user's real data volume without copying browser sessions or
// allowing the isolated benchmark to resume/export the real in-progress job.
const draft = JSON.parse(await readFile(path.join(realUserData, 'draft.json'), 'utf8'))
if (process.env.TOOL_DICH_TRUYEN_BENCHMARK_SMALL === '1') {
  draft.source = ''
  draft.output = ''
  draft.autoExportOutput = ''
  draft.exportedRecords = []
  draft.originalExportedRecords = []
}
if (process.env.TOOL_DICH_TRUYEN_BENCHMARK_CHECKPOINT !== '1') {
  draft.autoExportJobId = ''
  draft.autoExportStartedAt = 0
  draft.exportDirectory = ''
  delete draft.autoExportResolvedDirectory
} else {
  const isolatedExport = path.join(userData, 'isolated-export')
  await mkdir(isolatedExport, { recursive: true })
  draft.exportDirectory = isolatedExport
  draft.autoExportResolvedDirectory = isolatedExport
}
await writeFile(path.join(userData, 'draft.json'), JSON.stringify(draft), 'utf8')
await cp(path.join(realUserData, 'jobs'), path.join(userData, 'jobs'), { recursive: true })

const startedAt = performance.now()
const application = await electron.launch({
  executablePath: electronExecutable,
  args: [workspace],
  cwd: workspace,
  env: { ...process.env, TOOL_DICH_TRUYEN_USER_DATA: userData },
})

let report
try {
  const page = await application.firstWindow()
  const windowCreatedMs = performance.now() - startedAt
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 30_000 })
  const headingReadyMs = performance.now() - startedAt
  await page.locator('button').filter({ hasText: 'Nhật ký' }).first().evaluate((button) => button.click(), { timeout: 30_000 })
  const firstInteractionMs = performance.now() - startedAt
  const frameGaps = await page.evaluate(() => new Promise((resolve) => {
    const gaps = []
    let previous = performance.now()
    const interval = setInterval(() => {
      const now = performance.now()
      gaps.push(now - previous)
      previous = now
    }, 16)
    setTimeout(() => {
      clearInterval(interval)
      resolve(gaps)
    }, 2_000)
  }))
  report = {
    ok: true,
    testedAt: new Date().toISOString(),
    sourceDraftBytes: Buffer.byteLength(JSON.stringify(draft)),
    windowCreatedMs: Math.round(windowCreatedMs),
    headingReadyMs: Math.round(headingReadyMs),
    firstInteractionMs: Math.round(firstInteractionMs),
    maxFrameGapMs: Math.round(Math.max(...frameGaps)),
    framesOver50Ms: frameGaps.filter((gap) => gap > 50).length,
  }
} finally {
  await application.close().catch(() => undefined)
  await rm(userData, { recursive: true, force: true })
}

await writeFile(
  path.join(artifacts, 'startup-performance.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(JSON.stringify(report, null, 2))
