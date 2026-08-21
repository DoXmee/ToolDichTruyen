import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import type {
  StoryToolApi,
  TranslationEvent,
  TranslationRequest,
} from '../../src/renderer/ipc';
import type { TranslationJobSnapshot } from '../../src/shared';
import {
  chapterContentFingerprint,
  combinedChapterContentFingerprint,
} from '../../src/shared/exportIntegrity';

interface StoryToolHarness {
  api: StoryToolApi;
  emit: (event: TranslationEvent) => void;
  loadPrompts: ReturnType<typeof vi.fn>;
  connectChatGPT: ReturnType<typeof vi.fn>;
  startTranslation: ReturnType<typeof vi.fn>;
  cancelTranslation: ReturnType<typeof vi.fn>;
  discardTranslation: ReturnType<typeof vi.fn>;
  restartTranslation: ReturnType<typeof vi.fn>;
  getTranslation: ReturnType<typeof vi.fn>;
  analyzeStoryUrl: ReturnType<typeof vi.fn>;
  openManualStoryVerification: ReturnType<typeof vi.fn>;
  revealHuliBrowserHelper: ReturnType<typeof vi.fn>;
  fetchStoryChapters: ReturnType<typeof vi.fn>;
  chooseChapterDirectory: ReturnType<typeof vi.fn>;
  validateChapterDirectory: ReturnType<typeof vi.fn>;
  exportChapters: ReturnType<typeof vi.fn>;
  exportOriginalChapters: ReturnType<typeof vi.fn>;
  exportCombinedChapters: ReturnType<typeof vi.fn>;
  exportCombinedSourceChapters: ReturnType<typeof vi.fn>;
}

function installStoryTool(options: {
  draft?: unknown;
  period?: string;
  modern?: string;
  connectionStatus?: string;
  translationJob?: TranslationJobSnapshot;
  activeTranslations?: TranslationJobSnapshot[];
  storyAnalysis?: import('../../src/shared').StorySourceAnalysis;
  storyFetch?: import('../../src/shared').StoryFetchResult;
} = {}): StoryToolHarness {
  let eventListener: ((event: TranslationEvent) => void) | undefined;
  const loadPrompts = vi.fn(async () => ({
    period: options.period ?? 'Prompt niên đại mặc định',
    modern: options.modern ?? 'Prompt hiện đại mặc định',
    ancient: 'Prompt cổ trang mặc định',
    cultivation: 'Prompt tu tiên mặc định',
  }));
  const connectChatGPT = vi.fn(async () => ({ status: options.connectionStatus ?? 'ready' }));
  const startTranslation = vi.fn(async (_request: TranslationRequest) => ({ jobId: 'job-1' }));
  const cancelTranslation = vi.fn(async () => undefined);
  const discardTranslation = vi.fn(async () => undefined);
  const restartTranslation = vi.fn(async () => ({ jobId: 'job-restarted' }));
  const getTranslation = vi.fn(async () => options.translationJob ?? ({
    id: 'job-1',
    updatedAt: '2026-08-12T00:00:01.000Z',
    status: 'running',
    totalSegments: 0,
    completedSegments: 0,
    segments: [],
  } satisfies TranslationJobSnapshot));
  const analyzeStoryUrl = vi.fn(async () => options.storyAnalysis ?? Promise.reject(new Error('Chưa cấu hình fixture nguồn web.')));
  const openManualStoryVerification = vi.fn(async () => undefined);
  const revealHuliBrowserHelper = vi.fn(async () => ({ directory: 'D:\\Tool dịch truyện\\Huli Browser Helper' }));
  const fetchStoryChapters = vi.fn(async () => options.storyFetch ?? Promise.reject(new Error('Chưa cấu hình fixture nguồn web.')));
  const chooseChapterDirectory = vi.fn(async () => ({ canceled: false, directory: 'D:\\Truyện đã dịch' }));
  const validateChapterDirectory = vi.fn(async (directory: string) => ({ directory }));
  const exportChapters = vi.fn(async ({ directory, exportJobId, chapters }) => ({
    directory,
    records: chapters.map((chapter: { index: number; title: string; content: string; wordCount: number }) => ({
      exportJobId,
      exportDirectory: directory,
      contentHash: chapterContentFingerprint(chapter),
      index: chapter.index,
      title: chapter.title,
      wordCount: chapter.wordCount,
      fileName: `Chương ${chapter.index}.txt`,
      filePath: `${directory}\\Chương ${chapter.index}.txt`,
      status: 'saved' as const,
    })),
  }));
  const exportOriginalChapters = vi.fn(async ({ directory, exportJobId, chapters }) => ({
    directory: `${directory}\\original-translated`,
    records: chapters.map((chapter: { index: number; title: string; content: string; wordCount: number }) => ({
      exportJobId,
      exportDirectory: directory,
      contentHash: chapterContentFingerprint(chapter),
      index: chapter.index,
      title: chapter.title,
      wordCount: chapter.wordCount,
      fileName: `original-${chapter.index}.txt`,
      filePath: `${directory}\\original-translated\\original-${chapter.index}.txt`,
      status: 'saved' as const,
    })),
  }));
  const exportCombinedChapters = vi.fn(async ({ directory, exportJobId, startChapter, endChapter, chapters }) => ({
    directory,
    exportDirectory: directory,
    exportJobId,
    contentHash: combinedChapterContentFingerprint(startChapter, endChapter, chapters),
    fileName: `combined-${startChapter}-${endChapter}.txt`,
    filePath: `${directory}\\combined-${startChapter}-${endChapter}.txt`,
    startChapter,
    endChapter,
    chapterCount: chapters.length,
    status: 'saved' as const,
  }));
  const exportCombinedSourceChapters = vi.fn(async ({
    directory,
    exportJobId,
    sourceStartChapter,
    sourceEndChapter,
    outputStartChapter,
    outputEndChapter,
    chapters,
  }) => ({
    directory,
    exportDirectory: directory,
    exportJobId,
    contentHash: combinedChapterContentFingerprint(outputStartChapter, outputEndChapter, chapters),
    fileName: `File tổng c.gốc (${sourceStartChapter}-${sourceEndChapter})_c.mới (${outputStartChapter}-${outputEndChapter}).txt`,
    filePath: `${directory}\\File tổng c.gốc (${sourceStartChapter}-${sourceEndChapter})_c.mới (${outputStartChapter}-${outputEndChapter}).txt`,
    startChapter: outputStartChapter,
    endChapter: outputEndChapter,
    chapterCount: chapters.length,
    status: 'saved' as const,
  }));

  const api: StoryToolApi = {
    loadPrompts,
    getDraft: vi.fn(async () => options.draft ?? null),
    saveDraft: vi.fn(async () => undefined),
    connectChatGPT,
    startTranslation,
    pauseTranslation: vi.fn(async () => undefined),
    resumeTranslation: vi.fn(async () => undefined),
    restartTranslation,
    cancelTranslation,
    discardTranslation,
    getTranslation,
    getActiveTranslations: vi.fn(async () => options.activeTranslations ?? []),
    discoverTranslations: vi.fn(async () => options.activeTranslations ?? []),
    retrySegment: vi.fn(async () => undefined),
    onTranslationEvent: vi.fn((callback) => {
      eventListener = callback;
      return () => { eventListener = undefined; };
    }),
    analyzeStoryUrl,
    openManualStoryVerification,
    revealHuliBrowserHelper,
    fetchStoryChapters,
    cancelStoryFetch: vi.fn(async () => undefined),
    onStorySourceProgress: vi.fn(() => () => undefined),
    exportText: vi.fn(async () => ({ canceled: false, filePath: 'D:\\ban-dich.txt' })),
    chooseChapterDirectory,
    validateChapterDirectory,
    exportChapters,
    exportOriginalChapters,
    exportCombinedChapters,
    exportCombinedSourceChapters,
    generateTitles: vi.fn(async ({ chapters }) => ({
      titles: chapters.map((_, index) => `Tên gợi ý ${index + 1}`),
      model: 'gemini-test',
    })),
  };

  Object.defineProperty(window, 'storyTool', {
    configurable: true,
    value: api,
  });

  return {
    api,
    loadPrompts,
    connectChatGPT,
    startTranslation,
    cancelTranslation,
    discardTranslation,
    restartTranslation,
    getTranslation,
    analyzeStoryUrl,
    openManualStoryVerification,
    revealHuliBrowserHelper,
    fetchStoryChapters,
    chooseChapterDirectory,
    validateChapterDirectory,
    exportChapters,
    exportOriginalChapters,
    exportCombinedChapters,
    exportCombinedSourceChapters,
    emit: (event) => {
      if (!eventListener) throw new Error('Renderer chưa đăng ký translation listener.');
      eventListener(event);
    },
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('tool-dich-truyen:color-theme');
  Reflect.deleteProperty(window, 'storyTool');
  vi.restoreAllMocks();
});

describe('App renderer', () => {
  it('giữ công cụ chia chương thu gọn mặc định và mở được bằng bàn phím hoặc chuột', async () => {
    installStoryTool();
    render(<App />);

    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });
    const drawer = document.querySelector('details.chapter-drawer');
    const summary = drawer?.querySelector('summary');

    expect(drawer).toBeInstanceOf(HTMLDetailsElement);
    expect(summary).toHaveTextContent('Chia chương tự động');
    expect((drawer as HTMLDetailsElement).open).toBe(false);

    fireEvent.click(summary as HTMLElement);
    expect((drawer as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Chia chương tự động' })).toBeInTheDocument();
  });

  it('nạp nguyên vẹn prompts và draft UTF-8', async () => {
    const historical = 'Niên đại – giữ xưng hô Hán–Việt, không thêm lời.';
    const modern = 'Hiện đại: lời thoại tự nhiên và dứt khoát.';
    const source = '第一章，重逢；繁體小說「測試」……';
    const output = 'Chương 12: Ắ ằ ễ ộ ỳ · A\u0306\u0301 a\u0306\u0300 e\u0302\u0303 o\u0323\u0302 y\u0300 😀';
    const harness = installStoryTool({
      period: historical,
      modern,
      draft: {
        source,
        output,
        promptMode: 'modern',
        customPrompt: 'Giữ đúng sắc thái nhân vật nữ chính.',
        splitConfig: {
          targetWords: 720,
          prefix: 'Quyển một',
          suffix: '',
          startIndex: 12,
          inputLanguage: 'vi',
          autoDetectTitle: true,
        },
      },
    });

    render(<App />);

    expect(await screen.findByDisplayValue(source)).toBeInTheDocument();
    expect(screen.getByDisplayValue(output)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Truyện hiện đại/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Truyện niên đại/i }).closest('label')).not.toHaveTextContent('ký tự');
    expect(screen.getByRole('radio', { name: /Truyện hiện đại/i }).closest('label')).not.toHaveTextContent('ký tự');
    expect(harness.loadPrompts).toHaveBeenCalledOnce();
  });

  it('chuyển giao diện tối rõ ràng và ghi nhớ lựa chọn trên máy', async () => {
    installStoryTool();
    render(<App />);

    const toggle = await screen.findByRole('button', { name: 'Chuyển sang giao diện tối' });
    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('tool-dich-truyen:color-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeInTheDocument();
  });

  it('tự chọn chế độ Khác khi người dùng gõ prompt tùy chỉnh', async () => {
    installStoryTool();
    render(<App />);

    const customRadio = await screen.findByRole('radio', { name: /^Khác/i });
    const periodRadio = screen.getByRole('radio', { name: /Truyện niên đại/i });
    expect(periodRadio).toBeChecked();

    fireEvent.change(screen.getByLabelText('Prompt tùy chỉnh'), {
      target: { value: 'Dịch theo giọng trinh thám lạnh và cô đọng.' },
    });

    expect(customRadio).toBeChecked();
    expect(periodRadio).not.toBeChecked();
  });

  it('kết nối trạng thái ready và gửi đúng request khi bắt đầu dịch', async () => {
    const harness = installStoryTool({ connectionStatus: 'ready' });
    render(<App />);

    const source = '她推开门，看见庭院里的白梅。';
    fireEvent.change(await screen.findByLabelText('Nội dung tiếng Trung cần dịch'), {
      target: { value: source },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));

    expect(await screen.findByText('ChatGPT đã kết nối')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu dịch' }));

    await waitFor(() => {
      expect(harness.startTranslation).toHaveBeenCalledWith({
        source,
        promptMode: 'period',
        customPrompt: undefined,
        settings: {
          maxRetries: 3,
          maxCharsPerSegment: 12_000,
          responseTimeoutMs: 480_000,
        },
      });
    });
    expect(harness.connectChatGPT).toHaveBeenCalledOnce();
    expect(await screen.findByText('ChatGPT đang dịch')).toBeInTheDocument();
  });

  it('ghép segment-completed và chuyển sang hoàn tất khi nhận job-completed', async () => {
    const harness = installStoryTool({ connectionStatus: 'ready' });
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Nội dung tiếng Trung cần dịch'), {
      target: { value: '月色很好，她终于回家了。' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu dịch' }));
    await waitFor(() => expect(harness.startTranslation).toHaveBeenCalledOnce());

    act(() => {
      harness.emit({
        jobId: 'job-1',
        type: 'job-created',
        timestamp: 1,
        payload: {
          job: {
            status: 'queued',
            segments: [{ id: 'segment-1', index: 0, status: 'queued' }],
          },
        },
      });
      harness.emit({
        jobId: 'job-1',
        type: 'segment-completed',
        timestamp: 2,
        payload: {
          segment: {
            id: 'segment-1',
            index: 0,
            status: 'completed',
            translatedText: 'Ánh trăng rất đẹp, cuối cùng cô cũng trở về nhà.',
          },
          translatedText: 'Ánh trăng rất đẹp, cuối cùng cô cũng trở về nhà.',
        },
      });
    });

    expect(screen.getByLabelText('Nội dung truyện đã dịch')).toHaveValue(
      'Ánh trăng rất đẹp, cuối cùng cô cũng trở về nhà.',
    );

    act(() => {
      harness.emit({
        jobId: 'job-1',
        type: 'job-completed',
        timestamp: 3,
        payload: {
          translatedText: 'Chương 1: Trở về\n\nÁnh trăng rất đẹp, cuối cùng cô cũng trở về nhà.',
          job: {
            status: 'completed',
            segments: [{ id: 'segment-1', index: 0, status: 'completed' }],
          },
        },
      });
    });

    expect(await screen.findByText('Dịch hoàn tất')).toBeInTheDocument();
    expect(screen.getByLabelText('Nội dung truyện đã dịch')).toHaveValue(
      'Chương 1: Trở về\n\nÁnh trăng rất đẹp, cuối cùng cô cũng trở về nhà.',
    );
    expect(screen.getByText('1/1 đoạn · 100%')).toBeInTheDocument();
  });

  it('chia checkpoint đã dịch song song và giữ nút tiếp tục đúng đoạn khi phần sau lỗi', async () => {
    const harness = installStoryTool({ connectionStatus: 'ready' });
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Nội dung tiếng Trung cần dịch'), {
      target: { value: '第一段。第二段。' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu dịch' }));
    await waitFor(() => expect(harness.startTranslation).toHaveBeenCalledOnce());

    const firstOutput = 'Chương 1: Checkpoint\n\nPhần đầu đã được dịch, kiểm tra và lưu an toàn trước khi phần sau tiếp tục.';
    act(() => {
      harness.emit({
        jobId: 'job-1',
        type: 'job-created',
        timestamp: 1,
        payload: { job: { status: 'running', segments: [
          { id: 'segment-1', index: 0, status: 'queued' },
          { id: 'segment-2', index: 1, status: 'queued' },
        ] } },
      });
      harness.emit({
        jobId: 'job-1',
        type: 'segment-completed',
        timestamp: 2,
        payload: {
          segment: { id: 'segment-1', index: 0, status: 'completed', translatedText: firstOutput },
          translatedText: firstOutput,
        },
      });
    });

    expect(screen.getByLabelText('Nội dung truyện đã dịch')).toHaveValue(firstOutput);
    await waitFor(() => {
      expect(screen.getByText(/Đã checkpoint & chia tạm 1 chương/)).toBeInTheDocument();
    }, { timeout: 5_000 });

    act(() => {
      harness.emit({
        jobId: 'job-1',
        type: 'segment-failed',
        timestamp: 3,
        payload: {
          segment: { id: 'segment-2', index: 1, status: 'failed', error: 'Mất kết nối ChatGPT.' },
          error: 'Đoạn 2 cần tiếp tục.',
        },
      });
    });
    expect(await screen.findByRole('button', { name: /Tiếp tục từ đoạn lỗi/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Nội dung truyện đã dịch')).toHaveValue(firstOutput);
  });

  it('xuất ngay chương đã có ranh giới chắc chắn, giữ chương cuối tạm thời rồi xuất nó khi job hoàn tất', async () => {
    const first = Array.from({ length: 800 }, (_, index) => `mot${index + 1}`).join(' ');
    const partialSecond = Array.from({ length: 40 }, (_, index) => `hai${index + 1}`).join(' ');
    const completedSecond = Array.from({ length: 800 }, (_, index) => `hai${index + 1}`).join(' ');
    const harness = installStoryTool({
      draft: {
        source: '原文', output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1/', exportDirectory: 'D:\\Truyện đã dịch',
        autoExportJobId: 'job-checkpoint', exportedRecords: [],
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });

    const runningOutput = `Chương 1: Đã khóa\n${first}\n\nChương 2: Đang dịch\n${partialSecond}`;
    act(() => {
      harness.emit({
        jobId: 'job-checkpoint', type: 'job-created', timestamp: 1,
        payload: { job: { status: 'running', segments: [] } },
      });
      harness.emit({
        jobId: 'job-checkpoint', type: 'job-progress', timestamp: 2,
        payload: { status: 'running', totalSegments: 2, completedSegments: 1, translatedText: runningOutput },
      });
    });

    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledOnce());
    expect(harness.exportChapters.mock.calls[0]?.[0]).toMatchObject({
      directory: 'D:\\Truyện đã dịch',
      chapters: [expect.objectContaining({ index: 1, title: 'Chương 1: Đã khóa', wordCount: 800 })],
    });
    expect((harness.exportChapters.mock.calls[0]?.[0] as { chapters: Array<{ title: string }> }).chapters)
      .not.toContainEqual(expect.objectContaining({ title: 'Chương 2: Đang dịch' }));

    act(() => harness.emit({
      jobId: 'job-checkpoint', type: 'job-completed', timestamp: 3,
      payload: {
        translatedText: `Chương 1: Đã khóa\n${first}\n\nChương 2: Đang dịch\n${completedSecond}`,
        job: { status: 'completed', segments: [
          { id: 's1', index: 0, status: 'completed' },
          { id: 's2', index: 1, status: 'completed' },
        ] },
      },
    }));

    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledTimes(2));
    expect(harness.exportChapters.mock.calls[1]?.[0]).toMatchObject({
      // Terminal publication reconciles the full sequence, not merely the
      // new tail. This also recreates any TXT lost before a Retry/restart.
      chapters: [
        expect.objectContaining({ index: 1, title: 'Chương 1: Đã khóa', wordCount: 800 }),
        expect.objectContaining({ index: 2, title: 'Chương 2: Đang dịch', wordCount: 800 }),
      ],
    });
  });

  it('hiện tiếp tục từ checkpoint khi job lỗi trước lúc một đoạn được gửi', async () => {
    const resumeTranslation = vi.fn(async () => undefined);
    const failedCheckpoint: TranslationJobSnapshot = {
      id: 'job-setup-failure', updatedAt: '2026-08-13T01:00:00.000Z', status: 'failed',
      totalSegments: 2, completedSegments: 1, translatedText: 'checkpoint', error: 'setup failed',
      segments: [{ id: 's1', index: 0, status: 'completed' }, { id: 's2', index: 1, status: 'queued' }],
    };
    const harness = installStoryTool({
      draft: {
        source: '原文', output: 'Chương 1: Đã dịch\nNội dung checkpoint.', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1/', exportDirectory: 'D:\\Truyện đã dịch',
        autoExportJobId: 'job-setup-failure', exportedRecords: [],
      },
      activeTranslations: [failedCheckpoint],
      translationJob: {
        id: 'job-setup-failure', updatedAt: '2026-08-13T01:00:00.000Z', status: 'failed',
        totalSegments: 2, completedSegments: 1,
        translatedText: 'Chương 1: Đã dịch\nNội dung checkpoint.',
        error: 'Không tìm thấy lệnh Xóa.',
        segments: [
          { id: 's1', index: 0, status: 'completed' },
          { id: 's2', index: 1, status: 'queued' },
        ],
      },
    });
    harness.api.resumeTranslation = resumeTranslation;
    render(<App />);

    const history = await screen.findByText(/Lịch sử checkpoint cần xử lý/u);
    fireEvent.click(history);
    const button = await screen.findByRole('button', { name: 'Bắt đầu từ CP lỗi' });
    fireEvent.click(button);
    await waitFor(() => expect(resumeTranslation).toHaveBeenCalledWith('job-setup-failure'));
  });

  it('hiện tiếp tục trong lịch sử cho checkpoint đã hủy còn đoạn chờ', async () => {
    const cancelledCheckpoint: TranslationJobSnapshot = {
      id: 'job-cancelled-checkpoint', updatedAt: '2026-08-15T10:39:36.987Z', status: 'cancelled',
      totalSegments: 3, completedSegments: 1, translatedText: 'Phần đầu đã dịch.',
      segments: [
        { id: 's1', index: 0, status: 'completed' },
        { id: 's2', index: 1, status: 'cancelled' },
        { id: 's3', index: 2, status: 'queued' },
      ],
    };
    const harness = installStoryTool({ activeTranslations: [cancelledCheckpoint] });
    const resumeTranslation = vi.fn(async () => undefined);
    harness.api.resumeTranslation = resumeTranslation;
    render(<App />);

    const history = await screen.findByText(/Lịch sử checkpoint cần xử lý/u);
    fireEvent.click(history);
    const resume = await screen.findByRole('button', { name: 'Bắt đầu từ CP lỗi' });
    fireEvent.click(resume);
    await waitFor(() => expect(resumeTranslation).toHaveBeenCalledWith('job-cancelled-checkpoint'));
  });

  it('khôi phục đích xuất của checkpoint đã hủy rồi tiếp tục lưu vào đúng thư mục', async () => {
    const words = Array.from({ length: 820 }, (_, index) => `tu${index + 1}`).join(' ');
    const output = `Chương 3: Mở đầu\n${words}\n\nChương 4: Tiếp theo\n${words}`;
    const binding = {
      directory: 'D:\\Bo-giu-nguyen',
      startChapter: 3,
      endChapter: 4,
      sourceChapterNumbers: [3, 4],
      exportOriginalChapters: true,
      exportCombinedChapters: true,
      omitOutputChapterTitles: true,
    };
    const checkpoint: TranslationJobSnapshot = {
      id: 'job-export-resume', updatedAt: '2026-08-17T10:55:49.000Z', status: 'cancelled',
      totalSegments: 4, completedSegments: 2, translatedText: output, autoExport: binding,
      segments: [
        { id: 's1', index: 0, status: 'completed' },
        { id: 's2', index: 1, status: 'completed' },
        { id: 's3', index: 2, status: 'cancelled' },
        { id: 's4', index: 3, status: 'queued' },
      ],
    };
    const harness = installStoryTool({ activeTranslations: [checkpoint], translationJob: checkpoint });
    const resumeTranslation = vi.fn(async () => undefined);
    harness.api.resumeTranslation = resumeTranslation;
    render(<App />);

    fireEvent.click(await screen.findByText(/Lịch sử checkpoint cần xử lý/u));
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu từ CP lỗi' }));

    await waitFor(() => expect(resumeTranslation).toHaveBeenCalledWith('job-export-resume'));
    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalled());
    expect(harness.exportChapters.mock.calls[0]?.[0]).toMatchObject({
      directory: 'D:\\Bo-giu-nguyen',
      exportJobId: 'job-export-resume',
    });
    expect(harness.exportOriginalChapters.mock.calls[0]?.[0]).toMatchObject({
      directory: 'D:\\Bo-giu-nguyen',
      exportJobId: 'job-export-resume',
    });
  });

  it('tiếp tục đúng đoạn lỗi trực tiếp từ lịch sử checkpoint', async () => {
    const failedCheckpoint: TranslationJobSnapshot = {
      id: 'job-failed-segment-history', updatedAt: '2026-08-15T11:13:33.695Z', status: 'failed',
      totalSegments: 3, completedSegments: 1, translatedText: 'Phần đầu đã dịch.',
      segments: [
        { id: 's1', index: 0, status: 'completed' },
        { id: 's2', index: 1, status: 'failed', error: 'Bị ngắt giữa chừng.' },
        { id: 's3', index: 2, status: 'queued' },
      ],
    };
    const harness = installStoryTool({ activeTranslations: [failedCheckpoint] });
    const retrySegment = vi.fn(async () => undefined);
    harness.api.retrySegment = retrySegment;
    render(<App />);

    fireEvent.click(await screen.findByText(/Lịch sử checkpoint cần xử lý/u));
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu từ CP lỗi' }));
    await waitFor(() => expect(retrySegment).toHaveBeenCalledWith({
      jobId: 'job-failed-segment-history', segmentId: 's2',
    }));
  });

  it('bắt đầu lại đúng tiến trình trong lịch sử, không dùng nút Mở gián tiếp', async () => {
    const checkpoint: TranslationJobSnapshot = {
      id: 'job-restart-history', updatedAt: '2026-08-15T11:13:33.695Z', status: 'failed',
      totalSegments: 3, completedSegments: 1, segments: [
        { id: 's1', index: 0, status: 'completed' },
        { id: 's2', index: 1, status: 'failed', error: 'Lỗi cũ.' },
      ],
    };
    const harness = installStoryTool({ activeTranslations: [checkpoint] });
    render(<App />);

    fireEvent.click(await screen.findByText(/Lịch sử checkpoint cần xử lý/u));
    expect(screen.queryByRole('button', { name: 'Mở' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu lại từ đầu' }));
    await waitFor(() => expect(harness.restartTranslation).toHaveBeenCalledWith('job-restart-history'));
  });

  it('đồng bộ job hoàn tất khi bỏ lỡ toàn bộ sự kiện IPC', async () => {
    const source = '她终于回到了家。';
    const translatedText = 'Cuối cùng cô cũng đã trở về nhà.';
    const harness = installStoryTool({
      connectionStatus: 'ready',
      translationJob: {
        id: 'job-1',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:02.000Z',
        status: 'completed',
        totalSegments: 1,
        completedSegments: 1,
        translatedText,
        segments: [{
          id: 'segment-1',
          index: 0,
          status: 'completed',
        }],
      },
    });
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Nội dung tiếng Trung cần dịch'), {
      target: { value: source },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu dịch' }));

    await waitFor(() => expect(harness.getTranslation).toHaveBeenCalledWith('job-1'));
    expect(await screen.findByText('Dịch hoàn tất')).toBeInTheDocument();
    expect(screen.getByLabelText('Nội dung truyện đã dịch')).toHaveValue(translatedText);
    expect(screen.getByText('1/1 đoạn · 100%')).toBeInTheDocument();
  });

  it('khôi phục job đang chạy sau khi renderer được nạp lại và bỏ qua job failed cũ', async () => {
    const runningJob: TranslationJobSnapshot = {
      id: 'job-running',
      updatedAt: '2026-08-12T00:00:02.000Z',
      status: 'running',
      totalSegments: 2,
      completedSegments: 1,
      translatedText: 'Phần checkpoint đã hoàn tất trước khi cửa sổ được mở lại.',
      currentSegmentIndex: 1,
      segments: [
        { id: 'segment-1', index: 0, status: 'completed' },
        { id: 'segment-2', index: 1, status: 'streaming' },
      ],
    };
    const failedJob: TranslationJobSnapshot = {
      id: 'job-failed',
      updatedAt: '2026-08-12T00:00:03.000Z',
      status: 'failed',
      totalSegments: 1,
      completedSegments: 0,
      segments: [{ id: 'failed-segment', index: 0, status: 'failed', error: 'Lỗi cũ' }],
      error: 'Job cũ đã lỗi',
    };
    const harness = installStoryTool({
      activeTranslations: [failedJob, runningJob],
      translationJob: runningJob,
    });

    render(<App />);

    expect(await screen.findByText('ChatGPT đang dịch')).toBeInTheDocument();
    expect(screen.getByText('1/2 đoạn · 50%')).toBeInTheDocument();
    expect(screen.getByLabelText('Nội dung truyện đã dịch')).toHaveValue(
      'Phần checkpoint đã hoàn tất trước khi cửa sổ được mở lại.',
    );
    await waitFor(() => expect(harness.getTranslation).toHaveBeenCalledWith('job-running'));
  });

  it('giữ checkpoint tạm dừng để tiếp tục hoặc hủy khi lượt dịch link mới bị chặn', async () => {
    const pausedJob: TranslationJobSnapshot = {
      id: 'job-paused-existing',
      updatedAt: '2026-08-14T00:33:03.000Z',
      status: 'paused',
      totalSegments: 36,
      completedSegments: 0,
      currentSegmentIndex: 0,
      segments: [
        { id: 'segment-1', index: 0, status: 'streaming' },
        { id: 'segment-2', index: 1, status: 'queued' },
      ],
    };
    const storyAnalysis = {
      analysisId: 'new-selection', site: 'timotxt' as const, inputKind: 'book' as const,
      inputUrl: 'https://www.timotxt.com/1509589610/', bookId: '1509589610', bookTitle: 'Bộ chương mới',
      bookUrl: 'https://www.timotxt.com/1509589610/', catalogUrl: 'https://www.timotxt.com/1509589610/dir',
      chapters: [
        { id: 'new-c1', order: 0, number: 101, numberLabel: 'Chương 101', title: 'Chương mới', url: 'https://www.timotxt.com/1509589610/101.html', partUrls: ['https://www.timotxt.com/1509589610/101.html'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['new-c1'], verification: 'not-needed' as const, notices: [],
    };
    const harness = installStoryTool({
      connectionStatus: 'ready',
      activeTranslations: [pausedJob],
      translationJob: pausedJob,
      storyAnalysis,
      storyFetch: {
        analysisId: storyAnalysis.analysisId, site: 'timotxt', bookId: storyAnalysis.bookId,
        bookTitle: storyAnalysis.bookTitle, chapters: [], combinedSource: 'Chương 101: Chương mới\n\n原文。', warnings: [],
      },
    });
    harness.startTranslation.mockRejectedValueOnce(new Error('Hãy hoàn tất hoặc hủy tác vụ dịch hiện tại trước.'));
    render(<App />);

    await screen.findByRole('button', { name: 'Tiếp tục' });
    fireEvent.click(screen.getByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: storyAnalysis.inputUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));
    await screen.findByText(storyAnalysis.bookTitle);
    fireEvent.click(screen.getByRole('button', { name: /Chọn thư mục lưu/u }));
    await waitFor(() => expect(harness.chooseChapterDirectory).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /^Kết nối$/u }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: /Tải, dịch và lưu/u }));

    await waitFor(() => expect(harness.startTranslation).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Hãy hoàn tất hoặc hủy tác vụ dịch hiện tại trước/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Hủy' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    await waitFor(() => expect(harness.cancelTranslation).toHaveBeenCalledWith('job-paused-existing'));
  });

  it('phân tích link bộ truyện, chọn mặc định toàn bộ chương và gửi đúng nội dung đã tải', async () => {
    const storyAnalysis = {
      analysisId: 'analysis-1',
      site: 'qingrenyouxi' as const,
      inputKind: 'book' as const,
      inputUrl: 'https://www.qingrenyouxi.com/book/114551.html',
      bookId: '114551',
      bookTitle: '七零新婚夜',
      bookUrl: 'https://www.qingrenyouxi.com/book/114551.html',
      catalogUrl: 'https://www.qingrenyouxi.com/book/114551.html',
      chapters: [
        { id: 'intro', order: 0, numberLabel: '', title: '内容简介', url: 'https://example/intro', partUrls: ['https://example/intro'], isIntroduction: true, selectedByDefault: false },
        { id: 'c1', order: 1, number: 1, numberLabel: '第1章', title: '重回新婚夜', url: 'https://example/1', partUrls: ['https://example/1'], isIntroduction: false, selectedByDefault: true },
        { id: 'c2', order: 2, number: 2, numberLabel: '第2章', title: '想退婚还来得及', url: 'https://example/2', partUrls: ['https://example/2'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['c1', 'c2'],
      verification: 'not-needed' as const,
      notices: [],
    };
    const combinedSource = '第1章 重回新婚夜\n\n第一章内容。\n\n第2章 想退婚还来得及\n\n第二章内容。';
    const harness = installStoryTool({
      connectionStatus: 'ready',
      storyAnalysis,
      storyFetch: {
        analysisId: 'analysis-1',
        site: 'qingrenyouxi',
        bookId: '114551',
        bookTitle: '七零新婚夜',
        chapters: [],
        combinedSource,
        warnings: [],
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: storyAnalysis.inputUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /Phân tích/i }));

    expect(await screen.findByText('七零新婚夜')).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === '2 chương đã chọn')).toBeInTheDocument();
    expect(screen.getByText('内容简介')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Chọn thư mục lưu/i }));
    await waitFor(() => expect(harness.chooseChapterDirectory).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: /Tải, dịch và lưu/i }));

    await waitFor(() => expect(harness.fetchStoryChapters).toHaveBeenCalledWith({
      analysisId: 'analysis-1',
      chapterIds: expect.arrayContaining(['c1', 'c2']),
    }));
    await waitFor(() => expect(harness.startTranslation).toHaveBeenCalledWith(expect.objectContaining({
      source: combinedSource,
    })));
  });

  it('chặn tải và tạo job khi thư mục export từ draft không còn tồn tại', async () => {
    const storyAnalysis = {
      analysisId: 'analysis-missing-directory', site: 'xbanxia' as const, inputKind: 'chapter' as const,
      inputUrl: 'https://www.xbanxia.cc/books/420871/73048292.html', bookId: '420871', bookTitle: 'Kiểm tra thư mục',
      bookUrl: 'https://www.xbanxia.cc/books/420871.html', catalogUrl: 'https://www.xbanxia.cc/books/420871.html',
      chapters: [{ id: 'c1', order: 0, number: 1, numberLabel: '第1章', title: 'Mở đầu', url: 'https://www.xbanxia.cc/books/420871/73048292.html', partUrls: ['https://www.xbanxia.cc/books/420871/73048292.html'], isIntroduction: false, selectedByDefault: true }],
      defaultSelectedChapterIds: ['c1'], verification: 'not-needed' as const, notices: [],
    };
    const harness = installStoryTool({
      connectionStatus: 'ready',
      storyAnalysis,
      storyFetch: { analysisId: storyAnalysis.analysisId, site: 'xbanxia', bookId: '420871', bookTitle: storyAnalysis.bookTitle, chapters: [], combinedSource: 'Không được tải.', warnings: [] },
      draft: {
        source: '', output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link', storyUrl: storyAnalysis.inputUrl,
        exportDirectory: 'D:\\Đã mất', autoExportJobId: '', exportedRecords: [], originalExportedRecords: [],
      },
    });
    harness.validateChapterDirectory.mockRejectedValueOnce(new Error('Không tìm thấy thư mục xuất; không thể bắt đầu dịch. Thư mục xuất không tồn tại.'));
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));
    await screen.findByText(storyAnalysis.bookTitle);
    fireEvent.click(screen.getByRole('button', { name: /^Kết nối$/u }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: /Tải, dịch và lưu/u }));

    expect(await screen.findByText(/Không tìm thấy thư mục xuất; không thể bắt đầu dịch/u)).toBeInTheDocument();
    expect(harness.fetchStoryChapters).not.toHaveBeenCalled();
    expect(harness.startTranslation).not.toHaveBeenCalled();
  });

  it('kết nối trình duyệt mặc định cho Huliwang rồi tự phân tích lại link', async () => {
    const huliwangUrl = 'https://m.huliwang.net/1703891/1.html';
    const harness = installStoryTool();
    harness.analyzeStoryUrl.mockRejectedValueOnce(new Error(
      'Cloudflare chỉ chấp nhận phiên trình duyệt thông thường.',
    )).mockResolvedValueOnce({
      analysisId: 'huli-paired',
      site: 'huliwang',
      inputKind: 'chapter',
      inputUrl: huliwangUrl,
      bookId: '1703891',
      bookTitle: 'Truyện Huliwang đã kết nối',
      bookUrl: 'https://m.huliwang.net/1703891/',
      catalogUrl: 'https://m.huliwang.net/dir/1703891.html',
      chapters: [{
        id: 'huliwang:1703891:1', order: 0, number: 1, numberLabel: 'Chương 1', title: 'Mở đầu',
        url: huliwangUrl, partUrls: [huliwangUrl], isIntroduction: false, selectedByDefault: true,
      }],
      defaultSelectedChapterIds: ['huliwang:1703891:1'],
      verification: 'not-needed',
      notices: [],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: huliwangUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));

    const connectDefaultBrowser = await screen.findByRole('button', { name: 'Kết nối trình duyệt mặc định' });
    expect(screen.getByText('Huliwang cần Microsoft Edge hoặc Google Chrome và profile bạn dùng hằng ngày.')).toBeInTheDocument();
    expect(screen.getByText(/edge:\/\/extensions[\s\S]*chrome:\/\/extensions/iu)).toBeInTheDocument();
    expect(screen.getByText(/Tool không dùng Cốc Cốc cho bước này/u)).toBeInTheDocument();
    expect(screen.getByText(/Huli Browser Helper nằm ngay cạnh ToolDichTruyen\.exe/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở thư mục tiện ích' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chuyển sang Dán nội dung' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mở thư mục tiện ích' }));
    await waitFor(() => expect(harness.revealHuliBrowserHelper).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Đã mở thư mục tiện ích Huliwang/u)).toBeInTheDocument();

    fireEvent.click(connectDefaultBrowser);
    await waitFor(() => expect(harness.openManualStoryVerification).toHaveBeenCalledWith(huliwangUrl));
    await waitFor(() => expect(harness.analyzeStoryUrl).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Truyện Huliwang đã kết nối')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kết nối trình duyệt mặc định' })).not.toBeInTheDocument();
  });

  it('kết nối trình duyệt mặc định cho XSZJ rồi tự phân tích lại link', async () => {
    const xszjUrl = 'https://xszj.org/b/485734';
    const harness = installStoryTool();
    harness.analyzeStoryUrl.mockRejectedValueOnce(new Error(
      'XSZJ/爱下电子书 yêu cầu xác minh thủ công trong trình duyệt mặc định.',
    )).mockResolvedValueOnce({
      analysisId: 'xszj-paired',
      site: 'xszj',
      inputKind: 'book',
      inputUrl: xszjUrl,
      bookId: '485734',
      bookTitle: 'Truyện XSZJ đã kết nối',
      bookUrl: xszjUrl,
      catalogUrl: 'https://xszj.org/b/485734/cs/1',
      chapters: [{
        id: 'xszj:485734:856451', order: 0, number: 1, numberLabel: 'Chương 1', title: 'Mở đầu',
        url: 'https://xszj.org/b/485734/c/856451', partUrls: ['https://xszj.org/b/485734/c/856451'], isIntroduction: false, selectedByDefault: true,
      }],
      defaultSelectedChapterIds: ['xszj:485734:856451'],
      verification: 'not-needed',
      notices: [],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: xszjUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));

    expect(await screen.findByText('XSZJ/爱下电子书 cần Microsoft Edge hoặc Google Chrome và profile bạn dùng hằng ngày.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kết nối trình duyệt mặc định' }));
    await waitFor(() => expect(harness.openManualStoryVerification).toHaveBeenCalledWith(xszjUrl));
    await waitFor(() => expect(harness.analyzeStoryUrl).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Truyện XSZJ đã kết nối')).toBeInTheDocument();
  });

  it('offers default browser pairing when the Huli helper version is stale', async () => {
    const huliwangUrl = 'https://m.huliwang.net/1703891/1.html';
    const harness = installStoryTool();
    harness.analyzeStoryUrl.mockRejectedValueOnce(new Error(
      'Huli Browser Helper needs Reload version 1.0.2.',
    ));
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: huliwangUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));

    expect(await screen.findByText(/Huli Browser Helper needs Reload version 1\.0\.2/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kết nối trình duyệt mặc định' })).toBeInTheDocument();
  });

  it('khóa thao tác xung đột trong lúc chờ tiện ích trình duyệt ghép nối', async () => {
    const huliwangUrl = 'https://m.huliwang.net/1703891/1.html';
    let finishPairing: (() => void) | undefined;
    const pairing = new Promise<void>((resolve) => { finishPairing = resolve; });
    const harness = installStoryTool();
    harness.analyzeStoryUrl.mockRejectedValue(new Error('Cloudflare đang kiểm tra trình duyệt.'));
    harness.openManualStoryVerification.mockReturnValueOnce(pairing);
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: huliwangUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kết nối trình duyệt mặc định' }));

    expect(await screen.findByText('Đang chờ trình duyệt mặc định kết nối…')).toBeInTheDocument();
    expect(screen.getByLabelText('Link bộ truyện hoặc chương truyện')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Phân tích$/u })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chuyển sang Dán nội dung' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Dán nội dung' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mở thư mục tiện ích' })).toBeEnabled();

    await act(async () => { finishPairing?.(); });
    await waitFor(() => expect(harness.analyzeStoryUrl).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Kết nối trình duyệt mặc định' })).toBeEnabled();
  });

  it('báo rõ khi hết thời gian chờ tiện ích trình duyệt', async () => {
    const huliwangUrl = 'https://m.huliwang.net/1703891/1.html';
    const harness = installStoryTool();
    harness.analyzeStoryUrl.mockRejectedValueOnce(new Error('Cloudflare đang kiểm tra trình duyệt.'));
    harness.openManualStoryVerification.mockRejectedValueOnce(new Error(
      'Hết thời gian chờ kết nối tiện ích Huliwang. Hãy kiểm tra tiện ích đã được cài trong trình duyệt mặc định rồi thử lại.',
    ));
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: huliwangUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kết nối trình duyệt mặc định' }));

    expect(await screen.findByText(/Hết thời gian chờ kết nối tiện ích Huliwang/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kết nối trình duyệt mặc định' })).toBeEnabled();
    expect(harness.analyzeStoryUrl).toHaveBeenCalledTimes(1);
  });

  it('không hiện nút Edge thủ công cho lỗi Cloudflare ở website khác', async () => {
    const harness = installStoryTool();
    harness.analyzeStoryUrl.mockRejectedValueOnce(new Error('Cloudflare chưa hoàn tất xác minh thụ động.'));
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: 'https://www.timotxt.com/1509589610/13.html' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));

    await screen.findByText(/Cloudflare chưa hoàn tất xác minh thụ động/u);
    expect(screen.queryByRole('button', { name: 'Kết nối trình duyệt mặc định' })).not.toBeInTheDocument();
  });

  it('hiện lại kết nối trình duyệt khi companion Huliwang mất giữa lúc tải', async () => {
    const huliwangUrl = 'https://m.huliwang.net/1703891/1.html';
    const storyAnalysis = {
      analysisId: 'huli-disconnected', site: 'huliwang' as const, inputKind: 'chapter' as const,
      inputUrl: huliwangUrl, bookId: '1703891', bookTitle: 'Huliwang',
      bookUrl: 'https://m.huliwang.net/1703891/', catalogUrl: 'https://m.huliwang.net/dir/1703891.html',
      chapters: [{
        id: 'huliwang:1703891:1', order: 0, number: 1, numberLabel: 'Chương 1', title: 'Mở đầu',
        url: huliwangUrl, partUrls: [huliwangUrl], isIntroduction: false, selectedByDefault: true,
      }],
      defaultSelectedChapterIds: ['huliwang:1703891:1'], verification: 'not-needed' as const, notices: [],
    };
    const harness = installStoryTool({ connectionStatus: 'ready', storyAnalysis });
    harness.fetchStoryChapters.mockRejectedValueOnce(new Error(
      'Tiện ích Huliwang mất kết nối với trình duyệt mặc định.',
    ));
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), { target: { value: huliwangUrl } });
    fireEvent.click(screen.getByRole('button', { name: /^Phân tích$/u }));
    expect(await screen.findByText('Huliwang')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Chọn thư mục lưu/i }));
    await waitFor(() => expect(harness.chooseChapterDirectory).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: /Tải, dịch và lưu/i }));

    expect(await screen.findByRole('button', { name: 'Kết nối trình duyệt mặc định' })).toBeEnabled();
    expect(screen.getAllByText(/phân tích lại link/iu).length).toBeGreaterThan(0);
    expect(harness.startTranslation).not.toHaveBeenCalled();
  });

  it('hiển thị hai tùy chọn xuất link mặc định bật và lưu lựa chọn tắt vào draft', async () => {
    const storyAnalysis = {
      analysisId: 'export-options-default', site: 'timotxt' as const, inputKind: 'chapter' as const,
      inputUrl: 'https://www.timotxt.com/1509589610/13.html', bookId: '1509589610', bookTitle: 'Tùy chọn xuất',
      bookUrl: 'https://www.timotxt.com/1509589610/', catalogUrl: 'https://www.timotxt.com/1509589610/dir',
      chapters: [
        { id: 'c13', order: 1, number: 13, numberLabel: 'Chương 13', title: 'Gặp lại', url: 'https://www.timotxt.com/1509589610/13.html', partUrls: ['https://www.timotxt.com/1509589610/13.html'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['c13'], verification: 'not-needed' as const, notices: [],
    };
    const harness = installStoryTool({ storyAnalysis });
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: storyAnalysis.inputUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /Phân tích/i }));
    await screen.findByText(storyAnalysis.bookTitle);

    const originalCopy = screen.getByRole('checkbox', { name: /Lưu chương dịch gốc chưa chia/i });
    const combinedFile = screen.getByRole('checkbox', { name: /Xuất file tổng hợp chương đã chia/i });
    // Existing drafts have no option fields.  They must receive the new
    // default rather than silently losing either export format.
    expect(originalCopy).toBeChecked();
    expect(combinedFile).toBeChecked();

    fireEvent.click(originalCopy);
    fireEvent.click(combinedFile);
    expect(originalCopy).not.toBeChecked();
    expect(combinedFile).not.toBeChecked();

    await waitFor(() => {
      const savedDrafts = vi.mocked(harness.api.saveDraft).mock.calls.map(([draft]) => draft as {
        exportOriginalChapters?: boolean;
        exportCombinedChapters?: boolean;
      });
      expect(savedDrafts.some((draft) => (
        draft.exportOriginalChapters === false && draft.exportCombinedChapters === false
      ))).toBe(true);
    });
  });

  it('khôi phục các tùy chọn xuất link đã lưu trong draft', async () => {
    const storyAnalysis = {
      analysisId: 'export-options-saved', site: 'timotxt' as const, inputKind: 'chapter' as const,
      inputUrl: 'https://www.timotxt.com/1509589610/14.html', bookId: '1509589610', bookTitle: 'Tùy chọn đã lưu',
      bookUrl: 'https://www.timotxt.com/1509589610/', catalogUrl: 'https://www.timotxt.com/1509589610/dir',
      chapters: [
        { id: 'c14', order: 1, number: 14, numberLabel: 'Chương 14', title: 'Tiếp theo', url: 'https://www.timotxt.com/1509589610/14.html', partUrls: ['https://www.timotxt.com/1509589610/14.html'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['c14'], verification: 'not-needed' as const, notices: [],
    };
    installStoryTool({
      storyAnalysis,
      draft: {
        sourceMode: 'link',
        storyUrl: storyAnalysis.inputUrl,
        exportOriginalChapters: false,
        exportCombinedChapters: false,
      },
    });
    render(<App />);

    await screen.findByDisplayValue(storyAnalysis.inputUrl);
    fireEvent.click(screen.getByRole('button', { name: /Phân tích/i }));
    await screen.findByText(storyAnalysis.bookTitle);

    expect(screen.getByRole('checkbox', { name: /Lưu chương dịch gốc chưa chia/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Xuất file tổng hợp chương đã chia/i })).not.toBeChecked();
  });

  it('hiển thị Xbanxia như nguồn thứ tư và không chọn mục tác phẩm liên quan', async () => {
    const storyAnalysis = {
      analysisId: 'xbanxia-analysis',
      site: 'xbanxia' as const,
      inputKind: 'book' as const,
      inputUrl: 'https://www.xbanxia.cc/books/143300.html',
      bookId: '143300',
      bookTitle: '嫁給殘疾皇子後',
      author: '李寂v5',
      bookUrl: 'https://www.xbanxia.cc/books/143300.html',
      catalogUrl: 'https://www.xbanxia.cc/books/143300.html',
      chapters: [
        { id: 'related', order: 0, numberLabel: '作品相關', title: '作品相關', url: 'https://www.xbanxia.cc/books/143300/28251880.html', partUrls: ['https://www.xbanxia.cc/books/143300/28251880.html'], isIntroduction: true, selectedByDefault: false },
        { id: 'chapter-1', order: 1, number: 1, numberLabel: '第1章', title: '替婚', url: 'https://www.xbanxia.cc/books/143300/28251886.html', partUrls: ['https://www.xbanxia.cc/books/143300/28251886.html'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['chapter-1'],
      verification: 'not-needed' as const,
      notices: [],
    };
    installStoryTool({ storyAnalysis });
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    expect(screen.getByPlaceholderText(/Xbanxia/u)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: storyAnalysis.inputUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /Phân tích/i }));

    expect(await screen.findByText('嫁給殘疾皇子後')).toBeInTheDocument();
    expect(screen.getByText(/Xbanxia · 1 chương · 李寂v5/u)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === '1 chương đã chọn')).toBeInTheDocument();
    expect((screen.getAllByText('作品相關')[0]?.closest('label')?.querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByText('替婚').closest('label')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });

  it('chọn khoảng theo vị trí mục lục dù số chương bị nhảy và có phần giới thiệu', async () => {
    const storyAnalysis = {
      analysisId: 'range-analysis', site: 'timotxt' as const, inputKind: 'book' as const,
      inputUrl: 'https://www.timotxt.com/book123/', bookId: 'book123', bookTitle: 'Truyện range',
      bookUrl: 'https://www.timotxt.com/book123/', catalogUrl: 'https://www.timotxt.com/book123/dir',
      chapters: [
        { id: 'intro', order: 0, numberLabel: '', title: 'Nội dung giới thiệu', url: 'https://x/intro', partUrls: ['https://x/intro'], isIntroduction: true, selectedByDefault: false },
        { id: 'c10', order: 1, number: 10, numberLabel: 'Chương 10', title: 'A', url: 'https://x/10', partUrls: ['https://x/10'], isIntroduction: false, selectedByDefault: true },
        { id: 'c99', order: 2, number: 99, numberLabel: 'Chương 99', title: 'B', url: 'https://x/99', partUrls: ['https://x/99'], isIntroduction: false, selectedByDefault: true },
        { id: 'cx', order: 3, numberLabel: 'Ngoại truyện', title: 'C', url: 'https://x/x', partUrls: ['https://x/x'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['c10', 'c99', 'cx'], verification: 'not-needed' as const, notices: [],
    };
    installStoryTool({ storyAnalysis });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: storyAnalysis.inputUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /Phân tích/i }));
    await screen.findByText('Truyện range');
    fireEvent.change(screen.getByLabelText('Từ chương'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Đến chương'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    expect(screen.getByText((_content, element) => element?.textContent === '2 chương đã chọn')).toBeInTheDocument();
    expect((screen.getByText('A').closest('label')?.querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByText('B').closest('label')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByText('C').closest('label')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
  });

  it('tự chia 750–800 chữ và xuất từng TXT sau khi job link hoàn tất', async () => {
    const words = Array.from({ length: 1500 }, (_, index) => `tu${index + 1}`)
      .reduce((lines, word, index) => {
        const line = Math.floor(index / 10);
        lines[line] = `${lines[line] ?? ''}${lines[line] ? ' ' : ''}${word}`;
        return lines;
      }, [] as string[])
      .join('\n');
    const harness = installStoryTool({
      draft: {
        source: '原文',
        output: '',
        promptMode: 'period',
        customPrompt: '',
        sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1/',
        exportDirectory: 'D:\\Truyện đã dịch',
        autoExportJobId: 'job-web',
        exportedRecords: [],
        splitConfig: {
          targetWords: 800,
          prefix: '',
          suffix: '',
          startIndex: 1,
          inputLanguage: 'vi',
          autoDetectTitle: false,
        },
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });

    act(() => {
      harness.emit({
        jobId: 'job-web',
        type: 'job-completed',
        timestamp: 4,
        payload: {
          translatedText: `Chương 1: Hôm nay anh đã về\n${words}`,
          job: { status: 'completed', segments: [{ id: 's1', index: 0, status: 'completed' }] },
        },
      });
    });

    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledOnce());
    const request = harness.exportChapters.mock.calls[0]?.[0] as {
      directory: string;
      chapters: Array<{ title: string; wordCount: number }>;
    };
    expect(request.directory).toBe('D:\\Truyện đã dịch');
    expect(request.chapters).toHaveLength(2);
    expect(request.chapters.every((chapter) => chapter.wordCount >= 750 && chapter.wordCount <= 800)).toBe(true);
    expect(request.chapters.map((chapter) => chapter.title)).toEqual([
      'Chương 1: Hôm nay anh đã về',
      'Chương 2: Hôm nay anh đã về',
    ]);
  });

  it('khôi phục job link đã hoàn tất sau khi mở lại app và tiếp tục lưu file', async () => {
    const first = Array.from({ length: 750 }, (_, index) => `mot${index}`).join(' ');
    const second = Array.from({ length: 750 }, (_, index) => `hai${index}`).join(' ');
    const translatedText = `Chương 5: Gặp lại\n${first}\n\n${second}`;
    const harness = installStoryTool({
      draft: {
        source: '原文',
        output: '',
        promptMode: 'period',
        customPrompt: '',
        sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/13.html',
        exportDirectory: 'D:\\Truyện đã dịch',
        autoExportJobId: 'job-restart',
        exportedRecords: [],
      },
      translationJob: {
        id: 'job-restart',
        updatedAt: '2026-08-12T01:00:00.000Z',
        status: 'completed',
        totalSegments: 1,
        completedSegments: 1,
        segments: [{ id: 'segment-1', index: 0, status: 'completed' }],
        translatedText,
      },
    });

    render(<App />);

    await waitFor(() => expect(harness.getTranslation).toHaveBeenCalledWith('job-restart'));
    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledOnce());
    expect(harness.exportChapters.mock.calls[0]?.[0]).toMatchObject({
      directory: 'D:\\Truyện đã dịch',
      chapters: [
        expect.objectContaining({ index: 5, title: 'Chương 5: Gặp lại', wordCount: 750 }),
        expect.objectContaining({ index: 6, title: 'Chương 6: Gặp lại', wordCount: 750 }),
      ],
    });
  });

  it('dò checkpoint khi app đóng trước lúc renderer nhận jobId', async () => {
    const startedAt = Date.parse('2026-08-12T02:00:00.000Z');
    const translatedText = `Chương 1: Khôi phục\n${Array.from({ length: 750 }, (_, i) => `tu${i}`).join(' ')}`;
    const completedJob: TranslationJobSnapshot = {
      id: 'job-discovered',
      createdAt: '2026-08-12T02:00:01.000Z',
      updatedAt: '2026-08-12T02:01:00.000Z',
      status: 'completed',
      totalSegments: 1,
      completedSegments: 1,
      segments: [{ id: 's1', index: 0, status: 'completed' }],
      translatedText,
    };
    const harness = installStoryTool({
      activeTranslations: [completedJob],
      draft: {
        source: '原文', output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/',
        exportDirectory: 'D:\\Truyện đã dịch',
        autoExportJobId: 'pending', autoExportStartedAt: startedAt, exportedRecords: [],
      },
    });

    render(<App />);

    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledOnce());
    expect(harness.exportChapters.mock.calls[0]?.[0]).toMatchObject({
      directory: 'D:\\Truyện đã dịch',
      chapters: [expect.objectContaining({ index: 1, wordCount: 750 })],
    });
  });

  it('xóa cờ chờ auto-export bền vững khi không khởi tạo được job dịch link', async () => {
    const storyAnalysis = {
      analysisId: 'start-failure-analysis', site: 'timotxt' as const, inputKind: 'chapter' as const,
      inputUrl: 'https://www.timotxt.com/1509589610/13.html', bookId: '1509589610', bookTitle: 'Truyện lỗi khởi tạo',
      bookUrl: 'https://www.timotxt.com/1509589610/', catalogUrl: 'https://www.timotxt.com/1509589610/dir',
      chapters: [
        { id: 'c13', order: 1, number: 13, numberLabel: 'Chương 13', title: 'Gặp lại', url: 'https://www.timotxt.com/1509589610/13.html', partUrls: ['https://www.timotxt.com/1509589610/13.html'], isIntroduction: false, selectedByDefault: true },
      ],
      defaultSelectedChapterIds: ['c13'], verification: 'not-needed' as const, notices: [],
    };
    const harness = installStoryTool({
      connectionStatus: 'ready',
      storyAnalysis,
      storyFetch: {
        analysisId: storyAnalysis.analysisId, site: 'timotxt', bookId: storyAnalysis.bookId,
        bookTitle: storyAnalysis.bookTitle, chapters: [], combinedSource: 'Chương 13: Gặp lại\n\n原文。', warnings: [],
      },
    });
    harness.startTranslation.mockRejectedValueOnce(new Error('Không tạo được job thử nghiệm.'));
    render(<App />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Nhập link truyện' }));
    fireEvent.change(screen.getByLabelText('Link bộ truyện hoặc chương truyện'), {
      target: { value: storyAnalysis.inputUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /Phân tích/i }));
    await screen.findByText(storyAnalysis.bookTitle);
    fireEvent.click(screen.getByRole('button', { name: /Chọn thư mục lưu/i }));
    fireEvent.click(screen.getByRole('button', { name: /Kết nối/i }));
    await screen.findByText('ChatGPT đã kết nối');
    fireEvent.click(screen.getByRole('button', { name: /Tải, dịch và lưu/i }));

    expect(await screen.findByText('Không tạo được job thử nghiệm.')).toBeInTheDocument();
    const savedDrafts = vi.mocked(harness.api.saveDraft).mock.calls.map(([draft]) => draft as {
      autoExportJobId?: string;
      autoExportStartedAt?: number;
    });
    expect(savedDrafts.some((draft) => draft.autoExportJobId === 'pending')).toBe(true);
    expect(savedDrafts.some((draft) => draft.autoExportJobId === '' && draft.autoExportStartedAt === 0)).toBe(true);
  });

  it('giữ kết quả export đang chạy khi output thay đổi, không làm mất record', async () => {
    let resolveExport!: (value: Awaited<ReturnType<StoryToolApi['exportChapters']>>) => void;
    const deferred = new Promise<Awaited<ReturnType<StoryToolApi['exportChapters']>>>((resolve) => {
      resolveExport = resolve;
    });
    const harness = installStoryTool({
      draft: {
        source: '原文', output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1/', exportDirectory: 'D:\\Truyện đã dịch',
        autoExportJobId: 'job-export-race', exportedRecords: [],
      },
    });
    const exportSpy = vi.fn(() => deferred);
    harness.api.exportChapters = exportSpy;
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });
    act(() => harness.emit({
      jobId: 'job-export-race', type: 'job-completed', timestamp: 5,
      payload: {
        translatedText: `Chương 1: A\n${Array.from({ length: 750 }, (_, i) => `tu${i}`).join(' ')}`,
        job: { status: 'completed', segments: [{ id: 's1', index: 0, status: 'completed' }] },
      },
    }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Nội dung truyện đã dịch'), { target: { value: 'Bản người dùng vừa sửa' } });
    const pendingExport = exportSpy.mock.calls[0]?.[0];
    const exportedChapter = pendingExport?.chapters[0];
    if (!pendingExport || !exportedChapter) throw new Error('Thiếu yêu cầu xuất checkpoint.');
    resolveExport({
      directory: 'D:\\Truyện đã dịch',
      records: [{
        exportJobId: pendingExport.exportJobId,
        exportDirectory: pendingExport.directory,
        contentHash: chapterContentFingerprint(exportedChapter),
        index: 1,
        title: 'Chương 1 A',
        fileName: 'Chương 1 - A.txt',
        filePath: 'D:\\Truyện đã dịch\\Chương 1 - A.txt',
        wordCount: 750,
        status: 'saved',
      }],
    });

    expect(await screen.findByText(/Đã checkpoint, chia(?: theo đoạn)? và lưu thêm 1 chương/u)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bản người dùng vừa sửa')).toBeInTheDocument();
    expect(exportSpy).toHaveBeenCalledOnce();
  });

  it('only publishes a sealed original translated chapter while running, then emits the trailing chapter on completion', async () => {
    const first = 'Đây là toàn bộ nội dung chương đã hoàn tất, không được cắt ngang lời thoại.';
    const trailing = 'Đây mới chỉ là phần đầu của chương sau nên chưa được phép lưu khi job đang chạy.';
    const completedTrailing = `${trailing}\n\nĐây là phần còn lại khi bản dịch đã hoàn tất.`;
    const harness = installStoryTool({
      draft: {
        source: 'Chương 152: Bản gốc\n\n原文 chương 152.\n\nChương 153: Bản gốc tiếp\n\n原文 chương 153.',
        output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/152.html', exportDirectory: 'D:\\Truyện đã dịch',
        exportOriginalChapters: true, exportCombinedChapters: false,
        autoExportJobId: 'job-original-checkpoint', exportedRecords: [],
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });

    act(() => {
      harness.emit({
        jobId: 'job-original-checkpoint', type: 'job-created', timestamp: 1,
        payload: { job: { status: 'running', segments: [] } },
      });
      harness.emit({
        jobId: 'job-original-checkpoint', type: 'job-progress', timestamp: 2,
        payload: {
          status: 'running',
          translatedText: `Chương 152: Đã khóa\n${first}\n\nChương 153: Đang dịch\n${trailing}`,
        },
      });
    });

    await waitFor(() => expect(harness.exportOriginalChapters).toHaveBeenCalledTimes(1));
    expect(harness.exportOriginalChapters.mock.calls[0]?.[0]).toMatchObject({
      directory: 'D:\\Truyện đã dịch',
      chapters: [expect.objectContaining({
        index: 152,
        title: 'Chương 152: Đã khóa',
        content: first,
      })],
    });
    expect((harness.exportOriginalChapters.mock.calls[0]?.[0] as { chapters: Array<{ index: number }> }).chapters)
      .not.toContainEqual(expect.objectContaining({ index: 153 }));

    act(() => harness.emit({
      jobId: 'job-original-checkpoint', type: 'job-completed', timestamp: 3,
      payload: {
        translatedText: `Chương 152: Đã khóa\n${first}\n\nChương 153: Đang dịch\n${completedTrailing}`,
        job: { status: 'completed', segments: [
          { id: 's1', index: 0, status: 'completed' },
          { id: 's2', index: 1, status: 'completed' },
        ] },
      },
    }));

    await waitFor(() => expect(harness.exportOriginalChapters).toHaveBeenCalledTimes(2));
    expect(harness.exportOriginalChapters.mock.calls[1]?.[0]).toMatchObject({
      chapters: [
        expect.objectContaining({ index: 152, title: 'Chương 152: Đã khóa', content: first }),
        expect.objectContaining({ index: 153, title: 'Chương 153: Đang dịch', content: completedTrailing }),
      ],
    });
  });

  it('creates the terminal combined file from the sealed checkpoint without waiting for a slow split TXT', async () => {
    const first = Array.from({ length: 800 }, (_, index) => `mot${index + 1}`).join(' ');
    const partialSecond = Array.from({ length: 40 }, (_, index) => `hai${index + 1}`).join(' ');
    const second = Array.from({ length: 800 }, (_, index) => `hai${index + 1}`).join(' ');
    let resolveTerminalSplit!: (value: Awaited<ReturnType<StoryToolApi['exportChapters']>>) => void;
    const terminalSplit = new Promise<Awaited<ReturnType<StoryToolApi['exportChapters']>>>((resolve) => {
      resolveTerminalSplit = resolve;
    });
    const harness = installStoryTool({
      draft: {
        source: 'Chương 152: Bản gốc\n\n原文 chương 152.\n\nChương 153: Bản gốc tiếp\n\n原文 chương 153.',
        output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/152.html', exportDirectory: 'D:\\Truyện đã dịch',
        exportOriginalChapters: false, exportCombinedChapters: true,
        autoExportJobId: 'job-combined-after-split', exportedRecords: [],
      },
    });
    let splitCall = 0;
    const exportSplit = vi.fn((request: Parameters<StoryToolApi['exportChapters']>[0]) => {
      splitCall += 1;
      if (splitCall === 2) return terminalSplit;
      return Promise.resolve({
        directory: request.directory,
        records: request.chapters.map((chapter) => ({
          exportJobId: request.exportJobId,
          exportDirectory: request.directory,
          contentHash: chapterContentFingerprint(chapter),
          index: chapter.index,
          title: chapter.title,
          wordCount: chapter.wordCount,
          fileName: `chapter-${chapter.index}.txt`,
          filePath: `${request.directory}\\chapter-${chapter.index}.txt`,
          status: 'saved' as const,
        })),
      });
    });
    harness.api.exportChapters = exportSplit;
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });

    act(() => {
      harness.emit({
        jobId: 'job-combined-after-split', type: 'job-created', timestamp: 1,
        payload: { job: { status: 'running', segments: [] } },
      });
      harness.emit({
        jobId: 'job-combined-after-split', type: 'job-progress', timestamp: 2,
        payload: {
          status: 'running',
          translatedText: `Chương 152: Phần một\n${first}\n\nChương 153: Phần hai\n${partialSecond}`,
        },
      });
    });
    await waitFor(() => expect(exportSplit).toHaveBeenCalledTimes(1));

    act(() => harness.emit({
      jobId: 'job-combined-after-split', type: 'job-completed', timestamp: 3,
      payload: {
        translatedText: `Chương 152: Phần một\n${first}\n\nChương 153: Phần hai\n${second}`,
        job: { status: 'completed', segments: [
          { id: 's1', index: 0, status: 'completed' },
          { id: 's2', index: 1, status: 'completed' },
        ] },
      },
    }));
    await waitFor(() => expect(exportSplit).toHaveBeenCalledTimes(2));
    // The aggregate is independently safe at terminal completion.  It must
    // not disappear merely because one individual TXT is slow or conflicts
    // with an older user file.
    await waitFor(() => expect(harness.exportCombinedChapters).toHaveBeenCalledTimes(1));

    const terminalRequest = exportSplit.mock.calls[1]?.[0];
    const terminalChapter = terminalRequest?.chapters[0];
    if (!terminalRequest || !terminalChapter) throw new Error('Thiếu yêu cầu xuất checkpoint cuối.');
    resolveTerminalSplit({
      directory: 'D:\\Truyện đã dịch',
      records: [{
        exportJobId: terminalRequest.exportJobId,
        exportDirectory: terminalRequest.directory,
        contentHash: chapterContentFingerprint(terminalChapter),
        index: 153,
        title: 'Chương 153: Phần hai',
        wordCount: 800,
        fileName: 'chapter-153.txt',
        filePath: 'D:\\Truyện đã dịch\\chapter-153.txt',
        status: 'saved',
      }],
    });

    expect(harness.exportCombinedChapters).toHaveBeenCalledWith(expect.objectContaining({
      directory: 'D:\\Truyện đã dịch',
      startChapter: 152,
      endChapter: 153,
      chapters: [
        expect.objectContaining({ index: 152, title: 'Chương 152: Phần một', wordCount: 800 }),
        expect.objectContaining({ index: 153, title: 'Chương 153: Phần hai', wordCount: 800 }),
      ],
    }));
  });

  it('retries a transient final combined-file failure after a completed checkpoint', async () => {
    const words = Array.from({ length: 800 }, (_, index) => `tu${index + 1}`).join(' ');
    const harness = installStoryTool({
      draft: {
        source: 'Chương 50: Bản gốc\n\n原文 chương 50.',
        output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/50.html', exportDirectory: 'D:\\Truyện đã dịch',
        exportOriginalChapters: false, exportCombinedChapters: true,
        autoExportJobId: 'job-combined-retry', exportedRecords: [],
      },
    });
    let combinedAttempt = 0;
    harness.api.exportCombinedChapters = harness.exportCombinedChapters = vi.fn(async ({
      directory, exportJobId, startChapter, endChapter, chapters,
    }) => {
      combinedAttempt += 1;
      if (combinedAttempt === 1) throw new Error('Lỗi ghi đĩa tạm thời');
      return {
        directory,
        exportDirectory: directory,
        exportJobId,
        contentHash: combinedChapterContentFingerprint(startChapter, endChapter, chapters),
        fileName: `combined-${startChapter}-${endChapter}.txt`,
        filePath: `${directory}\\combined-${startChapter}-${endChapter}.txt`,
        startChapter,
        endChapter,
        chapterCount: chapters.length,
        status: 'saved' as const,
      };
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });

    act(() => harness.emit({
      jobId: 'job-combined-retry', type: 'job-completed', timestamp: 1,
      payload: {
        translatedText: `Chương 50: Bản dịch\n${words}`,
        job: { status: 'completed', segments: [{ id: 's1', index: 0, status: 'completed' }] },
      },
    }));

    await waitFor(() => expect(harness.exportCombinedChapters).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(harness.exportCombinedChapters).toHaveBeenLastCalledWith(expect.objectContaining({
      exportJobId: 'job-combined-retry', startChapter: 50, endChapter: 50,
    }));
  });

  it('restores an orphaned completed export set and creates its missing final file', async () => {
    const words = Array.from({ length: 800 }, (_, index) => `tu${index + 1}`).join(' ');
    const chapter = { index: 50, title: 'Chương 50: Bản dịch', content: words, wordCount: 800 };
    const harness = installStoryTool({
      draft: {
        source: 'Chương 50: Bản gốc\n\n原文 chương 50.', output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/50.html', exportDirectory: 'D:\\Truyện đã dịch',
        exportOriginalChapters: false, exportCombinedChapters: true,
        autoExportJobId: '', autoExportOutput: `Chương 50: Bản dịch\n${words}`,
        exportedRecords: [{
          exportJobId: 'job-orphaned-combined', exportDirectory: 'D:\\Truyện đã dịch',
          contentHash: chapterContentFingerprint(chapter), index: 50, title: chapter.title, wordCount: 800,
          fileName: 'chapter-50.txt', filePath: 'D:\\Truyện đã dịch\\chapter-50.txt', status: 'saved',
        }], originalExportedRecords: [],
        autoExportRange: { startChapter: 50, endChapter: 50, sourceChapterNumbers: [50] },
      },
      translationJob: {
        id: 'job-orphaned-combined', updatedAt: '2026-08-16T00:00:00.000Z', status: 'completed',
        totalSegments: 1, completedSegments: 1, translatedText: `Chương 50: Bản dịch\n${words}`,
        segments: [{ id: 's1', index: 0, status: 'completed' }],
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });
    // The persisted record may outlive a missing TXT after an interruption.
    // A restored completed job must re-submit the whole split set once.
    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledOnce());
    expect(harness.exportChapters).toHaveBeenCalledWith(expect.objectContaining({
      exportJobId: 'job-orphaned-combined',
      recoveryOnConflict: true,
      chapters: [expect.objectContaining({ index: 50, title: 'Chương 50: Bản dịch' })],
    }));
    await waitFor(() => expect(harness.exportCombinedChapters).toHaveBeenCalledOnce());
    expect(harness.exportCombinedChapters).toHaveBeenCalledWith(expect.objectContaining({
      exportJobId: 'job-orphaned-combined', startChapter: 50, endChapter: 50,
    }));
  });

  it('does not create a misleading combined range when selected source chapters have a gap', async () => {
    const first = Array.from({ length: 800 }, (_, index) => `mot${index + 1}`).join(' ');
    const third = Array.from({ length: 800 }, (_, index) => `ba${index + 1}`).join(' ');
    const harness = installStoryTool({
      draft: {
        source: 'Chương 152: Bản gốc\n\n原文 chương 152.\n\nChương 154: Bản gốc tiếp\n\n原文 chương 154.',
        output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1509589610/152.html', exportDirectory: 'D:\\Truyện đã dịch',
        exportOriginalChapters: false, exportCombinedChapters: true,
        autoExportJobId: 'job-combined-gap', exportedRecords: [],
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Nội dung tiếng Trung' });

    act(() => harness.emit({
      jobId: 'job-combined-gap', type: 'job-completed', timestamp: 1,
      payload: {
        translatedText: `Chương 152: Phần một\n${first}\n\nChương 154: Phần ba\n${third}`,
        job: { status: 'completed', segments: [{ id: 's1', index: 0, status: 'completed' }] },
      },
    }));

    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalled());
    expect(await screen.findByText(/Không xác định được phạm vi chương gốc/u)).toBeInTheDocument();
    expect(harness.exportCombinedChapters).not.toHaveBeenCalled();
  });

  it('keeps frozen numbering and the no-title choice through split, original and combined exports', async () => {
    const firstPart = Array.from({ length: 750 }, (_, index) => `mot${index + 1}`).join(' ');
    const secondPart = Array.from({ length: 750 }, (_, index) => `hai${index + 1}`).join(' ');
    const nextChapter = Array.from({ length: 750 }, (_, index) => `ba${index + 1}`).join(' ');
    const translatedText = [
      'Chương 40: Mở đầu',
      firstPart,
      secondPart,
      'Chương 41: Tiếp theo',
      nextChapter,
    ].join('\n\n');
    const harness = installStoryTool({
      draft: {
        source: 'Chương 40: Gốc\n\n原文 40.\n\nChương 41: Gốc\n\n原文 41.',
        output: '', promptMode: 'period', customPrompt: '', sourceMode: 'link',
        storyUrl: 'https://www.timotxt.com/1/', exportDirectory: 'D:\\Truyện đã dịch',
        exportOriginalChapters: true, exportCombinedChapters: true,
        exportCombinedSourceChapters: true,
        // The editable field may already point at a future run; this job must
        // use the immutable value recorded when its translation began.
        outputChapterStart: 777,
        autoExportOutputChapterStart: 101,
        autoExportOmitOutputChapterTitles: true,
        autoExportRange: { startChapter: 40, endChapter: 41, sourceChapterNumbers: [40, 41] },
        autoExportJobId: 'job-renumbered', exportedRecords: [], originalExportedRecords: [],
      },
      translationJob: {
        id: 'job-renumbered', updatedAt: '2026-08-13T00:00:00.000Z', status: 'completed',
        totalSegments: 1, completedSegments: 1,
        segments: [{ id: 'segment-1', index: 0, status: 'completed' }],
        translatedText,
        sourceText: 'Chương 40: 原题甲\n\n第一段原文。\n\nChương 41: 原题乙\n\n第二段原文。',
      },
    });

    render(<App />);

    await waitFor(() => expect(harness.exportChapters).toHaveBeenCalledOnce());
    expect(harness.exportChapters.mock.calls[0]?.[0]).toMatchObject({
      chapters: [
        expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101' }),
        expect.objectContaining({ index: 102, sourceChapterNumber: 40, title: 'Chương 102' }),
        expect.objectContaining({ index: 103, sourceChapterNumber: 41, title: 'Chương 103' }),
      ],
    });
    await waitFor(() => expect(harness.exportOriginalChapters).toHaveBeenCalledOnce());
    expect(harness.exportOriginalChapters.mock.calls[0]?.[0]).toMatchObject({
      chapters: [
        expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101' }),
        expect.objectContaining({ index: 103, sourceChapterNumber: 41, title: 'Chương 103' }),
      ],
    });
    await waitFor(() => expect(harness.exportCombinedChapters).toHaveBeenCalledOnce());
    expect(harness.exportCombinedChapters).toHaveBeenCalledWith(expect.objectContaining({
      startChapter: 101,
      endChapter: 103,
      sourceChapterNumbers: [40, 41],
      chapters: [
        expect.objectContaining({ index: 101, sourceChapterNumber: 40, title: 'Chương 101' }),
        expect.objectContaining({ index: 102, sourceChapterNumber: 40, title: 'Chương 102' }),
        expect.objectContaining({ index: 103, sourceChapterNumber: 41, title: 'Chương 103' }),
      ],
    }));
    await waitFor(() => expect(harness.exportCombinedSourceChapters).toHaveBeenCalledOnce());
    expect(harness.exportCombinedSourceChapters).toHaveBeenCalledWith(expect.objectContaining({
      sourceStartChapter: 40,
      sourceEndChapter: 41,
      outputStartChapter: 101,
      outputEndChapter: 102,
      chapters: [
        expect.objectContaining({
          index: 101,
          sourceChapterNumber: 40,
          title: 'Chương 101',
          content: expect.stringContaining('第一段原文。'),
        }),
        expect.objectContaining({
          index: 102,
          sourceChapterNumber: 41,
          title: 'Chương 102',
          content: expect.stringContaining('第二段原文。'),
        }),
      ],
    }));
    const sourceAggregateRequest = harness.exportCombinedSourceChapters.mock.calls[0]?.[0] as {
      chapters: Array<{ content: string }>;
    };
    expect(sourceAggregateRequest.chapters.map((item) => item.content).join('\n')).not.toContain('mot1');
  });
});
