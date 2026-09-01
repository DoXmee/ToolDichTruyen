import type { AiProvider, PromptMode } from '../../../shared';
import { Icon } from '../../components/Icon';

interface PromptSelectorProps {
  mode: PromptMode;
  prompts: { period: string; modern: string; ancient: string; cultivation: string };
  customPrompt: string;
  /** Optional replacement number for the first exported link chapter. */
  outputChapterStart?: number;
  /** First source chapter selected in the catalog, shown as the safe default. */
  suggestedChapterStart?: number;
  omitOutputChapterTitles: boolean;
  exportCombinedSourceChapters: boolean;
  loading?: boolean;
  allowedAiProviders: AiProvider[];
  providerSelectionLocked?: boolean;
  onModeChange: (mode: PromptMode) => void;
  onCustomPromptChange: (value: string) => void;
  onOutputChapterStartChange: (value: number | undefined) => void;
  onOmitOutputChapterTitlesChange: (value: boolean) => void;
  onExportCombinedSourceChaptersChange: (value: boolean) => void;
  onToggleAiProvider: (provider: AiProvider) => void;
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
  onModeChange,
  onCustomPromptChange,
  onOutputChapterStartChange,
  onOmitOutputChapterTitlesChange,
  onExportCombinedSourceChaptersChange,
  onToggleAiProvider,
}: PromptSelectorProps) {
  const canRenumberLinkChapters = typeof suggestedChapterStart === 'number';
  const numberingHint = outputChapterStart === undefined
    ? (canRenumberLinkChapters
      ? `Mặc định giữ số chương gốc (bắt đầu từ chương ${suggestedChapterStart}).`
      : 'Chọn chương từ link truyện ở Bước 1 để đặt lại số chương xuất.')
    : `Các file chương đã chia sẽ được đánh số từ Chương ${outputChapterStart}.`;

  return (
    <section className="panel prompt-panel" aria-labelledby="prompt-heading">
      <div className="panel__heading">
        <div>
          <span className="eyebrow">Bước 2</span>
          <h2 id="prompt-heading">Chọn phong cách dịch</h2>
        </div>
        <div aria-label="Chatbot dùng cho tiến trình" className="provider-pool" role="group">
          <div className="provider-pool__options">
            {(['chatgpt', 'kimi', 'deepseek'] as const).map((provider) => (
              <label key={provider}>
                <input
                  aria-label={provider === 'chatgpt' ? 'ChatGPT' : provider === 'kimi' ? 'Kimi AI' : 'DeepSeek AI'}
                  checked={allowedAiProviders.includes(provider)}
                  disabled={providerSelectionLocked || (allowedAiProviders.length === 1 && allowedAiProviders[0] === provider)}
                  onChange={() => onToggleAiProvider(provider)}
                  type="checkbox"
                />
                <span>{provider === 'chatgpt' ? 'ChatGPT' : provider === 'kimi' ? 'Kimi' : 'DeepSeek'}</span>
              </label>
            ))}
          </div>
        </div>
        <Icon name="wand" />
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
            aria-describedby="output-chapter-number-hint"
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
        <div className="chapter-numbering-control__toggles">
          <label className="chapter-numbering-control__toggle" htmlFor="omit-output-chapter-titles">
            <input
              checked={omitOutputChapterTitles}
              disabled={!canRenumberLinkChapters}
              id="omit-output-chapter-titles"
              type="checkbox"
              onChange={(event) => onOmitOutputChapterTitlesChange(event.target.checked)}
            />
            <span>Không lấy tên chương</span>
          </label>
          <label className="chapter-numbering-control__toggle" htmlFor="export-combined-source-chapters">
            <input
              checked={exportCombinedSourceChapters}
              disabled={!canRenumberLinkChapters}
              id="export-combined-source-chapters"
              type="checkbox"
              onChange={(event) => onExportCombinedSourceChaptersChange(event.target.checked)}
            />
            <span>Lưu file tổng các chương gốc</span>
          </label>
        </div>
        <p id="output-chapter-number-hint">{numberingHint}</p>
        <p className="chapter-numbering-control__scope">Chỉ dùng khi nhập link chương truyện hoặc bộ truyện.</p>
      </section>

      <div className={`custom-prompt${mode === 'custom' ? ' custom-prompt--active' : ''}`}>
        <label htmlFor="custom-prompt">Prompt tùy chỉnh</label>
        <textarea
          id="custom-prompt"
          value={customPrompt}
          onChange={(event) => onCustomPromptChange(event.target.value)}
          onFocus={() => onModeChange('custom')}
          placeholder="Ví dụ: Dịch sát nghĩa, giữ giọng trinh thám lạnh, không thêm lời giải thích…"
          rows={5}
        />
        <p>Chỉ cần bắt đầu nhập, chế độ “Khác” sẽ được chọn tự động.</p>
      </div>
    </section>
  );
}
