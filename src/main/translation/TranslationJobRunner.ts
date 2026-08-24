import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  buildContinuationRetryPrompt,
  buildContinuationTranslationPrompt,
  buildLocalizedHanRepairPrompt,
  buildRetryPrompt,
  buildTranslationPrompt,
  chunkSourceText,
  validateTranslation,
} from "../../core/index.js";
import type { LocalizedHanRepairPromptInput } from "../../core/index.js";
import type {
  PromptMode,
  AiProvider,
  TranslationJob,
  TranslationJobSnapshot,
  TranslationActivityEntry,
  TranslationActivityTone,
  TranslationAutoExportBinding,
  TranslationSegment,
  TranslationSettings,
  TranslationValidationResult,
} from "../../shared/types.js";
import {
  ChatGptConversationVerificationError,
  ChatGptFreshChatRecoveryError,
  ChatGptGenerationStopError,
  ChatGptNonRetryableSafetyError,
  type ChatGptWebAdapter,
} from "../chatgpt/ChatGptWebAdapter.js";
import type { PersistenceService } from "../persistence/PersistenceService.js";
import { repairLegacyXbanxiaCheckpointSegment } from "../storySources/text.js";

export interface StartTranslationRequest {
  source: string;
  promptMode: PromptMode;
  customPrompt?: string;
  resolvedPrompt: string;
  aiProvider?: AiProvider;
  autoExport?: TranslationAutoExportBinding;
  settings?: Partial<TranslationSettings> & {
    maxChunkChars?: number;
    timeoutMs?: number;
  };
}

interface PersistedTranslationJob extends TranslationJob {
  settings: TranslationSettings;
  conversationInitialized: boolean;
  conversationRecoveryPending: boolean;
  conversationHasBasePrompt: boolean;
  localizedHanRepairAttempts: Record<string, number>;
  /**
   * A bounded, durable hand-off after ordinary retries have all failed.
   * The value is intentionally per segment so a book cannot get trapped in
   * a new-chat loop, while a later segment can still recover independently.
  */
  freshChatRecoveryAttempts: Record<string, number>;
  /**
   * Cumulative send ceiling set when the one safe fresh-chat recovery is
   * armed.  It retains the ordinary retry budget after the old browser
   * context has been abandoned, plus the one compensating fresh-chat send.
   */
  freshChatRecoveryAttemptLimits: Record<string, number>;
  /**
   * Recovery ladder dedicated to an abnormally short translation. The first
   * result moves to a newly created tool chat; a repeat then restarts the
   * tool-owned browser before creating its replacement chat.
   */
  shortTranslationRecoveryAttempts: Record<string, number>;
  /** Number of bounded full browser restarts used for a segment. */
  browserRestartRecoveryAttempts: Record<string, number>;
  /** Number of bounded in-place ChatGPT page reloads used for a segment. */
  pageReloadRecoveryAttempts: Record<string, number>;
  /** Context prompts sent after ChatGPT itself returned a safety refusal. */
  safetyRefusalPromptAttempts: Record<string, number>;
  /** A safety refusal may move to one clean chat after three in-chat prompts. */
  safetyRefusalFreshChatAttempts: Record<string, number>;
  /** Durable marker: the next translation request must carry the context prompt. */
  safetyRefusalContextPending: Record<string, boolean>;
}

const MAX_ACTIVITY_LOG_ENTRIES = 240;

export interface TranslationEvent {
  jobId: string;
  type:
    | "job-created"
    | "job-status"
    | "segment-status"
    | "segment-retry"
    | "segment-completed"
    | "segment-failed"
    | "job-completed"
    | "job-failed"
    | "activity-log";
  timestamp: number;
  payload?: unknown;
}

export interface TranslationRunnerDependencies {
  chatGpt: Pick<
    ChatGptWebAdapter,
    "ensureReady" | "startNewConversation" | "sendAndWait" | "cancelGeneration"
  > & Partial<Pick<ChatGptWebAdapter, "restartForRecovery" | "reloadForRecovery">> & {
    selectProvider?: (provider: AiProvider) => Promise<void>;
  };
  persistence: Pick<PersistenceService, "saveJob" | "loadJob"> &
    Partial<Pick<PersistenceService, "listJobs" | "listJobSummaries" | "removeJob">>;
  chunker?: typeof chunkSourceText;
  validator?: typeof validateTranslation;
  promptBuilder?: typeof buildTranslationPrompt;
  retryPromptBuilder?: typeof buildRetryPrompt;
  continuationPromptBuilder?: typeof buildContinuationTranslationPrompt;
  continuationRetryPromptBuilder?: typeof buildContinuationRetryPrompt;
  localizedRepairPromptBuilder?: (
    input: LocalizedHanRepairPromptInput,
  ) => string;
}

/** Normal website chapters are translated whole; only unusually long chapters
 * are divided at a safe paragraph or sentence boundary. */
const WEB_SEGMENT_MAX_CHARS = 12_000;
const LEGACY_WEB_SEGMENT_MAX_CHARS = 3_000;
const WEB_RESPONSE_TIMEOUT_MS = 480_000;
const LEGACY_WEB_RESPONSE_TIMEOUT_MS = 180_000;

function repairLegacyXbanxiaCheckpoint(job: PersistedTranslationJob): number {
  if (!job.autoExport || !/^Chương\s+\d+/mu.test(job.sourceText)) return 0;
  const controlCount = (job.sourceText.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu) ?? []).length;
  const unmistakableXbanxiaNoise = controlCount >= 10
    || /\?{5,}|cx\d+|(?:^|\n)\s*【\s*第\s*\d+\s*章|(?:^|\n)\s*p\.?\s*s\.?\s*[：:]/imu.test(job.sourceText);
  if (!unmistakableXbanxiaNoise) return 0;

  let repairedCount = 0;
  for (const segment of job.segments) {
    const repaired = repairLegacyXbanxiaCheckpointSegment(segment.sourceText);
    if (repaired === segment.sourceText) continue;
    segment.sourceText = repaired;
    repairedCount += 1;
  }
  if (repairedCount) job.sourceText = job.segments.map((segment) => segment.sourceText.trim()).join("\n\n");
  return repairedCount;
}

const DEFAULT_SETTINGS: TranslationSettings = {
  // A complete ordinary chapter preserves narration and dialogue context.
  // The chapter-aware chunker only splits an unusually long chapter.
  maxCharsPerSegment: WEB_SEGMENT_MAX_CHARS,
  maxRetries: 3,
  // A normal long-form translation on the web can exceed three minutes even
  // when the page is healthy. Do not mistake that for a hung response.
  responseTimeoutMs: WEB_RESPONSE_TIMEOUT_MS,
  validation: {
    requireNoHan: true,
    minimumSourceLengthForRatioCheck: 80,
    minimumLengthRatio: 0.2,
    checkPreamble: true,
    checkTruncation: true,
    checkRepetition: true,
  },
};

const MAX_LOCALIZED_HAN_RUNS = 10;
const MAX_LOCALIZED_HAN_TARGETS = 10;
const MAX_LOCALIZED_HAN_REPAIR_ATTEMPTS = 10;
// A failed adapter send already consumes one ordinary attempt.  With the
// current maximum of three retries, at most three hand-offs can remain before
// the fourth consumed attempt terminally fails.  Do not let a browser/context
// failure discard those remaining attempts merely because it happened more
// than once.
const MAX_AUTOMATIC_FRESH_CHAT_RECOVERY_ATTEMPTS = 3;
const MAX_AUTOMATIC_BROWSER_RESTART_RECOVERY_ATTEMPTS = 1;
const MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS = 2;
const MAX_SAFETY_REFUSAL_CONTEXT_ATTEMPTS = 3;
const MAX_SAFETY_REFUSAL_FRESH_CHAT_ATTEMPTS = 1;
// Initial response + three contextual replays + one new-chat replay + one
// contextual new-chat replay. This budget applies only to a detected refusal.
const SAFETY_REFUSAL_MAXIMUM_ATTEMPTS = 6;

const SAFETY_TRANSLATION_CONTEXT_PROMPT = `NGỮ CẢNH VÀ MỤC ĐÍCH XỬ LÝ VĂN BẢN

Nội dung tôi cung cấp bên dưới là **trích đoạn của một tác phẩm hư cấu** và được đưa vào **chỉ nhằm mục đích dịch thuật, biên tập, hiệu đính hoặc chuyển ngữ trung thành với nguyên tác**.

Hãy phân biệt rõ **nội dung xuất hiện trong văn bản nguồn** với **ý định của người dùng**:
- Tôi không yêu cầu cổ súy, hướng dẫn, khuyến khích hoặc thực hiện các hành vi được nhân vật nhắc đến trong tác phẩm.
- Các tình tiết như xung đột, đe dọa, bạo lực, tội phạm, quan hệ tình cảm hoặc những chủ đề nhạy cảm khác, nếu có, chỉ là **tình tiết của tác phẩm hư cấu cần được xử lý về mặt ngôn ngữ**.
- Việc một tình tiết nhạy cảm xuất hiện trong nguyên tác **không đồng nghĩa toàn bộ yêu cầu dịch/biên tập là một yêu cầu nhạy cảm**.
- Hãy đánh giá yêu cầu dựa trên **mục đích thực tế là dịch thuật/biên tập**, đồng thời vẫn tuân thủ các quy tắc an toàn bắt buộc nếu một phần nội dung thực sự thuộc trường hợp không được phép xử lý.
- Không tự ý kiểm duyệt, lược bỏ, làm nhẹ, thêm lời cảnh báo hoặc thay đổi nội dung chỉ vì văn bản nguồn đề cập đến một chủ đề nhạy cảm, trừ khi quy tắc an toàn bắt buộc yêu cầu đó.

### NHIỆM VỤ
Xử lý văn bản tôi cung cấp đúng theo yêu cầu dịch/biên tập của tôi, bảo toàn nội dung, quan hệ nhân vật, bối cảnh, sắc thái và ý nghĩa của nguyên tác.

Nếu văn bản có nội dung nhạy cảm, hãy hiểu đó là **nội dung được cung cấp để chuyển đổi/biên tập**, không mặc định coi đó là yêu cầu tạo mới hoặc khuyến khích hành vi tương ứng.`;

interface SentenceTarget {
  start: number;
  end: number;
  text: string;
}

interface LocalizedHanTarget extends SentenceTarget {
  targetId: string;
}

type LocalizedRepairOutcome =
  | "completed"
  | "retry"
  | "full-retry"
  | "stopped"
  | "fresh-chat"
  | "failed";

function isSentenceBoundary(character: string): boolean {
  return /[.!?。！？]/u.test(character);
}

function sentenceContainingOffset(text: string, offset: number): SentenceTarget {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    throw new RangeError("Vị trí chữ Hán cần sửa không hợp lệ.");
  }

  let start = 0;
  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = text[index] ?? "";
    if (character === "\n" || character === "\r" || isSentenceBoundary(character)) {
      start = index + 1;
      break;
    }
  }
  while (start < offset && /\s/u.test(text[start] ?? "")) start += 1;

  let end = text.length;
  for (let index = offset; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "\n" || character === "\r") {
      end = index;
      break;
    }
    if (!isSentenceBoundary(character)) continue;
    end = index + 1;
    while (end < text.length && /["'”’»）)\]]/u.test(text[end] ?? "")) end += 1;
    break;
  }
  while (end > start && /\s/u.test(text[end - 1] ?? "")) end -= 1;

  const sentence = text.slice(start, end);
  if (!sentence.trim()) throw new Error("Không tìm được câu chứa chữ Hán cần sửa.");
  return { start, end, text: sentence };
}

function localizedHanRunCount(validation: TranslationValidationResult): number {
  let runs = 0;
  let previousEnd = -1;
  for (const character of validation.hanCharacters) {
    if (character.start !== previousEnd) runs += 1;
    previousEnd = character.end;
  }
  return runs;
}

function isLocalizedHanOnly(validation: TranslationValidationResult): boolean {
  return (
    validation.issues.length === 1 &&
    validation.issues[0]?.code === "han_remaining" &&
    validation.hanCharacters.length > 0 &&
    localizedHanRunCount(validation) <= MAX_LOCALIZED_HAN_RUNS
  );
}

/** A ChatGPT refusal/usage-limit response is a page-health failure, not a
 * translation-quality failure. It gets the bounded reload ladder below. */
function isChatGptPageFailure(validation: TranslationValidationResult): boolean {
  return validation.issues.some((issue) => issue.code === "error_response");
}

/** `too_short` is an incomplete answer signal, not a normal wording error. */
function isAbnormallyShortTranslation(validation: TranslationValidationResult): boolean {
  return validation.issues.some((issue) => issue.code === "too_short");
}

function localizedHanTargets(
  text: string,
  validation: TranslationValidationResult,
  segmentId: string,
): LocalizedHanTarget[] | null {
  if (!isLocalizedHanOnly(validation)) return null;

  const targets: LocalizedHanTarget[] = [];
  const seenRanges = new Set<string>();
  for (const han of validation.hanCharacters) {
    const target = sentenceContainingOffset(text, han.start);
    const rangeKey = `${target.start}:${target.end}`;
    if (seenRanges.has(rangeKey)) continue;
    seenRanges.add(rangeKey);
    targets.push({
      ...target,
      targetId: `${segmentId}-han-${target.start}-${target.end}`,
    });
  }

  return targets.length > 0 && targets.length <= MAX_LOCALIZED_HAN_TARGETS
    ? targets
    : null;
}

function hasLocalizedRepairState(segment: Pick<TranslationSegment, "translatedText" | "validation">): boolean {
  return Boolean(segment.translatedText.trim() && segment.validation && isLocalizedHanOnly(segment.validation));
}

function localizedRepairResponseError(
  target: SentenceTarget,
  response: string,
  targetId: string,
): string | null {
  const candidate = response.normalize("NFC").trim();
  if (!candidate) return "AI trả về câu sửa trống.";
  if (/\r|\n/u.test(candidate)) return "Phản hồi sửa cục bộ chứa nhiều dòng.";
  if (candidate.toLocaleLowerCase("en-US").includes(targetId.toLocaleLowerCase("en-US"))) {
    return "Phản hồi làm lộ mã target sửa cục bộ.";
  }
  if (
    /<\/?[A-Za-z_][^>]*>|^(?:[-*#>]\s*)?(?:mã\s+target|target|câu\s+(?:đã\s+)?sửa|bản\s+(?:đã\s+)?sửa|(?:đây|dưới\s+đây)\s+là\s+(?:câu|bản|phần)\s+(?:dịch|(?:đã\s+)?sửa)|corrected\s+sentence|here(?:'s|\s+is))/iu.test(
      candidate,
    )
  ) {
    return "Phản hồi sửa cục bộ chứa lời dẫn hoặc metadata.";
  }
  if ((candidate.match(/[.!?。！？]+/gu) ?? []).length > 1) {
    return "Phản hồi sửa cục bộ không phải đúng một câu.";
  }

  // A matching target id alone is not enough: ChatGPT can occasionally put
  // an unrelated sentence inside the requested tag.  The repaired sentence
  // must retain most of the non-Han wording, in the same order, before it is
  // allowed to replace the checkpoint text.
  const stableTokens = (value: string): string[] => (
    value
      .normalize("NFC")
      .replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, " ")
      .toLocaleLowerCase("vi-VN")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
  const originalTokens = stableTokens(target.text);
  const candidateTokens = stableTokens(candidate);
  if (originalTokens.length >= 3) {
    const row = new Array<number>(candidateTokens.length + 1).fill(0);
    for (const originalToken of originalTokens) {
      let diagonal = 0;
      for (let index = 1; index <= candidateTokens.length; index += 1) {
        const previous = row[index] ?? 0;
        row[index] = originalToken === candidateTokens[index - 1]
          ? diagonal + 1
          : Math.max(row[index] ?? 0, row[index - 1] ?? 0);
        diagonal = previous;
      }
    }
    const retainedRatio = (row[candidateTokens.length] ?? 0) / originalTokens.length;
    if (retainedRatio < 0.6) {
      return "AI trả về không đúng câu đang cần sửa.";
    }
  }

  const validation = validateTranslation(target.text, candidate, {
    requireNoHan: true,
    minimumSourceLengthForRatioCheck: Number.MAX_SAFE_INTEGER,
    minimumLengthRatio: 0,
    checkPreamble: true,
    checkTruncation: false,
    checkRepetition: false,
  });
  const issue = validation.issues[0];
  return issue ? issue.message : null;
}

function localizedRepairBatchResponseError(
  response: string,
  targets: readonly LocalizedHanTarget[],
): { error?: string; replacements?: Map<string, string> } {
  const candidate = response.normalize("NFC").trim();
  if (!candidate) return { error: "AI trả về phần sửa cục bộ trống." };

  const matches = [...candidate.matchAll(
    /<CAU_DA_SUA\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/CAU_DA_SUA>/giu,
  )];
  // Older persisted jobs could already have a one-sentence repair response in
  // flight when they are resumed. Accept that narrow legacy shape, although
  // every newly built prompt asks for the tagged form above.
  if (matches.length === 0 && targets.length === 1) {
    const target = targets[0];
    if (!target) return { error: "Không tìm thấy câu cần sửa cục bộ." };
    const responseError = localizedRepairResponseError(target, candidate, target.targetId);
    return responseError
      ? { error: responseError }
      : { replacements: new Map([[target.targetId, candidate]]) };
  }
  if (matches.length !== targets.length) {
    return { error: "Phản hồi sửa cục bộ không chứa đủ các câu theo mã target." };
  }

  const expected = new Map(targets.map((target) => [target.targetId, target]));
  const replacements = new Map<string, string>();
  for (const match of matches) {
    const targetId = match[1]?.trim() ?? "";
    const target = expected.get(targetId);
    if (!target || replacements.has(targetId)) {
      return { error: "Phản hồi sửa cục bộ có mã target không hợp lệ hoặc trùng lặp." };
    }
    const responseError = localizedRepairResponseError(target, match[2] ?? "", targetId);
    if (responseError) return { error: responseError };
    replacements.set(targetId, (match[2] ?? "").normalize("NFC").trim());
  }
  return { replacements };
}

function replaceLocalizedTargets(
  text: string,
  targets: readonly LocalizedHanTarget[],
  replacements: ReadonlyMap<string, string>,
): string {
  let result = text;
  for (const target of [...targets].sort((left, right) => right.start - left.start)) {
    const replacement = replacements.get(target.targetId);
    if (!replacement) throw new Error("Thiếu câu sửa cục bộ để thay vào bản dịch.");
    result = result.slice(0, target.start) + replacement + result.slice(target.end);
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Keep the user-facing failure concise, but do not discard Error.cause. The
 * ChatGPT adapter deliberately wraps an uncertain stop state in
 * ChatGptGenerationStopError so the runner will never replay a prompt that
 * may still be generating. Its cause often contains the useful browser
 * diagnostic (for example, which verification step timed out). Persisting
 * only the outer message made those two facts impossible to distinguish in a
 * saved job or its log.
 */
function errorChain(error: unknown, maximumDepth = 4): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < maximumDepth && current !== undefined; depth += 1) {
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) break;
      seen.add(current);
    }
    chain.push(current);

    try {
      current = current instanceof Error
        ? current.cause
        : typeof current === "object" && current !== null && "cause" in current
          ? (current as { cause?: unknown }).cause
          : undefined;
    } catch {
      // A hostile/custom getter must not prevent the original failure from
      // being checkpointed.
      break;
    }
  }
  return chain;
}

function singleErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  try {
    return String(error).trim();
  } catch {
    return "Không rõ lỗi";
  }
}

function errorMessage(error: unknown): string {
  const messages: string[] = [];
  for (const item of errorChain(error)) {
    const message = singleErrorMessage(item);
    if (message && !messages.includes(message)) messages.push(message);
  }
  if (messages.length === 0) return "Không rõ lỗi";

  // Stored job errors are rendered inline by the UI. Keep the causal context
  // readable without allowing a browser error to flood the local checkpoint.
  const visible = messages.join(" Nguyên nhân: ");
  return visible.length <= 1_200 ? visible : `${visible.slice(0, 1_197)}...`;
}

function isUnsafeToRetry(error: unknown): boolean {
  return errorChain(error).some(
    (item) =>
      item instanceof ChatGptGenerationStopError ||
      item instanceof ChatGptNonRetryableSafetyError,
  );
}

/**
 * This is intentionally separate from `ChatGptGenerationStopError`: the
 * adapter only emits it after closing its Playwright context and forgetting
 * the tool conversation pointer, so the old response cannot overlap a new
 * prompt.  Honour the explicit marker through wrappers too, which preserves
 * the adapter's safety contract if a caller adds diagnostic context.
 */
function isSafeForFreshChatRecovery(error: unknown): boolean {
  return errorChain(error).some(
    (item) =>
      item instanceof ChatGptFreshChatRecoveryError ||
      (typeof item === "object" &&
        item !== null &&
        "safeForFreshChatRecovery" in item &&
        (item as { safeForFreshChatRecovery?: unknown }).safeForFreshChatRecovery === true),
  );
}

/** Detect ChatGPT's visible refusal message, never a merely short translation. */
function isSafetyRefusalResponse(response: string): boolean {
  const text = response
    .normalize("NFC")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("vi-VN");
  return [
    "không thể hiển thị nội dung này vì lý do an toàn",
    "không thể hỗ trợ yêu cầu này vì lý do an toàn",
    "không thể hỗ trợ nội dung này",
    "cách tiếp cận của chúng tôi đối với các cuộc hội thoại nhạy cảm",
    "this content can't be shown for safety reasons",
    "this content cannot be shown for safety reasons",
    "if this seems like a mistake, give this response a thumbs down",
    "approach to sensitive conversations",
  ].some((phrase) => text.includes(phrase));
}

/**
 * The prompt may have reached ChatGPT, but its conversation was never proven
 * to belong to the tool.  Never replay into that untrusted page.  Recovery
 * must reset to a fresh root first, then send the checkpoint in a new chat.
 */
function isConversationVerificationFailure(error: unknown): boolean {
  return errorChain(error).some(
    (item) => item instanceof ChatGptConversationVerificationError,
  );
}

function boundedFreshChatRecoveryAttempts(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return 0;
  return Math.min(value, MAX_AUTOMATIC_FRESH_CHAT_RECOVERY_ATTEMPTS);
}

function boundedFreshChatRecoveryAttemptLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function normalizedSettings(input: StartTranslationRequest["settings"]): TranslationSettings {
  const maxChars = input?.maxCharsPerSegment ?? input?.maxChunkChars ?? DEFAULT_SETTINGS.maxCharsPerSegment;
  const timeout = input?.responseTimeoutMs ?? input?.timeoutMs ?? DEFAULT_SETTINGS.responseTimeoutMs;
  return {
    maxCharsPerSegment: Math.min(40_000, Math.max(500, Math.trunc(maxChars))),
    // Three retries means at most four total sends for a segment.
    maxRetries: Math.min(3, Math.max(0, Math.trunc(input?.maxRetries ?? DEFAULT_SETTINGS.maxRetries))),
    responseTimeoutMs: Math.min(10 * 60_000, Math.max(10_000, Math.trunc(timeout))),
    validation: { ...DEFAULT_SETTINGS.validation, ...(input?.validation ?? {}) },
  };
}

/**
 * Jobs stored by 1.2.0 before the responsiveness fix retain their original
 * slices, which must stay byte-for-byte stable for checkpoint/resume.  Give
 * those legacy retries the longer web timeout, rather than silently claiming
 * a 3k split that has not actually been performed. New jobs are created with
 * the smaller slice size above.
 */
function upgradeLegacyWebTimeout(job: PersistedTranslationJob): boolean {
  if (
    job.settings.maxCharsPerSegment > LEGACY_WEB_SEGMENT_MAX_CHARS &&
    job.settings.responseTimeoutMs <= LEGACY_WEB_RESPONSE_TIMEOUT_MS
  ) {
    job.settings.responseTimeoutMs = WEB_RESPONSE_TIMEOUT_MS;
    return true;
  }
  return false;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /(?:hủy|cancel|abort)/iu.test(error.message))
  );
}

function jobHasStatus(job: TranslationJob, status: TranslationJob["status"]): boolean {
  // Kept as a function because asynchronous controls may mutate the job while
  // an awaited browser operation is in flight.
  return job.status === status;
}

function publicSegment(segment: TranslationSegment): TranslationSegment {
  return {
    ...segment,
    validation: segment.validation
      ? {
          ...segment.validation,
          issues: segment.validation.issues.map((issue) => ({ ...issue })),
          hanCharacters: segment.validation.hanCharacters.map((item) => ({ ...item })),
          metrics: { ...segment.validation.metrics },
        }
      : undefined,
  };
}

export class TranslationJobRunner {
  private readonly emitter = new EventEmitter();
  private readonly jobs = new Map<string, PersistedTranslationJob>();
  private readonly persistedJobSummaries = new Map<string, TranslationJobSnapshot>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly pauseRequests = new Set<string>();
  private readonly cancelRequests = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly chunker: typeof chunkSourceText;
  private readonly validator: typeof validateTranslation;
  private readonly promptBuilder: typeof buildTranslationPrompt;
  private readonly retryPromptBuilder: typeof buildRetryPrompt;
  private readonly continuationPromptBuilder: typeof buildContinuationTranslationPrompt;
  private readonly continuationRetryPromptBuilder: typeof buildContinuationRetryPrompt;
  private readonly localizedRepairPromptBuilder: (
    input: LocalizedHanRepairPromptInput,
  ) => string;
  private restorePromise: Promise<void> | undefined;
  private restoreComplete = false;
  private shuttingDown = false;

  public constructor(private readonly dependencies: TranslationRunnerDependencies) {
    this.chunker = dependencies.chunker ?? chunkSourceText;
    this.validator = dependencies.validator ?? validateTranslation;
    this.promptBuilder = dependencies.promptBuilder ?? buildTranslationPrompt;
    this.retryPromptBuilder = dependencies.retryPromptBuilder ?? buildRetryPrompt;
    this.continuationPromptBuilder =
      dependencies.continuationPromptBuilder ?? buildContinuationTranslationPrompt;
    this.continuationRetryPromptBuilder =
      dependencies.continuationRetryPromptBuilder ?? buildContinuationRetryPrompt;
    this.localizedRepairPromptBuilder =
      dependencies.localizedRepairPromptBuilder ?? buildLocalizedHanRepairPrompt;
  }

  public onEvent(listener: (event: TranslationEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  public async start(request: StartTranslationRequest): Promise<{ jobId: string }> {
    if (this.shuttingDown) throw new Error("Ứng dụng đang đóng.");
    if (typeof request?.source !== "string" || request.source.trim().length === 0) {
      throw new TypeError("Nội dung tiếng Trung không được để trống.");
    }
    if (request.source.length > 20_000_000) {
      throw new RangeError("Nội dung nguồn vượt quá 20 triệu ký tự.");
    }
    if (typeof request.resolvedPrompt !== "string" || request.resolvedPrompt.trim().length === 0) {
      throw new TypeError("Prompt dịch không hợp lệ.");
    }
    this.assertNoOtherActiveJob();

    const settings = normalizedSettings(request.settings);
    const sourceText = request.source.normalize("NFC").trim();
    const chunks = this.chunker(sourceText, { maxChars: settings.maxCharsPerSegment });
    if (chunks.length === 0) throw new Error("Không thể chia nội dung nguồn thành đoạn dịch.");
    const timestamp = nowIso();
    const id = randomUUID();
    const segments: TranslationSegment[] = chunks.map((chunk) => ({
      id: chunk.id,
      index: chunk.index,
      start: chunk.start,
      end: chunk.end,
      sourceText: chunk.text,
      translatedText: "",
      status: "queued",
      attempts: 0,
    }));
    const job: PersistedTranslationJob = {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "queued",
      aiProvider: request.aiProvider === "kimi" ? "kimi" : "chatgpt",
      promptMode: request.promptMode,
      ...(request.customPrompt ? { customPrompt: request.customPrompt } : {}),
      resolvedPrompt: request.resolvedPrompt,
      ...(request.autoExport ? { autoExport: request.autoExport } : {}),
      sourceText,
      translatedText: "",
      segments,
      settings,
      conversationInitialized: false,
      conversationRecoveryPending: false,
      conversationHasBasePrompt: false,
      localizedHanRepairAttempts: {},
      freshChatRecoveryAttempts: {},
      freshChatRecoveryAttemptLimits: {},
      shortTranslationRecoveryAttempts: {},
      browserRestartRecoveryAttempts: {},
      pageReloadRecoveryAttempts: {},
      safetyRefusalPromptAttempts: {},
      safetyRefusalFreshChatAttempts: {},
      safetyRefusalContextPending: {},
      activityLog: [],
    };
    this.logActivity(job, `Đã tạo checkpoint. Đang chuẩn bị kết nối ${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"}.`);
    this.jobs.set(id, job);
    await this.checkpoint(job);
    this.emit(job.id, "job-created", { job: this.publicJob(job) });
    this.launch(job);
    return { jobId: id };
  }

  public async pause(jobId: string): Promise<void> {
    const job = await this.requireJob(jobId);
    if (job.status !== "running" && job.status !== "queued") {
      throw new Error("Chỉ có thể tạm dừng tác vụ đang chạy.");
    }
    this.pauseRequests.add(job.id);
    job.status = "paused";
    this.logActivity(job, "Người dùng đã tạm dừng tác vụ. Checkpoint đã được giữ nguyên.", "warning");
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    this.emit(job.id, "job-status", { status: job.status });
  }

  public async resume(jobId: string): Promise<void> {
    const job = await this.requireJob(jobId);
    const resumePausedJob = job.status === "paused";
    // Cancellation is terminal only until the user explicitly chooses to
    // continue from its durable checkpoint. Do not revive a cancelled job
    // containing an independently failed segment: that still needs the
    // targeted retry action, not a blind full-job resume.
    const resumeCancelledJob =
      job.status === "cancelled" &&
      !job.segments.some((segment) => segment.status === "failed");
    const resumeLifecycleFailure =
      job.status === "failed" && this.canResumeLifecycleFailure(job);
    if (!resumePausedJob && !resumeCancelledJob && !resumeLifecycleFailure) {
      throw new Error(
        job.status === "failed"
          ? "Tác vụ có đoạn đã lỗi hoặc đã hủy; hãy thử lại đúng đoạn đó."
          : "Tác vụ không ở trạng thái tạm dừng.",
      );
    }
    this.assertNoOtherActiveJob(job.id);
    const repairedXbanxiaSegments = repairLegacyXbanxiaCheckpoint(job);
    if (repairedXbanxiaSegments) {
      this.logActivity(
        job,
        `Đã làm sạch ${repairedXbanxiaSegments} đoạn Xbanxia trong checkpoint: loại ký tự ẩn, ghi chú ngoài truyện và tiêu đề lặp trước khi tiếp tục.`,
        "success",
      );
    }
    this.pauseRequests.delete(job.id);
    this.cancelRequests.delete(job.id);
    if (resumeCancelledJob) {
      // `cancel()` marks only the in-flight segment as cancelled. Make that
      // exact checkpoint eligible again while preserving every completed
      // segment and all untouched queued segments.
      for (const segment of job.segments) {
        if (segment.status === "cancelled") segment.status = "queued";
      }
      job.error = undefined;
      job.conversationInitialized = false;
      job.conversationHasBasePrompt = false;
      job.conversationRecoveryPending = job.segments.some(
        (segment) => segment.status === "completed" && Boolean(segment.translatedText.trim()),
      );
      job.currentSegmentIndex = job.segments.find((segment) => segment.status === "queued")?.index;
      this.rebuildTranslation(job);
    }
    if (resumeLifecycleFailure) {
      // No source segment failed: the browser/setup lifecycle stopped before
      // it could start the next queued piece. Start a fresh owned chat and
      // carry only the validated completed tail as recovery context.
      job.error = undefined;
      job.conversationInitialized = false;
      job.conversationHasBasePrompt = false;
      job.conversationRecoveryPending = job.segments.some(
        (segment) => segment.status === "completed" && Boolean(segment.translatedText.trim()),
      );
      job.currentSegmentIndex = job.segments.find((segment) => segment.status === "queued")?.index;
      this.rebuildTranslation(job);
    }
    const existingRunWillContinue = this.running.has(job.id);
    job.status = existingRunWillContinue ? "running" : "queued";
    this.logActivity(job, "Đã tiếp tục từ checkpoint đã lưu.");
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    this.emit(job.id, "job-status", { status: job.status });
    if (!existingRunWillContinue) this.launch(job);
  }

  /**
   * Starts a new durable job from a terminal checkpoint's original input.
   * The old checkpoint is intentionally retained so the user can still
   * inspect or discard it explicitly.
   */
  public async restart(jobId: string): Promise<{ jobId: string }> {
    const job = await this.requireJob(jobId);
    if (["queued", "running", "paused"].includes(job.status)) {
      throw new Error("Hãy hủy hoặc chờ tác vụ đang hoạt động trước khi bắt đầu lại.");
    }
    return this.start({
      source: job.sourceText,
      promptMode: job.promptMode,
      ...(job.customPrompt ? { customPrompt: job.customPrompt } : {}),
      resolvedPrompt: job.resolvedPrompt,
      ...(job.autoExport
        ? { autoExport: { ...job.autoExport, sourceChapterNumbers: [...job.autoExport.sourceChapterNumbers] } }
        : {}),
      settings: {
        ...job.settings,
        validation: { ...job.settings.validation },
      },
    });
  }

  public async cancel(jobId: string): Promise<void> {
    if (typeof jobId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(jobId)) {
      throw new TypeError("Mã tác vụ không hợp lệ.");
    }
    // Record intent before the first await. A response/checkpoint continuation
    // must not win the microtask race and mark the job completed after the
    // caller has already requested cancellation.
    this.cancelRequests.add(jobId);
    let job: PersistedTranslationJob;
    try {
      job = await this.requireJob(jobId);
    } catch (error) {
      this.cancelRequests.delete(jobId);
      throw error;
    }
    if (job.status === "completed") {
      this.cancelRequests.delete(jobId);
      return;
    }
    if (job.status === "cancelled") return;
    this.pauseRequests.delete(job.id);
    job.status = "cancelled";
    this.logActivity(job, "Người dùng đã hủy tác vụ. Checkpoint vẫn được giữ để có thể xem lại.", "warning");
    job.updatedAt = nowIso();
    const current = job.segments.find((segment) =>
      ["sending", "streaming", "validating", "retrying"].includes(segment.status),
    );
    if (current) current.status = "cancelled";
    this.abortControllers.get(job.id)?.abort(new DOMException("Đã hủy tác vụ.", "AbortError"));
    let stopError: unknown;
    try {
      await this.dependencies.chatGpt.cancelGeneration();
    } catch (error) {
      stopError = error;
    }
    // Local cancellation is the durable source of truth. Persist it even when
    // ChatGPT's stop button disappeared or its DOM changed, otherwise restart
    // recovery could revive a job the user already cancelled.
    await this.checkpoint(job);
    this.emit(job.id, "job-status", { status: job.status });
    if (stopError !== undefined) {
      throw new Error(
        "Tác vụ đã được lưu là đã hủy, nhưng không thể xác nhận dừng phản hồi trên AI Web.",
        { cause: stopError },
      );
    }
  }

  public async retrySegment(input: { jobId: string; segmentId: string }): Promise<void> {
    const job = await this.requireJob(input.jobId);
    upgradeLegacyWebTimeout(job);
    const segment = job.segments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new Error("Không tìm thấy đoạn dịch cần thử lại.");
    if (segment.status !== "failed" && segment.status !== "cancelled") {
      throw new Error("Chỉ có thể thử lại đoạn đã lỗi hoặc đã hủy.");
    }
    this.assertNoOtherActiveJob(job.id);
    this.cancelRequests.delete(job.id);
    // A failed localized-Han repair already has a complete translation except
    // for a bounded batch of faulty sentences. Retrying it must never discard
    // that work or resend the full source segment; the fresh conversation
    // receives only the current faulty-sentence batch below.
    const preserveLocalizedRepair = hasLocalizedRepairState(segment);
    segment.status = "queued";
    segment.attempts = 0;
    segment.error = undefined;
    if (!preserveLocalizedRepair) {
      segment.validation = undefined;
      segment.translatedText = "";
    }
    delete job.localizedHanRepairAttempts[segment.id];
    // A manual retry is a deliberate new user action. It receives its normal
    // retry budget again, including one later automatic fresh-chat hand-off.
    delete job.freshChatRecoveryAttempts[segment.id];
    delete job.freshChatRecoveryAttemptLimits[segment.id];
    delete job.shortTranslationRecoveryAttempts[segment.id];
    delete job.browserRestartRecoveryAttempts[segment.id];
    delete job.pageReloadRecoveryAttempts[segment.id];
    this.clearSafetyRefusalRecovery(job, segment.id);
    job.error = undefined;
    job.status = "queued";
    // A failed/cancelled job may have yielded the shared ChatGPT adapter to a
    // later job. Retrying must create a fresh owned conversation, which safely
    // cleans the latest tool chat instead of appending to another job's chat.
    job.conversationInitialized = false;
    job.conversationRecoveryPending = true;
    job.conversationHasBasePrompt = false;
    this.logActivity(job, `Đã đưa đoạn ${segment.index + 1} về hàng đợi để thử lại từ checkpoint lỗi.`, "warning", segment);
    job.updatedAt = nowIso();
    this.rebuildTranslation(job);
    await this.checkpoint(job);
    this.emit(job.id, "segment-status", { segment: publicSegment(segment) });
    if (!this.running.has(job.id)) this.launch(job);
  }

  public activeJobs(): TranslationJobSnapshot[] {
    return [...this.jobs.values()]
      // Failed and cancelled checkpoints are history, not active work.  They
      // must never prevent the user from starting another translation.
      .filter((job) => ["queued", "running", "paused"].includes(job.status))
      .map((job) => this.snapshot(job, false));
  }

  /**
   * Removes a terminal checkpoint at the user's explicit request. Completed
   * jobs are deliberately protected because they may be the only durable copy
   * of a translation waiting to be exported.
   */
  public async discard(jobId: string): Promise<void> {
    const job = await this.requireJob(jobId);
    if (["queued", "running", "paused"].includes(job.status)) {
      throw new Error("Hãy hủy tác vụ đang hoạt động trước khi bỏ checkpoint.");
    }
    if (job.status === "completed") {
      throw new Error("Không thể bỏ checkpoint đã hoàn tất; hãy xuất hoặc lưu bản dịch trước.");
    }
    if (!this.dependencies.persistence.removeJob) {
      throw new Error("Bộ nhớ phiên bản này chưa hỗ trợ bỏ checkpoint.");
    }

    this.running.delete(job.id);
    this.abortControllers.delete(job.id);
    this.pauseRequests.delete(job.id);
    this.cancelRequests.delete(job.id);
    this.jobs.delete(job.id);
    this.persistedJobSummaries.delete(job.id);
    await this.dependencies.persistence.removeJob(job.id);
  }

  private async restoreCandidate(candidate: PersistedTranslationJob | null | undefined): Promise<void> {
    if (!candidate || typeof candidate.id !== "string" || !Array.isArray(candidate.segments)) return;
    if (this.jobs.has(candidate.id)) return;
    candidate.localizedHanRepairAttempts ??= {};
    candidate.aiProvider = candidate.aiProvider === "kimi" ? "kimi" : "chatgpt";
    candidate.freshChatRecoveryAttempts ??= {};
    candidate.freshChatRecoveryAttemptLimits ??= {};
    candidate.shortTranslationRecoveryAttempts ??= {};
    candidate.browserRestartRecoveryAttempts ??= {};
    candidate.pageReloadRecoveryAttempts ??= {};
    candidate.safetyRefusalPromptAttempts ??= {};
    candidate.safetyRefusalFreshChatAttempts ??= {};
    candidate.safetyRefusalContextPending ??= {};
    candidate.activityLog ??= [];
    upgradeLegacyWebTimeout(candidate);
    candidate.conversationInitialized = false;
    candidate.conversationHasBasePrompt = false;
    candidate.conversationRecoveryPending = candidate.segments.some(
      (segment) => segment.status === "completed" && Boolean(segment.translatedText?.trim()),
    );
    if (candidate.status === "running" || candidate.status === "queued") {
      candidate.status = "paused";
      candidate.updatedAt = nowIso();
      await this.dependencies.persistence.saveJob(candidate);
    }
    this.jobs.set(candidate.id, candidate);
    this.persistedJobSummaries.set(candidate.id, this.snapshot(candidate, false));
  }

  public restorePersistedJobs(): Promise<void> {
    if (this.restoreComplete) return Promise.resolve();
    if (this.restorePromise) return this.restorePromise;

    this.restorePromise = (async () => {
      if (this.dependencies.persistence.listJobSummaries) {
        const summaries = await this.dependencies.persistence.listJobSummaries();
        for (const summary of summaries) this.persistedJobSummaries.set(summary.id, summary);
        const activeIds = summaries
          .filter((summary) => ["queued", "running", "paused"].includes(summary.status))
          .map((summary) => summary.id);
        for (const id of activeIds) {
          const candidate = await this.dependencies.persistence.loadJob<PersistedTranslationJob>(id);
          if (candidate) await this.restoreCandidate(candidate);
        }
        this.restoreComplete = true;
        return;
      }
      const persisted = await this.dependencies.persistence.listJobs?.<PersistedTranslationJob>() ?? [];
      for (const candidate of persisted) {
        await this.restoreCandidate(candidate);
      }
      this.restoreComplete = true;
    })().finally(() => {
      if (!this.restoreComplete) this.restorePromise = undefined;
    });
    return this.restorePromise;
  }

  /**
   * Discovers durable checkpoints after a renderer/app restart. Unlike
   * activeJobs(), this includes terminal jobs and their final output so a
   * pending link-import export can be resumed even if the renderer closed in
   * the short interval before it learned the generated job id.
   */
  public async discoverJobs(): Promise<TranslationJobSnapshot[]> {
    await this.restorePersistedJobs();
    const summaries = new Map(this.persistedJobSummaries);
    for (const job of this.jobs.values()) summaries.set(job.id, this.snapshot(job, false));
    return [...summaries.values()]
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""));
  }

  public async get(jobId: string): Promise<TranslationJobSnapshot> {
    return this.snapshot(await this.requireJob(jobId), true);
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const [jobId, controller] of this.abortControllers) {
      controller.abort(new DOMException("Ứng dụng đang đóng.", "AbortError"));
      const job = this.jobs.get(jobId);
      if (job && job.status === "running") {
        job.status = "paused";
        job.updatedAt = nowIso();
        await this.checkpoint(job).catch(() => undefined);
      }
    }
    await this.dependencies.chatGpt.cancelGeneration().catch(() => undefined);
  }

  private launch(job: PersistedTranslationJob): void {
    const promise = this.run(job)
      .catch(async (error: unknown) => {
        if (this.cancelRequests.has(job.id) || job.status === "cancelled" || isAbortError(error)) return;
        job.status = "failed";
        job.error = errorMessage(error);
        job.updatedAt = nowIso();
        await this.checkpoint(job).catch(() => undefined);
        this.emit(job.id, "job-failed", { error: job.error, job: this.publicJob(job) });
      })
      .finally(() => {
        this.running.delete(job.id);
        this.abortControllers.delete(job.id);
        const needsContinuation =
          !this.shuttingDown &&
          !this.cancelRequests.has(job.id) &&
          !this.pauseRequests.has(job.id) &&
          (jobHasStatus(job, "queued") || jobHasStatus(job, "running")) &&
          job.segments.some((segment) => segment.status !== "completed");
        if (needsContinuation) this.launch(job);
      });
    this.running.set(job.id, promise);
  }

  private async run(job: PersistedTranslationJob): Promise<void> {
    if (this.cancelRequests.has(job.id) || job.status === "cancelled") return;
    const controller = new AbortController();
    this.abortControllers.set(job.id, controller);
    await this.dependencies.chatGpt.selectProvider?.(job.aiProvider);
    const providerLabel = job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT";
    this.logActivity(job, `Đang kiểm tra phiên ${providerLabel} trước khi dịch tiếp.`);
    await this.dependencies.chatGpt.ensureReady();
    if (this.shouldStop(job, controller.signal)) return;
    if (!job.conversationInitialized) {
      this.logActivity(job, "Đang tạo chat dịch mới và gửi prompt gốc cho đoạn kế tiếp.");
      await this.dependencies.chatGpt.startNewConversation();
      if (this.shouldStop(job, controller.signal)) return;
      job.conversationInitialized = true;
      job.conversationHasBasePrompt = false;
      await this.checkpoint(job);
      this.logActivity(job, "Đã sẵn sàng chat dịch mới.", "success");
      if (this.shouldStop(job, controller.signal)) return;
    }
    if (this.pauseRequests.has(job.id) || job.status === "paused") return;
    job.status = "running";
    this.logActivity(job, "Bắt đầu xử lý các đoạn còn lại.");
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    if (this.shouldStop(job, controller.signal)) return;
    this.emit(job.id, "job-status", { status: job.status });

    for (const segment of job.segments) {
      if (this.shouldStop(job, controller.signal)) return;
      if (this.pauseRequests.has(job.id) || jobHasStatus(job, "paused")) return;
      if (segment.status === "completed") continue;
      job.currentSegmentIndex = segment.index;
      const completed = await this.processSegment(job, segment, controller.signal);
      if (!completed) return;
    }

    // processSegment contains awaited response/checkpoint work. Cancellation
    // may have arrived after the final segment became valid, so terminal state
    // must be checked again before assigning the job's completed status.
    if (this.shouldStop(job, controller.signal)) return;
    this.rebuildTranslation(job);
    if (this.shouldStop(job, controller.signal)) return;
    job.status = "completed";
    job.currentSegmentIndex = undefined;
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    this.emit(job.id, "job-completed", {
      translatedText: job.translatedText,
      job: this.publicJob(job),
    });
  }

  private async processSegment(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
  ): Promise<boolean> {
    let previousTranslation = segment.translatedText;
    let previousValidation = segment.validation;
    const normalMaximumAttempts = 1 + job.settings.maxRetries;
    const freshChatRecoveryAttempts = boundedFreshChatRecoveryAttempts(
      job.freshChatRecoveryAttempts[segment.id],
    );
    const browserRestartRecoveryAttempts = boundedFreshChatRecoveryAttempts(
      job.browserRestartRecoveryAttempts[segment.id],
    );
    let pageReloadRecoveryAttempts = Math.min(
      Math.max(0, Math.trunc(job.pageReloadRecoveryAttempts[segment.id] ?? 0)),
      MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS,
    );
    // A previous build persisted an early fresh-chat hand-off with a ceiling
    // of `attempts + 1`, which silently threw away unused retries.  A safely
    // abandoned chat has no overlapping response, so the replacement chat
    // receives every remaining ordinary retry; it is not an extra retry.
    // Reloading the page twice, then restarting the browser, changes the
    // recovery environment only. It does not silently grant extra sends.
    let maximumAttempts = this.hasSafetyRefusalRecovery(job, segment.id)
      ? Math.max(normalMaximumAttempts, SAFETY_REFUSAL_MAXIMUM_ATTEMPTS)
      : normalMaximumAttempts;
    if (
      freshChatRecoveryAttempts > 0 &&
      boundedFreshChatRecoveryAttemptLimit(job.freshChatRecoveryAttemptLimits[segment.id])
        !== maximumAttempts
    ) {
      job.freshChatRecoveryAttemptLimits[segment.id] = maximumAttempts;
    }

    if (
      this.shouldStop(job, signal) ||
      this.pauseRequests.has(job.id) ||
      jobHasStatus(job, "paused")
    ) {
      return false;
    }

    // A pause or process shutdown can happen after an invalid translation was
    // checkpointed, or while a bounded local repair was in flight.  Resume
    // the local repair directly so validated text outside the faulty sentences
    // is never needlessly rewritten.
    if (previousValidation?.valid && previousTranslation.trim()) {
      return this.completeSegment(job, segment, signal);
    }
    if (previousValidation && isLocalizedHanOnly(previousValidation)) {
      if (!previousTranslation.trim()) {
        segment.error = "Checkpoint sửa chữ Hán không có bản dịch để phục hồi.";
        return this.failSegment(job, segment, signal);
      }
      const outcome = await this.repairLocalizedHan(
        job,
        segment,
        signal,
        maximumAttempts,
      );
      if (outcome === "stopped") return false;
      if (outcome === "fresh-chat") {
          return this.queueFreshChatRecovery(job, segment, signal, {
            normalMaximumAttempts: maximumAttempts,
            preserveLocalizedRepair: true,
        });
      }
      if (outcome === "completed") {
        return this.completeSegment(job, segment, signal);
      }
      if (outcome !== "full-retry") return this.failSegment(job, segment, signal);
      previousTranslation = segment.translatedText;
      previousValidation = segment.validation;
    }

    // A send attempt is durably consumed before entering ChatGPT. If the app
    // stopped during the final non-local request, there is no safe automatic
    // resend left. Mark it failed now instead of returning with status=running;
    // launch.finally would otherwise keep relaunching this exhausted segment.
    if (segment.attempts >= maximumAttempts) {
      segment.error ||= "Đã dùng hết số lần thử cho đoạn dịch.";
      return this.failSegment(job, segment, signal);
    }

    while (segment.attempts < maximumAttempts) {
      if (
        this.shouldStop(job, signal) ||
        this.pauseRequests.has(job.id) ||
        jobHasStatus(job, "paused")
      ) {
        return false;
      }
      segment.attempts += 1;
      const isRetry = segment.attempts > 1;
      segment.status = isRetry ? "retrying" : "sending";
      segment.error = undefined;
      this.logActivity(
        job,
        `${isRetry ? "Thử lại" : "Gửi"} đoạn ${segment.index + 1}/${job.segments.length}, lần ${segment.attempts}/${maximumAttempts} (${segment.sourceText.length.toLocaleString("vi-VN")} ký tự nguồn).`,
        isRetry ? "warning" : "info",
        segment,
      );
      job.updatedAt = nowIso();
      await this.checkpoint(job);
      if (this.shouldStop(job, signal)) return false;
      this.emit(job.id, segment.status === "retrying" ? "segment-retry" : "segment-status", {
        segment: publicSegment(segment),
        maximumAttempts,
      });

      const commonPromptInput = {
        basePrompt: job.resolvedPrompt,
        sourceText: segment.sourceText,
        segmentIndex: segment.index,
        totalSegments: job.segments.length,
        segmentId: segment.id,
      };
      // Every retry repeats the full base prompt.  A fresh request for the
      // next normal segment may still use the short continuation envelope,
      // but no error recovery relies on context that ChatGPT may have lost.
      const includeBasePrompt = isRetry
        || !job.conversationHasBasePrompt
        || job.aiProvider === "kimi";
      const retryPromptInput = previousValidation
        ? {
            ...commonPromptInput,
            previousTranslation,
            validation: previousValidation,
            attempt: segment.attempts,
          }
        : undefined;
      let prompt = retryPromptInput
        ? this.retryPromptBuilder(retryPromptInput)
        : includeBasePrompt
          ? this.promptBuilder(commonPromptInput)
          : this.continuationPromptBuilder(commonPromptInput);
      prompt = this.withPendingRecoveryContext(job, prompt);
      prompt = this.withSafetyRefusalContext(job, segment.id, prompt);
      if (includeBasePrompt) job.conversationHasBasePrompt = true;

      let retryUnsafe = false;
      let freshChatRecoveryRequested = false;
      let adapterErrorOccurred = false;
      let pageRecoveryRequested = false;
      let conversationVerificationFailed = false;
      let safetyRefusalDetected = false;
      try {
        segment.status = "streaming";
        this.logActivity(job, `${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"} đang tạo bản dịch cho đoạn ${segment.index + 1}/${job.segments.length}.`, "info", segment);
        await this.checkpoint(job);
        if (this.shouldStop(job, signal)) return false;
        this.emit(job.id, "segment-status", { segment: publicSegment(segment) });
        const response = await this.dependencies.chatGpt.sendAndWait(prompt, {
          timeoutMs: job.settings.responseTimeoutMs,
          signal,
        });
        if (this.shouldStop(job, signal)) return false;
        this.consumeRecoveryContext(job);
        this.consumeSafetyRefusalContext(job, segment.id);
        segment.status = "validating";
        segment.translatedText = response.trim().normalize("NFC");
        job.updatedAt = nowIso();
        await this.checkpoint(job);
        this.logActivity(job, `Đã nhận phản hồi, đang kiểm tra chất lượng đoạn ${segment.index + 1}/${job.segments.length}.`, "info", segment);
        if (this.shouldStop(job, signal)) return false;
        this.emit(job.id, "segment-status", { segment: publicSegment(segment) });

        const validation = this.validator(
          segment.sourceText,
          segment.translatedText,
          job.settings.validation,
        );
        segment.validation = validation;
        previousTranslation = segment.translatedText;
        previousValidation = validation;
        if (validation.valid) {
          return this.completeSegment(job, segment, signal);
        }
        safetyRefusalDetected = isSafetyRefusalResponse(segment.translatedText);
        if (isLocalizedHanOnly(validation)) {
          const outcome = await this.repairLocalizedHan(
            job,
            segment,
            signal,
            maximumAttempts,
          );
          if (outcome === "stopped") return false;
          if (outcome === "fresh-chat") {
            return this.queueFreshChatRecovery(job, segment, signal, {
              normalMaximumAttempts: maximumAttempts,
              preserveLocalizedRepair: true,
            });
          }
          if (outcome === "completed") {
            return this.completeSegment(job, segment, signal);
          }
          if (outcome !== "full-retry") return this.failSegment(job, segment, signal);
          previousTranslation = segment.translatedText;
          previousValidation = segment.validation;
          // The local path already produced a replacement request and an
          // invalid response. Preserve that validation for the next full
          // retry instead of overwriting its specific error below.
          continue;
        }
        pageRecoveryRequested = isChatGptPageFailure(validation);
        segment.error = validation.issues.map((issue) => issue.message).join("; ");
        this.logActivity(job, `Đoạn chưa đạt kiểm tra: ${segment.error}`, "warning", segment);
      } catch (error) {
        if (this.shouldStop(job, signal) || isAbortError(error)) return false;
        adapterErrorOccurred = true;
        segment.error = errorMessage(error);
        this.logActivity(job, `Lỗi khi chờ ${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"}: ${segment.error}`, "warning", segment);
        freshChatRecoveryRequested = isSafeForFreshChatRecovery(error);
        conversationVerificationFailed = isConversationVerificationFailure(error);
        // A context that the adapter has positively abandoned is the one
        // exception to the normal fail-closed stop rule. Its explicit marker
        // wins because the adapter has already ensured an old generation
        // cannot overlap the next fresh chat.
        retryUnsafe =
          !freshChatRecoveryRequested &&
          !conversationVerificationFailed &&
          isUnsafeToRetry(error);
        // A transport/UI failure has no invalid translation to include. The next
        // attempt resends the complete original request.
        if (!previousValidation?.valid && !previousTranslation) previousValidation = undefined;
      }

      if (this.shouldStop(job, signal)) return false;
      if (freshChatRecoveryRequested) {
        return this.queueFreshChatRecovery(job, segment, signal, {
          normalMaximumAttempts: maximumAttempts,
        });
      }
      if (retryUnsafe) {
        return this.failSegment(job, segment, signal);
      }

      if (safetyRefusalDetected) {
        maximumAttempts = Math.max(maximumAttempts, SAFETY_REFUSAL_MAXIMUM_ATTEMPTS);
        const freshChatUsed = Math.min(
          MAX_SAFETY_REFUSAL_FRESH_CHAT_ATTEMPTS,
          Math.max(0, Math.trunc(job.safetyRefusalFreshChatAttempts[segment.id] ?? 0)),
        );
        const contextLimit = freshChatUsed > 0 ? 1 : MAX_SAFETY_REFUSAL_CONTEXT_ATTEMPTS;
        const contextUsed = Math.min(
          contextLimit,
          Math.max(0, Math.trunc(job.safetyRefusalPromptAttempts[segment.id] ?? 0)),
        );
        if (contextUsed < contextLimit) {
          const nextContextAttempt = contextUsed + 1;
          job.safetyRefusalPromptAttempts[segment.id] = nextContextAttempt;
          job.safetyRefusalContextPending[segment.id] = true;
          segment.status = "retrying";
          segment.error = `${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"} trả thông báo an toàn; sẽ gửi ngữ cảnh dịch thuật rồi gửi lại đúng đoạn.`;
          this.logActivity(
            job,
            freshChatUsed > 0
              ? "Chat mới trả thông báo an toàn: gửi ngữ cảnh dịch thuật lần duy nhất rồi gửi lại đoạn."
              : `ChatGPT trả thông báo an toàn: gửi ngữ cảnh dịch thuật lần ${nextContextAttempt}/${MAX_SAFETY_REFUSAL_CONTEXT_ATTEMPTS} rồi gửi lại đoạn.`,
            "warning",
            segment,
          );
          job.updatedAt = nowIso();
          await this.checkpoint(job);
          if (this.shouldStop(job, signal)) return false;
          this.emit(job.id, "segment-retry", {
            segment: publicSegment(segment),
            kind: "safety-context",
            contextAttempt: nextContextAttempt,
            maximumContextAttempts: contextLimit,
            maximumAttempts,
          });
          await this.waitBeforeRetry(segment.attempts, signal);
          continue;
        }
        if (freshChatUsed < MAX_SAFETY_REFUSAL_FRESH_CHAT_ATTEMPTS) {
          job.safetyRefusalFreshChatAttempts[segment.id] = freshChatUsed + 1;
          job.safetyRefusalPromptAttempts[segment.id] = 0;
          delete job.safetyRefusalContextPending[segment.id];
          this.logActivity(
            job,
            `${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"} vẫn trả thông báo an toàn sau 3 lần nhắc ngữ cảnh; tạo chat mới để thử lại đoạn một lần.`,
            "warning",
            segment,
          );
          return this.queueFreshChatRecovery(job, segment, signal, {
            normalMaximumAttempts: maximumAttempts,
            trigger: "safety-refusal",
          });
        }
        segment.error = `${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"} tiếp tục từ chối nội dung sau khi đã gửi ngữ cảnh trong chat mới.`;
        return this.failSegment(job, segment, signal);
      }
      if (this.hasSafetyRefusalRecovery(job, segment.id)) {
        // A later reply is an ordinary translation failure, so return to the
        // existing retry policy instead of extending the special safety budget.
        this.clearSafetyRefusalRecovery(job, segment.id);
        maximumAttempts = normalMaximumAttempts;
      }

      // A missing ownership marker is special: the outgoing prompt may exist
      // in an unknown ChatGPT conversation.  Reload once to clear transient
      // rendering, then let `startNewConversation()` move to a clean root
      // before the checkpoint is resent with its base prompt.  If the same
      // proof fails again, restart the tool-owned browser before creating the
      // next fresh chat.  We never send again into the unverified page.
      if (conversationVerificationFailed) {
        if (
          pageReloadRecoveryAttempts === 0 &&
          this.dependencies.chatGpt.reloadForRecovery
        ) {
          const reloaded = await this.queuePageReloadRecovery(job, segment, signal);
          pageReloadRecoveryAttempts = Math.min(
            Math.max(0, Math.trunc(job.pageReloadRecoveryAttempts[segment.id] ?? 0)),
            MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS,
          );
          if (reloaded) {
            return this.queueFreshChatRecovery(job, segment, signal, {
              normalMaximumAttempts: maximumAttempts,
            });
          }
        }
        return this.queueBrowserRestartRecovery(job, segment, signal, {
          normalMaximumAttempts: maximumAttempts,
        });
      }

      // An abnormally short response is commonly an incomplete ChatGPT turn.
      // Do not append a repair to that same turn: first delete the verified
      // tool chat and create a new one; if the fresh chat still returns a
      // short answer, restart the browser and create another clean chat.
      if (previousValidation && isAbnormallyShortTranslation(previousValidation)) {
        const shortRecoveryAttempts = Math.min(
          Math.max(0, Math.trunc(job.shortTranslationRecoveryAttempts[segment.id] ?? 0)),
          2,
        );
        if (shortRecoveryAttempts === 0) {
          job.shortTranslationRecoveryAttempts[segment.id] = 1;
          this.logActivity(
            job,
            "Bản dịch ngắn bất thường: đang xóa chat do tool tạo và tạo chat mới để gửi lại prompt gốc.",
            "warning",
            segment,
          );
          return this.queueFreshChatRecovery(job, segment, signal, {
            normalMaximumAttempts: maximumAttempts,
            trigger: "short-translation",
          });
        }
        if (shortRecoveryAttempts === 1) {
          job.shortTranslationRecoveryAttempts[segment.id] = 2;
          this.logActivity(
            job,
            "Chat mới vẫn trả bản dịch ngắn: đang khởi động lại browser rồi tạo chat mới để gửi lại prompt gốc.",
            "warning",
            segment,
          );
          return this.queueBrowserRestartRecovery(job, segment, signal, {
            normalMaximumAttempts: maximumAttempts,
            trigger: "short-translation-after-fresh-chat",
          });
        }
      }

      // A genuine page/browser failure uses a deterministic ladder before we
      // give up the segment: reload the same verified page twice, then use the
      // last ordinary send in a newly opened tool browser/chat. Quality
      // validation failures (Han, truncation, etc.) deliberately skip this.
      if (adapterErrorOccurred || pageRecoveryRequested) {
        if (
          pageReloadRecoveryAttempts < MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS &&
          this.dependencies.chatGpt.reloadForRecovery
        ) {
          const reloaded = await this.queuePageReloadRecovery(job, segment, signal);
          pageReloadRecoveryAttempts = Math.min(
            Math.max(0, Math.trunc(job.pageReloadRecoveryAttempts[segment.id] ?? 0)),
            MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS,
          );
          if (reloaded) {
            previousTranslation = segment.translatedText;
            previousValidation = segment.validation;
            continue;
          }
        }
        if (
          pageReloadRecoveryAttempts >= MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS &&
          browserRestartRecoveryAttempts < MAX_AUTOMATIC_BROWSER_RESTART_RECOVERY_ATTEMPTS &&
          this.dependencies.chatGpt.restartForRecovery
        ) {
          return this.queueBrowserRestartRecovery(job, segment, signal, {
            normalMaximumAttempts,
          });
        }
      }

      if (segment.attempts >= maximumAttempts) {
        return this.failSegment(job, segment, signal);
      }

      segment.status = "retrying";
      this.logActivity(job, `Chờ ngắn trước khi thử lại đoạn ${segment.index + 1}.`, "warning", segment);
      await this.checkpoint(job);
      if (this.shouldStop(job, signal)) return false;
      this.emit(job.id, "segment-retry", {
        segment: publicSegment(segment),
        nextAttempt: segment.attempts + 1,
        maximumAttempts,
      });
      await this.waitBeforeRetry(segment.attempts, signal);
    }
    return false;
  }

  /**
   * The adapter has positively closed the old browser context, so the old
   * generation cannot overlap a new prompt. Persist the hand-off before
   * leaving this run; launch.finally starts the replacement chat afterwards.
   * The sole validation exception is `too_short`, which uses this mechanism
   * because an incomplete answer must not share the old conversation.
   */
  private async queueFreshChatRecovery(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
    input: {
      normalMaximumAttempts: number;
      preserveLocalizedRepair?: boolean;
      trigger?: "safe-adapter" | "short-translation" | "safety-refusal";
    },
  ): Promise<false> {
    if (
      this.shouldStop(job, signal) ||
      this.pauseRequests.has(job.id) ||
      jobHasStatus(job, "paused")
    ) {
      return false;
    }

    const usedAttempts = boundedFreshChatRecoveryAttempts(
      job.freshChatRecoveryAttempts[segment.id],
    );
    if (usedAttempts >= MAX_AUTOMATIC_FRESH_CHAT_RECOVERY_ATTEMPTS) {
      return this.failSegment(job, segment, signal);
    }

    // A fresh chat does not grant an extra attempt. It continues exactly the
    // unused ordinary budget that remains after the safely failed send.
    const attemptLimit = input.normalMaximumAttempts;
    if (segment.attempts >= attemptLimit) {
      return this.failSegment(job, segment, signal);
    }

    const freshChatAttempt = usedAttempts + 1;
    job.freshChatRecoveryAttempts[segment.id] = freshChatAttempt;
    job.freshChatRecoveryAttemptLimits[segment.id] = attemptLimit;
    const preserveLocalizedRepair = input.preserveLocalizedRepair === true
      && hasLocalizedRepairState(segment);
    // A normal failed source request must never become a retry prompt in the
    // new conversation. A localized-Han hand-off is different: it deliberately
    // retains the completed translation and will send only its bad sentence.
    if (!preserveLocalizedRepair) {
      segment.translatedText = "";
      segment.validation = undefined;
    }
    segment.error = undefined;
    // Retain only the durable total-send budget. Local repairs are naturally
    // bounded by that same segment budget rather than a separate two-send cap.
    delete job.localizedHanRepairAttempts[segment.id];
    segment.status = "queued";
    job.status = "queued";
    job.error = undefined;
    job.currentSegmentIndex = segment.index;
    // The adapter owns cleanup of the previous tool-created chat. The next
    // run deliberately has no conversation state and receives only validated
    // completed output as continuity context.
    job.conversationInitialized = false;
    job.conversationHasBasePrompt = false;
    job.conversationRecoveryPending = job.segments.some(
      (candidate) => candidate.status === "completed" && Boolean(candidate.translatedText.trim()),
    );
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    if (this.shouldStop(job, signal) || this.pauseRequests.has(job.id) || jobHasStatus(job, "paused")) {
      return false;
    }
    this.emit(job.id, "job-status", { status: job.status });
    this.emit(job.id, "segment-retry", {
      segment: publicSegment(segment),
      kind: "fresh-chat",
      freshChatAttempt,
      maximumFreshChatAttempts: Math.max(0, input.normalMaximumAttempts - 1),
      normalMaximumAttempts: input.normalMaximumAttempts,
      maximumAttempts: attemptLimit,
      trigger: input.trigger ?? "safe-adapter",
    });
    return false;
  }

  /**
   * Reload the existing, verified ChatGPT page after a transient page error.
   * The failed send is already checkpointed; the next loop iteration resends
   * the same segment with the full retry prompt.
   */
  private async queuePageReloadRecovery(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (
      this.shouldStop(job, signal) ||
      this.pauseRequests.has(job.id) ||
      jobHasStatus(job, "paused") ||
      !this.dependencies.chatGpt.reloadForRecovery
    ) {
      return false;
    }

    const used = Math.min(
      Math.max(0, Math.trunc(job.pageReloadRecoveryAttempts[segment.id] ?? 0)),
      MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS,
    );
    if (used >= MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS) return false;

    try {
      await this.dependencies.chatGpt.reloadForRecovery();
    } catch (error) {
      // A reload itself failing means the current browser cannot be trusted.
      // Escalate directly to the restart tier instead of sending again in a
      // page whose state we could not reset.
      job.pageReloadRecoveryAttempts[segment.id] = MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS;
      segment.error = `Không thể tải lại trang ChatGPT: ${errorMessage(error)}`;
      job.updatedAt = nowIso();
      await this.checkpoint(job);
      return false;
    }

    job.pageReloadRecoveryAttempts[segment.id] = used + 1;
    segment.status = "retrying";
    segment.error = undefined;
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    if (this.shouldStop(job, signal)) return false;
    this.emit(job.id, "segment-retry", {
      segment: publicSegment(segment),
      kind: "page-reload",
      pageReloadAttempt: used + 1,
      maximumPageReloadAttempts: MAX_AUTOMATIC_PAGE_RELOAD_RECOVERY_ATTEMPTS,
      nextAttempt: segment.attempts + 1,
    });
    await this.waitBeforeRetry(segment.attempts, signal);
    return !this.shouldStop(job, signal);
  }

  /**
   * The ordinary retry budget was exhausted by actual browser/ChatGPT errors,
   * not by a bad translation. Close only the tool-owned browser, discard the
   * local chat pointer, then let launch() open a fresh browser and resend the
   * same checkpointed segment with the base prompt and recent valid context.
   */
  private async queueBrowserRestartRecovery(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
    input: {
      normalMaximumAttempts: number;
      trigger?: "page-reloads-exhausted" | "short-translation-after-fresh-chat";
    },
  ): Promise<false> {
    if (
      this.shouldStop(job, signal) ||
      this.pauseRequests.has(job.id) ||
      jobHasStatus(job, "paused")
    ) {
      return false;
    }

    const used = boundedFreshChatRecoveryAttempts(
      job.browserRestartRecoveryAttempts[segment.id],
    );
    if (used >= MAX_AUTOMATIC_BROWSER_RESTART_RECOVERY_ATTEMPTS) {
      return this.failSegment(job, segment, signal);
    }

    if (!this.dependencies.chatGpt.restartForRecovery) {
      // Keep an older adapter from turning a recoverable ownership-proof
      // failure into a terminal job. `sendAndWait()` has already stopped the
      // uncertain generation before this point; opening a fresh owned chat is
      // therefore safe and preserves the remaining ordinary retry budget.
      this.logActivity(
        job,
        "Không có khả năng khởi động lại browser; chuyển sang chat mới an toàn để gửi lại checkpoint.",
        "warning",
        segment,
      );
      return this.queueFreshChatRecovery(job, segment, signal, {
        normalMaximumAttempts: input.normalMaximumAttempts,
      });
    }

    try {
      await this.dependencies.chatGpt.restartForRecovery();
    } catch (error) {
      // Strict browser close can fail transiently on Windows. Do not abandon
      // a checkpoint merely because this optional escalation failed: leave
      // the old page alone and create a fresh owned chat for the same segment.
      this.logActivity(
        job,
        `Không thể khởi động lại browser (${errorMessage(error)}); chuyển sang chat mới an toàn để gửi lại checkpoint.`,
        "warning",
        segment,
      );
      return this.queueFreshChatRecovery(job, segment, signal, {
        normalMaximumAttempts: input.normalMaximumAttempts,
      });
    }

    job.browserRestartRecoveryAttempts[segment.id] = used + 1;
    this.logActivity(job, `Đã khởi động lại browser ${job.aiProvider === "kimi" ? "Kimi AI" : "ChatGPT"}; sẽ tạo chat mới và gửi lại checkpoint.`, "warning", segment);
    segment.translatedText = "";
    segment.validation = undefined;
    segment.error = undefined;
    segment.status = "queued";
    job.status = "queued";
    job.error = undefined;
    job.currentSegmentIndex = segment.index;
    job.conversationInitialized = false;
    job.conversationHasBasePrompt = false;
    job.conversationRecoveryPending = job.segments.some(
      (candidate) => candidate.status === "completed" && Boolean(candidate.translatedText.trim()),
    );
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    if (this.shouldStop(job, signal) || this.pauseRequests.has(job.id) || jobHasStatus(job, "paused")) {
      return false;
    }
    this.emit(job.id, "segment-retry", {
      segment: publicSegment(segment),
      kind: "browser-restart",
      browserRestartAttempt: used + 1,
      maximumBrowserRestartAttempts: MAX_AUTOMATIC_BROWSER_RESTART_RECOVERY_ATTEMPTS,
      maximumAttempts: input.normalMaximumAttempts,
      trigger: input.trigger ?? "page-reloads-exhausted",
    });
    return false;
  }

  private async repairLocalizedHan(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
    _maximumAttempts: number,
  ): Promise<LocalizedRepairOutcome> {
    return this.repairLocalizedHanBatch(job, segment, signal);
  }

  private async repairLocalizedHanBatch(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
  ): Promise<LocalizedRepairOutcome> {
    let localAttempts = job.localizedHanRepairAttempts[segment.id] ?? 0;
    // A small residual-Han repair is not a full retranslation.  It deserves
    // its own bounded budget even when the final full-segment attempt is the
    // one that exposed the one leaked character.  Otherwise a job can spend
    // all ordinary attempts and fail without ever asking ChatGPT to repair
    // the only bad sentence.
    // Local Han cleanup has a dedicated ceiling. It must not inherit the
    // much smaller full-segment retry budget: a valid translation with one
    // leaked character should keep asking for that exact sentence until it
    // is clean, but must still stop deterministically after ten attempts.
    const maximumLocalAttempts = MAX_LOCALIZED_HAN_REPAIR_ATTEMPTS;

    while (localAttempts < maximumLocalAttempts) {
      if (
        this.shouldStop(job, signal) ||
        this.pauseRequests.has(job.id) ||
        jobHasStatus(job, "paused")
      ) {
        return "stopped";
      }

      const validation = segment.validation;
      if (!validation) {
        segment.error = "Bản dịch không còn đủ điều kiện sửa chữ Hán cục bộ.";
        return "full-retry";
      }
      const targets = localizedHanTargets(segment.translatedText, validation, segment.id);
      if (!targets) {
        segment.error = "Bản dịch không còn đủ điều kiện sửa chữ Hán cục bộ.";
        return "full-retry";
      }

      localAttempts += 1;
      job.localizedHanRepairAttempts[segment.id] = localAttempts;
      segment.attempts += 1;
      const separateBasePrompt = localAttempts === 3;
      const prompt = this.localizedRepairPromptBuilder({
        basePrompt: job.resolvedPrompt,
        targets: targets.map((target) => ({ targetId: target.targetId, sentence: target.text })),
        attempt: localAttempts,
        hanSample: validation.hanCharacters.map((item) => item.character).join(""),
        // The first two local repairs repeat the base prompt in the same
        // message. On the third repair, prime the chat with the base prompt as
        // its own turn, then send only the still-faulty sentences below.
        includeBasePrompt: !separateBasePrompt,
      });
      job.conversationHasBasePrompt = true;
      const promptWithRecovery = separateBasePrompt
        ? prompt
        : this.withPendingRecoveryContext(job, prompt);
      const separateBasePromptWithRecovery = separateBasePrompt
        ? this.withPendingRecoveryContext(job, job.resolvedPrompt)
        : undefined;

      segment.status = "retrying";
      segment.error = undefined;
      job.updatedAt = nowIso();
      await this.checkpoint(job);
      if (this.shouldStop(job, signal)) return "stopped";
      this.emit(job.id, "segment-retry", {
        segment: publicSegment(segment),
        kind: "localized-han",
        targetIds: targets.map((target) => target.targetId),
        localAttempt: localAttempts,
        maximumAttempts: maximumLocalAttempts,
      });

      let retryUnsafe = false;
      let freshChatRecoveryRequested = false;
      try {
        segment.status = "streaming";
        await this.checkpoint(job);
        if (this.shouldStop(job, signal)) return "stopped";
        this.emit(job.id, "segment-status", { segment: publicSegment(segment) });
        if (separateBasePromptWithRecovery) {
          this.logActivity(
            job,
            `Lượt sửa chữ Hán thứ 3: đang gửi lại prompt gốc riêng trước khi gửi ${targets.length} câu lỗi.`,
            "warning",
            segment,
          );
          await this.dependencies.chatGpt.sendAndWait(separateBasePromptWithRecovery, {
            timeoutMs: job.settings.responseTimeoutMs,
            signal,
          });
          if (this.shouldStop(job, signal)) return "stopped";
          this.consumeRecoveryContext(job);
          job.updatedAt = nowIso();
          await this.checkpoint(job);
        }
        const response = await this.dependencies.chatGpt.sendAndWait(promptWithRecovery, {
          timeoutMs: job.settings.responseTimeoutMs,
          signal,
        });
        if (this.shouldStop(job, signal)) return "stopped";
        if (!separateBasePrompt) this.consumeRecoveryContext(job);

        segment.status = "validating";
        const parsed = localizedRepairBatchResponseError(response, targets);
        if (parsed.error) {
          segment.error = parsed.error;
        } else {
          segment.translatedText = replaceLocalizedTargets(
            segment.translatedText,
            targets,
            parsed.replacements ?? new Map(),
          );
          segment.validation = this.validator(
            segment.sourceText,
            segment.translatedText,
            job.settings.validation,
          );
          segment.error = segment.validation.valid
            ? undefined
            : segment.validation.issues.map((issue) => issue.message).join("; ");
        }
        job.updatedAt = nowIso();
        await this.checkpoint(job);
        if (this.shouldStop(job, signal)) return "stopped";
        this.emit(job.id, "segment-status", { segment: publicSegment(segment) });

        if (!parsed.error && segment.validation?.valid) return "completed";
        if (!parsed.error && segment.validation && !isLocalizedHanOnly(segment.validation)) {
          segment.error ||= "Câu sửa cục bộ làm bản dịch phát sinh lỗi kiểm tra khác.";
          return "full-retry";
        }
        this.logActivity(
          job,
          `Lượt sửa chữ Hán ${localAttempts}/${maximumLocalAttempts} vẫn lỗi: ${segment.error ?? "câu trả về chưa đạt kiểm tra"}. Sẽ gửi lại đúng câu lỗi.`,
          "warning",
          segment,
        );
      } catch (error) {
        if (this.shouldStop(job, signal) || isAbortError(error)) return "stopped";
        segment.error = errorMessage(error);
        freshChatRecoveryRequested = isSafeForFreshChatRecovery(error);
        retryUnsafe = !freshChatRecoveryRequested && isUnsafeToRetry(error);
        await this.checkpoint(job);
      }

      // Only the adapter's explicit safe marker may move a repair to a new
      // chat. Validation/output errors continue here and use normal retries.
      if (freshChatRecoveryRequested) return "fresh-chat";
      if (retryUnsafe) return "failed";
      await this.waitBeforeLocalizedHanRetry(signal);
    }

    segment.error ||= "Đã dùng hết số lần thử khi sửa chữ Hán cục bộ.";
    return "failed";
  }

  private async completeSegment(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
  ): Promise<boolean> {
    segment.status = "completed";
    segment.error = undefined;
    this.logActivity(job, `Đoạn ${segment.index + 1}/${job.segments.length} đạt kiểm tra và đã lưu checkpoint.`, "success", segment);
    delete job.localizedHanRepairAttempts[segment.id];
    delete job.freshChatRecoveryAttempts[segment.id];
    delete job.freshChatRecoveryAttemptLimits[segment.id];
    delete job.shortTranslationRecoveryAttempts[segment.id];
    delete job.browserRestartRecoveryAttempts[segment.id];
    delete job.pageReloadRecoveryAttempts[segment.id];
    this.clearSafetyRefusalRecovery(job, segment.id);
    this.rebuildTranslation(job);
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    if (this.shouldStop(job, signal)) return false;
    this.emit(job.id, "segment-completed", {
      segment: publicSegment(segment),
      translatedText: job.translatedText,
    });
    return true;
  }

  private async failSegment(
    job: PersistedTranslationJob,
    segment: TranslationSegment,
    signal: AbortSignal,
  ): Promise<false> {
    if (
      this.shouldStop(job, signal) ||
      this.pauseRequests.has(job.id) ||
      jobHasStatus(job, "paused")
    ) {
      return false;
    }
    segment.status = "failed";
    delete job.localizedHanRepairAttempts[segment.id];
    job.status = "failed";
    job.error = `Đoạn ${segment.index + 1} lỗi sau ${segment.attempts} lần thử: ${segment.error ?? "không rõ lỗi"}`;
    this.logActivity(job, job.error, "error", segment);
    job.updatedAt = nowIso();
    await this.checkpoint(job);
    if (this.shouldStop(job, signal)) return false;
    this.emit(job.id, "segment-failed", {
      segment: publicSegment(segment),
      error: job.error,
    });
    this.emit(job.id, "job-failed", { error: job.error, job: this.publicJob(job) });
    return false;
  }

  private async waitBeforeRetry(attempts: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Đã hủy tác vụ.", "AbortError"));
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, Math.min(3_000, 500 * 2 ** (attempts - 1)));
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async waitBeforeLocalizedHanRetry(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Đã hủy tác vụ.", "AbortError"));
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, 250);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private withPendingRecoveryContext(
    job: PersistedTranslationJob,
    prompt: string,
  ): string {
    if (!job.conversationRecoveryPending) return prompt;
    const context = this.buildRecoveryContext(job);
    return context ? `${context}\n\n---\n${prompt}` : prompt;
  }

  private consumeRecoveryContext(job: PersistedTranslationJob): void {
    if (job.conversationRecoveryPending) job.conversationRecoveryPending = false;
  }

  private hasSafetyRefusalRecovery(job: PersistedTranslationJob, segmentId: string): boolean {
    return Boolean(job.safetyRefusalContextPending[segmentId]) ||
      (job.safetyRefusalPromptAttempts[segmentId] ?? 0) > 0 ||
      (job.safetyRefusalFreshChatAttempts[segmentId] ?? 0) > 0;
  }

  private withSafetyRefusalContext(
    job: PersistedTranslationJob,
    segmentId: string,
    prompt: string,
  ): string {
    if (!job.safetyRefusalContextPending[segmentId]) return prompt;
    return `${SAFETY_TRANSLATION_CONTEXT_PROMPT}\n\n---\n${prompt}`;
  }

  private consumeSafetyRefusalContext(job: PersistedTranslationJob, segmentId: string): void {
    delete job.safetyRefusalContextPending[segmentId];
  }

  private clearSafetyRefusalRecovery(job: PersistedTranslationJob, segmentId: string): void {
    delete job.safetyRefusalPromptAttempts[segmentId];
    delete job.safetyRefusalFreshChatAttempts[segmentId];
    delete job.safetyRefusalContextPending[segmentId];
  }

  private buildRecoveryContext(job: PersistedTranslationJob): string {
    const latestCompleted = [...job.segments]
      .filter((segment) => segment.status === "completed" && segment.translatedText.trim())
      .sort((left, right) => left.index - right.index)
      .at(-1);
    const previous = latestCompleted?.translatedText.trim() ?? "";
    if (!previous) return "";

    // Keep at most 3k characters. The most recent tail is enough to recover
    // names, pronouns and current tone without replaying the whole book.
    const tailLength = Math.min(3_000, previous.length);
    let tail = previous.slice(-tailLength).trimStart();
    if (tail.length < previous.length) {
      const cleanBoundary = tail.search(/(?<=[.!?。！？])\s+|\n/u);
      if (cleanBoundary >= 0 && cleanBoundary < 200) {
        tail = tail.slice(cleanBoundary).trimStart();
      }
    }
    if (!tail) return "";

    return `NGỮ CẢNH KHÔI PHỤC CHO CHAT MỚI (KHÔNG DỊCH LẠI):\n- Dùng phần đuôi dưới đây chỉ để giữ nhất quán tên riêng, cách xưng hô, thuật ngữ và giọng văn.\n- Không lặp lại phần ngữ cảnh này trong câu trả lời.\n<DUOI_BAN_DICH_TRUOC segment="${latestCompleted?.id ?? "unknown"}">\n${tail}\n</DUOI_BAN_DICH_TRUOC>`;
  }

  private async requireJob(id: string): Promise<PersistedTranslationJob> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) {
      throw new TypeError("Mã tác vụ không hợp lệ.");
    }
    let job = this.jobs.get(id);
    if (!job) {
      job = (await this.dependencies.persistence.loadJob<PersistedTranslationJob>(id)) ?? undefined;
      if (job) {
        job.localizedHanRepairAttempts ??= {};
        job.freshChatRecoveryAttempts ??= {};
        job.freshChatRecoveryAttemptLimits ??= {};
        job.shortTranslationRecoveryAttempts ??= {};
        job.browserRestartRecoveryAttempts ??= {};
        job.pageReloadRecoveryAttempts ??= {};
        job.safetyRefusalPromptAttempts ??= {};
        job.safetyRefusalFreshChatAttempts ??= {};
        job.safetyRefusalContextPending ??= {};
        job.activityLog ??= [];
        upgradeLegacyWebTimeout(job);
        job.conversationInitialized = false;
        job.conversationHasBasePrompt = false;
        job.conversationRecoveryPending = job.segments.some(
          (segment) => segment.status === "completed" && Boolean(segment.translatedText.trim()),
        );
        if (job.status === "running" || job.status === "queued") job.status = "paused";
        this.jobs.set(id, job);
      }
    }
    if (!job) throw new Error("Không tìm thấy tác vụ dịch.");
    return job;
  }

  private assertNoOtherActiveJob(exceptId?: string): void {
    const conflict = [...this.jobs.values()].find(
      (job) => job.id !== exceptId && ["queued", "running", "paused"].includes(job.status),
    );
    if (conflict) throw new Error("Hãy hoàn tất hoặc hủy tác vụ dịch hiện tại trước.");
  }

  /**
   * `launch()` records a job-level failure when ChatGPT readiness or creating
   * a conversation fails.  In that case no individual segment has failed and
   * the next durable segment is still queued, so retrying a fabricated
   * "failed segment" would be both impossible and misleading.  Keep the
   * ordinary per-segment retry path for any real failed/cancelled segment.
   */
  private canResumeLifecycleFailure(job: PersistedTranslationJob): boolean {
    return (
      job.segments.some((segment) => segment.status === "queued") &&
      !job.segments.some(
        (segment) => segment.status === "failed" || segment.status === "cancelled",
      )
    );
  }

  private rebuildTranslation(job: PersistedTranslationJob): void {
    job.translatedText = job.segments
      .filter((segment) => segment.status === "completed" && segment.translatedText)
      .map((segment) => segment.translatedText.trim())
      .join("\n\n");
  }

  private shouldStop(job: PersistedTranslationJob, signal: AbortSignal): boolean {
    return signal.aborted || this.cancelRequests.has(job.id) || jobHasStatus(job, "cancelled");
  }

  private async checkpoint(job: PersistedTranslationJob): Promise<void> {
    job.updatedAt = nowIso();
    await this.dependencies.persistence.saveJob(job);
  }

  private logActivity(
    job: PersistedTranslationJob,
    message: string,
    tone: TranslationActivityTone = "info",
    segment?: Pick<TranslationSegment, "id" | "index">,
  ): void {
    job.activityLog ??= [];
    const entry: TranslationActivityEntry = {
      at: nowIso(),
      tone,
      message,
      ...(segment ? { segmentId: segment.id, segmentIndex: segment.index } : {}),
    };
    job.activityLog.push(entry);
    if (job.activityLog.length > MAX_ACTIVITY_LOG_ENTRIES) {
      job.activityLog.splice(0, job.activityLog.length - MAX_ACTIVITY_LOG_ENTRIES);
    }
    this.emit(job.id, "activity-log", { entry });
  }

  private emit(jobId: string, type: TranslationEvent["type"], payload?: unknown): void {
    this.emitter.emit("event", { jobId, type, timestamp: Date.now(), payload } satisfies TranslationEvent);
  }

  private publicJob(job: PersistedTranslationJob): TranslationJob {
    return {
      id: job.id,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      status: job.status,
      aiProvider: job.aiProvider,
      promptMode: job.promptMode,
      ...(job.customPrompt ? { customPrompt: job.customPrompt } : {}),
      resolvedPrompt: job.resolvedPrompt,
      sourceText: job.sourceText,
      translatedText: job.translatedText,
      segments: job.segments.map(publicSegment),
      ...(job.currentSegmentIndex === undefined ? {} : { currentSegmentIndex: job.currentSegmentIndex }),
      ...(job.error ? { error: job.error } : {}),
      ...(job.autoExport ? { autoExport: { ...job.autoExport, sourceChapterNumbers: [...job.autoExport.sourceChapterNumbers] } } : {}),
      ...(job.activityLog?.length ? { activityLog: job.activityLog.map((entry) => ({ ...entry })) } : {}),
    };
  }

  private snapshot(job: PersistedTranslationJob, includeOutput: boolean): TranslationJobSnapshot {
    return {
      id: job.id,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      status: job.status,
      aiProvider: job.aiProvider,
      totalSegments: job.segments.length,
      completedSegments: job.segments.filter((segment) => segment.status === "completed").length,
      segments: job.segments.map((segment) => ({
        id: segment.id,
        index: segment.index,
        status: segment.status,
        ...(segment.error ? { error: segment.error } : {}),
      })),
      ...(job.currentSegmentIndex === undefined ? {} : { currentSegmentIndex: job.currentSegmentIndex }),
      ...(job.error ? { error: job.error } : {}),
      ...(job.autoExport ? { autoExport: { ...job.autoExport, sourceChapterNumbers: [...job.autoExport.sourceChapterNumbers] } } : {}),
      ...(job.activityLog?.length ? { activityLog: job.activityLog.map((entry) => ({ ...entry })) } : {}),
      // A full job lookup is a recovery operation, not the 1.5-second progress
      // poll. Returning the accumulated completed segments here means a window
      // refresh or a pause never loses the already validated part of a book.
      ...(includeOutput ? { translatedText: job.translatedText, sourceText: job.sourceText } : {}),
    };
  }
}
