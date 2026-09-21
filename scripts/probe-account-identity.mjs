/**
 * Reads what each chatbot page exposes about the signed-in account and about
 * quota, so the account list can show real names instead of guesses.
 *
 *   node scripts/probe-account-identity.mjs <chatgpt|kimi|deepseek|gemini>
 */
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const provider = (process.argv[2] ?? 'chatgpt').toLowerCase()
const BASE_URLS = {
  chatgpt: 'https://chatgpt.com/',
  kimi: 'https://www.kimi.com/',
  deepseek: 'https://chat.deepseek.com/',
  gemini: 'https://gemini.google.com/app',
}
const baseUrl = process.argv[3] ?? BASE_URLS[provider]
if (!baseUrl) throw new Error(`Không biết URL cho ${provider}.`)

const appData = path.join(process.env.APPDATA ?? '', 'tool-dich-truyen')
const sourceProfile = path.join(appData, `${provider}-browser-profile`)
const workingProfile = await mkdtemp(path.join(tmpdir(), `probe-${provider}-`))
await cp(sourceProfile, workingProfile, {
  recursive: true,
  force: true,
  filter: (source) => !['Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache',
    'GPUPersistentCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'BrowserMetrics',
    'component_crx_cache', 'extensions_crx_cache'].includes(path.basename(source)),
})

let context
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
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(9_000)

  const report = await page.evaluate(() => {
    const textOf = (node) => (node?.textContent ?? '').trim().replace(/\s+/gu, " ").slice(0, 80)
    const visible = (node) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }
    const all = [...document.querySelectorAll('button, a, [role="button"], img, div[aria-label], span[aria-label]')]
    const accountish = all
      .filter((node) => {
        const hay = `${node.getAttribute("aria-label") ?? ""} ${textOf(node)} ${node.getAttribute("alt") ?? ""}`
        return /account|profile|tài khoản|avatar|user|đăng nhập|sign in|log in/iu.test(hay)
      })
      .filter(visible)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        aria: node.getAttribute("aria-label"),
        alt: node.getAttribute("alt"),
        text: textOf(node),
        testid: node.getAttribute("data-testid"),
      }))
      .slice(0, 14)
    const bodyText = document.body?.innerText ?? ""
    const emails = [...new Set((bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/gu) ?? []))].slice(0, 6)
    const quotaish = bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && /quota|hạn mức|giới hạn|limit|remaining|còn lại|resets?|đặt lại/iu.test(line))
      .slice(0, 8)
    return {
      url: location.href,
      title: document.title,
      accountish,
      profileish: [...document.querySelectorAll('[data-testid*="profile" i], [data-testid*="account" i], [class*="avatar" i], [id*="profile" i]')]
        .filter(visible)
        .map((node) => ({
          tag: node.tagName.toLowerCase(),
          testid: node.getAttribute("data-testid"),
          cls: (node.getAttribute("class") ?? "").slice(0, 50),
          aria: node.getAttribute("aria-label"),
          text: textOf(node),
        }))
        .slice(0, 10),
      topRightControls: [...document.querySelectorAll('button, [role="button"], a')]
        .filter((node) => {
          const rect = node.getBoundingClientRect()
          return visible(node) && rect.top < 140 && rect.right > window.innerWidth - 260
        })
        .map((node) => ({
          tag: node.tagName.toLowerCase(),
          testid: node.getAttribute("data-testid"),
          aria: node.getAttribute("aria-label"),
          text: textOf(node),
        }))
        .slice(0, 12),
      emails,
      testIds: [...new Set([...document.querySelectorAll("[data-testid]")]
        .map((node) => node.getAttribute("data-testid"))
        .filter(Boolean))].slice(0, 40),
      avatarImages: [...document.querySelectorAll("img")]
        .filter(visible)
        .map((node) => ({ alt: node.getAttribute("alt"), src: (node.getAttribute("src") ?? "").slice(0, 60) }))
        .slice(0, 8),
      allVisibleControls: [...document.querySelectorAll('button, [role="button"], a, [class*="avatar" i]')]
        .filter(visible)
        .map((node) => ({
          tag: node.tagName.toLowerCase(),
          cls: (node.getAttribute("class") ?? "").slice(0, 40),
          aria: node.getAttribute("aria-label"),
          text: textOf(node),
        }))
        .slice(0, 25),
      quotaish,
      bodyHead: bodyText.replace(/\s+/gu, " ").trim().slice(0, 220),
    }
  })

  // Some sites hide the account control inside a collapsed sidebar.
  const sidebarToggle = page.locator(
    '[data-testid="open-sidebar-button"], button[aria-label*="thanh bên" i], button[aria-label*="sidebar" i]',
  ).first()
  let expanded = null
  if (await sidebarToggle.count().catch(() => 0)) {
    await sidebarToggle.click().catch(() => undefined)
    await page.waitForTimeout(2_500)
    expanded = await page.evaluate(() => {
      const textOf = (node) => (node?.textContent ?? '').trim().replace(/\s+/gu, " ").slice(0, 80)
      const visible = (node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      }
      const bodyText = document.body?.innerText ?? ""
      return {
        emails: [...new Set((bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/gu) ?? []))].slice(0, 6),
        profileish: [...document.querySelectorAll('[data-testid*="profile" i], [data-testid*="account" i], img[alt]')]
          .filter(visible)
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            testid: node.getAttribute("data-testid"),
            aria: node.getAttribute("aria-label"),
            alt: node.getAttribute("alt"),
            text: textOf(node),
          }))
          .slice(0, 10),
        quotaish: bodyText.split("\n").map((line) => line.trim())
          .filter((line) => line && /quota|hạn mức|giới hạn|limit|remaining|còn lại|đặt lại/iu.test(line))
          .slice(0, 6),
      }
    })
  }

  process.stdout.write(`${JSON.stringify({ provider, ...report, expanded }, null, 2)}\n`)
} finally {
  await context?.close().catch(() => undefined)
  await rm(workingProfile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
}
