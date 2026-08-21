import { nativeTheme, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron";
import { access } from "node:fs/promises";
import path from "node:path";
import type { FinalChapterExportInput, PromptMode } from "../shared/types.js";
import { IPC_CHANNELS } from "../preload/channels.js";
import {
  chooseChapterDirectory,
  validateChapterExportDirectory,
  exportChapterFiles,
  exportCombinedChapterFile,
  exportCombinedSourceChapterFile,
  exportOriginalChapterFiles,
} from "./chapterExport.js";
import type { ChatGptWebAdapter } from "./chatgpt/ChatGptWebAdapter.js";
import { exportTextFile } from "./exportText.js";
import type { GeminiTitleService } from "./gemini/GeminiTitleService.js";
import type { PersistenceService } from "./persistence/PersistenceService.js";
import { normalizePromptMode, type PromptLoader } from "./prompts.js";
import type { StorySourceServiceApi } from "./storySources/index.js";
import type { TranslationJobRunner } from "./translation/TranslationJobRunner.js";

export interface IpcDependencies {
  ipcMain: IpcMain;
  dialog: Electron.Dialog;
  appVersion: () => string;
  mainWindow: () => BrowserWindow | undefined;
  devServerUrl?: string;
  prompts: PromptLoader;
  persistence: PersistenceService;
  chatGpt: ChatGptWebAdapter;
  translator: TranslationJobRunner;
  storySources: StorySourceServiceApi;
  gemini: GeminiTitleService;
  /** Test seam; production falls back to Electron's shell implementation. */
  showItemInFolder?: (fullPath: string) => void;
  /**
   * Test seam for absolute unpacked Huli Browser Helper directories.
   * Production finds the helper beside ToolDichTruyen.exe first.
   */
  browserHelperDirectories?: () => string[];
}

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => unknown | Promise<unknown>;

function objectPayload(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} không hợp lệ.`);
  }
  return value as Record<string, unknown>;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number } = {},
): string | undefined {
  const field = value[key];
  if (field === undefined && !options.required) return undefined;
  if (typeof field !== "string" || (options.required && field.trim().length === 0)) {
    throw new TypeError(`Trường ${key} không hợp lệ.`);
  }
  if (field.length > (options.max ?? 20_000_000)) throw new RangeError(`Trường ${key} quá dài.`);
  return field;
}

function chapterExportInputs(payload: Record<string, unknown>): FinalChapterExportInput[] {
  if (!Array.isArray(payload.chapters) || payload.chapters.length < 1 || payload.chapters.length > 10_000) {
    throw new RangeError("Danh sách xuất phải có từ 1 đến 10.000 chương.");
  }
  return payload.chapters.map((rawChapter, index): FinalChapterExportInput => {
    const chapter = objectPayload(rawChapter, `Chương xuất ${index + 1}`);
    const chapterIndex = chapter.index;
    const wordCount = chapter.wordCount;
    if (typeof chapterIndex !== "number" || !Number.isSafeInteger(chapterIndex)) {
      throw new TypeError(`Số thứ tự chương ${index + 1} không hợp lệ.`);
    }
    if (typeof wordCount !== "number" || !Number.isSafeInteger(wordCount)) {
      throw new TypeError(`Số chữ của chương ${index + 1} không hợp lệ.`);
    }
    const sourceChapterNumber = chapter.sourceChapterNumber;
    if (
      sourceChapterNumber !== undefined
      && (typeof sourceChapterNumber !== 'number'
        || !Number.isSafeInteger(sourceChapterNumber)
        || sourceChapterNumber < 1
        || sourceChapterNumber > 999_999)
    ) {
      throw new TypeError(`Số chương gốc ${index + 1} không hợp lệ.`);
    }
    return {
      index: chapterIndex,
      ...(sourceChapterNumber === undefined ? {} : { sourceChapterNumber }),
      title: stringField(chapter, "title", { required: true, max: 500 })!,
      content: stringField(chapter, "content", { required: true, max: 128 * 1024 * 1024 })!,
      wordCount,
    };
  });
}

function boundedPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 999_999) {
    throw new TypeError(`Trường ${name} không hợp lệ.`);
  }
  return value;
}

function promptMode(value: unknown): PromptMode {
  return normalizePromptMode(value);
}

function assertPayloadSize(payload: unknown, maximumBytes = 128 * 1024 * 1024): void {
  if (payload === undefined) return;
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    throw new TypeError("Dữ liệu IPC không thể tuần tự hóa.", { cause: error });
  }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new RangeError("Dữ liệu IPC vượt quá giới hạn cho phép.");
  }
}

function senderAllowed(event: IpcMainInvokeEvent, devServerUrl?: string): boolean {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (senderUrl.startsWith("file://")) return true;
  if (!devServerUrl) return false;
  try {
    return new URL(senderUrl).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

async function revealHuliBrowserHelper(dependencies: IpcDependencies): Promise<{ directory: string }> {
  const electronResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const directories = dependencies.browserHelperDirectories?.() ?? [
    // electron-builder's extraFiles target: <application root>/Huli Browser Helper.
    ...(electronResourcesPath ? [path.join(path.dirname(electronResourcesPath), "Huli Browser Helper")] : []),
    // Kept only so existing installations can use this UI before they are updated.
    ...(electronResourcesPath ? [path.join(electronResourcesPath, "resources", "huli-browser-helper")] : []),
    path.join(process.cwd(), "Huli Browser Helper"),
    path.join(process.cwd(), "resources", "huli-browser-helper"),
  ];
  let manifestPath: string | undefined;
  for (const directory of directories) {
    const candidate = path.resolve(directory, "manifest.json");
    try {
      await access(candidate);
      manifestPath = candidate;
      break;
    } catch {
      // Try the next packaged/development resource root.
    }
  }
  if (!manifestPath) {
    throw new Error(
      "Không tìm thấy tiện ích Huliwang đi kèm tool. Hãy cài lại hoặc cập nhật bản đầy đủ rồi thử lại.",
    );
  }

  let showItemInFolder = dependencies.showItemInFolder;
  if (!showItemInFolder) {
    const electron = await import("electron");
    showItemInFolder = electron.shell?.showItemInFolder;
  }
  if (!showItemInFolder) {
    throw new Error("Không thể mở thư mục tiện ích Huliwang trên máy này.");
  }
  showItemInFolder(manifestPath);
  return { directory: path.dirname(manifestPath) };
}

export function registerIpcHandlers(dependencies: IpcDependencies): () => void {
  const registered: string[] = [];
  const handle = (channel: string, handler: Handler): void => {
    dependencies.ipcMain.removeHandler(channel);
    dependencies.ipcMain.handle(channel, async (event, payload) => {
      const window = dependencies.mainWindow();
      if (
        !window ||
        window.isDestroyed() ||
        event.sender.id !== window.webContents.id ||
        !senderAllowed(event, dependencies.devServerUrl)
      ) {
        throw new Error("Nguồn IPC không được phép.");
      }
      assertPayloadSize(payload);
      return handler(event, payload);
    });
    registered.push(channel);
  };

  const broadcast = (channel: string, payload: unknown): void => {
    const window = dependencies.mainWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  handle(IPC_CHANNELS.appVersion, () => dependencies.appVersion());
  handle(IPC_CHANNELS.windowSetTheme, (_event, payload) => {
    if (payload !== 'light' && payload !== 'dark') throw new TypeError('Giao diện không hợp lệ.');
    // Keep the native non-client area (resize edge/shadow) in the same theme as
    // the renderer. Without this, Windows can leave a bright one-pixel border
    // around a frameless dark window even though every HTML surface is dark.
    nativeTheme.themeSource = payload;
    const window = dependencies.mainWindow();
    if (!window || window.isDestroyed()) return;
    window.setBackgroundColor(payload === 'dark' ? '#181818' : '#f4f1ea');
  });
  handle(IPC_CHANNELS.windowMinimize, () => {
    const window = dependencies.mainWindow();
    if (window && !window.isDestroyed()) window.minimize();
  });
  handle(IPC_CHANNELS.windowToggleMaximize, () => {
    const window = dependencies.mainWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
  });
  handle(IPC_CHANNELS.windowClose, () => {
    const window = dependencies.mainWindow();
    if (window && !window.isDestroyed()) window.close();
  });
  handle(IPC_CHANNELS.promptsLoadAll, async () => dependencies.prompts.loadCatalog());
  handle(IPC_CHANNELS.draftLoad, () => dependencies.persistence.loadDraft());
  handle(IPC_CHANNELS.draftSave, async (_event, payload) => {
    await dependencies.persistence.saveDraft(payload ?? null);
  });
  handle(IPC_CHANNELS.draftClear, async () => dependencies.persistence.clearDraft());

  handle(IPC_CHANNELS.chatGptConnect, () => dependencies.chatGpt.openLogin());
  handle(IPC_CHANNELS.chatGptStatus, () => dependencies.chatGpt.refreshStatus());
  handle(IPC_CHANNELS.chatGptClose, async () => dependencies.chatGpt.close());
  // This can only delete the exact state-v3 conversation whose ownership
  // marker is verified by ChatGptWebAdapter. It is used by authenticated smoke
  // tests before their disposable browser profile is removed.
  handle(IPC_CHANNELS.chatGptCleanupToolChat, async () => {
    await dependencies.chatGpt.startNewConversation();
  });

  handle(IPC_CHANNELS.translationStart, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu dịch");
    const source = stringField(payload, "source", { required: true })!;
    const mode = promptMode(payload.promptMode);
    const customPrompt = stringField(payload, "customPrompt", { max: 100_000 });
    const resolvedPrompt = await dependencies.prompts.resolve(mode, customPrompt);
    const rawSettings = payload.settings;
    if (rawSettings !== undefined && (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings))) {
      throw new TypeError("Cài đặt dịch không hợp lệ.");
    }
    const settingsObject = (rawSettings ?? {}) as Record<string, unknown>;
    const numberSetting = (name: string): number | undefined => {
      const candidate = settingsObject[name];
      if (candidate === undefined) return undefined;
      if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
        throw new TypeError(`Cài đặt ${name} không hợp lệ.`);
      }
      return candidate;
    };
    const rawAutoExport = payload.autoExport;
    let autoExport: {
      directory: string;
      startChapter: number;
      endChapter: number;
      sourceChapterNumbers: number[];
      exportOriginalChapters: boolean;
      exportCombinedChapters: boolean;
      outputChapterStart?: number;
      omitOutputChapterTitles: boolean;
    } | undefined;
    if (rawAutoExport !== undefined) {
      const binding = objectPayload(rawAutoExport, "Cấu hình lưu tự động");
      const directory = stringField(binding, "directory", { required: true, max: 32_000 })!;
      const integer = (name: string, required = true): number | undefined => {
        const value = binding[name];
        if (value === undefined && !required) return undefined;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
          throw new TypeError(`Cấu hình lưu tự động ${name} không hợp lệ.`);
        }
        return value;
      };
      const startChapter = integer("startChapter")!;
      const endChapter = integer("endChapter")!;
      const sourceChapterNumbers = binding.sourceChapterNumbers;
      if (!Array.isArray(sourceChapterNumbers)
        || sourceChapterNumbers.length === 0
        || sourceChapterNumbers.some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) {
        throw new TypeError("Cấu hình lưu tự động sourceChapterNumbers không hợp lệ.");
      }
      if (endChapter < startChapter || typeof binding.exportOriginalChapters !== "boolean"
        || typeof binding.exportCombinedChapters !== "boolean"
        || (binding.exportCombinedSourceChapters !== undefined && typeof binding.exportCombinedSourceChapters !== "boolean")
        || typeof binding.omitOutputChapterTitles !== "boolean") {
        throw new TypeError("Cấu hình lưu tự động không hợp lệ.");
      }
      autoExport = {
        directory,
        startChapter,
        endChapter,
        sourceChapterNumbers: [...sourceChapterNumbers],
        exportOriginalChapters: binding.exportOriginalChapters,
        exportCombinedChapters: binding.exportCombinedChapters,
        ...(binding.exportCombinedSourceChapters === true ? { exportCombinedSourceChapters: true } : {}),
        ...(integer("outputChapterStart", false) !== undefined
          ? { outputChapterStart: integer("outputChapterStart", false) }
          : {}),
        omitOutputChapterTitles: binding.omitOutputChapterTitles,
      };
    }
    return dependencies.translator.start({
      source,
      promptMode: mode,
      ...(customPrompt ? { customPrompt } : {}),
      resolvedPrompt,
      ...(autoExport ? { autoExport } : {}),
      settings: {
        maxChunkChars: numberSetting("maxChunkChars"),
        maxCharsPerSegment: numberSetting("maxCharsPerSegment"),
        maxRetries: numberSetting("maxRetries"),
        timeoutMs: numberSetting("timeoutMs"),
        responseTimeoutMs: numberSetting("responseTimeoutMs"),
      },
    });
  });

  const idPayload = (rawPayload: unknown): string => {
    if (typeof rawPayload === "string") return rawPayload;
    const payload = objectPayload(rawPayload, "Tác vụ");
    return stringField(payload, "jobId", { required: true, max: 100 })!;
  };
  handle(IPC_CHANNELS.translationPause, (_event, payload) => dependencies.translator.pause(idPayload(payload)));
  handle(IPC_CHANNELS.translationResume, (_event, payload) => dependencies.translator.resume(idPayload(payload)));
  handle(IPC_CHANNELS.translationRestart, (_event, payload) => dependencies.translator.restart(idPayload(payload)));
  handle(IPC_CHANNELS.translationCancel, (_event, payload) => dependencies.translator.cancel(idPayload(payload)));
  handle(IPC_CHANNELS.translationDiscard, (_event, payload) => dependencies.translator.discard(idPayload(payload)));
  handle(IPC_CHANNELS.translationGet, (_event, payload) => dependencies.translator.get(idPayload(payload)));
  handle(IPC_CHANNELS.translationRetrySegment, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu thử lại");
    await dependencies.translator.retrySegment({
      jobId: stringField(payload, "jobId", { required: true, max: 100 })!,
      segmentId: stringField(payload, "segmentId", { required: true, max: 100 })!,
    });
  });
  handle(IPC_CHANNELS.translationActive, () => dependencies.translator.activeJobs());
  handle(IPC_CHANNELS.translationDiscover, () => dependencies.translator.discoverJobs());

  handle(IPC_CHANNELS.storyAnalyze, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu phân tích link truyện");
    const url = stringField(payload, "url", { required: true, max: 2_048 })!;
    return dependencies.storySources.analyzeUrl(url.trim());
  });
  handle(IPC_CHANNELS.storyManualVerification, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu xác minh link truyện");
    const url = stringField(payload, "url", { required: true, max: 2_048 })!;
    if (dependencies.chatGpt.status().status === "busy") {
      throw new Error("ChatGPT đang dịch; hãy chờ hoặc tạm dừng trước khi kết nối trình duyệt Huliwang.");
    }
    // Windows may route an ordinary URL into an already-running Edge root.
    // Close the tool-owned ChatGPT automation context first so the direct
    // HTTPS UserChoice launcher reaches the user's genuine default profile
    // where the helper is installed.
    // Conversation ownership metadata stays intact and ChatGPT can reconnect
    // after the Huliwang source has been imported.
    await dependencies.chatGpt.close({ strict: true });
    await dependencies.storySources.openManualVerification(url.trim());
  });
  handle(IPC_CHANNELS.storyRevealBrowserHelper, () => revealHuliBrowserHelper(dependencies));
  handle(IPC_CHANNELS.storyFetch, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu tải chương");
    const analysisId = stringField(payload, "analysisId", { required: true, max: 100 })!;
    if (!Array.isArray(payload.chapterIds) || payload.chapterIds.length < 1 || payload.chapterIds.length > 10_000) {
      throw new RangeError("Danh sách chương phải có từ 1 đến 10.000 mục.");
    }
    const chapterIds = payload.chapterIds.map((candidate, index) => {
      if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 300) {
        throw new TypeError(`ID chương ${index + 1} không hợp lệ.`);
      }
      return candidate;
    });
    if (new Set(chapterIds).size !== chapterIds.length) {
      throw new TypeError("Danh sách chương có ID bị trùng.");
    }
    return dependencies.storySources.fetchChapters({ analysisId, chapterIds });
  });
  handle(IPC_CHANNELS.storyCancel, async (_event, rawPayload) => {
    const payload = rawPayload === undefined
      ? {}
      : objectPayload(rawPayload, "Yêu cầu hủy tải truyện");
    const analysisId = stringField(payload, "analysisId", { max: 100 });
    await dependencies.storySources.cancel(analysisId?.trim() || undefined);
  });

  handle(IPC_CHANNELS.exportText, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu xuất file");
    const content = stringField(payload, "content", { required: true, max: 128 * 1024 * 1024 })!;
    const defaultName = stringField(payload, "defaultName", { max: 300 });
    return exportTextFile(dependencies.dialog, dependencies.mainWindow(), {
      content,
      ...(defaultName ? { defaultName } : {}),
    });
  });
  handle(IPC_CHANNELS.exportChooseDirectory, () =>
    chooseChapterDirectory(dependencies.dialog, dependencies.mainWindow()),
  );
  handle(IPC_CHANNELS.exportValidateDirectory, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, 'Yêu cầu kiểm tra thư mục xuất');
    const directory = stringField(payload, 'directory', { required: true, max: 32_767 })!;
    return validateChapterExportDirectory(directory);
  });
  handle(IPC_CHANNELS.exportChapters, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu lưu các chương");
    const directory = stringField(payload, "directory", { required: true, max: 32_767 })!;
    const exportJobId = stringField(payload, "exportJobId", { required: true, max: 200 })!;
    const chapters = chapterExportInputs(payload);
    return exportChapterFiles({ directory, exportJobId, chapters, recoveryOnConflict: payload.recoveryOnConflict === true });
  });
  handle(IPC_CHANNELS.exportOriginalChapters, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu lưu chương dịch gốc");
    const directory = stringField(payload, "directory", { required: true, max: 32_767 })!;
    const exportJobId = stringField(payload, "exportJobId", { required: true, max: 200 })!;
    const chapters = chapterExportInputs(payload);
    return exportOriginalChapterFiles({ directory, exportJobId, chapters, recoveryOnConflict: payload.recoveryOnConflict === true });
  });
  handle(IPC_CHANNELS.exportCombinedChapters, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu lưu file tổng hợp");
    const directory = stringField(payload, "directory", { required: true, max: 32_767 })!;
    const exportJobId = stringField(payload, "exportJobId", { required: true, max: 200 })!;
    const startChapter = boundedPositiveInteger(payload.startChapter, 'startChapter');
    const endChapter = boundedPositiveInteger(payload.endChapter, 'endChapter');
    if (endChapter < startChapter) {
      throw new RangeError('Chương kết thúc phải lớn hơn hoặc bằng chương bắt đầu.');
    }
    if (!Array.isArray(payload.sourceChapterNumbers) || payload.sourceChapterNumbers.length > 10_000) {
      throw new TypeError('Danh sách chương nguồn của file tổng hợp không hợp lệ.');
    }
    const sourceChapterNumbers = payload.sourceChapterNumbers.map((value, index) => {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`Chương nguồn ${index + 1} không hợp lệ.`);
      }
      return value;
    });
    const chapters = chapterExportInputs(payload);
    return exportCombinedChapterFile({
      directory,
      exportJobId,
      startChapter,
      endChapter,
      sourceChapterNumbers,
      chapters,
      recoveryOnConflict: payload.recoveryOnConflict === true,
    });
  });
  handle(IPC_CHANNELS.exportCombinedSourceChapters, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu lưu file tổng chương gốc");
    const directory = stringField(payload, "directory", { required: true, max: 32_767 })!;
    const exportJobId = stringField(payload, "exportJobId", { required: true, max: 200 })!;
    const sourceStartChapter = boundedPositiveInteger(payload.sourceStartChapter, 'sourceStartChapter');
    const sourceEndChapter = boundedPositiveInteger(payload.sourceEndChapter, 'sourceEndChapter');
    const outputStartChapter = boundedPositiveInteger(payload.outputStartChapter, 'outputStartChapter');
    const outputEndChapter = boundedPositiveInteger(payload.outputEndChapter, 'outputEndChapter');
    const chapters = chapterExportInputs(payload);
    return exportCombinedSourceChapterFile({
      directory,
      exportJobId,
      sourceStartChapter,
      sourceEndChapter,
      outputStartChapter,
      outputEndChapter,
      chapters,
      recoveryOnConflict: payload.recoveryOnConflict === true,
    });
  });

  handle(IPC_CHANNELS.geminiGetConfig, () => dependencies.persistence.getGeminiConfiguration());
  handle(IPC_CHANNELS.geminiSetConfig, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Cấu hình Gemini");
    const apiKey = payload.apiKey;
    if (apiKey !== undefined && apiKey !== null && typeof apiKey !== "string") {
      throw new TypeError("Gemini API key không hợp lệ.");
    }
    const model = stringField(payload, "model", { max: 100 });
    return dependencies.persistence.updateGeminiConfiguration({
      ...(apiKey !== undefined ? { apiKey: apiKey as string | null } : {}),
      ...(model !== undefined ? { model } : {}),
    });
  });
  handle(IPC_CHANNELS.geminiGenerateTitles, async (_event, rawPayload) => {
    const payload = objectPayload(rawPayload, "Yêu cầu đặt tên chương");
    if (!Array.isArray(payload.chapters)) throw new TypeError("Danh sách chương không hợp lệ.");
    const chapters = payload.chapters.map((rawChapter, index) => {
      const chapter = objectPayload(rawChapter, `Chương ${index + 1}`);
      return {
        ...(typeof chapter.id === "string" ? { id: chapter.id } : {}),
        content: stringField(chapter, "content", { required: true, max: 5_000_000 })!,
      };
    });
    const model = stringField(payload, "model", { max: 100 });
    return dependencies.gemini.generateTitles({ chapters, ...(model ? { model } : {}) });
  });

  const unsubscribeTranslation = dependencies.translator.onEvent((event) =>
    broadcast(IPC_CHANNELS.translationEvent, event),
  );
  const unsubscribeChatGpt = dependencies.chatGpt.onStatus((status) =>
    broadcast(IPC_CHANNELS.chatGptStatusEvent, status),
  );
  const unsubscribeStorySources = dependencies.storySources.onProgress((progress) =>
    broadcast(IPC_CHANNELS.storyProgressEvent, progress),
  );

  return () => {
    unsubscribeTranslation();
    unsubscribeChatGpt();
    unsubscribeStorySources();
    for (const channel of registered) dependencies.ipcMain.removeHandler(channel);
  };
}
