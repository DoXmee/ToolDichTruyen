import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const workspace = path.resolve(import.meta.dirname, '..', '..')
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(workspace, 'release', 'win-unpacked', 'ToolDichTruyen.exe')
await access(executable)

const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-packaged-source-'))
const application = await electron.launch({
  executablePath: executable,
  env: { ...process.env, TOOL_DICH_TRUYEN_USER_DATA: userData },
})

try {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate(async () => {
    const tool = window.storyTool
    if (!tool) throw new Error('Thiếu preload bridge.')
    const clean = (value) => {
      if (value.length < 500) throw new Error('Nội dung Xbanxia quá ngắn.')
      if (/[\uFFFD\uAC00-\uD7AF\uE000-\uF8FF]/u.test(value)) throw new Error('Nội dung có ký tự giải mã/font lỗi.')
      if (/(?:半夏小說\s*[，,]\s*快樂很多|每日推薦|錯誤提交|問題類型|上一章|下一章|作者有[話话]要[說说]|營養液|<script\b)/iu.test(value)) {
        throw new Error('Nội dung Xbanxia còn phần lề/watermark/ghi chú tác giả.')
      }
    }

    const book = await tool.analyzeStoryUrl('https://www.xbanxia.cc/books/143300.html')
    if (book.site !== 'xbanxia' || book.chapters.length !== 165 || book.defaultSelectedChapterIds.length !== 164) {
      throw new Error(`Mục lục Xbanxia sai: ${book.site}/${book.chapters.length}/${book.defaultSelectedChapterIds.length}`)
    }
    const samples = [1, 82, 164].map((number) => {
      const chapter = book.chapters.find((candidate) => candidate.number === number)
      if (!chapter) throw new Error(`Thiếu chương ${number}.`)
      return chapter
    })
    const fetched = await tool.fetchStoryChapters({
      analysisId: book.analysisId,
      chapterIds: samples.map((chapter) => chapter.id),
    })
    fetched.chapters.forEach((chapter) => clean(chapter.sourceText))

    const direct = await tool.analyzeStoryUrl('https://www.xbanxia.cc/books/143300/28251886.html')
    if (direct.inputKind !== 'chapter' || direct.defaultSelectedChapterIds.length !== 1) {
      throw new Error('Link chương Xbanxia không chọn đúng một chương.')
    }
    const directFetched = await tool.fetchStoryChapters({
      analysisId: direct.analysisId,
      chapterIds: direct.defaultSelectedChapterIds,
    })
    clean(directFetched.combinedSource)
    return {
      site: book.site,
      bookTitle: book.bookTitle,
      catalogEntries: book.chapters.length,
      defaultSelected: book.defaultSelectedChapterIds.length,
      sampledNumbers: fetched.chapters.map((chapter) => chapter.number),
      sampledCharacters: fetched.chapters.map((chapter) => chapter.characterCount),
      directSelected: direct.defaultSelectedChapterIds.length,
      directCharacters: directFetched.chapters[0]?.characterCount,
    }
  })
  process.stdout.write(JSON.stringify({ ok: true, executable, ...result }, null, 2))
} finally {
  await application.close()
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}
