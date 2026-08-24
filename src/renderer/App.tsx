import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeTextLanguage,
  renumberFinalExportChapters,
  renumberOriginalExportChapters,
  splitSealedChapters,
  splitSealedOriginalChapters,
} from '../core';
import type {
  ChapterExportRecord,
  CombinedChapterExportResult,
  FinalChapterExportInput,
  PromptMode,
  SplitConfig,
  StorySourceAnalysis,
  StorySourceProgress,
  TranslationActivityEntry,
  TranslationJobSnapshot,
  AiProvider,
} from '../shared';
import {
  chapterContentFingerprint,
  combinedChapterContentFingerprint,
} from '../shared/exportIntegrity';
import { Icon } from './components/Icon';
import { StatusPill } from './components/StatusPill';
import { ChapterSplitter, type SplitCheckpoint } from './features/splitter/ChapterSplitter';
import {
  StoryLinkImporter,
  type ManualVerificationState,
  type StoryImportState,
} from './features/source/StoryLinkImporter';
import { PromptSelector } from './features/translation/PromptSelector';
import {
  type SegmentError,
  TranslationControls,
  type TranslationState,
} from './features/translation/TranslationControls';
import { getStoryTool, hasStoryTool, type TranslationEvent } from './ipc';

type ConnectionState = 'disconnected' | 'connecting' | 'login-required' | 'connected' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface RendererDraft {
  version: 2;
  source: string;
  output: string;
  promptMode: PromptMode;
  customPrompt: string;
  splitConfig: SplitConfig;
  sourceMode: 'text' | 'link';
  storyUrl: string;
  exportDirectory: string;
  /** Keep a source-chapter copy beside the split chapter exports. */
  exportOriginalChapters: boolean;
  /** Create the final all-split-chapters compilation once the job completes. */
  exportCombinedChapters: boolean;
  /** Create one compilation from the immutable untranslated source chapters. */
  exportCombinedSourceChapters?: boolean;
  /** Optional first number for renamed link-chapter exports. Undefined preserves source numbers. */
  outputChapterStart?: number;
  /** Omit descriptive chapter names from automatic link-chapter exports. */
  omitOutputChapterTitles?: boolean;
  /** Immutable copy of outputChapterStart captured when this link job began. */
  autoExportOutputChapterStart?: number;
  /** Immutable copy of the title omission option captured when this link job began. */
  autoExportOmitOutputChapterTitles?: boolean;
  autoExportJobId: string;
  autoExportStartedAt: number;
  /** Original selected website chapter range; split indexes are unrelated. */
  autoExportRange?: ExportRange;
  /** Immutable runner checkpoint used for automatic exports, never editor text. */
  autoExportOutput?: string;
  /** A clean sibling folder selected only after a conflicting old TXT is found. */
  autoExportResolvedDirectory?: string;
  /** Split 750--800 word files that were safely published already. */
  exportedRecords: ChapterExportRecord[];
  /** Whole translated source chapters published beside the split files. */
  originalExportedRecords: ChapterExportRecord[];
  /** The idempotent, final aggregate file, if it has been published. */
  combinedExport?: CombinedChapterExportResult;
  /** The idempotent aggregate of untranslated website chapters. */
  combinedSourceExport?: CombinedChapterExportResult;
  updatedAt: number;
}

interface SegmentOutput {
  order: number;
  text: string;
}

const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  targetWords: 800,
  prefix: '',
  suffix: '',
  startIndex: 1,
  inputLanguage: 'vi',
  // A pasted/translated chapter normally includes its real heading. Detect it
  // by default so “Chương 50: …” seeds both the title and start number.
  autoDetectTitle: true,
  useAI: false,
};

const DEFAULT_PROMPTS = { period: '', modern: '', ancient: '', cultivation: '' };
const COLOR_THEME_STORAGE_KEY = 'tool-dich-truyen:color-theme';

type ExportableChapter = FinalChapterExportInput;
interface ExportRange {
  startChapter: number;
  endChapter: number;
  /** Exact source chapter numbers, kept only when the selection has no gaps. */
  sourceChapterNumbers: number[];
}

function exportRecordKey(record: Pick<ChapterExportRecord, 'exportJobId' | 'exportDirectory' | 'contentHash'>): string {
  return `${record.exportJobId}\u0000${record.exportDirectory}\u0000${record.contentHash}`;
}

function exportInputKey(
  jobId: string,
  directory: string,
  chapter: Pick<FinalChapterExportInput, 'index' | 'sourceChapterNumber' | 'title' | 'content' | 'wordCount'>,
): string {
  return `${jobId}\u0000${directory}\u0000${chapterContentFingerprint(chapter)}`;
}

function exportInput(chapter: ExportableChapter): FinalChapterExportInput {
  return {
    index: chapter.index,
    ...(chapter.sourceChapterNumber === undefined ? {} : { sourceChapterNumber: chapter.sourceChapterNumber }),
    title: chapter.title,
    content: chapter.content,
    wordCount: chapter.wordCount,
  };
}

function isChapterExportRecord(value: unknown): value is ChapterExportRecord {
  const candidate = asRecord(value);
  return typeof candidate.exportJobId === 'string'
    && typeof candidate.exportDirectory === 'string'
    && /^[a-f0-9]{64}$/u.test(String(candidate.contentHash))
    && typeof candidate.filePath === 'string'
    && typeof candidate.fileName === 'string'
    && typeof candidate.index === 'number'
    && (candidate.sourceChapterNumber === undefined
      || (typeof candidate.sourceChapterNumber === 'number'
        && Number.isSafeInteger(candidate.sourceChapterNumber)
        && candidate.sourceChapterNumber > 0))
    && typeof candidate.title === 'string'
    && typeof candidate.wordCount === 'number'
    && (candidate.status === 'saved' || candidate.status === 'skipped-existing');
}

function isCombinedExportResult(value: unknown): value is CombinedChapterExportResult {
  const candidate = asRecord(value);
  return typeof candidate.directory === 'string'
    && typeof candidate.exportDirectory === 'string'
    && typeof candidate.exportJobId === 'string'
    && /^[a-f0-9]{64}$/u.test(String(candidate.contentHash))
    && typeof candidate.fileName === 'string'
    && typeof candidate.filePath === 'string'
    && typeof candidate.startChapter === 'number'
    && typeof candidate.endChapter === 'number'
    && typeof candidate.chapterCount === 'number'
    && (candidate.status === 'saved' || candidate.status === 'skipped-existing');
}

function isExportRange(value: unknown): value is ExportRange {
  const candidate = asRecord(value);
  if (!Number.isSafeInteger(candidate.startChapter)
    || !Number.isSafeInteger(candidate.endChapter)
    || Number(candidate.startChapter) <= 0
    || Number(candidate.endChapter) < Number(candidate.startChapter)) return false;
  const count = Number(candidate.endChapter) - Number(candidate.startChapter) + 1;
  return Array.isArray(candidate.sourceChapterNumbers)
    && candidate.sourceChapterNumbers.length === count
    && candidate.sourceChapterNumbers.every((value, index) => value === Number(candidate.startChapter) + index);
}

/**
 * The website importer injects stable `Chương N` headers before text is sent
 * to ChatGPT.  Keep the source range separate from generated split indexes:
 * one source chapter can become multiple 750--800 word TXT files.
 */
function sourceChapterRange(source: string, config: SplitConfig): ExportRange | undefined {
  const chapters = splitSealedOriginalChapters(source, {
    ...config,
    inputLanguage: 'vi',
    autoDetectTitle: true,
  }, true);
  if (!chapters.length) return undefined;
  const numbers = chapters
    .map((chapter) => chapter.index)
    .filter((index) => Number.isSafeInteger(index) && index > 0);
  if (!numbers.length) return undefined;
  const uniqueNumbers = [...new Set(numbers)].sort((left, right) => left - right);
  const startChapter = uniqueNumbers[0];
  const endChapter = uniqueNumbers.at(-1);
  if (startChapter === undefined || endChapter === undefined) return undefined;
  const expectedCount = endChapter - startChapter + 1;
  // A summary named "152-155" must contain exactly 152,153,154,155. A
  // user may deliberately choose 152 and 155, but the individual exports
  // remain correct while the ambiguous combined TXT is disabled.
  if (uniqueNumbers.length !== expectedCount) return undefined;
  return { startChapter, endChapter, sourceChapterNumbers: uniqueNumbers };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'number' && Number.isFinite(record[key])) return record[key] as number;
  }
  return undefined;
}

function asActivityEntry(value: unknown): TranslationActivityEntry | undefined {
  const entry = asRecord(value);
  if (
    typeof entry.at !== 'string'
    || typeof entry.message !== 'string'
    || !['info', 'warning', 'error', 'success'].includes(String(entry.tone))
  ) return undefined;
  return {
    at: entry.at,
    message: entry.message,
    tone: entry.tone as TranslationActivityEntry['tone'],
    ...(typeof entry.segmentId === 'string' ? { segmentId: entry.segmentId } : {}),
    ...(typeof entry.segmentIndex === 'number' ? { segmentIndex: entry.segmentIndex } : {}),
  };
}

function optionalChapterNumber(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= 999_999
    ? value
    : undefined;
}

function latestRecoverableTranslation(jobs: TranslationJobSnapshot[]): TranslationJobSnapshot | undefined {
  return jobs
    .filter((job) => job.status === 'queued' || job.status === 'running' || job.status === 'paused')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function isActiveTranslationConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:hoàn tất|hủy).*tác vụ dịch hiện tại|tác vụ dịch hiện tại.*(?:hoàn tất|hủy)/iu.test(message);
}

function normalizeMode(value: unknown): PromptMode {
  return value === 'period' || value === 'modern' || value === 'ancient' || value === 'cultivation' || value === 'custom' ? value : 'period';
}

function loadSplitConfig(value: unknown): SplitConfig {
  const record = asRecord(value);
  const inputLanguage = ['vi', 'en', 'zh', 'ja', 'ko'].includes(String(record.inputLanguage))
    ? record.inputLanguage as SplitConfig['inputLanguage']
    : DEFAULT_SPLIT_CONFIG.inputLanguage;
  return {
    ...DEFAULT_SPLIT_CONFIG,
    targetWords: typeof record.targetWords === 'number' ? record.targetWords : DEFAULT_SPLIT_CONFIG.targetWords,
    prefix: typeof record.prefix === 'string' ? record.prefix : '',
    suffix: typeof record.suffix === 'string' ? record.suffix : '',
    startIndex: typeof record.startIndex === 'number' ? record.startIndex : DEFAULT_SPLIT_CONFIG.startIndex,
    inputLanguage,
    autoDetectTitle: typeof record.autoDetectTitle === 'boolean' ? record.autoDetectTitle : true,
    useAI: false,
  };
}

function aiProviderLabel(provider: AiProvider): string {
  return provider === 'kimi' ? 'Kimi AI' : 'ChatGPT';
}

function connectionPresentation(state: ConnectionState, provider: AiProvider) {
  const label = aiProviderLabel(provider);
  switch (state) {
    case 'connected': return { label: `${label} đã kết nối`, tone: 'success' as const };
    case 'connecting': return { label: `Đang mở ${label}…`, tone: 'info' as const };
    case 'login-required': return { label: `Chờ đăng nhập ${label}`, tone: 'warning' as const };
    case 'error': return { label: 'Kết nối có lỗi', tone: 'danger' as const };
    default: return { label: `Chưa kết nối ${label}`, tone: 'neutral' as const };
  }
}

type ManualVerificationSite = 'huliwang' | 'xszj';

/**
 * This is only a renderer convenience guard. The main process validates the
 * URL again before pairing with the OS-default browser. Both verified XSZJ
 * host families are kept explicit; this is not a generic browser gateway.
 */
function manualVerificationSite(value: string): ManualVerificationSite | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (['huliwang.net', 'm.huliwang.net', 'www.huliwang.net'].includes(hostname)) return 'huliwang';
    if (['xszj.org', 'www.xszj.org', 'ixdzs8.com', 'www.ixdzs8.com'].includes(hostname)) return 'xszj';
    return undefined;
  } catch {
    return undefined;
  }
}

function manualVerificationSiteLabel(site: ManualVerificationSite): string {
  return site === 'huliwang' ? 'Huliwang' : 'XSZJ/爱下电子书';
}

function isCloudflareVerificationMessage(message: string): boolean {
  return /Cloudflare|Turnstile|Just a moment|security verification|xác minh|trình duyệt mặc định|tiện ích Huliwang|Huli Browser Helper|Browser Helper|tiện ích trình duyệt|kết nối tiện ích|cầu nối Huliwang|phiên bản.*tiện ích|Tải lại tiện ích|Reload|bridge/iu.test(message);
}

export default function App() {
  const [colorTheme, setColorTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem(COLOR_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [source, setSource] = useState('');
  const [output, setOutput] = useState('');
  const [sourceMode, setSourceMode] = useState<'text' | 'link'>('text');
  const [storyUrl, setStoryUrl] = useState('');
  const [storyAnalysis, setStoryAnalysis] = useState<StorySourceAnalysis | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [storyImportState, setStoryImportState] = useState<StoryImportState>('idle');
  const [storyProgress, setStoryProgress] = useState<StorySourceProgress | null>(null);
  const [manualVerificationState, setManualVerificationState] = useState<ManualVerificationState>('none');
  const [exportDirectory, setExportDirectory] = useState('');
  // Both export formats are useful safeguards for a long web translation, so
  // they are opt-out.  Old drafts without these fields retain that default.
  const [exportOriginalChapters, setExportOriginalChapters] = useState(true);
  const [exportCombinedChapters, setExportCombinedChapters] = useState(true);
  const [exportCombinedSourceChapters, setExportCombinedSourceChapters] = useState(false);
  const [outputChapterStart, setOutputChapterStart] = useState<number | undefined>();
  const [omitOutputChapterTitles, setOmitOutputChapterTitles] = useState(false);
  const [autoExportJobId, setAutoExportJobId] = useState('');
  const [autoExportStartedAt, setAutoExportStartedAt] = useState(0);
  const [autoExportRange, setAutoExportRange] = useState<ExportRange | undefined>();
  // Unlike the editable field in Step 2, this value never changes after the
  // user presses “Tải, dịch và lưu”. Every checkpoint and recovery uses it.
  const [autoExportOutputChapterStart, setAutoExportOutputChapterStart] = useState<number | undefined>();
  const [autoExportOmitOutputChapterTitles, setAutoExportOmitOutputChapterTitles] = useState(false);
  const [autoExportOutput, setAutoExportOutput] = useState('');
  const [autoExportSource, setAutoExportSource] = useState('');
  const [autoExportResolvedDirectory, setAutoExportResolvedDirectory] = useState<string | undefined>();
  const [exportedRecords, setExportedRecords] = useState<ChapterExportRecord[]>([]);
  const [originalExportedRecords, setOriginalExportedRecords] = useState<ChapterExportRecord[]>([]);
  const [combinedExport, setCombinedExport] = useState<CombinedChapterExportResult | undefined>();
  const [combinedSourceExport, setCombinedSourceExport] = useState<CombinedChapterExportResult | undefined>();
  // An export IPC call can fail transiently after the translation itself has
  // safely completed.  A tick gives the three independent exporters a new
  // render opportunity instead of leaving the last format stranded.
  const [autoExportRetryTick, setAutoExportRetryTick] = useState(0);
  const [promptMode, setPromptMode] = useState<PromptMode>('period');
  const [customPrompt, setCustomPrompt] = useState('');
  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS);
  const [splitConfig, setSplitConfig] = useState<SplitConfig>(DEFAULT_SPLIT_CONFIG);
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [aiProvider, setAiProvider] = useState<AiProvider>('chatgpt');
  const [translationState, setTranslationState] = useState<TranslationState>('idle');
  const [activeJobId, setActiveJobId] = useState('');
  const [translationHistory, setTranslationHistory] = useState<TranslationJobSnapshot[]>([]);
  const [activityLog, setActivityLog] = useState<TranslationActivityEntry[]>([]);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [isChapterDrawerOpen, setIsChapterDrawerOpen] = useState(false);
  const [completedSegments, setCompletedSegments] = useState(0);
  const [totalSegments, setTotalSegments] = useState(0);
  const [segmentErrors, setSegmentErrors] = useState<SegmentError[]>([]);
  const [canContinueFromCheckpoint, setCanContinueFromCheckpoint] = useState(false);
  const [splitCheckpoint, setSplitCheckpoint] = useState<SplitCheckpoint>({
    status: 'idle',
    sourceCharacters: 0,
    chapterCount: 0,
    wordCount: 0,
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [appNotice, setAppNotice] = useState<string>('');

  const activeJobRef = useRef('');
  const autoExportJobRef = useRef('');
  const autoExportOutputChapterStartRef = useRef<number | undefined>(undefined);
  // Events can arrive before `startTranslation()` resolves the generated id.
  // Keep the latest runner-owned text outside React's async state scheduling so
  // its checkpoint is never missed by the automatic exporter.
  const outputRef = useRef('');
  const segmentOutputsRef = useRef<Map<string, SegmentOutput>>(new Map());
  const exportingJobsRef = useRef<Set<string>>(new Set());
  const exportingOriginalJobsRef = useRef<Set<string>>(new Set());
  // A persisted record proves what a prior renderer intended to write, not
  // that the file survived a crash. Each fresh renderer therefore performs
  // one complete reconciliation pass per output snapshot and destination.
  const reconciledAutoExportsRef = useRef<Set<string>>(new Set());
  const exportingCombinedJobsRef = useRef<Set<string>>(new Set());
  const exportingCombinedSourceJobsRef = useRef<Set<string>>(new Set());
  const autoExportRetryAttemptsRef = useRef<Map<string, number>>(new Map());
  const appAvailable = hasStoryTool();

  const refreshTranslationHistory = useCallback(async () => {
    if (!appAvailable) return;
    const jobs = await getStoryTool().discoverTranslations();
    setTranslationHistory(jobs.filter((job) => job.status === 'failed' || job.status === 'cancelled'));
  }, [appAvailable]);
  const suggestedOutputChapterStart = useMemo(() => {
    if (!storyAnalysis) return undefined;
    const selectableChapters = storyAnalysis.chapters
      .filter((chapter) => !chapter.isIntroduction)
      .sort((first, second) => first.order - second.order);
    const selectedPosition = selectableChapters.findIndex((chapter) => selectedChapterIds.has(chapter.id));
    if (selectedPosition < 0) return undefined;

    const firstSelected = selectableChapters[selectedPosition];
    if (!firstSelected) return undefined;
    if (
      typeof firstSelected.number === 'number'
      && Number.isInteger(firstSelected.number)
      && firstSelected.number > 0
    ) return firstSelected.number;

    // Some catalogs expose only a display label (or no trustworthy numeric
    // field at all). A valid selection must still unlock output numbering.
    // Prefer an Arabic number visible in the label, then fall back to the
    // chapter's one-based reading position after introductions are removed.
    const labelNumber = firstSelected.numberLabel.match(/\d+/u)?.[0];
    const parsedLabelNumber = labelNumber ? Number(labelNumber) : Number.NaN;
    return Number.isInteger(parsedLabelNumber) && parsedLabelNumber > 0
      ? parsedLabelNumber
      : selectedPosition + 1;
  }, [selectedChapterIds, storyAnalysis]);

  useEffect(() => {
    activeJobRef.current = activeJobId;
  }, [activeJobId]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.dataset.theme = colorTheme;
    const setWindowTheme = getStoryTool().setWindowTheme;
    // Two frames have distinct jobs: the first commits the complete renderer
    // palette atomically; the second updates the native Windows edge. Doing
    // both before the first paint can hold the compositor on a mixed palette.
    let nativeThemeFrame = 0;
    const rendererThemeFrame = window.requestAnimationFrame(() => {
      nativeThemeFrame = window.requestAnimationFrame(() => {
        root.classList.remove('theme-switching');
        if (setWindowTheme) void setWindowTheme(colorTheme).catch(() => undefined);
      });
    });
    try {
      window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme);
    } catch {
      // Theme persistence is a convenience only; rendering must still work.
    }
    return () => {
      root.classList.remove('theme-switching');
      window.cancelAnimationFrame(rendererThemeFrame);
      if (nativeThemeFrame) window.cancelAnimationFrame(nativeThemeFrame);
    };
  }, [colorTheme]);

  useEffect(() => {
    autoExportJobRef.current = autoExportJobId;
  }, [autoExportJobId]);

  useEffect(() => {
    autoExportOutputChapterStartRef.current = autoExportOutputChapterStart;
  }, [autoExportOutputChapterStart]);

  const scheduleAutoExportRetry = useCallback((jobId: string, format: 'chapters' | 'originals' | 'combined' | 'combined-source') => {
    const key = `${jobId}:${format}`;
    const attempts = autoExportRetryAttemptsRef.current.get(key) ?? 0;
    // Initial attempt plus three bounded retry attempts.  The durable draft
    // remains linked if all three fail, so reopening the app can resume later.
    if (attempts >= 3) return;
    autoExportRetryAttemptsRef.current.set(key, attempts + 1);
    window.setTimeout(() => {
      if (autoExportJobRef.current === jobId) setAutoExportRetryTick((tick) => tick + 1);
    }, 750 * (attempts + 1));
  }, []);

  useEffect(() => {
    let alive = true;
    const initialize = async () => {
      if (!appAvailable) {
        setAppNotice('Cầu nối desktop chưa sẵn sàng. Hãy chạy giao diện trong ứng dụng Electron.');
        setPromptsLoading(false);
        setInitialized(true);
        return;
      }

      const api = getStoryTool();
      const [promptResult, draftResult] = await Promise.allSettled([api.loadPrompts(), api.getDraft()]);
      if (!alive) return;

      if (promptResult.status === 'fulfilled') {
        setPrompts(promptResult.value);
      } else {
        setAppNotice(`Không nạp được prompt mặc định: ${promptResult.reason instanceof Error ? promptResult.reason.message : 'lỗi không xác định'}`);
      }
      setPromptsLoading(false);

      if (draftResult.status === 'fulfilled' && draftResult.value) {
        const draft = asRecord(draftResult.value);
        setSource(typeof draft.source === 'string' ? draft.source : '');
        const draftOutput = typeof draft.output === 'string' ? draft.output : '';
        outputRef.current = draftOutput;
        setOutput(draftOutput);
        setPromptMode(normalizeMode(draft.promptMode));
        setCustomPrompt(typeof draft.customPrompt === 'string' ? draft.customPrompt : '');
        setSplitConfig(loadSplitConfig(draft.splitConfig));
        setSourceMode(draft.sourceMode === 'link' ? 'link' : 'text');
        setStoryUrl(typeof draft.storyUrl === 'string' ? draft.storyUrl : '');
        setExportDirectory(typeof draft.exportDirectory === 'string' ? draft.exportDirectory : '');
        setExportOriginalChapters(draft.exportOriginalChapters !== false);
        setExportCombinedChapters(draft.exportCombinedChapters !== false);
        setExportCombinedSourceChapters(draft.exportCombinedSourceChapters === true);
        const restoredOutputChapterStart = optionalChapterNumber(draft.outputChapterStart);
        setOutputChapterStart(restoredOutputChapterStart);
        const restoredOmitOutputChapterTitles = draft.omitOutputChapterTitles === true;
        setOmitOutputChapterTitles(restoredOmitOutputChapterTitles);
        const restoredAutoExportJobId = typeof draft.autoExportJobId === 'string' ? draft.autoExportJobId : '';
        // Make the persisted association available during this same startup
        // turn. A main-process checkpoint can arrive before React runs the
        // state/ref synchronization effect below.
        autoExportJobRef.current = restoredAutoExportJobId;
        setAutoExportJobId(restoredAutoExportJobId);
        // Older v2 drafts did not yet contain the immutable snapshot. Their
        // editable value is the best available migration input; once saved it
        // is converted to the frozen field below.
        const restoredAutoExportOutputChapterStart = optionalChapterNumber(draft.autoExportOutputChapterStart)
          ?? (restoredAutoExportJobId ? restoredOutputChapterStart : undefined);
        autoExportOutputChapterStartRef.current = restoredAutoExportOutputChapterStart;
        setAutoExportOutputChapterStart(restoredAutoExportOutputChapterStart);
        setAutoExportOmitOutputChapterTitles(
          typeof draft.autoExportOmitOutputChapterTitles === 'boolean'
            ? draft.autoExportOmitOutputChapterTitles
            : restoredAutoExportJobId ? restoredOmitOutputChapterTitles : false,
        );
        setAutoExportStartedAt(typeof draft.autoExportStartedAt === 'number' ? draft.autoExportStartedAt : 0);
        if (isExportRange(draft.autoExportRange)) setAutoExportRange(draft.autoExportRange);
        // v2 drafts from before incremental export do not yet have a separate
        // immutable checkpoint. Their stored output was written only from
        // runner events, so it is a safe migration fallback once.
        setAutoExportOutput(typeof draft.autoExportOutput === 'string'
          ? draft.autoExportOutput
          : restoredAutoExportJobId ? draftOutput : '');
        setAutoExportResolvedDirectory(
          typeof draft.autoExportResolvedDirectory === 'string' && draft.autoExportResolvedDirectory.trim()
            ? draft.autoExportResolvedDirectory
            : restoredAutoExportJobId && typeof draft.exportDirectory === 'string' && draft.exportDirectory.trim()
              // Migration for older drafts: once a job id exists, the folder
              // saved beside it belongs to that checkpoint. It must never fall
              // back to a folder the user later chooses for another story.
              ? draft.exportDirectory
              : undefined,
        );
        if (Array.isArray(draft.exportedRecords)) {
          setExportedRecords(draft.exportedRecords.filter(isChapterExportRecord));
        }
        if (Array.isArray(draft.originalExportedRecords)) {
          setOriginalExportedRecords(draft.originalExportedRecords.filter(isChapterExportRecord));
        }
        if (isCombinedExportResult(draft.combinedExport)) setCombinedExport(draft.combinedExport);
        if (isCombinedExportResult(draft.combinedSourceExport)) setCombinedSourceExport(draft.combinedSourceExport);
      }
      setInitialized(true);
    };

    void initialize();
    return () => { alive = false; };
  }, [appAvailable]);

  useEffect(() => {
    if (!initialized || !appAvailable) return;
    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      // Once a real checkpoint id exists, the runner already owns the exact
      // multi-megabyte source and validated output. Duplicating both strings
      // (and output a second time) in draft.json made autosave and the next
      // launch unnecessarily serialize tens of megabytes.
      const contentBackedByCheckpoint = Boolean(autoExportJobId && autoExportJobId !== 'pending');
      const draft: RendererDraft = {
        version: 2,
        source: contentBackedByCheckpoint ? '' : source,
        output: contentBackedByCheckpoint ? '' : output,
        promptMode,
        customPrompt,
        splitConfig,
        sourceMode,
        storyUrl,
        exportDirectory,
        exportOriginalChapters,
        exportCombinedChapters,
        ...(exportCombinedSourceChapters ? { exportCombinedSourceChapters: true } : {}),
        ...(outputChapterStart !== undefined ? { outputChapterStart } : {}),
        ...(omitOutputChapterTitles ? { omitOutputChapterTitles } : {}),
        autoExportJobId,
        autoExportStartedAt,
        ...(autoExportRange ? { autoExportRange } : {}),
        ...(autoExportOutputChapterStart !== undefined ? { autoExportOutputChapterStart } : {}),
        ...(autoExportJobId ? { autoExportOmitOutputChapterTitles } : {}),
        ...(!contentBackedByCheckpoint && autoExportOutput ? { autoExportOutput } : {}),
        ...(autoExportResolvedDirectory ? { autoExportResolvedDirectory } : {}),
        exportedRecords,
        originalExportedRecords,
        ...(combinedExport ? { combinedExport } : {}),
        ...(combinedSourceExport ? { combinedSourceExport } : {}),
        updatedAt: Date.now(),
      };
      try {
        await getStoryTool().saveDraft(draft);
        setSaveState('saved');
        setLastSavedAt(Date.now());
      } catch {
        setSaveState('error');
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    appAvailable,
    autoExportJobId,
    autoExportStartedAt,
    autoExportRange,
    autoExportOutputChapterStart,
    autoExportOmitOutputChapterTitles,
    autoExportOutput,
    autoExportResolvedDirectory,
    customPrompt,
    exportDirectory,
    exportOriginalChapters,
    exportCombinedChapters,
    exportCombinedSourceChapters,
    outputChapterStart,
    omitOutputChapterTitles,
    exportedRecords,
    originalExportedRecords,
    combinedExport,
    combinedSourceExport,
    initialized,
    output,
    promptMode,
    source,
    sourceMode,
    splitConfig,
    storyUrl,
  ]);

  const consumeTranslationEvent = useCallback((event: TranslationEvent) => {
    if (activeJobRef.current && event.jobId && event.jobId !== activeJobRef.current) return;
    const payload = asRecord(event.payload);
    const segment = asRecord(payload.segment);
    const job = asRecord(payload.job);
    const type = event.type.toLowerCase().replaceAll('_', '-').replaceAll(':', '-');
    if (type === 'activity-log') {
      const entry = asActivityEntry(payload.entry);
      if (entry) {
        setActivityLog((current) => [...current, entry].slice(-240));
      }
    }
    if (!activeJobRef.current && event.jobId && type === 'job-created') {
      activeJobRef.current = event.jobId;
      setActiveJobId(event.jobId);
    }

    const jobSegments = Array.isArray(job.segments) ? job.segments : undefined;
    const total = firstNumber(payload, ['totalSegments', 'total', 'segmentCount']) ?? jobSegments?.length;
    const completed = firstNumber(payload, ['completedSegments', 'completed', 'current']);
    if (typeof total === 'number') setTotalSegments(total);
    if (typeof completed === 'number') setCompletedSegments(completed);

    const fullOutput = firstString(payload, ['output', 'fullText', 'translatedText']);
    if (fullOutput !== undefined) {
      outputRef.current = fullOutput;
      setOutput(fullOutput);
      if (event.jobId && event.jobId === autoExportJobRef.current) setAutoExportOutput(fullOutput);
    }

    if (type.includes('segment') && (type.includes('complete') || type.includes('translated'))) {
      const segmentId = firstString(payload, ['segmentId', 'id'])
        ?? firstString(segment, ['segmentId', 'id'])
        ?? `${firstNumber(segment, ['segmentIndex', 'index']) ?? segmentOutputsRef.current.size}`;
      const text = firstString(payload, ['translation', 'text', 'content', 'result'])
        ?? firstString(segment, ['translatedText', 'translation', 'text', 'content']);
      const order = firstNumber(payload, ['segmentIndex', 'index', 'order'])
        ?? firstNumber(segment, ['segmentIndex', 'index', 'order'])
        ?? segmentOutputsRef.current.size;
      if (text !== undefined) {
        segmentOutputsRef.current.set(segmentId, { order, text });
        if (fullOutput === undefined) {
          const joined = [...segmentOutputsRef.current.values()]
            .sort((left, right) => left.order - right.order)
            .map((segment) => segment.text.trim())
            .filter(Boolean)
            .join('\n\n');
          setOutput(joined);
          outputRef.current = joined;
          if (event.jobId && event.jobId === autoExportJobRef.current) setAutoExportOutput(joined);
        }
      }
      setSegmentErrors((current) => current.filter((error) => error.segmentId !== segmentId));
      setCompletedSegments((current) => Math.max(current, order + 1));
    }

    if (type.includes('segment') && (type.includes('error') || type.includes('failed'))) {
      const segmentId = firstString(payload, ['segmentId', 'id']) ?? firstString(segment, ['segmentId', 'id']) ?? 'unknown';
      const message = firstString(payload, ['message', 'error', 'reason'])
        ?? firstString(segment, ['message', 'error', 'reason'])
        ?? `Đoạn ${segmentId} chưa vượt qua kiểm tra chất lượng.`;
      setSegmentErrors((current) => {
        const next = { id: `${event.jobId}-${segmentId}`, segmentId, message };
        return [...current.filter((error) => error.segmentId !== segmentId), next];
      });
      setTranslationState('error');
    }

    if (type.includes('progress') || type.endsWith('started') || type.endsWith('resumed') || type.includes('segment-retry')) {
      setTranslationState('running');
    }
    if (type.endsWith('paused')) setTranslationState('paused');
    if (type.endsWith('cancelled') || type.endsWith('canceled')) setTranslationState('cancelled');
    if ((type.includes('job') || type.includes('translation')) && (type.endsWith('complete') || type.endsWith('completed'))) {
      setTranslationState('complete');
      if (event.jobId) {
        activeJobRef.current = event.jobId;
        setActiveJobId(event.jobId);
      }
      const finalTotal = total ?? jobSegments?.length;
      if (typeof finalTotal === 'number') setCompletedSegments(finalTotal);
    }
    if ((type.includes('job') || type.includes('translation')) && (type.endsWith('error') || type.endsWith('failed'))) {
      setTranslationState('error');
      const message = firstString(payload, ['message', 'error', 'reason']);
      if (message) setAppNotice(message);
    }

    const status = (firstString(payload, ['status']) ?? firstString(job, ['status']))?.toLowerCase();
    if (status === 'paused') setTranslationState('paused');
    if (status === 'queued' || status === 'running' || status === 'translating') setTranslationState('running');
    if (status === 'completed' || status === 'complete') setTranslationState('complete');
    if (status === 'cancelled' || status === 'canceled') setTranslationState('cancelled');
    if (status === 'failed') setTranslationState('error');
  }, []);

  const bindAutoExportFromCheckpoint = useCallback((
    job: TranslationJobSnapshot,
    syncEditableDirectory = false,
  ): boolean => {
    const binding = job.autoExport;
    if (!binding) return false;
    // This data belongs to the checkpoint, not to whatever the user has
    // edited in the form since it was interrupted. Rebinding it here is what
    // makes “Bắt đầu từ CP lỗi” keep writing into the original destination.
    autoExportJobRef.current = job.id;
    setAutoExportJobId(job.id);
    setAutoExportStartedAt(Date.parse(job.createdAt ?? '') || Date.now());
    // Automatic polling/recovery must not overwrite a folder the user has
    // already selected for the next run. Only an explicit History action is
    // allowed to bring the checkpoint folder back into the editable form.
    if (syncEditableDirectory) setExportDirectory(binding.directory);
    setAutoExportResolvedDirectory(binding.directory);
    setExportOriginalChapters(binding.exportOriginalChapters);
    setExportCombinedChapters(binding.exportCombinedChapters);
    setExportCombinedSourceChapters(binding.exportCombinedSourceChapters === true);
    const nextRange = {
      startChapter: binding.startChapter,
      endChapter: binding.endChapter,
      sourceChapterNumbers: [...binding.sourceChapterNumbers],
    };
    setAutoExportRange((current) => (
      current
      && current.startChapter === nextRange.startChapter
      && current.endChapter === nextRange.endChapter
      && current.sourceChapterNumbers.length === nextRange.sourceChapterNumbers.length
      && current.sourceChapterNumbers.every((number, index) => number === nextRange.sourceChapterNumbers[index])
        ? current
        : nextRange
    ));
    autoExportOutputChapterStartRef.current = binding.outputChapterStart;
    setAutoExportOutputChapterStart(binding.outputChapterStart);
    setAutoExportOmitOutputChapterTitles(binding.omitOutputChapterTitles);
    return true;
  }, []);

  const reconcileTranslationJob = useCallback((job: TranslationJobSnapshot) => {
    if (activeJobRef.current && job.id !== activeJobRef.current) return;
    if (!activeJobRef.current) {
      activeJobRef.current = job.id;
      setActiveJobId(job.id);
    }
    if (job.autoExport && job.id === activeJobRef.current) {
      bindAutoExportFromCheckpoint(job);
    }

    setTotalSegments(job.totalSegments);
    setCompletedSegments(job.completedSegments);
    const nextActivityLog = job.activityLog ?? [];
    setActivityLog((current) => {
      if (current === nextActivityLog) return current;
      if (current.length !== nextActivityLog.length) return nextActivityLog;
      const currentFirst = current[0];
      const nextFirst = nextActivityLog[0];
      const currentLast = current.at(-1);
      const nextLast = nextActivityLog.at(-1);
      return currentFirst?.at === nextFirst?.at
        && currentFirst?.message === nextFirst?.message
        && currentLast?.at === nextLast?.at
        && currentLast?.message === nextLast?.message
        ? current
        : nextActivityLog;
    });
    if (job.translatedText !== undefined) {
      outputRef.current = job.translatedText;
      setOutput((current) => current === job.translatedText ? current : job.translatedText!);
      if (job.id === autoExportJobRef.current) {
        setAutoExportOutput((current) => current === job.translatedText ? current : job.translatedText!);
      }
    }
    if (job.sourceText !== undefined && job.id === autoExportJobRef.current) {
      setAutoExportSource((current) => current === job.sourceText ? current : job.sourceText!);
      // A resumed checkpoint may have repaired source artifacts before the
      // renderer reconnects. Keep the durable draft in sync as well, so a
      // later app restart and the final combined-source export cannot fall
      // back to the pre-repair text.
      setSource((current) => current === job.sourceText ? current : job.sourceText!);
    }

    const failedSegments = job.segments
      .filter((segment) => segment.status === 'failed')
      .map((segment) => ({
        id: `${job.id}-${segment.id}`,
        segmentId: segment.id,
        message: segment.error || `Đoạn ${segment.index + 1} chưa vượt qua kiểm tra chất lượng.`,
      }));
    setSegmentErrors((current) => (
      current.length === failedSegments.length
      && current.every((error, index) => (
        error.id === failedSegments[index]?.id
        && error.segmentId === failedSegments[index]?.segmentId
        && error.message === failedSegments[index]?.message
      ))
        ? current
        : failedSegments
    ));
    setCanContinueFromCheckpoint(
      (job.status === 'failed' || job.status === 'cancelled')
      && failedSegments.length === 0
      && job.segments.some((segment) => segment.status === 'queued'),
    );

    switch (job.status) {
      case 'queued':
      case 'running':
        setTranslationState('running');
        break;
      case 'paused':
        setTranslationState('paused');
        break;
      case 'completed':
        setTranslationState('complete');
        break;
      case 'failed':
        setTranslationState('error');
        if (job.error) setAppNotice(job.error);
        break;
      case 'cancelled':
        setTranslationState('cancelled');
        break;
      default:
        setTranslationState('idle');
    }
  }, [bindAutoExportFromCheckpoint]);

  const restoreActiveTranslationAfterConflict = useCallback(async (): Promise<boolean> => {
    try {
      const recoverable = latestRecoverableTranslation(await getStoryTool().getActiveTranslations());
      if (!recoverable) return false;
      // `beginTranslation` clears the old id before asking the runner to make
      // a new job, so a conflict must explicitly bind this UI back to the
      // runner-owned checkpoint. Otherwise a paused job becomes impossible to
      // cancel or resume from the renderer.
      activeJobRef.current = recoverable.id;
      setActiveJobId(recoverable.id);
      reconcileTranslationJob(recoverable);
      return true;
    } catch {
      return false;
    }
  }, [reconcileTranslationJob]);

  useEffect(() => {
    if (!appAvailable) return;
    let disposed = false;
    void getStoryTool().getActiveTranslations()
      .then((jobs) => {
        if (disposed) return;
        const recoverable = latestRecoverableTranslation(jobs);
        if (!recoverable) return;
        // Startup uses the lightweight snapshot. Pulling a complete long book
        // here blocks the renderer before the user can interact; full text is
        // loaded only when resuming or reconciling a completed export.
        reconcileTranslationJob(recoverable);
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [appAvailable, reconcileTranslationJob]);

  useEffect(() => {
    if (!appAvailable) return;
    let disposed = false;
    // Let the title bar and primary controls accept input before migrating or
    // reading a large checkpoint archive. The runner coalesces restoration,
    // so this does not duplicate disk work.
    const timer = window.setTimeout(() => {
      void (async () => {
        await refreshTranslationHistory();
        if (disposed || activeJobRef.current) return;
        const recoverable = latestRecoverableTranslation(await getStoryTool().getActiveTranslations());
        if (!recoverable || disposed) return;
        if (!disposed) reconcileTranslationJob(recoverable);
      })().catch(() => undefined);
    }, 400);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [appAvailable, reconcileTranslationJob, refreshTranslationHistory]);

  // A book translation may finish just before the window closes. Completed
  // jobs are intentionally absent from the active-job list, so recover the
  // exact pending auto-export job recorded in the draft and hydrate its final
  // output before splitting/saving. This makes the fetch→translate→export
  // workflow crash/restart safe instead of depending only on live events.
  useEffect(() => {
    if (!appAvailable || !initialized || !autoExportJobId || autoExportJobId === 'pending') return;
    let disposed = false;
    // This is the immutable directory captured by the job. `exportDirectory`
    // is an editable choice for a future run and must never unlock/re-route an
    // old completed checkpoint.
    const pendingDirectory = autoExportResolvedDirectory;
    if (!pendingDirectory) return;
    void (async () => {
      try {
        // A renamed, moved or deleted destination must not make the renderer
        // hydrate and repeatedly process a multi-megabyte completed job. Keep
        // the durable association intact, but wait until the user selects a
        // valid folder before resuming export reconciliation.
        await getStoryTool().validateChapterDirectory(pendingDirectory);
        const summaries = await getStoryTool().discoverTranslations();
        const summary = summaries.find((candidate) => candidate.id === autoExportJobId);
        if (summary && ['queued', 'running', 'paused'].includes(summary.status)) {
          if (!disposed) {
            activeJobRef.current = summary.id;
            setActiveJobId(summary.id);
            reconcileTranslationJob(summary);
          }
          return;
        }
        const job = await getStoryTool().getTranslation(autoExportJobId);
        if (disposed || job.id !== autoExportJobId) return;
        // A cancelled or failed checkpoint belongs to history.  Binding it as
        // the active job makes the UI look locked even though the runner no
        // longer has any active work.  Keep its durable text intact, but
        // sever the stale auto-export association so a new job may begin.
        if (job.status === 'cancelled' || job.status === 'failed') {
          if (autoExportJobRef.current === job.id) autoExportJobRef.current = '';
          activeJobRef.current = '';
          setAutoExportJobId('');
          setAutoExportStartedAt(0);
          setActiveJobId('');
          setTranslationState('idle');
          setCanContinueFromCheckpoint(false);
          void refreshTranslationHistory().catch(() => undefined);
          return;
        }
        activeJobRef.current = job.id;
        setActiveJobId(job.id);
        reconcileTranslationJob(job);
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : 'lỗi không xác định';
          setAppNotice(
            `Không thể tự khôi phục nơi xuất của checkpoint cũ: ${message} `
            + 'Thư mục bạn chọn sau đó chỉ áp dụng cho lượt dịch mới; checkpoint cũ vẫn được giữ trong Lịch sử.',
          );
        }
      }
    })();
    return () => { disposed = true; };
  }, [
    appAvailable,
    autoExportJobId,
    autoExportResolvedDirectory,
    initialized,
    reconcileTranslationJob,
    refreshTranslationHistory,
  ]);

  useEffect(() => {
    if (!appAvailable || !initialized || autoExportJobId !== 'pending' || !autoExportStartedAt) return;
    let disposed = false;
    void getStoryTool().discoverTranslations()
      .then((jobs) => {
        if (disposed) return;
        const threshold = autoExportStartedAt - 5_000;
        const match = jobs
          .filter((job) => job.createdAt && Date.parse(job.createdAt) >= threshold)
          .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''))[0];
        if (!match) {
          setAppNotice('Chưa tìm thấy checkpoint của tác vụ link đang chờ; hãy bấm “Tải, dịch và lưu” lại.');
          return;
        }
        autoExportJobRef.current = match.id;
        setAutoExportJobId(match.id);
        activeJobRef.current = match.id;
        setActiveJobId(match.id);
        reconcileTranslationJob(match);
      })
      .catch((error) => {
        if (!disposed) setAppNotice(error instanceof Error ? error.message : 'Không thể dò checkpoint dịch link.');
      });
    return () => { disposed = true; };
  }, [appAvailable, autoExportJobId, autoExportStartedAt, initialized, reconcileTranslationJob]);

  // Older builds could clear `autoExportJobId` after all split TXT files were
  // written but before a transient combined-file failure was retried.  Recover
  // only when the persisted records prove one complete export set and the
  // runner confirms that exact job is terminal; never infer completion from a
  // partial live translation.
  useEffect(() => {
    if (
      !appAvailable
      || !initialized
      || autoExportJobId
      || !exportCombinedChapters
      || combinedExport
      || !autoExportOutput.trim()
      || !exportedRecords.length
    ) return;
    const jobIds = [...new Set(exportedRecords.map((record) => record.exportJobId).filter(Boolean))];
    if (jobIds.length !== 1) return;
    const recoveredJobId = jobIds[0];
    if (!recoveredJobId) return;
    const recordDirectories = [...new Set(exportedRecords
      .filter((record) => record.exportJobId === recoveredJobId)
      .map((record) => record.exportDirectory)
      .filter(Boolean))];
    // A legacy recovery is safe only when its own persisted records prove one
    // unambiguous destination. Never borrow the current folder field.
    if (recordDirectories.length !== 1) return;
    const recoveredDirectory = recordDirectories[0];
    if (!recoveredDirectory) return;
    let disposed = false;
    void getStoryTool().validateChapterDirectory(recoveredDirectory)
      .then(() => getStoryTool().getTranslation(recoveredJobId))
      .then((job) => {
        if (disposed || job.id !== recoveredJobId || job.status !== 'completed') return;
        autoExportJobRef.current = job.id;
        activeJobRef.current = job.id;
        setAutoExportJobId(job.id);
        setAutoExportResolvedDirectory(recoveredDirectory);
        setActiveJobId(job.id);
        setTranslationState('complete');
        setAppNotice('Đang khôi phục lượt tạo file tổng hợp còn thiếu từ checkpoint đã hoàn tất.');
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [
    appAvailable,
    autoExportJobId,
    autoExportOutput,
    combinedExport,
    exportCombinedChapters,
    exportedRecords,
    initialized,
  ]);

  useEffect(() => {
    if (!appAvailable) return;
    try {
      return getStoryTool().onTranslationEvent(consumeTranslationEvent);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể theo dõi tiến trình dịch.');
      return;
    }
  }, [appAvailable, consumeTranslationEvent]);

  useEffect(() => {
    if (
      !appAvailable
      || !activeJobId
      || (translationState !== 'running' && translationState !== 'paused')
    ) return;

    let disposed = false;
    let requestInFlight = false;
    const synchronize = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const job = await getStoryTool().getTranslation(activeJobId);
        if (!disposed && activeJobRef.current === activeJobId) reconcileTranslationJob(job);
      } catch (error) {
        if (!disposed && activeJobRef.current === activeJobId) {
          const message = error instanceof Error ? error.message : 'lỗi không xác định';
          setAppNotice(`Không thể đồng bộ tiến trình dịch: ${message}`);
        }
      } finally {
        requestInFlight = false;
      }
    };

    void synchronize();
    // Translation events are the primary real-time channel. This full
    // checkpoint is only a recovery safety net and can contain several MB of
    // source, output, segments and logs, so polling it every 1.5 seconds made
    // long books repeatedly cross IPC and forced expensive renderer work.
    const timer = window.setInterval(() => { void synchronize(); }, 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeJobId, appAvailable, reconcileTranslationJob, translationState]);

  useEffect(() => {
    if (!appAvailable) return;
    const api = getStoryTool();
    const subscribe = api.onAiStatus ?? api.onChatGPTStatus;
    if (!subscribe) return;
    return subscribe((snapshot) => {
      if ('provider' in snapshot && (snapshot.provider === 'chatgpt' || snapshot.provider === 'kimi')) {
        setAiProvider(snapshot.provider);
      }
      const status = snapshot.status.toLowerCase();
      if (status === 'ready') setConnection('connected');
      else if (status === 'opening' || status === 'busy') setConnection('connecting');
      else if (status === 'login-required') setConnection('login-required');
      else if (status === 'error') setConnection('error');
      else if (status === 'closed') setConnection('disconnected');
      if (snapshot.message) setAppNotice(snapshot.message);
    });
  }, [appAvailable]);

  useEffect(() => {
    if (!appAvailable) return;
    let alive = true;
    const api = getStoryTool();
    void (async () => {
      try {
        const provider = await api.getAiProvider?.();
        if (!alive || !provider) return;
        setAiProvider(provider);
        const snapshot = await api.getAiStatus?.();
        if (!alive || !snapshot) return;
        if (snapshot.status === 'ready') setConnection('connected');
        else if (snapshot.status === 'login-required') setConnection('login-required');
        else if (snapshot.status === 'error') setConnection('error');
        else setConnection('disconnected');
      } catch {
        // Older preload builds retain the ChatGPT-only compatibility path.
      }
    })();
    return () => { alive = false; };
  }, [appAvailable]);

  useEffect(() => {
    if (!appAvailable) return;
    try {
      return getStoryTool().onStorySourceProgress((progress) => {
        setStoryProgress(progress);
        if (progress.phase === 'failed') setStoryImportState('error');
        if (progress.phase === 'completed') setStoryImportState('ready');
      });
    } catch {
      return;
    }
  }, [appAvailable]);

  const connectAi = async () => {
    if (!appAvailable || connection === 'connecting') return;
    setConnection('connecting');
    setAppNotice('');
    try {
      const api = getStoryTool();
      const result = api.connectAi ? await api.connectAi() : await api.connectChatGPT();
      const status = result.status.toLowerCase();
      if (status.includes('connected') || status.includes('ready')) {
        setConnection('connected');
      } else {
        setConnection('login-required');
        setAppNotice(result.message || `Hãy hoàn tất đăng nhập trong cửa sổ ${aiProviderLabel(aiProvider)}, sau đó bấm “Kiểm tra kết nối”.`);
      }
    } catch (error) {
      setConnection('error');
      setAppNotice(error instanceof Error ? error.message : `Không thể mở phiên ${aiProviderLabel(aiProvider)}.`);
    }
  };

  const changeAiProvider = async (provider: AiProvider) => {
    // A paused checkpoint owns its recorded provider and the runner restores
    // that provider before resuming. Therefore changing the provider shown in
    // the header while paused is safe. Only an actively running/cancelling job
    // must lock the switch.
    if (!appAvailable || provider === aiProvider || ['running', 'cancelling'].includes(translationState)) return;
    setConnection('connecting');
    setAppNotice('');
    try {
      const api = getStoryTool();
      if (!api.setAiProvider) throw new Error('Bản ứng dụng này chưa hỗ trợ đổi AI.');
      await api.setAiProvider(provider);
      setAiProvider(provider);
      const snapshot = api.connectAi ? await api.connectAi() : await api.connectChatGPT();
      const status = snapshot.status.toLowerCase();
      if (status.includes('ready') || status.includes('connected')) setConnection('connected');
      else if (status === 'login-required') setConnection('login-required');
      else if (status === 'error') setConnection('error');
      else setConnection('connecting');
      if (snapshot.message) setAppNotice(snapshot.message);
    } catch (error) {
      setConnection('error');
      setAppNotice(error instanceof Error ? error.message : 'Không thể đổi AI.');
    }
  };

  const beginTranslation = async (sourceText: string, automaticExportDirectory = '') => {
    if (!sourceText.trim() || (promptMode === 'custom' && !customPrompt.trim())) return;
    activeJobRef.current = '';
    setActiveJobId('');
    setTranslationState('running');
    setCompletedSegments(0);
    setTotalSegments(0);
    setSegmentErrors([]);
    setCanContinueFromCheckpoint(false);
    setSplitCheckpoint({ status: 'idle', sourceCharacters: 0, chapterCount: 0, wordCount: 0 });
    setAppNotice('');
    // A new link run owns a new immutable export set.  The previous job's
    // atomic files must never suppress a chapter from this job.
    setExportedRecords([]);
    setOriginalExportedRecords([]);
    setCombinedExport(undefined);
    setCombinedSourceExport(undefined);
    setAutoExportOutput('');
    setAutoExportSource(automaticExportDirectory ? sourceText : '');
    setAutoExportResolvedDirectory(automaticExportDirectory || undefined);
    outputRef.current = '';
    const nextExportRange = automaticExportDirectory
      ? sourceChapterRange(sourceText, splitConfig)
      : undefined;
    // Freeze the requested display sequence before any network/translation
    // work begins. The Step 2 input remains editable for a future run, but a
    // running job must never rename later checkpoints halfway through.
    const nextAutoExportOutputChapterStart = automaticExportDirectory
      ? outputChapterStart
      : undefined;
    const nextAutoExportOmitOutputChapterTitles = Boolean(automaticExportDirectory) && omitOutputChapterTitles;
    setAutoExportRange(nextExportRange);
    autoExportOutputChapterStartRef.current = nextAutoExportOutputChapterStart;
    setAutoExportOutputChapterStart(nextAutoExportOutputChapterStart);
    setAutoExportOmitOutputChapterTitles(nextAutoExportOmitOutputChapterTitles);
    segmentOutputsRef.current.clear();
    try {
      if (automaticExportDirectory) {
        const pendingStartedAt = Date.now();
        setAutoExportStartedAt(pendingStartedAt);
        autoExportJobRef.current = 'pending';
        setAutoExportJobId('pending');
        await getStoryTool().saveDraft({
          version: 2,
          source: sourceText,
          output: '',
          promptMode,
          customPrompt,
          splitConfig,
          sourceMode,
          storyUrl,
          exportDirectory: automaticExportDirectory,
          exportOriginalChapters,
          exportCombinedChapters,
          ...(exportCombinedSourceChapters ? { exportCombinedSourceChapters: true } : {}),
          ...(outputChapterStart !== undefined ? { outputChapterStart } : {}),
          ...(omitOutputChapterTitles ? { omitOutputChapterTitles } : {}),
          autoExportJobId: 'pending',
          autoExportStartedAt: pendingStartedAt,
          ...(nextExportRange ? { autoExportRange: nextExportRange } : {}),
          ...(nextAutoExportOutputChapterStart !== undefined
            ? { autoExportOutputChapterStart: nextAutoExportOutputChapterStart }
            : {}),
          autoExportOmitOutputChapterTitles: nextAutoExportOmitOutputChapterTitles,
          autoExportOutput: '',
          exportedRecords: [],
          originalExportedRecords: [],
          updatedAt: pendingStartedAt,
        } satisfies RendererDraft);
      }
      const result = await getStoryTool().startTranslation({
        source: sourceText,
        promptMode,
        ...(aiProvider === 'kimi' ? { aiProvider } : {}),
        customPrompt: promptMode === 'custom' ? customPrompt.trim() : undefined,
        // Link imports preserve an ordinary source chapter in one request;
        // only unusually long chapters are split by the runner.
        settings: {
          maxRetries: 3,
          maxCharsPerSegment: 12_000,
          responseTimeoutMs: aiProvider === 'kimi' ? 600_000 : 480_000,
        },
        ...(automaticExportDirectory && nextExportRange
          ? {
              autoExport: {
                directory: automaticExportDirectory,
                startChapter: nextExportRange.startChapter,
                endChapter: nextExportRange.endChapter,
                sourceChapterNumbers: [...nextExportRange.sourceChapterNumbers],
                exportOriginalChapters,
                exportCombinedChapters,
                ...(exportCombinedSourceChapters ? { exportCombinedSourceChapters: true } : {}),
                ...(nextAutoExportOutputChapterStart !== undefined
                  ? { outputChapterStart: nextAutoExportOutputChapterStart }
                  : {}),
                omitOutputChapterTitles: nextAutoExportOmitOutputChapterTitles,
              },
            }
          : {}),
      });
      activeJobRef.current = result.jobId;
      setActiveJobId(result.jobId);
      autoExportJobRef.current = automaticExportDirectory ? result.jobId : '';
      setAutoExportJobId(automaticExportDirectory ? result.jobId : '');
      // Preserve any checkpoint event that was delivered while the main IPC
      // invocation was resolving. This is essential for very short segments.
      if (automaticExportDirectory && outputRef.current.trim()) {
        setAutoExportOutput(outputRef.current);
      }
      if (!automaticExportDirectory) setAutoExportStartedAt(0);
      if (automaticExportDirectory) setExportDirectory(automaticExportDirectory);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Không thể bắt đầu tác vụ dịch.';
      // The runner rejects a new job when a persisted paused/running job still
      // owns the translation slot. Rebind to that job before reporting the
      // rejection, otherwise the optimistic reset above leaves its controls
      // without an id and the user cannot cancel it.
      const restoredBlockedJob = isActiveTranslationConflict(error)
        ? await restoreActiveTranslationAfterConflict()
        : false;
      if (automaticExportDirectory) {
        const failedAt = Date.now();
        autoExportJobRef.current = '';
        setAutoExportJobId('');
        setAutoExportStartedAt(0);
        setAutoExportResolvedDirectory(undefined);
        autoExportOutputChapterStartRef.current = undefined;
        setAutoExportOutputChapterStart(undefined);
        setAutoExportOmitOutputChapterTitles(false);
        try {
          await getStoryTool().saveDraft({
            version: 2,
            source: sourceText,
            output: '',
            promptMode,
            customPrompt,
            splitConfig,
            sourceMode,
            storyUrl,
            exportDirectory: automaticExportDirectory,
            exportOriginalChapters,
            exportCombinedChapters,
            ...(exportCombinedSourceChapters ? { exportCombinedSourceChapters: true } : {}),
            ...(outputChapterStart !== undefined ? { outputChapterStart } : {}),
            ...(omitOutputChapterTitles ? { omitOutputChapterTitles } : {}),
            autoExportJobId: '',
            autoExportStartedAt: 0,
            ...(nextExportRange ? { autoExportRange: nextExportRange } : {}),
            autoExportOmitOutputChapterTitles: false,
            autoExportOutput: '',
            exportedRecords: [],
            originalExportedRecords: [],
            updatedAt: failedAt,
          } satisfies RendererDraft);
        } catch {
          // The in-memory state is still cleared. The normal draft autosave will
          // retry this cleanup if the immediate persistence call is unavailable.
        }
      }
      if (restoredBlockedJob) {
        setAppNotice(`${errorMessage} Đã khôi phục tác vụ đang tạm dừng; bạn có thể Tiếp tục hoặc Hủy.`);
        return;
      }
      setTranslationState('error');
      setAppNotice(error instanceof Error ? error.message : 'Không thể bắt đầu tác vụ dịch.');
    }
  };

  const startTranslation = async () => beginTranslation(source);

  const analyzeStoryUrl = async (fromBrowserPairing = false) => {
    if (!storyUrl.trim() || !appAvailable || (manualVerificationState === 'opening' && !fromBrowserPairing)) return;
    const requestedUrl = storyUrl.trim();
    setStoryImportState('analyzing');
    setStoryProgress({ phase: 'opening', completed: 0, total: 0, message: 'Đang mở và kiểm tra link truyện…' });
    setStoryAnalysis(null);
    setSelectedChapterIds(new Set());
    setOutputChapterStart(undefined);
    setManualVerificationState('none');
    setAppNotice('');
    try {
      const analysis = await getStoryTool().analyzeStoryUrl(requestedUrl);
      setStoryAnalysis(analysis);
      setSelectedChapterIds(new Set(analysis.defaultSelectedChapterIds));
      setStoryImportState('ready');
      setAppNotice(`Đã đọc ${analysis.chapters.filter((chapter) => !chapter.isIntroduction).length.toLocaleString('vi-VN')} chương của “${analysis.bookTitle}”.`);
    } catch (error) {
      setStoryImportState('error');
      const message = error instanceof Error ? error.message : 'Không thể phân tích link truyện.';
      const canVerifyManually = Boolean(manualVerificationSite(requestedUrl)) && isCloudflareVerificationMessage(message);
      setManualVerificationState(canVerifyManually ? 'available' : 'none');
      setAppNotice(canVerifyManually
        ? `${message} Hãy kết nối tiện ích với trình duyệt mặc định và đúng profile bạn dùng hằng ngày. Kết nối xong, tool sẽ tự phân tích lại link.`
        : message);
    }
  };

  const openStoryManualVerification = async () => {
    const verificationUrl = storyUrl.trim();
    const verificationSite = manualVerificationSite(verificationUrl);
    if (!appAvailable || !verificationSite) return;
    const openVerification = getStoryTool().openManualStoryVerification;
    if (!openVerification) {
      setAppNotice('Phiên bản tool hiện tại chưa có chức năng kết nối trình duyệt mặc định. Hãy cập nhật tool rồi thử lại.');
      return;
    }
    setManualVerificationState('opening');
    setAppNotice('');
    try {
      await openVerification(verificationUrl);
      setManualVerificationState('open');
      setAppNotice(`Đã kết nối trình duyệt mặc định. Tool đang tự phân tích lại link ${manualVerificationSiteLabel(verificationSite)}…`);
      await analyzeStoryUrl(true);
    } catch (error) {
      setManualVerificationState('available');
      setAppNotice(error instanceof Error
        ? error.message
        : 'Không thể kết nối tiện ích với trình duyệt mặc định. Hãy kiểm tra tiện ích đã được cài và thử lại.');
    }
  };

  const revealHuliBrowserHelper = async () => {
    if (!appAvailable) return;
    const revealHelper = getStoryTool().revealHuliBrowserHelper;
    if (!revealHelper) {
      setAppNotice('Phiên bản tool hiện tại chưa kèm tiện ích Huliwang. Hãy cập nhật bản đầy đủ rồi thử lại.');
      return;
    }
    try {
      const result = await revealHelper();
      setAppNotice(`Đã mở thư mục tiện ích Huliwang: ${result.directory}`);
    } catch (error) {
      setAppNotice(error instanceof Error
        ? error.message
        : 'Không tìm thấy hoặc không thể mở thư mục tiện ích Huliwang đi kèm tool.');
    }
  };

  const switchToTextImport = () => {
    setSourceMode('text');
    setManualVerificationState('none');
    setStoryImportState('idle');
    setStoryProgress(null);
    setAppNotice('Dán nội dung truyện bạn đã sao chép vào ô tiếng Trung để dịch.');
  };

  const chooseChapterDirectory = async () => {
    try {
      const result = await getStoryTool().chooseChapterDirectory();
      if (!result.canceled && result.directory) {
        setExportDirectory(result.directory);
        setAppNotice(`Các chương hoàn chỉnh sẽ được lưu tại ${result.directory}`);
      }
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể chọn thư mục lưu.');
    }
  };

  const fetchAndTranslateStory = async () => {
    if (!storyAnalysis || selectedChapterIds.size === 0 || !exportDirectory) return;
    if (connection !== 'connected') {
      setAppNotice(`Hãy kết nối ${aiProviderLabel(aiProvider)} trước khi tải và dịch bộ truyện.`);
      return;
    }
    try {
      // The chosen path can disappear after an old draft is restored. Check
      // it before fetching or creating a translation job, not only later when
      // checkpoint files are first written.
      const verified = await getStoryTool().validateChapterDirectory(exportDirectory);
      if (verified.directory !== exportDirectory) setExportDirectory(verified.directory);
    } catch (error) {
      setStoryImportState('ready');
      setAppNotice(error instanceof Error
        ? error.message
        : 'Không tìm thấy thư mục xuất; không thể bắt đầu dịch.');
      return;
    }
    setStoryImportState('fetching');
    setExportedRecords([]);
    setOriginalExportedRecords([]);
    setCombinedExport(undefined);
    setAutoExportOutput('');
    setAppNotice('');
    try {
      const fetched = await getStoryTool().fetchStoryChapters({
        analysisId: storyAnalysis.analysisId,
        chapterIds: [...selectedChapterIds],
      });
      setSource(fetched.combinedSource);
      setStoryImportState('ready');
      if (fetched.warnings.length) setAppNotice(fetched.warnings.join(' '));
      await beginTranslation(fetched.combinedSource, exportDirectory);
    } catch (error) {
      setStoryImportState('error');
      const message = error instanceof Error ? error.message : 'Không thể tải nội dung các chương đã chọn.';
      const needsReconnect = Boolean(manualVerificationSite(storyAnalysis.inputUrl))
        && isCloudflareVerificationMessage(message);
      setManualVerificationState(needsReconnect ? 'available' : 'none');
      setAppNotice(needsReconnect
        ? `${message} Hãy kết nối lại trình duyệt mặc định, phân tích lại link rồi chọn tiếp các chương cần tải.`
        : message);
    }
  };

  const cancelStoryFetch = async () => {
    try {
      await getStoryTool().cancelStoryFetch(storyAnalysis?.analysisId);
      setStoryImportState(storyAnalysis ? 'ready' : 'idle');
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể hủy tác vụ lấy truyện.');
    }
  };

  const pauseTranslation = async () => {
    if (!activeJobRef.current) return;
    try {
      await getStoryTool().pauseTranslation(activeJobRef.current);
      setTranslationState('paused');
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể tạm dừng.');
    }
  };

  const resumeTranslation = async () => {
    if (!activeJobRef.current) return;
    try {
      // Startup intentionally restores only lightweight progress metadata.
      // Hydrate the exact checkpoint once, at the user's explicit resume, so
      // prior translated segments and automatic exports remain complete.
      const checkpoint = await getStoryTool().getTranslation(activeJobRef.current);
      reconcileTranslationJob(checkpoint);
      await getStoryTool().resumeTranslation(activeJobRef.current);
      setTranslationState('running');
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể tiếp tục.');
    }
  };

  const cancelTranslation = async () => {
    if (!activeJobRef.current) return;
    setTranslationState('cancelling');
    try {
      await getStoryTool().cancelTranslation(activeJobRef.current);
      setTranslationState('cancelled');
      void refreshTranslationHistory().catch(() => undefined);
    } catch (error) {
      setTranslationState('error');
      setAppNotice(error instanceof Error ? error.message : 'Không thể hủy tác vụ.');
    }
  };

  const bindTranslationHistoryJob = (job: TranslationJobSnapshot) => {
    activeJobRef.current = job.id;
    setActiveJobId(job.id);
    bindAutoExportFromCheckpoint(job, true);
    reconcileTranslationJob(job);
  };

  const resumeTranslationHistoryJob = async (job: TranslationJobSnapshot) => {
    try {
      // History entries are lightweight. Fetch the full checkpoint first so
      // its immutable export binding and already translated chapters are
      // restored before the runner produces the next segment.
      const checkpoint = await getStoryTool().getTranslation(job.id);
      bindTranslationHistoryJob(checkpoint);
      await getStoryTool().resumeTranslation(job.id);
      setTranslationState('running');
      setAppNotice('Đang tiếp tục tác vụ từ checkpoint đã lưu.');
      void refreshTranslationHistory().catch(() => undefined);
    } catch (error) {
      setTranslationState(job.status === 'cancelled' ? 'cancelled' : 'error');
      setAppNotice(error instanceof Error ? error.message : 'Không thể tiếp tục checkpoint.');
    }
  };

  const retryTranslationHistorySegment = async (
    job: TranslationJobSnapshot,
    segmentId: string,
  ) => {
    try {
      const checkpoint = await getStoryTool().getTranslation(job.id);
      bindTranslationHistoryJob(checkpoint);
      setSegmentErrors((current) => current.filter((error) => error.segmentId !== segmentId));
      await getStoryTool().retrySegment({ jobId: job.id, segmentId });
      setTranslationState('running');
      setAppNotice('Đang tiếp tục từ đúng đoạn lỗi trong checkpoint.');
      void refreshTranslationHistory().catch(() => undefined);
    } catch (error) {
      setTranslationState('error');
      setAppNotice(error instanceof Error ? error.message : 'Không thể tiếp tục đoạn lỗi trong checkpoint.');
    }
  };

  const restartTranslationHistoryJob = async (job: TranslationJobSnapshot) => {
    try {
      const { jobId } = await getStoryTool().restartTranslation(job.id);
      activeJobRef.current = jobId;
      setActiveJobId(jobId);
      setTranslationState('running');
      setAppNotice('Đang bắt đầu lại tiến trình này từ đầu bằng nội dung và prompt gốc.');
      void refreshTranslationHistory().catch(() => undefined);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể bắt đầu lại tiến trình này.');
    }
  };

  const discardTranslationCheckpoint = async (job: TranslationJobSnapshot) => {
    if (!window.confirm(`Bỏ checkpoint ${job.id.slice(0, 8)}? Dữ liệu dịch đã lưu trong checkpoint này sẽ bị xóa.`)) return;
    try {
      await getStoryTool().discardTranslation(job.id);
      if (activeJobRef.current === job.id) {
        activeJobRef.current = '';
        setActiveJobId('');
        setTranslationState('idle');
        setTotalSegments(0);
        setCompletedSegments(0);
        setSegmentErrors([]);
        setCanContinueFromCheckpoint(false);
      }
      if (autoExportJobRef.current === job.id) {
        autoExportJobRef.current = '';
        setAutoExportJobId('');
        setAutoExportStartedAt(0);
      }
      await refreshTranslationHistory();
      setAppNotice('Đã bỏ checkpoint cũ. Bạn có thể bắt đầu tác vụ mới.');
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể bỏ checkpoint.');
    }
  };

  const retrySegment = async (segmentId: string) => {
    if (!activeJobRef.current) return;
    setSegmentErrors((current) => current.filter((error) => error.segmentId !== segmentId));
    setTranslationState('running');
    try {
      await getStoryTool().retrySegment({ jobId: activeJobRef.current, segmentId });
    } catch (error) {
      setTranslationState('error');
      setSegmentErrors((current) => [...current, {
        id: `${activeJobRef.current}-${segmentId}-retry`,
        segmentId,
        message: error instanceof Error ? error.message : 'Không thể gửi lại đoạn lỗi.',
      }]);
    }
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setAppNotice('Đã sao chép bản dịch vào clipboard.');
    } catch {
      setAppNotice('Không thể truy cập clipboard.');
    }
  };

  const exportOutput = async () => {
    if (!output) return;
    try {
      const result = await getStoryTool().exportText({ content: output, defaultName: 'ban-dich.txt' });
      if (!result.canceled) setAppNotice(result.filePath ? `Đã lưu tại ${result.filePath}` : 'Đã xuất bản dịch.');
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : 'Không thể xuất bản dịch.');
    }
  };

  const splitForAutomaticExport = useMemo(() => ({
    ...splitConfig,
    // Link imports are always divided into reader-sized Vietnamese chapters;
    // never let an old draft's editor setting change the durable export rule.
    targetWords: 800,
    inputLanguage: 'vi' as const,
    // The importer supplies stable `Chương N` boundaries.  They let us seal a
    // completed source chapter while later segments are still translating.
    autoDetectTitle: true,
  }), [splitConfig]);
  // Export effects may only use the immutable job-owned directory. The
  // editable folder is exclusively an input for the next start request.
  const resolvedAutoExportDirectory = autoExportJobId ? autoExportResolvedDirectory : undefined;

  useEffect(() => {
    // A failed/cancelled job may be resumed. Its trailing source chapter is
    // provisional, so split output is only published when a following source
    // heading proves the boundary; terminal completion seals the last one.
    const terminal = translationState === 'complete';
    if (
      !appAvailable
      || !activeJobId
      || activeJobId !== autoExportJobId
      || !resolvedAutoExportDirectory
      || !autoExportOutput.trim()
      || exportingJobsRef.current.has(activeJobId)
    ) return;

    const chapters = renumberFinalExportChapters(
      splitSealedChapters(autoExportOutput, splitForAutomaticExport, terminal),
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    // Always submit the complete currently-sealed set. Persisted records are
    // only a progress cache: after a crash or Retry the old record can exist
    // while its TXT was never published. The main process makes identical
    // files idempotent and writes any missing file, so completion is based on
    // actual durable output rather than stale renderer state.
    if (!chapters.length) return;

    const reconciliationKey = `split\u0000${activeJobId}\u0000${resolvedAutoExportDirectory}\u0000${chapters.map(chapterContentFingerprint).join(',')}`;
    if (reconciledAutoExportsRef.current.has(reconciliationKey)) return;

    const jobId = activeJobId;
    exportingJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportChapters({
          directory: resolvedAutoExportDirectory,
          exportJobId: activeJobId,
          chapters: chapters.map(exportInput),
          recoveryOnConflict: true,
        });
        if (autoExportJobRef.current !== jobId) return;
        if (result.directory !== resolvedAutoExportDirectory) setAutoExportResolvedDirectory(result.directory);
        setExportedRecords((current) => {
          const records = new Map(current.map((record) => [exportRecordKey(record), record]));
          for (const record of result.records) records.set(exportRecordKey(record), record);
          return [...records.values()].sort((left, right) => left.index - right.index || left.title.localeCompare(right.title));
        });
        reconciledAutoExportsRef.current.add(reconciliationKey);
        autoExportRetryAttemptsRef.current.delete(`${jobId}:chapters`);
        const saved = result.records.filter((record) => record.status === 'saved').length;
        const skipped = result.records.length - saved;
        setAppNotice(
          `Đã checkpoint, chia theo đoạn và lưu thêm ${saved} chương tại ${result.directory}`
          + (skipped ? `; bỏ qua ${skipped} file đã tồn tại.` : '.'),
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể tự chia và lưu checkpoint đã dịch.');
        scheduleAutoExportRetry(jobId, 'chapters');
      } finally {
        exportingJobsRef.current.delete(jobId);
      }
    })();
  }, [
    activeJobId,
    appAvailable,
    autoExportJobId,
    autoExportOutputChapterStart,
    autoExportOmitOutputChapterTitles,
    autoExportRetryTick,
    resolvedAutoExportDirectory,
    exportedRecords,
    autoExportOutput,
    scheduleAutoExportRetry,
    splitForAutomaticExport,
    translationState,
  ]);

  useEffect(() => {
    // This is intentionally a separate checkpoint stream from the 750--800
    // word files above. It preserves one complete translated website chapter
    // per TXT in the dedicated subfolder, without cutting dialogue or prose.
    const terminal = translationState === 'complete';
    if (
      !appAvailable
      || !exportOriginalChapters
      || !activeJobId
      || activeJobId !== autoExportJobId
      || !resolvedAutoExportDirectory
      || !autoExportOutput.trim()
      || exportingOriginalJobsRef.current.has(activeJobId)
    ) return;

    const originalChapters = splitSealedOriginalChapters(autoExportOutput, splitForAutomaticExport, terminal);
    const chapters = renumberOriginalExportChapters(
      originalChapters,
      splitSealedChapters(autoExportOutput, splitForAutomaticExport, terminal),
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    if (!chapters.length) return;

    const reconciliationKey = `original\u0000${activeJobId}\u0000${resolvedAutoExportDirectory}\u0000${chapters.map(chapterContentFingerprint).join(',')}`;
    if (reconciledAutoExportsRef.current.has(reconciliationKey)) return;

    const jobId = activeJobId;
    exportingOriginalJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportOriginalChapters({
          directory: resolvedAutoExportDirectory,
          exportJobId: activeJobId,
          chapters: chapters.map(exportInput),
          recoveryOnConflict: true,
        });
        if (autoExportJobRef.current !== jobId) return;
        const parentDirectory = result.directory.endsWith('\\Chương dịch gốc chưa chia')
          ? result.directory.slice(0, -'\\Chương dịch gốc chưa chia'.length)
          : resolvedAutoExportDirectory;
        if (parentDirectory !== resolvedAutoExportDirectory) setAutoExportResolvedDirectory(parentDirectory);
        setOriginalExportedRecords((current) => {
          const records = new Map(current.map((record) => [exportRecordKey(record), record]));
          for (const record of result.records) records.set(exportRecordKey(record), record);
          return [...records.values()].sort((left, right) => left.index - right.index || left.title.localeCompare(right.title));
        });
        reconciledAutoExportsRef.current.add(reconciliationKey);
        autoExportRetryAttemptsRef.current.delete(`${jobId}:originals`);
        const saved = result.records.filter((record) => record.status === 'saved').length;
        const skipped = result.records.length - saved;
        setAppNotice(
          `Đã checkpoint và lưu thêm ${saved} chương dịch gốc chưa chia tại ${result.directory}`
          + (skipped ? `; bỏ qua ${skipped} file đã tồn tại.` : '.'),
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể lưu checkpoint chương dịch gốc.');
        scheduleAutoExportRetry(jobId, 'originals');
      } finally {
        exportingOriginalJobsRef.current.delete(jobId);
      }
    })();
  }, [
    activeJobId,
    appAvailable,
    autoExportJobId,
    autoExportOutputChapterStart,
    autoExportOmitOutputChapterTitles,
    autoExportRetryTick,
    resolvedAutoExportDirectory,
    exportOriginalChapters,
    originalExportedRecords,
    autoExportOutput,
    scheduleAutoExportRetry,
    splitForAutomaticExport,
    translationState,
  ]);

  useEffect(() => {
    if (
      !appAvailable
      || !exportCombinedSourceChapters
      || translationState !== 'complete'
      || !activeJobId
      || activeJobId !== autoExportJobId
      || !resolvedAutoExportDirectory
      || !autoExportSource.trim()
      || !autoExportOutput.trim()
      || exportingCombinedSourceJobsRef.current.has(activeJobId)
    ) return;

    const range = autoExportRange ?? sourceChapterRange(autoExportSource, splitForAutomaticExport);
    if (!range) {
      setAppNotice('Không xác định được dải chương gốc liên tục để tạo file tổng bản gốc.');
      return;
    }
    const sourceChapters = splitSealedOriginalChapters(autoExportSource, splitForAutomaticExport, true);
    const chapters = renumberFinalExportChapters(
      sourceChapters,
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    if (!chapters.length || chapters.length !== range.sourceChapterNumbers.length) {
      setAppNotice('Số chương trong nguồn tải về không khớp dải chương đã chọn; chưa tạo file tổng bản gốc để tránh thiếu nội dung.');
      return;
    }
    const outputStartChapter = chapters[0]?.index;
    const outputEndChapter = chapters.at(-1)?.index;
    if (outputStartChapter === undefined || outputEndChapter === undefined) return;
    const splitOutputChapters = renumberFinalExportChapters(
      splitSealedChapters(autoExportOutput, splitForAutomaticExport, true),
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    const splitOutputStartChapter = splitOutputChapters[0]?.index;
    const splitOutputEndChapter = splitOutputChapters.at(-1)?.index;
    if (splitOutputStartChapter === undefined || splitOutputEndChapter === undefined) return;
    const combinedHash = combinedChapterContentFingerprint(outputStartChapter, outputEndChapter, chapters);
    const reconciliationKey = `combined-source\u0000${activeJobId}\u0000${resolvedAutoExportDirectory}\u0000${range.startChapter}-${range.endChapter}\u0000${combinedHash}`;
    if (
      combinedSourceExport
      && combinedSourceExport.exportJobId === activeJobId
      && combinedSourceExport.exportDirectory === resolvedAutoExportDirectory
      && combinedSourceExport.contentHash === combinedHash
      && combinedSourceExport.startChapter === outputStartChapter
      && combinedSourceExport.endChapter === outputEndChapter
      && combinedSourceExport.chapterCount === chapters.length
      && reconciledAutoExportsRef.current.has(reconciliationKey)
    ) return;

    const jobId = activeJobId;
    exportingCombinedSourceJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportCombinedSourceChapters({
          directory: resolvedAutoExportDirectory,
          exportJobId: activeJobId,
          sourceStartChapter: range.startChapter,
          sourceEndChapter: range.endChapter,
          outputStartChapter,
          outputEndChapter,
          splitOutputStartChapter,
          splitOutputEndChapter,
          chapters: chapters.map(exportInput),
          recoveryOnConflict: true,
        });
        if (autoExportJobRef.current !== jobId) return;
        setCombinedSourceExport(result);
        reconciledAutoExportsRef.current.add(reconciliationKey);
        if (result.directory !== resolvedAutoExportDirectory) setAutoExportResolvedDirectory(result.directory);
        autoExportRetryAttemptsRef.current.delete(`${jobId}:combined-source`);
        setAppNotice(
          result.status === 'saved'
            ? `Đã tạo file tổng bản gốc ${result.fileName}.`
            : `File tổng bản gốc ${result.fileName} đã tồn tại và có nội dung trùng khớp.`,
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể tạo file tổng các chương gốc.');
        scheduleAutoExportRetry(jobId, 'combined-source');
      } finally {
        exportingCombinedSourceJobsRef.current.delete(jobId);
      }
    })();
  }, [
    activeJobId,
    appAvailable,
    autoExportJobId,
    autoExportOmitOutputChapterTitles,
    autoExportOutputChapterStart,
    autoExportRange,
    autoExportRetryTick,
    autoExportOutput,
    autoExportSource,
    combinedSourceExport,
    exportCombinedSourceChapters,
    resolvedAutoExportDirectory,
    scheduleAutoExportRetry,
    splitForAutomaticExport,
    translationState,
  ]);

  useEffect(() => {
    // The compilation intentionally waits for the *terminal* split result.
    // A live trailing source chapter can rebalance its 750--800 word boundary,
    // so publishing it early would make the aggregate stale or incomplete.
    if (
      !appAvailable
      || !exportCombinedChapters
      || translationState !== 'complete'
      || !activeJobId
      || activeJobId !== autoExportJobId
      || !resolvedAutoExportDirectory
      || !autoExportOutput.trim()
      || exportingCombinedJobsRef.current.has(activeJobId)
    ) return;

    const chapters = renumberFinalExportChapters(
      splitSealedChapters(autoExportOutput, splitForAutomaticExport, true),
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    if (!chapters.length) return;
    const range = autoExportRange ?? sourceChapterRange(source, splitForAutomaticExport);
    if (!range) {
      setAppNotice('Không xác định được phạm vi chương gốc để tạo file tổng hợp. Các file chương lẻ vẫn đã được lưu an toàn.');
      return;
    }
    // Legacy exports retain their original website-range name. A user-set
    // sequence instead names the aggregate after the actual split output
    // range, so source chapter 40 split into 101–102 is visible honestly.
    const summaryStartChapter = autoExportOutputChapterStart === undefined
      ? range.startChapter
      : chapters[0]?.index;
    const summaryEndChapter = autoExportOutputChapterStart === undefined
      ? range.endChapter
      : chapters.at(-1)?.index;
    if (summaryStartChapter === undefined || summaryEndChapter === undefined) return;
    const combinedHash = combinedChapterContentFingerprint(summaryStartChapter, summaryEndChapter, chapters);
    const reconciliationKey = `combined\u0000${activeJobId}\u0000${resolvedAutoExportDirectory}\u0000${combinedHash}`;
    if (
      combinedExport
      && combinedExport.exportJobId === activeJobId
      && combinedExport.exportDirectory === resolvedAutoExportDirectory
      && combinedExport.contentHash === combinedHash
      && combinedExport.startChapter === summaryStartChapter
      && combinedExport.endChapter === summaryEndChapter
      && combinedExport.chapterCount === chapters.length
      && reconciledAutoExportsRef.current.has(reconciliationKey)
    ) return;

    const jobId = activeJobId;
    exportingCombinedJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportCombinedChapters({
          directory: resolvedAutoExportDirectory,
          exportJobId: activeJobId,
          startChapter: summaryStartChapter,
          endChapter: summaryEndChapter,
          sourceChapterNumbers: range.sourceChapterNumbers,
          chapters: chapters.map(exportInput),
          recoveryOnConflict: true,
        });
        if (autoExportJobRef.current !== jobId) return;
        setCombinedExport(result);
        reconciledAutoExportsRef.current.add(reconciliationKey);
        if (result.directory !== resolvedAutoExportDirectory) setAutoExportResolvedDirectory(result.directory);
        autoExportRetryAttemptsRef.current.delete(`${jobId}:combined`);
        setAppNotice(
          result.status === 'saved'
            ? `Đã tạo file tổng hợp ${result.fileName}.`
            : `File tổng hợp ${result.fileName} đã tồn tại; giữ nguyên file cũ.`,
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể tạo file tổng hợp các chương đã chia.');
        scheduleAutoExportRetry(jobId, 'combined');
      } finally {
        exportingCombinedJobsRef.current.delete(jobId);
      }
    })();
  }, [
    activeJobId,
    appAvailable,
    autoExportJobId,
    autoExportOutputChapterStart,
    autoExportOmitOutputChapterTitles,
    autoExportRetryTick,
    autoExportRange,
    combinedExport,
    exportCombinedChapters,
    resolvedAutoExportDirectory,
    exportedRecords,
    autoExportOutput,
    scheduleAutoExportRetry,
    source,
    splitForAutomaticExport,
    translationState,
  ]);

  useEffect(() => {
    // Do not clear the durable job->export link until *every* enabled format
    // has been written. If the app closes in between, atomic exclusive writes
    // and the persisted records make this effect resume idempotently.
    if (
      translationState !== 'complete'
      || !activeJobId
      || activeJobId !== autoExportJobId
      || !resolvedAutoExportDirectory
      || !autoExportOutput.trim()
    ) return;
    const rawSplitChapters = splitSealedChapters(autoExportOutput, splitForAutomaticExport, true);
    const splitChapters = renumberFinalExportChapters(
      rawSplitChapters,
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    const splitKnown = new Set(exportedRecords.map(exportRecordKey));
    if (splitChapters.some((chapter) => !splitKnown.has(exportInputKey(activeJobId, resolvedAutoExportDirectory, chapter)))) return;

    if (exportOriginalChapters) {
      const originals = renumberOriginalExportChapters(
        splitSealedOriginalChapters(autoExportOutput, splitForAutomaticExport, true),
        rawSplitChapters,
        autoExportOutputChapterStart,
        autoExportOmitOutputChapterTitles,
      );
      const originalKnown = new Set(originalExportedRecords.map(exportRecordKey));
      if (originals.some((chapter) => !originalKnown.has(exportInputKey(activeJobId, resolvedAutoExportDirectory, chapter)))) return;
    }

    if (exportCombinedChapters) {
      const range = autoExportRange ?? sourceChapterRange(source, splitForAutomaticExport);
      // A deliberately non-contiguous website selection has no honest
      // "from X to Y" summary name. The prior effect reports this explicitly;
      // it must not leave an otherwise complete job stuck forever.
      if (!range) {
        autoExportJobRef.current = '';
        setAutoExportJobId('');
        setAutoExportStartedAt(0);
        autoExportOutputChapterStartRef.current = undefined;
        setAutoExportOutputChapterStart(undefined);
        setAutoExportOmitOutputChapterTitles(false);
        return;
      }
      const summaryStartChapter = autoExportOutputChapterStart === undefined
        ? range.startChapter
        : splitChapters[0]?.index;
      const summaryEndChapter = autoExportOutputChapterStart === undefined
        ? range.endChapter
        : splitChapters.at(-1)?.index;
      if (summaryStartChapter === undefined || summaryEndChapter === undefined) return;
      const combinedHash = combinedChapterContentFingerprint(summaryStartChapter, summaryEndChapter, splitChapters);
      if (!combinedExport
        || combinedExport.exportJobId !== activeJobId
        || combinedExport.exportDirectory !== resolvedAutoExportDirectory
        || combinedExport.contentHash !== combinedHash
        || combinedExport.startChapter !== summaryStartChapter
        || combinedExport.endChapter !== summaryEndChapter
        || combinedExport.chapterCount !== splitChapters.length) return;
    }

    if (exportCombinedSourceChapters) {
      const range = autoExportRange ?? sourceChapterRange(autoExportSource, splitForAutomaticExport);
      if (!range) return;
      const sourceChapters = renumberFinalExportChapters(
        splitSealedOriginalChapters(autoExportSource, splitForAutomaticExport, true),
        autoExportOutputChapterStart,
        autoExportOmitOutputChapterTitles,
      );
      if (!sourceChapters.length || sourceChapters.length !== range.sourceChapterNumbers.length) return;
      const sourceOutputStart = sourceChapters[0]?.index;
      const sourceOutputEnd = sourceChapters.at(-1)?.index;
      if (sourceOutputStart === undefined || sourceOutputEnd === undefined) return;
      const sourceCombinedHash = combinedChapterContentFingerprint(sourceOutputStart, sourceOutputEnd, sourceChapters);
      if (!combinedSourceExport
        || combinedSourceExport.exportJobId !== activeJobId
        || combinedSourceExport.exportDirectory !== resolvedAutoExportDirectory
        || combinedSourceExport.contentHash !== sourceCombinedHash
        || combinedSourceExport.startChapter !== sourceOutputStart
        || combinedSourceExport.endChapter !== sourceOutputEnd
        || combinedSourceExport.chapterCount !== sourceChapters.length) return;
    }

    autoExportJobRef.current = '';
    setAutoExportJobId('');
    setAutoExportStartedAt(0);
    autoExportOutputChapterStartRef.current = undefined;
    setAutoExportOutputChapterStart(undefined);
    setAutoExportOmitOutputChapterTitles(false);
    setAutoExportSource('');
    setAutoExportResolvedDirectory(undefined);
    setAppNotice('Đã hoàn tất dịch, chia theo đoạn và lưu toàn bộ các định dạng đã chọn.');
  }, [
    activeJobId,
    autoExportJobId,
    autoExportRange,
    autoExportOutputChapterStart,
    autoExportOmitOutputChapterTitles,
    combinedExport,
    combinedSourceExport,
    exportCombinedChapters,
    exportCombinedSourceChapters,
    exportOriginalChapters,
    exportedRecords,
    originalExportedRecords,
    autoExportOutput,
    autoExportSource,
    resolvedAutoExportDirectory,
    source,
    splitForAutomaticExport,
    translationState,
  ]);

  const connectionInfo = connectionPresentation(connection, aiProvider);
  const providerLabel = aiProviderLabel(aiProvider);
  const outputHanCount = useMemo(() => (output.match(/\p{Script=Han}/gu) ?? []).length, [output]);
  const outputWords = useMemo(() => analyzeTextLanguage(output, 'vi').totalWords, [output]);
  const canStart = Boolean(source.trim()) && (promptMode !== 'custom' || Boolean(customPrompt.trim()));

  return (
    <div className="app-shell" data-theme={colorTheme}>
      <div className="window-titlebar">
        <span className="window-titlebar__mark" aria-hidden="true"><Icon name="book" size={16} /></span>
        <span className="window-titlebar__title">Dịch Truyện · Trung → Việt</span>
        <div className="window-titlebar__controls" aria-label="Điều khiển cửa sổ">
          <button aria-label="Thu nhỏ" className="window-titlebar__control" onClick={() => void getStoryTool().minimizeWindow?.()} type="button"><span aria-hidden="true" className="window-control-icon window-control-icon--minimize" /></button>
          <button aria-label="Phóng to hoặc khôi phục" className="window-titlebar__control" onClick={() => void getStoryTool().toggleMaximizeWindow?.()} type="button"><span aria-hidden="true" className="window-control-icon window-control-icon--maximize" /></button>
          <button aria-label="Đóng ứng dụng" className="window-titlebar__control window-titlebar__control--close" onClick={() => void getStoryTool().closeWindow?.()} type="button"><span aria-hidden="true" className="window-control-icon window-control-icon--close" /></button>
        </div>
      </div>
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark"><Icon name="book" size={24} /></span>
          <div>
            <h1>Dịch Truyện</h1>
            <p>Trung <span>→</span> Việt</p>
          </div>
        </div>
        <div className="connection-box">
          <div className="connection-box__identity">
            <div className="connection-box__status-row">
              <StatusPill tone={connectionInfo.tone} pulse={connection === 'connecting'}>{connectionInfo.label}</StatusPill>
              <div className="ai-provider-switch" aria-label="AI dùng để dịch" role="radiogroup">
                {(['chatgpt', 'kimi'] as const).map((provider) => (
                  <button
                    aria-checked={aiProvider === provider}
                    className={aiProvider === provider ? 'is-active' : ''}
                    disabled={!appAvailable || ['running', 'cancelling'].includes(translationState)}
                    key={provider}
                    onClick={() => void changeAiProvider(provider)}
                    role="radio"
                    type="button"
                  >
                    {provider === 'kimi' ? 'Kimi AI' : 'ChatGPT'}
                  </button>
                ))}
              </div>
            </div>
            <small>Phiên đăng nhập được lưu cục bộ trên máy này.</small>
          </div>
          <button
            className="button button--secondary"
            onClick={() => setIsActivityLogOpen((open) => !open)}
            type="button"
          >
            <Icon name="save" />
            {isActivityLogOpen ? 'Ẩn nhật ký' : `Nhật ký${activityLog.length ? ` (${activityLog.length})` : ''}`}
          </button>
          <button
            aria-label={colorTheme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            aria-pressed={colorTheme === 'dark'}
            className="button button--secondary theme-toggle"
            onClick={() => setColorTheme((current) => current === 'dark' ? 'light' : 'dark')}
            type="button"
          >
            <span aria-hidden="true">{colorTheme === 'dark' ? '☀' : '☾'}</span>
            {colorTheme === 'dark' ? 'Sáng' : 'Tối'}
          </button>
          <button className="button button--secondary" disabled={!appAvailable || connection === 'connecting'} onClick={connectAi} type="button">
            <Icon name="link" />
            {connection === 'connected' || connection === 'login-required'
              ? 'Kiểm tra kết nối'
              : connection === 'connecting'
                ? 'Đang mở…'
                : 'Kết nối'}
          </button>
        </div>
      </header>

      <main>
        {appNotice && (
          <div className="app-notice" role="status">
            <Icon name={connection === 'error' || translationState === 'error' ? 'alert' : 'check'} />
            <strong className="app-notice__label">Thông báo:</strong>
            <span>{appNotice}</span>
            <button aria-label="Đóng thông báo" onClick={() => setAppNotice('')} type="button">×</button>
          </div>
        )}

        <div className="translation-grid">
          <section className={`panel source-panel${sourceMode === 'link' ? ' source-panel--link' : ''}`} aria-labelledby="source-heading">
            <div className="panel__heading">
              <div>
                <span className="eyebrow">Bước 1</span>
                <h2 id="source-heading">Nội dung tiếng Trung</h2>
              </div>
              <span className="field-badge">原文</span>
            </div>
            <div className="source-mode-switch" role="tablist" aria-label="Cách nhập nguồn truyện">
              <button
                aria-selected={sourceMode === 'text'}
                className={sourceMode === 'text' ? 'is-active' : ''}
                disabled={manualVerificationState === 'opening'}
                onClick={switchToTextImport}
                role="tab"
                type="button"
              >Dán nội dung</button>
              <button
                aria-selected={sourceMode === 'link'}
                className={sourceMode === 'link' ? 'is-active' : ''}
                disabled={manualVerificationState === 'opening'}
                onClick={() => setSourceMode('link')}
                role="tab"
                type="button"
              >Nhập link truyện</button>
            </div>
            {sourceMode === 'text' ? (
              <textarea
                aria-label="Nội dung tiếng Trung cần dịch"
                className="story-editor story-editor--source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Dán nội dung truyện tiếng Trung vào đây…"
                spellCheck={false}
              />
            ) : (
              <StoryLinkImporter
                analysis={storyAnalysis}
                disabled={translationState === 'running' || translationState === 'cancelling'}
                exportDirectory={exportDirectory}
                exportOriginalChapters={exportOriginalChapters}
                exportCombinedChapters={exportCombinedChapters}
                exportedRecords={exportedRecords}
                originalExportedRecords={originalExportedRecords}
                combinedExport={combinedExport}
                manualVerificationState={manualVerificationState}
                progress={storyProgress}
                selectedChapterIds={selectedChapterIds}
                state={storyImportState}
                url={storyUrl}
                onAnalyze={() => { void analyzeStoryUrl(); }}
                onCancel={cancelStoryFetch}
                onOpenManualVerification={() => { void openStoryManualVerification(); }}
                onRevealBrowserHelper={() => { void revealHuliBrowserHelper(); }}
                onSwitchToText={switchToTextImport}
                onChooseDirectory={chooseChapterDirectory}
                onExportOriginalChaptersChange={setExportOriginalChapters}
                onExportCombinedChaptersChange={setExportCombinedChapters}
                onClearSelection={() => setSelectedChapterIds(new Set())}
                onFetchAndTranslate={fetchAndTranslateStory}
                onSelectAll={() => setSelectedChapterIds(new Set(
                  storyAnalysis?.chapters.filter((chapter) => !chapter.isIntroduction).map((chapter) => chapter.id) ?? [],
                ))}
                onSelectRange={(start, end) => {
                  if (!storyAnalysis) return;
                  const lower = Math.min(start, end);
                  const upper = Math.max(start, end);
                  // The range controls are catalog positions, not potentially
                  // sparse/duplicated chapter labels from the website.
                  setSelectedChapterIds(new Set(storyAnalysis.chapters
                    .filter((chapter) => !chapter.isIntroduction)
                    .slice(lower - 1, upper)
                    .map((chapter) => chapter.id)));
                }}
                onToggleChapter={(id) => setSelectedChapterIds((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })}
                onUrlChange={(value) => {
                  setStoryUrl(value);
                  setManualVerificationState('none');
                  if (storyAnalysis && value.trim() !== storyAnalysis.inputUrl) {
                    setStoryAnalysis(null);
                    setSelectedChapterIds(new Set());
                    setOutputChapterStart(undefined);
                    setStoryImportState('idle');
                  }
                }}
              />
            )}
            <div className="editor-footer" />
          </section>

          <PromptSelector
            customPrompt={customPrompt}
            loading={promptsLoading}
            mode={promptMode}
            omitOutputChapterTitles={omitOutputChapterTitles}
            exportCombinedSourceChapters={exportCombinedSourceChapters}
            outputChapterStart={outputChapterStart}
            prompts={prompts}
            suggestedChapterStart={sourceMode === 'link' ? suggestedOutputChapterStart : undefined}
            onCustomPromptChange={(value) => {
              setCustomPrompt(value);
              if (value.length > 0) setPromptMode('custom');
            }}
            onModeChange={setPromptMode}
            onOmitOutputChapterTitlesChange={setOmitOutputChapterTitles}
            onExportCombinedSourceChaptersChange={setExportCombinedSourceChapters}
            onOutputChapterStartChange={setOutputChapterStart}
          />

          <section className="panel output-panel" aria-labelledby="output-heading">
            <div className="panel__heading output-panel__heading">
              <div>
                <span className="eyebrow">Bước 3</span>
                <h2 id="output-heading">Nội dung đã dịch</h2>
                <p>Chỉnh sửa trực tiếp, tự động lưu cục bộ.</p>
              </div>
              <div className={`save-indicator save-indicator--${saveState}`} aria-live="polite">
                {saveState === 'saving' && <><span className="spinner spinner--small" /> Đang lưu…</>}
                {saveState === 'saved' && <><Icon name="check" size={14} /> Đã lưu {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}</>}
                {saveState === 'error' && <><Icon name="alert" size={14} /> Lưu thất bại</>}
              </div>
            </div>

            <textarea
              aria-label="Nội dung truyện đã dịch"
              className={`story-editor story-editor--output${outputHanCount ? ' has-han-warning' : ''}`}
              value={output}
              onChange={(event) => setOutput(event.target.value)}
              placeholder="Bản dịch sẽ được ghép vào đây theo đúng thứ tự. Bạn cũng có thể nhập hoặc dán bản dịch để dùng riêng công cụ chia chương."
              spellCheck
            />
            <div className="output-toolbar">
              <div className="output-stats">
                <span><strong>{outputWords.toLocaleString('vi-VN')}</strong> chữ</span>
                <span><strong>{output.length.toLocaleString('vi-VN')}</strong> ký tự</span>
                <span className={outputHanCount ? 'text-danger' : 'text-success'}>
                  <strong>{outputHanCount}</strong> chữ Hán còn sót
                </span>
              </div>
              <div className="action-row action-row--compact">
                <button className="button button--secondary" disabled={!output} onClick={copyOutput} type="button"><Icon name="copy" /> Sao chép</button>
                <button className="button button--primary" disabled={!output || !appAvailable} onClick={exportOutput} type="button"><Icon name="download" /> Xuất TXT</button>
              </div>
            </div>
          </section>
        </div>

        <TranslationControls
          providerLabel={providerLabel}
          canStart={canStart}
          completedSegments={completedSegments}
          connected={connection === 'connected'}
          errors={segmentErrors}
          canContinueFromCheckpoint={canContinueFromCheckpoint}
          splitCheckpoint={splitCheckpoint}
          state={translationState}
          totalSegments={totalSegments}
          onCancel={cancelTranslation}
          onPause={pauseTranslation}
          onResume={resumeTranslation}
          onRetry={retrySegment}
          onStart={startTranslation}
        />

        {isActivityLogOpen && (
          <section className="translation-activity-log" aria-label="Nhật ký tiến trình dịch">
            <header>
              <div>
                <strong>Nhật ký tiến trình</strong>
                <small>Lưu cùng checkpoint · giờ hiển thị theo máy này</small>
              </div>
              <button className="button button--tiny" onClick={() => setIsActivityLogOpen(false)} type="button">Đóng</button>
            </header>
            {activityLog.length ? (
              <ol>
                {[...activityLog].reverse().map((entry, index) => (
                  <li className={`translation-activity-log__entry translation-activity-log__entry--${entry.tone}`} key={`${entry.at}-${index}`}>
                    <time dateTime={entry.at}>{new Date(entry.at).toLocaleString('vi-VN')}</time>
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Chưa có nhật ký cho checkpoint này. Các bước mới sẽ xuất hiện khi tool tiếp tục chạy.</p>
            )}
          </section>
        )}

        {translationHistory.length > 0 && (
          <details className="translation-history">
            <summary>
              <span><Icon name="save" /> Lịch sử checkpoint cần xử lý ({translationHistory.length})</span>
              <small>Không chặn tác vụ mới</small>
            </summary>
            <div className="translation-history__list">
              {translationHistory.map((job) => {
                const isCancelled = job.status === 'cancelled';
                const failedSegment = job.segments.find((segment) => segment.status === 'failed');
                const label = isCancelled ? 'Đã hủy' : 'Lỗi';
                const detail = job.error
                  || job.segments.find((segment) => segment.error)?.error
                  || (isCancelled ? 'Tác vụ đã được hủy trước khi hoàn tất.' : 'Checkpoint dừng trước khi hoàn tất.');
                return (
                  <article className="translation-history__item" key={job.id}>
                    <div>
                      <strong>{label} · {job.completedSegments}/{job.totalSegments} đoạn</strong>
                      <small>{new Date(job.updatedAt).toLocaleString('vi-VN')}</small>
                      <p title={detail}>{detail}</p>
                    </div>
                    <div className="action-row action-row--compact">
                      {failedSegment ? (
                        <button className="button button--tiny" onClick={() => void retryTranslationHistorySegment(job, failedSegment.id)} type="button">Bắt đầu từ CP lỗi</button>
                      ) : job.segments.some((segment) => segment.status === 'queued') && (
                        <button className="button button--tiny" onClick={() => void resumeTranslationHistoryJob(job)} type="button">Bắt đầu từ CP lỗi</button>
                      )}
                      <button className="button button--tiny" onClick={() => void restartTranslationHistoryJob(job)} type="button">Bắt đầu lại từ đầu</button>
                      <button className="button button--danger-ghost button--tiny" onClick={() => void discardTranslationCheckpoint(job)} type="button">Bỏ checkpoint</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
        )}

        <details
          className="chapter-drawer"
          onToggle={(event) => setIsChapterDrawerOpen(event.currentTarget.open)}
        >
          <summary>
            <span><Icon name="split" /> Chia chương tự động</span>
            <small>
              {splitCheckpoint.status === 'splitting'
                ? 'Đang cập nhật checkpoint…'
                : splitCheckpoint.chapterCount > 0
                  ? `Đã chia tạm ${splitCheckpoint.chapterCount} chương`
                  : 'Tự chạy theo từng phần đã dịch'}
            </small>
          </summary>
          {isChapterDrawerOpen && (
            <ChapterSplitter
              config={splitConfig}
              sourceText={output}
              onConfigChange={setSplitConfig}
              onDetectedChapterStart={(chapterNumber) => {
                setSplitConfig((current) => (
                  current.startIndex === chapterNumber && !current.prefix && !current.suffix && current.autoDetectTitle
                    ? current
                    : {
                      ...current,
                      startIndex: chapterNumber,
                      prefix: '',
                      suffix: '',
                      autoDetectTitle: true,
                    }
                ));
              }}
              onCheckpoint={setSplitCheckpoint}
            />
          )}
        </details>
      </main>

      <footer className="app-footer">
        <span>Dữ liệu bản thảo được lưu trên thiết bị của bạn.</span>
        <span>{providerLabel} chỉ nhận nội dung khi bạn bắt đầu dịch.</span>
      </footer>
    </div>
  );
}
