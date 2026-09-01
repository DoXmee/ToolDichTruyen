import type {
  ChapterExportResult,
  CombinedChapterExportResult,
  FinalChapterExportInput,
  StoryFetchResult,
  StoryExportIdentity,
  StorySourceAnalysis,
  StorySourceProgress,
  TranslationJobSnapshot,
  TranslationAutoExportBinding,
  AiProvider,
} from '../shared';

export interface TranslationEvent {
  jobId: string;
  type: string;
  timestamp: number;
  payload?: unknown;
}

export interface TranslationRequest {
  source: string;
  promptMode: string;
  customPrompt?: string;
  aiProvider?: AiProvider;
  allowedAiProviders?: AiProvider[];
  autoExport?: TranslationAutoExportBinding;
  settings?: {
    maxChunkChars?: number;
    maxCharsPerSegment?: number;
    maxRetries?: number;
    timeoutMs?: number;
    responseTimeoutMs?: number;
  };
}

export interface StoryToolApi {
  setWindowTheme?(theme: 'light' | 'dark'): Promise<void>;
  minimizeWindow?(): Promise<void>;
  toggleMaximizeWindow?(): Promise<void>;
  closeWindow?(): Promise<void>;
  loadPrompts(): Promise<{ period: string; modern: string; ancient: string; cultivation: string }>;
  getDraft(): Promise<unknown | null>;
  saveDraft(draft: unknown): Promise<void>;
  connectChatGPT(): Promise<{ status: string; message?: string }>;
  getAiProvider?(): Promise<AiProvider>;
  setAiProvider?(provider: AiProvider): Promise<{ provider: AiProvider; status: string; message?: string }>;
  connectAi?(): Promise<{ provider: AiProvider; status: string; message?: string }>;
  getAiStatus?(): Promise<{ provider: AiProvider; status: string; message?: string }>;
  disconnectAi?(): Promise<void>;
  getChatGPTStatus?(): Promise<{ status: string; message?: string }>;
  cleanupToolChat?(): Promise<void>;
  onChatGPTStatus?(callback: (status: { status: string; message?: string }) => void): () => void;
  onAiStatus?(callback: (status: { provider: AiProvider; status: string; message?: string }) => void): () => void;
  analyzeStoryUrl(url: string): Promise<StorySourceAnalysis>;
  /**
   * Starts a local helper pairing flow in the user's default browser. The
   * promise resolves only after the companion extension has paired.
   */
  openManualStoryVerification?(url: string): Promise<void>;
  revealHuliBrowserHelper?(): Promise<{ directory: string }>;
  fetchStoryChapters(request: { analysisId: string; chapterIds: string[] }): Promise<StoryFetchResult>;
  cancelStoryFetch(analysisId?: string): Promise<void>;
  onStorySourceProgress(callback: (progress: StorySourceProgress) => void): () => void;
  startTranslation(request: TranslationRequest): Promise<{ jobId: string }>;
  pauseTranslation(jobId: string): Promise<void>;
  resumeTranslation(jobId: string, aiProvider?: AiProvider): Promise<void>;
  restartTranslation(jobId: string): Promise<{ jobId: string }>;
  cancelTranslation(jobId: string): Promise<void>;
  discardTranslation(jobId: string): Promise<void>;
  getTranslation(jobId: string): Promise<TranslationJobSnapshot>;
  getActiveTranslations(): Promise<TranslationJobSnapshot[]>;
  discoverTranslations(): Promise<TranslationJobSnapshot[]>;
  retrySegment(request: { jobId: string; segmentId: string; aiProvider?: AiProvider }): Promise<void>;
  onTranslationEvent(callback: (event: TranslationEvent) => void): () => void;
  exportText(request: { content: string; defaultName?: string }): Promise<{ canceled: boolean; filePath?: string }>;
  chooseChapterDirectory(): Promise<{ canceled: boolean; directory?: string }>;
  validateChapterDirectory(directory: string, identity?: StoryExportIdentity): Promise<{ directory: string }>;
  exportChapters(request: {
    directory: string;
    exportJobId: string;
    chapters: FinalChapterExportInput[];
    recoveryOnConflict?: boolean;
  }): Promise<ChapterExportResult>;
  exportOriginalChapters(request: {
    directory: string;
    exportJobId: string;
    chapters: FinalChapterExportInput[];
    recoveryOnConflict?: boolean;
  }): Promise<ChapterExportResult>;
  exportCombinedChapters(request: {
    directory: string;
    exportJobId: string;
    startChapter: number;
    endChapter: number;
    sourceChapterNumbers: number[];
    chapters: FinalChapterExportInput[];
    recoveryOnConflict?: boolean;
  }): Promise<CombinedChapterExportResult>;
  exportCombinedSourceChapters(request: {
    directory: string;
    exportJobId: string;
    sourceStartChapter: number;
    sourceEndChapter: number;
    outputStartChapter: number;
    outputEndChapter: number;
    splitOutputStartChapter?: number;
    splitOutputEndChapter?: number;
    chapters: FinalChapterExportInput[];
    recoveryOnConflict?: boolean;
  }): Promise<CombinedChapterExportResult>;
  generateTitles(request: {
    chapters: Array<{ id?: string; content: string }>;
    model?: string;
  }): Promise<{ titles: string[]; model: string }>;
  getGeminiConfig?(): Promise<{ hasApiKey: boolean; model: string }>;
  configureGemini?(request: {
    apiKey?: string | null;
    model?: string;
  }): Promise<{ hasApiKey: boolean; model: string }>;
}

export function getStoryTool(): StoryToolApi {
  const api = (window as unknown as { storyTool?: StoryToolApi }).storyTool;
  if (!api) {
    throw new Error('Không tìm thấy cầu nối desktop. Hãy mở ứng dụng bằng Electron.');
  }
  return api;
}

export function hasStoryTool(): boolean {
  return Boolean((window as unknown as { storyTool?: StoryToolApi }).storyTool);
}
