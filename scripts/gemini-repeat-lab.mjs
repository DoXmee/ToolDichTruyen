/**
 * Repetition lab for the Gemini translation path.
 *
 * Sends the *same* prompt the tool sends, but without the tool: one message, no
 * retries, no second segment, no page reload. That isolates whether Gemini
 * repeats on its own or only when the tool drives it.
 *
 *   node scripts/gemini-repeat-lab.mjs <flash|pro> <trials> [sourceFile]
 *
 * Answers are written to test-results/repeat-lab/ so they can be inspected.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const workspace = path.resolve(import.meta.dirname, '..')
const wantModel = (process.argv[2] ?? 'flash').toLowerCase()
const trials = Math.max(1, Number.parseInt(process.argv[3] ?? '1', 10))
const sourceArgument = process.argv[4]
  ?? path.join(workspace, 'tests', 'e2e', 'fixtures', 'gemini-long-chapter.txt')
const appDataDirectory = path.join(process.env.APPDATA ?? '', 'tool-dich-truyen')
const sourceProfile = path.join(appDataDirectory, 'gemini-browser-profile')
const basePromptPath = path.join(workspace, 'resources', 'prompts', 'nien-dai.txt')
const outputDirectory = path.join(workspace, 'test-results', 'repeat-lab')

/**
 * Accepts either a text file or `job:<jobId>:<segmentIndex>`, which reads a real
 * chapter straight out of the tool's own checkpoint history.
 */
async function resolveSource(argument) {
  const jobMatch = /^job:([0-9a-f-]{36}):(\d+)$/iu.exec(argument)
  if (!jobMatch) {
    return {
      text: (await readFile(argument, 'utf8')).trim(),
      label: path.basename(argument, path.extname(argument)),
    }
  }
  const jobPath = path.join(appDataDirectory, 'jobs', `${jobMatch[1]}.json`)
  const job = JSON.parse(await readFile(jobPath, 'utf8'))
  const segment = job.segments?.[Number(jobMatch[2])]
  if (!segment?.sourceText) throw new Error(`Không đọc được đoạn ${jobMatch[2]} của job ${jobMatch[1]}.`)
  return {
    text: String(segment.sourceText).trim(),
    label: `${jobMatch[1].slice(0, 8)}-seg${jobMatch[2]}`,
  }
}

const resolvedSource = await resolveSource(sourceArgument)
const sourceText = resolvedSource.text
const sourceLabel = resolvedSource.label
const basePrompt = (await readFile(basePromptPath, 'utf8')).trim()

// Byte-for-byte copy of buildTranslationPrompt() in src/core/promptBuilder.ts.
const longPrompt = `${basePrompt}

---
YÊU CẦU CHO ĐOẠN HIỆN TẠI:
- Dịch đầy đủ toàn bộ phần nằm trong thẻ NGUYEN_BAN sang tiếng Việt.
- Giữ nhất quán tên riêng, thuật ngữ và cách xưng hô với các đoạn trước.
- Không để lại chữ Hán, không thêm lời dẫn, giải thích, ghi chú hay thẻ đánh dấu.
- Chỉ trả về bản dịch hoàn chỉnh của đoạn này.

MÃ ĐOẠN: segment-1
VỊ TRÍ: 1/1

<NGUYEN_BAN id="segment-1">
${sourceText}
</NGUYEN_BAN>`

// What a person typically types by hand, for comparison.
const shortPrompt = `Dịch đoạn truyện Trung sau sang tiếng Việt, chỉ trả về bản dịch:

${sourceText}`

const useShortPrompt = process.env.TOOL_DICH_TRUYEN_LAB_SHORT_PROMPT === '1'
const toolPrompt = useShortPrompt ? shortPrompt : longPrompt

function normalize(text) {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim()
}

/**
 * Finds duplicated windows big enough to be a real repetition rather than a
 * natural turn of phrase, and reports the longest one.
 */
function analyseRepetition(text) {
  const flat = normalize(text)
  let longest = { size: 0, sample: '' }
  for (const size of [24, 32, 40, 60, 80, 120, 200]) {
    const seen = new Map()
    let found = ''
    for (let index = 0; index + size <= flat.length; index += 1) {
      const window = flat.slice(index, index + size)
      const previous = seen.get(window)
      if (previous !== undefined && index - previous >= size) {
        found = window
        break
      }
      if (previous === undefined) seen.set(window, index)
    }
    if (found) longest = { size, sample: found }
  }

  const sentences = text.split(/(?<=[.!?…])\s+|\n+/u).map((line) => normalize(line)).filter((line) => line.length > 25)
  const counts = new Map()
  for (const sentence of sentences) counts.set(sentence, (counts.get(sentence) ?? 0) + 1)
  const duplicatedSentences = [...counts.entries()].filter(([, count]) => count > 1)

  const headings = [...text.matchAll(/chương\s+\d+/giu)].map((match) => match.index)
  const restartedOpening = headings.length > 1 && headings[1] < 1500

  return {
    longestRepeatChars: longest.size,
    longestRepeatSample: longest.sample.slice(0, 120),
    duplicatedSentences: duplicatedSentences.length,
    duplicatedSentenceSample: duplicatedSentences[0]?.[0]?.slice(0, 120) ?? '',
    restartedOpening,
  }
}

async function selectModel(page, wanted) {
  const chip = () => page.evaluate(() => {
    // The visible short label can hold only the brand ("Gemini"); the button's
    // aria-label always names the model ("... hiện tại là Gemini Pro").
    const button = document.querySelector('bard-mode-switcher button')
    const aria = button?.getAttribute('aria-label') ?? ''
    const fromAria = /(?:hiện tại là|currently)\s+(.+)$/iu.exec(aria)?.[1]
    if (fromAria) return fromAria.trim()
    return (button?.innerText ?? document.querySelector('bard-mode-switcher .picker-primary-text')?.textContent ?? '')
      .trim().split('\n')[0].trim()
  })
  const current = await chip()
  const matches = (value) => {
    if (wanted === 'pro') return /pro/iu.test(value)
    if (wanted === 'lite') return /lite/iu.test(value)
    return /flash/iu.test(value) && !/lite/iu.test(value)
  }
  if (current && matches(current)) return current

  const trigger = page.locator('bard-mode-switcher button').first()
  if (!(await trigger.count())) return current || 'unknown'
  await trigger.click().catch(() => undefined)
  await page.waitForTimeout(1_500)
  const options = page.locator('gem-menu gem-menu-item, .cdk-overlay-container gem-menu-item')
  const count = await options.count()
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index)
    const label = (await option.innerText().catch(() => '')).trim().replace(/\s+/gu, ' ')
    if (!label || !matches(label)) continue
    await option.click().catch(() => undefined)
    await page.waitForTimeout(1_200)
    return label
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  return current || 'unknown'
}

const results = []
await mkdir(outputDirectory, { recursive: true })

/**
 * Cache and metrics folders are locked while a browser holds the profile and
 * are irrelevant to the session, so they are skipped to keep the copy stable.
 */
const SKIP_FOLDERS = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache',
  'GPUPersistentCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad',
  'BrowserMetrics', 'component_crx_cache', 'extensions_crx_cache',
])

for (let trial = 1; trial <= trials; trial += 1) {
  const workingProfile = await mkdtemp(path.join(tmpdir(), 'gemini-repeat-lab-'))
  await cp(sourceProfile, workingProfile, {
    recursive: true,
    force: true,
    filter: (source) => !SKIP_FOLDERS.has(path.basename(source)),
  })
  let context
  const startedAt = Date.now()
  try {
    context = await chromium.launchPersistentContext(workingProfile, {
      headless: false,
      acceptDownloads: false,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-setuid-sandbox'],
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
      channel: 'msedge',
    })
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(6_000)

    const model = await selectModel(page, wantModel)
    const composer = page.locator('div[contenteditable="true"][role="textbox"]').first()
    await composer.waitFor({ state: 'visible', timeout: 30_000 })
    await composer.click()
    await page.keyboard.insertText(toolPrompt)
    await page.waitForTimeout(600)
    const sendButton = page.locator('button[aria-label*="Gửi" i], button[aria-label*="Send" i]').first()
    const sendAt = Date.now()
    if (await sendButton.count() && await sendButton.isEnabled().catch(() => false)) await sendButton.click()
    else await composer.press('Enter')

    // Wait for the answer to finish: the body clears aria-busy when done.
    let text = ''
    let previous = ''
    let stable = 0
    const deadline = Date.now() + 20 * 60_000
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => {
        const body = document.querySelector('message-content .markdown[aria-busy]')
        const node = document.querySelector('message-content')
        return { text: (node?.innerText ?? '').trim(), busy: body?.getAttribute('aria-busy') ?? null }
      })
      text = snapshot.text
      if (text && text === previous && snapshot.busy !== 'true') stable += 1
      else stable = 0
      previous = text
      if (text && stable >= 3) break
      await page.waitForTimeout(500)
    }

    const elapsedMs = Date.now() - sendAt
    const file = path.join(outputDirectory, `${sourceLabel}-${wantModel}-trial${trial}-${Date.now()}.txt`)
    await writeFile(file, text, 'utf8')
    results.push({
      trial,
      source: sourceLabel,
      wantedModel: wantModel,
      appliedModel: model,
      elapsedMs,
      chars: text.length,
      file,
      ...analyseRepetition(text),
      head: text.slice(0, 120),
    })
  } finally {
    await context?.close().catch(() => undefined)
    await rm(workingProfile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
  process.stderr.write(`trial ${trial}/${trials} xong sau ${Math.round((Date.now() - startedAt) / 1000)}s\n`)
}

process.stdout.write(`${JSON.stringify({
  wantModel,
  source: sourceLabel,
  sourceChars: sourceText.length,
  promptChars: toolPrompt.length,
  results,
}, null, 2)}\n`)
