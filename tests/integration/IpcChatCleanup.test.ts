import { describe, expect, it, vi } from 'vitest'
import type { IpcDependencies } from '../../src/main/ipc'
import { registerIpcHandlers } from '../../src/main/ipc'
import { IPC_CHANNELS } from '../../src/preload/channels'

describe('IPC cleanup chat live', () => {
  it('ủy quyền cleanup cho fail-safe ChatGptWebAdapter.startNewConversation', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
    const startNewConversation = vi.fn(async () => undefined)
    const window = {
      isDestroyed: () => false,
      webContents: {
        id: 73,
        isDestroyed: () => false,
        send: vi.fn(),
      },
    }
    const dependencies = {
      ipcMain: {
        removeHandler: vi.fn(),
        handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler)
        }),
      },
      dialog: {},
      appVersion: () => 'test',
      mainWindow: () => window,
      prompts: {},
      persistence: {},
      chatGpt: {
        startNewConversation,
        openLogin: vi.fn(),
        refreshStatus: vi.fn(),
        close: vi.fn(),
        onStatus: () => () => undefined,
      },
      translator: {
        onEvent: () => () => undefined,
      },
      storySources: {
        onProgress: () => () => undefined,
      },
      gemini: {},
    } as unknown as IpcDependencies

    const dispose = registerIpcHandlers(dependencies)
    const handler = handlers.get(IPC_CHANNELS.chatGptCleanupToolChat)
    expect(handler).toBeTypeOf('function')

    await expect(handler!({
      sender: { id: 73, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    })).resolves.toBeUndefined()
    expect(startNewConversation).toHaveBeenCalledOnce()

    dispose()
  })
})
