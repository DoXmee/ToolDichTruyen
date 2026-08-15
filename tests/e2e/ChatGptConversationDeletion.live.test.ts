import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import { expect, it } from 'vitest'
import { ChatGptWebAdapter } from '../../src/main/chatgpt/ChatGptWebAdapter'
import {
  FileConversationStateStore,
  type ToolCreatedConversation,
} from '../../src/main/chatgpt/conversationState'

const seedProfile = process.env.TOOL_DICH_TRUYEN_SEED_PROFILE?.trim()
const live = seedProfile ? it : it.skip
const workspace = path.resolve(import.meta.dirname, '..', '..')

const CONVERSATION_NOT_FOUND_PATTERNS = [
  /conversation not found/iu,
  /unable to load (?:this )?conversation/iu,
  /this conversation (?:does not|doesn't) exist/iu,
  /không tìm thấy (?:cuộc|đoạn) trò chuyện/iu,
  /không thể tải (?:cuộc|đoạn) trò chuyện/iu,
  /(?:cuộc|đoạn) trò chuyện (?:không còn|không tồn tại)/iu,
] as const

interface AdapterInternals {
  page?: Page;
}

function activePage(adapter: ChatGptWebAdapter): Page {
  const page = (adapter as unknown as AdapterInternals).page
  if (!page || page.isClosed()) throw new Error('Không tìm thấy trang ChatGPT live.')
  return page
}

async function currentUserTurns(page: Page): Promise<string[]> {
  return page.locator('main [data-message-author-role="user"], [role="main"] [data-message-author-role="user"]')
    .allInnerTexts()
}

function normalizedPath(value: string): string {
  return value.replace(/\/+$/u, '') || '/'
}

async function proveConversationUnavailable(
  adapter: ChatGptWebAdapter,
  page: Page,
  targetUrl: string,
): Promise<{ disposition: 'not-found' | 'root-ready'; url: string }> {
  const target = new URL(targetUrl)
  const targetPath = normalizedPath(target.pathname)
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

  const deadline = Date.now() + 20_000
  let lastStatusText = ''
  do {
    const current = new URL(page.url())
    const currentPath = normalizedPath(current.pathname)
    if (current.origin !== target.origin) {
      throw new Error(`TARGET chuyển sang origin không an toàn khi xác minh xóa: ${current.origin}`)
    }

    if (currentPath === '/') {
      const status = await adapter.refreshStatus(5_000)
      const afterStatus = new URL(page.url())
      if (status.status === 'ready' && normalizedPath(afterStatus.pathname) === '/') {
        return { disposition: 'root-ready', url: afterStatus.toString() }
      }
    }

    // Do not scan the sidebar: an unrelated conversation title containing an
    // error phrase must not count as proof that TARGET is unavailable.
    lastStatusText = (await page.locator('main, [role="main"], [role="alert"]')
      .allInnerTexts()
      .catch(() => []))
      .join('\n')
    const explicitNotFound = CONVERSATION_NOT_FOUND_PATTERNS.some((pattern) =>
      pattern.test(lastStatusText),
    )
    const isExactTarget = currentPath === targetPath
    const isNonConversationErrorPage = !currentPath.startsWith('/c/')
    if (explicitNotFound && (isExactTarget || isNonConversationErrorPage)) {
      return { disposition: 'not-found', url: current.toString() }
    }

    if (Date.now() < deadline) await page.waitForTimeout(250)
  } while (Date.now() < deadline)

  const sample = lastStatusText.replace(/\s+/gu, ' ').trim().slice(0, 240)
  throw new Error(
    `Không chứng minh được TARGET đã bị xóa: URL vẫn là ${page.url()} và không có trạng thái not-found rõ ràng.` +
    (sample ? ` Nội dung trang: ${sample}` : ''),
  )
}

function cleanupError(message: string, cause: unknown): Error {
  return new Error(message, { cause })
}

async function submitAndTrack(
  adapter: ChatGptWebAdapter,
  store: FileConversationStateStore,
  prompt: string,
) {
  let responseObserved = true
  try {
    await adapter.sendAndWait(prompt, { timeoutMs: 45_000 })
  } catch {
    // The ownership state is persisted immediately after submit and before
    // response polling. A slow/rate-limited assistant must not prevent this
    // deletion-specific test from verifying exact-ID cleanup.
    responseObserved = false
  }
  const conversation = await store.load()
  if (!conversation) throw new Error('ChatGPT đã nhận prompt nhưng tool không lưu được state sở hữu.')
  return { conversation, responseObserved }
}

live('xóa đúng TARGET do tool tạo và giữ nguyên CONTROL', { timeout: 420_000 }, async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-delete-live-'))
  const profile = path.join(userData, 'chatgpt-browser-profile')
  const artifactDirectory = path.join(workspace, 'test-results')
  const runId = randomUUID()
  const targetStatePath = path.join(artifactDirectory, `live-delete-${runId}-target.json`)
  const controlStatePath = path.join(artifactDirectory, `live-delete-${runId}-control.json`)
  const targetStore = new FileConversationStateStore(targetStatePath)
  const controlStore = new FileConversationStateStore(controlStatePath)
  const targetMarker = `TOOL_DELETE_TARGET_${randomUUID()}`
  const controlMarker = `TOOL_DELETE_CONTROL_${randomUUID()}`
  const targetPrompt = `Bài kiểm thử của Tool dịch truyện. Hãy trả lời ngắn gọn: OK. Mã: ${targetMarker}`
  const controlPrompt = `Bài kiểm thử của Tool dịch truyện. Hãy trả lời ngắn gọn: OK. Mã: ${controlMarker}`
  const adapters: ChatGptWebAdapter[] = []

  await mkdir(artifactDirectory, { recursive: true })
  await cp(seedProfile!, profile, { recursive: true, force: true })

  let targetResponseObserved = false
  let controlResponseObserved = false
  let targetReopenDisposition: 'not-found' | 'root-ready' | undefined
  let targetConversation: ToolCreatedConversation | undefined
  let controlConversation: ToolCreatedConversation | undefined
  let targetDeletionProven = false
  let controlDeletionProven = false
  let primaryError: Error | undefined
  const teardownErrors: Error[] = []

  try {
    const targetCreator = new ChatGptWebAdapter({
      profileDirectory: profile,
      headless: false,
      conversationStateStore: targetStore,
    })
    adapters.push(targetCreator)
    await expect(targetCreator.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await targetCreator.startNewConversation()
    const targetSubmission = await submitAndTrack(targetCreator, targetStore, targetPrompt)
    const target = targetSubmission.conversation
    targetConversation = target
    targetResponseObserved = targetSubmission.responseObserved
    expect(target?.url).toMatch(/^https:\/\/chatgpt\.com\/c\//u)
    expect(target?.ownershipHashes).toHaveLength(1)
    await targetCreator.close()

    const controlCreator = new ChatGptWebAdapter({
      profileDirectory: profile,
      headless: false,
      conversationStateStore: controlStore,
    })
    adapters.push(controlCreator)
    await expect(controlCreator.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await controlCreator.startNewConversation()
    const controlSubmission = await submitAndTrack(controlCreator, controlStore, controlPrompt)
    const control = controlSubmission.conversation
    controlConversation = control
    controlResponseObserved = controlSubmission.responseObserved
    expect(control?.url).toMatch(/^https:\/\/chatgpt\.com\/c\//u)
    expect(control?.id).not.toBe(target?.id)
    await controlCreator.close()

    const targetCleaner = new ChatGptWebAdapter({
      profileDirectory: profile,
      headless: false,
      conversationStateStore: targetStore,
    })
    adapters.push(targetCleaner)
    await expect(targetCleaner.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(targetCleaner.startNewConversation()).resolves.toBeUndefined()
    await expect(targetStore.load()).resolves.toBeUndefined()

    const verificationPage = activePage(targetCleaner)
    const targetReopen = await proveConversationUnavailable(
      targetCleaner,
      verificationPage,
      target!.url,
    )
    targetReopenDisposition = targetReopen.disposition
    targetDeletionProven = true
    const targetTurnsAfterDelete = await currentUserTurns(verificationPage)
    expect(targetTurnsAfterDelete.some((turn) => turn.includes(targetMarker))).toBe(false)

    await verificationPage.goto(control!.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await verificationPage.locator('main [data-message-author-role="user"], [role="main"] [data-message-author-role="user"]')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
    expect(new URL(verificationPage.url()).pathname).toBe(new URL(control!.url).pathname)
    const controlTurns = await currentUserTurns(verificationPage)
    expect(controlTurns.some((turn) => turn.includes(controlMarker))).toBe(true)
    await targetCleaner.close()

    // Clean up the CONTROL chat through the same exact-ID + ownership-marker guard.
    const controlCleaner = new ChatGptWebAdapter({
      profileDirectory: profile,
      headless: false,
      conversationStateStore: controlStore,
    })
    adapters.push(controlCleaner)
    await expect(controlCleaner.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(controlCleaner.startNewConversation()).resolves.toBeUndefined()
    await expect(controlStore.load()).resolves.toBeUndefined()
    controlDeletionProven = true
  } catch (error) {
    primaryError = error instanceof Error
      ? error
      : cleanupError('Luồng live delete ném lỗi không phải Error.', error)
  } finally {
    for (const [index, adapter] of adapters.entries()) {
      try {
        await adapter.close()
      } catch (error) {
        teardownErrors.push(cleanupError(`Không đóng được adapter live thứ ${index + 1}.`, error))
      }
    }

    for (const [label, store, statePath, snapshot, deletionProven] of [
      ['TARGET', targetStore, targetStatePath, targetConversation, targetDeletionProven],
      ['CONTROL', controlStore, controlStatePath, controlConversation, controlDeletionProven],
    ] as const) {
      let conversation: ToolCreatedConversation | undefined
      try {
        conversation = await store.load()
        // startNewConversation clears state before this test re-opens the URL
        // for independent proof. If that proof failed, restore the exact
        // ownership snapshot so teardown can safely retry instead of orphaning
        // the remote chat with a null local state.
        if (!conversation && !deletionProven && snapshot) {
          await store.save(snapshot)
          conversation = snapshot
        }
        if (conversation && snapshot && conversation.id !== snapshot.id) {
          throw new Error(
            `State ${label} trỏ tới ID ${conversation.id}, khác snapshot ${snapshot.id}.`,
          )
        }
      } catch (error) {
        teardownErrors.push(cleanupError(
          `Không đọc được state ${label}; giữ profile và state để phục hồi: ${statePath}`,
          error,
        ))
        continue
      }
      if (!conversation) continue

      const cleaner = new ChatGptWebAdapter({
        profileDirectory: profile,
        headless: false,
        conversationStateStore: store,
      })
      try {
        const status = await cleaner.openLogin()
        if (status.status !== 'ready') {
          throw new Error(status.message ?? `ChatGPT ở trạng thái ${status.status}`)
        }
        await cleaner.startNewConversation()
        if (await store.load()) {
          throw new Error(`State ${label} vẫn còn conversation sau cleanup.`)
        }
      } catch (error) {
        teardownErrors.push(cleanupError(
          `Không cleanup được ${label}; giữ profile và state để phục hồi: ${statePath}`,
          error,
        ))
      } finally {
        try {
          await cleaner.close()
        } catch (error) {
          teardownErrors.push(cleanupError(
            `Không đóng được adapter cleanup ${label}; giữ profile và state để kiểm tra.`,
            error,
          ))
        }
      }
    }

    if (primaryError === undefined && teardownErrors.length === 0) {
      for (const statePath of [targetStatePath, controlStatePath]) {
        try {
          await rm(statePath, { force: true })
        } catch (error) {
          teardownErrors.push(cleanupError(`Không xóa được state live đã cleanup: ${statePath}`, error))
        }
      }
    }
    if (primaryError === undefined && teardownErrors.length === 0) {
      try {
        await rm(userData, { recursive: true, force: true })
      } catch (error) {
        teardownErrors.push(cleanupError(
          `Không xóa được profile live tạm sau khi cleanup: ${userData}`,
          error,
        ))
      }
    }
  }

  const failures: Error[] = [...teardownErrors]
  if (primaryError !== undefined) failures.unshift(primaryError)
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Live delete hoặc cleanup gặp nhiều lỗi; giữ dữ liệu phục hồi tại ${userData}.`,
    )
  }
  if (failures[0]) throw failures[0]

  process.stdout.write(`\nCHATGPT_DELETE_LIVE=${JSON.stringify({
    targetDeleted: true,
    targetReopenDisposition,
    controlPreservedBeforeCleanup: true,
    controlCleaned: true,
    targetResponseObserved,
    controlResponseObserved,
  })}\n`)
})
