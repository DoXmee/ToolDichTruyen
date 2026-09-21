import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiProviderManager } from '../../src/main/ai/AiProviderManager'
import { AccountRegistry } from '../../src/main/accounts/AccountRegistry'
import type { ChatGptWebAdapter, ChatGptStatusSnapshot } from '../../src/main/chatgpt/ChatGptWebAdapter'
import { DEEPSEEK_SELECTORS, GEMINI_SELECTORS, KIMI_SELECTORS } from '../../src/main/chatgpt/selectors'
import { TranslationJobRunner, type TranslationEvent } from '../../src/main/translation/TranslationJobRunner'

function fakeAdapter(initial: ChatGptStatusSnapshot = { status: 'closed' }) {
  let snapshot = initial
  const listeners = new Set<(value: ChatGptStatusSnapshot) => void>()
  const adapter = {
    status: vi.fn(() => ({ ...snapshot })),
    setManualLoginClosedHandler: vi.fn(),
    onStatus: vi.fn((listener: (value: ChatGptStatusSnapshot) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    openLogin: vi.fn(async () => ({ ...snapshot })),
    openManualLogin: vi.fn(async () => ({ ...snapshot })),
    refreshStatus: vi.fn(async () => ({ ...snapshot })),
    currentProfileDirectory: vi.fn(() => 'fake-profile'),
    useProfileDirectory: vi.fn(async (_directory: string, _options?: { authuser?: number }) => undefined),
    accountHint: vi.fn(() => ({ profileDirectory: 'fake-profile' })),
    readAccountIdentity: vi.fn(async () => undefined as { label: string; email?: string; plan?: string } | undefined),
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
  it('marks the active account verified when a provider connection becomes ready', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ai-provider-accounts-'))
    try {
      const chatgpt = fakeAdapter({ status: 'closed' })
      const kimi = fakeAdapter({ status: 'closed' })
      const deepseek = fakeAdapter({ status: 'ready' })
      const gemini = fakeAdapter({ status: 'closed' })
      let deepseekProfile = path.join(directory, 'deepseek-browser-profile')
      deepseek.currentProfileDirectory.mockImplementation(() => deepseekProfile)
      deepseek.useProfileDirectory.mockImplementation(async (directory) => { deepseekProfile = directory })
      deepseek.accountHint.mockImplementation(() => ({ profileDirectory: deepseekProfile }))
      deepseek.readAccountIdentity.mockResolvedValue({ label: 'Thành Đông' })
      const accounts = new AccountRegistry(directory)
      const manager = new AiProviderManager({
        initialProvider: 'deepseek',
        chatgpt: chatgpt as unknown as ChatGptWebAdapter,
        kimi: kimi as unknown as ChatGptWebAdapter,
        deepseek: deepseek as unknown as ChatGptWebAdapter,
        gemini: gemini as unknown as ChatGptWebAdapter,
        accounts,
        accountProfileRoot: path.join(directory, 'accounts'),
      })
      await manager.addAccount('deepseek')

      await expect(manager.openLogin()).resolves.toMatchObject({ provider: 'deepseek', status: 'ready' })

      const [account] = await accounts.listFor('deepseek')
      expect(account).toMatchObject({ label: 'Thành Đông' })
      expect(Date.parse(account!.lastVerifiedAt ?? '')).not.toBeNaN()
      expect(manager.activeAccountId('deepseek')).toBe(account!.id)
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('does not create a placeholder account before login verification succeeds', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ai-provider-accounts-'))
    try {
      const chatgpt = fakeAdapter({ status: 'closed' })
      const kimi = fakeAdapter({ status: 'closed' })
      const deepseek = fakeAdapter({ status: 'ready' })
      const gemini = fakeAdapter({ status: 'closed' })
      let deepseekProfile = path.join(directory, 'deepseek-browser-profile')
      deepseek.currentProfileDirectory.mockImplementation(() => deepseekProfile)
      deepseek.useProfileDirectory.mockImplementation(async (directory) => { deepseekProfile = directory })
      deepseek.accountHint.mockImplementation(() => ({ profileDirectory: deepseekProfile }))
      deepseek.readAccountIdentity.mockResolvedValue(undefined)
      const accounts = new AccountRegistry(directory)
      const manager = new AiProviderManager({
        initialProvider: 'deepseek',
        chatgpt: chatgpt as unknown as ChatGptWebAdapter,
        kimi: kimi as unknown as ChatGptWebAdapter,
        deepseek: deepseek as unknown as ChatGptWebAdapter,
        gemini: gemini as unknown as ChatGptWebAdapter,
        accounts,
        accountProfileRoot: path.join(directory, 'accounts'),
      })

      await expect(manager.addAccount('deepseek')).resolves.toBeUndefined()
      expect(await accounts.listFor('deepseek')).toEqual([])

      await expect(manager.openLogin()).resolves.toMatchObject({ provider: 'deepseek', status: 'ready' })
      expect(await accounts.listFor('deepseek')).toEqual([])
      expect(manager.activeAccountId('deepseek')).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('prepares a separate Gemini profile when adding another Gemini account', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ai-provider-accounts-'))
    try {
      const chatgpt = fakeAdapter({ status: 'closed' })
      const kimi = fakeAdapter({ status: 'closed' })
      const deepseek = fakeAdapter({ status: 'closed' })
      const gemini = fakeAdapter({ status: 'ready' })
      let geminiProfile = path.join(directory, 'gemini-browser-profile')
      gemini.currentProfileDirectory.mockImplementation(() => geminiProfile)
      gemini.useProfileDirectory.mockImplementation(async (directory) => { geminiProfile = directory })
      gemini.accountHint.mockImplementation(() => ({ profileDirectory: geminiProfile }))
      gemini.readAccountIdentity.mockResolvedValue({ label: 'Đông Thành', email: 'dong@example.com' })
      const accounts = new AccountRegistry(directory)
      const manager = new AiProviderManager({
        initialProvider: 'gemini',
        chatgpt: chatgpt as unknown as ChatGptWebAdapter,
        kimi: kimi as unknown as ChatGptWebAdapter,
        deepseek: deepseek as unknown as ChatGptWebAdapter,
        gemini: gemini as unknown as ChatGptWebAdapter,
        accounts,
        accountProfileRoot: path.join(directory, 'accounts'),
      })

      await expect(manager.addAccount('gemini')).resolves.toBeUndefined()

      expect(gemini.useProfileDirectory).toHaveBeenCalledWith(expect.stringContaining(path.join('accounts', 'gemini-')))
      expect(geminiProfile).not.toBe(path.join(directory, 'gemini-browser-profile'))
      expect(await accounts.listFor('gemini')).toEqual([])

      await expect(manager.openLogin()).resolves.toMatchObject({ provider: 'gemini', status: 'ready' })
      const [account] = await accounts.listFor('gemini')
      expect(account).toMatchObject({
        label: 'Đông Thành',
        email: 'dong@example.com',
        profileDirectory: geminiProfile,
      })
      expect(Date.parse(account!.lastVerifiedAt ?? '')).not.toBeNaN()
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('does not preserve an internal DeepSeek storage label when verification cannot read a name', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ai-provider-accounts-'))
    try {
      const chatgpt = fakeAdapter({ status: 'closed' })
      const kimi = fakeAdapter({ status: 'closed' })
      const deepseek = fakeAdapter({ status: 'ready' })
      const gemini = fakeAdapter({ status: 'closed' })
      const profileDirectory = path.join(directory, 'deepseek-browser-profile')
      deepseek.currentProfileDirectory.mockImplementation(() => profileDirectory)
      deepseek.accountHint.mockImplementation(() => ({ profileDirectory }))
      deepseek.readAccountIdentity.mockResolvedValue(undefined)
      const accounts = new AccountRegistry(directory)
      const stale = await accounts.register({
        provider: 'deepseek',
        label: '__appKit_@ /chat_ca50e4ac-e7cc-4e7b-a083-2c780a3b3793_ Storage',
        profileDirectory,
      })
      await accounts.markVerified(stale.id)
      const manager = new AiProviderManager({
        initialProvider: 'deepseek',
        chatgpt: chatgpt as unknown as ChatGptWebAdapter,
        kimi: kimi as unknown as ChatGptWebAdapter,
        deepseek: deepseek as unknown as ChatGptWebAdapter,
        gemini: gemini as unknown as ChatGptWebAdapter,
        accounts,
        accountProfileRoot: path.join(directory, 'accounts'),
      })

      await expect(manager.openLogin()).resolves.toMatchObject({ provider: 'deepseek', status: 'ready' })

      const [account] = await accounts.listFor('deepseek')
      expect(account).toMatchObject({ id: stale.id, label: 'DeepSeek AI' })
      expect(Date.parse(account!.lastVerifiedAt ?? '')).not.toBeNaN()
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('keeps ChatGPT and Kimi sessions separate and dispatches only to the selected provider', async () => {
    const chatgpt = fakeAdapter({ status: 'ready' })
    const kimi = fakeAdapter({ status: 'closed' })
    const deepseek = fakeAdapter({ status: 'closed' })
    const gemini = fakeAdapter({ status: 'closed' })
    const persisted: string[] = []
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      deepseek: deepseek as unknown as ChatGptWebAdapter,
      gemini: gemini as unknown as ChatGptWebAdapter,
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
    const deepseek = fakeAdapter()
    const gemini = fakeAdapter()
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      deepseek: deepseek as unknown as ChatGptWebAdapter,
      gemini: gemini as unknown as ChatGptWebAdapter,
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

  it('keeps DeepSeek selectors separate and dispatches to its own session', async () => {
    const chatgpt = fakeAdapter({ status: 'ready' })
    const kimi = fakeAdapter({ status: 'closed' })
    const deepseek = fakeAdapter({ status: 'closed' })
    const gemini = fakeAdapter({ status: 'closed' })
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      deepseek: deepseek as unknown as ChatGptWebAdapter,
      gemini: gemini as unknown as ChatGptWebAdapter,
    })

    await manager.selectProvider('deepseek')
    await manager.ensureReady()
    await manager.sendAndWait('Nội dung DeepSeek')

    expect(deepseek.ensureReady).toHaveBeenCalledOnce()
    expect(deepseek.sendAndWait).toHaveBeenCalledWith('Nội dung DeepSeek', undefined)
    expect(chatgpt.sendAndWait).not.toHaveBeenCalled()
    expect(kimi.sendAndWait).not.toHaveBeenCalled()
    expect(manager.status().provider).toBe('deepseek')
    expect(DEEPSEEK_SELECTORS.loginLink.some((selector) => selector.includes('Log in'))).toBe(true)
    expect(DEEPSEEK_SELECTORS.composer.some((selector) => selector.includes('DeepSeek'))).toBe(true)
    expect(DEEPSEEK_SELECTORS.toolConversationUserMessages).toContain('.ds-collapsible-text')
    expect(DEEPSEEK_SELECTORS.assistantMessages).toContain('.ds-assistant-message-main-content')
    expect(DEEPSEEK_SELECTORS.assistantTurnContainerFromMessage.some((selector) => selector.includes('ds-message'))).toBe(true)
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

  it('uses the provider selected by the user when resuming an older checkpoint', async () => {
    const selected: string[] = []
    const saved = new Map<string, unknown>()
    let releaseReadiness!: () => void
    const readinessStarted = new Promise<void>((resolve) => { releaseReadiness = resolve })
    let enteredReadiness!: () => void
    const readinessEntered = new Promise<void>((resolve) => { enteredReadiness = resolve })
    let firstReadiness = true
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: async (provider) => { selected.push(provider) },
        ensureReady: async () => {
          if (!firstReadiness) return
          firstReadiness = false
          enteredReadiness()
          await readinessStarted
        },
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

    const { jobId } = await runner.start({
      source: '她推开门。',
      promptMode: 'period',
      resolvedPrompt: 'Dịch sang tiếng Việt.',
      aiProvider: 'chatgpt',
    })
    await readinessEntered
    const pausing = runner.pause(jobId)
    releaseReadiness()
    await pausing
    await new Promise((resolve) => setTimeout(resolve, 0))

    const completion = waitForEvent(runner, (event) => event.type === 'job-completed')
    await runner.resume(jobId, 'deepseek')
    await completion

    expect(selected).toEqual(['chatgpt', 'deepseek'])
    expect((saved.get(jobId) as { aiProvider?: string }).aiProvider).toBe('deepseek')
    expect((await runner.get(jobId)).aiProvider).toBe('deepseek')
  })

  it('pause ChatGPT đang bận rồi đổi DeepSeek không nhảy ngược về provider cũ', async () => {
    const chatgpt = fakeAdapter({ status: 'ready' })
    const kimi = fakeAdapter({ status: 'closed' })
    const deepseek = fakeAdapter({ status: 'ready' })
    const gemini = fakeAdapter({ status: 'closed' })
    chatgpt.sendAndWait.mockImplementation((
      _message?: string,
      options?: { signal?: AbortSignal },
    ) => {
      chatgpt.emit({ status: 'busy' })
      return new Promise<string>((_resolve, reject) => {
        const rejectForPause = () => reject(
          options?.signal?.reason ?? new DOMException('Đã tạm dừng.', 'AbortError'),
        )
        if (options?.signal?.aborted) rejectForPause()
        else options?.signal?.addEventListener('abort', rejectForPause, { once: true })
      })
    })
    chatgpt.cancelGeneration.mockImplementation(async () => {
      chatgpt.emit({ status: 'ready' })
    })
    deepseek.sendAndWait.mockResolvedValue('Bản dịch DeepSeek hoàn chỉnh.')
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      deepseek: deepseek as unknown as ChatGptWebAdapter,
      gemini: gemini as unknown as ChatGptWebAdapter,
    })
    const saved = new Map<string, unknown>()
    const runner = new TranslationJobRunner({
      chatGpt: manager,
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
    const { jobId } = await runner.start({
      source: '她推开门。',
      promptMode: 'period',
      resolvedPrompt: 'Dịch sang tiếng Việt.',
      aiProvider: 'chatgpt',
    })
    await vi.waitFor(() => expect(chatgpt.sendAndWait).toHaveBeenCalledOnce())

    await runner.pause(jobId)
    expect(manager.status()).toMatchObject({ provider: 'chatgpt', status: 'ready' })
    await manager.selectProvider('deepseek')
    const completion = waitForEvent(runner, (event) => event.type === 'job-completed')
    await runner.resume(jobId, 'deepseek')
    await completion

    expect(manager.activeProvider()).toBe('deepseek')
    expect(chatgpt.sendAndWait).toHaveBeenCalledOnce()
    expect(deepseek.sendAndWait).toHaveBeenCalledOnce()
    expect((saved.get(jobId) as { aiProvider?: string }).aiProvider).toBe('deepseek')
  })

  it('uses DeepSeek selected by the user when retrying the exact failed segment', async () => {
    const selected: string[] = []
    const saved = new Map<string, unknown>()
    let provider: 'chatgpt' | 'deepseek' = 'chatgpt'
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: async (next) => { provider = next as 'chatgpt' | 'deepseek'; selected.push(next) },
        ensureReady: async () => undefined,
        startNewConversation: async () => undefined,
        sendAndWait: async () => provider === 'deepseek' ? 'OK-DEEPSEEK' : 'BAD-CHATGPT',
        cancelGeneration: async () => undefined,
      },
      persistence: {
        saveJob: async (job: { id: string }) => { saved.set(job.id, structuredClone(job)) },
        loadJob: async <T>(id: string) => (saved.get(id) ?? null) as T | null,
      },
      validator: (_source, translation) => ({
        valid: translation.startsWith('OK-'),
        issues: translation.startsWith('OK-') ? [] : [{
          code: 'source_echo', severity: 'error', message: 'Bản dịch lỗi.',
        }],
        hanCharacters: [],
        metrics: {
          sourceCharacters: 10, translatedCharacters: 10, sourceHanCharacters: 10,
          remainingHanCharacters: 0, lengthRatio: 1,
        },
      }),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')
    const { jobId } = await runner.start({
      source: '她推开门。', promptMode: 'period', resolvedPrompt: 'Dịch.',
      aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'], settings: { maxRetries: 0 },
    })
    await failed
    const failedSegment = (await runner.get(jobId)).segments[0]!
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.retrySegment({
      jobId,
      segmentId: failedSegment.id,
      aiProvider: 'deepseek',
    })
    await completed

    expect(selected).toEqual(['chatgpt', 'deepseek'])
    expect(await runner.get(jobId)).toMatchObject({
      status: 'completed', aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'],
    })
  })

  it('keeps Gemini selectors separate and dispatches to its own session', async () => {
    const chatgpt = fakeAdapter({ status: 'ready' })
    const kimi = fakeAdapter({ status: 'closed' })
    const deepseek = fakeAdapter({ status: 'closed' })
    const gemini = fakeAdapter({ status: 'closed' })
    const persisted: string[] = []
    const manager = new AiProviderManager({
      initialProvider: 'chatgpt',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      deepseek: deepseek as unknown as ChatGptWebAdapter,
      gemini: gemini as unknown as ChatGptWebAdapter,
      persistProvider: async (provider) => { persisted.push(provider) },
    })

    await manager.selectProvider('gemini')
    await manager.ensureReady()
    await manager.sendAndWait('Nội dung Gemini')

    expect(gemini.ensureReady).toHaveBeenCalledOnce()
    expect(gemini.sendAndWait).toHaveBeenCalledWith('Nội dung Gemini', undefined)
    expect(chatgpt.sendAndWait).not.toHaveBeenCalled()
    expect(kimi.sendAndWait).not.toHaveBeenCalled()
    expect(deepseek.sendAndWait).not.toHaveBeenCalled()
    expect(persisted).toEqual(['gemini'])
    expect(manager.status().provider).toBe('gemini')
    expect(GEMINI_SELECTORS.composer).toContain('div[contenteditable="true"][role="textbox"]')
    expect(GEMINI_SELECTORS.assistantMessages).toContain('message-content')
    expect(GEMINI_SELECTORS.loginLink.some((selector) => selector.includes('ServiceLogin'))).toBe(true)
    expect(GEMINI_SELECTORS.signedInMarkers?.some((selector) => selector.includes('SignOutOptions'))).toBe(true)
    expect(GEMINI_SELECTORS.assistantTurnContainerFromMessage.some((selector) => selector.includes('model-response'))).toBe(true)
    expect(GEMINI_SELECTORS.assistantMessages.length).toBeGreaterThan(2)
  })

  it('labels Gemini errors and status messages as Gemini instead of ChatGPT', async () => {
    const chatgpt = fakeAdapter({ status: 'ready' })
    const kimi = fakeAdapter({ status: 'closed' })
    const deepseek = fakeAdapter({ status: 'closed' })
    const gemini = fakeAdapter({ status: 'closed' })
    gemini.ensureReady.mockRejectedValue(
      new Error('ChatGPT Web chưa sẵn sàng. Hãy đăng nhập ChatGPT.'),
    )
    const manager = new AiProviderManager({
      initialProvider: 'gemini',
      chatgpt: chatgpt as unknown as ChatGptWebAdapter,
      kimi: kimi as unknown as ChatGptWebAdapter,
      deepseek: deepseek as unknown as ChatGptWebAdapter,
      gemini: gemini as unknown as ChatGptWebAdapter,
    })

    await expect(manager.ensureReady()).rejects.toThrow(
      'Gemini AI chưa sẵn sàng. Hãy đăng nhập Gemini AI.',
    )
  })

  it('accepts a four-chatbot pool and stores Gemini in the checkpoint', async () => {
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
      aiProvider: 'gemini',
      allowedAiProviders: ['chatgpt', 'kimi', 'deepseek', 'gemini'],
    })
    await completion

    expect(selected).toEqual(['gemini'])
    expect((saved.get(jobId) as { aiProvider?: string }).aiProvider).toBe('gemini')
    expect((saved.get(jobId) as { allowedAiProviders?: string[] }).allowedAiProviders).toEqual([
      'chatgpt', 'kimi', 'deepseek', 'gemini',
    ])
  })
})
