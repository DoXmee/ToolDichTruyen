import type { AiProvider, PromptMode } from '../../../shared';
import { Icon } from '../../components/Icon';

const AI_PROVIDER_OPTIONS: Array<{ value: AiProvider; label: string; short: string }> = [
  { value: 'chatgpt', label: 'ChatGPT', short: 'ChatGPT' },
  { value: 'kimi', label: 'Kimi AI', short: 'Kimi' },
  { value: 'deepseek', label: 'DeepSeek AI', short: 'DeepSeek' },
  { value: 'gemini', label: 'Gemini AI', short: 'Gemini' },
];

interface PromptSelectorProps {
  mode: PromptMode;
  prompts: { period: string; modern: string; ancient: string; cultivation: string };
  customPrompt: string;
  /** Optional replacement number for the first exported link chapter. */
  outputChapterStart?: number;
  /** First source chapter selected in the catalog, shown as the safe default. */
  suggestedChapterStart?: number;
  omitOutputChapterTitles?: boolean;
  exportCombinedSourceChapters?: boolean;
  loading?: boolean;
  allowedAiProviders: AiProvider[];
  providerSelectionLocked?: boolean;
  batchChaptersCount?: number;
  onModeChange: (mode: PromptMode) => void;
  onCustomPromptChange: (value: string) => void;
  onOutputChapterStartChange: (value: number | undefined) => void;
  onOmitOutputChapterTitlesChange?: (value: boolean) => void;
  onExportCombinedSourceChaptersChange?: (value: boolean) => void;
  onToggleAiProvider: (provider: AiProvider) => void;
  onBatchChaptersCountChange?: (count: number) => void;
}

interface PromptCardProps {
  checked: boolean;
  label: string;
  value: PromptMode;
  onChange: (mode: PromptMode) => void;
}

function PromptCard({ checked, label, value, onChange }: PromptCardProps) {
  return (
    <label className={`prompt-card${checked ? ' prompt-card--selected' : ''}`}>
      <input
        checked={checked}
        name="prompt-mode"
        onChange={() => onChange(value)}
        type="radio"
        value={value}
      />
      <span className="prompt-card__radio" aria-hidden="true" />
      <span className="prompt-card__body">
        <strong>{label}</strong>
      </span>
    </label>
  );
}

export function PromptSelector({
  mode,
  prompts,
  customPrompt,
  outputChapterStart,
  suggestedChapterStart,
  omitOutputChapterTitles,
  exportCombinedSourceChapters,
  loading = false,
  allowedAiProviders,
  providerSelectionLocked = false,
  batchChaptersCount,
  onModeChange,
  onCustomPromptChange,
  onOutputChapterStartChange,
  onOmitOutputChapterTitlesChange,
  onExportCombinedSourceChaptersChange,
  onToggleAiProvider,
  onBatchChaptersCountChange,
}: PromptSelectorProps) {
  const canRenumberLinkChapters = typeof suggestedChapterStart === 'number';

  return (
    <section className="panel prompt-panel" aria-labelledby="prompt-heading">
      <div className="panel__heading">
        <div>
          <span className="eyebrow">Bước 2</span>
          <h2 id="prompt-heading">Chọn phong cách dịch</h2>
        </div>
        <div aria-label="Chatbot dùng cho tiến trình" className="provider-pool" role="group">
          <div className="provider-pool__options">
            {AI_PROVIDER_OPTIONS.map(({ value, label, short }) => (
              <label key={value}>
                <input
                  aria-label={label}
                  checked={allowedAiProviders.includes(value)}
                  disabled={providerSelectionLocked || (allowedAiProviders.length === 1 && allowedAiProviders[0] === value)}
                  onChange={() => onToggleAiProvider(value)}
                  type="checkbox"
                />
                <span>{short}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="prompt-list prompt-list--genres">
        <PromptCard
          checked={mode === 'period'}
          label="Truyện niên đại"
          value="period"
          onChange={onModeChange}
        />
        <PromptCard
          checked={mode === 'modern'}
          label="Truyện hiện đại"
          value="modern"
          onChange={onModeChange}
        />
        <PromptCard
          checked={mode === 'ancient'}
          label="Truyện cổ trang"
          value="ancient"
          onChange={onModeChange}
        />
        <PromptCard
          checked={mode === 'cultivation'}
          label="Truyện tu tiên"
          value="cultivation"
          onChange={onModeChange}
        />
      </div>
      <div className="prompt-list prompt-list--custom">
        <PromptCard
          checked={mode === 'custom'}
          label="Khác"
          value="custom"
          onChange={onModeChange}
        />
      </div>

      <section className="chapter-numbering-control" aria-labelledby="output-chapter-number-heading">
        <div className="chapter-numbering-control__heading">
          <div>
            <span className="eyebrow">Tên chương xuất</span>
            <strong id="output-chapter-number-heading">Đánh số chương bắt đầu</strong>
          </div>
          {canRenumberLinkChapters && <span>Gốc: {suggestedChapterStart}</span>}
        </div>
        <label className="chapter-numbering-control__field" htmlFor="output-chapter-start">
          <span className="sr-only">Số chương xuất bắt đầu</span>
          <span>Chương</span>
          <input
            aria-label="Số chương xuất bắt đầu"
            disabled={!canRenumberLinkChapters}
            id="output-chapter-start"
            inputMode="numeric"
            min={1}
            max={999_999}
            placeholder={canRenumberLinkChapters ? String(suggestedChapterStart) : 'Chưa chọn'}
            step={1}
            type="number"
            value={outputChapterStart ?? suggestedChapterStart ?? ''}
            onChange={(event) => {
              const rawValue = event.target.value.trim();
              const nextValue = Number(rawValue);
              onOutputChapterStartChange(
                rawValue && Number.isInteger(nextValue) && nextValue >= 1 && nextValue <= 999_999 ? nextValue : undefined,
              );
            }}
          />
        </label>
      </section>

      <section className="chapter-numbering-control" aria-labelledby="batch-chapters-heading" style={{ marginTop: '0.75rem' }}>
        <div className="chapter-numbering-control__heading">
          <div>
            <span className="eyebrow">Cơ chế mẻ chương</span>
            <strong id="batch-chapters-heading">Số chương dịch mỗi mẻ (Luôn giữ nguyên chương, không cắt dở)</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { value: 0, label: 'Tự động thích ứng (1–3 chương)' },
            { value: 1, label: '1 chương / mẻ (An toàn cho Web AI)' },
            { value: 2, label: '2 chương / mẻ (Chuẩn)' },
            { value: 3, label: '3 chương / mẻ' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`button button--sm${(batchChaptersCount ?? 0) === opt.value ? ' button--primary' : ' button--secondary'}`}
              onClick={() => onBatchChaptersCountChange?.(opt.value)}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <div className={`custom-prompt${mode === 'custom' ? ' custom-prompt--active' : ''}`} style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
          <label htmlFor="custom-prompt" style={{ fontWeight: 600 }}>Chỉ đạo văn phong & xưng hô tùy chỉnh</label>
          <span style={{ fontSize: '0.8rem', color: customPrompt.length > 7500 ? '#e63946' : 'var(--text-muted, #888)' }}>
            {customPrompt.length.toLocaleString('vi-VN')} / 8.000 ký tự
          </span>
        </div>
        <textarea
          id="custom-prompt"
          aria-label="Prompt tùy chỉnh"
          maxLength={8000}
          value={customPrompt}
          onChange={(event) => onCustomPromptChange(event.target.value.slice(0, 8000))}
          onFocus={() => onModeChange('custom')}
          placeholder="Nhập phong cách dịch, giọng văn hoặc chỉ đạo xưng hô riêng của bạn tại đây (sẽ thay thế phong cách mặc định, trong khi khung sườn kỹ thuật bất biến như khóa tên ⟦...⟧, số chương và dịch 100% tiếng Việt vẫn được bảo toàn tự động)..."
          rows={6}
        />
      </div>
    </section>
  );
}
