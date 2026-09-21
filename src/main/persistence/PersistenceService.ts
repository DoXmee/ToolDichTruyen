import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SafeStorage } from "electron";
import type { AiProvider } from "../../shared/types.js";
import type { TranslationJobSnapshot } from "../../shared/types.js";
import { AtomicJsonStore } from "./AtomicJsonStore.js";

interface PersistedSettings {
  version: 1;
  aiProvider?: AiProvider;
  geminiModel?: string;
  geminiApiKeyEncrypted?: string;
}

const EMPTY_SETTINGS: PersistedSettings = { version: 1 };

function safeJobId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) {
    throw new TypeError("Mã tác vụ không hợp lệ.");
  }
  return id;
}

export class PersistenceService {
  private readonly draftStore: AtomicJsonStore<unknown | null>;
  private readonly settingsStore: AtomicJsonStore<PersistedSettings>;
  private readonly jobsDirectory: string;
  private readonly jobStores = new Map<string, AtomicJsonStore<unknown>>();

  public constructor(
    public readonly dataDirectory: string,
    private readonly safeStorage: Pick<SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString">,
  ) {
    this.draftStore = new AtomicJsonStore(path.join(dataDirectory, "draft.json"));
    this.settingsStore = new AtomicJsonStore(path.join(dataDirectory, "settings.json"), {
      maxBytes: 1024 * 1024,
    });
    this.jobsDirectory = path.join(dataDirectory, "jobs");
  }

  public loadDraft(): Promise<unknown | null> {
    return this.draftStore.read(null);
  }

  public async loadRendererDraft(): Promise<unknown | null> {
    const draft = await this.loadDraft();
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) return draft;
    const record = draft as Record<string, unknown>;
    const jobId = record.autoExportJobId;
    if (typeof jobId !== "string" || jobId === "pending" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(jobId)) {
      return draft;
    }
    try {
      await stat(path.join(this.jobsDirectory, `${jobId}.json`));
    } catch {
      // Preserve the legacy inline copy when its checkpoint is genuinely gone.
      return draft;
    }
    // The exact content remains durable in the job checkpoint and is fetched
    // by id immediately after the lightweight shell becomes interactive.
    return {
      ...record,
      source: "",
      output: "",
      autoExportOutput: "",
    };
  }

  public saveDraft(draft: unknown): Promise<void> {
    return this.draftStore.write(draft ?? null);
  }

  public clearDraft(): Promise<void> {
    return this.draftStore.remove();
  }

  public async saveJob<T extends { id: string }>(job: T): Promise<void> {
    const store = this.jobStore(safeJobId(job.id));
    await store.write(job);
  }

  public async loadJob<T>(id: string): Promise<T | null> {
    return await this.jobStore<T | null>(safeJobId(id)).read(null);
  }

  public async listJobs<T>(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.jobsDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const jobs: T[] = [];
    for (const name of names.filter((entry) => /^[a-zA-Z0-9_-]{1,100}\.json$/u.test(entry))) {
      const job = await new AtomicJsonStore<T | null>(path.join(this.jobsDirectory, name)).read(null);
      if (job !== null) jobs.push(job);
    }
    return jobs;
  }

  /**
   * Read only the small fields required by the checkpoint history. Parsing is
   * isolated from Electron's UI thread and the multi-megabyte source/output
   * strings never cross back into the main process.
   */
  public async listJobSummaries(): Promise<TranslationJobSnapshot[]> {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const fs = require('node:fs');
        const path = require('node:path');
        try {
          let names = [];
          try { names = fs.readdirSync(workerData.directory); }
          catch (error) {
            if (error && error.code === 'ENOENT') {
              names = [];
            } else {
              throw error;
            }
          }
          const value = [];
          for (const name of names) {
            if (!/^[a-zA-Z0-9_-]{1,100}\\.json$/.test(name)) continue;
            const job = JSON.parse(fs.readFileSync(path.join(workerData.directory, name), 'utf8'));
            if (!job || typeof job.id !== 'string' || !Array.isArray(job.segments)) continue;
            value.push({
              id: job.id,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              status: job.status,
              aiProvider: job.aiProvider === 'kimi' || job.aiProvider === 'deepseek' || job.aiProvider === 'gemini'
                ? job.aiProvider
                : 'chatgpt',
              totalSegments: job.segments.length,
              completedSegments: job.segments.filter((segment) => segment.status === 'completed').length,
              segments: job.segments.map((segment) => ({
                id: segment.id,
                index: segment.index,
                status: segment.status,
                ...(segment.error ? { error: segment.error } : {}),
              })),
              ...(job.currentSegmentIndex === undefined ? {} : { currentSegmentIndex: job.currentSegmentIndex }),
              ...(job.error ? { error: job.error } : {}),
              ...(job.autoExport ? {
                autoExport: {
                  ...job.autoExport,
                  sourceChapterNumbers: [...job.autoExport.sourceChapterNumbers],
                },
              } : {}),
              ...(Array.isArray(job.activityLog) && job.activityLog.length
                ? { activityLog: job.activityLog.slice(-240) }
                : {}),
            });
          }
          parentPort.postMessage({ ok: true, value });
        } catch (error) {
          parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      `, { eval: true, workerData: { directory: this.jobsDirectory } });
      worker.once("message", (message: { ok: boolean; value?: TranslationJobSnapshot[]; message?: string }) => {
        void worker.terminate();
        if (message.ok) resolve(message.value ?? []);
        else reject(new Error(message.message || "Không thể đọc lịch sử checkpoint."));
      });
      worker.once("error", reject);
    });
  }

  public async removeJob(id: string): Promise<void> {
    const safeId = safeJobId(id);
    await this.jobStore(safeId).remove();
    this.jobStores.delete(safeId);
  }

  public async getGeminiConfiguration(): Promise<{ hasApiKey: boolean; model: string }> {
    const settings = await this.settingsStore.read(EMPTY_SETTINGS);
    return {
      hasApiKey: Boolean(
        process.env.GEMINI_API_KEY?.trim() ||
          process.env.GOOGLE_API_KEY?.trim() ||
          settings.geminiApiKeyEncrypted,
      ),
      model: settings.geminiModel || process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
    };
  }

  public async getAiProvider(): Promise<AiProvider> {
    const provider = (await this.settingsStore.read(EMPTY_SETTINGS)).aiProvider;
    return provider === "kimi" || provider === "deepseek" || provider === "gemini"
      ? provider
      : "chatgpt";
  }

  public async setAiProvider(provider: AiProvider): Promise<AiProvider> {
    if (
      provider !== "chatgpt"
      && provider !== "kimi"
      && provider !== "deepseek"
      && provider !== "gemini"
    ) {
      throw new TypeError("Nhà cung cấp AI không hợp lệ.");
    }
    const settings = { ...(await this.settingsStore.read(EMPTY_SETTINGS)), aiProvider: provider };
    await this.settingsStore.write(settings);
    return provider;
  }

  public async getGeminiApiKey(): Promise<string> {
    const environmentKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (environmentKey) return environmentKey;

    const settings = await this.settingsStore.read(EMPTY_SETTINGS);
    if (!settings.geminiApiKeyEncrypted) {
      throw new Error("Chưa cấu hình Gemini API key.");
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Hệ điều hành hiện không thể giải mã Gemini API key.");
    }
    try {
      return this.safeStorage.decryptString(Buffer.from(settings.geminiApiKeyEncrypted, "base64"));
    } catch (error) {
      throw new Error("Không thể giải mã Gemini API key đã lưu.", { cause: error });
    }
  }

  public async updateGeminiConfiguration(input: {
    apiKey?: string | null;
    model?: string;
  }): Promise<{ hasApiKey: boolean; model: string }> {
    const settings = { ...(await this.settingsStore.read(EMPTY_SETTINGS)) };
    if (Object.prototype.hasOwnProperty.call(input, "model")) {
      const model = input.model?.trim();
      if (!model || !/^[a-zA-Z0-9._-]{3,100}$/u.test(model)) {
        throw new TypeError("Tên model Gemini không hợp lệ.");
      }
      settings.geminiModel = model;
    }
    if (Object.prototype.hasOwnProperty.call(input, "apiKey")) {
      const apiKey = input.apiKey?.trim();
      if (!apiKey) {
        delete settings.geminiApiKeyEncrypted;
      } else {
        if (apiKey.length > 1000) throw new RangeError("Gemini API key quá dài.");
        if (!this.safeStorage.isEncryptionAvailable()) {
          throw new Error("Không thể lưu khóa an toàn trên hệ điều hành này. Hãy dùng GEMINI_API_KEY.");
        }
        settings.geminiApiKeyEncrypted = this.safeStorage.encryptString(apiKey).toString("base64");
      }
    }
    await this.settingsStore.write(settings);
    return this.getGeminiConfiguration();
  }

  public async flush(): Promise<void> {
    await Promise.all([this.draftStore.flush(), this.settingsStore.flush()]);
  }

  private jobStore<T>(id: string): AtomicJsonStore<T> {
    let store = this.jobStores.get(id);
    if (!store) {
      store = new AtomicJsonStore<unknown>(path.join(this.jobsDirectory, `${id}.json`));
      this.jobStores.set(id, store);
    }
    return store as AtomicJsonStore<T>;
  }
}
