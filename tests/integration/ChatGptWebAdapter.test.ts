import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserContext } from 'playwright-core'
import {
  ChatGptAutomationShutdownError,
  ChatGptFreshChatRecoveryError,
  ChatGptGenerationStopError,
  ChatGptWebAdapter,
} from '../../src/main/chatgpt/ChatGptWebAdapter'
import {
  FileConversationStateStore,
  VolatileConversationStateStore,
} from '../../src/main/chatgpt/conversationState'

interface FakePageOptions {
  composer?: boolean;
  login?: boolean;
  loggedOutComposer?: boolean;
  composerClickThrows?: boolean;
  sendClickThrows?: boolean;
  loginAfterSend?: boolean;
  assistantAfterSend?: boolean;
  assistantCountThrows?: boolean;
  initialAssistantCount?: number;
  assistantCountAfterSend?: number;
  initialAssistantTurnOrdinal?: number;
  latestAssistantTurnOrdinalAfterSend?: number;
  assistantTurnOrdinalUnavailable?: boolean;
  initialAssistantVirtualItemKey?: string;
  latestAssistantVirtualItemKeyAfterSend?: string;
  response?: string;
  responseFactory?: () => string;
  stopButtonAfterSend?: boolean;
  stopButtonVisibilitiesAfterSend?: boolean[];
  initialStopButtonVisibilities?: boolean[];
  stopButtonClickThrows?: boolean;
  stopButtonClickRemoves?: boolean;
  contextCloseThrows?: boolean;
  contextCloseLeavesPageOpen?: boolean;
  latestAssistantCopyPresent?: boolean;
  latestAssistantCopyVisible?: boolean;
  globalAssistantCopyCount?: number;
  initialUrl?: string;
  conversationUrlAfterSend?: string | false;
  deleteMenuAvailable?: boolean;
  deleteActionAvailable?: boolean;
  deleteConfirmAvailable?: boolean;
  deleteMenuClickFailures?: number;
  deleteConfirmClickFailures?: number;
  deleteRedirects?: boolean;
  redirectConversationGotoToRoot?: boolean;
  rootGotoRedirectTo?: string;
  rootGotoCausesLogin?: boolean;
  sidebarPersonalConversationMenu?: boolean;
  userMessages?: string[];
  navigateOnSendClickTo?: string;
  navigateBeforeAtomicSendClickTo?: string;
  navigateBeforeAtomicDeleteStage?: 'menu' | 'delete' | 'confirm';
  atomicNavigationUrl?: string;
  deleteRedirectUrl?: string;
  renderUserMessage?: (message: string) => string;
  kimiUsageLimit?: boolean;
  kimiIdentityCandidates?: string[];
  chatGptIdentityCandidates?: string[];
  deepSeekIdentityCandidates?: string[];
}

const STORED_TOOL_MARKER = 'TDTOWN_0123456789abcdef0123456789abcdef'
const STORED_TOOL_MESSAGE = `Prompt do tool đã gửi. Metadata: ${STORED_TOOL_MARKER}`

function ownershipHash(value: string): string {
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
}

function createFakeBrowser(options: FakePageOptions = {}) {
  let sent = false
  let sendCount = 0
  let lastFilledMessage = ''
  const userMessages = [...(options.userMessages ?? [])]
  let fillCount = 0
  let enterCount = 0
  let closed = false
  let gotoCount = 0
  let menuOpen = false
  let deleteDialogOpen = false
  let deleteMenuClickCount = 0
  let personalMenuClickCount = 0
  let deleteActionClickCount = 0
  let deleteConfirmClickCount = 0
  let stopClickCount = 0
  const sentUrls: string[] = []
  const sendDestinationUrls: string[] = []
  const deletedUrls: string[] = []
  let currentUrl = options.initialUrl
    ?? (options.login ? 'https://chatgpt.com/auth/login' : 'https://chatgpt.com/')
  const statusListeners: Array<() => void> = []
  const markSent = () => {
    sent = true
    sendCount += 1
    sendDestinationUrls.push(currentUrl)
    if (options.conversationUrlAfterSend !== false) {
      currentUrl = options.conversationUrlAfterSend
        ?? 'https://chatgpt.com/c/tool-created-conversation-0001'
    }
    sentUrls.push(currentUrl)
    if (lastFilledMessage) {
      userMessages.push(options.renderUserMessage?.(lastFilledMessage) ?? lastFilledMessage)
    }
  }

  type LocatorScope = 'page' | 'latest-assistant-turn'
  const locatorFor = (selector: string, elementIndex = 0, scope: LocatorScope = 'page') => {
    const isComposer = selector.includes('prompt-textarea') || selector.includes('contenteditable')
    const isSend = !selector.includes('stop-icon')
      && !selector.includes('send-button-container.stop')
      && !selector.includes('task-bar-stop')
      && (selector.includes('send-button') || selector.includes('Send') || selector.includes('Gửi'))
    const isCompletionAction = selector.includes('copy-turn-action-button')
    const isVirtualItemContainer = selector.includes('@data-virtual-list-item-key')
      && !selector.includes('following-sibling')
    const isDeepSeekPairedAssistant = selector.includes('following-sibling')
      && selector.includes('ds-assistant-message-main-content')
    const isAssistantTurnContainer = selector.includes('ancestor-or-self')
      && !isVirtualItemContainer
      && !isDeepSeekPairedAssistant
    const isAssistant = !isCompletionAction
      && !isAssistantTurnContainer
      && !isVirtualItemContainer
      && (
        selector.includes('message-author-role="assistant"')
        || selector.includes('data-role="assistant"')
        || selector.includes('chat-content-item-assistant')
        || selector.includes('assistant-content')
        || selector.includes('segment-assistant')
        || selector.includes('chat-message.assistant')
        || selector.includes('ds-assistant-message-main-content')
        || selector.includes('ds-markdown')
        || isDeepSeekPairedAssistant
      )
    const isStop = selector.includes('stop-button')
      || selector.includes('stop-icon')
      || selector.includes('send-button-container.stop')
      || selector.includes('task-bar-stop')
      || selector.includes('aria-label="Stop"')
      || selector.includes('Stop streaming')
      || selector.includes('Stop generating')
    const isUserMessage = selector.includes('message-author-role="user"')
      || selector.includes('data-role="user"')
      || selector.includes('chat-content-item-user')
      || selector.includes('user-content')
      || selector.includes('segment-user')
      || selector.includes('chat-message.user')
      || selector.includes('ds-collapsible-text')
    const isLogin = selector.includes('auth/login') || selector.includes('Log in') || selector.includes('Đăng nhập')
    const isProfileButton = selector.includes('accounts-profile-button')
      || selector.includes('profile-button')
      || selector.includes('profile')
      || selector.includes('hồ sơ')
      || selector.includes('account')
      || selector.includes('tài khoản')
      || selector.includes('avatar')
      || selector.includes('user')
    const isKimiUsageLimit = selector.includes('free quota')
      || selector.includes('quota.*refreshes')
      || selector.includes('免费')
      || selector.includes('额度')
    const isConversationMenu = selector.includes('conversation-options') || selector.includes('tùy chọn cuộc trò chuyện') || selector.includes('Tùy chọn cuộc trò chuyện')
    const isMainScopedMenu = selector.startsWith('main ')
      || selector.startsWith('[role="main"] ')
      || selector.includes('thread-header-right-actions')
    const isDeleteAction = selector.includes('role="menuitem"')
    const isDeleteConfirm = selector.includes('delete-conversation-confirm') || selector.includes('role="dialog"')
    const assistantMessageCount = () => sendCount > 0
      ? options.assistantCountAfterSend ?? sendCount
      : options.initialAssistantCount ?? 0
    const latestAssistantTurnOrdinal = () => sendCount > 0
      ? options.latestAssistantTurnOrdinalAfterSend ?? sendCount * 2
      : options.initialAssistantTurnOrdinal ?? 0
    const latestAssistantVirtualItemKey = () => sendCount > 0
      ? options.latestAssistantVirtualItemKeyAfterSend ?? String(sendCount * 2)
      : options.initialAssistantVirtualItemKey ?? '0'
    const stopButtonVisibilities = () => {
      if (sendCount === 0) return options.initialStopButtonVisibilities ?? []
      return options.stopButtonVisibilitiesAfterSend
        ?? (options.stopButtonAfterSend === true ? [true] : [])
    }
    const completionActionCount = () => {
      if (sendCount === 0) return 0
      if (scope === 'latest-assistant-turn') return options.latestAssistantCopyPresent === true ? 1 : 0
      return options.globalAssistantCopyCount
        ?? (options.latestAssistantCopyPresent === true ? 1 : 0)
    }
    const exists = () =>
      (isComposer && options.composer !== false && (!options.login || options.loggedOutComposer)) ||
      (isSend && options.composer !== false && !options.login) ||
      (isAssistant && assistantMessageCount() > 0 && options.assistantAfterSend !== false) ||
      (isAssistantTurnContainer && assistantMessageCount() > 0 && options.assistantAfterSend !== false) ||
      (isVirtualItemContainer && assistantMessageCount() > 0 && options.assistantAfterSend !== false) ||
      (isStop && stopButtonVisibilities().length > 0) ||
      (isCompletionAction && completionActionCount() > 0) ||
      (isUserMessage && userMessages.length > 0) ||
      (isKimiUsageLimit && options.kimiUsageLimit === true) ||
      (isLogin && Boolean(options.login)) ||
      (isProfileButton && Boolean(options.chatGptIdentityCandidates?.length || options.kimiIdentityCandidates?.length || options.deepSeekIdentityCandidates?.length)) ||
      (isConversationMenu && currentUrl.includes('/c/') && options.deleteMenuAvailable !== false) ||
      (isDeleteAction && menuOpen && options.deleteActionAvailable !== false) ||
      (isDeleteConfirm && deleteDialogOpen && options.deleteConfirmAvailable !== false)
    const countElements = () => {
      if (isCompletionAction) return completionActionCount()
      if (isAssistant) return exists() ? assistantMessageCount() : 0
      if (isStop) return stopButtonVisibilities().length
      if (isUserMessage) return userMessages.length
      if (isConversationMenu) {
        const currentMenu = currentUrl.includes('/c/') && options.deleteMenuAvailable !== false ? 1 : 0
        const sidebarMenu = options.sidebarPersonalConversationMenu && !isMainScopedMenu ? 1 : 0
        return currentMenu + sidebarMenu
      }
      if (isProfileButton) return exists() ? 1 : 0
      return exists() ? 1 : 0
    }
    const performClick = async () => {
      if (isComposer && options.composerClickThrows) throw new Error('overlay intercepted composer click')
      if (isStop) {
        stopClickCount += 1
        if (options.stopButtonClickThrows) throw new Error('stop click failed')
        if (options.stopButtonClickRemoves) {
          options.initialStopButtonVisibilities = []
          options.stopButtonVisibilitiesAfterSend = []
          options.stopButtonAfterSend = false
        }
      }
      if (isSend && options.navigateOnSendClickTo) currentUrl = options.navigateOnSendClickTo
      if (isSend && options.sendClickThrows) throw new Error('overlay intercepted send click')
      if (isSend) markSent()
      if (isConversationMenu) {
        if (options.sidebarPersonalConversationMenu && !isMainScopedMenu && elementIndex === 0) {
          personalMenuClickCount += 1
        } else {
          if ((options.deleteMenuClickFailures ?? 0) > 0) {
            options.deleteMenuClickFailures = (options.deleteMenuClickFailures ?? 0) - 1
            throw new Error('conversation menu click failed')
          }
          deleteMenuClickCount += 1
          menuOpen = true
        }
      }
      if (isDeleteAction) {
        deleteActionClickCount += 1
        menuOpen = false
        deleteDialogOpen = true
      }
      if (isDeleteConfirm) {
        deleteConfirmClickCount += 1
        if ((options.deleteConfirmClickFailures ?? 0) > 0) {
          options.deleteConfirmClickFailures = (options.deleteConfirmClickFailures ?? 0) - 1
          throw new Error('delete confirmation click failed')
        }
        deletedUrls.push(currentUrl)
        deleteDialogOpen = false
        if (options.deleteRedirects !== false) {
          currentUrl = options.deleteRedirectUrl ?? 'https://chatgpt.com/'
        }
      }
    }
    const locator = {
      first: () => locatorFor(selector, 0, scope),
      last: () => locatorFor(selector, Math.max(0, countElements() - 1), scope),
      nth: (index: number) => locatorFor(selector, index, scope),
      locator: (nestedSelector: string) => locatorFor(
        nestedSelector,
        0,
        nestedSelector.includes('ancestor-or-self') ? 'latest-assistant-turn' : scope,
      ),
      count: async () => {
        if (isAssistant && options.assistantCountThrows) throw new Error('assistant DOM unavailable')
        return countElements()
      },
      getAttribute: async (name: string) => {
        if (isAssistantTurnContainer && name === 'data-testid' && exists()) {
          if (options.assistantTurnOrdinalUnavailable) return null
          return `conversation-turn-${latestAssistantTurnOrdinal()}`
        }
        if (isVirtualItemContainer && name === 'data-virtual-list-item-key' && exists()) {
          return latestAssistantVirtualItemKey()
        }
        return null
      },
      isVisible: async () => {
        if (isStop) return stopButtonVisibilities()[elementIndex] ?? false
        if (isCompletionAction && scope === 'latest-assistant-turn') {
          return elementIndex < countElements() && options.latestAssistantCopyVisible !== false
        }
        return elementIndex < countElements()
      },
      isEnabled: async () => elementIndex < countElements(),
      click: performClick,
      evaluate: async (_callback: unknown, target: { origin: string; pathname: string }) => {
        if (isSend && options.navigateBeforeAtomicSendClickTo) {
          currentUrl = options.navigateBeforeAtomicSendClickTo
        }
        const stage = isConversationMenu ? 'menu' : isDeleteAction ? 'delete' : isDeleteConfirm ? 'confirm' : undefined
        if (stage && options.navigateBeforeAtomicDeleteStage === stage) {
          currentUrl = options.atomicNavigationUrl ?? 'https://chatgpt.com/c/personal-race-target-0001'
        }
        const current = new URL(currentUrl)
        const normalize = (value: string) => value.replace(/\/+$/u, '') || '/'
        if (current.origin !== target.origin || normalize(current.pathname) !== normalize(target.pathname)) {
          throw new Error('SAFETY_URL_MISMATCH')
        }
        await performClick()
      },
      fill: async (_value: string) => {
        fillCount += 1
        lastFilledMessage = _value
      },
      press: async (_key: string) => {
        if (isComposer) {
          enterCount += 1
          markSent()
        }
      },
      innerText: async () => {
        if (isUserMessage) return userMessages[elementIndex] ?? ''
        if (!isAssistant) return ''
        if (options.loginAfterSend) {
          options.login = true
          currentUrl = 'https://chatgpt.com/auth/login'
        }
        return options.responseFactory?.() ?? options.response ?? 'Bản dịch hoàn chỉnh.'
      },
    }
    return locator
  }

  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      gotoCount += 1
      const navigatingToRoot = new URL(url).pathname === '/'
      currentUrl = options.redirectConversationGotoToRoot && url.includes('/c/')
        ? 'https://chatgpt.com/'
        : navigatingToRoot && options.rootGotoRedirectTo
          ? options.rootGotoRedirectTo
          : url
      if (new URL(currentUrl).pathname === '/') {
        userMessages.splice(0)
        sendCount = 0
      }
      options.login = navigatingToRoot && options.rootGotoCausesLogin === true
    },
    bringToFront: async () => undefined,
    locator: (selector: string) => locatorFor(selector),
    evaluate: async () => {
      if (options.chatGptIdentityCandidates) return options.chatGptIdentityCandidates
      if (options.kimiIdentityCandidates) return options.kimiIdentityCandidates
      if (options.deepSeekIdentityCandidates) return options.deepSeekIdentityCandidates
      throw new Error('page.evaluate unavailable in fake page')
    },
    isClosed: () => closed,
    on: (_event: string, listener: () => void) => statusListeners.push(listener),
    keyboard: {
      press: async (_key: string) => undefined,
      insertText: async (_value: string) => {
        lastFilledMessage = _value
      },
    },
  }
  const context = {
    pages: () => [page],
    newPage: async () => page,
    on: (_event: string, listener: () => void) => statusListeners.push(listener),
    close: async () => {
      if (options.contextCloseThrows) throw new Error('context close failed')
      if (!options.contextCloseLeavesPageOpen) closed = true
      statusListeners.forEach((listener) => listener())
    },
  }
  return {
    context: context as unknown as BrowserContext,
    page,
    get sent() { return sent },
    get lastFilledMessage() { return lastFilledMessage },
    get fillCount() { return fillCount },
    get enterCount() { return enterCount },
    get gotoCount() { return gotoCount },
    get currentUrl() { return currentUrl },
    get deleteMenuClickCount() { return deleteMenuClickCount },
    get personalMenuClickCount() { return personalMenuClickCount },
    get deleteActionClickCount() { return deleteActionClickCount },
    get deleteConfirmClickCount() { return deleteConfirmClickCount },
    get stopClickCount() { return stopClickCount },
    get sentUrls() { return [...sentUrls] },
    get sendDestinationUrls() { return [...sendDestinationUrls] },
    get deletedUrls() { return [...deletedUrls] },
    clearUserMessages: () => userMessages.splice(0),
  }
}

const temporaryDirectories: string[] = []

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'tool-chat-state-test-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'chatgpt-tool-conversation.json')
}

async function waitForFileCondition(
  statePath: string,
  condition: (state: { version: number; conversation: unknown }) => boolean,
): Promise<{ version: number; conversation: unknown }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const state = JSON.parse(await readFile(statePath, 'utf8'))
      if (condition(state)) return state
    } catch {
      // The adapter may still be completing its atomic temp-file rename.
    }
    // Fake timers do not yield to libuv filesystem completions. Explicitly
    // advance only the 0-ms queue so the atomic write/rename can settle even
    // when the complete coverage suite is running concurrently.
    await vi.advanceTimersByTimeAsync(0)
  }
  throw new Error('Timed out waiting for conversation state fixture.')
}

async function waitForRuntimeCondition(
  condition: () => boolean,
  yieldPath: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    // A real filesystem completion yields to promises that run between the
    // fake browser action and the adapter's fake-timer polling loop.
    await readFile(yieldPath).catch(() => undefined)
  }
  throw new Error('Timed out waiting for fake browser action.')
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('ChatGptWebAdapter', () => {
  it('đọc tên email và gói ChatGPT từ menu hồ sơ', async () => {
    const fake = createFakeBrowser({
      composer: true,
      chatGptIdentityCandidates: [
        'Mở menu hồ sơ',
        'Nguyễn Văn A\nnguyenvana@example.com\nPlus\nSettings\nLog out',
      ],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(adapter.readAccountIdentity()).resolves.toEqual({
      label: 'Nguyễn Văn A',
      email: 'nguyenvana@example.com',
      plan: 'plus',
    })
    await adapter.close()
  })

  it('đọc tên tài khoản DeepSeek từ giao diện profile mặc định', async () => {
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://chat.deepseek.com/',
      deepSeekIdentityCandidates: [
        'DeepSeek',
        'Thành Đông\nSettings\nLog out',
      ],
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(adapter.readAccountIdentity()).resolves.toEqual({ label: 'Thành Đông' })
    await adapter.close()
  })

  it('đọc tên tài khoản Kimi từ khu vực profile', async () => {
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://www.kimi.com/',
      kimiIdentityCandidates: [
        'New chat\nCtrl K\nMy Kimi\nPlugins\nLog in',
        'Kimi\nThành Đông\nSettings\nLog out',
      ],
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'kimi',
      profileDirectory: 'fake-kimi-profile',
      baseUrl: 'https://www.kimi.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(adapter.readAccountIdentity()).resolves.toEqual({ label: 'Thành Đông' })
    await adapter.close()
  })

  it('bỏ qua key storage nội bộ khi đọc tên tài khoản DeepSeek', async () => {
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://chat.deepseek.com/',
      deepSeekIdentityCandidates: [
        '__appKit_@ /chat_ca50e4ac-e7cc-4e7b-a083-2c780a3b3793_ Storage',
        '{"user":{"name":"Thành Đông"}}',
        'DeepSeek\nThành Đông\nSettings\nLog out',
      ],
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(adapter.readAccountIdentity()).resolves.toEqual({ label: 'Thành Đông' })
    await adapter.close()
  })

  it('mở đăng nhập thủ công trực tiếp khi thêm tài khoản, không bật browser automation trước', async () => {
    const browserFactory = vi.fn(async () => createFakeBrowser({ composer: false, login: true }).context)
    const manualLoginFactory = vi.fn(async () => ({
      closed: new Promise<void>(() => undefined),
      isRunning: () => true,
      close: async () => undefined,
    }))
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
      manualLoginFactory,
    })

    await expect(adapter.openManualLogin()).resolves.toMatchObject({
      status: 'login-required',
      message: expect.stringContaining('Đăng nhập ChatGPT'),
    })
    expect(browserFactory).not.toHaveBeenCalled()
    expect(manualLoginFactory).toHaveBeenCalledOnce()
    await adapter.close()
  })

  it('đọc account sau khi đóng cửa sổ login bằng browser ẩn rồi đóng ngay', async () => {
    const fake = createFakeBrowser({
      composer: true,
      chatGptIdentityCandidates: [
        'Nguyễn Văn A\nnguyenvana@example.com\nPlus',
      ],
    })
    const browserFactory = vi.fn(async () => fake.context)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
    })

    await expect(adapter.readAccountAfterManualLogin()).resolves.toEqual({
      label: 'Nguyễn Văn A',
      email: 'nguyenvana@example.com',
      plan: 'plus',
    })
    expect(browserFactory).toHaveBeenCalledWith(expect.objectContaining({
      profileDirectory: 'fake-profile',
      headless: true,
    }))
    expect(fake.page.isClosed()).toBe(true)
    await adapter.close()
  })

  it('điền composer, gửi và chỉ nhận assistant message mới khi nội dung ổn định', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({ composer: true, response: 'Cô khẽ gật đầu rồi bước ra ngoài.' })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)

    await expect(responsePromise).resolves.toBe('Cô khẽ gật đầu rồi bước ra ngoài.')
    expect(fake.sent).toBe(true)
    expect(adapter.status().status).toBe('ready')
  })

  it('xác minh chat mới bằng marker dù Markdown làm thay đổi innerText của full prompt', async () => {
    vi.useFakeTimers()
    const statePath = await temporaryStatePath()
    const store = new FileConversationStateStore(statePath)
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch hoàn chỉnh.',
      renderUserMessage: (message) => message.replace(/\*\*/gu, '').replace(/\s+/gu, ' '),
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('**Dịch:**  她走了。', { timeoutMs: 10_000 })
    await waitForFileCondition(statePath, (state) => state.conversation !== null)
    await vi.advanceTimersByTimeAsync(2_500)

    await expect(responsePromise).resolves.toBe('Bản dịch hoàn chỉnh.')
    const marker = /\bTDTOWN_[a-f0-9]{32}\b/u.exec(fake.lastFilledMessage)?.[0]
    expect(marker).toBeTruthy()
    expect(fake.lastFilledMessage).toContain('Không đưa dòng metadata này')
    await expect(store.load()).resolves.toMatchObject({
      ownershipHashes: [ownershipHash(marker!)],
    })
    await adapter.close()
  }, 10_000)

  it('xác minh được prompt dài khi ChatGPT chỉ render phần xem trước trước nút Xem thêm', async () => {
    vi.useFakeTimers()
    const statePath = await temporaryStatePath()
    const store = new FileConversationStateStore(statePath)
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch hoàn chỉnh.',
      renderUserMessage: (message) => message.slice(0, 500),
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    const longPrompt = `PROMPT GỐC\\n${'Đây là nội dung dài. '.repeat(500)}`
    const responsePromise = adapter.sendAndWait(longPrompt, { timeoutMs: 10_000 })
    await waitForFileCondition(statePath, (state) => state.conversation !== null)
    await vi.advanceTimersByTimeAsync(2_500)

    await expect(responsePromise).resolves.toBe('Bản dịch hoàn chỉnh.')
    const marker = /\bTDTOWN_[a-f0-9]{32}\b/u.exec(fake.lastFilledMessage)?.[0]
    expect(marker).toBeTruthy()
    expect(fake.lastFilledMessage.indexOf(marker!)).toBeLessThan(120)
    await expect(store.load()).resolves.toMatchObject({
      ownershipHashes: [ownershipHash(marker!)],
    })
    await adapter.close()
  }, 10_000)

  it('không coi Copy ẩn trong latest turn là tín hiệu hoàn tất', async () => {
    vi.useFakeTimers()
    const browserOptions: FakePageOptions = {
      composer: true,
      response: 'Bản dịch đã hoàn tất.',
      stopButtonAfterSend: true,
      latestAssistantCopyPresent: true,
      latestAssistantCopyVisible: false,
      globalAssistantCopyCount: 1,
    }
    const fake = createFakeBrowser(browserOptions)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    let settled = false
    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
      .finally(() => { settled = true })
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(2_500)
    expect(settled).toBe(false)

    browserOptions.latestAssistantCopyVisible = true
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(responsePromise).resolves.toBe('Bản dịch đã hoàn tất.')
    expect(browserOptions.globalAssistantCopyCount).toBe(1)
    expect(browserOptions.stopButtonAfterSend).toBe(true)
    await adapter.close()
  })

  it('không chốt response khi Stop đầu tiên ẩn nhưng Stop thứ hai vẫn hiển thị', async () => {
    vi.useFakeTimers()
    const browserOptions: FakePageOptions = {
      composer: true,
      response: 'Bản dịch tạm thời đang ổn định.',
      stopButtonVisibilitiesAfterSend: [false, true],
      latestAssistantCopyPresent: false,
    }
    const fake = createFakeBrowser(browserOptions)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    let settled = false
    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
      .finally(() => { settled = true })
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    expect(await fake.page.locator('button[data-testid="stop-button"]').count()).toBe(2)
    await vi.advanceTimersByTimeAsync(2_500)
    expect(settled).toBe(false)

    browserOptions.stopButtonVisibilitiesAfterSend = []
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(responsePromise).resolves.toBe('Bản dịch tạm thời đang ổn định.')
    await adapter.close()
  })

  it('bỏ qua Copy cũ xuất hiện trễ và xử lý latest turn khi virtualization giữ global count không đổi', async () => {
    vi.useFakeTimers()
    const browserOptions: FakePageOptions = {
      composer: true,
      response: 'Bản dịch đang',
      initialAssistantCount: 1,
      assistantCountAfterSend: 1,
      initialAssistantTurnOrdinal: 2,
      latestAssistantTurnOrdinalAfterSend: 4,
      stopButtonAfterSend: true,
      latestAssistantCopyPresent: false,
      globalAssistantCopyCount: 0,
    }
    const fake = createFakeBrowser(browserOptions)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    let settled = false
    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 20_000 })
      .finally(() => { settled = true })
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(settled).toBe(false)

    // An old turn exposes Copy late. It is visible globally but does not
    // belong to responseLocator, so the paused streaming text must stay open.
    browserOptions.globalAssistantCopyCount = 1
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await fake.page.locator('[data-testid="copy-turn-action-button"]').count()).toBe(1)
    expect(settled).toBe(false)

    // Streaming resumes after the pause; stableChecks must reset.
    browserOptions.response = 'Bản dịch đang tiếp tục'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settled).toBe(false)

    // The old action is virtualized away exactly when latest Copy appears, so
    // the global count remains one. Scoping to latest turn still completes.
    browserOptions.response = 'Bản dịch đã hoàn tất.'
    browserOptions.latestAssistantCopyPresent = true
    browserOptions.latestAssistantCopyVisible = true
    await vi.advanceTimersByTimeAsync(2_500)
    expect(await fake.page.locator('[data-testid="copy-turn-action-button"]').count()).toBe(1)
    await expect(responsePromise).resolves.toBe('Bản dịch đã hoàn tất.')
    expect(browserOptions.stopButtonAfterSend).toBe(true)
    await adapter.close()
  })

  it('vẫn fill composer và fallback Enter khi overlay chặn các click', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      composerClickThrows: true,
      sendClickThrows: true,
      response: 'Bản dịch hoàn chỉnh.',
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)

    await expect(responsePromise).resolves.toBe('Bản dịch hoàn chỉnh.')
    expect(fake.fillCount).toBe(1)
    expect(fake.enterCount).toBe(1)
    expect(fake.sent).toBe(true)
    await adapter.close()
  })

  it('không gửi khi tác vụ đã bị hủy trước ensureReady', async () => {
    const fake = createFakeBrowser({ composer: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()
    const controller = new AbortController()
    controller.abort(new DOMException('Đã hủy tác vụ.', 'AbortError'))

    await expect(adapter.sendAndWait('Không được gửi.', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.fillCount).toBe(0)
    expect(fake.sent).toBe(false)
    await adapter.close()
  })

  it('không gửi khi bị hủy trong lúc ensureReady đang mở trình duyệt', async () => {
    const fake = createFakeBrowser({ composer: true })
    let releaseBrowser!: (context: BrowserContext) => void
    const browserPending = new Promise<BrowserContext>((resolve) => {
      releaseBrowser = resolve
    })
    const browserFactory = vi.fn(() => browserPending)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
    })
    const controller = new AbortController()
    const responsePromise = adapter.sendAndWait('Không được gửi.', { signal: controller.signal })
    const rejection = expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(browserFactory).toHaveBeenCalledTimes(1))

    controller.abort(new DOMException('Đã hủy tác vụ.', 'AbortError'))
    releaseBrowser(fake.context)

    await rejection
    expect(fake.fillCount).toBe(0)
    expect(fake.sent).toBe(false)
    await adapter.close()
  })

  it('kiểm tra lại trạng thái sau khi gửi thay vì luôn báo ready', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      loginAfterSend: true,
      response: 'Bản dịch hoàn chỉnh.',
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)

    await expect(responsePromise).resolves.toBe('Bản dịch hoàn chỉnh.')
    expect(adapter.status().status).toBe('login-required')
    await adapter.close()
  })

  it('dừng generation trước khi rethrow lỗi xảy ra sau lúc gửi', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({ composer: true, assistantAfterSend: false })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()
    const cancelGeneration = vi.spyOn(adapter, 'cancelGeneration')

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    const rejection = expect(responsePromise).rejects.toThrow(/10 giây/u)
    await vi.advanceTimersByTimeAsync(10_500)

    await rejection
    expect(fake.sent).toBe(true)
    expect(cancelGeneration).toHaveBeenCalledTimes(1)
    await adapter.close()
  })

  it('cancelGeneration coi việc không có Stop ban đầu là response đã settled', async () => {
    const fake = createFakeBrowser({ composer: true, initialStopButtonVisibilities: [] })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    await expect(adapter.cancelGeneration()).resolves.toBeUndefined()
    expect(fake.stopClickCount).toBe(0)
    await adapter.close()
  })

  it('cancelGeneration propagate lỗi click khi Stop đang hiển thị', async () => {
    const fake = createFakeBrowser({
      composer: true,
      initialStopButtonVisibilities: [true],
      stopButtonClickThrows: true,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    await expect(adapter.cancelGeneration()).rejects.toThrow(/không bấm được nút dừng/iu)
    expect(fake.stopClickCount).toBe(1)
    await adapter.close()
  })

  it('cancelGeneration chỉ thành công sau khi click làm Stop biến mất', async () => {
    const fake = createFakeBrowser({
      composer: true,
      initialStopButtonVisibilities: [true],
      stopButtonClickRemoves: true,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    await expect(adapter.cancelGeneration()).resolves.toBeUndefined()
    expect(fake.stopClickCount).toBe(1)
    expect(await fake.page.locator('button[data-testid="stop-button"]').count()).toBe(0)
    await adapter.close()
  })

  it('cancelGeneration báo lỗi nếu click không làm Stop biến mất', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      initialStopButtonVisibilities: [true],
      stopButtonClickRemoves: false,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    const cancellation = adapter.cancelGeneration()
    const rejection = expect(cancellation).rejects.toThrow(/vẫn hiển thị nút dừng/iu)
    await vi.waitFor(() => expect(fake.stopClickCount).toBe(1))
    await vi.advanceTimersByTimeAsync(3_500)
    await rejection
    await adapter.close()
  })

  it('đóng riêng context tự động và trả lỗi có thể khôi phục chat mới khi click Stop thất bại', async () => {
    vi.useFakeTimers()
    const store = new VolatileConversationStateStore()
    const fake = createFakeBrowser({
      composer: true,
      assistantAfterSend: false,
      stopButtonAfterSend: true,
      stopButtonClickThrows: true,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    const rejection = expect(responsePromise).rejects.toBeInstanceOf(ChatGptFreshChatRecoveryError)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(10_500)
    await rejection

    await expect(responsePromise).rejects.toMatchObject({ safeForFreshChatRecovery: true })
    expect(fake.stopClickCount).toBe(1)
    expect(fake.page.isClosed()).toBe(true)
    expect(await store.load()).toBeUndefined()
    expect(adapter.status().status).toBe('closed')
  })

  it('đóng riêng context tự động khi Stop vẫn còn sau click để cho phép chat mới', async () => {
    vi.useFakeTimers()
    const store = new VolatileConversationStateStore()
    const fake = createFakeBrowser({
      composer: true,
      assistantAfterSend: false,
      stopButtonAfterSend: true,
      stopButtonClickRemoves: false,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    const rejection = expect(responsePromise).rejects.toBeInstanceOf(ChatGptFreshChatRecoveryError)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(14_000)
    await rejection

    expect(fake.stopClickCount).toBe(1)
    expect(fake.page.isClosed()).toBe(true)
    expect(await store.load()).toBeUndefined()
  })

  it('chặn fresh-chat retry khi context Edge cũ không thể đóng thật sự', async () => {
    vi.useFakeTimers()
    const store = new VolatileConversationStateStore()
    const fake = createFakeBrowser({
      composer: true,
      assistantAfterSend: false,
      stopButtonAfterSend: true,
      stopButtonClickThrows: true,
      contextCloseThrows: true,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    const rejection = expect(responsePromise).rejects.toBeInstanceOf(ChatGptGenerationStopError)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(10_500)
    await rejection

    expect(fake.page.isClosed()).toBe(false)
    await expect(store.load()).resolves.toBeDefined()
  })

  it('strict close chỉ thành công sau khi bỏ context/tab cũ và lần mở sau tạo context mới', async () => {
    const first = createFakeBrowser({ composer: true })
    const second = createFakeBrowser({ composer: true })
    const browserFactory = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(second.context)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
    })
    await adapter.openLogin()

    await expect(adapter.close({ strict: true })).resolves.toBeUndefined()
    expect(first.page.isClosed()).toBe(true)
    expect(adapter.status().status).toBe('closed')

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    expect(browserFactory).toHaveBeenCalledTimes(2)
    await adapter.close()
  })

  it('strict close propagate context.close failure và không báo phiên đã đóng', async () => {
    const fake = createFakeBrowser({ composer: true, contextCloseThrows: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    await expect(adapter.close({ strict: true }))
      .rejects.toBeInstanceOf(ChatGptAutomationShutdownError)
    expect(fake.page.isClosed()).toBe(false)
    expect(adapter.status()).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Huliwang'),
    })

    // Normal application shutdown remains best-effort even for the same
    // unhealthy browser context.
    await expect(adapter.close()).resolves.toBeUndefined()
    expect(adapter.status().status).toBe('closed')
  })

  it('strict close rejects a context that resolves close() while its ChatGPT tab stays open', async () => {
    const fake = createFakeBrowser({ composer: true, contextCloseLeavesPageOpen: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    await expect(adapter.close({ strict: true }))
      .rejects.toBeInstanceOf(ChatGptAutomationShutdownError)
    expect(fake.page.isClosed()).toBe(false)
    expect(adapter.status().status).toBe('error')
  })

  it('giữ fail-safe và tham chiếu chat nếu lỗi sở hữu xảy ra cùng lúc Stop thất bại', async () => {
    const statePath = await temporaryStatePath()
    const store = new FileConversationStateStore(statePath)
    const storedConversation = {
      id: 'tool-chat-safety-stop-failure-0001',
      url: 'https://chatgpt.com/c/tool-chat-safety-stop-failure-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      conversationUrlAfterSend: storedConversation.url,
      userMessages: [STORED_TOOL_MESSAGE],
      renderUserMessage: () => 'Tin nhắn vừa gửi nhưng marker sở hữu không hiển thị.',
      stopButtonAfterSend: true,
      stopButtonClickThrows: true,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
      conversationUrlTimeoutMs: 500,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.')
    const rejection = expect(responsePromise).rejects.toBeInstanceOf(ChatGptGenerationStopError)
    await waitForRuntimeCondition(() => fake.sent, statePath)
    await rejection

    expect(fake.page.isClosed()).toBe(true)
    await expect(store.load()).resolves.toEqual(storedConversation)
  })

  it('không dừng generation khi lỗi xảy ra trước lúc gửi', async () => {
    const fake = createFakeBrowser({ composer: true, assistantCountThrows: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()
    const cancelGeneration = vi.spyOn(adapter, 'cancelGeneration')

    await expect(adapter.sendAndWait('Hãy dịch đoạn này.'))
      .rejects.toThrow('assistant DOM unavailable')
    expect(fake.sent).toBe(false)
    expect(cancelGeneration).not.toHaveBeenCalled()
    await adapter.close()
  })

  it('không báo đã kết nối khi trang đăng xuất có cả composer và nút đăng nhập', async () => {
    const fake = createFakeBrowser({ composer: true, login: true, loggedOutComposer: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({
      status: 'login-required',
      message: expect.stringContaining('đăng nhập'),
    })
    await adapter.close()
  })

  it('Kimi không nhận nhầm composer ẩn danh là một phiên đã đăng nhập', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      login: true,
      loggedOutComposer: true,
      initialUrl: 'https://www.kimi.ai/',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'kimi',
      profileDirectory: 'fake-kimi-profile',
      baseUrl: 'https://www.kimi.ai/',
      browserFactory: async () => fake.context,
    })

    const opening = adapter.openLogin()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(opening).resolves.toMatchObject({
      status: 'login-required',
      message: expect.stringContaining('đăng nhập'),
    })
    await adapter.close()
  })

  it('Kimi xác minh một tin nhắn qua các selector lồng nhau mà không đếm trùng', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://www.kimi.ai/',
      conversationUrlAfterSend: 'https://www.kimi.ai/chat/tool-created-kimi-0001',
      response: 'Bản dịch Kimi hoàn chỉnh.',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'kimi',
      profileDirectory: 'fake-kimi-profile',
      baseUrl: 'https://www.kimi.ai/',
      browserFactory: async () => fake.context,
    })

    const opening = adapter.openLogin()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(opening).resolves.toMatchObject({ status: 'ready' })
    const freshConversation = adapter.startNewConversation()
    await vi.advanceTimersByTimeAsync(4_000)
    await freshConversation
    const response = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 30_000 })
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(response).resolves.toBe('Bản dịch Kimi hoàn chỉnh.')
    await adapter.close()
  })

  it('Kimi báo hết hạn mức sau khoảng chờ xác nhận khi không tạo phản hồi', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      kimiUsageLimit: true,
      assistantAfterSend: false,
      assistantCountAfterSend: 0,
      initialUrl: 'https://www.kimi.ai/',
      conversationUrlAfterSend: 'https://www.kimi.ai/chat/tool-created-kimi-quota-0001',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'kimi',
      profileDirectory: 'fake-kimi-profile',
      baseUrl: 'https://www.kimi.ai/',
      browserFactory: async () => fake.context,
    })

    const opening = adapter.openLogin()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(opening).resolves.toMatchObject({ status: 'ready' })
    const response = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 480_000 })
    const rejection = expect(response).rejects.toThrow('hết hạn mức')
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(20_000)

    await rejection
    expect(fake.sent).toBe(true)
    await adapter.close()
  })

  it('Kimi vẫn nhận bản dịch đang sinh dù banner hết hạn mức đã xuất hiện', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      kimiUsageLimit: true,
      initialUrl: 'https://www.kimi.ai/',
      conversationUrlAfterSend: 'https://www.kimi.ai/chat/tool-created-kimi-last-quota-response-0001',
      response: 'Bản dịch cuối cùng Kimi vẫn trả về đầy đủ.',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'kimi',
      profileDirectory: 'fake-kimi-profile',
      baseUrl: 'https://www.kimi.ai/',
      browserFactory: async () => fake.context,
    })

    const opening = adapter.openLogin()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(opening).resolves.toMatchObject({ status: 'ready' })
    const response = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 30_000 })
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(response).resolves.toBe('Bản dịch cuối cùng Kimi vẫn trả về đầy đủ.')
    await adapter.close()
  })

  it('DeepSeek nhận diện sign_in và không coi đó là phiên sẵn sàng', async () => {
    const fake = createFakeBrowser({
      composer: true,
      login: true,
      loggedOutComposer: true,
      initialUrl: 'https://chat.deepseek.com/sign_in',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'login-required' })
    await adapter.close()
  })

  it('DeepSeek gửi, xác minh chat riêng và nhận phản hồi hoàn chỉnh', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://chat.deepseek.com/',
      conversationUrlAfterSend: 'https://chat.deepseek.com/a/chat/s/tool-created-deepseek-0001',
      response: 'Bản dịch DeepSeek hoàn chỉnh.',
      assistantTurnOrdinalUnavailable: true,
      latestAssistantVirtualItemKeyAfterSend: '4',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    const freshConversation = adapter.startNewConversation()
    await vi.advanceTimersByTimeAsync(4_000)
    await freshConversation
    const response = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 20 * 60_000 })
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(response).resolves.toBe('Bản dịch DeepSeek hoàn chỉnh.')
    await adapter.close()
  })

  it('DeepSeek nhận phản hồi mới khi danh sách ảo tái dùng cùng một khối', async () => {
    vi.useFakeTimers()
    const conversationUrl = 'https://chat.deepseek.com/a/chat/s/tool-created-deepseek-virtual-0001'
    const store = new VolatileConversationStateStore()
    await store.save({
      id: 'tool-created-deepseek-virtual-0001',
      url: conversationUrl,
      recordedAt: new Date().toISOString(),
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    })
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: conversationUrl,
      conversationUrlAfterSend: conversationUrl,
      userMessages: [STORED_TOOL_MESSAGE],
      response: 'Bản dịch DeepSeek từ khóa danh sách ảo mới.',
      assistantTurnOrdinalUnavailable: true,
      initialAssistantCount: 1,
      assistantCountAfterSend: 1,
      initialAssistantVirtualItemKey: '2',
      latestAssistantVirtualItemKeyAfterSend: '4',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    const response = adapter.sendAndWait('Hãy dịch đoạn kế tiếp.', { timeoutMs: 20 * 60_000 })
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(response).resolves.toBe('Bản dịch DeepSeek từ khóa danh sách ảo mới.')
    await adapter.close()
  })

  it('DeepSeek dừng chờ sau ba phút nếu chưa bắt đầu tạo phản hồi', async () => {
    vi.useFakeTimers()
    const fake = createFakeBrowser({
      composer: true,
      assistantAfterSend: false,
      assistantCountAfterSend: 0,
      initialUrl: 'https://chat.deepseek.com/',
      conversationUrlAfterSend: 'https://chat.deepseek.com/a/chat/s/tool-created-deepseek-timeout-0001',
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    const response = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 20 * 60_000 })
    const rejection = expect(response).rejects.toThrow(
      /không phát hiện được phản hồi mới trong 180 giây.*không gửi lại/iu,
    )
    await vi.advanceTimersByTimeAsync(185_000)
    await rejection
    await adapter.close()
  })

  it('DeepSeek gia hạn cửa sổ chờ khi nội dung vẫn đang tăng', async () => {
    vi.useFakeTimers()
    let growing = true
    let reads = 0
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://chat.deepseek.com/',
      conversationUrlAfterSend: 'https://chat.deepseek.com/a/chat/s/tool-created-deepseek-growing-0001',
      responseFactory: () => {
        if (growing) reads += 1
        return `Bản dịch DeepSeek đang tăng ${'nội dung '.repeat(reads + 1)}`
      },
    })
    const adapter = new ChatGptWebAdapter({
      provider: 'deepseek',
      profileDirectory: 'fake-deepseek-profile',
      baseUrl: 'https://chat.deepseek.com/',
      browserFactory: async () => fake.context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    const response = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 20 * 60_000 })
    await vi.advanceTimersByTimeAsync(190_000)
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    growing = false
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(response).resolves.toContain('Bản dịch DeepSeek đang tăng')
    await adapter.close()
  })

  it('báo rõ khi phiên cần đăng nhập', async () => {
    const fake = createFakeBrowser({ composer: false, login: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await expect(adapter.openLogin()).resolves.toMatchObject({
      status: 'login-required',
      message: expect.stringContaining('đăng nhập'),
    })
  })

  it('ưu tiên tab ChatGPT sẵn sàng thay vì tab auth được mở trước', async () => {
    const loginBrowser = createFakeBrowser({ composer: false, login: true })
    const readyBrowser = createFakeBrowser({ composer: true })
    const context = {
      pages: () => [loginBrowser.page, readyBrowser.page],
      newPage: async () => readyBrowser.page,
      on: () => undefined,
      close: async () => undefined,
    } as unknown as BrowserContext
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => context,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await adapter.close()
  })

  it('giữ nguyên trang chat mới đã sẵn sàng thay vì tải lại làm bật màn hình đăng nhập', async () => {
    const fake = createFakeBrowser({ composer: true, rootGotoCausesLogin: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.gotoCount).toBe(0)
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    expect(adapter.status().status).toBe('ready')
    await adapter.close()
  })

  it('đang ở chat cũ thì vẫn điều hướng về root sạch thay vì click sidebar', async () => {
    const fake = createFakeBrowser({ composer: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()
    await fake.page.goto('https://chatgpt.com/c/unowned-stale-chat')

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.gotoCount).toBe(2)
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    await adapter.close()
  })

  it('chờ DOM chat cũ biến mất hoàn toàn trước khi gửi phản hồi đầu tiên ở chat mới', async () => {
    vi.useFakeTimers()
    const options: FakePageOptions = {
      composer: true,
      initialAssistantCount: 1,
      response: 'Phản hồi đầu tiên không bị bỏ lỡ.',
    }
    const fake = createFakeBrowser(options)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    let newChatSettled = false
    const newChat = adapter.startNewConversation().then(() => { newChatSettled = true })
    await vi.advanceTimersByTimeAsync(600)
    expect(newChatSettled).toBe(false)
    options.initialAssistantCount = 0
    await vi.advanceTimersByTimeAsync(400)
    await newChat

    const response = adapter.sendAndWait('Dịch đoạn đầu tiên.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(response).resolves.toBe('Phản hồi đầu tiên không bị bỏ lỡ.')
    await adapter.close()
  })

  it('state rỗng: nếu trang đổi sang chat cá nhân sau start thì mở lại root sạch rồi mới gửi', async () => {
    vi.useFakeTimers()
    const personalUrl = 'https://chatgpt.com/c/personal-chat-must-not-be-adopted'
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch an toàn.',
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()
    await adapter.startNewConversation()
    await fake.page.goto(personalUrl)

    const response = adapter.sendAndWait('Chỉ gửi sau khi về root.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(response).resolves.toBe('Bản dịch an toàn.')
    expect(fake.sendDestinationUrls).toEqual(['https://chatgpt.com/'])
    expect(fake.sendDestinationUrls).not.toContain(personalUrl)
    await adapter.close()
  })

  it('state rỗng: gửi trực tiếp từ chat cá nhân không được tự reset hay nhận chat đó', async () => {
    const fake = createFakeBrowser({
      composer: true,
      initialUrl: 'https://chatgpt.com/c/personal-direct-send-0001',
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    await expect(adapter.sendAndWait('Không được gửi vào chat này.'))
      .rejects.toMatchObject({ name: 'ChatGptNonRetryableSafetyError' })
    expect(fake.gotoCount).toBe(0)
    expect(fake.fillCount).toBe(0)
    expect(fake.sent).toBe(false)
    await adapter.close()
  })

  it('state rỗng: reset root vẫn bị chuyển về chat cá nhân thì dừng vĩnh viễn trước khi fill/gửi', async () => {
    const personalUrl = 'https://chatgpt.com/c/personal-reset-redirect-0001'
    const browserOptions: FakePageOptions = {
      composer: true,
    }
    const fake = createFakeBrowser(browserOptions)
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()
    await adapter.startNewConversation()
    await fake.page.goto(personalUrl)
    browserOptions.rootGotoRedirectTo = personalUrl

    await expect(adapter.sendAndWait('Không được gửi vào chat này.'))
      .rejects.toMatchObject({ name: 'ChatGptNonRetryableSafetyError' })
    expect(fake.gotoCount).toBe(2)
    expect(fake.fillCount).toBe(0)
    expect(fake.sent).toBe(false)
    expect(fake.sendDestinationUrls).toEqual([])
    await adapter.close()
  })

  it('không fallback Enter hay lưu state nếu URL đổi sang chat cá nhân ngay lúc bấm Gửi', async () => {
    const statePath = await temporaryStatePath()
    const store = new FileConversationStateStore(statePath)
    const personalUrl = 'https://chatgpt.com/c/personal-send-race-0001'
    const fake = createFakeBrowser({
      composer: true,
      navigateBeforeAtomicSendClickTo: personalUrl,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    await expect(adapter.sendAndWait('Không được rò rỉ sang chat cá nhân.'))
      .rejects.toThrow(/chưa được tool xác minh/u)
    expect(fake.enterCount).toBe(0)
    expect(fake.sent).toBe(false)
    expect(await store.load()).toBeUndefined()
    await adapter.close()
  })

  it('sau khi người dùng mở chat cá nhân, lần gửi sau vẫn quay lại chat tool và chỉ xóa chat tool', async () => {
    vi.useFakeTimers()
    const toolUrl = 'https://chatgpt.com/c/tool-owned-multi-segment-0001'
    const personalUrl = 'https://chatgpt.com/c/personal-chat-never-delete-0001'
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch đoạn.',
      conversationUrlAfterSend: toolUrl,
      sidebarPersonalConversationMenu: true,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    const firstResponse = adapter.sendAndWait('Đoạn một.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(firstResponse).resolves.toBe('Bản dịch đoạn.')

    await fake.page.goto(personalUrl)
    const secondResponse = adapter.sendAndWait('Đoạn hai.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(secondResponse).resolves.toBe('Bản dịch đoạn.')
    expect(fake.sentUrls).toEqual([toolUrl, toolUrl])

    vi.useRealTimers()
    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.personalMenuClickCount).toBe(0)
    expect(fake.deleteMenuClickCount).toBe(1)
    expect(fake.deletedUrls).toEqual([toolUrl])
    expect(fake.deletedUrls).not.toContain(personalUrl)
    await adapter.close()
  })

  it('vẫn gửi được các đoạn sau khi ChatGPT ảo hóa marker của đoạn cũ trong cùng phiên tool', async () => {
    vi.useFakeTimers()
    const toolUrl = 'https://chatgpt.com/c/tool-marker-virtualized-0001'
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch theo đoạn.',
      conversationUrlAfterSend: toolUrl,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    const first = adapter.sendAndWait('Đoạn đầu.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(first).resolves.toBe('Bản dịch theo đoạn.')

    // ChatGPT removes old turns from its DOM in long conversations. The
    // adapter may use its in-memory proof for this exact owned URL, but must
    // still verify the marker of the newly submitted message before saving.
    fake.clearUserMessages()
    const second = adapter.sendAndWait('Đoạn kế tiếp.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(second).resolves.toBe('Bản dịch theo đoạn.')
    expect(fake.sentUrls).toEqual([toolUrl, toolUrl])
    await adapter.close()
  })

  it('chỉ xóa chat dài đã ảo hóa marker khi chính phiên hiện tại đã xác minh nó', async () => {
    vi.useFakeTimers()
    const toolUrl = 'https://chatgpt.com/c/tool-delete-virtualized-0001'
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch theo đoạn.',
      conversationUrlAfterSend: toolUrl,
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
    })
    await adapter.openLogin()

    const first = adapter.sendAndWait('Đoạn đầu.', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(first).resolves.toBe('Bản dịch theo đoạn.')
    fake.clearUserMessages()

    vi.useRealTimers()
    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.deletedUrls).toEqual([toolUrl])
    expect(fake.deleteMenuClickCount).toBe(1)
    await adapter.close()
  })

  it('chỉ giữ 64 ownership hash gần nhất khi chat có nhiều phân đoạn', async () => {
    vi.useFakeTimers()
    const store = new VolatileConversationStateStore()
    const toolUrl = 'https://chatgpt.com/c/tool-owned-hash-cap-0001'
    const markers = Array.from({ length: 64 }, (_, index) =>
      `TDTOWN_${index.toString(16).padStart(32, '0')}`)
    const initialHashes = markers.map(ownershipHash)
    await store.save({
      id: 'tool-owned-hash-cap-0001',
      url: toolUrl,
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: initialHashes,
    })
    const fake = createFakeBrowser({
      composer: true,
      response: 'Bản dịch phân đoạn mới.',
      conversationUrlAfterSend: toolUrl,
      userMessages: [`Metadata: ${markers.at(-1)}`],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
    })
    await adapter.openLogin()

    const responsePromise = adapter.sendAndWait('Đoạn thứ 65.', { timeoutMs: 10_000 })
    await vi.waitFor(() => expect(fake.sent).toBe(true))
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(responsePromise).resolves.toBe('Bản dịch phân đoạn mới.')

    const saved = await store.load()
    const newMarker = /\bTDTOWN_[a-f0-9]{32}\b/u.exec(fake.lastFilledMessage)?.[0]
    expect(saved?.ownershipHashes).toHaveLength(64)
    expect(saved?.ownershipHashes).not.toContain(initialHashes[0])
    expect(saved?.ownershipHashes).toContain(ownershipHash(newMarker!))
    await adapter.close()
  })

  it('ghi nhớ qua lần khởi động lại và chỉ xóa đúng chat do tool đã tạo', async () => {
    const statePath = await temporaryStatePath()
    const firstBrowser = createFakeBrowser({
      composer: true,
      response: 'Bản dịch đã hoàn tất.',
      conversationUrlAfterSend: 'https://chatgpt.com/c/persisted-tool-chat-0001',
    })
    const firstAdapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => firstBrowser.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await firstAdapter.openLogin()
    vi.useFakeTimers()
    const responsePromise = firstAdapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    await waitForFileCondition(statePath, (state) => state.conversation !== null)
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(responsePromise).resolves.toBe('Bản dịch đã hoàn tất.')
    await firstAdapter.close()
    vi.useRealTimers()

    const stateAfterSend = JSON.parse(await readFile(statePath, 'utf8'))
    expect(stateAfterSend.conversation).toMatchObject({
      id: 'persisted-tool-chat-0001',
      url: 'https://chatgpt.com/c/persisted-tool-chat-0001',
    })

    const secondBrowser = createFakeBrowser({
      composer: true,
      userMessages: [firstBrowser.lastFilledMessage],
    })
    const secondAdapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => secondBrowser.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await secondAdapter.openLogin()
    await expect(secondAdapter.startNewConversation()).resolves.toBeUndefined()

    expect(secondBrowser.deleteMenuClickCount).toBe(1)
    expect(secondBrowser.deleteActionClickCount).toBe(1)
    expect(secondBrowser.deleteConfirmClickCount).toBe(1)
    expect(secondBrowser.gotoCount).toBe(2)
    expect(secondBrowser.currentUrl).toBe('https://chatgpt.com/')
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    await secondAdapter.close()
  })

  it('thử lại một lần đúng chat tool khi click dọn chat cũ lỗi rồi mới tạo chat mới', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-cleanup-retry-0001',
      url: 'https://chatgpt.com/c/tool-chat-cleanup-retry-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteMenuClickFailures: 1,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()

    // First attempt only touches the exact stored URL and fails before the
    // menu click. The second attempt starts from that exact URL again.
    expect(fake.gotoCount).toBe(3)
    expect(fake.deleteMenuClickCount).toBe(1)
    expect(fake.deleteActionClickCount).toBe(1)
    expect(fake.deleteConfirmClickCount).toBe(1)
    expect(fake.deletedUrls).toEqual([storedConversation.url])
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('bỏ tham chiếu sau hai lỗi xác nhận xóa chat tool rồi vẫn tạo chat mới', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-cleanup-confirm-fallback-0001',
      url: 'https://chatgpt.com/c/tool-chat-cleanup-confirm-fallback-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteConfirmClickFailures: 2,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()

    // Both confirmation attempts are scoped to the exact verified tool URL;
    // no remote deletion was proven, so only the local active pointer is gone.
    expect(fake.gotoCount).toBe(3)
    expect(fake.deleteMenuClickCount).toBe(2)
    expect(fake.deleteActionClickCount).toBe(2)
    expect(fake.deleteConfirmClickCount).toBe(2)
    expect(fake.deletedUrls).toEqual([])
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('bỏ tham chiếu và tạo chat mới khi hai lượt xác nhận xóa đều không có kết quả', { timeout: 15_000 }, async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-delete-failure-0001',
      url: 'https://chatgpt.com/c/tool-chat-delete-failure-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteRedirects: false,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const startPromise = adapter.startNewConversation()
    await waitForFileCondition(statePath, () => fake.deleteConfirmClickCount === 1)
    await vi.advanceTimersByTimeAsync(20_500)
    await waitForRuntimeCondition(() => fake.deleteConfirmClickCount === 2, statePath)
    await vi.advanceTimersByTimeAsync(20_500)
    await expect(startPromise).resolves.toBeUndefined()

    expect(fake.deleteConfirmClickCount).toBe(2)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it.each([
    'https://chatgpt.com/c/personal-after-delete-confirm-0001',
    'https://chatgpt.com/auth/login',
  ])('redirect sau xác nhận tới %s thì không chạm chat cá nhân và vẫn tạo chat mới', async (redirectUrl) => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-unsafe-delete-redirect-0001',
      url: 'https://chatgpt.com/c/tool-chat-unsafe-delete-redirect-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteRedirectUrl: redirectUrl,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.deleteConfirmClickCount).toBe(2)
    expect(fake.deletedUrls).toEqual([storedConversation.url, storedConversation.url])
    expect(fake.deletedUrls).not.toContain(redirectUrl)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('URL đổi ngay trong atomic menu click thì không click menu/chat cá nhân và tạo chat mới', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-destructive-race-0001',
      url: 'https://chatgpt.com/c/tool-chat-destructive-race-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      navigateBeforeAtomicDeleteStage: 'menu',
      atomicNavigationUrl: 'https://chatgpt.com/c/personal-destructive-race-0001',
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteActionClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it.each([
    {
      stage: 'delete' as const,
      expectedMenuClicks: 2,
      expectedDeleteClicks: 0,
    },
    {
      stage: 'confirm' as const,
      expectedMenuClicks: 2,
      expectedDeleteClicks: 2,
    },
  ])('URL đổi ngay trong atomic $stage click thì không click bước hiện tại/sau, rồi tạo chat mới', async ({
    stage,
    expectedMenuClicks,
    expectedDeleteClicks,
  }) => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: `tool-chat-${stage}-race-0001`,
      url: `https://chatgpt.com/c/tool-chat-${stage}-race-0001`,
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      navigateBeforeAtomicDeleteStage: stage,
      atomicNavigationUrl: `https://chatgpt.com/c/personal-${stage}-race-0001`,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.deleteMenuClickCount).toBe(expectedMenuClicks)
    expect(fake.deleteActionClickCount).toBe(expectedDeleteClicks)
    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('không thao tác xóa khi ID/URL đã lưu không hợp lệ', async () => {
    const statePath = await temporaryStatePath()
    await writeFile(statePath, JSON.stringify({
      version: 3,
      conversation: {
        id: 'tool-chat-valid-looking-0001',
        url: 'https://example.com/c/tool-chat-valid-looking-0001',
        recordedAt: '2026-08-12T00:00:00.000Z',
        ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
      },
    }))
    const fake = createFakeBrowser({ composer: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).rejects.toThrow(/không hợp lệ/u)
    expect(fake.gotoCount).toBe(0)
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    await adapter.close()
  })

  it('không xóa khi stored.id không khớp ID trong URL cùng origin', async () => {
    const statePath = await temporaryStatePath()
    await writeFile(statePath, JSON.stringify({
      version: 3,
      conversation: {
        id: 'stored-id-does-not-match-0001',
        url: 'https://chatgpt.com/c/different-url-id-0001',
        recordedAt: '2026-08-12T00:00:00.000Z',
        ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
      },
    }))
    const fake = createFakeBrowser({ composer: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).rejects.toThrow(/ID\/URL/u)
    expect(fake.gotoCount).toBe(0)
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    await adapter.close()
  })

  it('JSON state bị hỏng thì dừng trước mọi thao tác xóa', async () => {
    const statePath = await temporaryStatePath()
    await writeFile(statePath, '{not valid JSON')
    const fake = createFakeBrowser({ composer: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).rejects.toThrow(/không đọc được dữ liệu/iu)
    expect(fake.gotoCount).toBe(0)
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    await adapter.close()
  })

  it('thiếu menu dọn chat thì không bấm Xóa/Xác nhận, bỏ tham chiếu cục bộ và mở chat mới', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-missing-menu-0001',
      url: 'https://chatgpt.com/c/tool-chat-missing-menu-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteMenuAvailable: false,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const startPromise = adapter.startNewConversation()
    await waitForFileCondition(statePath, () => fake.gotoCount === 1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(15_500)
    await expect(startPromise).resolves.toBeUndefined()

    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteActionClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8')).conversation).toBeNull()
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('thiếu lệnh Xóa sau menu thì giữ chat cũ, bỏ tham chiếu cục bộ và mở chat mới', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-missing-delete-action-0001',
      url: 'https://chatgpt.com/c/tool-chat-missing-delete-action-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteActionAvailable: false,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const startPromise = adapter.startNewConversation()
    await waitForFileCondition(statePath, () => fake.deleteMenuClickCount === 1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_500)
    await expect(startPromise).resolves.toBeUndefined()

    expect(fake.deleteMenuClickCount).toBe(1)
    expect(fake.deleteActionClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8')).conversation).toBeNull()
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('marker chat cũ bị ẩn thì không mở menu, giữ chat cũ và bắt đầu chat mới sạch', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-content-mismatch-0001',
      url: 'https://chatgpt.com/c/tool-chat-content-mismatch-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      sidebarPersonalConversationMenu: true,
      userMessages: ['Nội dung không phải prompt của tool.'],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const startPromise = adapter.startNewConversation()
    await waitForFileCondition(statePath, () => fake.gotoCount === 1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(15_500)
    await expect(startPromise).resolves.toBeUndefined()

    expect(fake.personalMenuClickCount).toBe(0)
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteActionClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8')).conversation).toBeNull()
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('thiếu nút xác nhận thì giữ chat cũ, bỏ tham chiếu cục bộ và mở chat mới', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'tool-chat-missing-confirm-0001',
      url: 'https://chatgpt.com/c/tool-chat-missing-confirm-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({
      composer: true,
      deleteConfirmAvailable: false,
      userMessages: [STORED_TOOL_MESSAGE],
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const startPromise = adapter.startNewConversation()
    await waitForFileCondition(statePath, () => fake.deleteActionClickCount === 1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_500)
    await expect(startPromise).resolves.toBeUndefined()

    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8')).conversation).toBeNull()
    expect(fake.currentUrl).toBe('https://chatgpt.com/')
    await adapter.close()
  })

  it('target đã mất và redirect về root thì clear state mà không bấm xóa chat khác', async () => {
    const statePath = await temporaryStatePath()
    const storedConversation = {
      id: 'already-deleted-tool-chat-0001',
      url: 'https://chatgpt.com/c/already-deleted-tool-chat-0001',
      recordedAt: '2026-08-12T00:00:00.000Z',
      ownershipHashes: [ownershipHash(STORED_TOOL_MARKER)],
    }
    await writeFile(statePath, JSON.stringify({ version: 3, conversation: storedConversation }))
    const fake = createFakeBrowser({ composer: true, redirectConversationGotoToRoot: true })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()

    await expect(adapter.startNewConversation()).resolves.toBeUndefined()
    expect(fake.deleteMenuClickCount).toBe(0)
    expect(fake.deleteActionClickCount).toBe(0)
    expect(fake.deleteConfirmClickCount).toBe(0)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      version: 3,
      conversation: null,
    })
    await adapter.close()
  })

  it('vẫn lưu URL chat do tool tạo khi chờ phản hồi bị timeout', { timeout: 20_000 }, async () => {
    const statePath = await temporaryStatePath()
    const fake = createFakeBrowser({
      composer: true,
      assistantAfterSend: false,
      conversationUrlAfterSend: 'https://chatgpt.com/c/tool-chat-timeout-0001',
    })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: new FileConversationStateStore(statePath),
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.', { timeoutMs: 10_000 })
    const rejection = expect(responsePromise).rejects.toThrow(/10 giây/u)
    await waitForFileCondition(statePath, (state) => state.conversation !== null)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10_500)
    await vi.advanceTimersByTimeAsync(10_500)
    await rejection

    expect(JSON.parse(await readFile(statePath, 'utf8')).conversation).toMatchObject({
      id: 'tool-chat-timeout-0001',
      url: 'https://chatgpt.com/c/tool-chat-timeout-0001',
    })
    await adapter.close()
  })

  it('không lưu URL gốc khi ChatGPT không cấp /c/{id} hợp lệ sau lúc gửi', async () => {
    const statePath = await temporaryStatePath()
    const store = new FileConversationStateStore(statePath)
    const fake = createFakeBrowser({ composer: true, conversationUrlAfterSend: false })
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory: async () => fake.context,
      conversationStateStore: store,
      conversationUrlTimeoutMs: 500,
    })
    await adapter.openLogin()
    vi.useFakeTimers()

    const responsePromise = adapter.sendAndWait('Hãy dịch đoạn này.')
    const rejection = expect(responsePromise).rejects.toMatchObject({
      name: 'ChatGptConversationVerificationError',
      message: expect.stringMatching(/đã chặn gửi lại/iu),
    })
    await waitForRuntimeCondition(() => fake.sent, statePath)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(700)
    await vi.advanceTimersByTimeAsync(700)
    await rejection

    expect(await store.load()).toBeUndefined()
    expect(fake.sent).toBe(true)
    await adapter.close()
  })

  it('chuyển sang Edge bình thường để đăng nhập rồi dùng lại đúng profile', async () => {
    const loginBrowser = createFakeBrowser({ composer: false, login: true })
    const readyBrowser = createFakeBrowser({ composer: true })
    const browserFactory = vi
      .fn()
      .mockResolvedValueOnce(loginBrowser.context)
      .mockResolvedValueOnce(readyBrowser.context)
    let running = true
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const manualLoginFactory = vi.fn(async () => ({
      closed,
      isRunning: () => running,
      close: async () => {
        running = false
        resolveClosed()
      },
    }))
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
      manualLoginFactory,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({
      status: 'login-required',
      message: expect.stringContaining('ĐÓNG'),
    })
    expect(manualLoginFactory).toHaveBeenCalledWith(expect.objectContaining({
      profileDirectory: 'fake-profile',
      url: 'https://chatgpt.com/',
    }))

    running = false
    resolveClosed()
    await vi.waitFor(() => expect(adapter.status().message).toContain('Kiểm tra kết nối'))
    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    expect(browserFactory).toHaveBeenCalledTimes(2)
    await adapter.close()
  })

  it('Kiểm tra kết nối đóng manual Edge đang mở rồi đọc account bằng browser ẩn', async () => {
    const loginBrowser = createFakeBrowser({ composer: false, login: true })
    const readyBrowser = createFakeBrowser({
      composer: true,
      chatGptIdentityCandidates: ['Alexander Bryant\nalex@example.com\nFree'],
    })
    const browserFactory = vi
      .fn()
      .mockResolvedValueOnce(loginBrowser.context)
      .mockResolvedValueOnce(readyBrowser.context)
    let running = true
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
    const close = vi.fn(async () => {
      running = false
      resolveClosed()
    })
    const manualLoginFactory = vi.fn(async () => ({
      closed,
      isRunning: () => running,
      close,
    }))
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
      manualLoginFactory,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'login-required' })
    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'ready' })
    await expect(adapter.readAccountIdentity()).resolves.toEqual({
      label: 'Alexander Bryant',
      email: 'alex@example.com',
      plan: 'free',
    })

    expect(close).toHaveBeenCalledOnce()
    expect(manualLoginFactory).toHaveBeenCalledOnce()
    expect(browserFactory).toHaveBeenCalledTimes(2)
    expect(browserFactory).toHaveBeenLastCalledWith(expect.objectContaining({ headless: true }))
    await adapter.close()
  })

  it('báo rõ nếu Kiểm tra kết nối chưa đóng được manual Edge', async () => {
    vi.useFakeTimers()
    const loginBrowser = createFakeBrowser({ composer: false, login: true })
    const browserFactory = vi.fn(async () => loginBrowser.context)
    const close = vi.fn(async () => undefined)
    const manualLoginFactory = vi.fn(async () => ({
      closed: new Promise<void>(() => undefined),
      isRunning: () => true,
      close,
    }))
    const adapter = new ChatGptWebAdapter({
      profileDirectory: 'fake-profile',
      browserFactory,
      manualLoginFactory,
    })

    await expect(adapter.openLogin()).resolves.toMatchObject({ status: 'login-required' })
    const verification = adapter.openLogin()
    await vi.advanceTimersByTimeAsync(9_000)
    await expect(verification).resolves.toMatchObject({
      status: 'login-required',
      message: expect.stringContaining('chưa đóng hoàn toàn'),
    })

    expect(close).toHaveBeenCalledOnce()
    expect(browserFactory).toHaveBeenCalledOnce()
    await adapter.close()
  })
})
