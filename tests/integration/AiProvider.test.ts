import { describe, expect, it, vi } from 'vitest'
import { AiProviderManager } from '../../src/main/ai/AiProviderManager'
import type { ChatGptWebAdapter, ChatGptStatusSnapshot } from '../../src/main/chatgpt/ChatGptWebAdapter'
import { KIMI_SELECTORS } from '../../src/main/chatgpt/selectors'
import { TranslationJobRunner, type TranslationEvent } from '../../src/main/translation/TranslationJobRunner'

function fakeAdapter(initial: ChatGptStatusSnapshot = { status: 'closed' }) {
  let snapshot = initial
  const listeners = new Set<(value: ChatGptStatusSnapshot) => void>()
  const adapter = {
    status: vi.fn(() => ({ ...snapshot })),
    onStatus: vi.fn((listener: (value: ChatGptStatusSnapshot) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    openLogin: vi.fn(async () => ({ ...snapshot })),
    refreshStatus: vi.fn(async () => ({ ...snapshot })),
    ensureReady: vi.fn(async () => undefined),
    startNewConversation: vi.fn(async () => undefined),
    sendAndWait: vi.fn(async () => 'Bản dịch hoàn chỉnh.'),
    cancelGeneration: vi.fn(async () => undefined),
    reloadForRecovery: vi.fn(async () => undefined),
    restartForRecovery: vi.fn(async () => undefined),
    close: vi.fn(async () => { snapshot = { status: 'closed' } }),
    emit(value: ChatGptStatusSnapshot) {
      snapshot = value
      listeners.forEach((listener) => listener(value))
    },
  }
  return adapter
}

function waitForEvent(
  runner: TranslationJobRunner,
  predicate: (event: TranslationEvent) => boolean,
): Promise<TranslationEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Quá thời gian chờ tiến trình.')), 5_000)
    const unsubscribe = runner.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })
}

describe('AI provider integration', () => {
  it('keeps ChatGPT and Kimi sessions separate and dispatches only to the selected provider', async () => {
    const chatgpt = fakeAdapter({ status: 'ready' })
    const kimi = fakeAdapter({ status: 'closed' })
    const persisted: string[] = []
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      persistProvider: async (provider) => { persisted.push(provider) },
    })

    await manager.selectProvider('kimi')
    await manager.ensureReady()
    await manager.sendAndWait('Nội dung thử')

    expect(chatgpt.close).toHaveBeenCalledOnce()
    expect(chatgpt.sendAndWait).not.toHaveBeenCalled()
    expect(kimi.ensureReady).toHaveBeenCalledOnce()
    expect(kimi.sendAndWait).toHaveBeenCalledWith('Nội dung thử', undefined)
    expect(persisted).toEqual(['kimi'])
    expect(manager.status().provider).toBe('kimi')
  })

  it('does not allow switching provider while the current AI is busy', async () => {
    const chatgpt = fakeAdapter({ status: 'busy' })
    const kimi = fakeAdapter()
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
    })

    await expect(manager.selectProvider('kimi')).rejects.toThrow(/đang chạy/u)
    expect(chatgpt.close).not.toHaveBeenCalled()
  })

  it('has the verified Kimi login, composer, send and response selector groups', () => {
    expect(KIMI_SELECTORS.loginLink.some((selector) => selector.includes('Log in'))).toBe(true)
    expect(KIMI_SELECTORS.composer).toContain('div.chat-input-editor[contenteditable="true"][data-lexical-editor="true"]')
    expect(KIMI_SELECTORS.sendButton).toContain('div.send-button-container:not(.disabled)')
    expect(KIMI_SELECTORS.assistantMessages.length).toBeGreaterThan(2)
  })

  it('stores Kimi in the checkpoint and re-selects it before opening the chat', async () => {
    const selected: string[] = []
    const saved = new Map<string, unknown>()
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: async (provider) => { selected.push(provider) },
        ensureReady: async () => undefined,
        startNewConversation: async () => undefined,
        sendAndWait: async () => 'Bản dịch hoàn chỉnh.',
        cancelGeneration: async () => undefined,
      },
      persistence: {
        saveJob: async (job: { id: string }) => { saved.set(job.id, structuredClone(job)) },
        loadJob: async <T>(id: string) => (saved.get(id) ?? null) as T | null,
      },
      validator: () => ({
        valid: true,
        issues: [],
        hanCharacters: [],
        metrics: {
          sourceCharacters: 10,
          translatedCharacters: 20,
          sourceHanCharacters: 10,
          remainingHanCharacters: 0,
          lengthRatio: 2,
        },
      }),
    })
    const completion = waitForEvent(runner, (event) => event.type === 'job-completed')
    const { jobId } = await runner.start({
      source: '她推开门。',
      promptMode: 'period',
      resolvedPrompt: 'Dịch sang tiếng Việt.',
      aiProvider: 'kimi',
    })
    await completion

    expect(selected).toEqual(['kimi'])
    expect((saved.get(jobId) as { aiProvider?: string }).aiProvider).toBe('kimi')
    expect((await runner.get(jobId)).aiProvider).toBe('kimi')
  })
})
