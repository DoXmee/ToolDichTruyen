import { describe, expect, it } from 'vitest'
import {
  chooseNewestProModel,
  currentModelFromAriaLabel,
  isProModelLabel,
  normalizeModelChipText,
  proModelVersion,
  quotaNoticeForLockedModel,
} from '../../src/main/chatgpt/geminiModel'

// Labels copied verbatim from the live picker of a Pro account.
const LIVE_MENU = [
  '3.5 Flash-Lite Câu trả lời nhanh nhất',
  '3.8 Flash Trợ giúp toàn diện',
  '3.1 Pro Suy luận nâng cao',
  'Tư duy mở rộng Giải quyết vấn đề phức tạp',
]

describe('Gemini Pro model selection', () => {
  it('recognises only labels that name a Pro model', () => {
    expect(isProModelLabel('3.1 Pro Suy luận nâng cao')).toBe(true)
    expect(isProModelLabel('Pro')).toBe(true)
    expect(isProModelLabel('4.0 Pro')).toBe(true)
    expect(isProModelLabel('3.8 Flash Trợ giúp toàn diện')).toBe(false)
    expect(isProModelLabel('3.5 Flash-Lite Câu trả lời nhanh nhất')).toBe(false)
    // A Pro-tier thinking mode that does not name itself Pro is not selected.
    expect(isProModelLabel('Tư duy mở rộng Giải quyết vấn đề phức tạp')).toBe(false)
    expect(isProModelLabel('')).toBe(false)
  })

  it('picks the newest Pro model from the live menu', () => {
    expect(chooseNewestProModel(LIVE_MENU)).toBe(2)
    expect(proModelVersion(LIVE_MENU[2]!)).toBe(3.1)
  })

  it('prefers the higher version when the account offers several Pro models', () => {
    expect(chooseNewestProModel(['2.5 Pro', '3.1 Pro Suy luận nâng cao', '3.0 Pro'])).toBe(1)
  })

  it('reports that there is no Pro model instead of guessing', () => {
    expect(chooseNewestProModel(['3.8 Flash', '3.5 Flash-Lite', 'Tư duy mở rộng'])).toBeUndefined()
    expect(chooseNewestProModel([])).toBeUndefined()
  })

  it('keeps the picker order when two Pro entries share a version', () => {
    expect(chooseNewestProModel(['3.1 Pro', '3.1 Pro (beta)'])).toBe(0)
  })
})

/**
 * Google changed the chip layout: the short label element now holds only the
 * brand ("Gemini") while the model name moved to the button aria-label and the
 * full button text ("Gemini Pro"). These values were captured from the live
 * page after the tool started failing mid-job.
 */
describe('Gemini chip reading', () => {
  it('reads the model from the aria-label of the current layout', () => {
    expect(currentModelFromAriaLabel('Mở công cụ chọn chế độ, hiện tại là Gemini Pro'))
      .toBe('Gemini Pro')
    expect(currentModelFromAriaLabel('Mở công cụ chọn chế độ, hiện tại là Flash')).toBe('Flash')
    expect(currentModelFromAriaLabel('Open mode picker, currently Gemini Pro')).toBe('Gemini Pro')
  })

  it('does not invent a model when the aria-label names none', () => {
    expect(currentModelFromAriaLabel('')).toBe('')
    expect(currentModelFromAriaLabel('Mở công cụ chọn chế độ')).toBe('')
  })

  it('treats a brand-only chip text as no model at all', () => {
    expect(normalizeModelChipText('Gemini')).toBe('')
    expect(normalizeModelChipText('Google')).toBe('')
    expect(normalizeModelChipText('Gemini\nPro')).toBe('Gemini Pro')
    expect(normalizeModelChipText('Gemini Pro')).toBe('Gemini Pro')
    expect(normalizeModelChipText('Flash')).toBe('Flash')
    expect(normalizeModelChipText('')).toBe('')
  })

  it('accepts the branding form of the Pro model', () => {
    expect(isProModelLabel('Gemini Pro')).toBe(true)
    expect(isProModelLabel('Gemini Ultra')).toBe(false)
  })
})

describe('Gemini quota notice', () => {
  it('turns the locked menu entry into a readable notice with the reset time', () => {
    // Copied from the live menu after the advanced quota ran out: note that the
    // page itself glues "vào" to the time.
    const notice = quotaNoticeForLockedModel('3.1 Pro Hạn mức sẽ được đặt lại vào15:13 20 thg 9')

    expect(notice).toContain('hết hạn mức')
    expect(notice).toContain('3.1 Pro')
    expect(notice).toContain('15:13 20 thg 9')
    expect(notice).toContain('chuyển sang AI khác')
  })

  it('still explains the quota when the entry carries no reset time', () => {
    const notice = quotaNoticeForLockedModel('3.8 Flash')

    expect(notice).toContain('3.8 Flash')
    expect(notice).toContain('hết hạn mức')
  })
})
