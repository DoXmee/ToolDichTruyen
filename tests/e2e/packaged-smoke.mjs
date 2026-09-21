import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const workspace = path.resolve(import.meta.dirname, '..', '..')
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(workspace, 'release', 'win-unpacked', 'ToolDichTruyen.exe')
const packageMetadata = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'))
const expectedVersion = process.argv[3] || packageMetadata.version
const executableArguments = process.argv.slice(4)
await access(executable)

const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-packaged-'))
const artifacts = path.join(workspace, 'test-results')
await mkdir(artifacts, { recursive: true })

const application = await electron.launch({
  executablePath: executable,
  args: executableArguments,
  env: {
    ...process.env,
    TOOL_DICH_TRUYEN_USER_DATA: userData,
  },
})

try {
  const page = await application.firstWindow()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })

  const result = await page.evaluate(async () => {
    if (!window.storyTool) throw new Error('Thiếu preload bridge trong bản đóng gói.')
    const methods = Object.keys(window.storyTool)
    const [version, prompts] = await Promise.all([
      window.storyTool.getVersion(),
      window.storyTool.loadPrompts(),
    ])
    return {
      version,
      methods,
      methodCount: methods.length,
      periodPromptLength: prompts.period.length,
      modernPromptLength: prompts.modern.length,
      ancientPromptLength: prompts.ancient.length,
      cultivationPromptLength: prompts.cultivation.length,
    }
  })

  if (
    result.periodPromptLength < 1_000
    || result.modernPromptLength < 1_000
    || result.ancientPromptLength < 1_000
    || result.cultivationPromptLength < 1_000
  ) {
    throw new Error('Prompt UTF-8 đóng gói bị thiếu hoặc quá ngắn.')
  }
  if (result.version !== expectedVersion) {
    throw new Error(`Sai phiên bản đóng gói: cần ${expectedVersion}, nhận ${result.version}.`)
  }
  const requiredMethods = [
    'loadPrompts',
    'getVersion',
    'connectAi',
    'getAiProvider',
    'setAiProvider',
    'listAccounts',
    'addAccount',
    'syncCurrentAccount',
    'startTranslation',
    'pauseTranslation',
    'resumeTranslation',
    'exportChapters',
    'analyzeStoryUrl',
    'fetchStoryChapters',
    'revealHuliBrowserHelper',
  ]
  const missing = requiredMethods.filter((method) => !result.methods.includes(method))
  if (missing.length) {
    throw new Error(`Thiếu phương thức preload trong bản đóng gói: ${missing.join(', ')}.`)
  }
  if (pageErrors.length) throw new Error(`Renderer lỗi: ${pageErrors.join(' | ')}`)

  await page.screenshot({
    path: path.join(artifacts, 'packaged-app.png'),
    fullPage: true,
  })
  process.stdout.write(JSON.stringify({ ok: true, executable, ...result }, null, 2))
} finally {
  await application.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}
