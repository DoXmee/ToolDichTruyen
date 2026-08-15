import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptSelector } from '../../src/renderer/features/translation/PromptSelector';

function NumberingHarness({ suggestedChapterStart }: { suggestedChapterStart?: number }) {
  const [outputChapterStart, setOutputChapterStart] = useState<number | undefined>();
  const [omitOutputChapterTitles, setOmitOutputChapterTitles] = useState(false);

  return (
    <PromptSelector
      customPrompt=""
      mode="period"
      omitOutputChapterTitles={omitOutputChapterTitles}
      outputChapterStart={outputChapterStart}
      prompts={{ historical: 'Prompt cổ trang', modern: 'Prompt hiện đại' }}
      suggestedChapterStart={suggestedChapterStart}
      onCustomPromptChange={() => undefined}
      onModeChange={() => undefined}
      onOmitOutputChapterTitlesChange={setOmitOutputChapterTitles}
      onOutputChapterStartChange={setOutputChapterStart}
    />
  );
}

afterEach(() => cleanup());

describe('PromptSelector chapter output numbering', () => {
  it('hiển thị số chương gốc làm mặc định và chỉ nhận số bắt đầu hợp lệ', () => {
    render(<NumberingHarness suggestedChapterStart={40} />);

    const field = screen.getByLabelText('Số chương xuất bắt đầu');
    expect(field).toHaveValue(40);
    expect(screen.getByText('Mặc định giữ số chương gốc (bắt đầu từ chương 40).')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '101' } });
    expect(field).toHaveValue(101);
    expect(screen.getByText('Các file chương đã chia sẽ được đánh số từ Chương 101.')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '1000000' } });
    expect(field).toHaveValue(40);
    expect(screen.getByText('Mặc định giữ số chương gốc (bắt đầu từ chương 40).')).toBeInTheDocument();
  });

  it('khóa ô đánh số cho đến khi người dùng chọn chương từ link truyện', () => {
    render(<NumberingHarness />);

    expect(screen.getByLabelText('Số chương xuất bắt đầu')).toBeDisabled();
    expect(screen.getByText('Chỉ dùng khi nhập link chương truyện hoặc bộ truyện.')).toBeInTheDocument();
    expect(screen.getByText('Chọn chương từ link truyện ở Bước 1 để đặt lại số chương xuất.')).toBeInTheDocument();
    expect(screen.getByLabelText('Không lấy tên chương')).toBeDisabled();
  });

  it('cho phép bỏ tên chương khi xuất link và lưu lại lựa chọn', () => {
    render(<NumberingHarness suggestedChapterStart={7} />);

    const toggle = screen.getByLabelText('Không lấy tên chương');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });
});
