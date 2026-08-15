import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeTextLanguage, constructTitle, LANGUAGE_OPTIONS, parseChapterHeaderLine, splitStory } from '../../../core';
import type { Chapter, InputLanguage, SplitConfig } from '../../../shared';
import { Icon } from '../../components/Icon';
import { StatusPill } from '../../components/StatusPill';
import { getStoryTool, hasStoryTool } from '../../ipc';

interface ChapterSplitterProps {
  config: SplitConfig;
  sourceText: string;
  onConfigChange: (config: SplitConfig) => void;
  /** A source heading such as “Chương 50: …” can seed output numbering. */
  onDetectedChapterStart?: (chapterNumber: number) => void;
  /** Reports the independently rebuilt preview for each durable translation checkpoint. */
  onCheckpoint?: (checkpoint: SplitCheckpoint) => void;
}

export interface SplitCheckpoint {
  status: 'idle' | 'splitting' | 'ready' | 'error';
  sourceCharacters: number;
  chapterCount: number;
  wordCount: number;
  updatedAt?: number;
  error?: string;
}

interface SplitWorkerRequest {
  id: number;
  sourceText: string;
  config: SplitConfig;
}

interface SplitWorkerResponse {
  id: number;
  chapters?: Chapter[];
  error?: string;
}

function normalizedSplitConfig(config: SplitConfig): SplitConfig {
  return {
    ...config,
    startIndex: Math.max(1, config.startIndex || 1),
    targetWords: Math.max(1, config.targetWords || 800),
  };
}

function composeChapters(chapters: Chapter[]): string {
  return chapters
    .map((chapter) => `${chapter.title.trim()}\n\n${chapter.content.trim()}`.trim())
    .join('\n\n\n');
}

function sourceChapterNumber(text: string): number | undefined {
  return text
    .split(/\r\n|\r|\n/u)
    .slice(0, 8)
    .map((line) => parseChapterHeaderLine(line)?.chapterNumber)
    .find((number): number is number => typeof number === 'number' && number > 0);
}

function HanHighlightedText({ text }: { text: string }) {
  const pieces = text.split(/(\p{Script=Han}+)/gu);
  return (
    <div className="highlighted-content" aria-label="Nội dung có tô chữ Hán">
      {pieces.map((piece, index) =>
        /\p{Script=Han}/u.test(piece)
          ? <mark key={`${index}-${piece.slice(0, 8)}`}>{piece}</mark>
          : <span key={`${index}-${piece.slice(0, 8)}`}>{piece}</span>,
      )}
    </div>
  );
}

export function ChapterSplitter({ config, sourceText, onConfigChange, onCheckpoint, onDetectedChapterStart }: ChapterSplitterProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [highlightHan, setHighlightHan] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isNaming, setIsNaming] = useState(false);
  const [showGeminiSettings, setShowGeminiSettings] = useState(false);
  const [geminiHasKey, setGeminiHasKey] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash');
  const [isSavingGemini, setIsSavingGemini] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const latestRequestRef = useRef<SplitWorkerRequest | null>(null);
  const latestRequestIdRef = useRef(0);
  const onCheckpointRef = useRef(onCheckpoint);
  const onDetectedChapterStartRef = useRef(onDetectedChapterStart);
  const detectedSourceTextRef = useRef('');

  useEffect(() => {
    onCheckpointRef.current = onCheckpoint;
  }, [onCheckpoint]);

  useEffect(() => {
    onDetectedChapterStartRef.current = onDetectedChapterStart;
  }, [onDetectedChapterStart]);

  const applySplitResult = useCallback((request: SplitWorkerRequest, response: SplitWorkerResponse) => {
    if (response.id !== latestRequestIdRef.current) return;
    if (response.error) {
      setNotice({ tone: 'danger', text: response.error });
      setIsRefreshing(false);
      onCheckpointRef.current?.({
        status: 'error',
        sourceCharacters: request.sourceText.length,
        chapterCount: 0,
        wordCount: 0,
        updatedAt: Date.now(),
        error: response.error,
      });
      return;
    }

    const next = response.chapters ?? [];
    const detectedChapterNumber = next.find((chapter) => chapter.source?.header)?.source?.header?.chapterNumber
      ?? sourceChapterNumber(request.sourceText);
    // Only seed once for each distinct source text. A config update triggers a
    // second split, and must not continuously overwrite a user's settings.
    if (
      typeof detectedChapterNumber === 'number'
      && detectedChapterNumber > 0
      && detectedSourceTextRef.current !== request.sourceText
    ) {
      detectedSourceTextRef.current = request.sourceText;
      onDetectedChapterStartRef.current?.(detectedChapterNumber);
    }
    setChapters(next);
    setSelectedId((current) => next.some((chapter) => chapter.id === current) ? current : (next[0]?.id ?? ''));
    setNotice(null);
    setIsRefreshing(false);
    onCheckpointRef.current?.({
      status: 'ready',
      sourceCharacters: request.sourceText.length,
      chapterCount: next.length,
      wordCount: next.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      updatedAt: Date.now(),
    });
  }, []);

  const splitOnRendererFallback = useCallback((request: SplitWorkerRequest) => {
    window.setTimeout(() => {
      try {
        applySplitResult(request, {
          id: request.id,
          chapters: splitStory(request.sourceText, normalizedSplitConfig(request.config)),
        });
      } catch (error) {
        applySplitResult(request, {
          id: request.id,
          error: error instanceof Error ? error.message : 'Không thể chia chương với cấu hình hiện tại.',
        });
      }
    }, 0);
  }, [applySplitResult]);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./chapterSplit.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<SplitWorkerResponse>) => {
        const request = latestRequestRef.current;
        if (!request || event.data.id !== request.id) return;
        applySplitResult(request, event.data);
      };
      worker.onerror = () => {
        const request = latestRequestRef.current;
        workerRef.current = null;
        worker.terminate();
        if (request) splitOnRendererFallback(request);
      };
      return () => {
        if (workerRef.current === worker) workerRef.current = null;
        worker.terminate();
      };
    } catch {
      // The app remains usable in browser-test/dev environments without Worker.
      return;
    }
  }, [applySplitResult, splitOnRendererFallback]);

  useEffect(() => {
    if (!sourceText.trim()) {
      latestRequestIdRef.current += 1;
      latestRequestRef.current = null;
      detectedSourceTextRef.current = '';
      setChapters([]);
      setSelectedId('');
      setIsRefreshing(false);
      onCheckpointRef.current?.({ status: 'idle', sourceCharacters: 0, chapterCount: 0, wordCount: 0 });
      return;
    }

    const request: SplitWorkerRequest = {
      id: latestRequestIdRef.current + 1,
      sourceText,
      config: normalizedSplitConfig(config),
    };
    latestRequestIdRef.current = request.id;
    latestRequestRef.current = request;
    setIsRefreshing(true);
    onCheckpointRef.current?.({
      status: 'splitting',
      sourceCharacters: sourceText.length,
      chapterCount: 0,
      wordCount: 0,
    });
    const timer = window.setTimeout(() => {
      if (workerRef.current) {
        workerRef.current.postMessage(request);
      } else {
        splitOnRendererFallback(request);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [sourceText, config, splitOnRendererFallback]);

  const selectedIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === selectedId));
  const selectedChapter = chapters[selectedIndex];
  const totalWords = useMemo(() => chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0), [chapters]);
  const hanCount = useMemo(() => (sourceText.match(/\p{Script=Han}/gu) ?? []).length, [sourceText]);

  useEffect(() => {
    if (!hasStoryTool()) return;
    const api = getStoryTool();
    if (!api.getGeminiConfig) return;
    void api.getGeminiConfig()
      .then((configuration) => {
        setGeminiHasKey(configuration.hasApiKey);
        if (configuration.model) setGeminiModel(configuration.model);
      })
      .catch(() => undefined);
  }, []);

  const updateConfig = <Key extends keyof SplitConfig>(key: Key, value: SplitConfig[Key]) => {
    onConfigChange({ ...config, [key]: value });
  };

  const updateChapter = (id: string, patch: Partial<Chapter>) => {
    setChapters((current) => current.map((chapter) => chapter.id === id ? { ...chapter, ...patch } : chapter));
  };

  const selectRelativeChapter = (offset: number) => {
    const nextChapter = chapters[selectedIndex + offset];
    if (nextChapter) setSelectedId(nextChapter.id);
  };

  const changeChapterContent = (chapter: Chapter, content: string) => {
    const wordCount = analyzeTextLanguage(content, config.inputLanguage).totalWords;
    updateChapter(chapter.id, { content, wordCount });
  };

  const copyAll = async () => {
    if (!chapters.length) return;
    try {
      await navigator.clipboard.writeText(composeChapters(chapters));
      setNotice({ tone: 'success', text: 'Đã sao chép toàn bộ bản chia chương.' });
    } catch {
      setNotice({ tone: 'danger', text: 'Không thể truy cập clipboard.' });
    }
  };

  const exportAll = async () => {
    if (!chapters.length) return;
    try {
      const result = await getStoryTool().exportText({
        content: composeChapters(chapters),
        defaultName: 'truyen-da-chia.txt',
      });
      if (!result.canceled) {
        setNotice({ tone: 'success', text: result.filePath ? `Đã lưu tại ${result.filePath}` : 'Đã xuất tệp TXT.' });
      }
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Không thể xuất tệp TXT.' });
    }
  };

  const generateTitles = async () => {
    if (!chapters.length || isNaming) return;
    setIsNaming(true);
    setNotice({ tone: 'info', text: 'Gemini đang đọc phần đầu của từng chương…' });
    try {
      const result = await getStoryTool().generateTitles({
        chapters: chapters.map((chapter) => ({ id: chapter.id, content: chapter.content })),
      });
      if (!Array.isArray(result.titles) || result.titles.length !== chapters.length) {
        throw new Error(`Gemini trả về ${result.titles?.length ?? 0}/${chapters.length} tiêu đề; tên cũ được giữ nguyên.`);
      }
      setChapters((current) => current.map((chapter, index) => {
        const suggestion = result.titles[index]?.replace(/[\r\n]+/g, ' ').trim();
        return suggestion ? { ...chapter, title: constructTitle(chapter.index, suggestion, config.prefix) } : chapter;
      }));
      setNotice({ tone: 'success', text: `Đã đặt tên bằng ${result.model || 'Gemini'}. Bạn có thể sửa lại trước khi xuất.` });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error
          ? error.message
          : 'Không thể tạo tiêu đề. Hãy kiểm tra Gemini API key trong phần cài đặt.',
      });
    } finally {
      setIsNaming(false);
    }
  };

  const saveGeminiConfiguration = async () => {
    if (!hasStoryTool()) {
      setNotice({ tone: 'danger', text: 'Hãy mở giao diện trong ứng dụng desktop để lưu cấu hình Gemini.' });
      return;
    }
    const api = getStoryTool();
    if (!api.configureGemini) {
      setNotice({ tone: 'danger', text: 'Bản ứng dụng này chưa hỗ trợ lưu cấu hình Gemini.' });
      return;
    }
    setIsSavingGemini(true);
    try {
      const result = await api.configureGemini({
        model: geminiModel.trim(),
        ...(geminiApiKey.trim() ? { apiKey: geminiApiKey.trim() } : {}),
      });
      setGeminiHasKey(result.hasApiKey);
      setGeminiModel(result.model);
      setGeminiApiKey('');
      setShowGeminiSettings(false);
      setNotice({ tone: 'success', text: 'Đã lưu cấu hình Gemini an toàn trên thiết bị.' });
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Không thể lưu cấu hình Gemini.' });
    } finally {
      setIsSavingGemini(false);
    }
  };

  return (
    <section className="splitter panel" aria-labelledby="splitter-heading">
      <div className="panel__heading panel__heading--splitter">
        <div>
          <span className="eyebrow">Công cụ biên tập</span>
          <h2 id="splitter-heading"><Icon name="split" /> Chia chương tự động</h2>
          <p>
            Chỉ chia tại ranh giới đoạn xuống dòng; không cắt giữa từ, câu hay lời thoại.
            Hãy xuống dòng thường xuyên để số chữ mỗi chương ổn định hơn.
          </p>
        </div>
        <div className="splitter__summary">
          <span><strong>{chapters.length}</strong> chương</span>
          <span><strong>{totalWords.toLocaleString('vi-VN')}</strong> chữ</span>
          <span className={hanCount ? 'text-danger' : ''}><strong>{hanCount}</strong> chữ Hán</span>
        </div>
      </div>

      <div className="splitter-config">
        <label>
          <span>Số chữ/chương</span>
          <input
            min={1}
            type="number"
            value={config.targetWords}
            onChange={(event) => updateConfig('targetWords', Math.max(0, Number(event.target.value)))}
          />
        </label>
        <label>
          <span>Chương bắt đầu</span>
          <input
            min={1}
            type="number"
            value={config.startIndex}
            onChange={(event) => updateConfig('startIndex', Math.max(0, Number(event.target.value)))}
          />
        </label>
        <label>
          <span>Tiền tố</span>
          <input
            type="text"
            value={config.prefix}
            onChange={(event) => updateConfig('prefix', event.target.value)}
            placeholder="Quyển 1"
          />
        </label>
        <label>
          <span>Hậu tố mặc định</span>
          <input
            type="text"
            value={config.suffix}
            onChange={(event) => updateConfig('suffix', event.target.value)}
            placeholder=": Tên chương"
          />
        </label>
        <label>
          <span>Ngôn ngữ đếm chữ</span>
          <select
            value={config.inputLanguage}
            onChange={(event) => updateConfig('inputLanguage', event.target.value as InputLanguage)}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.flag} {option.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="splitter-toolbar">
        <label className="switch-label">
          <input
            checked={config.autoDetectTitle}
            type="checkbox"
            onChange={(event) => updateConfig('autoDetectTitle', event.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
          Nhận diện tiêu đề có sẵn
        </label>
        <label className="switch-label">
          <input checked={highlightHan} type="checkbox" onChange={(event) => setHighlightHan(event.target.checked)} />
          <span className="switch" aria-hidden="true" />
          Tô đỏ chữ Hán
        </label>
        <span className="toolbar-spacer" />
        <button className="button button--secondary" onClick={() => setShowGeminiSettings((value) => !value)} type="button">
          <Icon name="wand" /> {geminiHasKey ? 'Gemini đã cấu hình' : 'Cấu hình Gemini'}
        </button>
        <button className="button button--secondary" disabled={!chapters.length || isNaming} onClick={generateTitles} type="button">
          <Icon name="sparkles" /> {isNaming ? 'Đang đặt tên…' : 'Đặt tên bằng Gemini'}
        </button>
        <button className="button button--secondary" disabled={!chapters.length} onClick={copyAll} type="button">
          <Icon name="copy" /> Sao chép
        </button>
        <button className="button button--primary" disabled={!chapters.length} onClick={exportAll} type="button">
          <Icon name="download" /> Xuất TXT
        </button>
      </div>

      {showGeminiSettings && (
        <div className="gemini-settings" role="group" aria-label="Cấu hình Gemini">
          <div>
            <strong>Đặt tên chương bằng Gemini</strong>
            <span>API key được mã hóa bằng cơ chế bảo mật của Windows và không đưa vào giao diện web.</span>
          </div>
          <label>
            <span>Model</span>
            <input value={geminiModel} onChange={(event) => setGeminiModel(event.target.value)} placeholder="gemini-3.6-flash" />
          </label>
          <label>
            <span>{geminiHasKey ? 'API key mới (để trống để giữ khóa cũ)' : 'Gemini API key'}</span>
            <input
              autoComplete="off"
              type="password"
              value={geminiApiKey}
              onChange={(event) => setGeminiApiKey(event.target.value)}
              placeholder={geminiHasKey ? 'Đã lưu an toàn' : 'Nhập khóa từ Google AI Studio'}
            />
          </label>
          <button className="button button--primary" disabled={isSavingGemini || !geminiModel.trim()} onClick={saveGeminiConfiguration} type="button">
            {isSavingGemini ? <span className="spinner spinner--small" /> : <Icon name="check" />} Lưu cấu hình
          </button>
        </div>
      )}

      {notice && (
        <div className={`inline-notice inline-notice--${notice.tone}`} role="status">
          {notice.tone === 'danger' ? <Icon name="alert" /> : notice.tone === 'success' ? <Icon name="check" /> : <Icon name="sparkles" />}
          <span>{notice.text}</span>
        </div>
      )}

      {!sourceText.trim() ? (
        <div className="empty-state">
          <Icon name="book" size={30} />
          <strong>Chưa có nội dung để chia</strong>
          <span>Bản dịch sẽ tự động xuất hiện ở đây sau khi bạn nhập hoặc dịch truyện.</span>
        </div>
      ) : isRefreshing && chapters.length === 0 ? (
        <div className="empty-state"><span className="spinner" /> Đang chia theo đoạn văn…</div>
      ) : chapters.length > 0 && selectedChapter ? (
        <div className="chapter-workbench">
          <aside className="chapter-nav" aria-label="Danh sách chương">
            <div className="chapter-nav__heading">
              <strong>Danh sách chương</strong>
              {isRefreshing && <span className="spinner spinner--small" title="Đang cập nhật" />}
            </div>
            <div className="chapter-nav__list">
              {chapters.map((chapter) => (
                <button
                  className={chapter.id === selectedChapter.id ? 'is-active' : ''}
                  key={chapter.id}
                  onClick={() => setSelectedId(chapter.id)}
                  type="button"
                >
                  <span>{chapter.index}</span>
                  <span><strong>{chapter.title}</strong><small>{chapter.wordCount} chữ</small></span>
                </button>
              ))}
            </div>
          </aside>

          <div className="chapter-editor">
            <div className="chapter-editor__topline">
              <StatusPill tone={hanCount ? 'warning' : 'success'}>
                {highlightHan ? 'Đang xem kiểm lỗi' : 'Đang chỉnh sửa'}
              </StatusPill>
              <div className="chapter-pager">
                <button
                  aria-label="Chương trước"
                  className="icon-button"
                  disabled={selectedIndex === 0}
                  onClick={() => selectRelativeChapter(-1)}
                  type="button"
                ><Icon name="chevron-left" /></button>
                <span>{selectedIndex + 1} / {chapters.length}</span>
                <button
                  aria-label="Chương sau"
                  className="icon-button"
                  disabled={selectedIndex === chapters.length - 1}
                  onClick={() => selectRelativeChapter(1)}
                  type="button"
                ><Icon name="chevron-right" /></button>
              </div>
            </div>
            <label className="chapter-title-field">
              <span>Tiêu đề chương</span>
              <input
                type="text"
                value={selectedChapter.title}
                onChange={(event) => updateChapter(selectedChapter.id, { title: event.target.value })}
              />
            </label>
            {highlightHan ? (
              <HanHighlightedText text={selectedChapter.content} />
            ) : (
              <textarea
                className="chapter-content-editor"
                value={selectedChapter.content}
                onChange={(event) => changeChapterContent(selectedChapter, event.target.value)}
                aria-label={`Nội dung ${selectedChapter.title}`}
              />
            )}
            <div className="chapter-editor__footer">
              <span>{selectedChapter.wordCount.toLocaleString('vi-VN')} chữ</span>
              {highlightHan && <span>Tắt “Tô đỏ chữ Hán” để sửa nội dung chương này.</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state"><Icon name="alert" /> Không tạo được chương. Hãy kiểm tra lại cấu hình.</div>
      )}
    </section>
  );
}
