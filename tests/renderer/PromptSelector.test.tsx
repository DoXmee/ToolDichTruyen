import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptSelector } from '../../src/renderer/features/translation/PromptSelector';
import type { AiProvider } from '../../src/shared';

function NumberingHarness({ suggestedChapterStart }: { suggestedChapterStart?: number }) {
  const [mode, setMode] = useState<'period' | 'modern' | 'ancient' | 'cultivation' | 'custom'>('period');
  const [outputChapterStart, setOutputChapterStart] = useState<number | undefined>();
  const [omitOutputChapterTitles, setOmitOutputChapterTitles] = useState(false);
  const [exportCombinedSourceChapters, setExportCombinedSourceChapters] = useState(false);
  const [allowedAiProviders, setAllowedAiProviders] = useState<AiProvider[]>(['chatgpt', 'kimi', 'deepseek', 'gemini']);

  return (
    <PromptSelector
      allowedAiProviders={allowedAiProviders}
      customPrompt=""
      exportCombinedSourceChapters={exportCombinedSourceChapters}
      mode={mode}
      omitOutputChapterTitles={omitOutputChapterTitles}
      outputChapterStart={outputChapterStart}
      prompts={{ period: 'Prompt niên đại', modern: 'Prompt hiện đại', ancient: 'Prompt cổ trang', cultivation: 'Prompt tu tiên' }}
      suggestedChapterStart={suggestedChapterStart}
      onCustomPromptChange={() => undefined}
      onExportCombinedSourceChaptersChange={setExportCombinedSourceChapters}
      onModeChange={setMode}
      onToggleAiProvider={(provider) => setAllowedAiProviders((current) => {
        if (current.includes(provider)) {
          return current.length === 1 ? current : current.filter((candidate) => candidate !== provider);
        }
        return (['chatgpt', 'kimi', 'deepseek', 'gemini'] as AiProvider[])
          .filter((candidate) => current.includes(candidate) || candidate === provider);
      })}
      onOmitOutputChapterTitlesChange={setOmitOutputChapterTitles}
      onOutputChapterStartChange={setOutputChapterStart}
    />
  );
}

afterEach(() => cleanup());

describe('PromptSelector chapter output numbering', () => {
  it('mặc định chọn cả 4 chatbot và không cho bỏ lựa chọn cuối cùng', () => {
    render(<NumberingHarness />);
    const chatgpt = screen.getByRole('checkbox', { name: 'ChatGPT' });
    const kimi = screen.getByRole('checkbox', { name: 'Kimi AI' });
    const deepseek = screen.getByRole('checkbox', { name: 'DeepSeek AI' });
    const gemini = screen.getByRole('checkbox', { name: 'Gemini AI' });
    expect(chatgpt).toBeChecked();
    expect(kimi).toBeChecked();
    expect(deepseek).toBeChecked();
    expect(gemini).toBeChecked();

    fireEvent.click(kimi);
    fireEvent.click(deepseek);
    fireEvent.click(gemini);
    expect(chatgpt).toBeChecked();
    expect(kimi).not.toBeChecked();
    expect(deepseek).not.toBeChecked();
    expect(gemini).not.toBeChecked();
    expect(chatgpt).toBeDisabled();
  });

  it('hiển thị bốn phong cách có sẵn trong lưới gọn và cho phép chọn từng phong cách', () => {
    render(<NumberingHarness />);

    const ancient = screen.getByRole('radio', { name: /Truyện cổ trang/i });
    const cultivation = screen.getByRole('radio', { name: /Truyện tu tiên/i });
    expect(screen.getByRole('radio', { name: /Truyện niên đại/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Truyện hiện đại/i })).toBeInTheDocument();
    expect(ancient).toBeInTheDocument();
    expect(cultivation).toBeInTheDocument();

    fireEvent.click(ancient);
    expect(ancient).toBeChecked();
    fireEvent.click(cultivation);
    expect(cultivation).toBeChecked();
  });

  it('hiển thị số chương gốc làm mặc định và chỉ nhận số bắt đầu hợp lệ', () => {
    render(<NumberingHarness suggestedChapterStart={40} />);

    const field = screen.getByLabelText('Số chương xuất bắt đầu');
    expect(field).toHaveValue(40);

    fireEvent.change(field, { target: { value: '101' } });
    expect(field).toHaveValue(101);

    fireEvent.change(field, { target: { value: '1000000' } });
    expect(field).toHaveValue(40);
  });

  it('khóa ô đánh số cho đến khi người dùng chọn chương từ link truyện', () => {
    render(<NumberingHarness />);

    expect(screen.getByLabelText('Số chương xuất bắt đầu')).toBeDisabled();
  });
});
