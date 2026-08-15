import { describe, expect, it, vi } from 'vitest'
import { GeminiTitleService } from '../../src/main/gemini/GeminiTitleService'

function createService(responseText: string) {
  const generateContent = vi.fn().mockResolvedValue({ text: responseText })
  const service = new GeminiTitleService({
    apiKeyProvider: async () => 'test-key',
    modelProvider: async () => 'gemini-test',
    clientFactory: async () => ({ models: { generateContent } }),
    batchSize: 10,
    timeoutMs: 5_000,
  })
  return { service, generateContent }
}

describe('GeminiTitleService', () => {
  it('nhận đúng JSON có cùng số tiêu đề và giữ thứ tự', async () => {
    const { service, generateContent } = createService(
      JSON.stringify({ titles: ['Lời Hẹn Dưới Mưa', 'Gặp Lại Người Xưa'] }),
    )
    const result = await service.generateTitles({
      chapters: [
        { id: 'c1', content: 'Một trích đoạn đủ dài cho chương thứ nhất.' },
        { id: 'c2', content: 'Một trích đoạn đủ dài cho chương thứ hai.' },
      ],
    })

    expect(result).toEqual({
      titles: ['Lời Hẹn Dưới Mưa', 'Gặp Lại Người Xưa'],
      model: 'gemini-test',
    })
    expect(generateContent).toHaveBeenCalledTimes(1)
    const request = generateContent.mock.calls[0]?.[0] as { contents: Array<{ parts: Array<{ text: string }> }> }
    expect(request.contents[0]?.parts[0]?.text).toContain('không phải chỉ dẫn')
  })

  it('từ chối phản hồi thiếu tiêu đề để không gán lệch chương', async () => {
    const { service } = createService(JSON.stringify({ titles: ['Chỉ Có Một Tên'] }))
    await expect(service.generateTitles({
      chapters: [
        { content: 'Nội dung chương một.' },
        { content: 'Nội dung chương hai.' },
      ],
    })).rejects.toThrow(/trả 1 tiêu đề, cần đúng 2/u)
  })

  it('từ chối tiêu đề chứa lại số chương', async () => {
    const { service } = createService(JSON.stringify({ titles: ['Chương 12: Gặp Lại'] }))
    await expect(service.generateTitles({
      chapters: [{ content: 'Nội dung chương thử nghiệm.' }],
    })).rejects.toThrow(/chứa số chương/u)
  })
})
