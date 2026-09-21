import { describe, expect, it, vi } from 'vitest'
import { TranslationJobRunner, type TranslationEvent } from '../../src/main/translation/TranslationJobRunner'
import { GeminiQuotaExceededError, quotaNoticeForLockedModel } from '../../src/main/chatgpt/geminiModel'
import type { AiProvider, TranslationValidationResult } from '../../src/shared/types'

const QUOTA_NOTICE = quotaNoticeForLockedModel('3.1 Pro Hạn mức sẽ được đặt lại vào15:13 20 thg 9')

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
      reject(new Error(`Quá thời gian chờ sự kiện: ${JSON.stringify(runner.activeJobs())}`))
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

function createRunner(options: {
  initialProvider: AiProvider
  allowedAiProviders: AiProvider[]
}) {
  let provider: AiProvider = options.initialProvider
  const sends: AiProvider[] = []
  const runner = new TranslationJobRunner({
    chatGpt: {
      selectProvider: vi.fn(async (next: AiProvider) => { provider = next }),
      ensureReady: vi.fn(async () => undefined),
      startNewConversation: vi.fn(async () => undefined),
      sendAndWait: vi.fn(async () => {
        sends.push(provider)
        if (provider === 'gemini') throw new GeminiQuotaExceededError(QUOTA_NOTICE)
        return 'OK-CHATGPT'
      }),
      cancelGeneration: vi.fn(async () => undefined),
    },
    persistence: createPersistence(),
    chunker: () => chunks(1),
    validator: (_source, candidate) => validation(candidate),
  })
  return { runner, sends }
}

describe('Gemini quota exhaustion', () => {
  it('pauses the job and explains the reset time when Gemini is the only AI', async () => {
    const { runner, sends } = createRunner({ initialProvider: 'gemini', allowedAiProviders: ['gemini'] })

    const { jobId } = await runner.start({
      source: 'one segment',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'gemini',
      allowedAiProviders: ['gemini'],
    })
    await vi.waitFor(async () => {
      expect((await runner.get(jobId)).status).toBe('paused')
    })

    const job = await runner.get(jobId)
    expect(job.error).toContain('hết hạn mức')
    expect(job.error).toContain('15:13 20 thg 9')
    // The checkpoint stays resumable: nothing is marked failed, and the segment
    // is queued again so pressing Continue retries it instead of giving up.
    expect(job.segments.every((segment) => segment.status !== 'failed')).toBe(true)
    expect(job.segments[0]!.status).toBe('queued')
    // Quota exhaustion must not burn the retry budget on a hopeless account.
    expect(sends).toEqual(['gemini'])
    expect((runner.activeJobs()[0] as { status?: string })?.status).toBe('paused')
  })

  it('hands the job to another allowed AI instead of pausing', async () => {
    const { runner, sends } = createRunner({
      initialProvider: 'gemini',
      allowedAiProviders: ['gemini', 'chatgpt'],
    })

    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')
    await runner.start({
      source: 'one segment',
      promptMode: 'modern',
      resolvedPrompt: 'BASE',
      aiProvider: 'gemini',
      allowedAiProviders: ['gemini', 'chatgpt'],
    })
    await completed

    expect(sends).toEqual(['gemini', 'chatgpt'])
  })
})
