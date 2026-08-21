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
    'discoverTranslations', 'discardTranslation', 'chooseChapterDirectory', 'exportChapters', 'exportCombinedSourceChapters', 'exportText', 'generateTitles',
  ]) {
    if (!bridge.methods.includes(method)) throw new Error(`Preload bridge thiếu ${method}.`)
  }

  const sourceEditor = page.getByLabel('Nội dung tiếng Trung cần dịch')
  const outputEditor = page.getByLabel('Nội dung truyện đã dịch')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1366, 720))
  await page.waitForTimeout(500)
  const unicodeSource = '第一章：重逢\n她轻轻推开门，看见多年未见的故人。\n繁體小說「測試」……'
  const unicodeOutput = 'Cô khẽ đẩy cửa, nhìn thấy người xưa đã nhiều năm không gặp.\n\nẮ ằ ễ ộ ỳ · A\u0306\u0301 a\u0306\u0300 e\u0302\u0303 o\u0323\u0302 y\u0300 😀'
  await sourceEditor.fill(unicodeSource)
  await outputEditor.fill(unicodeOutput)
  if (await sourceEditor.inputValue() !== unicodeSource || await outputEditor.inputValue() !== unicodeOutput) {
    throw new Error('Nội dung Unicode Trung–Việt không được giữ nguyên trong editor.')
  }
  if ((await page.locator('.source-panel .editor-footer').innerText()).trim()) {
    throw new Error('Bước 1 vẫn hiển thị dòng thống kê chữ/ký tự thừa.')
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
  if (compactLayout.scrollWidth > compactLayout.clientWidth) {
    throw new Error(`Bố cục 1366x720 còn cuộn ngang: ${JSON.stringify(compactLayout)}`)
  }
  if (compactLayout.scrollHeight > compactLayout.clientHeight + 2) {
    throw new Error(`Bố cục 1366x720 chưa tự fit đủ một khung hình: ${JSON.stringify(compactLayout)}`)
  }
  if (compactLayout.devicePixelRatio >= 0.99 || compactLayout.promptOverflow === 'auto' || compactLayout.promptOverflow === 'scroll') {
    throw new Error(`Compact desktop zoom or prompt layout failed: ${JSON.stringify(compactLayout)}`)
  }
  const closedDrawer = page.locator('details.chapter-drawer')
  if (await closedDrawer.evaluate((drawer) => drawer.open) || !await closedDrawer.locator('summary').isVisible()) {
    throw new Error('Công cụ chia chương phải luôn hiện dạng thanh mở rộng được, không chiếm mất khung hình chính.')
  }
  if (await page.getByText('Không gian dịch & biên tập', { exact: true }).count() !== 0) {
    throw new Error('Dòng giới thiệu cũ vẫn chiếm diện tích giao diện chính.')
  }
  const windowControlLayout = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.window-titlebar__control')]
    const icons = [...document.querySelectorAll('.window-control-icon')]
    return {
      controls: controls.map((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
      icons: icons.map((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
    }
  })
  if (
    windowControlLayout.controls.length !== 3
    || windowControlLayout.icons.length !== 3
    || windowControlLayout.controls.some(({ width, height }) => width < 56 || height < 38)
    || windowControlLayout.icons.some(({ width, height }) => width < 13 || height < 13 || width > 15 || height > 15)
  ) {
    throw new Error(`Nút điều khiển cửa sổ bị co nhỏ hoặc lệch kích thước: ${JSON.stringify(windowControlLayout)}`)
  }
  await page.screenshot({ path: path.join(artifacts, 'electron-desktop.png') })

  const zoomBeforeThemeChange = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  )
  await page.evaluate(() => {
    window.__themeFrameSamples = []
    const root = document.documentElement
    const sample = () => {
      const panel = document.querySelector('.source-panel')
      const editor = document.querySelector('.story-editor')
      const prompt = document.querySelector('.prompt-card')
      window.__themeFrameSamples.push({
        switching: root.classList.contains('theme-switching'),
        panel: panel ? getComputedStyle(panel).backgroundColor : 'missing',
        editor: editor ? getComputedStyle(editor).backgroundColor : 'missing',
        prompt: prompt ? getComputedStyle(prompt).backgroundColor : 'missing',
        editorTransition: editor ? getComputedStyle(editor).transitionDuration : 'missing',
      })
    }
    const observer = new MutationObserver(() => {
      sample()
      requestAnimationFrame(() => {
        sample()
        requestAnimationFrame(() => {
          sample()
          requestAnimationFrame(sample)
        })
      })
      observer.disconnect()
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  })
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  await page.waitForTimeout(100)
  const themeFrameSamples = await page.evaluate(() => window.__themeFrameSamples ?? [])
  const changingColors = ['panel', 'editor', 'prompt'].some((key) =>
    new Set(themeFrameSamples.map((sample) => sample[key])).size > 1,
  )
  if (
    themeFrameSamples.length < 3
    || !themeFrameSamples[0].switching
    || themeFrameSamples[0].editorTransition !== '0s'
    || changingColors
  ) {
    throw new Error(`Chuyển theme còn tạo khung màu trung gian: ${JSON.stringify(themeFrameSamples)}`)
  }
  const darkLayout = await page.evaluate(() => {
    const toRgb = (value) => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number)
    const luminance = (rgb) => rgb.map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
    const panel = document.querySelector('.output-panel')
    if (!(panel instanceof HTMLElement)) throw new Error('Không tìm thấy vùng dịch để kiểm tra Dark Mode.')
    const style = getComputedStyle(panel)
    const foreground = luminance(toRgb(style.color))
    const background = luminance(toRgb(style.backgroundColor))
    return {
      theme: document.documentElement.dataset.theme,
      contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }
  })
  // Windows' compositor can need longer than Playwright's default while an
  // Electron title-bar overlay is settling after a theme switch.
  await page.screenshot({ path: path.join(artifacts, 'electron-dark.png'), timeout: 60_000 })
  const nativeDarkTheme = await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
  const zoomAfterThemeChange = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  )
  if (
    darkLayout.theme !== 'dark'
    || darkLayout.contrast < 4.5
    || nativeDarkTheme !== 'dark'
    || Math.abs((zoomAfterThemeChange ?? 0) - (zoomBeforeThemeChange ?? 0)) > 0.001
  ) {
    throw new Error(`Dark Mode không đủ tương phản hoặc làm vỡ bố cục: ${JSON.stringify(darkLayout)}`)
  }
  await page.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click()

  const zoomBeforeMinimize = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const zoom = window?.webContents.getZoomFactor()
    window?.minimize()
    return zoom
  })
  await page.waitForTimeout(180)
  const minimized = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore())
  await page.waitForTimeout(220)
  const restoredWindow = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { minimized: window?.isMinimized(), zoom: window?.webContents.getZoomFactor() }
  })
  if (
    !minimized
    || restoredWindow.minimized
    || Math.abs((restoredWindow.zoom ?? 0) - (zoomBeforeMinimize ?? 0)) > 0.001
  ) {
    throw new Error(`Thu nhỏ/khôi phục làm nhảy mức zoom: ${JSON.stringify({ minimized, restoredWindow, zoomBeforeMinimize })}`)
  }

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
  if (linkLayout.scrollWidth > linkLayout.clientWidth) {
    throw new Error(`Tab nhập link trống bị tràn ngang: ${JSON.stringify(linkLayout)}`)
  }
  if (linkLayout.scrollHeight > linkLayout.clientHeight + 2) {
    throw new Error(`Tab nhập link chưa tự fit đủ một khung hình: ${JSON.stringify(linkLayout)}`)
  }
  if (linkLayout.importerOverflow === 'auto' || linkLayout.importerOverflow === 'scroll') {
    throw new Error(`Link importer is still forced into a scroll pane: ${JSON.stringify(linkLayout)}`)
  }
  await page.screenshot({ path: path.join(artifacts, 'electron-story-link.png') })

  // A real catalog has its own bounded chapter-list scrollbar. It must not
  // push the always-visible chapter-splitting drawer outside the workspace.
  await page.evaluate(() => {
    const importer = document.querySelector('.story-link-importer')
    if (!(importer instanceof HTMLElement)) throw new Error('Missing importer for catalog fit test.')
    const rows = Array.from({ length: 208 }, (_, index) => `<label><input type="checkbox" />Chương ${index + 1}</label>`).join('')
    importer.innerHTML = `<div class="story-url-row"><label class="story-url-field"><input value="https://ixdzs8.com/read/646454/" /></label><button class="button">Phân tích</button></div><div class="story-chapter-list">${rows}</div>`
  })
  await page.waitForTimeout(500)
  const populatedCatalogLayout = await page.evaluate(() => {
    const drawer = document.querySelector('details.chapter-drawer')
    const summary = drawer?.querySelector('summary')
    const list = document.querySelector('.story-chapter-list')
    if (!(summary instanceof HTMLElement) || !(list instanceof HTMLElement)) throw new Error('Missing catalog fit elements.')
    const rect = summary.getBoundingClientRect()
    return {
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      drawerVisible: rect.top >= 0 && rect.bottom <= window.innerHeight,
      listOverflow: getComputedStyle(list).overflowY,
    }
  })
  if (
    populatedCatalogLayout.scrollHeight > populatedCatalogLayout.clientHeight + 2 ||
    !populatedCatalogLayout.drawerVisible ||
    !['auto', 'scroll'].includes(populatedCatalogLayout.listOverflow)
  ) {
    throw new Error(`Danh mục đông chương làm mất Công cụ chia chương: ${JSON.stringify(populatedCatalogLayout)}`)
  }

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
    compactNoticeLayout.devicePixelRatio >= 0.99 ||
    compactNoticeLayout.scrollHeight > compactNoticeLayout.clientHeight + 2 ||
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
  if (!await chapterDrawer.evaluate((drawer) => drawer.open)) await chapterDrawer.locator('summary').click()
  await page.getByRole('heading', { name: /Chia chương tự động/u }).waitFor()
  const targetWords = await page.getByLabel('Số chữ/chương').inputValue()
  if (targetWords !== '800') {
    throw new Error(`Mục tiêu chia chương mặc định phải là 800, thực tế: ${targetWords}`)
  }
  await page.getByText(/1 chương/u).first().waitFor({ timeout: 10_000 })
  await page.screenshot({ path: path.join(artifacts, 'electron-chapter-expanded.png'), fullPage: true })

  // Below the practical compact limit, the page itself must scroll instead of
  // cutting off the translation controls or forcing scrollbars into Step 1/2.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(780, 560))
  await page.waitForTimeout(150)
  const shortViewportLayout = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    pageOverflow: getComputedStyle(document.documentElement).overflowY,
    sourceOverflow: getComputedStyle(document.querySelector('.source-panel')).overflowY,
    promptOverflow: getComputedStyle(document.querySelector('.prompt-panel')).overflowY,
  }))
  if (
    shortViewportLayout.scrollHeight <= shortViewportLayout.clientHeight ||
    !['auto', 'scroll'].includes(shortViewportLayout.pageOverflow) ||
    ['auto', 'scroll'].includes(shortViewportLayout.sourceOverflow) ||
    ['auto', 'scroll'].includes(shortViewportLayout.promptOverflow)
  ) {
    throw new Error(`Màn hình thấp không chuyển sang cuộn trang an toàn: ${JSON.stringify(shortViewportLayout)}`)
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.getByText('Dữ liệu bản thảo được lưu trên thiết bị của bạn.').waitFor()

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
      path.join(artifacts, 'electron-dark.png'),
      path.join(artifacts, 'electron-chapter-expanded.png'),
      path.join(artifacts, 'electron-narrow.png'),
    ],
  }, null, 2))
} finally {
  await application.close()
}
