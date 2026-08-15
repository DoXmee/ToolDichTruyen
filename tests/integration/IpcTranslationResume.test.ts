import { describe, expect, it, vi } from 'vitest'
import type { IpcDependencies } from '../../src/main/ipc'
import { registerIpcHandlers } from '../../src/main/ipc'
import { IPC_CHANNELS } from '../../src/preload/channels'

describe('IPC resume translation checkpoint', () => {
  it('forwards the existing resume action for a failed setup checkpoint without inventing a segment id', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
    const resume = vi.fn(async () => undefined)
    const window = {
      isDestroyed: () => false,
      webContents: {
        id: 81,
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
      chatGpt: { onStatus: () => () => undefined },
      translator: {
        resume,
        onEvent: () => () => undefined,
      },
      storySources: { onProgress: () => () => undefined },
      gemini: {},
    } as unknown as IpcDependencies
    const dispose = registerIpcHandlers(dependencies)
    const handler = handlers.get(IPC_CHANNELS.translationResume)
    const event = {
      sender: { id: 81, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    }

    await expect(handler!(event, { jobId: 'failed-chat-setup-checkpoint' })).resolves.toBeUndefined()
    expect(resume).toHaveBeenCalledWith('failed-chat-setup-checkpoint')

    dispose()
  })

  it('forwards restart for the selected history checkpoint', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
    const restart = vi.fn(async () => ({ jobId: 'new-job' }))
    const window = { isDestroyed: () => false, webContents: { id: 82, isDestroyed: () => false, send: vi.fn() } }
    const dependencies = {
      ipcMain: { removeHandler: vi.fn(), handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(channel, handler)) },
      dialog: {}, appVersion: () => 'test', mainWindow: () => window, prompts: {}, persistence: {},
      chatGpt: { onStatus: () => () => undefined }, translator: { restart, onEvent: () => () => undefined },
      storySources: { onProgress: () => () => undefined }, gemini: {},
    } as unknown as IpcDependencies
    const dispose = registerIpcHandlers(dependencies)
    const handler = handlers.get(IPC_CHANNELS.translationRestart)
    const event = { sender: { id: 82, getURL: () => 'file:///tool/index.html' }, senderFrame: { url: 'file:///tool/index.html' } }

    await expect(handler!(event, { jobId: 'history-job' })).resolves.toEqual({ jobId: 'new-job' })
    expect(restart).toHaveBeenCalledWith('history-job')
    dispose()
  })
})
