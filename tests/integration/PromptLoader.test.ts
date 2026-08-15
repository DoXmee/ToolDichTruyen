import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePromptMode, PromptLoader } from '../../src/main/prompts'

describe('PromptLoader', () => {
  it('đọc chính xác hai prompt UTF-8 đóng gói', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'story-prompts-'))
    await writeFile(path.join(directory, 'nien-dai.txt'), '\uFEFFPrompt niên đại', 'utf8')
    await writeFile(path.join(directory, 'hien-dai.txt'), 'Prompt hiện đại', 'utf8')
    const loader = new PromptLoader([directory])

    await expect(loader.loadCatalog()).resolves.toEqual({
      historical: 'Prompt niên đại',
      modern: 'Prompt hiện đại',
    })
  })

  it('chuẩn hóa các tên chế độ do renderer và shared sử dụng', () => {
    expect(normalizePromptMode('period')).toBe('historical')
    expect(normalizePromptMode('niên đại')).toBe('historical')
    expect(normalizePromptMode('modern')).toBe('modern')
    expect(normalizePromptMode('khác')).toBe('custom')
  })

  it('bắt buộc prompt tùy chỉnh phải có nội dung', async () => {
    const loader = new PromptLoader([])
    await expect(loader.resolve('custom', '   ')).rejects.toThrow(/Vui lòng nhập prompt/u)
  })
})
