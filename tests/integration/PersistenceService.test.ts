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
})
