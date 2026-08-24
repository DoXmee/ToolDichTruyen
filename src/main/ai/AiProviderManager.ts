import { EventEmitter } from "node:events";
import type { AiProvider } from "../../shared/types.js";
import {
  ChatGptWebAdapter,
  type ChatGptCloseOptions,
  type ChatGptStatusSnapshot,
  type SendMessageOptions,
} from "../chatgpt/ChatGptWebAdapter.js";

export interface AiProviderStatusSnapshot extends ChatGptStatusSnapshot {
  provider: AiProvider;
}

export interface AiProviderManagerOptions {
  initialProvider: AiProvider;
  chatgpt: ChatGptWebAdapter;
  kimi: ChatGptWebAdapter;
  persistProvider?: (provider: AiProvider) => Promise<unknown>;
}

function normalizeProvider(provider: AiProvider): AiProvider {
  if (provider !== "chatgpt" && provider !== "kimi") {
    throw new TypeError("Nhà cung cấp AI không hợp lệ.");
  }
  return provider;
}

function providerMessage(provider: AiProvider, message?: string): string | undefined {
  if (!message || provider === "chatgpt") return message;
  return message.replaceAll("ChatGPT Web", "Kimi AI").replaceAll("ChatGPT", "Kimi AI");
}

/**
 * Owns two completely separate persistent browser profiles and exposes the
 * same surface the translation runner already uses. A checkpoint selects its
 * own provider before any browser operation, so resuming can never silently
 * switch an old job to the provider currently shown in the UI.
 */
export class AiProviderManager {
  private readonly emitter = new EventEmitter();
  private readonly adapters: Record<AiProvider, ChatGptWebAdapter>;
  private provider: AiProvider;

  public constructor(private readonly options: AiProviderManagerOptions) {
    this.provider = normalizeProvider(options.initialProvider);
    this.adapters = { chatgpt: options.chatgpt, kimi: options.kimi };
    for (const provider of ["chatgpt", "kimi"] as const) {
      this.adapters[provider].onStatus((snapshot) => {
        if (provider !== this.provider) return;
        this.emitter.emit("status", this.decorate(provider, snapshot));
      });
    }
  }

  public activeProvider(): AiProvider {
    return this.provider;
  }

  public onStatus(listener: (snapshot: AiProviderStatusSnapshot) => void): () => void {
    this.emitter.on("status", listener);
    return () => this.emitter.off("status", listener);
  }

  public status(): AiProviderStatusSnapshot {
    return this.decorate(this.provider, this.current().status());
  }

  public async selectProvider(provider: AiProvider): Promise<void> {
    const next = normalizeProvider(provider);
    if (next === this.provider) return;
    const previous = this.current();
    if (previous.status().status === "busy") {
      throw new Error("Không thể đổi AI khi tác vụ dịch đang chạy.");
    }
    await previous.close();
    this.provider = next;
    await this.options.persistProvider?.(next);
    this.emitter.emit("status", this.status());
  }

  public async openLogin(): Promise<AiProviderStatusSnapshot> {
    return this.decorate(this.provider, await this.invoke((adapter) => adapter.openLogin()));
  }

  public async refreshStatus(waitMs = 0): Promise<AiProviderStatusSnapshot> {
    return this.decorate(
      this.provider,
      await this.invoke((adapter) => adapter.refreshStatus(waitMs)),
    );
  }

  public async ensureReady(): Promise<void> {
    await this.invoke((adapter) => adapter.ensureReady());
  }

  public async startNewConversation(): Promise<void> {
    await this.invoke((adapter) => adapter.startNewConversation());
  }

  public async sendAndWait(message: string, options?: SendMessageOptions): Promise<string> {
    return this.invoke((adapter) => adapter.sendAndWait(message, options));
  }

  public async cancelGeneration(): Promise<void> {
    await this.invoke((adapter) => adapter.cancelGeneration());
  }

  public async reloadForRecovery(): Promise<void> {
    await this.invoke((adapter) => adapter.reloadForRecovery());
  }

  public async restartForRecovery(): Promise<void> {
    await this.invoke((adapter) => adapter.restartForRecovery());
  }

  public async close(options?: ChatGptCloseOptions): Promise<void> {
    await Promise.all([
      this.adapters.chatgpt.close(options),
      this.adapters.kimi.close(options),
    ]);
  }

  private current(): ChatGptWebAdapter {
    return this.adapters[this.provider];
  }

  private decorate(
    provider: AiProvider,
    snapshot: ChatGptStatusSnapshot,
  ): AiProviderStatusSnapshot {
    const message = providerMessage(provider, snapshot.message);
    return { provider, status: snapshot.status, ...(message ? { message } : {}) };
  }

  private async invoke<T>(operation: (adapter: ChatGptWebAdapter) => Promise<T>): Promise<T> {
    try {
      return await operation(this.current());
    } catch (error) {
      if (error instanceof Error && this.provider === "kimi") {
        error.message = providerMessage("kimi", error.message) ?? error.message;
      }
      throw error;
    }
  }
}
