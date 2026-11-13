import type {
  ChapterExportRecord,
  CombinedChapterExportResult,
  StorySourceAnalysis,
  StorySourceProgress,
} from '../../../shared';
import { Icon } from '../../components/Icon';

export type StoryImportState = 'idle' | 'analyzing' | 'ready' | 'fetching' | 'error';
export type ManualVerificationState = 'none' | 'available' | 'opening' | 'open';

interface StoryLinkImporterProps {
  url: string;
  analysis: StorySourceAnalysis | null;
  selectedChapterIds: Set<string>;
  state: StoryImportState;
  progress: StorySourceProgress | null;
  exportDirectory: string;
  exportOriginalChapters: boolean;
  exportCombinedChapters: boolean;
  omitOutputChapterTitles?: boolean;
  exportCombinedSourceChapters?: boolean;
  exportedRecords: ChapterExportRecord[];
  originalExportedRecords: ChapterExportRecord[];
  combinedExport?: CombinedChapterExportResult;
  manualVerificationState?: ManualVerificationState;
  manualVerificationIssue?: string;
  disabled?: boolean;
  onUrlChange(value: string): void;
  onAnalyze(): void;
  onOpenManualVerification?(): void;
  onRevealBrowserHelper?(): void;
  onSwitchToText?(): void;
  onToggleChapter(id: string): void;
  onSelectAll(): void;
  onClearSelection(): void;
  onSelectRange(start: number, end: number): void;
  onChooseDirectory(): void;
  onExportOriginalChaptersChange(value: boolean): void;
  onExportCombinedChaptersChange(value: boolean): void;
  onOmitOutputChapterTitlesChange?(value: boolean): void;
  onExportCombinedSourceChaptersChange?(value: boolean): void;
  onFetchAndTranslate(): void;
  onCancel(): void;
}

function siteLabel(site: StorySourceAnalysis['site']): string {
  const labels: Record<StorySourceAnalysis['site'], string> = {
    huliwang: 'Huliwang',
    timotxt: 'TimoTXT',
    qingrenyouxi: 'Qingrenyouxi',
    xbanxia: 'Xbanxia',
    xszj: 'XSZJ/爱下电子书',
    liehuozw: 'Liehuo中文网',
    uaa002: 'UAA002',
    c6k6: 'C6K6',
    czbooks: 'CZBooks',
    novel543: 'Novel543',
  };
  return labels[site];
}

function manualVerificationLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const labels = hostname.split('.');
    const brand = labels[0] === 'www' || labels[0] === 'm' ? labels[1] : labels[0];
    const path = parsed.pathname.replace(/\/{2,}/gu, '/');
    if (brand === 'timotxt') return 'TimoTXT';
    if (brand === 'novel543' || /^\/\d{6,20}(?:\/dir|\/\d+_\d+(?:_\d+)?\.html)?\/?$/u.test(path)) return 'Novel543';
    return brand === 'xszj'
      || brand === 'ixdzs8'
      || /^\/b\/\d+(?:\/(?:cs|c)\/\d+)?\/?$/u.test(path)
      || /^\/read\/\d+(?:\/p\d+\.html)?\/?$/u.test(path)
        ? 'XSZJ/爱下电子书'
        : 'Huliwang';
  } catch {
    return 'Huliwang';
  }
}

export function StoryLinkImporter({
  url,
  analysis,
  selectedChapterIds,
  state,
  progress,
  exportDirectory,
  exportOriginalChapters,
  exportCombinedChapters,
  omitOutputChapterTitles = false,
  exportCombinedSourceChapters = false,
  exportedRecords,
  originalExportedRecords,
  combinedExport,
  manualVerificationState = 'none',
  manualVerificationIssue = '',
  disabled = false,
  onUrlChange,
  onAnalyze,
  onOpenManualVerification,
  onRevealBrowserHelper,
  onSwitchToText,
  onToggleChapter,
  onSelectAll,
  onClearSelection,
  onSelectRange,
  onChooseDirectory,
  onExportOriginalChaptersChange,
  onExportCombinedChaptersChange,
  onOmitOutputChapterTitlesChange,
  onExportCombinedSourceChaptersChange,
  onFetchAndTranslate,
  onCancel,
}: StoryLinkImporterProps) {
  const busy = state === 'analyzing' || state === 'fetching';
  const manualVerificationPending = manualVerificationState === 'opening';
  const selectableChapters = analysis?.chapters.filter((chapter) => !chapter.isIntroduction) ?? [];
  const selectedCount = selectedChapterIds.size;
  const verificationLabel = manualVerificationLabel(url);
  const showPreAnalysisManualVerification = !analysis && manualVerificationState === 'available' && onOpenManualVerification;
  const showCatalogManualVerification = Boolean(analysis && manualVerificationState === 'available' && onOpenManualVerification);
  const retryCurrentBrowser = /giữ nguyên tab Browser Helper/iu.test(manualVerificationIssue);

  return (
    <div className="story-link-importer">
      <div className="story-url-row">
        <label className="story-url-field">
          <span className="sr-only">Link bộ truyện hoặc chương truyện</span>
          <input
            aria-label="Link bộ truyện hoặc chương truyện"
            disabled={busy || disabled || manualVerificationPending}
            type="url"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && url.trim() && !busy && !disabled && !manualVerificationPending) onAnalyze();
            }}
            placeholder="Dán link Novel543, Huliwang, XSZJ, TimoTXT, Xbanxia hoặc nguồn được hỗ trợ…"
          />
        </label>
        <button
          className="button button--secondary"
          disabled={!url.trim() || busy || disabled || manualVerificationPending}
          onClick={onAnalyze}
          type="button"
        >
          {state === 'analyzing' ? <span className="spinner spinner--small" /> : <Icon name="link" />}
          Phân tích
        </button>
      </div>

      {showPreAnalysisManualVerification && (
        <div className="story-manual-verification" role="alert">
          <div className="story-manual-verification__header">
            <Icon name="alert" />
            <div className="story-manual-verification__content">
              <strong>{verificationLabel} cần Microsoft Edge hoặc Google Chrome và profile bạn dùng hằng ngày.</strong>
              <span>Kết nối tiện ích cục bộ, sau đó tool sẽ tự phân tích lại link bằng đúng phiên trình duyệt này.</span>
              <span>Lần đầu: bấm Mở thư mục tiện ích (Huli Browser Helper nằm ngay cạnh ToolDichTruyen.exe), vào edge://extensions hoặc chrome://extensions, bật Chế độ nhà phát triển và chọn Tải tiện ích đã giải nén. Tool không dùng Cốc Cốc cho bước này.</span>
            </div>
          </div>
          <div className="story-manual-verification__actions">
            <button
              className="button button--primary"
              disabled={disabled}
              onClick={onOpenManualVerification}
              type="button"
            >
              Kết nối trình duyệt mặc định
            </button>
            {onRevealBrowserHelper && (
              <button
                className="button button--secondary"
                disabled={disabled}
                onClick={onRevealBrowserHelper}
                type="button"
              >
                Mở thư mục tiện ích
              </button>
            )}
            {onSwitchToText && (
              <button className="button button--secondary" disabled={disabled} onClick={onSwitchToText} type="button">
                Chuyển sang Dán nội dung
              </button>
            )}
          </div>
        </div>
      )}

      {(manualVerificationState === 'opening' || manualVerificationState === 'open') && (
        <div className="story-manual-verification story-manual-verification--waiting" role="status">
          <div className="story-manual-verification__header">
            {manualVerificationState === 'opening' ? <span className="spinner spinner--small" /> : <Icon name="alert" />}
            <div className="story-manual-verification__content">
              <strong>{manualVerificationState === 'opening' ? 'Đang chờ trình duyệt mặc định kết nối…' : 'Trình duyệt đã kết nối.'}</strong>
              <span>{manualVerificationState === 'opening'
                ? 'Hãy mở trang ghép nối bằng đúng profile bạn dùng hằng ngày và bảo đảm tiện ích đã được cài. Kết nối xong, tool tự phân tích lại link.'
                : `Tool đang chuyển sang phân tích lại link ${verificationLabel}.`}</span>
            </div>
          </div>
          <div className="story-manual-verification__actions">
            {onRevealBrowserHelper && (
              <button
                className="button button--secondary"
                disabled={disabled}
                onClick={onRevealBrowserHelper}
                type="button"
              >
                Mở thư mục tiện ích
              </button>
            )}
            {onSwitchToText && (
              <button
                className="button button--secondary"
                disabled={disabled || manualVerificationState === 'opening'}
                onClick={onSwitchToText}
                type="button"
              >
                Chuyển sang Dán nội dung
              </button>
            )}
          </div>
        </div>
      )}

      {progress && busy && (
        <div className="story-progress" role="status">
          <span className="spinner spinner--small" />
          <span>{progress.message}</span>
          {progress.total > 0 && <strong>{progress.completed}/{progress.total}</strong>}
          <button className="button-link" onClick={onCancel} type="button">Hủy</button>
        </div>
      )}

      {analysis && (
        <div className="story-catalog">
          <div className="story-catalog__summary">
            <div>
              <strong>{analysis.bookTitle}</strong>
              <span>{siteLabel(analysis.site)} · {selectableChapters.length.toLocaleString('vi-VN')} chương{analysis.author ? ` · ${analysis.author}` : ''}</span>
            </div>
            <span className="field-badge">{analysis.inputKind === 'chapter' ? 'Link chương' : 'Link bộ'}</span>
          </div>

          {showCatalogManualVerification && (
            <div className="inline-notice inline-notice--info story-catalog__reconnect" role="alert">
              <Icon name="alert" />
              <span>{manualVerificationIssue || `Phiên ${verificationLabel} cần kết nối lại bằng trình duyệt mặc định trước khi tải tiếp các chương đã chọn.`}</span>
              <button
                className="button button--secondary"
                disabled={disabled}
                onClick={retryCurrentBrowser ? onFetchAndTranslate : onOpenManualVerification}
                type="button"
              >
                {retryCurrentBrowser ? 'Tải lại chương' : 'Kết nối lại'}
              </button>
              {onRevealBrowserHelper && (
                <button className="button button--secondary" disabled={disabled} onClick={onRevealBrowserHelper} type="button">
                  Mở thư mục tiện ích
                </button>
              )}
            </div>
          )}

          {analysis.verification === 'user-action-required' && (
            <div className="inline-notice inline-notice--info">
              <Icon name="alert" />
              <span>Phiên {siteLabel(analysis.site)} cần được kết nối qua trình duyệt mặc định. Hãy dùng nút kết nối ở phía trên rồi để tool tự phân tích lại link.</span>
            </div>
          )}

          {analysis.notices.length > 0 && (
            <ul className="story-notices">
              {analysis.notices.map((notice) => <li key={notice}>{notice}</li>)}
            </ul>
          )}

          <div className="story-catalog__toolbar">
            <span><strong>{selectedCount}</strong> chương đã chọn</span>
            <button className="button-link" onClick={onSelectAll} type="button">Chọn tất cả</button>
            <button className="button-link" onClick={onClearSelection} type="button">Bỏ chọn</button>
            <RangeSelector maximum={selectableChapters.length} onApply={onSelectRange} />
          </div>

          <div className="story-chapter-list" role="group" aria-label="Danh sách chương từ website">
            {analysis.chapters.map((chapter) => (
              <label className={chapter.isIntroduction ? 'is-introduction' : ''} key={chapter.id}>
                <input
                  checked={selectedChapterIds.has(chapter.id)}
                  disabled={busy || disabled}
                  type="checkbox"
                  onChange={() => onToggleChapter(chapter.id)}
                />
                <span>
                  <strong>{chapter.numberLabel || `Mục ${chapter.order + 1}`}</strong>
                  <small>{chapter.title || (chapter.isIntroduction ? 'Nội dung giới thiệu' : 'Chưa có tiêu đề')}</small>
                </span>
                {chapter.partUrls.length > 1 && <em>{chapter.partUrls.length} phần</em>}
              </label>
            ))}
          </div>

          <div className="story-export-row">
            <button className="button button--secondary" disabled={busy || disabled} onClick={onChooseDirectory} type="button">
              <Icon name="download" /> {exportDirectory ? 'Đổi thư mục lưu' : 'Chọn thư mục lưu'}
            </button>
            <span title={exportDirectory}>{exportDirectory || 'Chưa chọn thư mục; file chỉ được tạo sau khi dịch và kiểm tra.'}</span>
            <button
              className="button button--primary"
              disabled={!selectedCount || !exportDirectory || busy || disabled}
              onClick={onFetchAndTranslate}
              type="button"
            >
              {state === 'fetching' ? <span className="spinner spinner--small" /> : <Icon name="sparkles" />}
              Tải, dịch và lưu
            </button>
          </div>

          <div className="story-export-options" role="group" aria-label="Tùy chọn xuất chương">
            <label>
              <input
                checked={exportOriginalChapters}
                disabled={busy || disabled}
                type="checkbox"
                onChange={(event) => onExportOriginalChaptersChange(event.target.checked)}
              />
              <span>
                <strong>Lưu chương dịch gốc chưa chia</strong>
              </span>
            </label>
            <label>
              <input
                checked={exportCombinedChapters}
                disabled={busy || disabled}
                type="checkbox"
                onChange={(event) => onExportCombinedChaptersChange(event.target.checked)}
              />
              <span>
                <strong>Xuất file tổng hợp chương đã chia</strong>
              </span>
            </label>
            <label>
              <input
                checked={omitOutputChapterTitles}
                disabled={busy || disabled}
                type="checkbox"
                onChange={(event) => onOmitOutputChapterTitlesChange?.(event.target.checked)}
              />
              <span>
                <strong>Không lấy tên chương</strong>
              </span>
            </label>
            <label>
              <input
                checked={exportCombinedSourceChapters}
                disabled={busy || disabled}
                type="checkbox"
                onChange={(event) => onExportCombinedSourceChaptersChange?.(event.target.checked)}
              />
              <span>
                <strong>Lưu file tổng các chương gốc</strong>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeSelector({ maximum, onApply }: { maximum: number; onApply(start: number, end: number): void }) {
  return (
    <form
      className="story-range"
      aria-label="Chọn theo vị trí trong mục lục"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const start = Number(data.get('start'));
        const end = Number(data.get('end'));
        if (Number.isFinite(start) && Number.isFinite(end)) onApply(start, end);
      }}
    >
      <input aria-label="Từ chương" defaultValue={1} max={maximum || 1} min={1} name="start" type="number" />
      <span>–</span>
      <input aria-label="Đến chương" defaultValue={maximum || 1} max={maximum || 1} min={1} name="end" type="number" />
      <button className="button-link" disabled={!maximum} type="submit">Áp dụng</button>
    </form>
  );
}
