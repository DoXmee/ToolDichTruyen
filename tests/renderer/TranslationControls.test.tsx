import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TranslationControls } from '../../src/renderer/features/translation/TranslationControls';

afterEach(() => cleanup());

const checkpoint = {
  status: 'idle' as const,
  sourceCharacters: 0,
  chapterCount: 0,
  wordCount: 0,
};

describe('TranslationControls connection hint', () => {
  it('shows the active ChatGPT connection without changing translation controls', () => {
    render(
      <TranslationControls
        canContinueFromCheckpoint={false}
        canStart
        completedSegments={16}
        connected
        errors={[]}
        splitCheckpoint={checkpoint}
        state="running"
        totalSegments={94}
        onCancel={() => undefined}
        onPause={() => undefined}
        onResume={() => undefined}
        onRetry={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getByText('ChatGPT đang kết nối.')).toBeInTheDocument();
    expect(screen.queryByText('Kết nối ChatGPT trước khi bắt đầu.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tạm dừng/i })).toBeEnabled();
  });
});
