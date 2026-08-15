import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SplitConfig } from '../../src/shared';
import { ChapterSplitter } from '../../src/renderer/features/splitter/ChapterSplitter';
import type { StoryToolApi } from '../../src/renderer/ipc';

const CONFIG: SplitConfig = {
  targetWords: 5,
  prefix: '',
  suffix: '',
  startIndex: 1,
  inputLanguage: 'vi',
  autoDetectTitle: true,
  useAI: false,
};

function installStoryTool(): void {
  const api: StoryToolApi = {
    loadPrompts: vi.fn(async () => ({ historical: '', modern: '' })),
    getDraft: vi.fn(async () => null),
    saveDraft: vi.fn(async () => undefined),
    connectChatGPT: vi.fn(async () => ({ status: 'ready' })),
    startTranslation: vi.fn(async () => ({ jobId: 'job-test' })),
    pauseTranslation: vi.fn(async () => undefined),
    resumeTranslation: vi.fn(async () => undefined),
    restartTranslation: vi.fn(async () => ({ jobId: 'job-restarted' })),
    cancelTranslation: vi.fn(async () => undefined),
    discardTranslation: vi.fn(async () => undefined),
    getTranslation: vi.fn(async () => { throw new Error('Không có tác vụ dịch trong test chia chương.'); }),
    getActiveTranslations: vi.fn(async () => []),
    discoverTranslations: vi.fn(async () => []),
    retrySegment: vi.fn(async () => undefined),
    onTranslationEvent: vi.fn(() => () => undefined),
    exportText: vi.fn(async () => ({ canceled: false })),
    generateTitles: vi.fn(async ({ chapters }) => ({
      titles: chapters.map((_, index) => `Tên ${index + 1}`),
      model: 'gemini-test',
    })),
  };
  Object.defineProperty(window, 'storyTool', { configurable: true, value: api });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'storyTool');
  vi.restoreAllMocks();
});

describe('ChapterSplitter renderer', () => {
  it('chia thành preview riêng, giữ nguyên output và tô đúng chữ Hán', async () => {
    installStoryTool();
    const originalOutput = 'Đây là đoạn một có 漢 tự.\n\nĐây là đoạn hai tiếp theo.';
    const onConfigChange = vi.fn();

    render(
      <div>
        <textarea aria-label="Bản dịch gốc" readOnly value={originalOutput} />
        <ChapterSplitter
          config={CONFIG}
          sourceText={originalOutput}
          onConfigChange={onConfigChange}
        />
      </div>,
    );

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    expect(screen.getByText(/Chỉ chia tại ranh giới đoạn xuống dòng/u)).toBeInTheDocument();
    expect(screen.getByLabelText('Bản dịch gốc')).toHaveValue(originalOutput);
    expect(onConfigChange).not.toHaveBeenCalled();

    // Even with a deliberately tiny target, the first complete paragraph is
    // never cut. Its Han character stays in chapter 1.
    const highlighted = screen.getByLabelText('Nội dung có tô chữ Hán');
    const mark = highlighted.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark).toHaveTextContent('漢');

    fireEvent.change(screen.getByLabelText('Tiêu đề chương'), {
      target: { value: 'Chương 6: Dấu vết cũ' },
    });
    expect(screen.getByLabelText('Tiêu đề chương')).toHaveValue('Chương 6: Dấu vết cũ');
    expect(screen.getByLabelText('Bản dịch gốc')).toHaveValue(originalOutput);
  }, 15_000);

  it('detects a source heading and exports the edited chapter body', async () => {
    installStoryTool();
    const exportText = vi.fn(async () => ({ canceled: false }));
    (window.storyTool as StoryToolApi).exportText = exportText;
    const onDetectedChapterStart = vi.fn();
    const source = 'Chương 50: Cố Vũ thủ trưởng\n\nĐoạn thân truyện thứ nhất.\n\nĐoạn thân truyện thứ hai.';
    render(<ChapterSplitter config={{ ...CONFIG, targetWords: 100 }} sourceText={source} onConfigChange={vi.fn()} onDetectedChapterStart={onDetectedChapterStart} />);

    expect(await screen.findByLabelText('Tiêu đề chương')).toHaveValue('Chương 50: Cố Vũ thủ trưởng');
    expect(onDetectedChapterStart).toHaveBeenCalledWith(50);
    expect(screen.getByLabelText('Nội dung có tô chữ Hán')).not.toHaveTextContent('Chương 50');

    fireEvent.click(screen.getByLabelText('Tô đỏ chữ Hán'));
    const editor = await screen.findByLabelText('Nội dung Chương 50: Cố Vũ thủ trưởng');
    fireEvent.change(editor, { target: { value: 'Nội dung người dùng đã sửa.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất TXT' }));
    await waitFor(() => expect(exportText).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Nội dung người dùng đã sửa.'),
    })));
  }, 15_000);
});
