import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_CONVERSATION_OWNERSHIP_HASHES } from "./ownershipMarker.js";

export interface ToolCreatedConversation {
  id: string;
  url: string;
  recordedAt: string;
  ownershipHashes: string[];
}

interface PersistedConversationState {
  version: 3;
  conversation: ToolCreatedConversation | null;
}

export interface ConversationStateStore {
  load(): Promise<ToolCreatedConversation | undefined>;
  save(conversation: ToolCreatedConversation): Promise<void>;
  clear(): Promise<void>;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function cloneConversation(conversation: ToolCreatedConversation): ToolCreatedConversation {
  return { ...conversation, ownershipHashes: [...conversation.ownershipHashes] };
}

function hasValidOwnershipHashes(conversation: Partial<ToolCreatedConversation>): boolean {
  return (
    Array.isArray(conversation.ownershipHashes) &&
    conversation.ownershipHashes.length > 0 &&
    conversation.ownershipHashes.length <= MAX_CONVERSATION_OWNERSHIP_HASHES &&
    conversation.ownershipHashes.every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash),
    )
  );
}

function parsePersistedState(raw: string): PersistedConversationState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("Tệp ghi nhớ cuộc chat do tool tạo bị hỏng.", { cause: error });
  }
  if (!value || typeof value !== "object") {
    throw new Error("Tệp ghi nhớ cuộc chat do tool tạo không hợp lệ.");
  }
  const candidate = value as Partial<PersistedConversationState> & { version?: number };
  if (candidate.version !== 3 || !("conversation" in candidate)) {
    throw new Error("Phiên bản tệp ghi nhớ cuộc chat do tool tạo không hợp lệ.");
  }
  const conversation = candidate.conversation;
  if (conversation === null) return { version: 3, conversation: null };
  if (
    !conversation ||
    typeof conversation !== "object" ||
    typeof conversation.id !== "string" ||
    typeof conversation.url !== "string" ||
    typeof conversation.recordedAt !== "string" ||
    !hasValidOwnershipHashes(conversation)
  ) {
    throw new Error("Dữ liệu cuộc chat do tool tạo không hợp lệ.");
  }
  return { version: 3, conversation: cloneConversation(conversation as ToolCreatedConversation) };
}

export class FileConversationStateStore implements ConversationStateStore {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly statePath: string) {}

  public async load(): Promise<ToolCreatedConversation | undefined> {
    await this.writeQueue;
    try {
      const state = parsePersistedState(await readFile(this.statePath, "utf8"));
      return state.conversation ? cloneConversation(state.conversation) : undefined;
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  public save(conversation: ToolCreatedConversation): Promise<void> {
    if (!hasValidOwnershipHashes(conversation)) {
      return Promise.reject(new Error("Dữ liệu xác minh quyền sở hữu chat không hợp lệ."));
    }
    const snapshot = cloneConversation(conversation);
    return this.enqueue(() => this.writeState({ version: 3, conversation: snapshot }));
  }

  public clear(): Promise<void> {
    // Replacing the complete state file keeps the transition atomic. A crash
    // can therefore leave either the old verified conversation or no
    // conversation, never a partially truncated ID/URL.
    return this.enqueue(() => this.writeState({ version: 3, conversation: null }));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  private async writeState(state: PersistedConversationState): Promise<void> {
    const directory = path.dirname(this.statePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.statePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, this.statePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export class VolatileConversationStateStore implements ConversationStateStore {
  private conversation?: ToolCreatedConversation;

  public async load(): Promise<ToolCreatedConversation | undefined> {
    return this.conversation ? cloneConversation(this.conversation) : undefined;
  }

  public async save(conversation: ToolCreatedConversation): Promise<void> {
    if (!hasValidOwnershipHashes(conversation)) {
      throw new Error("Dữ liệu xác minh quyền sở hữu chat không hợp lệ.");
    }
    this.conversation = cloneConversation(conversation);
  }

  public async clear(): Promise<void> {
    this.conversation = undefined;
  }
}
