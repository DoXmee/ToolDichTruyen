import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcDependencies } from '../../src/main/ipc';
import { registerIpcHandlers } from '../../src/main/ipc';
import { IPC_CHANNELS } from '../../src/preload/channels';
import type { StorySourceProgress } from '../../src/shared/types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('IPC nhập link truyện và xuất từng chương', () => {
  it('nối luồng phân tích, tải, tiến trình, hủy và lưu TXT qua cầu nối an toàn', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ipc-story-workflow-'));
    temporaryDirectories.push(directory);
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const send = vi.fn();
    const helperDirectory = path.join(directory, 'Huli Browser Helper');
    const helperManifest = path.join(helperDirectory, 'manifest.json');
    await mkdir(helperDirectory, { recursive: true });
    await writeFile(helperManifest, '{"manifest_version":3}', 'utf8');
    const showItemInFolder = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: { id: 91, isDestroyed: () => false, send },
    };
    let progressListener: ((progress: StorySourceProgress) => void) | undefined;
    const analyzeUrl = vi.fn(async (url: string) => ({ analysisId: 'analysis-1', inputUrl: url }));
    const openManualVerification = vi.fn(async (_url: string) => undefined);
    const fetchChapters = vi.fn(async (request: { analysisId: string; chapterIds: string[] }) => ({
      analysisId: request.analysisId,
      chapters: request.chapterIds,
    }));
    const cancel = vi.fn(async () => undefined);
    const closeChatGpt = vi.fn(async () => undefined);
    const dependencies = {
      ipcMain: {
        removeHandler: vi.fn(),
        handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }),
      },
      dialog: {
        showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [directory] })),
      },
      appVersion: () => 'test',
      mainWindow: () => window,
      prompts: {},
      persistence: {},
      chatGpt: {
        onStatus: () => () => undefined,
        status: () => ({ status: 'ready' }),
        close: closeChatGpt,
      },
      translator: {
        onEvent: () => () => undefined,
      },
      storySources: {
        analyzeUrl,
        openManualVerification,
        fetchChapters,
        cancel,
        onProgress: (listener: (progress: StorySourceProgress) => void) => {
          progressListener = listener;
          return () => { progressListener = undefined; };
        },
      },
      gemini: {},
      showItemInFolder,
      browserHelperDirectories: () => [helperDirectory],
    } as unknown as IpcDependencies;

    const dispose = registerIpcHandlers(dependencies);
    const event = {
      sender: { id: 91, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    };

    await expect(handlers.get(IPC_CHANNELS.storyAnalyze)!(event, {
      url: '  https://www.timotxt.com/1509589610/  ',
    })).resolves.toMatchObject({ analysisId: 'analysis-1' });
    expect(analyzeUrl).toHaveBeenCalledWith('https://www.timotxt.com/1509589610/');

    await expect(handlers.get(IPC_CHANNELS.storyManualVerification)!(event, {
      url: '  https://m.huliwang.net/1703891/1.html  ',
    })).resolves.toBeUndefined();
    expect(closeChatGpt).toHaveBeenCalledWith({ strict: true });
    expect(openManualVerification).toHaveBeenCalledWith('https://m.huliwang.net/1703891/1.html');

    closeChatGpt.mockRejectedValueOnce(new Error('context close failed'));
    await expect(handlers.get(IPC_CHANNELS.storyManualVerification)!(event, {
      url: 'https://m.huliwang.net/1703891/2.html',
    })).rejects.toThrow('context close failed');
    expect(openManualVerification).toHaveBeenCalledTimes(1);

    await expect(handlers.get(IPC_CHANNELS.storyRevealBrowserHelper)!(event)).resolves.toEqual({
      directory: helperDirectory,
    });
    expect(showItemInFolder).toHaveBeenCalledWith(helperManifest);

    await expect(handlers.get(IPC_CHANNELS.storyFetch)!(event, {
      analysisId: 'analysis-1',
      chapterIds: ['chapter-2', 'chapter-1'],
    })).resolves.toEqual({ analysisId: 'analysis-1', chapters: ['chapter-2', 'chapter-1'] });
    await expect(handlers.get(IPC_CHANNELS.storyFetch)!(event, {
      analysisId: 'analysis-1',
      chapterIds: ['chapter-1', 'chapter-1'],
    })).rejects.toThrow(/trùng/u);

    progressListener?.({
      analysisId: 'analysis-1',
      phase: 'fetching',
      completed: 1,
      total: 2,
      message: 'Đang tải chương 2',
    });
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.storyProgressEvent, expect.objectContaining({
      completed: 1,
      total: 2,
    }));

    await handlers.get(IPC_CHANNELS.storyCancel)!(event, { analysisId: 'analysis-1' });
    expect(cancel).toHaveBeenCalledWith('analysis-1');

    await expect(handlers.get(IPC_CHANNELS.exportChooseDirectory)!(event)).resolves.toEqual({
      canceled: false,
      directory: path.resolve(directory),
    });
    const exported = await handlers.get(IPC_CHANNELS.exportChapters)!(event, {
      directory,
      exportJobId: 'job-ipc-story-workflow',
      chapters: [{
        index: 1,
        title: 'Chương 1: Hôm nay anh đã về',
        content: 'Nội dung đã dịch.',
        wordCount: 5,
      }],
    }) as { records: Array<{ filePath: string; status: string }> };
    expect(exported.records[0]?.status).toBe('saved');
    await expect(readFile(exported.records[0]?.filePath ?? '', 'utf8')).resolves.toBe(
      'Chương 1: Hôm nay anh đã về\r\n\r\nNội dung đã dịch.',
    );

    const original = await handlers.get(IPC_CHANNELS.exportOriginalChapters)!(event, {
      directory,
      exportJobId: 'job-ipc-story-workflow',
      chapters: [{
        index: 152,
        title: 'Chương 152: Bản gốc đã dịch',
        content: 'Nội dung gốc chưa chia.',
        wordCount: 5,
      }],
    }) as { directory: string; records: Array<{ filePath: string; status: string }> };
    expect(original.directory).toBe(path.join(directory, 'Chương dịch gốc chưa chia'));
    expect(original.records[0]?.status).toBe('saved');
    await expect(readFile(original.records[0]?.filePath ?? '', 'utf8')).resolves.toBe(
      'Chương 152: Bản gốc đã dịch\r\n\r\nNội dung gốc chưa chia.',
    );

    const aggregate = await handlers.get(IPC_CHANNELS.exportCombinedChapters)!(event, {
      directory,
      exportJobId: 'job-ipc-story-workflow',
      startChapter: 152,
      endChapter: 153,
      sourceChapterNumbers: [152, 153],
      chapters: [{
        index: 1,
        title: 'Chương 1: Phần đã chia',
        content: 'Nội dung đã chia.',
        wordCount: 4,
      }],
    }) as { fileName: string; filePath: string; status: string };
    expect(aggregate.fileName).toBe('Tổng hợp từ chương 152-153.txt');
    expect(aggregate.status).toBe('saved');
    await expect(readFile(aggregate.filePath, 'utf8')).resolves.toBe(
      'Chương 1: Phần đã chia\r\n\r\nNội dung đã chia.',
    );

    const sourceAggregate = await handlers.get(IPC_CHANNELS.exportCombinedSourceChapters)!(event, {
      directory,
      exportJobId: 'job-ipc-story-workflow',
      sourceStartChapter: 40,
      sourceEndChapter: 41,
      outputStartChapter: 101,
      outputEndChapter: 102,
      chapters: [{
        index: 101,
        sourceChapterNumber: 40,
        title: 'Chương 101: 原题甲',
        content: '第一段原文。',
        wordCount: 1,
      }, {
        index: 102,
        sourceChapterNumber: 41,
        title: 'Chương 102: 原题乙',
        content: '第二段原文。',
        wordCount: 1,
      }],
    }) as { fileName: string; filePath: string; status: string };
    expect(sourceAggregate.fileName).toBe('File tổng c.gốc (40-41)_c.mới (101-102).txt');
    expect(sourceAggregate.status).toBe('saved');
    await expect(readFile(sourceAggregate.filePath, 'utf8')).resolves.toBe(
      'Chương 101: 原题甲\r\n\r\n第一段原文。\r\n\r\n---\r\n\r\nChương 102: 原题乙\r\n\r\n第二段原文。',
    );

    dispose();
    expect(progressListener).toBeUndefined();
  });

  it('chặn sender lạ và payload vượt contract trước khi chạm dịch vụ', async () => {
    const emptyResourceRoot = await mkdtemp(path.join(tmpdir(), 'ipc-empty-helper-'));
    temporaryDirectories.push(emptyResourceRoot);
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const analyzeUrl = vi.fn();
    const openManualVerification = vi.fn();
    const dependencies = {
      ipcMain: {
        removeHandler: vi.fn(),
        handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }),
      },
      dialog: {},
      appVersion: () => 'test',
      mainWindow: () => ({
        isDestroyed: () => false,
        webContents: { id: 12, isDestroyed: () => false, send: vi.fn() },
      }),
      chatGpt: { onStatus: () => () => undefined },
      translator: { onEvent: () => () => undefined },
      storySources: {
        analyzeUrl,
        openManualVerification,
        onProgress: () => () => undefined,
      },
      showItemInFolder: vi.fn(),
      browserHelperDirectories: () => [path.join(emptyResourceRoot, 'Huli Browser Helper')],
    } as unknown as IpcDependencies;
    const dispose = registerIpcHandlers(dependencies);

    await expect(handlers.get(IPC_CHANNELS.storyAnalyze)!({
      sender: { id: 999, getURL: () => 'https://attacker.invalid/' },
      senderFrame: { url: 'https://attacker.invalid/' },
    }, { url: 'https://www.timotxt.com/1509589610/' })).rejects.toThrow(/không được phép/u);
    await expect(handlers.get(IPC_CHANNELS.storyManualVerification)!({
      sender: { id: 999, getURL: () => 'https://attacker.invalid/' },
      senderFrame: { url: 'https://attacker.invalid/' },
    }, { url: 'https://m.huliwang.net/1703891/1.html' })).rejects.toThrow(/IPC/u);
    await expect(handlers.get(IPC_CHANNELS.storyRevealBrowserHelper)!({
      sender: { id: 999, getURL: () => 'https://attacker.invalid/' },
      senderFrame: { url: 'https://attacker.invalid/' },
    })).rejects.toThrow(/IPC/u);
    await expect(handlers.get(IPC_CHANNELS.storyFetch)!({
      sender: { id: 12, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    }, { analysisId: 'analysis-1', chapterIds: [] })).rejects.toThrow(/từ 1 đến/u);
    await expect(handlers.get(IPC_CHANNELS.storyManualVerification)!({
      sender: { id: 12, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    }, { url: '' })).rejects.toThrow(/url/u);
    await expect(handlers.get(IPC_CHANNELS.storyManualVerification)!({
      sender: { id: 12, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    }, { url: 'x'.repeat(2_049) })).rejects.toThrow(/quá dài/u);
    await expect(handlers.get(IPC_CHANNELS.storyRevealBrowserHelper)!({
      sender: { id: 12, getURL: () => 'file:///tool/index.html' },
      senderFrame: { url: 'file:///tool/index.html' },
    })).rejects.toThrow(/Không tìm thấy tiện ích Huliwang/u);
    expect(analyzeUrl).not.toHaveBeenCalled();
    expect(openManualVerification).not.toHaveBeenCalled();
    dispose();
  });
});
