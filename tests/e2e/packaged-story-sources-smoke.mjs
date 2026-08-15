import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const workspace = path.resolve(import.meta.dirname, '..', '..')
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(workspace, 'release', 'win-unpacked', 'ToolDichTruyen.exe')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-packaged-sources-'))

const sources = [
  { name: 'TimoTXT chapter', url: 'https://www.timotxt.com/1509589610/13.html', site: 'timotxt' },
  { name: 'Qingrenyouxi chapter', url: 'https://www.qingrenyouxi.com/book/114551/33074751.html', site: 'qingrenyouxi' },
  { name: 'Huliwang chapter', url: 'https://m.huliwang.net/1703891/36/3.html', site: 'huliwang' },
  { name: 'Xbanxia book', url: 'https://www.xbanxia.cc/books/143300.html', site: 'xbanxia', representatives: [1, 82, 164] },
  { name: 'Xbanxia chapter', url: 'https://www.xbanxia.cc/books/143300/28251886.html', site: 'xbanxia' },
]

function assertCleanText(name, text) {
  if (typeof text !== 'string' || text.length < 300) {
    throw new Error(`${name}: chapter content is unexpectedly short.`)
  }
  if (/\uFFFD|[\uAC00-\uD7AF]|<(?:script|style|iframe)\b/iu.test(text)) {
    throw new Error(`${name}: extracted content has replacement/script/encoded-Hangul residue.`)
  }
}

const application = await electron.launch({
  executablePath: executable,
  env: { ...process.env, TOOL_DICH_TRUYEN_USER_DATA: userData },
})

try {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })

  const results = []
  for (const source of sources) {
    let result
    try {
      result = await page.evaluate(async ({ url, representatives }) => {
        const analysis = await window.storyTool.analyzeStoryUrl(url)
        const selected = Array.isArray(representatives)
          ? analysis.chapters
            .filter((chapter) => representatives.includes(chapter.number ?? -1))
            .map((chapter) => chapter.id)
          : analysis.defaultSelectedChapterIds
        if (!selected.length) throw new Error('No chapter was selected for package smoke.')
        const fetched = await window.storyTool.fetchStoryChapters({ analysisId: analysis.analysisId, chapterIds: selected })
        return {
          site: analysis.site,
          inputKind: analysis.inputKind,
          catalogCount: analysis.chapters.length,
          selectedCount: selected.length,
          defaultSelectedCount: analysis.defaultSelectedChapterIds.length,
          chapters: fetched.chapters.map((chapter) => ({
            number: chapter.number,
            title: chapter.title,
            text: chapter.sourceText,
            sourceUrls: chapter.sourceUrls,
          })),
          combinedSource: fetched.combinedSource,
        }
      }, source)
    } catch (error) {
      // Huliwang may show a passive/interactive Cloudflare check. The app
      // must stop cleanly instead of scraping the challenge or clicking it;
      // an externally blocked page is therefore a successful fail-safe case.
      if (source.site === 'huliwang' && /Cloudflare|xác minh|xÃ¡c minh/iu.test(String(error))) {
        results.push({ name: source.name, site: source.site, status: 'safe-blocked-by-cloudflare' })
        continue
      }
      throw error
    }

    if (result.site !== source.site) throw new Error(`${source.name}: wrong adapter ${result.site}.`)
    if (source.site === 'xbanxia' && source.representatives && result.selectedCount !== 3) {
      throw new Error(`${source.name}: expected 3 representative chapters.`)
    }
    if (!result.chapters.length) throw new Error(`${source.name}: no fetched chapter.`)
    for (const chapter of result.chapters) assertCleanText(source.name, chapter.text)
    assertCleanText(`${source.name} combined`, result.combinedSource)
    results.push({
      name: source.name,
      site: result.site,
      inputKind: result.inputKind,
      catalogCount: result.catalogCount,
      selectedCount: result.selectedCount,
      chapters: result.chapters.map((chapter) => ({ number: chapter.number, length: chapter.text.length })),
    })
  }
  process.stdout.write(`${JSON.stringify({ ok: true, executable, results }, null, 2)}\n`)
} finally {
  await application.close().catch(() => undefined)
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}
