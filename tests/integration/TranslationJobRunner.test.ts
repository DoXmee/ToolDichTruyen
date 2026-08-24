import { describe, expect, it, vi } from 'vitest'
import { validateTranslation } from '../../src/core'
import {
  ChatGptConversationVerificationError,
  ChatGptFreshChatRecoveryError,
  ChatGptGenerationStopError,
  ChatGptNonRetryableSafetyError,
} from '../../src/main/chatgpt/ChatGptWebAdapter'
import type { TranslationJobSnapshot, TranslationValidationResult } from '../../src/shared/types'
import { TranslationJobRunner, type TranslationEvent } from '../../src/main/translation/TranslationJobRunner'

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
  timeoutMs = 5_000,
): Promise<TranslationEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('Quá thời gian chờ sự kiện dịch.'))
    }, timeoutMs)
    const unsubscribe = runner.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })
}

function severeValidationResult(valid: boolean): TranslationValidationResult {
  return {
    valid,
    issues: valid
      ? []
      : [{
          code: 'too_short',
          severity: 'error',
          message: 'Bản dịch lỗi nặng, cần gửi lại toàn đoạn.',
        }],
    hanCharacters: [],
    metrics: {
      sourceCharacters: 10,
      translatedCharacters: valid ? 10 : 1,
      sourceHanCharacters: 0,
      remainingHanCharacters: 0,
      lengthRatio: valid ? 1 : 0.1,
    },
  }
}

function nonShortSevereValidationResult(valid: boolean): TranslationValidationResult {
  return {
    valid,
    issues: valid
      ? []
      : [{
          code: 'source_echo',
          severity: 'error',
          message: 'Bản dịch lặp lại nguyên văn nguồn.',
        }],
    hanCharacters: [],
    metrics: {
      sourceCharacters: 10,
      translatedCharacters: valid ? 10 : 10,
      sourceHanCharacters: 0,
      remainingHanCharacters: 0,
      lengthRatio: 1,
    },
  }
}

function chatGptPageFailureValidation(): TranslationValidationResult {
  return {
    valid: false,
    issues: [{
      code: 'error_response',
      severity: 'error',
      message: 'ChatGPT báo cần thử lại sau.',
    }],
    hanCharacters: [],
    metrics: {
      sourceCharacters: 10,
      translatedCharacters: 10,
      sourceHanCharacters: 0,
      remainingHanCharacters: 0,
      lengthRatio: 1,
    },
  }
}

function hanValidationAt(
  translation: string,
  positions: readonly number[],
): TranslationValidationResult {
  return {
    valid: false,
    issues: [{ code: 'han_remaining', severity: 'error', message: 'Còn chữ Hán.' }],
    hanCharacters: positions.map((start) => ({
      start,
      end: start + 1,
      character: translation[start] ?? '他',
      line: 1,
      column: start + 1,
    })),
    metrics: {
      sourceCharacters: translation.length,
      translatedCharacters: translation.length,
      sourceHanCharacters: 1,
      remainingHanCharacters: positions.length,
      lengthRatio: 1,
    },
  }
}

function pausedLocalizedRepairJob(input: {
  jobId: string;
  attempts: number;
  localAttempts: number;
  maxRetries: number;
}) {
  const sourceText = '她看了他一眼。'
  const translatedText = 'Cô nhìn 他 rồi đi.'
  const timestamp = new Date().toISOString()
  return {
    id: input.jobId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'paused',
    promptMode: 'modern',
    resolvedPrompt: 'BASE PROMPT PHỤC HỒI CỤC BỘ',
    sourceText,
    translatedText: '',
    currentSegmentIndex: 0,
    segments: [{
      id: 'segment-1',
      index: 0,
      start: 0,
      end: sourceText.length,
      sourceText,
      translatedText,
      status: 'streaming',
      attempts: input.attempts,
      validation: validateTranslation(sourceText, translatedText),
    }],
    settings: {
      maxCharsPerSegment: 2_000,
      maxRetries: input.maxRetries,
      responseTimeoutMs: 180_000,
      validation: {
        requireNoHan: true,
        minimumSourceLengthForRatioCheck: 80,
        minimumLengthRatio: 0.2,
        checkPreamble: true,
        checkTruncation: true,
        checkRepetition: true,
      },
    },
    conversationInitialized: true,
    conversationRecoveryPending: false,
    conversationHasBasePrompt: true,
    localizedHanRepairAttempts: { 'segment-1': input.localAttempts },
  }
}

describe('TranslationJobRunner', () => {
  it('khôi phục đồng thời một lần và giữ lịch sử ở dạng nhẹ', async () => {
    const activeJob = pausedLocalizedRepairJob({ jobId: 'job-active-summary', attempts: 1, localAttempts: 0, maxRetries: 3 })
    const listJobSummaries = vi.fn(async (): Promise<TranslationJobSnapshot[]> => ([
      {
        id: activeJob.id, createdAt: activeJob.createdAt, updatedAt: activeJob.updatedAt,
        status: 'paused', aiProvider: 'chatgpt', totalSegments: 1, completedSegments: 0,
        segments: [{ id: 'segment-1', index: 0, status: 'streaming' }],
      },
      {
        id: 'job-old-failed', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:01:00.000Z',
        status: 'failed', aiProvider: 'chatgpt', totalSegments: 2, completedSegments: 1,
        segments: [{ id: 'old-1', index: 0, status: 'completed' }, { id: 'old-2', index: 1, status: 'failed' }],
      },
    ]))
    const loadJobMock = vi.fn(async (id: string) => id === activeJob.id ? structuredClone(activeJob) : null)
    const loadJob = async <T,>(id: string): Promise<T | null> => await loadJobMock(id) as T | null
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn(), startNewConversation: vi.fn(), sendAndWait: vi.fn(), cancelGeneration: vi.fn(),
      },
      persistence: { saveJob: vi.fn(async () => undefined), loadJob, listJobSummaries },
    })

    await Promise.all([runner.restorePersistedJobs(), runner.restorePersistedJobs(), runner.discoverJobs()])
    const history = await runner.discoverJobs()
    expect(listJobSummaries).toHaveBeenCalledTimes(1)
    expect(loadJobMock).toHaveBeenCalledTimes(1)
    expect(history).toHaveLength(2)
    expect(history.find((job) => job.id === 'job-old-failed')).not.toHaveProperty('translatedText')
    expect(history.find((job) => job.id === activeJob.id)).not.toHaveProperty('sourceText')
  })

  it('trả checkpoint tích lũy khi hỏi đích danh job đang chạy, nhưng poll active vẫn nhẹ', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn((_prompt: string, options: { signal?: AbortSignal }) => (
      new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason ?? new DOMException('Đã hủy.', 'AbortError'))
        }, { once: true })
      })
    ))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    const { jobId } = await runner.start({
      source: '她站在窗前，安静地看着雨。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
    })
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledOnce())

    const snapshot = await runner.get(jobId)
    expect(snapshot).toMatchObject({ id: jobId, status: 'running', totalSegments: 1 })
    expect(snapshot).toHaveProperty('sourceText', '她站在窗前，安静地看着雨。')
    expect(snapshot).not.toHaveProperty('resolvedPrompt')
    expect(snapshot).toHaveProperty('translatedText', '')
    expect(snapshot.segments[0]).not.toHaveProperty('sourceText')
    expect(snapshot.segments[0]).not.toHaveProperty('translatedText')
    expect(runner.activeJobs()[0]).not.toHaveProperty('translatedText')
    expect(runner.activeJobs()[0]).not.toHaveProperty('sourceText')

    await runner.cancel(jobId)
  })

  it('bắt đầu lại từ lịch sử tạo job mới với đúng nguồn, prompt và cấu hình ban đầu', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn((_prompt: string, options: { signal?: AbortSignal }) => (
      new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    ))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const request = {
      source: 'NỘI-DUNG-GỐC-CỦA-CHECKPOINT。',
      promptMode: 'modern' as const,
      customPrompt: 'PROMPT-TÙY-CHỈNH',
      resolvedPrompt: 'PROMPT-ĐÃ-CHỐT',
      settings: { maxRetries: 2, maxCharsPerSegment: 1234 },
    }
    const { jobId: oldJobId } = await runner.start(request)
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledOnce())
    await runner.cancel(oldJobId)

    const { jobId: restartedJobId } = await runner.restart(oldJobId)
    expect(restartedJobId).not.toBe(oldJobId)
    const restarted = persistence.values.get(restartedJobId) as {
      sourceText: string; resolvedPrompt: string; customPrompt?: string; settings: { maxRetries: number; maxCharsPerSegment: number };
    }
    expect(restarted).toMatchObject({
      sourceText: request.source,
      resolvedPrompt: request.resolvedPrompt,
      customPrompt: request.customPrompt,
      settings: { maxRetries: 2, maxCharsPerSegment: 1234 },
    })
    await runner.cancel(restartedJobId)
  })

  it('lưu và trả lại phần đã hoàn tất trong khi đoạn kế tiếp vẫn đang dịch', async () => {
    const persistence = createPersistence()
    let resolveSecond: ((value: string) => void) | undefined
    const sendAndWait = vi.fn()
      .mockResolvedValueOnce('Bản dịch checkpoint thứ nhất đã hợp lệ.')
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveSecond = resolve }))
    const validator = vi.fn(() => ({
      valid: true,
      issues: [],
      hanCharacters: [],
      metrics: {
        sourceCharacters: 1,
        translatedCharacters: 1,
        sourceHanCharacters: 0,
        remainingHanCharacters: 0,
        lengthRatio: 1,
      },
    }))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator,
      chunker: () => [
        { id: 'segment-1', index: 0, start: 0, end: 1, text: '甲' },
        { id: 'segment-2', index: 1, start: 1, end: 2, text: '乙' },
      ],
    })
    const firstCheckpoint = waitForEvent(
      runner,
      (event) => event.type === 'segment-completed' && event.payload !== undefined,
    )

    const { jobId } = await runner.start({
      source: '甲乙',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
    })
    await firstCheckpoint
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledTimes(2))

    const snapshot = await runner.get(jobId)
    expect(snapshot).toMatchObject({
      status: 'running',
      completedSegments: 1,
      translatedText: 'Bản dịch checkpoint thứ nhất đã hợp lệ.',
    })
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'running',
      translatedText: 'Bản dịch checkpoint thứ nhất đã hợp lệ.',
      segments: expect.arrayContaining([
        expect.objectContaining({ id: 'segment-1', status: 'completed' }),
      ]),
    })

    resolveSecond?.('Bản dịch checkpoint thứ hai đã hợp lệ.')
    await vi.waitFor(async () => expect((await runner.get(jobId)).status).toBe('completed'))
  })

  it('dịch tuần tự, kiểm tra và lưu checkpoint thành công', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn().mockResolvedValue(
      'Cô bước vào căn phòng, khẽ khép cửa rồi bình tĩnh nhìn mọi người.',
    )
    const chatGpt = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      startNewConversation: vi.fn().mockResolvedValue(undefined),
      sendAndWait,
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
    }
    const runner = new TranslationJobRunner({ chatGpt, persistence })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed', 15_000)

    const { jobId } = await runner.start({
      source: '她走进房间，轻轻关上门，平静地看着众人。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch truyện hiện đại sang tiếng Việt. Chỉ trả bản dịch.',
      settings: { maxCharsPerSegment: 2_000, maxRetries: 1 },
    })

    const event = await completed
    expect(event.jobId).toBe(jobId)
    expect(sendAndWait).toHaveBeenCalledTimes(1)
    expect(sendAndWait.mock.calls[0]?.[0]).toContain('<NGUYEN_BAN')
    const saved = persistence.values.get(jobId) as { status: string; translatedText: string; activityLog?: unknown[] }
    expect(saved.status).toBe('completed')
    expect(saved.translatedText).toContain('Cô bước vào căn phòng')
    expect(saved.activityLog).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'info', message: expect.stringContaining('kiểm tra phiên ChatGPT') }),
      expect.objectContaining({ tone: 'info', message: expect.stringContaining('Gửi đoạn 1/1') }),
      expect.objectContaining({ tone: 'success', message: expect.stringContaining('đạt kiểm tra') }),
    ]))
    await expect(runner.get(jobId)).resolves.toMatchObject({
      id: jobId,
      status: 'completed',
      translatedText: expect.stringContaining('Cô bước vào căn phòng'),
      segments: [expect.objectContaining({ status: 'completed' })],
      activityLog: expect.arrayContaining([expect.objectContaining({ at: expect.any(String) })]),
    })
    expect(await runner.get(jobId)).not.toHaveProperty('settings')
  })

  it('mặc định dùng đoạn web nhỏ và thời gian chờ đủ dài cho dịch truyện', async () => {
    const persistence = createPersistence()
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait: vi.fn().mockResolvedValue('Bản dịch hợp lệ.'),
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nội dung nguồn ngắn để kiểm tra cấu hình mặc định.',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch sang tiếng Việt.',
    })
    await completed

    expect(persistence.values.get(jobId)).toMatchObject({
      settings: {
        maxCharsPerSegment: 12_000,
        responseTimeoutMs: 480_000,
        maxRetries: 3,
      },
    })
  })

  it('tiếp tục job cũ với timeout web dài hơn nhưng không thay đổi ranh giới checkpoint cũ', async () => {
    const persistence = createPersistence()
    const source = 'a'.repeat(6_000)
    const timestamp = new Date().toISOString()
    const jobId = 'legacy-web-timeout-job'
    persistence.values.set(jobId, {
      id: jobId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'failed',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch sang tiếng Việt.',
      sourceText: source,
      translatedText: '',
      segments: [{
        id: 'segment-1', index: 0, start: 0, end: source.length,
        sourceText: source, translatedText: '', status: 'failed', attempts: 1,
        error: 'Timeout cũ.',
      }],
      settings: {
        maxCharsPerSegment: 6_000,
        maxRetries: 0,
        responseTimeoutMs: 180_000,
        validation: {
          requireNoHan: true,
          minimumSourceLengthForRatioCheck: 80,
          minimumLengthRatio: 0.2,
          checkPreamble: true,
          checkTruncation: true,
          checkRepetition: true,
        },
      },
      conversationInitialized: false,
      conversationRecoveryPending: false,
      conversationHasBasePrompt: false,
      localizedHanRepairAttempts: {},
    })
    const sendAndWait = vi.fn().mockResolvedValue('Bản dịch hợp lệ.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn(() => ({
        valid: true,
        issues: [],
        hanCharacters: [],
        metrics: {
          sourceCharacters: source.length,
          translatedCharacters: 16,
          sourceHanCharacters: 0,
          remainingHanCharacters: 0,
          lengthRatio: 1,
        },
      })),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.retrySegment({ jobId, segmentId: 'segment-1' })
    await completed

    expect(sendAndWait.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: 480_000 })
    expect(persistence.values.get(jobId)).toMatchObject({
      settings: { maxCharsPerSegment: 6_000, responseTimeoutMs: 480_000 },
      segments: [expect.objectContaining({ start: 0, end: source.length })],
    })
  })

  it('sửa tất cả lỗi Hán cục bộ bằng base prompt và các câu lỗi, không gửi lại nguồn', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Cô ấy nhìn 他 rồi quay đi.')
      .mockResolvedValueOnce('<CAU_DA_SUA id="segment-1-han-0-25">Cô ấy nhìn anh rồi quay đi, không nói thêm lời nào.</CAU_DA_SUA>')
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const repairEvents: TranslationEvent[] = []
    runner.onEvent((event) => {
      if (event.type === 'segment-retry' &&
          (event.payload as { kind?: string } | undefined)?.kind === 'localized-han') {
        repairEvents.push(event)
      }
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: '她看了他一眼，转身离开。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 2 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(2)
    const retryPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(retryPrompt).toContain('CAU_CAN_SUA')
    expect(retryPrompt).toContain('Dịch đầy đủ sang tiếng Việt.')
    expect(retryPrompt).toContain('CAU_DA_SUA')
    expect(retryPrompt).toContain('Cô ấy nhìn 他')
    expect(retryPrompt).not.toContain('<NGUYEN_BAN')
    expect(retryPrompt).not.toContain('她看了他一眼，转身离开。')
    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(repairEvents).toHaveLength(1)
    expect(repairEvents[0]?.payload).toMatchObject({
      kind: 'localized-han',
      localAttempt: 1,
    })
    const saved = persistence.values.get(jobId) as {
      status: string;
      segments: Array<{
        status: string;
        translatedText: string;
        validation?: { valid: boolean; hanCharacters: unknown[] };
      }>;
    }
    expect(saved).toMatchObject({
      status: 'completed',
      segments: [{
        status: 'completed',
        translatedText: 'Cô ấy nhìn anh rồi quay đi, không nói thêm lời nào.',
        validation: { valid: true, hanCharacters: [] },
      }],
    })
  })

  it('không ghép phản hồi sửa nhầm câu và gửi VẪN LỖI cho tới khi đúng câu, sạch chữ Hán', async () => {
    const persistence = createPersistence()
    let repairAttempt = 0
    const sendAndWait = vi.fn().mockImplementation(async (prompt: string) => {
      if (!prompt.includes('<CAU_CAN_SUA')) return 'Cô nhìn 他 rồi đi.'
      repairAttempt += 1
      const targetId = prompt.match(/<CAU_CAN_SUA id="([^"]+)"/u)?.[1] ?? ''
      const sentence = repairAttempt === 1
        ? 'Một câu hoàn toàn khác, không liên quan.'
        : 'Cô nhìn anh rồi đi.'
      return `<CAU_DA_SUA id="${targetId}">${sentence}</CAU_DA_SUA>`
    })
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: '她看了他一眼。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đúng câu.',
      settings: { maxRetries: 1 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(3)
    expect(String(sendAndWait.mock.calls[2]?.[0])).toContain('VẪN LỖI')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      translatedText: 'Cô nhìn anh rồi đi.',
      localizedHanRepairAttempts: {},
    })
  })

  it('tách prompt gốc thành tin riêng trước lượt sửa Hán cục bộ thứ ba', async () => {
    const persistence = createPersistence()
    const faultyResponse = '<CAU_DA_SUA id="segment-1-han-0-25">Cô ấy nhìn 他 rồi quay đi.</CAU_DA_SUA>'
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Cô ấy nhìn 他 rồi quay đi.')
      .mockResolvedValueOnce(faultyResponse)
      .mockResolvedValueOnce(faultyResponse)
      .mockResolvedValueOnce('Đã hiểu, hãy gửi các câu cần sửa.')
      .mockResolvedValueOnce('<CAU_DA_SUA id="segment-1-han-0-25">Cô ấy nhìn anh rồi quay đi.</CAU_DA_SUA>')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')
    const basePrompt = 'PROMPT GỐC RIÊNG CHO LƯỢT BA'

    const { jobId } = await runner.start({
      source: '她看了他一眼，转身离开。',
      promptMode: 'modern',
      resolvedPrompt: basePrompt,
      settings: { maxRetries: 3 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(5)
    expect(String(sendAndWait.mock.calls[1]?.[0])).toContain(basePrompt)
    expect(String(sendAndWait.mock.calls[1]?.[0])).toContain('<CAU_CAN_SUA')
    expect(String(sendAndWait.mock.calls[2]?.[0])).toContain(basePrompt)
    expect(String(sendAndWait.mock.calls[2]?.[0])).toContain('<CAU_CAN_SUA')
    expect(sendAndWait.mock.calls[3]?.[0]).toBe(basePrompt)
    expect(String(sendAndWait.mock.calls[4]?.[0])).not.toContain(basePrompt)
    expect(String(sendAndWait.mock.calls[4]?.[0])).toContain('TIẾP TỤC ÁP DỤNG')
    expect(String(sendAndWait.mock.calls[4]?.[0])).toContain('Cô ấy nhìn 他 rồi quay đi.')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      segments: [{
        status: 'completed',
        attempts: 4,
        translatedText: 'Cô ấy nhìn anh rồi quay đi.',
        validation: { valid: true, hanCharacters: [] },
      }],
    })
  })

  it('dùng đúng một conversation cho nhiều segment và các lượt sửa cục bộ tự động', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Đoạn đầu còn 他 trong câu này.')
      .mockResolvedValueOnce('Đoạn đầu còn anh trong câu này.')
      .mockResolvedValueOnce('Đoạn hai đã dịch xong hoàn chỉnh.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      chunker: vi.fn(() => [
        { id: 'segment-1', index: 0, start: 0, end: 4, text: '第一段。' },
        { id: 'segment-2', index: 1, start: 4, end: 8, text: '第二段。' },
      ]),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: '第一段。第二段。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch tuần tự và giữ nhất quán.',
      settings: { maxRetries: 2 },
    })
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledTimes(3)
    const repairPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(repairPrompt).toContain('Đoạn đầu còn 他 trong câu này.')
    expect(repairPrompt).not.toContain('第一段。第二段。')
    expect(repairPrompt).not.toContain('第二段。')
    expect(String(sendAndWait.mock.calls[2]?.[0])).toContain('第二段。')
    const allPrompts = sendAndWait.mock.calls.map((call) => String(call[0])).join('\n')
    // Every error recovery re-states the base prompt.  The next ordinary
    // segment can still use the compact continuation envelope.
    expect(allPrompts.match(/Dịch tuần tự và giữ nhất quán\./gu)).toHaveLength(2)
    expect(repairPrompt).toContain('Dịch tuần tự và giữ nhất quán.')
    expect(String(sendAndWait.mock.calls[2]?.[0])).not.toContain(
      'Dịch tuần tự và giữ nhất quán.',
    )
  })

  it('thay đúng từng occurrence trùng nhau bằng phản hồi batch có mã target', async () => {
    const persistence = createPersistence()
    const original = 'Anh ta đứng lại. Cô nhìn 他. Anh ta đứng lại. Cô nhìn 他.'
    const repaired = 'Anh ta đứng lại. Cô nhìn anh. Anh ta đứng lại. Cô nhìn anh.'
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockImplementationOnce(async (prompt: string) => (
        [...prompt.matchAll(/<CAU_CAN_SUA id="([^"]+)">\s*([\s\S]*?)\s*<\/CAU_CAN_SUA>/gu)]
          .map((match) => {
            const targetId = match[1] ?? ''
            const sentence = (match[2] ?? '').replaceAll('他', 'anh')
            return `<CAU_DA_SUA id="${targetId}">${sentence}</CAU_DA_SUA>`
          })
          .join('\n')
      ))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: '她看了他两次。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch chính xác sang tiếng Việt.',
      settings: { maxRetries: 2 },
    })
    await completed

    const saved = persistence.values.get(jobId) as { translatedText: string }
    expect(saved.translatedText).toBe(repaired)
    expect(sendAndWait).toHaveBeenCalledTimes(2)
    const repairPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(repairPrompt.match(/<CAU_CAN_SUA /gu)).toHaveLength(2)
    expect(repairPrompt.match(/<CAU_CAN_SUA id="segment-1-han-[^"]+"/gu)).toHaveLength(2)
    expect(repairPrompt).not.toContain('Anh ta đứng lại')
  })

  it('sửa cục bộ thất bại dùng hết retry trong cùng chat, không tự đổi chat vì validation', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Cô nhìn 他 rồi đi.')
      .mockResolvedValue('Cô nhìn 他 rồi đi.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const freshChatEvents: TranslationEvent[] = []
    runner.onEvent((event) => {
      if (
        event.type === 'segment-retry' &&
        (event.payload as { kind?: string } | undefined)?.kind === 'fresh-chat'
      ) {
        freshChatEvents.push(event)
      }
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed', 15_000)

    const { jobId } = await runner.start({
      source: '她看了他一眼，转身离开。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 2 },
    })
    await failed

    // Validation/output errors stay in the current verified conversation.
    // The sends are the original, ten bounded local repairs, and the one
    // standalone base-prompt reminder immediately before local attempt 3.
    expect(sendAndWait).toHaveBeenCalledTimes(12)
    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(freshChatEvents).toHaveLength(0)
    const localizedCalls = sendAndWait.mock.calls.slice(1).filter((call) => (
      String(call[0]).includes('CAU_CAN_SUA')
    ))
    expect(localizedCalls).toHaveLength(10)
    for (const call of localizedCalls) {
      const prompt = String(call[0])
      expect(prompt).toContain('CAU_CAN_SUA')
      expect(prompt).toContain('Cô nhìn 他 rồi đi.')
      expect(prompt).not.toContain('她看了他一眼，转身离开。')
      expect(prompt).not.toContain('BAN_DICH_LOI')
      expect(prompt).not.toContain('NGUYEN_BAN')
    }
    expect(localizedCalls.filter((call) => (
      String(call[0]).includes('Dịch đầy đủ sang tiếng Việt.')
    ))).toHaveLength(9)
    expect(localizedCalls.filter((call) => (
      String(call[0]).includes('TIẾP TỤC ÁP DỤNG')
    ))).toHaveLength(1)
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'failed',
      segments: [expect.objectContaining({ status: 'failed', attempts: 11 })],
    })
  })

  it('pause trong response sửa cục bộ không tạo request chồng khi resume', async () => {
    const persistence = createPersistence()
    let resolveRepair!: (value: string) => void
    const repairResponse = new Promise<string>((resolve) => {
      resolveRepair = resolve
    })
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Cô nhìn 他 rồi đi.')
      .mockReturnValueOnce(repairResponse)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    const { jobId } = await runner.start({
      source: '她看了他一眼。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 2 },
    })
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledTimes(2))
    await runner.pause(jobId)
    await runner.resume(jobId)

    expect(sendAndWait).toHaveBeenCalledTimes(2)
    resolveRepair('Cô nhìn anh rồi đi.')
    await vi.waitFor(() => {
      expect((persistence.values.get(jobId) as { status: string }).status).toBe('completed')
    })
    expect(sendAndWait).toHaveBeenCalledTimes(2)
  })

  it('giữ bền đích xuất link qua pause rồi resume checkpoint', async () => {
    const persistence = createPersistence()
    let resolveTranslation!: (value: string) => void
    const pendingTranslation = new Promise<string>((resolve) => { resolveTranslation = resolve })
    const sendAndWait = vi.fn().mockReturnValue(pendingTranslation)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const binding = {
      directory: 'D:\\Xuat\\Bo-truyen',
      startChapter: 3,
      endChapter: 10,
      sourceChapterNumbers: [3, 4, 5, 6, 7, 8, 9, 10],
      exportOriginalChapters: true,
      exportCombinedChapters: true,
      outputChapterStart: 101,
      omitOutputChapterTitles: true,
    }
    const { jobId } = await runner.start({
      source: 'Nguồn dùng để kiểm thử lưu tiếp checkpoint.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT',
      autoExport: binding,
      settings: { maxRetries: 1 },
    })
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledOnce())
    await runner.pause(jobId)

    await expect(runner.get(jobId)).resolves.toMatchObject({
      status: 'paused',
      autoExport: binding,
    })
    expect(persistence.values.get(jobId)).toMatchObject({ autoExport: binding })

    await runner.resume(jobId)
    resolveTranslation('Bản dịch hoàn tất.')
    await vi.waitFor(() => expect((persistence.values.get(jobId) as { status: string }).status).toBe('completed'))
  })

  it('làm sạch checkpoint Xbanxia cũ trước khi resume mà giữ nguyên tiến độ', async () => {
    const persistence = createPersistence()
    let resolveTranslation!: (value: string) => void
    const pendingTranslation = new Promise<string>((resolve) => { resolveTranslation = resolve })
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait: vi.fn().mockReturnValue(pendingTranslation),
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn().mockReturnValue(severeValidationResult(true)),
    })
    const source = [
      'Chương 507: 【第507章????????????????????',
      '',
      '【第507章「禦獸從零分開始cx129」 這種感覺......】',
      '第一段正文完整保留，人物進入醫務室接受檢查。',
      '第二段正文接續前文，對話和動作都沒有中斷。',
      '第三段正文自然結束，情節已經交代完整。',
      '\u000e\u000e\u000e\u000e\u000e\u000e\u000e\u000e\u000e\u000e',
      'ps：下一章稍後更新。',
    ].join('\n')
    const { jobId } = await runner.start({
      source,
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT',
      autoExport: {
        directory: 'D:\\Xuat\\Xbanxia', startChapter: 507, endChapter: 507,
        sourceChapterNumbers: [507], exportOriginalChapters: true,
        exportCombinedChapters: true, omitOutputChapterTitles: false,
      },
    })
    await vi.waitFor(() => expect((persistence.values.get(jobId) as { status: string }).status).toBe('running'))
    await runner.pause(jobId)
    await runner.resume(jobId)

    expect(persistence.values.get(jobId)).toMatchObject({
      sourceText: expect.stringContaining('Chương 507: 這種感覺......'),
      segments: [expect.objectContaining({
        sourceText: expect.not.stringMatching(/cx129|\?{5}|ps：|\u000e/u),
      })],
      activityLog: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/làm sạch 1 đoạn Xbanxia/u) }),
      ]),
    })
    resolveTranslation('Chương 507: Cảm giác này......\n\nBản dịch hoàn chỉnh.')
  })

  it('shutdown giữa local repair rồi cold restart chỉ gửi lại đúng câu lỗi', async () => {
    const persistence = createPersistence()
    const firstSendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Cô nhìn 他 rồi đi.')
      .mockImplementationOnce((_prompt: string, options: { signal?: AbortSignal }) => (
        new Promise<string>((_resolve, reject) => {
          const rejectOnAbort = () => reject(
            options.signal?.reason ?? new DOMException('Đã dừng app.', 'AbortError'),
          )
          if (options.signal?.aborted) rejectOnAbort()
          else options.signal?.addEventListener('abort', rejectOnAbort, { once: true })
        })
      ))
    const firstRunner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait: firstSendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    const { jobId } = await firstRunner.start({
      source: '她看了他一眼。',
      promptMode: 'modern',
      resolvedPrompt: 'BASE PROMPT PHỤC HỒI CỤC BỘ',
      settings: { maxRetries: 3 },
    })
    await vi.waitFor(() => expect(firstSendAndWait).toHaveBeenCalledTimes(2))
    await firstRunner.shutdown()
    await vi.waitFor(() => {
      expect(persistence.values.get(jobId)).toMatchObject({
        status: 'paused',
        localizedHanRepairAttempts: { 'segment-1': 1 },
        segments: [{
          status: 'streaming',
          attempts: 2,
          translatedText: 'Cô nhìn 他 rồi đi.',
          validation: { issues: [{ code: 'han_remaining' }] },
        }],
      })
    })

    const resumedSendAndWait = vi.fn().mockResolvedValue('Cô nhìn anh rồi đi.')
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const resumedRunner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait: resumedSendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    await expect(resumedRunner.get(jobId)).resolves.toMatchObject({ status: 'paused' })
    const completed = waitForEvent(
      resumedRunner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await resumedRunner.resume(jobId)
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(resumedSendAndWait).toHaveBeenCalledOnce()
    const recoveryPrompt = String(resumedSendAndWait.mock.calls[0]?.[0])
    expect(recoveryPrompt).toContain('BASE PROMPT PHỤC HỒI CỤC BỘ')
    expect(recoveryPrompt).toContain('<CAU_CAN_SUA')
    expect(recoveryPrompt).toContain('Cô nhìn 他 rồi đi.')
    expect(recoveryPrompt).not.toContain('<NGUYEN_BAN')
    expect(recoveryPrompt).not.toContain('<BAN_DICH_LOI>')
    expect(recoveryPrompt).not.toContain('她看了他一眼。')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      translatedText: 'Cô nhìn anh rồi đi.',
      localizedHanRepairAttempts: {},
    })
  })

  it('cold restart với local repair đã hết lượt fail rõ ràng, không tự đổi chat lần nữa', async () => {
    const persistence = createPersistence()
    const jobId = 'localized-final-attempt-job'
    persistence.values.set(jobId, pausedLocalizedRepairJob({
      jobId,
      attempts: 11,
      localAttempts: 10,
      maxRetries: 2,
    }))
    const ensureReady = vi.fn().mockResolvedValue(undefined)
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn().mockResolvedValue('Cô nhìn anh rồi đi.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady,
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    await expect(runner.get(jobId)).resolves.toMatchObject({ status: 'paused' })
    const failed = waitForEvent(
      runner,
      (event) => event.type === 'job-failed' && event.jobId === jobId,
    )
    await runner.resume(jobId)
    await failed

    expect(ensureReady).toHaveBeenCalledOnce()
    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).not.toHaveBeenCalled()
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'failed',
      segments: [{
        status: 'failed',
        attempts: 11,
        translatedText: 'Cô nhìn 他 rồi đi.',
      }],
    })
  })

  it('lỗi Hán xuất hiện ở lần dịch toàn đoạn cuối vẫn được sửa cục bộ trước khi fail', async () => {
    const persistence = createPersistence()
    const jobId = 'localized-after-final-full-attempt-job'
    persistence.values.set(jobId, pausedLocalizedRepairJob({
      jobId,
      attempts: 4,
      localAttempts: 0,
      maxRetries: 3,
    }))
    const sendAndWait = vi.fn().mockResolvedValue('Cô nhìn anh rồi đi.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    await expect(runner.get(jobId)).resolves.toMatchObject({ status: 'paused' })
    const completed = waitForEvent(
      runner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await runner.resume(jobId)
    await completed

    expect(sendAndWait).toHaveBeenCalledOnce()
    expect(String(sendAndWait.mock.calls[0]?.[0])).toContain('<CAU_CAN_SUA')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      segments: [expect.objectContaining({ status: 'completed', translatedText: 'Cô nhìn anh rồi đi.' })],
    })
  })

  it('giữ retry toàn đoạn cho lỗi nặng nhưng vẫn ở cùng conversation', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Bản dịch: Cô ấy bước đi.')
      .mockResolvedValueOnce('Cô ấy bước đi trong im lặng.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: '她默默地向前走去。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 1 },
    })
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledTimes(2)
    const retryPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(retryPrompt).toContain('Dịch đầy đủ sang tiếng Việt.')
    expect(retryPrompt).not.toContain('BAN_DICH_LOI')
    expect(retryPrompt).toContain('她默默地向前走去。')
    expect(retryPrompt).not.toContain('CAU_CAN_SUA')
  })

  it('gom tối đa mười vị trí/câu lỗi Hán vào một lượt sửa batch có base prompt', async () => {
    const persistence = createPersistence()
    const original = Array.from(
      { length: 10 },
      (_, index) => `Câu ${index + 1} còn 他.`,
    ).join('\n')
    const repaired = original.replaceAll('他', 'anh')
    const sendAndWait = vi.fn()
      .mockResolvedValueOnce(original)
      .mockImplementationOnce(async (prompt: string) => (
        [...prompt.matchAll(/<CAU_CAN_SUA id="([^"]+)">\s*([\s\S]*?)\s*<\/CAU_CAN_SUA>/gu)]
          .map((match) => {
            const targetId = match[1] ?? ''
            const sentence = (match[2] ?? '').replaceAll('他', 'anh')
            return `<CAU_DA_SUA id="${targetId}">${sentence}</CAU_DA_SUA>`
          })
          .join('\n')
      ))
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined), startNewConversation,
        sendAndWait, cancelGeneration: vi.fn().mockResolvedValue(undefined),
      }, persistence,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nguồn kiểm tra mười lỗi Hán.', promptMode: 'modern', resolvedPrompt: 'BASE-BATCH-PROMPT',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(2)
    expect(startNewConversation).toHaveBeenCalledOnce()
    const repairPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(repairPrompt).toContain('BASE-BATCH-PROMPT')
    expect(repairPrompt.match(/<CAU_CAN_SUA /gu)).toHaveLength(10)
    expect(repairPrompt).not.toContain('<NGUYEN_BAN')
    expect((persistence.values.get(jobId) as { translatedText: string }).translatedText).toBe(repaired)
  })

  it('lỗi validation lớn gửi lại base prompt và toàn bộ nguồn trong cùng chat', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn()
      .mockResolvedValueOnce('LOI-NANG')
      .mockResolvedValueOnce('BAN-DICH-HOP-LE')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined), startNewConversation,
        sendAndWait, cancelGeneration: vi.fn().mockResolvedValue(undefined),
      }, persistence,
      validator: vi.fn((_source: string, translation: string) => nonShortSevereValidationResult(translation === 'BAN-DICH-HOP-LE')),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'NGUON-DAY-DU-CHO-LOI-LON', promptMode: 'modern', resolvedPrompt: 'BASE-LOI-LON',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    const retry = String(sendAndWait.mock.calls[1]?.[0])
    expect(retry).toContain('BASE-LOI-LON')
    expect(retry).toContain('NGUON-DAY-DU-CHO-LOI-LON')
    expect(retry).not.toContain('<BAN_DICH_LOI>')
  })

  it('lỗi adapter an toàn đổi chat nhưng giữ toàn bộ ngân sách retry còn lại', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn()
      .mockRejectedValueOnce(new ChatGptFreshChatRecoveryError('Context cũ đã đóng an toàn.'))
      .mockResolvedValueOnce('LOI-NANG')
      .mockResolvedValueOnce('LOI-NANG')
      .mockResolvedValueOnce('BAN-DICH-HOP-LE')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined), startNewConversation,
        sendAndWait, cancelGeneration: vi.fn().mockResolvedValue(undefined),
      }, persistence,
      validator: vi.fn((_source: string, translation: string) => nonShortSevereValidationResult(translation === 'BAN-DICH-HOP-LE')),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'NGUON-ADAPTER-RETRY', promptMode: 'modern', resolvedPrompt: 'BASE-ADAPTER-RETRY',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(sendAndWait).toHaveBeenCalledTimes(4)
    for (const call of sendAndWait.mock.calls.slice(1)) {
      expect(String(call[0])).toContain('BASE-ADAPTER-RETRY')
      expect(String(call[0])).toContain('NGUON-ADAPTER-RETRY')
    }
  })

  it('dừng ở trạng thái lỗi sau khi dùng hết số lần retry', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn().mockResolvedValue('仍然还 còn chữ Trung.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: '这是一个需要完整翻译的测试段落。',
      promptMode: 'period',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 2 },
    })
    await failed

    // A localized validation error gets ten repair attempts in the same
    // verified chat. Validation exhaustion must not create a fresh chat.
    expect(sendAndWait).toHaveBeenCalledTimes(12)
    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait.mock.calls.slice(1).filter((call) => (
      String(call[0]).includes('CAU_CAN_SUA')
    ))).toHaveLength(10)
    const saved = persistence.values.get(jobId) as {
      status: string
      segments: Array<{ status: string; attempts: number }>
    }
    expect(saved.status).toBe('failed')
    expect(saved.segments[0]).toMatchObject({ status: 'failed', attempts: 11 })
  })

  it('không retry khi adapter không xác minh được generation cũ đã dừng', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn().mockRejectedValue(
      new ChatGptGenerationStopError('Response cũ có thể vẫn đang chạy.'),
    )
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: '她站在窗前，安静地看着雨。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 3 },
    })
    await failed

    expect(sendAndWait).toHaveBeenCalledTimes(1)
    const saved = persistence.values.get(jobId) as {
      status: string;
      segments: Array<{ status: string; attempts: number }>;
    }
    expect(saved.status).toBe('failed')
    expect(saved.segments[0]).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('lưu nguyên nhân gốc của lỗi dừng generation vào đoạn và job, nhưng không gửi lại', async () => {
    const persistence = createPersistence()
    const stopFailure = new ChatGptGenerationStopError(
      'Không thể xác minh phản hồi cũ đã dừng.',
      { cause: new Error('Nút dừng vẫn hiện sau thời gian chờ.') },
    )
    const sendAndWait = vi.fn().mockRejectedValue(stopFailure)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: '她站在窗前，安静地看着雨。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 3 },
    })
    await failed

    expect(sendAndWait).toHaveBeenCalledTimes(1)
    const saved = persistence.values.get(jobId) as {
      error: string
      segments: Array<{ status: string; attempts: number; error?: string }>
    }
    expect(saved.error).toContain('Không thể xác minh phản hồi cũ đã dừng.')
    expect(saved.error).toContain('Nguyên nhân: Nút dừng vẫn hiện sau thời gian chờ.')
    expect(saved.segments[0]).toMatchObject({ status: 'failed', attempts: 1 })
    expect(saved.segments[0]?.error).toContain('Nút dừng vẫn hiện sau thời gian chờ.')
    await expect(runner.get(jobId)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Nút dừng vẫn hiện sau thời gian chờ.'),
      segments: [expect.objectContaining({
        error: expect.stringContaining('Nút dừng vẫn hiện sau thời gian chờ.'),
      })],
    })
  })

  it('không retry khi lỗi dừng bị bọc bên trong nguyên nhân của adapter', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn().mockRejectedValue(
      new Error('Adapter không thể hoàn tất thao tác gửi.', {
        cause: new ChatGptGenerationStopError('Phản hồi cũ có thể vẫn đang chạy.'),
      }),
    )
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: '她站在窗前，安静地看着雨。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 3 },
    })
    await failed

    expect(sendAndWait).toHaveBeenCalledTimes(1)
    const saved = persistence.values.get(jobId) as { error: string }
    expect(saved.error).toContain('Adapter không thể hoàn tất thao tác gửi.')
    expect(saved.error).toContain('Phản hồi cũ có thể vẫn đang chạy.')
  })

  it('bản dịch ngắn bất thường xóa chat tool cũ rồi gửi lại trong chat mới', async () => {
    const persistence = createPersistence()
    const trace: string[] = []
    let conversation = 0
    const startNewConversation = vi.fn(async () => {
      conversation += 1
      trace.push(`chat-${conversation}`)
    })
    const sendAndWait = vi.fn(async (_prompt: string) => {
      trace.push(`send-${conversation}`)
      return ['PHAN-TRUOC-DA-HOAN-TAT.', 'LOI-NANG', 'PHAN-SAU-DA-HOAN-TAT.'][
        trace.filter((item) => item.startsWith('send-')).length - 1
      ]!
    })
    const validator = vi.fn((_source: string, translation: string) => (
      severeValidationResult(translation !== 'LOI-NANG')
    ))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator,
      chunker: () => [
        { id: 'segment-1', index: 0, start: 0, end: 10, text: 'SOURCE-ONE' },
        { id: 'segment-2', index: 1, start: 10, end: 20, text: 'SOURCE-TWO' },
      ],
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'SOURCE-ONE SOURCE-TWO',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-FRESH-CHAT',
      settings: { maxRetries: 1 },
    })
    await completed

    expect(trace).toEqual(['chat-1', 'send-1', 'send-1', 'chat-2', 'send-2'])
    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(sendAndWait).toHaveBeenCalledTimes(3)
    const retryPrompt = String(sendAndWait.mock.calls[2]?.[0])
    expect(retryPrompt).toContain('BASE-PROMPT-FRESH-CHAT')
    expect(retryPrompt).toContain('SOURCE-TWO')
    expect(retryPrompt).not.toContain('<BAN_DICH_LOI>')
    expect(retryPrompt).toContain('NGỮ CẢNH KHÔI PHỤC CHO CHAT MỚI')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      freshChatRecoveryAttempts: {},
      shortTranslationRecoveryAttempts: {},
      segments: [
        expect.objectContaining({ id: 'segment-1', status: 'completed', attempts: 1 }),
        expect.objectContaining({ id: 'segment-2', status: 'completed', attempts: 2 }),
      ],
    })
  })

  it('bản dịch ngắn lặp lại khởi động lại browser rồi tạo chat mới trước khi gửi lại', async () => {
    const persistence = createPersistence()
    let conversation = 0
    const trace: string[] = []
    const startNewConversation = vi.fn(async () => {
      conversation += 1
      trace.push(`chat-${conversation}`)
    })
    const restartForRecovery = vi.fn(async () => {
      trace.push('browser-restart')
    })
    const sendAndWait = vi
      .fn()
      .mockImplementationOnce(async () => {
        trace.push(`send-${conversation}`)
        return 'LOI-NGAN-1'
      })
      .mockImplementationOnce(async () => {
        trace.push(`send-${conversation}`)
        return 'LOI-NGAN-2'
      })
      .mockImplementationOnce(async () => {
        trace.push(`send-${conversation}`)
        return 'BAN-DICH-HOAN-TAT'
      })
    const validator = vi.fn((_source: string, translation: string) => (
      severeValidationResult(translation === 'BAN-DICH-HOAN-TAT')
    ))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
        restartForRecovery,
      },
      persistence,
      validator,
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'SOURCE-CHO-LOI-NGAN',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-LOI-NGAN',
      settings: { maxRetries: 2 },
    })
    await completed

    expect(trace).toEqual([
      'chat-1', 'send-1',
      'chat-2', 'send-2',
      'browser-restart',
      'chat-3', 'send-3',
    ])
    expect(restartForRecovery).toHaveBeenCalledOnce()
    expect(startNewConversation).toHaveBeenCalledTimes(3)
    for (const [prompt] of sendAndWait.mock.calls) {
      expect(String(prompt)).toContain('BASE-PROMPT-LOI-NGAN')
      expect(String(prompt)).toContain('NGUYEN_BAN')
    }
  })

  it('validation hết lượt fail trong chat hiện tại, retry thủ công vẫn có ngân sách mới', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('LOI-NANG')
      .mockResolvedValueOnce('BAN-DICH-RETRY-THU-CONG')
    const validator = vi.fn((_source: string, translation: string) => (
      severeValidationResult(translation !== 'LOI-NANG')
    ))
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator,
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: 'Nguon cho retry bi loi nang.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT',
      settings: { maxRetries: 0 },
    })
    await failed
    expect(sendAndWait).toHaveBeenCalledOnce()
    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'failed',
      freshChatRecoveryAttempts: {},
      segments: [expect.objectContaining({ status: 'failed', attempts: 1 })],
    })

    const segmentId = (persistence.values.get(jobId) as {
      segments: Array<{ id: string }>;
    }).segments[0]!.id
    const completed = waitForEvent(
      runner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await runner.retrySegment({ jobId, segmentId })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(2)
    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      freshChatRecoveryAttempts: {},
      segments: [expect.objectContaining({ status: 'completed', attempts: 1 })],
    })
  })

  it('checkpoint hand-off adapter an toàn sống qua restart và giữ toàn bộ retry còn lại', async () => {
    const persistence = createPersistence()
    let releaseSecondChat!: () => void
    const secondChatGate = new Promise<void>((resolve) => {
      releaseSecondChat = resolve
    })
    let secondChatEntered!: () => void
    const secondChatEnteredPromise = new Promise<void>((resolve) => {
      secondChatEntered = resolve
    })
    const firstStartNewConversation = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        secondChatEntered()
        await secondChatGate
      })
    const firstRunner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: firstStartNewConversation,
        sendAndWait: vi.fn().mockRejectedValue(
          new ChatGptFreshChatRecoveryError('Context cũ đã được đóng an toàn.'),
        ),
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    const { jobId } = await firstRunner.start({
      source: 'Nguon can khoi phuc sau restart.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-RESTART',
      settings: { maxRetries: 3 },
    })
    await secondChatEnteredPromise

    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'queued',
      currentSegmentIndex: 0,
      conversationInitialized: false,
      conversationHasBasePrompt: false,
      freshChatRecoveryAttempts: { 'segment-1': 1 },
      freshChatRecoveryAttemptLimits: { 'segment-1': 4 },
      segments: [expect.objectContaining({ status: 'queued', attempts: 1 })],
    })

    await firstRunner.shutdown()
    releaseSecondChat()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const resumedStartNewConversation = vi.fn().mockResolvedValue(undefined)
    const resumedRunner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: resumedStartNewConversation,
        sendAndWait: vi.fn().mockResolvedValue('BAN-DICH-SAU-RESTART'),
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    await expect(resumedRunner.get(jobId)).resolves.toMatchObject({ status: 'paused' })
    const completed = waitForEvent(
      resumedRunner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await resumedRunner.resume(jobId)
    await completed

    expect(firstStartNewConversation).toHaveBeenCalledTimes(2)
    expect(resumedStartNewConversation).toHaveBeenCalledOnce()
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      freshChatRecoveryAttempts: {},
      segments: [expect.objectContaining({ status: 'completed', attempts: 2 })],
    })
  })

  it('lỗi adapter thường retry trong chat hiện tại với base prompt đầy đủ', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockRejectedValueOnce(new Error('Browser tạm thời mất phản hồi.'))
      .mockResolvedValueOnce('BAN-DICH-SAU-LOI-ADAPTER')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'Nguon co loi adapter co the retry an toan.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-ADAPTER',
      settings: { maxRetries: 1 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(2)
    expect(startNewConversation).toHaveBeenCalledOnce()
    const retryPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(retryPrompt).toContain('BASE-PROMPT-ADAPTER')
    expect(retryPrompt).toContain('Nguon co loi adapter co the retry an toan.')
  })

  it('thông báo giới hạn sử dụng ChatGPT tải lại trang rồi gửi lại đúng đoạn', async () => {
    const persistence = createPersistence()
    const reloadForRecovery = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce('Bạn cần ngưng sử dụng và thử lại sau.')
      .mockResolvedValueOnce('BẢN DỊCH SAU KHI TẢI LẠI TRANG.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
        reloadForRecovery,
      },
      persistence,
      validator: vi
        .fn()
        .mockReturnValueOnce(chatGptPageFailureValidation())
        .mockReturnValueOnce(severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    await runner.start({
      source: 'Nguồn phải được gửi lại sau thông báo giới hạn.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-PAGE-RECOVERY',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(reloadForRecovery).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledTimes(2)
    expect(String(sendAndWait.mock.calls[1]?.[0])).toContain('BASE-PROMPT-PAGE-RECOVERY')
  })

  it('lỗi ChatGPT lặp lại sẽ khởi động lại browser rồi dịch tiếp đúng đoạn', async () => {
    const persistence = createPersistence()
    const reloadForRecovery = vi.fn().mockResolvedValue(undefined)
    const restartForRecovery = vi.fn().mockResolvedValue(undefined)
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockRejectedValueOnce(new Error('ChatGPT không phản hồi lần 1.'))
      .mockRejectedValueOnce(new Error('ChatGPT không phản hồi lần 2.'))
      .mockRejectedValueOnce(new Error('ChatGPT không phản hồi lần 3.'))
      .mockResolvedValueOnce('BẢN DỊCH SAU KHI KHỞI ĐỘNG LẠI BROWSER.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
        reloadForRecovery,
        restartForRecovery,
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nguồn phải được gửi lại sau khi browser khởi động lại.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-RESTART-BROWSER',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(restartForRecovery).toHaveBeenCalledOnce()
    expect(reloadForRecovery).toHaveBeenCalledTimes(2)
    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(sendAndWait).toHaveBeenCalledTimes(4)
    expect(String(sendAndWait.mock.calls[3]?.[0])).toContain('BASE-PROMPT-RESTART-BROWSER')
    expect(String(sendAndWait.mock.calls[3]?.[0])).toContain('Nguồn phải được gửi lại sau khi browser khởi động lại.')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      browserRestartRecoveryAttempts: {},
      segments: [expect.objectContaining({ status: 'completed', attempts: 4 })],
    })
  })

  it('lỗi marker chat tải lại trang, tạo chat mới, rồi khởi động lại browser nếu lặp lại', async () => {
    const persistence = createPersistence()
    const reloadForRecovery = vi.fn().mockResolvedValue(undefined)
    const restartForRecovery = vi.fn().mockResolvedValue(undefined)
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockRejectedValueOnce(new ChatGptConversationVerificationError('Thiếu marker lần 1.'))
      .mockRejectedValueOnce(new ChatGptConversationVerificationError('Thiếu marker lần 2.'))
      .mockResolvedValueOnce('BẢN DỊCH SAU KHI KHỞI ĐỘNG LẠI BROWSER.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
        reloadForRecovery,
        restartForRecovery,
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nguồn cần khôi phục sau lỗi marker.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-MARKER-RECOVERY',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(reloadForRecovery).toHaveBeenCalledOnce()
    expect(restartForRecovery).toHaveBeenCalledOnce()
    expect(startNewConversation).toHaveBeenCalledTimes(3)
    expect(sendAndWait).toHaveBeenCalledTimes(3)
    expect(String(sendAndWait.mock.calls[1]?.[0])).toContain('BASE-PROMPT-MARKER-RECOVERY')
    expect(String(sendAndWait.mock.calls[2]?.[0])).toContain('BASE-PROMPT-MARKER-RECOVERY')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      segments: [expect.objectContaining({ status: 'completed', attempts: 3 })],
    })
  })

  it('lỗi marker vẫn tiếp tục bằng chat mới khi browser không thể khởi động lại', async () => {
    const persistence = createPersistence()
    const reloadForRecovery = vi.fn().mockResolvedValue(undefined)
    const restartForRecovery = vi.fn().mockRejectedValue(new Error('Không đóng được context tạm thời.'))
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockRejectedValueOnce(new ChatGptConversationVerificationError('Thiếu marker lần 1.'))
      .mockRejectedValueOnce(new ChatGptConversationVerificationError('Thiếu marker lần 2.'))
      .mockResolvedValueOnce('BẢN DỊCH SAU KHI TẠO CHAT MỚI.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
        reloadForRecovery,
        restartForRecovery,
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nguồn cần tiếp tục khi browser khởi động lại lỗi.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-MARKER-FALLBACK',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(reloadForRecovery).toHaveBeenCalledOnce()
    expect(restartForRecovery).toHaveBeenCalledOnce()
    expect(startNewConversation).toHaveBeenCalledTimes(3)
    expect(sendAndWait).toHaveBeenCalledTimes(3)
    expect(String(sendAndWait.mock.calls[2]?.[0])).toContain('BASE-PROMPT-MARKER-FALLBACK')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      segments: [expect.objectContaining({ status: 'completed', attempts: 3 })],
    })
  })

  it('adapter đã đóng context treo thì đổi ngay một chat mới, bỏ retry cũ và gửi lại base prompt', async () => {
    const persistence = createPersistence()
    const trace: string[] = []
    let conversation = 0
    const ensureReady = vi.fn().mockImplementation(async () => {
      trace.push(`ready-${conversation}`)
    })
    const startNewConversation = vi.fn(async () => {
      conversation += 1
      trace.push(`chat-${conversation}`)
    })
    const sendAndWait = vi
      .fn()
      .mockImplementationOnce(async () => {
        trace.push(`send-${conversation}`)
        throw new ChatGptFreshChatRecoveryError('Adapter da dong context cu an toan.')
      })
      .mockImplementationOnce(async () => {
        trace.push(`send-${conversation}`)
        return 'BAN-DICH-SAU-LOI-ADAPTER'
      })
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady,
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nguon co loi adapter co the retry an toan.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-ADAPTER',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(2)
    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(ensureReady).toHaveBeenCalledTimes(2)
    expect(trace).toEqual(['ready-0', 'chat-1', 'send-1', 'ready-1', 'chat-2', 'send-2'])
    const freshPrompt = String(sendAndWait.mock.calls[1]?.[0])
    expect(freshPrompt).toContain('BASE-PROMPT-ADAPTER')
    expect(freshPrompt).toContain('NGUYEN_BAN')
    expect(freshPrompt).not.toContain('BAN_DICH_LOI')
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      freshChatRecoveryAttempts: {},
      freshChatRecoveryAttemptLimits: {},
      segments: [expect.objectContaining({ status: 'completed', attempts: 2 })],
    })
  })

  it('lỗi adapter an toàn lặp lại vẫn thử đến giới hạn gửi bình thường', async () => {
    const persistence = createPersistence()
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi
      .fn()
      .mockRejectedValueOnce(new ChatGptFreshChatRecoveryError('Chat 1 đã đóng an toàn.'))
      .mockRejectedValueOnce(new ChatGptFreshChatRecoveryError('Chat 2 đã đóng an toàn.'))
      .mockRejectedValueOnce(new ChatGptFreshChatRecoveryError('Chat 3 đã đóng an toàn.'))
      .mockResolvedValueOnce('Bản dịch hoàn tất sau khi đổi chat.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const freshChatEvents: TranslationEvent[] = []
    runner.onEvent((event) => {
      if (
        event.type === 'segment-retry' &&
        (event.payload as { kind?: string } | undefined)?.kind === 'fresh-chat'
      ) {
        freshChatEvents.push(event)
      }
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed')

    const { jobId } = await runner.start({
      source: 'Nguồn kiểm tra lỗi adapter lặp lại.',
      promptMode: 'modern',
      resolvedPrompt: 'BASE-PROMPT-SAFE-ADAPTER',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(sendAndWait).toHaveBeenCalledTimes(4)
    expect(startNewConversation).toHaveBeenCalledTimes(4)
    expect(freshChatEvents).toHaveLength(3)
    expect(freshChatEvents.map((event) => (event.payload as { freshChatAttempt?: number }).freshChatAttempt))
      .toEqual([1, 2, 3])
    for (const call of sendAndWait.mock.calls) {
      const prompt = String(call[0])
      expect(prompt).toContain('BASE-PROMPT-SAFE-ADAPTER')
      expect(prompt).toContain('NGUYEN_BAN')
    }
    expect(persistence.values.get(jobId)).toMatchObject({
      status: 'completed',
      freshChatRecoveryAttempts: {},
      freshChatRecoveryAttemptLimits: {},
      segments: [expect.objectContaining({ status: 'completed', attempts: 4 })],
    })
  })

  it.each([
    new ChatGptNonRetryableSafetyError('Trang gửi không an toàn.'),
  ])('không retry lỗi an toàn không thể gửi lại: $name', async (fatalError) => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn().mockRejectedValue(fatalError)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')

    const { jobId } = await runner.start({
      source: '她站在窗前，安静地看着雨。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
      settings: { maxRetries: 3 },
    })
    await failed

    expect(sendAndWait).toHaveBeenCalledTimes(1)
    const saved = persistence.values.get(jobId) as {
      error: string;
      segments: Array<{ attempts: number }>;
    }
    expect(saved.segments[0]?.attempts).toBe(1)
    expect(saved.error).toContain('1 lần thử')
  })

  it('retry job A sau khi job B hoàn tất luôn tạo conversation riêng thay vì gửi vào chat B', async () => {
    const persistence = createPersistence()
    let activeConversation = 0
    const sendConversations: number[] = []
    const startNewConversation = vi.fn(async () => {
      activeConversation += 1
    })
    const sendAndWait = vi
      .fn()
      .mockImplementationOnce(async () => {
        sendConversations.push(activeConversation)
        throw new ChatGptGenerationStopError('Không thể xác minh phản hồi của tác vụ A đã dừng.')
      })
      .mockImplementationOnce(async () => {
        sendConversations.push(activeConversation)
        return 'Bản dịch của tác vụ B đã hoàn tất.'
      })
      .mockImplementationOnce(async () => {
        sendConversations.push(activeConversation)
        return 'Bản dịch mới của tác vụ A đã hoàn tất.'
      })
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    const failedA = waitForEvent(runner, (event) => event.type === 'job-failed')
    const { jobId: jobA } = await runner.start({
      source: '你好。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch tác vụ A.',
      settings: { maxRetries: 0 },
    })
    await failedA
    const segmentA = (persistence.values.get(jobA) as {
      segments: Array<{ id: string }>;
    }).segments[0]!.id

    const completedB = waitForEvent(runner, (event) => event.type === 'job-completed')
    const { jobId: jobB } = await runner.start({
      source: '她轻轻点头。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch tác vụ B.',
      settings: { maxRetries: 0 },
    })
    expect((await completedB).jobId).toBe(jobB)

    const completedRetryA = waitForEvent(
      runner,
      (event) => event.type === 'job-completed' && event.jobId === jobA,
    )
    await runner.retrySegment({ jobId: jobA, segmentId: segmentA })
    await completedRetryA

    expect(startNewConversation).toHaveBeenCalledTimes(3)
    expect(sendConversations).toEqual([1, 2, 3])
    expect((persistence.values.get(jobA) as { status: string }).status).toBe('completed')
    expect((persistence.values.get(jobB) as { status: string }).status).toBe('completed')
  })

  it('chat mới khi retry thủ công nhận ngữ cảnh đuôi giới hạn, không nhận toàn output cũ', async () => {
    const persistence = createPersistence()
    const previousOutput = `MỞ ĐẦU-KHÔNG-ĐƯỢC-GỬI-LẠI ${'a'.repeat(4_500)} ĐUÔI-CẦN-GIỮ-LẠI.`
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce(previousOutput)
      .mockRejectedValueOnce(
        new ChatGptGenerationStopError('Không thể xác minh phản hồi cũ đã dừng.'),
      )
      .mockResolvedValueOnce('Đoạn lỗi đã được dịch hoàn chỉnh trong lần thử mới.')
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      chunker: vi.fn(() => [
        { id: 'segment-1', index: 0, start: 0, end: 4, text: '第一段。' },
        { id: 'segment-2', index: 1, start: 4, end: 8, text: '第二段。' },
      ]),
    })

    const failed = waitForEvent(runner, (event) => event.type === 'job-failed')
    const { jobId } = await runner.start({
      source: '第一段。第二段。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch truyện sang tiếng Việt.',
      settings: { maxRetries: 0 },
    })
    await failed
    const failedSegment = (persistence.values.get(jobId) as {
      segments: Array<{ id: string; status: string }>;
    }).segments.find((segment) => segment.status === 'failed')!

    const completed = waitForEvent(
      runner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await runner.retrySegment({ jobId, segmentId: failedSegment.id })
    await completed

    expect(startNewConversation).toHaveBeenCalledTimes(2)
    const recoveryPrompt = String(sendAndWait.mock.calls[2]?.[0])
    expect(recoveryPrompt).toContain('NGỮ CẢNH KHÔI PHỤC CHO CHAT MỚI')
    expect(recoveryPrompt).toContain('ĐUÔI-CẦN-GIỮ-LẠI.')
    expect(recoveryPrompt).not.toContain('MỞ ĐẦU-KHÔNG-ĐƯỢC-GỬI-LẠI')
    expect(recoveryPrompt).not.toContain(previousOutput)
    expect(recoveryPrompt.length).toBeLessThan(5_000)
    expect(recoveryPrompt).toContain('第二段。')
  })

  it('resume sau restart mở một chat mới và gửi full base kèm recovery context giới hạn', async () => {
    const persistence = createPersistence()
    const previousOutput = `PHẦN-ĐẦU-KHÔNG-MANG-SANG ${'b'.repeat(3_500)} NGỮ-CẢNH-ĐUÔI.`
    const jobId = 'restart-job'
    persistence.values.set(jobId, {
      id: jobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'paused',
      promptMode: 'modern',
      resolvedPrompt: 'BASE PROMPT KHÔI PHỤC',
      sourceText: '第一段。第二段。',
      translatedText: previousOutput,
      currentSegmentIndex: 1,
      segments: [
        {
          id: 'segment-1', index: 0, start: 0, end: 4, sourceText: '第一段。',
          translatedText: previousOutput, status: 'completed', attempts: 1,
        },
        {
          id: 'segment-2', index: 1, start: 4, end: 8, sourceText: '第二段。',
          translatedText: '', status: 'queued', attempts: 0,
        },
      ],
      settings: {
        maxCharsPerSegment: 2_000,
        maxRetries: 1,
        responseTimeoutMs: 180_000,
        validation: {
          requireNoHan: true,
          minimumSourceLengthForRatioCheck: 80,
          minimumLengthRatio: 0.2,
          checkPreamble: true,
          checkTruncation: true,
          checkRepetition: true,
        },
      },
      conversationInitialized: true,
      conversationRecoveryPending: false,
      conversationHasBasePrompt: true,
      localizedHanRepairAttempts: {},
    })
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn().mockResolvedValue('Đoạn thứ hai đã được dịch hoàn chỉnh.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    await expect(runner.get(jobId)).resolves.toMatchObject({ status: 'paused' })
    const completed = waitForEvent(
      runner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await runner.resume(jobId)
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledOnce()
    const prompt = String(sendAndWait.mock.calls[0]?.[0])
    expect(prompt).toContain('BASE PROMPT KHÔI PHỤC')
    expect(prompt).toContain('NGỮ CẢNH KHÔI PHỤC CHO CHAT MỚI')
    expect(prompt).toContain('NGỮ-CẢNH-ĐUÔI.')
    expect(prompt).not.toContain('PHẦN-ĐẦU-KHÔNG-MANG-SANG')
    expect(prompt).not.toContain(previousOutput)
    expect(prompt).toContain('第二段。')
  })

  it('continues a failed chat-setup checkpoint when only the next segment is queued', async () => {
    const values = new Map<string, unknown>()
    const snapshots: Array<Record<string, unknown>> = []
    const persistence = {
      values,
      async saveJob(job: { id: string }) {
        const copy = structuredClone(job) as Record<string, unknown>
        values.set(job.id, copy)
        snapshots.push(copy)
      },
      async loadJob<T>(id: string): Promise<T | null> {
        return (values.has(id) ? structuredClone(values.get(id)) : null) as T | null
      },
    }
    const jobId = 'failed-chat-setup-checkpoint'
    const firstTranslation = 'Phần đầu đã được dịch và cần giữ lại.'
    const setupFailure = 'Không tìm thấy lệnh Xóa trong menu cuộc chat do tool tạo.'
    const timestamp = new Date().toISOString()
    values.set(jobId, {
      id: jobId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'failed',
      promptMode: 'modern',
      resolvedPrompt: 'BASE PROMPT KHÔI PHỤC SAU LỖI SETUP',
      sourceText: '第一段。第二段。',
      translatedText: firstTranslation,
      currentSegmentIndex: 1,
      error: setupFailure,
      segments: [
        {
          id: 'segment-1', index: 0, start: 0, end: 4, sourceText: '第一段。',
          translatedText: firstTranslation, status: 'completed', attempts: 1,
        },
        {
          id: 'segment-2', index: 1, start: 4, end: 8, sourceText: '第二段。',
          translatedText: '', status: 'queued', attempts: 0,
        },
      ],
      settings: {
        maxCharsPerSegment: 2_000,
        maxRetries: 1,
        responseTimeoutMs: 480_000,
        validation: {
          requireNoHan: true,
          minimumSourceLengthForRatioCheck: 80,
          minimumLengthRatio: 0.2,
          checkPreamble: true,
          checkTruncation: true,
          checkRepetition: true,
        },
      },
      conversationInitialized: true,
      conversationRecoveryPending: false,
      conversationHasBasePrompt: true,
      localizedHanRepairAttempts: {},
    })

    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn().mockResolvedValue('Phần thứ hai đã được dịch hoàn chỉnh.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })
    const statusEvents: string[] = []
    runner.onEvent((event) => {
      if (event.type === 'job-status' && event.jobId === jobId) {
        const status = (event.payload as { status?: string } | undefined)?.status
        if (status) statusEvents.push(status)
      }
    })

    await expect(runner.get(jobId)).resolves.toMatchObject({
      status: 'failed',
      completedSegments: 1,
      error: setupFailure,
    })
    const completed = waitForEvent(
      runner,
      (event) => event.type === 'job-completed' && event.jobId === jobId,
    )
    await runner.resume(jobId)
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledOnce()
    const prompt = String(sendAndWait.mock.calls[0]?.[0])
    expect(prompt).toContain('BASE PROMPT KHÔI PHỤC SAU LỖI SETUP')
    expect(prompt).toContain('NGỮ CẢNH KHÔI PHỤC CHO CHAT MỚI')
    expect(prompt).toContain(firstTranslation)
    expect(prompt).toContain('第二段。')
    expect(statusEvents).toContain('queued')
    expect(snapshots).toContainEqual(expect.objectContaining({
      status: 'queued',
      error: undefined,
      conversationInitialized: false,
      conversationHasBasePrompt: false,
      conversationRecoveryPending: true,
      currentSegmentIndex: 1,
    }))
    const finalSnapshot = await runner.get(jobId)
    expect(finalSnapshot).toMatchObject({
      status: 'completed',
      completedSegments: 2,
      translatedText: `${firstTranslation}\n\nPhần thứ hai đã được dịch hoàn chỉnh.`,
    })
    expect(finalSnapshot).not.toHaveProperty('error')
  })

  it('does not continue a failed job when a specific segment must be retried', async () => {
    const persistence = createPersistence()
    const jobId = 'failed-segment-requires-explicit-retry'
    const timestamp = new Date().toISOString()
    persistence.values.set(jobId, {
      id: jobId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'failed',
      promptMode: 'modern',
      resolvedPrompt: 'BASE PROMPT',
      sourceText: '第一段。',
      translatedText: '',
      currentSegmentIndex: 0,
      error: 'Đoạn 1 lỗi sau 1 lần thử.',
      segments: [{
        id: 'segment-1', index: 0, start: 0, end: 4, sourceText: '第一段。',
        translatedText: '', status: 'failed', attempts: 1, error: 'Lỗi dịch.',
      }],
      settings: {
        maxCharsPerSegment: 2_000,
        maxRetries: 1,
        responseTimeoutMs: 480_000,
        validation: {
          requireNoHan: true,
          minimumSourceLengthForRatioCheck: 80,
          minimumLengthRatio: 0.2,
          checkPreamble: true,
          checkTruncation: true,
          checkRepetition: true,
        },
      },
      conversationInitialized: false,
      conversationRecoveryPending: false,
      conversationHasBasePrompt: false,
      localizedHanRepairAttempts: {},
    })
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait: vi.fn().mockResolvedValue('Không được gửi.'),
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
    })

    await expect(runner.resume(jobId)).rejects.toThrow(/thử lại đúng đoạn/iu)
    expect(startNewConversation).not.toHaveBeenCalled()
    await expect(runner.get(jobId)).resolves.toMatchObject({
      status: 'failed',
      segments: [expect.objectContaining({ status: 'failed' })],
    })
  })

  it.each(['conversation-init', 'sending', 'validating'] as const)(
    'cancel trong checkpoint %s luôn thắng và không bị runner hồi sinh/đánh dấu completed',
    async (checkpointStage) => {
      const values = new Map<string, unknown>()
      let writeQueue = Promise.resolve()
      let releaseGate!: () => void
      let enterGate!: () => void
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      const gateEntered = new Promise<void>((resolve) => {
        enterGate = resolve
      })
      let gated = false
      const persistence = {
        values,
        saveJob<T extends { id: string }>(job: T) {
          const snapshot = structuredClone(job) as T & {
            status: string;
            conversationInitialized: boolean;
            segments: Array<{ status: string }>;
          }
          const segmentStatus = snapshot.segments[0]?.status
          const shouldGate = !gated && (
            (checkpointStage === 'conversation-init' &&
              snapshot.status === 'queued' &&
              snapshot.conversationInitialized &&
              segmentStatus === 'queued') ||
            (checkpointStage === 'sending' && segmentStatus === 'sending') ||
            (checkpointStage === 'validating' && segmentStatus === 'validating')
          )
          const operation = writeQueue.then(async () => {
            if (shouldGate) {
              gated = true
              enterGate()
              await gate
            }
            values.set(snapshot.id, snapshot)
          })
          writeQueue = operation.catch(() => undefined)
          return operation
        },
        async loadJob<T>(id: string): Promise<T | null> {
          return (values.has(id) ? structuredClone(values.get(id)) : null) as T | null
        },
      }
      const sendAndWait = vi.fn().mockResolvedValue('Bản dịch đã hoàn tất đầy đủ.')
      const cancelGeneration = vi.fn().mockResolvedValue(undefined)
      const runner = new TranslationJobRunner({
        chatGpt: {
          ensureReady: vi.fn().mockResolvedValue(undefined),
          startNewConversation: vi.fn().mockResolvedValue(undefined),
          sendAndWait,
          cancelGeneration,
        },
        persistence,
      })
      const completedEvents: TranslationEvent[] = []
      runner.onEvent((event) => {
        if (event.type === 'job-completed') completedEvents.push(event)
      })

      const { jobId } = await runner.start({
        source: '她站在窗边，安静地看着远方。',
        promptMode: 'modern',
        resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
        settings: { maxRetries: 0 },
      })
      await gateEntered

      const cancelPromise = runner.cancel(jobId)
      await vi.waitFor(() => expect(cancelGeneration).toHaveBeenCalledOnce())
      releaseGate()
      await cancelPromise
      await vi.waitFor(() => {
        expect((values.get(jobId) as { status: string }).status).toBe('cancelled')
      })

      await expect(runner.get(jobId)).resolves.toMatchObject({ status: 'cancelled' })
      expect(completedEvents).toHaveLength(0)
      expect(sendAndWait).toHaveBeenCalledTimes(checkpointStage === 'validating' ? 1 : 0)
      expect((values.get(jobId) as { segments: Array<{ status: string }> }).segments[0]?.status)
        .toBe(checkpointStage === 'conversation-init' ? 'queued' : 'cancelled')
    },
  )

  it('tiếp tục rõ ràng checkpoint đã hủy, giữ nguyên phần đã hoàn tất', async () => {
    const persistence = createPersistence()
    const jobId = 'cancelled-resume-checkpoint'
    const timestamp = new Date().toISOString()
    persistence.values.set(jobId, {
      id: jobId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'cancelled',
      promptMode: 'modern',
      resolvedPrompt: 'BASE PROMPT',
      sourceText: 'Nguồn 1\n\nNguồn 2',
      translatedText: 'Bản dịch đã hoàn tất.',
      currentSegmentIndex: 1,
      segments: [
        { id: 'segment-1', index: 0, sourceText: 'Nguồn 1', translatedText: 'Bản dịch đã hoàn tất.', status: 'completed', attempts: 1 },
        { id: 'segment-2', index: 1, sourceText: 'Nguồn 2', translatedText: '', status: 'cancelled', attempts: 1 },
      ],
      settings: {
        maxCharsPerSegment: 2_000,
        maxRetries: 1,
        responseTimeoutMs: 480_000,
        validation: {
          requireNoHan: true,
          minimumSourceLengthForRatioCheck: 80,
          minimumLengthRatio: 0.2,
          checkPreamble: true,
          checkTruncation: true,
          checkRepetition: true,
        },
      },
      conversationInitialized: false,
      conversationRecoveryPending: false,
      conversationHasBasePrompt: false,
      localizedHanRepairAttempts: {},
      freshChatRecoveryAttempts: {},
      freshChatRecoveryAttemptLimits: {},
      browserRestartRecoveryAttempts: {},
      pageReloadRecoveryAttempts: {},
    })
    const sendAndWait = vi.fn().mockResolvedValue('Bản dịch còn lại đã hoàn tất.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation: vi.fn().mockResolvedValue(undefined),
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(true)),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed' && event.jobId === jobId)

    await runner.resume(jobId)
    await completed

    expect(sendAndWait).toHaveBeenCalledOnce()
    await expect(runner.get(jobId)).resolves.toMatchObject({
      status: 'completed',
      translatedText: expect.stringContaining('Bản dịch đã hoàn tất.'),
      segments: [
        expect.objectContaining({ id: 'segment-1', status: 'completed' }),
        expect.objectContaining({ id: 'segment-2', status: 'completed' }),
      ],
    })
  })

  it('vẫn checkpoint và emit cancelled khi thao tác dừng ChatGPT bị lỗi', async () => {
    const persistence = createPersistence()
    const sendAndWait = vi.fn((_prompt: string, options: { signal?: AbortSignal }) => (
      new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason ?? new DOMException('Đã hủy.', 'AbortError'))
        }, { once: true })
      })
    ))
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const stopFailure = new Error('stop button DOM unavailable')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockRejectedValue(stopFailure),
      },
      persistence,
    })
    const cancelledEvents: TranslationEvent[] = []
    runner.onEvent((event) => {
      if (event.type === 'job-status' &&
          (event.payload as { status?: string } | undefined)?.status === 'cancelled') {
        cancelledEvents.push(event)
      }
    })

    const { jobId } = await runner.start({
      source: '她站在窗前，安静地看着雨。',
      promptMode: 'modern',
      resolvedPrompt: 'Dịch đầy đủ sang tiếng Việt.',
    })
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledOnce())

    await expect(runner.cancel(jobId)).rejects.toThrow(/đã được lưu là đã hủy/iu)
    await vi.waitFor(() => {
      expect((persistence.values.get(jobId) as { status: string }).status).toBe('cancelled')
    })
    await expect(runner.get(jobId)).resolves.toMatchObject({
      status: 'cancelled',
      segments: [expect.objectContaining({ status: 'cancelled' })],
    })
    expect(cancelledEvents).toHaveLength(1)

    // Give the aborted run a turn to enter launch.finally; cancelRequests must
    // prevent any automatic relaunch after the stop-button failure.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledOnce()
  })

  it('phản hồi an toàn nhận đủ ba ngữ cảnh trong chat cũ rồi một lần ở chat mới', async () => {
    const persistence = createPersistence()
    const refusal = 'Không thể hiển thị nội dung này vì lý do an toàn. Tìm hiểu thêm về cách tiếp cận của chúng tôi đối với các cuộc hội thoại nhạy cảm.'
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn()
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce('BẢN DỊCH ĐẦY ĐỦ ĐÃ ĐƯỢC PHỤC HỒI.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn((_source: string, translation: string) => severeValidationResult(
        translation === 'BẢN DỊCH ĐẦY ĐỦ ĐÃ ĐƯỢC PHỤC HỒI.',
      )),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed', 15_000)

    await runner.start({
      source: 'NGUỒN CÓ TÌNH TIẾT HƯ CẤU.',
      promptMode: 'modern',
      resolvedPrompt: 'PROMPT GỐC DỊCH TRUYỆN',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(sendAndWait).toHaveBeenCalledTimes(6)
    const prompts = sendAndWait.mock.calls.map(([prompt]) => String(prompt))
    expect(prompts.filter((prompt) => prompt.includes('NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN'))).toHaveLength(4)
    expect(prompts[4]).not.toContain('NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN')
    expect(prompts[5]).toContain('NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN')
  }, 15_000)

  it('nhận diện thông báo an toàn tiếng Anh có dấu nháy cong và gửi ngữ cảnh trước khi dịch lại', async () => {
    const persistence = createPersistence()
    const refusal = "This content can’t be shown for safety reasons\nIf this seems like a mistake, give this response a thumbs down. Learn more about our approach to sensitive conversations."
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn()
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce('BẢN DỊCH ĐẦY ĐỦ SAU KHI GIẢI THÍCH NGỮ CẢNH.')
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn((_source: string, translation: string) => severeValidationResult(
        translation === 'BẢN DỊCH ĐẦY ĐỦ SAU KHI GIẢI THÍCH NGỮ CẢNH.',
      )),
    })
    const completed = waitForEvent(runner, (event) => event.type === 'job-completed', 15_000)

    await runner.start({
      source: 'NGUỒN CÓ TÌNH TIẾT HƯ CẤU.',
      promptMode: 'modern',
      resolvedPrompt: 'PROMPT GỐC DỊCH TRUYỆN',
      settings: { maxRetries: 3 },
    })
    await completed

    expect(startNewConversation).toHaveBeenCalledOnce()
    expect(sendAndWait).toHaveBeenCalledTimes(2)
    expect(String(sendAndWait.mock.calls[1]?.[0]))
      .toContain('NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN')
  }, 15_000)

  it('phản hồi an toàn lặp lại sau lần thử có ngữ cảnh ở chat mới thì báo lỗi', async () => {
    const persistence = createPersistence()
    const refusal = 'Không thể hiển thị nội dung này vì lý do an toàn.'
    const startNewConversation = vi.fn().mockResolvedValue(undefined)
    const sendAndWait = vi.fn().mockResolvedValue(refusal)
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        startNewConversation,
        sendAndWait,
        cancelGeneration: vi.fn().mockResolvedValue(undefined),
      },
      persistence,
      validator: vi.fn(() => severeValidationResult(false)),
    })
    const failed = waitForEvent(runner, (event) => event.type === 'job-failed', 15_000)

    const { jobId } = await runner.start({
      source: 'NGUỒN CÓ TÌNH TIẾT HƯ CẤU.',
      promptMode: 'modern',
      resolvedPrompt: 'PROMPT GỐC DỊCH TRUYỆN',
      settings: { maxRetries: 3 },
    })
    await failed

    expect(startNewConversation).toHaveBeenCalledTimes(2)
    expect(sendAndWait).toHaveBeenCalledTimes(6)
    expect((persistence.values.get(jobId) as { error: string }).error)
      .toContain('tiếp tục từ chối nội dung')
  }, 15_000)
})
