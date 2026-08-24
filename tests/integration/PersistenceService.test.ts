import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PersistenceService } from '../../src/main/persistence/PersistenceService'

function createSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`secured:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^secured:/u, ''),
  }
}

describe('PersistenceService', () => {
  it('lưu và đọc lại draft UTF-8 bằng ghi file nguyên tử', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-'))
    const service = new PersistenceService(directory, createSafeStorage())
    const draft = {
      source: '第一章，重逢；繁體小說「測試」……',
      output: 'Cô khẽ mỉm cười. Ắ ằ ễ ộ ỳ · A\u0306\u0301 a\u0306\u0300 e\u0302\u0303 o\u0323\u0302 y\u0300 😀',
    }

    await service.saveDraft(draft)
    await service.flush()

    await expect(service.loadDraft()).resolves.toEqual(draft)
    const raw = await readFile(path.join(directory, 'draft.json'), 'utf8')
    expect(raw).toContain(draft.source)
    expect(raw).toContain(draft.output)
  })

  it('đọc draft lớn ngoài luồng và chỉ trả metadata khi nội dung đã nằm trong checkpoint', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-large-'))
    const service = new PersistenceService(directory, createSafeStorage())
    const source = '原'.repeat(700_000)
    const output = 'Bản dịch '.repeat(90_000)
    await service.saveJob({
      id: 'job-large', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: 'paused', aiProvider: 'chatgpt', sourceText: source, translatedText: output,
      segments: [{ id: 's1', index: 0, status: 'completed', sourceText: source, translatedText: output }],
    })
    await service.saveDraft({
      source, output, autoExportOutput: output, autoExportJobId: 'job-large', autoExportStartedAt: Date.now(),
    })
    await service.flush()

    await expect(service.loadDraft()).resolves.toMatchObject({ source, output })
    await expect(service.loadRendererDraft()).resolves.toMatchObject({
      source: '', output: '', autoExportOutput: '', autoExportJobId: 'job-large',
    })
  })

  it('lịch sử checkpoint chỉ trả tóm tắt, không chuyển nội dung sách lớn qua IPC', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-summary-'))
    const service = new PersistenceService(directory, createSafeStorage())
    await service.saveJob({
      id: 'job-summary', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:01:00.000Z',
      status: 'failed', aiProvider: 'kimi', sourceText: '原文'.repeat(400_000), translatedText: 'Bản dịch'.repeat(200_000),
      segments: [
        { id: 's1', index: 0, status: 'completed', sourceText: 'nguồn', translatedText: 'dịch' },
        { id: 's2', index: 1, status: 'failed', error: 'Lỗi kiểm thử', sourceText: 'nguồn 2', translatedText: '' },
      ],
      activityLog: [{ at: '2026-08-25T00:01:00.000Z', tone: 'warning', message: 'Đã thử lại.' }],
    })

    const summaries = await service.listJobSummaries()
    expect(summaries).toEqual([expect.objectContaining({
      id: 'job-summary', status: 'failed', aiProvider: 'kimi', totalSegments: 2, completedSegments: 1,
    })])
    expect(summaries[0]).not.toHaveProperty('sourceText')
    expect(summaries[0]).not.toHaveProperty('translatedText')
    expect(summaries[0]?.segments[1]).toMatchObject({ status: 'failed', error: 'Lỗi kiểm thử' })
  })

  it('mã hóa Gemini API key và không ghi khóa thô vào settings', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-'))
    const service = new PersistenceService(directory, createSafeStorage())

    await service.updateGeminiConfiguration({ apiKey: 'secret-key', model: 'gemini-test' })

    await expect(service.getGeminiApiKey()).resolves.toBe('secret-key')
    await expect(service.getGeminiConfiguration()).resolves.toEqual({
      hasApiKey: true,
      model: 'gemini-test',
    })
    const raw = await readFile(path.join(directory, 'settings.json'), 'utf8')
    expect(raw).not.toContain('secret-key')
  })

  it('từ chối job id có ký tự đường dẫn', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-'))
    const service = new PersistenceService(directory, createSafeStorage())
    await expect(service.loadJob('../outside')).rejects.toThrow(/Mã tác vụ không hợp lệ/u)
  })

  it('lưu lựa chọn Kimi riêng trong settings và mặc định ChatGPT cho bản cũ', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tool-dich-truyen-'))
    const service = new PersistenceService(directory, createSafeStorage())

    await expect(service.getAiProvider()).resolves.toBe('chatgpt')
    await expect(service.setAiProvider('kimi')).resolves.toBe('kimi')
    await service.flush()

    const restored = new PersistenceService(directory, createSafeStorage())
    await expect(restored.getAiProvider()).resolves.toBe('kimi')
  })
})
