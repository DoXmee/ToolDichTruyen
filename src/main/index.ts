import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from "electron";
import path from "node:path";
import { AiProviderManager } from "./ai/AiProviderManager.js";
import { ChatGptWebAdapter } from "./chatgpt/ChatGptWebAdapter.js";
import { GeminiTitleService } from "./gemini/GeminiTitleService.js";
import { registerIpcHandlers } from "./ipc.js";
import { PersistenceService } from "./persistence/PersistenceService.js";
import { PromptLoader } from "./prompts.js";
import { StorySourceService } from "./storySources/index.js";
import { TranslationJobRunner } from "./translation/TranslationJobRunner.js";
import { createMainWindow, hardenDefaultSession } from "./window.js";

const testUserDataDirectory = process.env.TOOL_DICH_TRUYEN_USER_DATA?.trim();
if (testUserDataDirectory) app.setPath("userData", path.resolve(testUserDataDirectory));

const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDevelopment = Boolean(devServerUrl);
let mainWindow: BrowserWindow | undefined;
let disposeIpc: (() => void) | undefined;
let translator: TranslationJobRunner | undefined;
let chatGpt: AiProviderManager | undefined;
let storySources: StorySourceService | undefined;
let persistence: PersistenceService | undefined;
let shutdownStarted = false;
let shutdownComplete = false;

function promptRoots(): string[] {
  return [
    path.join(process.resourcesPath, "resources", "prompts"),
    path.join(process.resourcesPath, "prompts"),
    path.join(app.getAppPath(), "resources", "prompts"),
    path.join(process.cwd(), "resources", "prompts"),
    process.cwd(),
  ];
}

async function bootstrap(): Promise<void> {
  // Keep the default executable identity on Windows. The transfer package
  // installs an unpacked app with a native shortcut, so a custom unregistered
  // AppUserModelID makes Explorer fall back to a generic taskbar icon.
  Menu.setApplicationMenu(null);
  hardenDefaultSession(isDevelopment, devServerUrl);

  const dataDirectory = app.getPath("userData");
  persistence = new PersistenceService(dataDirectory, safeStorage);
  const prompts = new PromptLoader(promptRoots());
  const chatGptAdapter = new ChatGptWebAdapter({
    profileDirectory: path.join(dataDirectory, "chatgpt-browser-profile"),
    baseUrl: process.env.CHATGPT_BASE_URL?.trim() || "https://chatgpt.com/",
    headless: false,
    executablePath: process.env.CHATGPT_BROWSER_EXECUTABLE?.trim() || undefined,
  });
  const kimiAdapter = new ChatGptWebAdapter({
    provider: "kimi",
    profileDirectory: path.join(dataDirectory, "kimi-browser-profile"),
    baseUrl: process.env.KIMI_BASE_URL?.trim() || "https://www.kimi.ai/",
    headless: false,
    executablePath:
      process.env.KIMI_BROWSER_EXECUTABLE?.trim()
      || process.env.CHATGPT_BROWSER_EXECUTABLE?.trim()
      || undefined,
  });
  const deepSeekAdapter = new ChatGptWebAdapter({
    provider: "deepseek",
    profileDirectory: path.join(dataDirectory, "deepseek-browser-profile"),
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://chat.deepseek.com/",
    headless: false,
    executablePath:
      process.env.DEEPSEEK_BROWSER_EXECUTABLE?.trim()
      || process.env.CHATGPT_BROWSER_EXECUTABLE?.trim()
      || undefined,
  });
  chatGpt = new AiProviderManager({
    initialProvider: await persistence.getAiProvider(),
    chatgpt: chatGptAdapter,
    kimi: kimiAdapter,
    deepseek: deepSeekAdapter,
    persistProvider: (provider) => persistence!.setAiProvider(provider),
  });
  translator = new TranslationJobRunner({ chatGpt, persistence });
  // Restoring years of large checkpoints must not delay the first window.
  // Start it in parallel; the runner coalesces any renderer discovery call
  // with this same promise and full checkpoints remain available on demand.
  const restoreJobs = translator.restorePersistedJobs();
  storySources = new StorySourceService({
    profileDirectory: path.join(dataDirectory, "story-source-browser-profile"),
    headless: false,
    executablePath: process.env.STORY_SOURCE_BROWSER_EXECUTABLE?.trim() || undefined,
  });
  const gemini = new GeminiTitleService({
    apiKeyProvider: () => persistence!.getGeminiApiKey(),
    modelProvider: async () => (await persistence!.getGeminiConfiguration()).model,
  });

  mainWindow = await createMainWindow({
    devServerUrl,
    onCreated: (window) => {
      mainWindow = window;
      disposeIpc = registerIpcHandlers({
        ipcMain,
        dialog,
        appVersion: () => app.getVersion(),
        mainWindow: () => mainWindow,
        devServerUrl,
        prompts,
        persistence: persistence!,
        chatGpt: chatGpt!,
        translator: translator!,
        storySources: storySources!,
        gemini,
      });
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  void restoreJobs.catch(() => undefined);
}

async function shutdown(): Promise<void> {
  await translator?.shutdown().catch(() => undefined);
  await persistence?.flush().catch(() => undefined);
  await storySources?.close().catch(() => undefined);
  await chatGpt?.close().catch(() => undefined);
  disposeIpc?.();
  disposeIpc = undefined;
}

// Packaged smoke tests run against an isolated user-data directory while the
// user may legitimately keep their normal Tool dịch truyện window open. Do not
// let that production instance absorb the test launch; regular launches still
// retain the single-instance lock.
const hasSingleInstanceLock = Boolean(testUserDataDirectory) || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Không thể khởi động Tool dịch truyện", message);
    app.quit();
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !shutdownStarted) {
    void createMainWindow({
      devServerUrl,
      onCreated: (window) => {
        mainWindow = window;
      },
    }).then((window) => {
      window.on("closed", () => {
        mainWindow = undefined;
      });
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void shutdown().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});
