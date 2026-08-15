import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import { expect, it } from 'vitest'
import { buildTranslationPrompt } from '../../src/core/promptBuilder'
import { ChatGptWebAdapter } from '../../src/main/chatgpt/ChatGptWebAdapter'

const seedProfile = process.env.TOOL_DICH_TRUYEN_SEED_PROFILE?.trim()
const live = seedProfile ? it : it.skip

interface AdapterInternals {
  page?: Page;
}

live('dịch thật bằng prompt niên đại với profile tạm', { timeout: 300_000 }, async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-adapter-live-'))
  const profile = path.join(userData, 'chatgpt-browser-profile')
  const ownershipStatePath = path.join(userData, 'chatgpt-tool-conversation.json')
  await cp(seedProfile!, profile, { recursive: true, force: true })
  const adapter = new ChatGptWebAdapter({ profileDirectory: profile, headless: false })
  const samples: Array<Record<string, unknown>> = []
  let settled = false
  let response = ''
  let failure: unknown
  let primaryError: unknown
  let cleanupError: unknown
  let closeError: unknown
  let translationMayHaveSubmitted = false

  try {
    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await adapter.startNewConversation()
    const basePrompt = await readFile(path.resolve('resources/prompts/nien-dai.txt'), 'utf8')
    const prompt = buildTranslationPrompt({
      basePrompt,
      sourceText: '你好。',
      segmentIndex: 0,
      totalSegments: 1,
      segmentId: 'live-probe-1',
    })
    translationMayHaveSubmitted = true
    void adapter.sendAndWait(prompt, { timeoutMs: 180_000 }).then(
      (value) => {
        response = value
        settled = true
      },
      (error: unknown) => {
        failure = error
        settled = true
      },
    )

    for (let index = 0; index < 50 && !settled; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      const page = (adapter as unknown as AdapterInternals).page
      if (!page || page.isClosed()) continue
      samples.push({
        elapsedSeconds: (index + 1) * 4,
        urlPath: new URL(page.url()).pathname,
        userCount: await page.locator('[data-message-author-role="user"]').count(),
        assistantCount: await page.locator('[data-message-author-role="assistant"]').count(),
        assistantTextLengths: await page.locator('[data-message-author-role="assistant"]')
          .evaluateAll((elements) => elements.map((element) => (element.textContent || '').trim().length)),
        stopCount: await page.locator('[data-testid="stop-button"], button[aria-label*="Stop"]').count(),
        copyCount: await page.locator('[data-testid="copy-turn-action-button"]').count(),
        retryCount: await page.locator('button:has-text("Retry"), button:has-text("Regenerate"), button:has-text("Thử lại")').count(),
      })
    }

    process.stdout.write(`\nCHATGPT_ADAPTER_LIVE=${JSON.stringify({ samples, settled, responseLength: response.length, error: failure instanceof Error ? failure.message : failure ? String(failure) : null })}\n`)
    if (failure) throw failure
    expect(settled).toBe(true)
    expect(response).not.toMatch(/\p{Script=Han}/u)
    expect(response.trim().length).toBeGreaterThan(0)
  } catch (error) {
    primaryError = error
  } finally {
    if (translationMayHaveSubmitted) {
      try {
        await adapter.startNewConversation()
        const state = JSON.parse(await readFile(ownershipStatePath, 'utf8')) as {
          version?: unknown;
          conversation?: unknown;
        }
        if (state.version !== 3 || state.conversation !== null) {
          throw new Error('State ownership v3 chưa được clear sau cleanup exact chat live.')
        }
      } catch (error) {
        cleanupError = new Error(
          `Không cleanup được chat adapter live; giữ lại userData để phục hồi: ${userData}`,
          { cause: error },
        )
      }
    }
    try {
      await adapter.close()
    } catch (error) {
      closeError = new Error(`Không đóng được adapter live; giữ lại userData: ${userData}`, {
        cause: error,
      })
    }
    if (!cleanupError && !closeError) {
      await rm(userData, { recursive: true, force: true })
    }
  }

  const failures = [primaryError, cleanupError, closeError].filter(Boolean)
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Adapter live hoặc cleanup chat gặp nhiều lỗi.')
  }
  if (failures[0]) throw failures[0]
})
