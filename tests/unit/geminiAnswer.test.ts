import { describe, expect, it } from 'vitest'
import { stripRestartedOpening } from '../../src/main/chatgpt/geminiAnswer'

describe('Gemini restarted-answer cleanup', () => {
  it('drops the abandoned opening when Gemini restarts the reply', () => {
    // Reproduced from a live run: the first attempt stops mid-sentence and the
    // page glues the restarted heading straight onto it, with no line break.
    const artifact = [
      'Chương 1: Sáng sớm ở căn nhà cũ',
      '',
      'Lâm Vãn đẩy cánh cửa gỗ đã tróc sơn ra, hương hoa quế trong sân nương theo gió ùa vào ngập trànChương 1: Buổi sớm nơi nhà cũ',
      '',
      'Lâm Vãn đẩy cánh cửa gỗ đã tróc sơn, hương hoa quế trong sân nương theo ngọn gió ùa vào.',
      'Cô đứng trên bậc cửa, nhìn lớp lá rụng dày đặc phủ kín thềm đá.',
    ].join('\n')

    const cleaned = stripRestartedOpening(artifact)

    expect(cleaned.startsWith('Chương 1: Buổi sớm nơi nhà cũ')).toBe(true)
    expect(cleaned).not.toContain('ngập trànChương')
    expect(cleaned.split('\n').filter((line) => /^Chương/.test(line))).toHaveLength(1)
    expect(cleaned).toContain('Cô đứng trên bậc cửa')
  })

  it('leaves a normal translation that mentions another chapter untouched', () => {
    const normal = [
      'Chương 1: Buổi sớm nơi nhà cũ',
      '',
      'Lâm Vãn đẩy cánh cửa gỗ đã tróc sơn.',
      'Cô nhớ lại những gì đã xảy ra ở Chương 2 hôm trước.',
    ].join('\n')

    expect(stripRestartedOpening(normal)).toBe(normal)
  })

  it('does not touch a single mention of the chapter', () => {
    const text = 'Xin chào. Hôm nay trời đẹp.\nChương 1: ở giữa đoạn văn thì không tính.'
    expect(stripRestartedOpening(text)).toBe(text)
  })

  it('ignores a cross-reference inside a paragraph of the same chapter', () => {
    const text = [
      'Chương 1: Mở đầu',
      'Như đã kể ở chương 1, nhân vật chính vẫn còn nhớ rất rõ mọi chuyện đã xảy ra trong đêm hôm ấy.',
    ].join('\n')

    // The second mention is not a heading: its line is a full paragraph.
    expect(stripRestartedOpening(text)).toBe(text)
  })

  it('ignores a second heading that appears far below the opening', () => {
    const lines = ['Chương 1: Mở đầu']
    for (let index = 0; index < 80; index += 1) lines.push(`Dòng nội dung số ${index} của chương này.`)
    lines.push('Chương 2: Không phải khởi động lại')
    const text = lines.join('\n')

    expect(stripRestartedOpening(text)).toBe(text)
  })
})
