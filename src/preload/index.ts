import { contextBridge, ipcRenderer } from "electron";
import type {
  ChapterExportResult,
  CombinedChapterExportResult,
  FinalChapterExportInput,
  StoryFetchResult,
  StorySourceAnalysis,
  StorySourceProgress,
  TranslationJobSnapshot,
} from "../shared/types.js";
import { IPC_CHANNELS } from "./channels.js";

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
  settings?: {
    maxChunkChars?: number;
    maxCharsPerSegment?: number;
    maxRetries?: number;
    timeoutMs?: number;
    responseTimeoutMs?: number;
  };
}

export interface StoryToolApi {
  getVersion(): Promise<string>;
  loadPrompts(): Promise<{ historical: string; modern: string }>;
  getDraft(): Promise<unknown | null>;
  saveDraft(draft: unknown): Promise<void>;
  clearDraft(): Promise<void>;
  connectChatGPT(): Promise<{ status: string; message?: string }>;
  getChatGPTStatus(): Promise<{ status: string; message?: string }>;
  disconnectChatGPT(): Promise<void>;
  cleanupToolChat(): Promise<void>;
  startTranslation(request: TranslationRequest): Promise<{ jobId: string }>;
  pauseTranslation(jobId: string): Promise<void>;
  resumeTranslation(jobId: string): Promise<void>;
  restartTranslation(jobId: string): Promise<{ jobId: string }>;
  cancelTranslation(jobId: string): Promise<void>;
  discardTranslation(jobId: string): Promise<void>;
  getTranslation(jobId: string): Promise<TranslationJobSnapshot>;
  retrySegment(request: { jobId: string; segmentId: string }): Promise<void>;
  getActiveTranslations(): Promise<TranslationJobSnapshot[]>;
  discoverTranslations(): Promise<TranslationJobSnapshot[]>;
  onTranslationEvent(callback: (event: TranslationEvent) => void): () => void;
  onChatGPTStatus(callback: (status: { status: string; message?: string }) => void): () => void;
  analyzeStoryUrl(url: string): Promise<StorySourceAnalysis>;
  openManualStoryVerification(url: string): Promise<void>;
  revealHuliBrowserHelper(): Promise<{ directory: string }>;
  fetchStoryChapters(request: { analysisId: string; chapterIds: string[] }): Promise<StoryFetchResult>;
  cancelStoryFetch(analysisId?: string): Promise<void>;
  onStorySourceProgress(callback: (progress: StorySourceProgress) => void): () => void;
  exportText(request: {
    content: string;
    defaultName?: string;
  }): Promise<{ canceled: boolean; filePath?: string }>;
  chooseChapterDirectory(): Promise<{ canceled: boolean; directory?: string }>;
  exportChapters(request: {
    directory: string;
    exportJobId: string;
    chapters: FinalChapterExportInput[];
  }): Promise<ChapterExportResult>;
  exportOriginalChapters(request: {
    directory: string;
    exportJobId: string;
    chapters: FinalChapterExportInput[];
  }): Promise<ChapterExportResult>;
  exportCombinedChapters(request: {
    directory: string;
    exportJobId: string;
    startChapter: number;
    endChapter: number;
    sourceChapterNumbers: number[];
    chapters: FinalChapterExportInput[];
  }): Promise<CombinedChapterExportResult>;
  getGeminiConfig(): Promise<{ hasApiKey: boolean; model: string }>;
  configureGemini(request: {
    apiKey?: string | null;
    model?: string;
  }): Promise<{ hasApiKey: boolean; model: string }>;
  generateTitles(request: {
    chapters: Array<{ id?: string; content: string }>;
    model?: string;
  }): Promise<{ titles: string[]; model: string }>;
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  if (typeof callback !== "function") throw new TypeError("Callback IPC không hợp lệ.");
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const storyTool: StoryToolApi = Object.freeze({
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion) as Promise<string>,
  loadPrompts: () =>
    ipcRenderer.invoke(IPC_CHANNELS.promptsLoadAll) as Promise<{ historical: string; modern: string }>,
  getDraft: () => ipcRenderer.invoke(IPC_CHANNELS.draftLoad) as Promise<unknown | null>,
  saveDraft: (draft: unknown) => ipcRenderer.invoke(IPC_CHANNELS.draftSave, draft) as Promise<void>,
  clearDraft: () => ipcRenderer.invoke(IPC_CHANNELS.draftClear) as Promise<void>,
  connectChatGPT: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGptConnect) as Promise<{ status: string; message?: string }>,
  getChatGPTStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGptStatus) as Promise<{ status: string; message?: string }>,
  disconnectChatGPT: () => ipcRenderer.invoke(IPC_CHANNELS.chatGptClose) as Promise<void>,
  cleanupToolChat: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chatGptCleanupToolChat) as Promise<void>,
  startTranslation: (request: TranslationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationStart, request) as Promise<{ jobId: string }>,
  pauseTranslation: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationPause, jobId) as Promise<void>,
  resumeTranslation: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationResume, jobId) as Promise<void>,
  restartTranslation: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationRestart, jobId) as Promise<{ jobId: string }>,
  cancelTranslation: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationCancel, jobId) as Promise<void>,
  discardTranslation: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationDiscard, jobId) as Promise<void>,
  getTranslation: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationGet, jobId) as Promise<TranslationJobSnapshot>,
  retrySegment: (request: { jobId: string; segmentId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.translationRetrySegment, request) as Promise<void>,
  getActiveTranslations: () =>
    ipcRenderer.invoke(IPC_CHANNELS.translationActive) as Promise<TranslationJobSnapshot[]>,
  discoverTranslations: () =>
    ipcRenderer.invoke(IPC_CHANNELS.translationDiscover) as Promise<TranslationJobSnapshot[]>,
  onTranslationEvent: (callback: (event: TranslationEvent) => void) =>
    subscribe(IPC_CHANNELS.translationEvent, callback),
  onChatGPTStatus: (callback: (status: { status: string; message?: string }) => void) =>
    subscribe(IPC_CHANNELS.chatGptStatusEvent, callback),
  analyzeStoryUrl: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.storyAnalyze, { url }) as Promise<StorySourceAnalysis>,
  openManualStoryVerification: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.storyManualVerification, { url }) as Promise<void>,
  revealHuliBrowserHelper: () =>
    ipcRenderer.invoke(IPC_CHANNELS.storyRevealBrowserHelper) as Promise<{ directory: string }>,
  fetchStoryChapters: (request: { analysisId: string; chapterIds: string[] }) =>
    ipcRenderer.invoke(IPC_CHANNELS.storyFetch, request) as Promise<StoryFetchResult>,
  cancelStoryFetch: (analysisId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.storyCancel, { analysisId }) as Promise<void>,
  onStorySourceProgress: (callback: (progress: StorySourceProgress) => void) =>
    subscribe(IPC_CHANNELS.storyProgressEvent, callback),
  exportText: (request: { content: string; defaultName?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportText, request) as Promise<{
      canceled: boolean;
      filePath?: string;
    }>,
  chooseChapterDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportChooseDirectory) as Promise<{
      canceled: boolean;
      directory?: string;
    }>,
  exportChapters: (request: { directory: string; exportJobId: string; chapters: FinalChapterExportInput[] }) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportChapters, request) as Promise<ChapterExportResult>,
  exportOriginalChapters: (request: { directory: string; exportJobId: string; chapters: FinalChapterExportInput[] }) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportOriginalChapters, request) as Promise<ChapterExportResult>,
  exportCombinedChapters: (request: {
    directory: string;
    exportJobId: string;
    startChapter: number;
    endChapter: number;
    sourceChapterNumbers: number[];
    chapters: FinalChapterExportInput[];
  }) => ipcRenderer.invoke(IPC_CHANNELS.exportCombinedChapters, request) as Promise<CombinedChapterExportResult>,
  getGeminiConfig: () =>
    ipcRenderer.invoke(IPC_CHANNELS.geminiGetConfig) as Promise<{ hasApiKey: boolean; model: string }>,
  configureGemini: (request: { apiKey?: string | null; model?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.geminiSetConfig, request) as Promise<{
      hasApiKey: boolean;
      model: string;
    }>,
  generateTitles: (request: {
    chapters: Array<{ id?: string; content: string }>;
    model?: string;
  }) =>
    ipcRenderer.invoke(IPC_CHANNELS.geminiGenerateTitles, request) as Promise<{
      titles: string[];
      model: string;
    }>,
});

contextBridge.exposeInMainWorld("storyTool", storyTool);
