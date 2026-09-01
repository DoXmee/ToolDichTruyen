import { describe, expect, it, vi } from 'vitest'
import { TranslationJobRunner, type TranslationEvent } from '../../src/main/translation/TranslationJobRunner'
import type { AiProvider, TranslationValidationResult } from '../../src/shared/types'

function createPersistence() {
  const values = new Map<string, unknown>()
  return {
    values,
    async saveJob(job: { id: string }) {
      values.set(job.id, structuredClone(job))
    },
    async loadJob<T>(id: string): Promise<T | null> {
      return (values.has(id) ? structuredClone(values.get(id)) : null) as T | null
    },
  }
}

function waitForEvent(
  runner: TranslationJobRunner,
  predicate: (event: TranslationEvent) => boolean,
): Promise<TranslationEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Quá thời gian chờ chuyển AI: ${JSON.stringify(runner.activeJobs())}`))
    }, 5_000)
    const unsubscribe = runner.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })
}

function validation(candidate: string): TranslationValidationResult {
  const valid = candidate.startsWith('OK-')
  return {
    valid,
    issues: valid ? [] : [{
      code: 'source_echo',
      severity: 'error',
      message: 'Phản hồi không đạt kiểm tra chất lượng.',
    }],
    hanCharacters: [],
    metrics: {
      sourceCharacters: 100,
      translatedCharacters: candidate.length,
      sourceHanCharacters: 10,
      remainingHanCharacters: 0,
      lengthRatio: 1,
    },
  }
}

function chunks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `segment-${index + 1}`,
    index,
    start: index,
    end: index + 1,
    text: `SOURCE-${index + 1}`,
  }))
}

function sourceNumber(prompt: string): number {
  const match = /SOURCE-(\d+)/u.exec(prompt)
  return Number.parseInt(match?.[1] ?? '0', 10)
}

describe('automatic AI provider failover', () => {
  it('exhausts every ordinary retry on ChatGPT before switching to Kimi', async () => {
    let provider: AiProvider = 'chatgpt'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => {
          sends.push(provider)
          return provider === 'kimi' ? 'OK-KIMI' : 'BAD-CHATGPT'
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', settings: { maxRetries: 2 },
    })
    await completed

    expect(sends).toEqual(['chatgpt', 'chatgpt', 'chatgpt', 'kimi'])
  }, 20_000)

  it('falls back after transport/no-response retries are exhausted', async () => {
    let provider: AiProvider = 'chatgpt'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => {
          sends.push(provider)
          if (provider === 'chatgpt') throw new Error('Không có phản hồi từ trang AI.')
          return 'OK-KIMI'
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', settings: { maxRetries: 1 },
    })
    await completed

    expect(sends).toEqual(['chatgpt', 'chatgpt', 'kimi'])
  }, 20_000)

  it('switches providers when readiness or chat setup fails before a send', async () => {
    let provider: AiProvider = 'chatgpt'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => {
          if (provider === 'chatgpt') throw new Error('Trình duyệt ChatGPT không phản hồi.')
        }),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => { sends.push(provider); return 'OK-KIMI' }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', settings: { maxRetries: 0 },
    })
    await completed

    expect(sends).toEqual(['kimi'])
  })

  it('reloads twice and restarts the selected provider before lifecycle failover', async () => {
    let provider: AiProvider = 'chatgpt'
    let readinessChecks = 0
    const selected: AiProvider[] = []
    const reloadForRecovery = vi.fn(async () => undefined)
    const restartForRecovery = vi.fn(async () => undefined)
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next; selected.push(next) }),
        ensureReady: vi.fn(async () => {
          readinessChecks += 1
          if (readinessChecks <= 3) throw new Error('Trang AI chưa hydrate xong.')
        }),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => { sends.push(provider); return 'OK-CHATGPT' }),
        cancelGeneration: vi.fn(async () => undefined),
        reloadForRecovery,
        restartForRecovery,
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', settings: { maxRetries: 0 },
    })
    await completed

    expect(readinessChecks).toBe(4)
    expect(reloadForRecovery).toHaveBeenCalledTimes(2)
    expect(restartForRecovery).toHaveBeenCalledOnce()
    expect(selected).toEqual(['chatgpt', 'chatgpt', 'chatgpt', 'chatgpt'])
    expect(sends).toEqual(['chatgpt'])
  })

  it('lets Kimi rescue an exhausted ChatGPT segment, then returns to ChatGPT', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'chatgpt'
    const selected: AiProvider[] = []
    const sends: Array<{ provider: AiProvider; segment: number }> = []
    const timeouts: number[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next; selected.push(next) }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async (prompt: string, options) => {
          const segment = sourceNumber(prompt)
          sends.push({ provider, segment })
          timeouts.push(options.timeoutMs)
          return provider === 'kimi' || segment === 2 ? `OK-${provider}-${segment}` : 'BAD-CHATGPT'
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(2),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'SOURCE-1 SOURCE-2',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt',
      settings: { maxRetries: 0 },
    })
    await completed

    expect(sends).toEqual([
      { provider: 'chatgpt', segment: 1 },
      { provider: 'kimi', segment: 1 },
      { provider: 'chatgpt', segment: 2 },
    ])
    expect(selected).toEqual(['chatgpt', 'kimi', 'chatgpt'])
    expect(timeouts).toEqual([480_000, 900_000, 480_000])
    expect((await runner.get(jobId)).aiProvider).toBe('chatgpt')
    const saved = persistence.values.get(jobId) as { providerFailover: { chatgptRescueCycles: number; mode: string } }
    expect(saved.providerFailover).toMatchObject({ chatgptRescueCycles: 1, mode: 'primary-chatgpt' })
  })

  it('uses three temporary Kimi rescues, then promotes Kimi after the next ChatGPT failure', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'chatgpt'
    const selected: AiProvider[] = []
    const sends: Array<{ provider: AiProvider; segment: number }> = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next; selected.push(next) }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async (prompt: string) => {
          const segment = sourceNumber(prompt)
          sends.push({ provider, segment })
          return provider === 'kimi' ? `OK-KIMI-${segment}` : 'BAD-CHATGPT'
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(5),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'five segments',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt',
      settings: { maxRetries: 0 },
    })
    await completed

    expect(sends).toEqual([
      { provider: 'chatgpt', segment: 1 }, { provider: 'kimi', segment: 1 },
      { provider: 'chatgpt', segment: 2 }, { provider: 'kimi', segment: 2 },
      { provider: 'chatgpt', segment: 3 }, { provider: 'kimi', segment: 3 },
      { provider: 'chatgpt', segment: 4 }, { provider: 'kimi', segment: 4 },
      { provider: 'kimi', segment: 5 },
    ])
    expect(selected).toEqual([
      'chatgpt', 'kimi', 'chatgpt', 'kimi', 'chatgpt', 'kimi', 'chatgpt', 'kimi',
    ])
    expect((await runner.get(jobId)).aiProvider).toBe('kimi')
    const saved = persistence.values.get(jobId) as { providerFailover: { chatgptRescueCycles: number; mode: string } }
    expect(saved.providerFailover).toMatchObject({ chatgptRescueCycles: 3, mode: 'kimi-primary' })
  })

  it('lets ChatGPT rescue permanent Kimi, then returns to Kimi for the next segment', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'kimi'
    const sends: Array<{ provider: AiProvider; segment: number }> = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async (prompt: string) => {
          const segment = sourceNumber(prompt)
          sends.push({ provider, segment })
          if (segment === 1 && provider === 'kimi') return 'BAD-KIMI'
          return `OK-${provider}-${segment}`
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(2),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'two segments',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'kimi',
      allowedAiProviders: ['kimi', 'chatgpt'],
      settings: { maxRetries: 0 },
    })
    await completed

    expect(sends).toEqual([
      { provider: 'kimi', segment: 1 },
      { provider: 'chatgpt', segment: 1 },
      { provider: 'kimi', segment: 2 },
    ])
    expect((await runner.get(jobId)).aiProvider).toBe('kimi')
  })

  it('stops only after permanent Kimi and its final ChatGPT fallback both fail', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'kimi'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => { sends.push(provider); return `BAD-${provider}` }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: 'one segment',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'kimi',
      allowedAiProviders: ['kimi', 'chatgpt'],
      settings: { maxRetries: 0 },
    })
    await failed

    expect(sends).toEqual(['kimi', 'chatgpt'])
    const snapshot = await runner.get(jobId)
    expect(snapshot.status).toBe('failed')
    expect(snapshot.segments[0]?.status).toBe('failed')
  })

  it('lets ChatGPT rescue DeepSeek, then returns to DeepSeek with its own timeout', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'deepseek'
    const sends: Array<{ provider: AiProvider; segment: number; timeout: number }> = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async (prompt: string, options) => {
          const segment = sourceNumber(prompt)
          sends.push({ provider, segment, timeout: options.timeoutMs })
          if (segment === 1 && provider === 'deepseek') return 'BAD-DEEPSEEK'
          return `OK-${provider}-${segment}`
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(2),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'two segments',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'deepseek',
      settings: { maxRetries: 0, responseTimeoutMs: 1_200_000 },
    })
    await completed

    expect(sends).toEqual([
      { provider: 'deepseek', segment: 1, timeout: 1_200_000 },
      { provider: 'chatgpt', segment: 1, timeout: 1_200_000 },
      { provider: 'deepseek', segment: 2, timeout: 1_200_000 },
    ])
    expect((await runner.get(jobId)).aiProvider).toBe('deepseek')
    expect(persistence.values.get(jobId)).toMatchObject({
      providerFailover: { mode: 'deepseek-primary', baseProvider: 'deepseek' },
    })
  })

  it('stops only after DeepSeek and its final ChatGPT fallback both fail', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'deepseek'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => { sends.push(provider); return `BAD-${provider}` }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: 'one segment',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'deepseek',
      allowedAiProviders: ['deepseek', 'chatgpt'],
      settings: { maxRetries: 0 },
    })
    await failed

    expect(sends).toEqual(['deepseek', 'chatgpt'])
    expect(await runner.get(jobId)).toMatchObject({ status: 'failed', aiProvider: 'chatgpt' })
  })

  it('hands exhausted localized-Han repair from ChatGPT to Kimi without retranslating clean text', async () => {
    let provider: AiProvider = 'chatgpt'
    const sends: Array<{ provider: AiProvider; repair: boolean }> = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async (prompt: string) => {
          const repair = prompt.includes('<CAU_CAN_SUA')
          sends.push({ provider, repair })
          if (!repair) return 'Cô nhìn 他 rồi đi.'
          const targetId = prompt.match(/<CAU_CAN_SUA id="([^"]+)"/u)?.[1] ?? ''
          const sentence = provider === 'kimi' ? 'Cô nhìn anh rồi đi.' : 'Cô nhìn 他 rồi đi.'
          return `<CAU_DA_SUA id="${targetId}">${sentence}</CAU_DA_SUA>`
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => {
        const position = candidate.indexOf('他')
        if (position < 0) return validation(`OK-${candidate}`)
        return {
          valid: false,
          issues: [{ code: 'han_remaining', severity: 'error', message: 'Bản dịch còn 1 ký tự Hán.' }],
          hanCharacters: [{ start: position, end: position + 1, character: '他', line: 1, column: position + 1 }],
          metrics: {
            sourceCharacters: 100, translatedCharacters: candidate.length,
            sourceHanCharacters: 10, remainingHanCharacters: 1, lengthRatio: 1,
          },
        }
      },
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', settings: { maxRetries: 0 },
    })
    await completed

    expect(sends.filter((send) => send.provider === 'chatgpt' && send.repair)).toHaveLength(10)
    expect(sends.at(-1)).toEqual({ provider: 'kimi', repair: true })
  }, 20_000)

  it('persists a provider hand-off and resumes it with Kimi after an app restart', async () => {
    const persistence = createPersistence()
    let provider: AiProvider = 'chatgpt'
    let enteredKimi!: () => void
    const kimiEntered = new Promise<void>((resolve) => { enteredKimi = resolve })
    let releaseKimi!: () => void
    const kimiGate = new Promise<void>((resolve) => { releaseKimi = resolve })
    const firstRunner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => {
          if (provider === 'kimi') { enteredKimi(); await kimiGate }
        }),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => 'BAD-CHATGPT'),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const { jobId } = await firstRunner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', settings: { maxRetries: 0 },
    })
    await kimiEntered
    const pausing = firstRunner.pause(jobId)
    releaseKimi()
    await pausing
    await new Promise((resolve) => setTimeout(resolve, 0))

    const durable = persistence.values.get(jobId) as {
      status: string; aiProvider: AiProvider; providerFailover: { mode: string; activeSegmentId?: string }
    }
    expect(durable).toMatchObject({
      status: 'paused', aiProvider: 'kimi',
      providerFailover: { mode: 'kimi-rescue', activeSegmentId: 'segment-1' },
    })

    provider = 'chatgpt'
    const secondRunner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => provider === 'kimi' ? 'OK-KIMI' : 'OK-CHATGPT'),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence,
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(secondRunner, (event) => event.type === 'job-completed')
    await secondRunner.resume(jobId)
    await completed

    expect((await secondRunner.get(jobId)).aiProvider).toBe('chatgpt')
    expect((persistence.values.get(jobId) as { providerFailover: { chatgptRescueCycles: number } })
      .providerFailover.chatgptRescueCycles).toBe(1)
  }, 20_000)

  it('never leaves a one-provider pool when that provider fails', async () => {
    let provider: AiProvider = 'chatgpt'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => { sends.push(provider); return 'BAD' }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')
    const { jobId } = await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'], settings: { maxRetries: 0 },
    })
    await failed

    expect(sends).toEqual(['chatgpt'])
    expect(await runner.get(jobId)).toMatchObject({
      status: 'failed', aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'],
    })
  })

  it('fails over only inside a two-provider pool', async () => {
    let provider: AiProvider = 'kimi'
    const sends: AiProvider[] = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => {
          sends.push(provider)
          return provider === 'deepseek' ? 'OK-DEEPSEEK' : 'BAD-KIMI'
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')
    await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'kimi', allowedAiProviders: ['kimi', 'deepseek'], settings: { maxRetries: 0 },
    })
    await completed

    expect(sends).toEqual(['kimi', 'deepseek'])
    expect(sends).not.toContain('chatgpt')
  })

  it('uses an outside-provider manual rescue once, then returns to the fixed pool after success', async () => {
    let provider: AiProvider = 'chatgpt'
    const sends: Array<{ provider: AiProvider; segment: number }> = []
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async (prompt: string) => {
          const segment = sourceNumber(prompt)
          sends.push({ provider, segment })
          if (provider === 'chatgpt' && segment === 1) return 'BAD-CHATGPT'
          return `OK-${provider}-${segment}`
        }),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: createPersistence(),
      chunker: () => chunks(2),
      validator: (_source, candidate) => validation(candidate),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')
    const { jobId } = await runner.start({
      source: 'two segments', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'], settings: { maxRetries: 0 },
    })
    await failed
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')
    await runner.retrySegment({ jobId, segmentId: 'segment-1', aiProvider: 'deepseek' })
    await completed

    expect(sends).toEqual([
      { provider: 'chatgpt', segment: 1 },
      { provider: 'deepseek', segment: 1 },
      { provider: 'chatgpt', segment: 2 },
    ])
    expect(await runner.get(jobId)).toMatchObject({
      status: 'completed', aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'],
    })
    expect((await runner.get(jobId)).manualRescueProvider).toBeUndefined()
  })

  it('does not retry or reload a failed outside-provider rescue before returning to the pool', async () => {
    let provider: AiProvider = 'chatgpt'
    let chatGptSends = 0
    const sends: AiProvider[] = []
    const reloadForRecovery = vi.fn(async () => undefined)
    const restartForRecovery = vi.fn(async () => undefined)
    const runner = new TranslationJobRunner({
      chatGpt: {
        selectProvider: vi.fn(async (next) => { provider = next }),
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => {
          sends.push(provider)
          if (provider === 'deepseek') return 'BAD-DEEPSEEK'
          chatGptSends += 1
          return chatGptSends === 1 ? 'BAD-CHATGPT' : 'OK-CHATGPT'
        }),
        cancelGeneration: vi.fn(async () => undefined),
        reloadForRecovery,
        restartForRecovery,
      },
      persistence: createPersistence(),
      chunker: () => chunks(1),
      validator: (_source, candidate) => validation(candidate),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')
    const { jobId } = await runner.start({
      source: 'one segment', promptMode: 'modern', resolvedPrompt: 'BASE',
      aiProvider: 'chatgpt', allowedAiProviders: ['chatgpt'], settings: { maxRetries: 0 },
    })
    await failed
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')
    await runner.retrySegment({ jobId, segmentId: 'segment-1', aiProvider: 'deepseek' })
    await completed

    expect(sends.filter((candidate) => candidate === 'deepseek')).toHaveLength(1)
    expect(sends.at(-1)).toBe('chatgpt')
    expect(reloadForRecovery).not.toHaveBeenCalled()
    expect(restartForRecovery).not.toHaveBeenCalled()
  })
})
