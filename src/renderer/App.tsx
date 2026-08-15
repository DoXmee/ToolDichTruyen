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
  TranslationJobSnapshot,
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
  /** Split 750--800 word files that were safely published already. */
  exportedRecords: ChapterExportRecord[];
  /** Whole translated source chapters published beside the split files. */
  originalExportedRecords: ChapterExportRecord[];
  /** The idempotent, final aggregate file, if it has been published. */
  combinedExport?: CombinedChapterExportResult;
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

const DEFAULT_PROMPTS = { historical: '', modern: '' };

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
  return value === 'period' || value === 'modern' || value === 'custom' ? value : 'period';
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

function connectionPresentation(state: ConnectionState) {
  switch (state) {
    case 'connected': return { label: 'ChatGPT đã kết nối', tone: 'success' as const };
    case 'connecting': return { label: 'Đang mở ChatGPT…', tone: 'info' as const };
    case 'login-required': return { label: 'Chờ đăng nhập ChatGPT', tone: 'warning' as const };
    case 'error': return { label: 'Kết nối có lỗi', tone: 'danger' as const };
    default: return { label: 'Chưa kết nối ChatGPT', tone: 'neutral' as const };
  }
}

/**
 * The renderer only offers the manual browser flow for Huliwang. This is a
 * convenience guard, not a trust boundary: the main-process IPC validates the
 * URL again before it starts the local default-browser pairing flow.
 */
function isHuliwangStoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && ['huliwang.net', 'm.huliwang.net', 'www.huliwang.net'].includes(hostname);
  } catch {
    return false;
  }
}

function isCloudflareVerificationMessage(message: string): boolean {
  return /Cloudflare|Turnstile|Just a moment|security verification|xác minh|trình duyệt mặc định|tiện ích Huliwang|Huli Browser Helper|tiện ích trình duyệt|kết nối tiện ích|cầu nối Huliwang|phiên bản.*tiện ích|Tải lại tiện ích|Reload|bridge/iu.test(message);
}

export default function App() {
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
  const [exportedRecords, setExportedRecords] = useState<ChapterExportRecord[]>([]);
  const [originalExportedRecords, setOriginalExportedRecords] = useState<ChapterExportRecord[]>([]);
  const [combinedExport, setCombinedExport] = useState<CombinedChapterExportResult | undefined>();
  const [promptMode, setPromptMode] = useState<PromptMode>('period');
  const [customPrompt, setCustomPrompt] = useState('');
  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS);
  const [splitConfig, setSplitConfig] = useState<SplitConfig>(DEFAULT_SPLIT_CONFIG);
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [translationState, setTranslationState] = useState<TranslationState>('idle');
  const [activeJobId, setActiveJobId] = useState('');
  const [translationHistory, setTranslationHistory] = useState<TranslationJobSnapshot[]>([]);
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
  const exportingCombinedJobsRef = useRef<Set<string>>(new Set());
  const appAvailable = hasStoryTool();

  const refreshTranslationHistory = useCallback(async () => {
    if (!appAvailable) return;
    const jobs = await getStoryTool().discoverTranslations();
    setTranslationHistory(jobs.filter((job) => job.status === 'failed' || job.status === 'cancelled'));
  }, [appAvailable]);
  const suggestedOutputChapterStart = useMemo(() => {
    if (!storyAnalysis) return undefined;
    return storyAnalysis.chapters
      .filter((chapter) => !chapter.isIntroduction && selectedChapterIds.has(chapter.id))
      .sort((first, second) => first.order - second.order)
      .map((chapter) => chapter.number)
      .find((number): number is number => typeof number === 'number' && Number.isInteger(number) && number > 0);
  }, [selectedChapterIds, storyAnalysis]);

  useEffect(() => {
    activeJobRef.current = activeJobId;
  }, [activeJobId]);

  useEffect(() => {
    autoExportJobRef.current = autoExportJobId;
  }, [autoExportJobId]);

  useEffect(() => {
    autoExportOutputChapterStartRef.current = autoExportOutputChapterStart;
  }, [autoExportOutputChapterStart]);

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
        if (Array.isArray(draft.exportedRecords)) {
          setExportedRecords(draft.exportedRecords.filter(isChapterExportRecord));
        }
        if (Array.isArray(draft.originalExportedRecords)) {
          setOriginalExportedRecords(draft.originalExportedRecords.filter(isChapterExportRecord));
        }
        if (isCombinedExportResult(draft.combinedExport)) setCombinedExport(draft.combinedExport);
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
      const draft: RendererDraft = {
        version: 2,
        source,
        output,
        promptMode,
        customPrompt,
        splitConfig,
        sourceMode,
        storyUrl,
        exportDirectory,
        exportOriginalChapters,
        exportCombinedChapters,
        ...(outputChapterStart !== undefined ? { outputChapterStart } : {}),
        ...(omitOutputChapterTitles ? { omitOutputChapterTitles } : {}),
        autoExportJobId,
        autoExportStartedAt,
        ...(autoExportRange ? { autoExportRange } : {}),
        ...(autoExportOutputChapterStart !== undefined ? { autoExportOutputChapterStart } : {}),
        ...(autoExportJobId ? { autoExportOmitOutputChapterTitles } : {}),
        ...(autoExportOutput ? { autoExportOutput } : {}),
        exportedRecords,
        originalExportedRecords,
        ...(combinedExport ? { combinedExport } : {}),
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
    customPrompt,
    exportDirectory,
    exportOriginalChapters,
    exportCombinedChapters,
    outputChapterStart,
    omitOutputChapterTitles,
    exportedRecords,
    originalExportedRecords,
    combinedExport,
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

  const reconcileTranslationJob = useCallback((job: TranslationJobSnapshot) => {
    if (activeJobRef.current && job.id !== activeJobRef.current) return;
    if (!activeJobRef.current) {
      activeJobRef.current = job.id;
      setActiveJobId(job.id);
    }

    setTotalSegments(job.totalSegments);
    setCompletedSegments(job.completedSegments);
    if (job.translatedText !== undefined) {
      outputRef.current = job.translatedText;
      setOutput(job.translatedText);
      if (job.id === autoExportJobRef.current) setAutoExportOutput(job.translatedText);
    }

    const failedSegments = job.segments
      .filter((segment) => segment.status === 'failed')
      .map((segment) => ({
        id: `${job.id}-${segment.id}`,
        segmentId: segment.id,
        message: segment.error || `Đoạn ${segment.index + 1} chưa vượt qua kiểm tra chất lượng.`,
      }));
    setSegmentErrors(failedSegments);
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
  }, []);

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
        if (recoverable) reconcileTranslationJob(recoverable);
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [appAvailable, reconcileTranslationJob]);

  useEffect(() => {
    void refreshTranslationHistory().catch(() => undefined);
  }, [refreshTranslationHistory]);

  // A book translation may finish just before the window closes. Completed
  // jobs are intentionally absent from the active-job list, so recover the
  // exact pending auto-export job recorded in the draft and hydrate its final
  // output before splitting/saving. This makes the fetch→translate→export
  // workflow crash/restart safe instead of depending only on live events.
  useEffect(() => {
    if (!appAvailable || !initialized || !autoExportJobId || autoExportJobId === 'pending') return;
    let disposed = false;
    void getStoryTool().getTranslation(autoExportJobId)
      .then((job) => {
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
      })
      .catch((error) => {
        if (!disposed) {
          const message = error instanceof Error ? error.message : 'lỗi không xác định';
          setAppNotice(`Không thể khôi phục tác vụ đang chờ lưu chương: ${message}`);
        }
      });
    return () => { disposed = true; };
  }, [appAvailable, autoExportJobId, initialized, reconcileTranslationJob, refreshTranslationHistory]);

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
    const timer = window.setInterval(() => { void synchronize(); }, 1_500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeJobId, appAvailable, reconcileTranslationJob, translationState]);

  useEffect(() => {
    if (!appAvailable) return;
    const api = getStoryTool();
    if (!api.onChatGPTStatus) return;
    return api.onChatGPTStatus((snapshot) => {
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

  const connectChatGPT = async () => {
    if (!appAvailable || connection === 'connecting') return;
    setConnection('connecting');
    setAppNotice('');
    try {
      const result = await getStoryTool().connectChatGPT();
      const status = result.status.toLowerCase();
      if (status.includes('connected') || status.includes('ready')) {
        setConnection('connected');
      } else {
        setConnection('login-required');
        setAppNotice(result.message || 'Hãy hoàn tất đăng nhập trong cửa sổ ChatGPT, sau đó bấm “Kiểm tra kết nối”.');
      }
    } catch (error) {
      setConnection('error');
      setAppNotice(error instanceof Error ? error.message : 'Không thể mở phiên ChatGPT Web.');
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
    setAutoExportOutput('');
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
        customPrompt: promptMode === 'custom' ? customPrompt.trim() : undefined,
        // Keep web automation responsive: each checkpoint is intentionally
        // small, while a healthy long response receives enough time to finish.
        settings: {
          maxRetries: 3,
          maxCharsPerSegment: 3_000,
          responseTimeoutMs: 480_000,
        },
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
      const canVerifyManually = isHuliwangStoryUrl(requestedUrl) && isCloudflareVerificationMessage(message);
      setManualVerificationState(canVerifyManually ? 'available' : 'none');
      setAppNotice(canVerifyManually
        ? `${message} Hãy kết nối tiện ích với trình duyệt mặc định và đúng profile bạn dùng hằng ngày. Kết nối xong, tool sẽ tự phân tích lại link.`
        : message);
    }
  };

  const openStoryManualVerification = async () => {
    const verificationUrl = storyUrl.trim();
    if (!appAvailable || !isHuliwangStoryUrl(verificationUrl)) return;
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
      setAppNotice('Đã kết nối trình duyệt mặc định. Tool đang tự phân tích lại link Huliwang…');
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
      setAppNotice('Hãy kết nối ChatGPT trước khi tải và dịch bộ truyện.');
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
      const needsReconnect = storyAnalysis.site === 'huliwang' && isCloudflareVerificationMessage(message);
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
    reconcileTranslationJob(job);
  };

  const resumeTranslationHistoryJob = async (job: TranslationJobSnapshot) => {
    bindTranslationHistoryJob(job);
    try {
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
    bindTranslationHistoryJob(job);
    setSegmentErrors((current) => current.filter((error) => error.segmentId !== segmentId));
    try {
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

  useEffect(() => {
    // A failed/cancelled job may be resumed. Its trailing source chapter is
    // provisional, so split output is only published when a following source
    // heading proves the boundary; terminal completion seals the last one.
    const terminal = translationState === 'complete';
    if (
      !appAvailable
      || !activeJobId
      || activeJobId !== autoExportJobId
      || !exportDirectory
      || !autoExportOutput.trim()
      || exportingJobsRef.current.has(activeJobId)
    ) return;

    const chapters = renumberFinalExportChapters(
      splitSealedChapters(autoExportOutput, splitForAutomaticExport, terminal),
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    const known = new Set(exportedRecords.map(exportRecordKey));
    const pending = chapters.filter((chapter) => !known.has(exportInputKey(activeJobId, exportDirectory, chapter)));
    if (!pending.length) return;

    const jobId = activeJobId;
    exportingJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportChapters({
          directory: exportDirectory,
          exportJobId: activeJobId,
          chapters: pending.map(exportInput),
        });
        setExportedRecords((current) => {
          const records = new Map(current.map((record) => [exportRecordKey(record), record]));
          for (const record of result.records) records.set(exportRecordKey(record), record);
          return [...records.values()].sort((left, right) => left.index - right.index || left.title.localeCompare(right.title));
        });
        const saved = result.records.filter((record) => record.status === 'saved').length;
        const skipped = result.records.length - saved;
        setAppNotice(
          `Đã checkpoint, chia theo đoạn và lưu thêm ${saved} chương tại ${result.directory}`
          + (skipped ? `; bỏ qua ${skipped} file đã tồn tại.` : '.'),
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể tự chia và lưu checkpoint đã dịch.');
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
    exportDirectory,
    exportedRecords,
    autoExportOutput,
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
      || !exportDirectory
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
    const known = new Set(originalExportedRecords.map(exportRecordKey));
    const pending = chapters.filter((chapter) => !known.has(exportInputKey(activeJobId, exportDirectory, chapter)));
    if (!pending.length) return;

    const jobId = activeJobId;
    exportingOriginalJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportOriginalChapters({
          directory: exportDirectory,
          exportJobId: activeJobId,
          chapters: pending.map(exportInput),
        });
        setOriginalExportedRecords((current) => {
          const records = new Map(current.map((record) => [exportRecordKey(record), record]));
          for (const record of result.records) records.set(exportRecordKey(record), record);
          return [...records.values()].sort((left, right) => left.index - right.index || left.title.localeCompare(right.title));
        });
        const saved = result.records.filter((record) => record.status === 'saved').length;
        const skipped = result.records.length - saved;
        setAppNotice(
          `Đã checkpoint và lưu thêm ${saved} chương dịch gốc chưa chia tại ${result.directory}`
          + (skipped ? `; bỏ qua ${skipped} file đã tồn tại.` : '.'),
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể lưu checkpoint chương dịch gốc.');
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
    exportDirectory,
    exportOriginalChapters,
    originalExportedRecords,
    autoExportOutput,
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
      || !exportDirectory
      || !autoExportOutput.trim()
      || exportingCombinedJobsRef.current.has(activeJobId)
    ) return;

    const chapters = renumberFinalExportChapters(
      splitSealedChapters(autoExportOutput, splitForAutomaticExport, true),
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    if (!chapters.length) return;
    const splitKnown = new Set(exportedRecords.map(exportRecordKey));
    if (chapters.some((chapter) => !splitKnown.has(exportInputKey(activeJobId, exportDirectory, chapter)))) return;

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
    if (
      combinedExport
      && combinedExport.exportJobId === activeJobId
      && combinedExport.exportDirectory === exportDirectory
      && combinedExport.contentHash === combinedHash
      && combinedExport.startChapter === summaryStartChapter
      && combinedExport.endChapter === summaryEndChapter
      && combinedExport.chapterCount === chapters.length
    ) return;

    const jobId = activeJobId;
    exportingCombinedJobsRef.current.add(jobId);
    void (async () => {
      try {
        const result = await getStoryTool().exportCombinedChapters({
          directory: exportDirectory,
          exportJobId: activeJobId,
          startChapter: summaryStartChapter,
          endChapter: summaryEndChapter,
          sourceChapterNumbers: range.sourceChapterNumbers,
          chapters: chapters.map(exportInput),
        });
        setCombinedExport(result);
        setAppNotice(
          result.status === 'saved'
            ? `Đã tạo file tổng hợp ${result.fileName}.`
            : `File tổng hợp ${result.fileName} đã tồn tại; giữ nguyên file cũ.`,
        );
      } catch (error) {
        setAppNotice(error instanceof Error ? error.message : 'Không thể tạo file tổng hợp các chương đã chia.');
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
    autoExportRange,
    combinedExport,
    exportCombinedChapters,
    exportDirectory,
    exportedRecords,
    autoExportOutput,
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
      || !autoExportOutput.trim()
    ) return;
    const rawSplitChapters = splitSealedChapters(autoExportOutput, splitForAutomaticExport, true);
    const splitChapters = renumberFinalExportChapters(
      rawSplitChapters,
      autoExportOutputChapterStart,
      autoExportOmitOutputChapterTitles,
    );
    const splitKnown = new Set(exportedRecords.map(exportRecordKey));
    if (splitChapters.some((chapter) => !splitKnown.has(exportInputKey(activeJobId, exportDirectory, chapter)))) return;

    if (exportOriginalChapters) {
      const originals = renumberOriginalExportChapters(
        splitSealedOriginalChapters(autoExportOutput, splitForAutomaticExport, true),
        rawSplitChapters,
        autoExportOutputChapterStart,
        autoExportOmitOutputChapterTitles,
      );
      const originalKnown = new Set(originalExportedRecords.map(exportRecordKey));
      if (originals.some((chapter) => !originalKnown.has(exportInputKey(activeJobId, exportDirectory, chapter)))) return;
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
        || combinedExport.exportDirectory !== exportDirectory
        || combinedExport.contentHash !== combinedHash
        || combinedExport.startChapter !== summaryStartChapter
        || combinedExport.endChapter !== summaryEndChapter
        || combinedExport.chapterCount !== splitChapters.length) return;
    }

    autoExportJobRef.current = '';
    setAutoExportJobId('');
    setAutoExportStartedAt(0);
    autoExportOutputChapterStartRef.current = undefined;
    setAutoExportOutputChapterStart(undefined);
    setAutoExportOmitOutputChapterTitles(false);
    setAppNotice('Đã hoàn tất dịch, chia theo đoạn và lưu toàn bộ các định dạng đã chọn.');
  }, [
    activeJobId,
    autoExportJobId,
    autoExportRange,
    autoExportOutputChapterStart,
    autoExportOmitOutputChapterTitles,
    combinedExport,
    exportCombinedChapters,
    exportOriginalChapters,
    exportedRecords,
    originalExportedRecords,
    autoExportOutput,
    source,
    splitForAutomaticExport,
    translationState,
  ]);

  const connectionInfo = connectionPresentation(connection);
  const sourceHanCount = useMemo(() => (source.match(/\p{Script=Han}/gu) ?? []).length, [source]);
  const outputHanCount = useMemo(() => (output.match(/\p{Script=Han}/gu) ?? []).length, [output]);
  const outputWords = useMemo(() => analyzeTextLanguage(output, 'vi').totalWords, [output]);
  const canStart = Boolean(source.trim()) && (promptMode !== 'custom' || Boolean(customPrompt.trim()));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark"><Icon name="book" size={24} /></span>
          <div>
            <h1>Dịch Truyện</h1>
            <p>Trung <span>→</span> Việt</p>
          </div>
        </div>
        <div className="connection-box">
          <div>
            <StatusPill tone={connectionInfo.tone} pulse={connection === 'connecting'}>{connectionInfo.label}</StatusPill>
            <small>Phiên đăng nhập được lưu cục bộ trên máy này.</small>
          </div>
          <button className="button button--secondary" disabled={!appAvailable || connection === 'connecting'} onClick={connectChatGPT} type="button">
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
        <section className="hero-copy">
          <span className="eyebrow">Không gian dịch & biên tập</span>
          <h2>Giữ đúng mạch truyện, kiểm soát từng đoạn dịch.</h2>
          <p>Dán bản gốc, chọn phong cách và để công cụ theo dõi lỗi sót chữ Trung trước khi ghép kết quả.</p>
        </section>

        {appNotice && (
          <div className="app-notice" role="status">
            <Icon name={connection === 'error' || translationState === 'error' ? 'alert' : 'check'} />
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
            <div className="editor-footer">
              <span>{source.length.toLocaleString('vi-VN')} ký tự</span>
              <span>{sourceHanCount.toLocaleString('vi-VN')} chữ Hán</span>
              {translationState === 'running' && <span className="editor-footer__note">Tác vụ đang dùng bản nguồn tại lúc bấm Dịch.</span>}
            </div>
          </section>

          <PromptSelector
            customPrompt={customPrompt}
            loading={promptsLoading}
            mode={promptMode}
            omitOutputChapterTitles={omitOutputChapterTitles}
            outputChapterStart={outputChapterStart}
            prompts={prompts}
            suggestedChapterStart={sourceMode === 'link' ? suggestedOutputChapterStart : undefined}
            onCustomPromptChange={(value) => {
              setCustomPrompt(value);
              if (value.length > 0) setPromptMode('custom');
            }}
            onModeChange={setPromptMode}
            onOmitOutputChapterTitlesChange={setOmitOutputChapterTitles}
            onOutputChapterStartChange={setOutputChapterStart}
          />

          <section className="panel output-panel" aria-labelledby="output-heading">
            <div className="panel__heading output-panel__heading">
              <div>
                <span className="eyebrow">Bước 3</span>
                <h2 id="output-heading">Nội dung đã dịch</h2>
                <p>Chỉnh sửa trực tiếp, tự động lưu cục bộ.</p>
              </div>
              <div className="save-indicator" aria-live="polite">
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

        <details className="chapter-drawer">
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
        </details>
      </main>

      <footer className="app-footer">
        <span>Dữ liệu bản thảo được lưu trên thiết bị của bạn.</span>
        <span>ChatGPT Web chỉ nhận nội dung khi bạn bắt đầu dịch.</span>
      </footer>
    </div>
  );
}
