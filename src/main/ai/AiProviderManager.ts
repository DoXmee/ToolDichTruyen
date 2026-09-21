import { EventEmitter } from "node:events";
import path from "node:path";
import type { AiProvider } from "../../shared/types.js";
import type { AccountRegistry, StoredAccount } from "../accounts/AccountRegistry.js";
import { GeminiQuotaExceededError, parseQuotaResetAt } from "../chatgpt/geminiModel.js";
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
  deepseek: ChatGptWebAdapter;
  gemini: ChatGptWebAdapter;
  /** Saved logins per bot. Without it the manager keeps its single profile. */
  accounts?: AccountRegistry;
  /** Folder that holds one browser profile per non-Google account. */
  accountProfileRoot?: string;
  persistProvider?: (provider: AiProvider) => Promise<unknown>;
}

/**
 * Raised after the active account ran out of quota and another saved account of
 * the same bot took over. The runner retries the same segment without spending
 * a retry, because the new account has not been tried yet.
 */
export class AiAccountRotatedError extends Error {
  public constructor(
    public readonly accountLabel: string,
    options?: ErrorOptions,
  ) {
    super(
      `Tài khoản đang dùng đã hết hạn mức. Đã chuyển sang tài khoản "${accountLabel}" và gửi lại đoạn này.`,
      options,
    );
    this.name = "AiAccountRotatedError";
  }
}

function usageLimitNotice(error: unknown): string | undefined {
  for (let current: unknown = error, hops = 0; current instanceof Error && hops < 5; current = current.cause, hops += 1) {
    if (current instanceof GeminiQuotaExceededError) return current.notice;
    if (/hết hạn mức sử dụng hiện tại/iu.test(current.message)) return current.message;
  }
  return undefined;
}

function quotaBlocked(account: StoredAccount, now = Date.now()): boolean {
  if (account.quotaBlockedUntil) {
    const until = Date.parse(account.quotaBlockedUntil);
    return Number.isFinite(until) ? until > now : true;
  }
  return Boolean(account.quotaNotice);
}

function normalizeProvider(provider: AiProvider): AiProvider {
  if (provider !== "chatgpt" && provider !== "kimi" && provider !== "deepseek" && provider !== "gemini") {
    throw new TypeError("Nhà cung cấp AI không hợp lệ.");
  }
  return provider;
}

function isInternalAccountLabel(label: string | undefined): boolean {
  return /__|appkit|storage|\/chat_|chào buổi sáng|bắt đầu trò chuyện|suy nghĩ sâu|tìm kiếm thông minh|trò chuyện mới|hôm qua|\b7 ngày\b|\b30 ngày\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(label ?? "");
}

function providerDefaultAccountLabel(provider: AiProvider): string {
  if (provider === "kimi") return "Kimi AI";
  if (provider === "deepseek") return "DeepSeek AI";
  if (provider === "gemini") return "Tài khoản Google";
  return "ChatGPT";
}

function providerMessage(provider: AiProvider, message?: string): string | undefined {
  if (!message || provider === "chatgpt") return message;
  const label = provider === "kimi" ? "Kimi AI" : provider === "deepseek" ? "DeepSeek AI" : "Gemini AI";
  return message.replaceAll("ChatGPT Web", label).replaceAll("ChatGPT", label);
}

function providerLabel(provider: AiProvider): string {
  if (provider === "kimi") return "Kimi AI";
  if (provider === "deepseek") return "DeepSeek AI";
  if (provider === "gemini") return "Gemini AI";
  return "ChatGPT";
}

/**
 * Owns completely separate persistent browser profiles and exposes the
 * same surface the translation runner already uses. A checkpoint selects its
 * own provider before any browser operation, so resuming can never silently
 * switch an old job to the provider currently shown in the UI.
 */
export class AiProviderManager {
  private readonly emitter = new EventEmitter();
  private readonly adapters: Record<AiProvider, ChatGptWebAdapter>;
  private readonly accountIds: Partial<Record<AiProvider, string>> = {};
  private provider: AiProvider;

  public constructor(private readonly options: AiProviderManagerOptions) {
    this.provider = normalizeProvider(options.initialProvider);
    this.adapters = {
      chatgpt: options.chatgpt,
      kimi: options.kimi,
      deepseek: options.deepseek,
      gemini: options.gemini,
    };
    for (const provider of ["chatgpt", "kimi", "deepseek", "gemini"] as const) {
      this.adapters[provider].onStatus((snapshot) => {
        if (provider !== this.provider) return;
        this.emitter.emit("status", this.decorate(provider, snapshot));
      });
      // A manual login finishes when its plain browser window is closed. That is
      // the first moment the profile can be read, so the account is recorded
      // without asking the user for another click.
      this.adapters[provider].setManualLoginClosedHandler(async () => {
        await this.handleManualLoginWindowClosed(provider);
      });
    }
  }

  public activeProvider(): AiProvider {
    return this.provider;
  }

  /** Saved accounts of every bot, for the settings panel. */
  public async listAccounts(): Promise<StoredAccount[]> {
    if (!this.options.accounts) return [];
    await this.options.accounts.clearExpiredQuotaBlocks();
    return this.options.accounts.list();
  }

  /** The account this bot will send with, if the user saved more than one. */
  public activeAccountId(provider: AiProvider = this.provider): string | undefined {
    return this.accountIds[provider];
  }

  /**
   * Registers a login that already exists as a browser profile, which is how the
   * profiles from earlier versions become "Tài khoản 1".
   */
  public async adoptProfile(provider: AiProvider, label: string): Promise<StoredAccount | undefined> {
    const registry = this.options.accounts;
    if (!registry) return undefined;
    const existing = (await registry.listFor(provider));
    if (existing.length) return existing[0];
    const adapter = this.adapters[provider];
    const account = await registry.register({
      provider,
      label,
      profileDirectory: adapter.currentProfileDirectory(),
    });
    this.accountIds[provider] = account.id;
    return account;
  }

  /**
   * Points a bot at one saved login. Google keeps several accounts inside a
   * single profile, so the account index travels with the profile directory.
   */
  public async activateAccount(accountId: string): Promise<StoredAccount | undefined> {
    const registry = this.options.accounts;
    if (!registry) return undefined;
    let account = (await registry.list()).find((candidate) => candidate.id === accountId);
    if (!account) return undefined;
    if (account.provider === "gemini" && account.authuser === undefined && account.email) {
      const authuser = await this.adapters.gemini.resolveAuthuserForEmail(account.email);
      if (authuser !== undefined) {
        account = (await registry.update(account.id, { authuser })) ?? { ...account, authuser };
      }
    }
    await this.adapters[account.provider].useProfileDirectory(account.profileDirectory, {
      ...(account.authuser === undefined ? {} : { authuser: account.authuser }),
    });
    this.accountIds[account.provider] = account.id;
    await registry.markUsed(account.id);
    if (this.provider !== account.provider) {
      await this.selectProvider(account.provider);
    }
    return account;
  }

  /**
   * Adds a login. Every bot, including Gemini, gets a fresh temporary profile:
   * opening a Google login URL inside the old Gemini profile would immediately
   * reuse the already signed-in account and make adding a second account
   * impossible. The account is persisted only after verification reads a real
   * signed-in identity from that profile.
   */
  public async addAccount(provider: AiProvider, _label?: string): Promise<StoredAccount | undefined> {
    const registry = this.options.accounts;
    if (!registry) return undefined;
    const normalized = normalizeProvider(provider);
    if (this.provider !== normalized) await this.selectProvider(normalized);
    const profileDirectory = !this.options.accountProfileRoot
      ? this.adapters[normalized].currentProfileDirectory()
      : path.join(this.options.accountProfileRoot, `${normalized}-${Date.now().toString(36)}`);
    await this.adapters[normalized].useProfileDirectory(profileDirectory);
    delete this.accountIds[normalized];
    return undefined;
  }

  /**
   * Reads the account currently signed in on the active bot and stores it, which
   * is how a login the user just performed becomes a saved account.
   */
  public async syncCurrentAccount(): Promise<StoredAccount | undefined> {
    const registry = this.options.accounts;
    if (!registry) return undefined;
    const provider = this.provider;
    const adapter = this.adapters[provider];
    const identity = await adapter.readAccountIdentity();
    return await this.storeIdentity(provider, identity);
  }

  /**
   * Records what the page says about the signed-in account. Gemini reports the
   * address, ChatGPT reports the name and plan, and the account is matched by
   * address when there is one so a second login never overwrites the first.
   */
  private async storeIdentity(
    provider: AiProvider,
    identity: { label: string; email?: string; plan?: string } | undefined,
  ): Promise<StoredAccount | undefined> {
    const registry = this.options.accounts;
    if (!registry) return undefined;
    const adapter = this.adapters[provider];
    const hint = adapter.accountHint();
    const accounts = await registry.listFor(provider);
    const known = accounts.find((account) => (
      account.profileDirectory === hint.profileDirectory && account.authuser === hint.authuser
    ));
    const byEmail = identity?.email
      ? accounts.find((account) => account.email?.toLowerCase() === identity.email!.toLowerCase())
      : undefined;
    if (!identity && !known && !byEmail) return undefined;
    const emailLabel = byEmail && !isInternalAccountLabel(byEmail.label) ? byEmail.label : undefined;
    const knownLabel = known && !isInternalAccountLabel(known.label) ? known.label : undefined;
    const label = identity?.label?.trim()
      || emailLabel
      || knownLabel
      || providerDefaultAccountLabel(provider)
      || `Tài khoản ${accounts.length + 1}`;
    const account = await registry.register({
      provider,
      label,
      profileDirectory: hint.profileDirectory,
      ...(identity?.email ? { email: identity.email } : {}),
      ...(identity?.plan ? { plan: identity.plan } : {}),
      ...(hint.authuser === undefined ? {} : { authuser: hint.authuser }),
    });
    await registry.markVerified(account.id);
    this.accountIds[provider] = account.id;
    return (await registry.list()).find((candidate) => candidate.id === account.id) ?? account;
  }

  /**
   * Runs when the plain browser window used for a login is closed: takes the
   * profile back, reads who signed in and reports it in the status line.
   */
  private async handleManualLoginWindowClosed(provider: AiProvider): Promise<void> {
    if (!this.options.accounts) return;
    try {
      const identity = await this.adapters[provider].readAccountAfterManualLogin();
      if (!identity) {
        this.setMessage(
          `Cửa sổ đăng nhập ${providerLabel(provider)} đã đóng nhưng tool chưa đọc được tài khoản. `
          + "Hãy bấm Thêm tài khoản và đăng nhập lại.",
        );
        return;
      }
      if (this.provider !== provider) await this.selectProvider(provider);
      const account = await this.storeIdentity(provider, identity);
      const detail = account?.email ? `${account.label} (${account.email})` : account?.label;
      this.setMessage(
        detail
          ? `Đã đọc và lưu tài khoản ${providerLabel(provider)} vào danh sách: ${detail}`
          : `Đã kết nối ${providerLabel(provider)}.`,
      );
    } catch (error) {
      this.setMessage(
        `Không đọc được tài khoản ${providerLabel(provider)}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Pushes a short status line without changing the connection state. */
  private setMessage(message: string): void {
    this.emitter.emit("status", { ...this.status(), message });
  }

  /**
   * Frees disk space without removing any account: cache inside every known
   * profile, plus profiles left behind by accounts the user deleted.
   */
  public async cleanJunk(): Promise<{ freedBytes: number; removed: number }> {
    const registry = this.options.accounts;
    if (!registry) return { freedBytes: 0, removed: 0 };
    const profiles = new Set<string>(
      Object.values(this.adapters).map((adapter) => adapter.currentProfileDirectory()),
    );
    for (const account of await registry.list()) profiles.add(account.profileDirectory);
    // Nothing may run while its profile is being emptied.
    await this.close();
    const caches = await registry.cleanToolCaches([...profiles]);
    const orphans = await registry.cleanupOrphanProfiles();
    return {
      freedBytes: caches.freedBytes + orphans.freedBytes,
      removed: caches.removed.length + orphans.removed.length,
    };
  }

  /**
   * Forgets a saved login. Its browser profile is deliberately left on disk so
   * the cleanup action can reclaim it later — deleting an account and cleaning
   * junk stay two separate, explicit actions.
   */
  public async removeAccount(id: string): Promise<boolean> {
    const registry = this.options.accounts;
    if (!registry) return false;
    const removed = await registry.remove(id);
    if (!removed) return false;
    if (this.accountIds[removed.provider] === id) delete this.accountIds[removed.provider];
    return true;
  }

  /**
   * Renames a saved login. Kimi and DeepSeek never expose the account name in
   * their pages, so the label the user types is the only name they get.
   */
  public async renameAccount(id: string, label: string): Promise<boolean> {
    const registry = this.options.accounts;
    if (!registry) return false;
    const trimmed = label.trim().slice(0, 60);
    if (!trimmed) return false;
    return (await registry.update(id, { label: trimmed })) !== undefined;
  }

  /**
   * Moves to the next saved account of the same bot after a usage limit, and
   * reports its label. Accounts already tried are never revisited, which is the
   * "run through the list once" rule.
   */
  private async rotateAccountAfterUsageLimit(error: unknown): Promise<string | undefined> {
    const registry = this.options.accounts;
    if (!registry) return undefined;
    const notice = usageLimitNotice(error);
    if (!notice) return undefined;
    const accounts = await registry.listFor(this.provider);
    if (accounts.length < 2) return undefined;
    const currentId = this.accountIds[this.provider];
    if (currentId) {
      await registry.markQuotaBlocked(currentId, notice, parseQuotaResetAt(notice));
    }
    const next = accounts.find((account) => account.id !== currentId && !quotaBlocked(account));
    if (!next) return undefined;
    await this.activateAccount(next.id);
    return next.label;
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
    const snapshot = await this.invoke((adapter) => adapter.openLogin());
    if (snapshot.status === "ready") {
      await this.syncCurrentAccount().catch(() => undefined);
    }
    return this.decorate(this.provider, snapshot);
  }

  public async openManualLogin(): Promise<AiProviderStatusSnapshot> {
    return this.decorate(this.provider, await this.invoke((adapter) => adapter.openManualLogin()));
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
    try {
      return await this.invoke((adapter) => adapter.sendAndWait(message, options));
    } catch (error) {
      const rotatedTo = await this.rotateAccountAfterUsageLimit(error);
      if (rotatedTo) throw new AiAccountRotatedError(rotatedTo, { cause: error });
      throw error;
    }
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
      this.adapters.deepseek.close(options),
      this.adapters.gemini.close(options),
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
      if (error instanceof Error && this.provider !== "chatgpt") {
        // Rewrite the whole cause chain: the runner surfaces the innermost
        // reason, so leaving it untouched reported "ChatGPT ..." while the
        // active provider was Gemini.
        const seen = new Set<unknown>();
        for (
          let current: unknown = error;
          current instanceof Error && !seen.has(current);
          current = current.cause
        ) {
          seen.add(current);
          current.message = providerMessage(this.provider, current.message) ?? current.message;
        }
      }
      throw error;
    }
  }
}
