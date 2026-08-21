export type InputLanguage = 'vi' | 'en' | 'zh' | 'ja' | 'ko';

export interface TextRange {
  /** Zero-based UTF-16 offset, matching String.prototype.slice. */
  start: number;
  /** Exclusive, zero-based UTF-16 offset. */
  end: number;
}

export type UnicodeScript =
  | 'latin'
  | 'han'
  | 'hiragana'
  | 'katakana'
  | 'hangul'
  | 'number'
  | 'other';

export interface TextToken extends TextRange {
  text: string;
  isWord: boolean;
  isMismatched: boolean;
  script?: UnicodeScript;
}

export interface HanCharacterLocation extends TextRange {
  character: string;
  /** One-based line number in normalizedText. */
  line: number;
  /** One-based Unicode-code-point column in normalizedText. */
  column: number;
}

export interface LanguageAnalysis {
  /** NFC-normalized input used by tokens and offsets. */
  normalizedText: string;
  totalWords: number;
  mismatchedCount: number;
  tokens: TextToken[];
  hanCharacters: HanCharacterLocation[];
  hanCount: number;
}

/** Compatibility name used by the original Google Studio source. */
export type AnalysisResult = LanguageAnalysis;

export interface LanguageOption {
  id: InputLanguage;
  name: string;
  flag: string;
}

export type ChapterHeaderKeyword =
  | 'chương'
  | 'chapter'
  | 'hồi'
  | 'tập'
  | 'bài'
  | 'phần';

export interface DetectedHeader {
  isHeader: true;
  chapterNumber: number;
  rawChapterNumber: string;
  keyword: ChapterHeaderKeyword;
  extractedTitle: string;
  separator: string;
  originalLine: string;
  normalizedLine: string;
}

export interface ParagraphBlock extends TextRange {
  index: number;
  /** Original line content, without its line ending. */
  text: string;
  /** Exact whitespace/newline text immediately before this paragraph. */
  separatorBefore: string;
  /** Exact whitespace/newline text immediately after this paragraph. */
  separatorAfter: string;
  wordCount: number;
  header?: DetectedHeader;
}

export interface ChapterSourceMetadata extends TextRange {
  ordinal: number;
  leadingSeparator: string;
  trailingSeparator: string;
  /**
   * Website/source chapter that owns this output slice. It is repeated on
   * every slice so a long source chapter can keep its provenance after the
   * 750--800-word splitter assigns new output numbers.
   */
  sourceChapterNumber?: number;
  header?: DetectedHeader;
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  content: string;
  wordCount: number;
  paragraphs?: ParagraphBlock[];
  source?: ChapterSourceMetadata;
}

export interface SplitConfig {
  targetWords: number;
  prefix: string;
  suffix: string;
  startIndex: number;
  inputLanguage: InputLanguage;
  autoDetectTitle: boolean;
  useAI?: boolean;
}

export type PromptMode = 'period' | 'modern' | 'ancient' | 'cultivation' | 'custom';

export interface PromptCatalog {
  period: string;
  modern: string;
  ancient: string;
  cultivation: string;
}

export interface PromptSelection {
  mode: PromptMode;
  customPrompt?: string;
}

export type TranslationJobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TranslationSegmentStatus =
  | 'queued'
  | 'sending'
  | 'streaming'
  | 'validating'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TranslationStatus = TranslationJobStatus | TranslationSegmentStatus;

export type TranslationValidationIssueCode =
  | 'empty'
  | 'han_remaining'
  | 'too_short'
  | 'likely_truncated'
  | 'source_echo'
  | 'assistant_preamble'
  | 'repetition'
  | 'ownership_marker_leak'
  | 'chapter_structure'
  | 'error_response';

export type ValidationSeverity = 'warning' | 'error';

export interface TranslationValidationIssue {
  code: TranslationValidationIssueCode;
  severity: ValidationSeverity;
  message: string;
  range?: TextRange;
  sample?: string;
}

export interface TranslationValidationMetrics {
  sourceCharacters: number;
  translatedCharacters: number;
  sourceHanCharacters: number;
  remainingHanCharacters: number;
  lengthRatio: number;
}

export interface TranslationValidationResult {
  valid: boolean;
  issues: TranslationValidationIssue[];
  hanCharacters: HanCharacterLocation[];
  metrics: TranslationValidationMetrics;
}

/** Short compatibility name for consumers that do not need the prefix. */
export type ValidationResult = TranslationValidationResult;

export interface TranslationSegment extends TextRange {
  id: string;
  index: number;
  sourceText: string;
  translatedText: string;
  status: TranslationSegmentStatus;
  attempts: number;
  validation?: TranslationValidationResult;
  error?: string;
}

/**
 * Immutable destination settings for a link-import translation. Keeping this
 * on the runner checkpoint lets a paused/cancelled job resume file output
 * after the renderer or the application has been restarted.
 */
export interface TranslationAutoExportBinding {
  directory: string;
  startChapter: number;
  endChapter: number;
  sourceChapterNumbers: number[];
  exportOriginalChapters: boolean;
  exportCombinedChapters: boolean;
  /** Create one compilation from the immutable, untranslated source chapters. */
  exportCombinedSourceChapters?: boolean;
  outputChapterStart?: number;
  omitOutputChapterTitles: boolean;
}

export interface TranslationJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TranslationJobStatus;
  promptMode: PromptMode;
  customPrompt?: string;
  resolvedPrompt: string;
  sourceText: string;
  translatedText: string;
  segments: TranslationSegment[];
  currentSegmentIndex?: number;
  error?: string;
  autoExport?: TranslationAutoExportBinding;
  /** Bounded, human-readable execution history stored with the checkpoint. */
  activityLog?: TranslationActivityEntry[];
}

export type TranslationActivityTone = 'info' | 'warning' | 'error' | 'success';

export interface TranslationActivityEntry {
  at: string;
  tone: TranslationActivityTone;
  message: string;
  segmentId?: string;
  segmentIndex?: number;
}

export interface TranslationSegmentSnapshot {
  id: string;
  index: number;
  status: TranslationSegmentStatus;
  error?: string;
}

/** Lightweight IPC view used to reconcile renderer progress without cloning the source text. */
export interface TranslationJobSnapshot {
  id: string;
  createdAt?: string;
  updatedAt: string;
  status: TranslationJobStatus;
  totalSegments: number;
  completedSegments: number;
  segments: TranslationSegmentSnapshot[];
  currentSegmentIndex?: number;
  error?: string;
  activityLog?: TranslationActivityEntry[];
  /**
   * Present when a caller explicitly asks for one job. It lets the renderer
   * restore completed checkpoints after a reload without making lightweight
   * active-job polling copy the entire translation on every interval.
   */
  translatedText?: string;
  /** Included only by an explicit full-job lookup for durable source exports. */
  sourceText?: string;
  autoExport?: TranslationAutoExportBinding;
}

export interface SourceChunk extends TextRange {
  id: string;
  index: number;
  text: string;
}

export interface SourceChunkOptions {
  maxChars: number;
  /** Avoids very small chunks when a reasonable boundary exists. Defaults to 35%. */
  minimumFillRatio?: number;
}

export interface TranslationValidationOptions {
  requireNoHan?: boolean;
  minimumSourceLengthForRatioCheck?: number;
  minimumLengthRatio?: number;
  checkPreamble?: boolean;
  checkTruncation?: boolean;
  checkRepetition?: boolean;
}

export interface TranslationPromptInput {
  basePrompt: string;
  sourceText: string;
  segmentIndex: number;
  totalSegments: number;
  segmentId?: string;
  glossary?: string;
}

export interface RetryPromptInput extends TranslationPromptInput {
  previousTranslation: string;
  validation: TranslationValidationResult;
  attempt: number;
}

export interface TranslationSettings {
  maxCharsPerSegment: number;
  maxRetries: number;
  responseTimeoutMs: number;
  validation: TranslationValidationOptions;
}

export interface ChatGptSettings {
  profileDirectoryName: string;
  baseUrl: string;
  headless: boolean;
}

export interface GeminiSettings {
  enabled: boolean;
  model: string;
  excerptCharacters: number;
}

export interface AppSettings {
  version: number;
  promptMode: PromptMode;
  customPrompt: string;
  splitter: SplitConfig;
  translation: TranslationSettings;
  chatgpt: ChatGptSettings;
  gemini: GeminiSettings;
  autosave: boolean;
}

export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

export type IpcResult<T, E = IpcError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export type StorySite = 'huliwang' | 'timotxt' | 'qingrenyouxi' | 'xbanxia' | 'xszj';

export type StoryUrlKind = 'book' | 'catalog' | 'chapter';

export type StoryVerificationState = 'not-needed' | 'waiting' | 'user-action-required';

export interface StoryChapterReference {
  /** Stable, site-scoped identity. Never derived from a translated title. */
  id: string;
  /** Zero-based reading order from the site's canonical catalog. */
  order: number;
  /** Parsed display chapter number when the site exposes a trustworthy one. */
  number?: number;
  numberLabel: string;
  title: string;
  url: string;
  /** Consecutive continuation entries that form the same logical chapter. */
  partUrls: string[];
  isIntroduction: boolean;
  selectedByDefault: boolean;
}

export interface StorySourceAnalysis {
  analysisId: string;
  site: StorySite;
  inputKind: StoryUrlKind;
  inputUrl: string;
  bookId: string;
  bookTitle: string;
  author?: string;
  bookUrl: string;
  catalogUrl: string;
  chapters: StoryChapterReference[];
  defaultSelectedChapterIds: string[];
  verification: StoryVerificationState;
  notices: string[];
}

export interface StoryChapterContent {
  id: string;
  order: number;
  number?: number;
  title: string;
  sourceText: string;
  sourceUrls: string[];
  mergedPartCount: number;
  characterCount: number;
  warnings: string[];
}

export interface StoryFetchResult {
  analysisId: string;
  site: StorySite;
  bookId: string;
  bookTitle: string;
  chapters: StoryChapterContent[];
  combinedSource: string;
  warnings: string[];
}

export interface StorySourceProgress {
  analysisId?: string;
  phase: 'opening' | 'verification' | 'catalog' | 'fetching' | 'validating' | 'completed' | 'cancelled' | 'failed';
  completed: number;
  total: number;
  chapterId?: string;
  message: string;
}

export interface FinalChapterExportInput {
  /** Display number written in the TXT heading and the output filename. */
  index: number;
  /**
   * Original website chapter number, retained only for an explicitly
   * renumbered export. The file name then receives a `c.gốc N` prefix while
   * the document heading still uses `index`.
   */
  sourceChapterNumber?: number;
  title: string;
  content: string;
  wordCount: number;
}

export interface ChapterExportRecord {
  /** Translation job that produced this checkpoint. */
  exportJobId: string;
  /** User-selected root directory, resolved by the main process. */
  exportDirectory: string;
  /** SHA-256 of the exact chapter input, not of its filename. */
  contentHash: string;
  index: number;
  sourceChapterNumber?: number;
  title: string;
  fileName: string;
  filePath: string;
  wordCount: number;
  status: 'saved' | 'skipped-existing';
}

export interface ChapterExportResult {
  directory: string;
  records: ChapterExportRecord[];
}

/**
 * Request/result contract for the one final TXT containing every *split*
 * chapter in a user-selected source range. `startChapter`/`endChapter` name
 * the visible output sequence; with legacy numbering they equal the original
 * website range, while a user may remap them. Provenance remains separately
 * available through `sourceChapterNumbers`.
 */
export interface CombinedChapterExportInput {
  directory: string;
  /** Translation job that owns this compilation checkpoint. */
  exportJobId: string;
  startChapter: number;
  endChapter: number;
  /** A contiguous original website source range; it can be shorter than the output range after splitting. */
  sourceChapterNumbers: number[];
  chapters: FinalChapterExportInput[];
  /** Link-job recovery may publish a complete replacement set in a clean
   * child directory when an older aggregate has the same name but differs. */
  recoveryOnConflict?: boolean;
}

export interface CombinedChapterExportResult {
  directory: string;
  /** User-selected root directory, resolved by the main process. */
  exportDirectory: string;
  /** Translation job that produced this compilation. */
  exportJobId: string;
  /** SHA-256 of the ordered final split chapter inputs. */
  contentHash: string;
  fileName: string;
  filePath: string;
  startChapter: number;
  endChapter: number;
  chapterCount: number;
  status: 'saved' | 'skipped-existing';
}
