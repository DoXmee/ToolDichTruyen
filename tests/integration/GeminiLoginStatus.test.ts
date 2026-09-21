import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext } from 'playwright-core'
import { ChatGptWebAdapter } from '../../src/main/chatgpt/ChatGptWebAdapter'
import { VolatileConversationStateStore } from '../../src/main/chatgpt/conversationState'
import { ownershipMarkerHash } from '../../src/main/chatgpt/ownershipMarker'
import { GEMINI_SELECTORS } from '../../src/main/chatgpt/selectors'
import { ensureProModel, GeminiQuotaExceededError } from '../../src/main/chatgpt/geminiModel'

/**
 * Minimal page/context double. `refreshStatus` only needs `url`, `isClosed`,
 * `locator().count()`, `locator().nth().isVisible()` plus the lifecycle hooks
 * `openLogin` installs, so no real browser is involved.
 */
function fakeGeminiBrowser(visibleSelectors: readonly string[], url = 'https://gemini.google.com/app') {
  const visible = new Set(visibleSelectors)
  const locator = (selector: string) => {
    const matches = visible.has(selector) ? 1 : 0
    return {
      count: async () => matches,
      nth: () => ({ isVisible: async () => matches > 0 }),
    }
  }
  const page = {
    isClosed: () => false,
    url: () => url,
    on: vi.fn(),
    goto: vi.fn(async () => undefined),
    bringToFront: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => locator(selector)),
  }
  const context = {
    pages: () => [page],
    newPage: async () => page,
    on: vi.fn(),
  }
  return { context, page }
}

function adapterFor(visibleSelectors: readonly string[]) {
  const { context, page } = fakeGeminiBrowser(visibleSelectors)
  const adapter = new ChatGptWebAdapter({
    provider: 'gemini',
    profileDirectory: 'C:\\tmp\\gemini-browser-profile',
    baseUrl: 'https://gemini.google.com/app',
    conversationStateStore: false,
    // Keep the manual-login fallback out of the picture: this test is about
    // the authenticated DOM check the adapter performs itself.
    manualLoginFactory: false,
    browserFactory: async () => context as unknown as BrowserContext,
  })
  return { adapter, page }
}

const VERIFIED_COMPOSER = 'div[contenteditable="true"][role="textbox"]'

describe('Gemini login detection', () => {
  it('reports ready when the account chip proves a signed-in Google session', async () => {
    const { adapter } = adapterFor([VERIFIED_COMPOSER, 'a[href*="SignOutOptions"]'])

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
  })

  it('still reports login-required on the signed-out Gemini page', async () => {
    const { adapter } = adapterFor([VERIFIED_COMPOSER, 'button:has-text("Sign in")'])

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'login-required' })
  })

  it('never treats a bare accounts.google.com anchor as a signed-in session', () => {
    // The signed-out page carries a hidden accounts.google.com ServiceLogin
    // anchor while the signed-in page carries an account chip on the same host.
    // Matching that host is why a signed-in Gemini session used to bounce back
    // to "Chờ đăng nhập", so it must stay out of the login selector list.
    expect(GEMINI_SELECTORS.loginLink.some((selector) => (
      selector.includes('accounts.google.com') && !selector.includes('ServiceLogin')
    ))).toBe(false)
    expect(GEMINI_SELECTORS.loginLink).toContain('a[href*="ServiceLogin"]')
    expect(GEMINI_SELECTORS.signedInMarkers ?? []).toContain('a[href*="SignOutOptions"]')
  })

  it('keeps the live-verified Gemini composer selector first', () => {
    expect(GEMINI_SELECTORS.composer[0]).toBe(VERIFIED_COMPOSER)
    expect(GEMINI_SELECTORS.composer).toContain('rich-textarea .ql-editor[contenteditable="true"]')
  })
})

/**
 * Every assertion below comes from a live run against gemini.google.com. They
 * exist so a future edit cannot quietly reintroduce the interface text that the
 * tool used to read as the model answer.
 */
describe('Gemini response capture', () => {
  it('reads the answer from message-content and never from the label announcer', () => {
    // `<div aria-live="polite" class="model-response-label-announcer">` always
    // exists, even in a brand-new chat, and its text is "Gemini đã nói".
    expect(GEMINI_SELECTORS.assistantMessages).not.toContain('div[aria-live="polite"]')
    expect(GEMINI_SELECTORS.assistantMessages[0]).toBe('message-content')
    // `.response-container` and <model-response> wrap that same label.
    expect(GEMINI_SELECTORS.assistantMessages).not.toContain('.response-container')
  })

  it('marks the prompt with the live-verified user turn element', () => {
    expect(GEMINI_SELECTORS.toolConversationUserMessages[0]).toBe('user-query')
  })

  it('waits for the aria-busy answer body instead of guessing from stable text', () => {
    expect(GEMINI_SELECTORS.streamingIndicators ?? []).toContain('message-content .markdown[aria-busy]')
  })

  it('recognises the localised controls of a Vietnamese Google interface', () => {
    // This account runs Gemini in Vietnamese, so the English labels alone would
    // leave the send, stop and completion controls undetected.
    expect(GEMINI_SELECTORS.sendButton.some((selector) => selector.includes('Gửi'))).toBe(true)
    expect(GEMINI_SELECTORS.stopButton.some((selector) => selector.includes('Dừng'))).toBe(true)
    expect(GEMINI_SELECTORS.assistantTurnCompletionAction.some((selector) => selector.includes('Sao chép'))).toBe(true)
  })
})

describe('Gemini conversation ownership', () => {
  it('keeps one marker-owned chat across later sends in the same translation job', async () => {
    const store = new VolatileConversationStateStore()
    const adapter = new ChatGptWebAdapter({
      provider: 'gemini',
      profileDirectory: 'C:\\tmp\\gemini-browser-profile',
      baseUrl: 'https://gemini.google.com/app',
      conversationStateStore: store,
      manualLoginFactory: false,
    })
    const subject = adapter as unknown as {
      rememberMarkerConversation(
        page: unknown,
        expected: unknown,
        submittedOwnershipHash: string,
      ): Promise<{ id: string; ownershipHashes: string[] }>
      verifyFirstSubmittedConversation: ReturnType<typeof vi.fn>
      verifySubmittedOwnershipMarker: ReturnType<typeof vi.fn>
    }
    subject.verifyFirstSubmittedConversation = vi.fn(async () => undefined)
    subject.verifySubmittedOwnershipMarker = vi.fn(async () => undefined)
    const firstHash = ownershipMarkerHash('TDTOWN_11111111111111111111111111111111')
    const secondHash = ownershipMarkerHash('TDTOWN_22222222222222222222222222222222')

    const first = await subject.rememberMarkerConversation({}, undefined, firstHash)
    const second = await subject.rememberMarkerConversation({}, first, secondHash)

    expect(second.id).toBe(first.id)
    expect(second.ownershipHashes).toEqual([firstHash, secondHash])
    expect(await store.load()).toMatchObject({ id: first.id, ownershipHashes: [firstHash, secondHash] })
  })
})

const LIVE_MODEL_MENU = [
  '3.5 Flash-Lite Câu trả lời nhanh nhất',
  '3.8 Flash Trợ giúp toàn diện',
  '3.1 Pro Suy luận nâng cao',
  'Tư duy mở rộng Giải quyết vấn đề phức tạp',
]

function modelDriver(initialChip: string, menu: string[] = LIVE_MODEL_MENU) {
  let chip = initialChip
  let menuOpen = false
  const selected: string[] = []
  let opened = 0
  let closed = 0
  return {
    selected,
    readChip: () => chip,
    openedCount: () => opened,
    closedCount: () => closed,
    driver: {
      currentLabel: async () => chip,
      openMenu: async () => { opened += 1; menuOpen = true },
      options: async () => (menuOpen
        ? menu.map((label) => ({
          label,
          select: async () => { selected.push(label); chip = label; menuOpen = false },
        }))
        : []),
      closeMenu: async () => { closed += 1; menuOpen = false },
    },
  }
}

describe('Gemini model pinning', () => {
  it('switches a Flash account to the newest Pro model', async () => {
    const fake = modelDriver('Flash')

    await expect(ensureProModel(fake.driver)).resolves.toEqual({
      changed: true,
      model: '3.1 Pro Suy luận nâng cao',
    })
    expect(fake.selected).toEqual(['3.1 Pro Suy luận nâng cao'])
    expect(fake.readChip()).toBe('3.1 Pro Suy luận nâng cao')
  })

  it('upgrades Flash-Lite to Pro as well', async () => {
    const fake = modelDriver('Flash-Lite')

    await expect(ensureProModel(fake.driver)).resolves.toEqual({
      changed: true,
      model: '3.1 Pro Suy luận nâng cao',
    })
    expect(fake.selected).toEqual(['3.1 Pro Suy luận nâng cao'])
  })

  it('leaves an account that is already on Pro untouched', async () => {
    const fake = modelDriver('Pro')

    await expect(ensureProModel(fake.driver)).resolves.toEqual({
      changed: false,
      model: 'Pro',
    })
    expect(fake.openedCount()).toBe(0)
    expect(fake.selected).toEqual([])
  })

  it('reports an error when the account offers no Pro model at all', async () => {
    const fake = modelDriver('Flash', ['3.8 Flash', '3.5 Flash-Lite', 'Tư duy mở rộng'])

    await expect(ensureProModel(fake.driver)).rejects.toThrow(/không có model Pro nào/u)
    // The message must name what the picker actually offered.
    await expect(ensureProModel(fake.driver)).rejects.toThrow(/3\.8 Flash \| 3\.5 Flash-Lite/u)
    expect(fake.selected).toEqual([])
    expect(fake.closedCount()).toBe(2)
  })

  it('does not accept an unnamed thinking mode as Pro', async () => {
    const fake = modelDriver('Flash', ['Tư duy mở rộng Giải quyết vấn đề phức tạp'])

    await expect(ensureProModel(fake.driver)).rejects.toThrow(/không có model Pro nào/u)
    expect(fake.selected).toEqual([])
  })

  it('reports an error when the picker refuses to apply the Pro choice', async () => {
    const fake = modelDriver('Flash')
    fake.driver.options = async () => [{
      label: '3.1 Pro Suy luận nâng cao',
      // Selecting does nothing, which is what a broken picker looks like.
      select: async () => undefined,
    }]

    await expect(ensureProModel(fake.driver)).rejects.toThrow(/vẫn báo model hiện tại là "Flash"/u)
    // The half-applied menu must not be left covering the composer.
    expect(fake.closedCount()).toBe(1)
  })

  it('reports an unreadable menu instead of translating on an unknown model', async () => {
    const fake = modelDriver('Flash', [])

    await expect(ensureProModel(fake.driver)).rejects.toThrow(/Không đọc được danh sách model/u)
    expect(fake.closedCount()).toBe(1)
  })

  it('reports a picker that cannot be opened at all', async () => {
    const fake = modelDriver('Flash')
    fake.driver.openMenu = async () => { throw new Error('nút chọn model biến mất') }

    await expect(ensureProModel(fake.driver)).rejects.toThrow(/Không mở được bảng chọn model/u)
  })

  it('explains a quota-locked Pro model instead of hanging on the click', async () => {
    // Captured live: Gemini keeps the entry visible, marks it aria-disabled and
    // writes the reset time into its text when the advanced quota is used up.
    const fake = modelDriver('Flash-Lite', [
      '3.5 Flash-Lite Câu trả lời nhanh nhất',
      '3.1 Pro Hạn mức sẽ được đặt lại vào15:13 20 thg 9',
    ])
    fake.driver.options = async () => [
      { label: '3.5 Flash-Lite Câu trả lời nhanh nhất', disabled: false, select: async () => undefined },
      { label: '3.1 Pro Hạn mức sẽ được đặt lại vào15:13 20 thg 9', disabled: true, select: async () => undefined },
    ]

    // The thrown error is typed so the runner can pause the job and show the
    // reset time instead of reporting a browser click failure.
    const thrown = await ensureProModel(fake.driver).catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(GeminiQuotaExceededError)
    expect((thrown as Error).message).toMatch(/hết hạn mức/u)
    expect((thrown as Error).message).toMatch(/15:13/u)
    expect(fake.closedCount()).toBe(1)
    expect(fake.selected).toEqual([])
  })
})
