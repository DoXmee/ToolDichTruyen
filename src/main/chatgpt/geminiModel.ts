/**
 * Gemini exposes several models behind one picker. Translation work runs on the
 * newest **Pro** model and nowhere else.
 *
 * Live menu labels observed on gemini.google.com (Vietnamese interface):
 *   "3.5 Flash-Lite — Câu trả lời nhanh nhất"
 *   "3.8 Flash — Trợ giúp toàn diện"
 *   "3.1 Pro — Suy luận nâng cao"
 *   "Tư duy mở rộng — Giải quyết vấn đề phức tạp"
 *
 * The last entry is a Pro-tier thinking mode but it is not named Pro, so it is
 * deliberately not treated as one. When the account offers no Pro entry at all
 * the check reports an error instead of silently translating on another model:
 * a wrong model changes both the wording and the safety behaviour of the reply.
 */

const PRO = /\bpro\b/iu;
const FLASH = /flash/iu;
const LITE = /lite/iu;

/** True only for a model that names itself a Pro model. */
export function isProModelLabel(label: string): boolean {
  if (FLASH.test(label) || LITE.test(label)) return false;
  return PRO.test(label);
}

export function proModelVersion(label: string): number {
  const match = /(\d+(?:\.\d+)?)\s*pro/iu.exec(label) ?? /(\d+(?:\.\d+)?)/u.exec(label);
  const version = match ? Number.parseFloat(match[1] ?? "") : Number.NaN;
  return Number.isFinite(version) ? version : 0;
}

/**
 * Reads the current model out of the picker button's aria-label, which Google
 * keeps explicit on every variant we have seen:
 *   "Mở công cụ chọn chế độ, hiện tại là Gemini Pro"
 *   "Mở công cụ chọn chế độ, hiện tại là Flash"
 */
export function currentModelFromAriaLabel(ariaLabel: string): string {
  const label = (ariaLabel ?? "").trim();
  if (!label) return "";
  const explicit = /(?:hiện tại là|currently)[:\s]+(.+)$/iu.exec(label);
  if (explicit?.[1]?.trim()) return explicit[1].trim();
  // Fallback for other interface languages: the trailing segment usually names
  // the model, but only trust it when it actually names one.
  const tail = label.split(/[,:]/u).map((part) => part.trim()).filter(Boolean).pop() ?? "";
  return /pro|flash|lite|ultra/iu.test(tail) ? tail : "";
}

/**
 * The chip text is a second-best source. Newer layouts render the brand and the
 * model on one line ("Gemini Pro") while the short label element can hold just
 * the brand ("Gemini"), which names no model at all.
 */
export function normalizeModelChipText(value: string): string {
  const line = (value ?? "")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  if (!line) return "";
  if (/^(?:gemini|google)(?:\s+ai)?$/iu.test(line)) return "";
  return line;
}

/**
 * Index of the newest Pro entry, or undefined when the list offers none. Ties
 * keep the first entry so the picker's own ordering wins.
 */
export function chooseNewestProModel(labels: readonly string[]): number | undefined {
  let bestIndex: number | undefined;
  let bestVersion = -1;
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (label === undefined || !isProModelLabel(label)) continue;
    const version = proModelVersion(label);
    if (version > bestVersion) {
      bestVersion = version;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export interface GeminiModelOption {
  label: string;
  /** Gemini greys out models whose quota is used up for the moment. */
  disabled?: boolean;
  select: () => Promise<void>;
}

/** Everything the model check needs from the page, so it can be tested alone. */
export interface GeminiModelDriver {
  currentLabel: () => Promise<string>;
  openMenu: () => Promise<void>;
  options: () => Promise<GeminiModelOption[]>;
  closeMenu: () => Promise<void>;
}

export interface GeminiModelResult {
  changed: boolean;
  model: string;
}

/**
 * Raised when Gemini greys out the Pro models because the account's advanced
 * quota is used up. It carries a ready-to-show notice, including the reset time
 * Gemini prints next to the locked entry, so the runner can explain the wait
 * instead of reporting a browser click failure.
 */
export class GeminiQuotaExceededError extends Error {
  public readonly notice: string;

  public constructor(notice: string) {
    super(notice);
    this.name = "GeminiQuotaExceededError";
    this.notice = notice;
  }
}

/** Turns "3.1 Pro Hạn mức sẽ được đặt lại vào15:13 20 thg 9" into a sentence. */
export function quotaNoticeForLockedModel(label: string): string {
  const cleaned = label.replace(/\s+/gu, " ").replace(/vào(\d)/gu, "vào $1").trim();
  const match = /^(.*?)\s*(Hạn mức.*)$/iu.exec(cleaned);
  const name = (match?.[1] ?? cleaned).trim();
  const reset = (match?.[2] ?? "").trim();
  return `Gemini đã hết hạn mức dùng model cao (${name}).`
    + (reset ? ` ${reset}.` : "")
    + " Hãy thử lại sau thời điểm đó, hoặc để tiến trình chuyển sang AI khác nếu có.";
}

/**
 * Reads the reset moment out of the notice Gemini prints next to a locked
 * model, e.g. "Hạn mức sẽ được đặt lại vào15:13 20 thg 9". Returns an ISO time,
 * or undefined when the wording cannot be understood.
 */
export function parseQuotaResetAt(text: string, now: Date = new Date()): string | undefined {
  const match = /(\d{1,2}):(\d{2})\s*(\d{1,2})\s*(?:thg|tháng)\s*(\d{1,2})/iu.exec(text);
  if (!match) return undefined;
  const [, hours, minutes, day, month] = match;
  const date = new Date(
    now.getFullYear(),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    0,
    0,
  );
  if (Number.isNaN(date.getTime())) return undefined;
  // A reset time that already passed must belong to tomorrow, not last month.
  if (date.getTime() < now.getTime() - 24 * 60 * 60_000) date.setFullYear(now.getFullYear() + 1);
  return date.toISOString();
}

function describeSeen(models: readonly string[]): string {
  return models.length ? models.join(" | ") : "không đọc được mục nào";
}

/**
 * Moves the picker to the newest Pro model. Unlike the earlier Flash policy
 * this refuses to continue on another model: every failure path throws with the
 * models it actually saw, because translating on the wrong model is worse than
 * reporting the problem.
 */
export async function ensureProModel(driver: GeminiModelDriver): Promise<GeminiModelResult> {
  const current = (await driver.currentLabel()).trim();
  if (isProModelLabel(current)) return { changed: false, model: current };

  try {
    await driver.openMenu();
  } catch (error) {
    throw new Error(
      `Không mở được bảng chọn model của Gemini để chuyển sang Pro `
      + `(model hiện tại: "${current || "không rõ"}").`,
      { cause: error },
    );
  }

  const options = await driver.options();
  if (!options.length) {
    await driver.closeMenu().catch(() => undefined);
    throw new Error(
      "Không đọc được danh sách model của Gemini sau khi mở bảng chọn, "
      + "nên chưa xác nhận được model Pro.",
    );
  }

  const targetIndex = chooseNewestProModel(options.map((option) => option.label));
  if (targetIndex === undefined) {
    await driver.closeMenu().catch(() => undefined);
    throw new Error(
      "Tài khoản Gemini này không có model Pro nào để chọn. "
      + `Tool thấy: ${describeSeen(options.map((option) => option.label))}.`,
    );
  }

  const target = options[targetIndex]!;
  if (target.disabled) {
    await driver.closeMenu().catch(() => undefined);
    throw new GeminiQuotaExceededError(quotaNoticeForLockedModel(target.label));
  }
  await target.select();
  const applied = (await driver.currentLabel()).trim();
  if (!isProModelLabel(applied)) {
    await driver.closeMenu().catch(() => undefined);
    throw new Error(
      `Đã chọn "${target.label}" nhưng Gemini vẫn báo model hiện tại là "${applied || "không rõ"}". `
      + "Tool dừng để không dịch bằng model ngoài Pro.",
    );
  }
  return { changed: true, model: applied };
}
