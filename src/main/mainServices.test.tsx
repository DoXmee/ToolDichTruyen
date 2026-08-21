import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiTitleService } from "./gemini/GeminiTitleService.js";
import { AtomicJsonStore } from "./persistence/AtomicJsonStore.js";
import { PersistenceService } from "./persistence/PersistenceService.js";
import { PromptLoader } from "./prompts.js";
import { TranslationJobRunner } from "./translation/TranslationJobRunner.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "story-tool-main-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe("PromptLoader", () => {
  it("loads UTF-8 built-in prompts and accepts period aliases", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "nien-dai.txt"), "\uFEFFPrompt niên đại\n", "utf8");
    await writeFile(path.join(root, "hien-dai.txt"), "Prompt hiện đại", "utf8");
    await writeFile(path.join(root, "co-trang.txt"), "Prompt cổ trang", "utf8");
    await writeFile(path.join(root, "tu-tien.txt"), "Prompt tu tiên", "utf8");
    const loader = new PromptLoader([root]);

    await expect(loader.loadCatalog()).resolves.toEqual({
      period: "Prompt niên đại",
      modern: "Prompt hiện đại",
      ancient: "Prompt cổ trang",
      cultivation: "Prompt tu tiên",
    });
    await expect(loader.resolve("period")).resolves.toBe("Prompt niên đại");
    await expect(loader.resolve("custom", "  Prompt riêng  ")).resolves.toBe("Prompt riêng");
  });

  it("rejects an empty custom prompt", async () => {
    const loader = new PromptLoader([await temporaryDirectory()]);
    await expect(loader.resolve("custom", "  ")).rejects.toThrow(/prompt tùy chỉnh/iu);
  });
});

describe("atomic persistence", () => {
  it("serializes concurrent JSON writes without leaving partial data", async () => {
    const directory = await temporaryDirectory();
    const store = new AtomicJsonStore<{ sequence: number }>(path.join(directory, "state.json"));
    await Promise.all([store.write({ sequence: 1 }), store.write({ sequence: 2 }), store.write({ sequence: 3 })]);
    await expect(store.read({ sequence: 0 })).resolves.toEqual({ sequence: 3 });
  });

  it("encrypts the Gemini key and never returns it in configuration", async () => {
    const directory = await temporaryDirectory();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/u, ""),
    };
    const persistence = new PersistenceService(directory, safeStorage);
    await persistence.updateGeminiConfiguration({ apiKey: "secret-key", model: "gemini-test" });

    await expect(persistence.getGeminiApiKey()).resolves.toBe("secret-key");
    await expect(persistence.getGeminiConfiguration()).resolves.toEqual({
      hasApiKey: true,
      model: "gemini-test",
    });
    expect(JSON.stringify(await persistence.getGeminiConfiguration())).not.toContain("secret-key");
  });
});

describe("GeminiTitleService", () => {
  it("batches chapters and validates the exact JSON title count", async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ titles: ["Gặp gỡ bất ngờ", "Lời hứa cũ"] }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ titles: ["Đêm không ngủ"] }) });
    const service = new GeminiTitleService({
      apiKeyProvider: async () => "key",
      modelProvider: async () => "gemini-test",
      batchSize: 2,
      clientFactory: async () => ({ models: { generateContent } }),
    });

    await expect(
      service.generateTitles({
        chapters: [
          { content: "Nội dung chương một" },
          { content: "Nội dung chương hai" },
          { content: "Nội dung chương ba" },
        ],
      }),
    ).resolves.toEqual({
      titles: ["Gặp gỡ bất ngờ", "Lời hứa cũ", "Đêm không ngủ"],
      model: "gemini-test",
    });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("propagates malformed output instead of replacing titles with placeholders", async () => {
    const service = new GeminiTitleService({
      apiKeyProvider: async () => "key",
      modelProvider: async () => "gemini-test",
      clientFactory: async () => ({
        models: { generateContent: async () => ({ text: '{"titles":[]}' }) },
      }),
    });
    await expect(service.generateTitles({ chapters: [{ content: "Một chương" }] })).rejects.toThrow(
      /cần đúng 1/iu,
    );
  });
});

describe("TranslationJobRunner", () => {
  it("retries an invalid Han-containing response and checkpoints the valid result", async () => {
    const stored = new Map<string, unknown>();
    const persistence = {
      saveJob: vi.fn(async (job: { id: string }) => {
        stored.set(job.id, structuredClone(job));
      }),
      loadJob: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    const responses = ["Xin 你.", "Xin chào."];
    const sendAndWait = vi.fn(async () => responses.shift() ?? "Xin chào.");
    const chatGpt = {
      ensureReady: vi.fn(async () => undefined),
      startNewConversation: vi.fn(async () => undefined),
      sendAndWait,
      cancelGeneration: vi.fn(async () => undefined),
    };
    const runner = new TranslationJobRunner({
      chatGpt,
      persistence: persistence as never,
    });
    const completion = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("runner test timed out")), 4_000);
      const unsubscribe = runner.onEvent((event) => {
        if (event.type === "job-completed") {
          clearTimeout(timeout);
          unsubscribe();
          resolve((event.payload as { translatedText: string }).translatedText);
        }
      });
    });

    await runner.start({
      source: "你好。",
      promptMode: "modern",
      resolvedPrompt: "Dịch sang tiếng Việt.",
      settings: { maxRetries: 1 },
    });

    await expect(completion).resolves.toBe("Xin chào.");
    expect(sendAndWait).toHaveBeenCalledTimes(2);
    expect(String(sendAndWait.mock.calls[1]?.[0])).toContain("Xin 你.");
    expect(persistence.saveJob).toHaveBeenCalled();
    expect(runner.activeJobs()).toEqual([]);
  });

  it("continues the in-flight segment when paused and immediately resumed", async () => {
    const stored = new Map<string, unknown>();
    const persistence = {
      saveJob: vi.fn(async (job: { id: string }) => stored.set(job.id, structuredClone(job))),
      loadJob: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    let resolveResponse!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const sendAndWait = vi.fn(() => response);
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait,
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: persistence as never,
    });
    const completion = new Promise<void>((resolve) => {
      const unsubscribe = runner.onEvent((event) => {
        if (event.type === "job-completed") {
          unsubscribe();
          resolve();
        }
      });
    });
    const { jobId } = await runner.start({
      source: "你好。",
      promptMode: "modern",
      resolvedPrompt: "Dịch.",
    });
    await vi.waitFor(() => expect(sendAndWait).toHaveBeenCalledTimes(1));

    await runner.pause(jobId);
    await runner.resume(jobId);
    expect(runner.activeJobs()[0]?.status).toBe("running");
    resolveResponse("Xin chào.");
    await completion;

    expect((stored.get(jobId) as { status: string }).status).toBe("completed");
    expect(sendAndWait).toHaveBeenCalledTimes(1);
  });

  it("does not revive a job cancelled while browser readiness is pending", async () => {
    const stored = new Map<string, unknown>();
    const persistence = {
      saveJob: vi.fn(async (job: { id: string }) => stored.set(job.id, structuredClone(job))),
      loadJob: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const startNewConversation = vi.fn(async () => undefined);
    const cancelGeneration = vi.fn(async () => undefined);
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn(() => ready),
        startNewConversation,
        sendAndWait: vi.fn(async () => "Xin chào."),
        cancelGeneration,
      },
      persistence: persistence as never,
    });
    const { jobId } = await runner.start({
      source: "你好。",
      promptMode: "modern",
      resolvedPrompt: "Dịch.",
    });
    await runner.cancel(jobId);
    resolveReady();
    await vi.waitFor(() => expect((stored.get(jobId) as { status: string }).status).toBe("cancelled"));

    expect(startNewConversation).not.toHaveBeenCalled();
    expect(cancelGeneration).toHaveBeenCalled();
  });

  it("allows a failed segment to be explicitly retried", async () => {
    const stored = new Map<string, unknown>();
    const persistence = {
      saveJob: vi.fn(async (job: { id: string }) => stored.set(job.id, structuredClone(job))),
      loadJob: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    let translated = "Còn 你.";
    const runner = new TranslationJobRunner({
      chatGpt: {
        ensureReady: vi.fn(async () => undefined),
        startNewConversation: vi.fn(async () => undefined),
        sendAndWait: vi.fn(async () => translated),
        cancelGeneration: vi.fn(async () => undefined),
      },
      persistence: persistence as never,
    });
    const failed = new Promise<void>((resolve) => {
      const unsubscribe = runner.onEvent((event) => {
        if (event.type === "job-failed") {
          unsubscribe();
          resolve();
        }
      });
    });
    const { jobId } = await runner.start({
      source: "你好。",
      promptMode: "modern",
      resolvedPrompt: "Dịch.",
      settings: { maxRetries: 0 },
    });
    await failed;
    const segmentId = (stored.get(jobId) as { segments: Array<{ id: string }> }).segments[0]!.id;
    translated = "Xin chào.";
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = runner.onEvent((event) => {
        if (event.type === "job-completed") {
          unsubscribe();
          resolve();
        }
      });
    });

    await runner.retrySegment({ jobId, segmentId });
    await completed;
    expect((stored.get(jobId) as { status: string }).status).toBe("completed");
  });
});
