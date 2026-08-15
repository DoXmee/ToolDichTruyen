import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const workspace = path.resolve(import.meta.dirname, '..', '..')
const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-e2e-'))
const artifacts = path.join(workspace, 'test-results')
await mkdir(artifacts, { recursive: true })

const application = await electron.launch({
  executablePath: electronExecutable,
  args: [workspace],
  cwd: workspace,
  env: {
    ...process.env,
    TOOL_DICH_TRUYEN_USER_DATA: userData,
  },
})

const pageErrors = []
try {
  const page = await application.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Dịch Truyện' }).waitFor({ timeout: 20_000 })

  const bridge = await page.evaluate(() => ({
    hasBridge: Boolean(window.storyTool),
    methods: window.storyTool ? Object.keys(window.storyTool).sort() : [],
  }))
  if (!bridge.hasBridge) throw new Error('Preload bridge window.storyTool không tồn tại.')
  for (const method of [
    'loadPrompts', 'connectChatGPT', 'cleanupToolChat', 'startTranslation',
    'analyzeStoryUrl', 'openManualStoryVerification', 'revealHuliBrowserHelper',
    'fetchStoryChapters', 'cancelStoryFetch',
    'discoverTranslations', 'discardTranslation', 'chooseChapterDirectory', 'exportChapters', 'exportText', 'generateTitles',
  ]) {
    if (!bridge.methods.includes(method)) throw new Error(`Preload bridge thiếu ${method}.`)
  }

  const sourceEditor = page.getByLabel('Nội dung tiếng Trung cần dịch')
  const outputEditor = page.getByLabel('Nội dung truyện đã dịch')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1366, 720))
  await page.waitForTimeout(150)
  const unicodeSource = '第一章：重逢\n她轻轻推开门，看见多年未见的故人。\n繁體小說「測試」……'
  const unicodeOutput = 'Cô khẽ đẩy cửa, nhìn thấy người xưa đã nhiều năm không gặp.\n\nẮ ằ ễ ộ ỳ · A\u0306\u0301 a\u0306\u0300 e\u0302\u0303 o\u0323\u0302 y\u0300 😀'
  await sourceEditor.fill(unicodeSource)
  await outputEditor.fill(unicodeOutput)
  if (await sourceEditor.inputValue() !== unicodeSource || await outputEditor.inputValue() !== unicodeOutput) {
    throw new Error('Nội dung Unicode Trung–Việt không được giữ nguyên trong editor.')
  }

  const compactLayout = await page.evaluate(() => {
    const source = document.querySelector('.story-editor--source')
    const output = document.querySelector('.story-editor--output')
    if (!(source instanceof HTMLElement) || !(output instanceof HTMLElement)) {
      throw new Error('Không tìm thấy hai vùng biên tập.')
    }
    const sourceFont = getComputedStyle(source).fontFamily
    const outputFont = getComputedStyle(output).fontFamily
    const sourceStyle = getComputedStyle(source)
    const outputStyle = getComputedStyle(output)
    return {
      clientHeight: document.documentElement.clientHeight,
      fontMatches: sourceFont === outputFont,
      outputFont,
      fontSize: Number.parseFloat(outputStyle.fontSize),
      lineHeight: Number.parseFloat(outputStyle.lineHeight),
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      devicePixelRatio: window.devicePixelRatio,
      promptOverflow: getComputedStyle(document.querySelector('.prompt-panel')).overflowY,
      sourceLineHeight: Number.parseFloat(sourceStyle.lineHeight),
    }
  })
  if (!compactLayout.fontMatches || /Georgia|Times New Roman/i.test(compactLayout.outputFont)) {
    throw new Error(`Font biên tập không đồng nhất: ${JSON.stringify(compactLayout)}`)
  }
  if (!/Microsoft YaHei|Microsoft JhengHei|Noto Sans CJK|PingFang SC/i.test(compactLayout.outputFont)) {
    throw new Error(`Font biên tập thiếu fallback CJK: ${JSON.stringify(compactLayout)}`)
  }
  if (compactLayout.fontSize < 14 || compactLayout.lineHeight < 21 || compactLayout.sourceLineHeight < 21) {
    throw new Error(`Cỡ chữ/khoảng dòng biên tập quá nhỏ: ${JSON.stringify(compactLayout)}`)
  }
  if (compactLayout.scrollHeight > compactLayout.clientHeight) {
    throw new Error(`Bố cục 1366x720 còn cuộn dọc: ${JSON.stringify(compactLayout)}`)
  }
  if (compactLayout.scrollWidth > compactLayout.clientWidth) {
    throw new Error(`Bố cục 1366x720 còn cuộn ngang: ${JSON.stringify(compactLayout)}`)
  }
  if (compactLayout.devicePixelRatio >= 0.99 || compactLayout.promptOverflow === 'auto' || compactLayout.promptOverflow === 'scroll') {
    throw new Error(`Compact desktop zoom or prompt layout failed: ${JSON.stringify(compactLayout)}`)
  }
  await page.screenshot({ path: path.join(artifacts, 'electron-desktop.png') })

  await page.getByRole('tab', { name: 'Nhập link truyện' }).click()
  const storyUrlInput = page.getByLabel('Link bộ truyện hoặc chương truyện')
  await storyUrlInput.waitFor()
  const storyUrlPlaceholder = await storyUrlInput.getAttribute('placeholder')
  if (!storyUrlPlaceholder?.includes('Xbanxia')) {
    throw new Error(`Giao diện chưa công bố nguồn Xbanxia: ${storyUrlPlaceholder}`)
  }
  const linkLayout = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    importerOverflow: getComputedStyle(document.querySelector('.story-link-importer')).overflowY,
  }))
  if (linkLayout.scrollWidth > linkLayout.clientWidth || linkLayout.scrollHeight > linkLayout.clientHeight) {
    throw new Error(`Tab nhập link trống không vừa viewport 1366x720: ${JSON.stringify(linkLayout)}`)
  }
  if (linkLayout.importerOverflow === 'auto' || linkLayout.importerOverflow === 'scroll') {
    throw new Error(`Link importer is still forced into a scroll pane: ${JSON.stringify(linkLayout)}`)
  }
  await page.screenshot({ path: path.join(artifacts, 'electron-story-link.png') })

  // A short laptop screen with a Huliwang connection notice is the densest
  // normal desktop state. It must stay in one view without turning Bước 1 or
  // Bước 2 into scrollable cards.
  await page.evaluate(() => {
    const grid = document.querySelector('.translation-grid')
    const importer = document.querySelector('.story-link-importer')
    if (!(grid instanceof HTMLElement) || !(importer instanceof HTMLElement)) {
      throw new Error('Missing link workflow for compact notice check.')
    }
    const notice = document.createElement('div')
    notice.className = 'app-notice'
    notice.innerHTML = '<span>Huliwang requires the normal browser and daily profile. Connect the local helper, then the tool will analyze the link again.</span><button type="button">×</button>'
    grid.before(notice)
    importer.innerHTML = '<div class="story-url-row"><label class="story-url-field"><input value="https://m.huliwang.net/1703891/" /></label><button class="button button--secondary">Analyze</button></div><div class="story-manual-verification"><div><strong>Huliwang needs Microsoft Edge or Google Chrome with your daily profile.</strong><span>Connect the local helper and the tool will analyze the link again in that browser session.</span><span>First time: open the helper folder, enable Developer mode in the browser extension page, and load the unpacked helper.</span></div><button class="button button--primary">Connect normal browser</button><button class="button button--secondary">Open helper folder</button><button class="button button--secondary">Switch to paste text</button></div>'
  })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1338, 684))
  await page.waitForTimeout(150)
  const compactNoticeLayout = await page.evaluate(() => {
    const importer = document.querySelector('.story-link-importer')
    const prompt = document.querySelector('.prompt-panel')
    return {
      clientHeight: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      importerOverflow: importer ? getComputedStyle(importer).overflowY : 'missing',
      promptOverflow: prompt ? getComputedStyle(prompt).overflowY : 'missing',
      scrollHeight: document.documentElement.scrollHeight,
    }
  })
  if (
    compactNoticeLayout.scrollHeight > compactNoticeLayout.clientHeight ||
    compactNoticeLayout.devicePixelRatio >= 0.99 ||
    compactNoticeLayout.importerOverflow === 'auto' ||
    compactNoticeLayout.importerOverflow === 'scroll' ||
    compactNoticeLayout.promptOverflow === 'auto' ||
    compactNoticeLayout.promptOverflow === 'scroll'
  ) {
    throw new Error(`Compact Huliwang notice does not fit one screen: ${JSON.stringify(compactNoticeLayout)}`)
  }
  await page.screenshot({ path: path.join(artifacts, 'electron-compact-notice.png') })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1366, 720))
  await page.waitForTimeout(100)
  await page.getByRole('tab', { name: 'Dán nội dung' }).click()

  const chapterDrawer = page.locator('details.chapter-drawer')
  await chapterDrawer.locator('summary').click()
  await page.getByRole('heading', { name: /Chia chương tự động/u }).waitFor()
  const targetWords = await page.getByLabel('Số chữ/chương').inputValue()
  if (targetWords !== '800') {
    throw new Error(`Mục tiêu chia chương mặc định phải là 800, thực tế: ${targetWords}`)
  }
  await page.getByText(/1 chương/u).first().waitFor({ timeout: 10_000 })
  await page.screenshot({ path: path.join(artifacts, 'electron-chapter-expanded.png'), fullPage: true })

  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(780, 980))
  await page.screenshot({ path: path.join(artifacts, 'electron-narrow.png'), fullPage: true })

  if (pageErrors.length > 0) {
    throw new Error(`Renderer phát sinh lỗi: ${pageErrors.join(' | ')}`)
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    bridgeMethods: bridge.methods.length,
    screenshots: [
      path.join(artifacts, 'electron-desktop.png'),
      path.join(artifacts, 'electron-story-link.png'),
      path.join(artifacts, 'electron-compact-notice.png'),
      path.join(artifacts, 'electron-chapter-expanded.png'),
      path.join(artifacts, 'electron-narrow.png'),
    ],
  }, null, 2))
} finally {
  await application.close()
}
