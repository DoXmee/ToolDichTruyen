import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiProvider } from "../../shared/types.js";

/**
 * One saved login. Until now each provider owned exactly one browser profile,
 * so an account was implied rather than stored. With several logins per bot the
 * profile (and, for Google, the account index inside it) has to be recorded.
 */
export interface StoredAccount {
  id: string;
  provider: AiProvider;
  /** Shown in the account list. Read from the page when the site allows it. */
  label: string;
  /** Gemini only: Google exposes the signed-in address. */
  email?: string;
  /** ChatGPT only: the profile button names the plan. */
  plan?: string;
  profileDirectory: string;
  /** Gemini only: index of this account inside the shared Google profile. */
  authuser?: number;
  /** ISO time before which this account must not be used again. */
  quotaBlockedUntil?: string;
  quotaNotice?: string;
  /** Last time the tool verified that this saved login reaches a usable composer. */
  lastVerifiedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface RegisterAccountInput {
  provider: AiProvider;
  label: string;
  profileDirectory: string;
  email?: string;
  plan?: string;
  authuser?: number;
}

interface PersistedAccounts {
  version: 1;
  accounts: StoredAccount[];
}

const EMPTY: PersistedAccounts = { version: 1, accounts: [] };

/**
 * Cache folders every Chromium profile recreates on demand. Removing them frees
 * the bulk of a profile's size and never signs a user out, which is what the
 * cleanup button is for: junk only, never accounts.
 */
const CACHE_DIRECTORIES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "GPUPersistentCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "BrowserMetrics",
  "Crashpad",
  "component_crx_cache",
  "extensions_crx_cache",
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/Service Worker/CacheStorage",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredAccount(value: unknown): StoredAccount | undefined {
  if (!isRecord(value)) return undefined;
  const { id, provider, label, profileDirectory, createdAt } = value;
  if (
    typeof id !== "string" || !id
    || typeof provider !== "string"
    || typeof label !== "string" || !label
    || typeof profileDirectory !== "string" || !profileDirectory
    || typeof createdAt !== "string"
  ) {
    return undefined;
  }
  return {
    id,
    provider: provider as AiProvider,
    label,
    profileDirectory,
    createdAt,
    ...(typeof value.email === "string" && value.email ? { email: value.email } : {}),
    ...(typeof value.plan === "string" && value.plan ? { plan: value.plan } : {}),
    ...(typeof value.authuser === "number" && Number.isInteger(value.authuser)
      ? { authuser: value.authuser }
      : {}),
    ...(typeof value.quotaBlockedUntil === "string" ? { quotaBlockedUntil: value.quotaBlockedUntil } : {}),
    ...(typeof value.quotaNotice === "string" && value.quotaNotice ? { quotaNotice: value.quotaNotice } : {}),
    ...(typeof value.lastVerifiedAt === "string" && value.lastVerifiedAt ? { lastVerifiedAt: value.lastVerifiedAt } : {}),
    ...(typeof value.lastUsedAt === "string" && value.lastUsedAt ? { lastUsedAt: value.lastUsedAt } : {}),
  };
}

/**
 * The accounts a job may use, per bot, in the order the user arranged them.
 * Kept small on purpose: one JSON file, written atomically enough for a single
 * desktop process.
 */
export class AccountRegistry {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "accounts.json");
  }

  public async list(): Promise<StoredAccount[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) return [];
      return parsed.accounts
        .map(parseStoredAccount)
        .filter((account): account is StoredAccount => account !== undefined);
    } catch {
      return [];
    }
  }

  public async listFor(provider: AiProvider): Promise<StoredAccount[]> {
    return (await this.list()).filter((account) => account.provider === provider);
  }

  public async register(input: RegisterAccountInput): Promise<StoredAccount> {
    const accounts = await this.list();
    const email = input.email?.trim().toLowerCase();
    const sameProfile = (account: StoredAccount): boolean =>
      account.profileDirectory === input.profileDirectory && account.authuser === input.authuser;
    const sameEmail = (account: StoredAccount): boolean =>
      Boolean(email && account.email?.trim().toLowerCase() === email);
    const existing = accounts.find((account) => {
      if (account.provider !== input.provider) return false;
      // Google keeps several logins inside one profile and stopped putting the
      // account index in the URL, so the address is the only reliable identity
      // there. Without it every new login would overwrite the previous one.
      if (email) return sameEmail(account);
      return sameProfile(account);
    });
    const account: StoredAccount = {
      id: existing?.id ?? `${input.provider}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      provider: input.provider,
      label: input.label,
      profileDirectory: input.profileDirectory,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...(input.email ? { email: input.email } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.authuser === undefined ? {} : { authuser: input.authuser }),
      ...(existing?.lastVerifiedAt ? { lastVerifiedAt: existing.lastVerifiedAt } : {}),
      ...(existing?.lastUsedAt ? { lastUsedAt: existing.lastUsedAt } : {}),
    };
    const next = existing
      ? accounts
        .filter((candidate) => {
          if (candidate.provider !== input.provider || candidate.id === existing.id) return true;
          return !sameEmail(candidate) && !sameProfile(candidate);
        })
        .map((candidate) => (candidate.id === existing.id ? account : candidate))
      : [...accounts, account];
    await this.write(next);
    return account;
  }

  public async update(id: string, patch: Partial<StoredAccount>): Promise<StoredAccount | undefined> {
    const accounts = await this.list();
    const existing = accounts.find((account) => account.id === id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    await this.write(accounts.map((account) => (account.id === id ? next : account)));
    return next;
  }

  public async remove(id: string): Promise<StoredAccount | undefined> {
    const accounts = await this.list();
    const existing = accounts.find((account) => account.id === id);
    if (!existing) return undefined;
    await this.write(accounts.filter((account) => account.id !== id));
    return existing;
  }

  /** Records that this account cannot be used until `until` (ISO time). */
  public async markQuotaBlocked(id: string, notice: string, until?: string): Promise<void> {
    await this.update(id, {
      quotaNotice: notice,
      ...(until ? { quotaBlockedUntil: until } : {}),
    });
  }

  public async markUsed(id: string): Promise<void> {
    await this.update(id, { lastUsedAt: new Date().toISOString() });
  }

  public async markVerified(id: string): Promise<void> {
    await this.update(id, { lastVerifiedAt: new Date().toISOString() });
  }

  public async clearQuota(id: string): Promise<void> {
    const account = (await this.list()).find((candidate) => candidate.id === id);
    if (!account) return;
    const { quotaBlockedUntil: _until, quotaNotice: _notice, ...rest } = account;
    await this.update(id, { ...rest, quotaBlockedUntil: undefined, quotaNotice: undefined });
  }

  /** Drops quota blocks whose reset time has already passed. */
  public async clearExpiredQuotaBlocks(provider?: AiProvider): Promise<void> {
    const now = Date.now();
    for (const account of await this.list()) {
      if (provider && account.provider !== provider) continue;
      if (!account.quotaNotice && !account.quotaBlockedUntil) continue;
      const until = account.quotaBlockedUntil ? Date.parse(account.quotaBlockedUntil) : Number.NaN;
      if (Number.isFinite(until) && until <= now) await this.clearQuota(account.id);
    }
  }

  /**
   * Deletes the browser profile of every account the user removed, so a deleted
   * login does not keep gigabytes of cache behind. Only directories under this
   * registry's own account area are eligible.
   */
  public async cleanupOrphanProfiles(): Promise<{ removed: string[]; freedBytes: number }> {
    const accounts = await this.list();
    const kept = new Set(accounts.map((account) => path.resolve(account.profileDirectory)));
    const root = path.join(this.dataDirectory, "accounts");
    const removed: string[] = [];
    let freedBytes = 0;
    let entries: string[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      entries = await readdir(root);
    } catch {
      return { removed, freedBytes };
    }
    for (const entry of entries) {
      const candidate = path.join(root, entry);
      if (kept.has(path.resolve(candidate))) continue;
      const size = await directorySize(candidate);
      await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
      removed.push(candidate);
      freedBytes += size;
    }
    return { removed, freedBytes };
  }

  /**
   * Clears cache inside every supplied profile without touching any account:
   * cookies, sessions and the saved logins are left exactly as they are. Use it
   * for the "dọn rác" action, which must never remove an account.
   */
  public async cleanToolCaches(
    profileDirectories: readonly string[],
  ): Promise<{ removed: string[]; freedBytes: number }> {
    const removed: string[] = [];
    let freedBytes = 0;
    for (const profileDirectory of profileDirectories) {
      if (!profileDirectory) continue;
      for (const relative of CACHE_DIRECTORIES) {
        const target = path.join(profileDirectory, relative);
        const size = await directorySize(target);
        if (size <= 0) continue;
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
        removed.push(target);
        freedBytes += size;
      }
    }
    return { removed, freedBytes };
  }

  private async write(accounts: StoredAccount[]): Promise<void> {
    const payload = `${JSON.stringify({ version: 1, accounts } satisfies PersistedAccounts, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await writeFile(this.filePath, payload, "utf8");
    });
    await this.writeQueue;
  }
}

async function directorySize(target: string): Promise<number> {
  try {
    const info = await stat(target);
    if (!info.isDirectory()) return info.size;
  } catch {
    return 0;
  }
  let total = 0;
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(target)) {
    total += await directorySize(path.join(target, entry));
  }
  return total;
}
