import { Icon } from '../../components/Icon';
import { StatusPill } from '../../components/StatusPill';
import type { SplitCheckpoint } from '../splitter/ChapterSplitter';

export type TranslationState = 'idle' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'complete' | 'error';

export interface SegmentError {
  id: string;
  message: string;
  segmentId: string;
}

interface TranslationControlsProps {
  providerLabel?: string;
  state: TranslationState;
  connected: boolean;
  completedSegments: number;
  totalSegments: number;
  errors: SegmentError[];
  canContinueFromCheckpoint: boolean;
  splitCheckpoint: SplitCheckpoint;
  canStart: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: (segmentId: string) => void;
}

const stateLabels: Record<TranslationState, string> = {
  idle: 'Sẵn sàng dịch',
  running: 'AI đang dịch',
  paused: 'Đã tạm dừng',
  cancelling: 'Đang hủy…',
  cancelled: 'Đã hủy',
  complete: 'Dịch hoàn tất',
  error: 'Cần kiểm tra lỗi',
};

export function TranslationControls({
  providerLabel = 'ChatGPT',
  state,
  connected,
  completedSegments,
  totalSegments,
  errors,
  canContinueFromCheckpoint,
  splitCheckpoint,
  canStart,
  onStart,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: TranslationControlsProps) {
  const percent = totalSegments > 0 ? Math.min(100, Math.round((completedSegments / totalSegments) * 100)) : 0;
  const active = state === 'running' || state === 'paused' || state === 'cancelling';
  const tone = state === 'complete' ? 'success' : state === 'error' ? 'danger' : active ? 'info' : 'neutral';

  return (
    <section className="translation-controls" aria-label="Điều khiển dịch">
      <div className="translation-controls__topline">
        <StatusPill tone={tone} pulse={state === 'running'}>
          {state === 'running' ? `${providerLabel} đang dịch` : stateLabels[state]}
        </StatusPill>
        {totalSegments > 0 && (
          <span className="progress-label">{completedSegments}/{totalSegments} đoạn · {percent}%</span>
        )}
        {splitCheckpoint.sourceCharacters > 0 && (
          <span className="checkpoint-label" aria-live="polite">
            {splitCheckpoint.status === 'splitting'
              ? 'Đang chia checkpoint đã dịch…'
              : splitCheckpoint.status === 'ready'
                ? `Đã checkpoint & chia tạm ${splitCheckpoint.chapterCount} chương · ${splitCheckpoint.wordCount.toLocaleString('vi-VN')} chữ`
                : splitCheckpoint.status === 'error'
                  ? 'Checkpoint chia chương cần kiểm tra'
                  : 'Checkpoint đã lưu'}
          </span>
        )}
      </div>

      <div
        className={`progress-track${state === 'running' && totalSegments === 0 ? ' progress-track--indeterminate' : ''}`}
        role="progressbar"
        aria-label="Tiến độ dịch"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="action-row">
        {!active && (
          // The browser connects on demand when the job starts, so a saved
          // account is what matters here, not a separate connect step.
          <button className="button button--primary button--large" disabled={!canStart} onClick={onStart} type="button">
            <Icon name={state === 'complete' || state === 'cancelled' || state === 'error' ? 'refresh' : 'sparkles'} />
            {state === 'complete' || state === 'cancelled' || state === 'error' ? 'Dịch lại từ đầu' : 'Bắt đầu dịch'}
          </button>
        )}
        {state === 'running' && (
          <button className="button button--secondary button--large" onClick={onPause} type="button">
            <Icon name="pause" /> Tạm dừng
          </button>
        )}
        {state === 'paused' && (
          <button className="button button--primary button--large" onClick={onResume} type="button">
            <Icon name="play" /> Tiếp tục
          </button>
        )}
        {(state === 'error' || state === 'cancelled') && canContinueFromCheckpoint && (
          <button className="button button--primary button--large" onClick={onResume} type="button">
            <Icon name="play" /> Tiếp tục từ checkpoint
          </button>
        )}
        {active && (
          <button className="button button--danger-ghost button--large" disabled={state === 'cancelling'} onClick={onCancel} type="button">
            <Icon name="stop" /> Hủy
          </button>
        )}
        <span className={`action-hint${connected ? ' action-hint--connected' : ''}`}>
          {connected
            ? `${providerLabel} đang kết nối.`
            : `Dùng tài khoản đã lưu của ${providerLabel}; tool tự kết nối khi bắt đầu dịch.`}
        </span>
      </div>

      {errors.length > 0 && (
        <div className="segment-errors" aria-live="polite">
          <div className="segment-errors__heading">
            <Icon name="alert" />
            <strong>{errors.length} đoạn cần xử lý lại</strong>
          </div>
          {errors.map((error) => (
            <div className="segment-error" key={error.id}>
              <span>{error.message}</span>
              <button className="button button--tiny" onClick={() => onRetry(error.segmentId)} type="button">
                <Icon name="refresh" size={14} /> Tiếp tục từ đoạn lỗi
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
