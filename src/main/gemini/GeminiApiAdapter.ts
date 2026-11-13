import { EventEmitter } from "node:events";
import type { SendMessageOptions } from "../chatgpt/ChatGptWebAdapter.js";
import type { GeminiKeyTestResult, GeminiKeyQuotaInfo } from "../../shared/types.js";

export interface GeminiApiAdapterOptions {
  apiKeys?: string[];
  model?: string;
  batchChaptersCount?: number;
}

export interface GeminiApiStatusSnapshot {
  status: "idle" | "ready" | "busy" | "error";
  message?: string;
  activeKeyMasked?: string;
  totalKeys?: number;
  model?: string;
}

interface KeyUsageRecord {
  usedToday: number;
  lastDate: string;
  lastStatus: "ready" | "quota_exceeded" | "blocked" | "error" | "untested";
  lastMessage?: string;
  serviceTier?: string;
}

export const DEFAULT_GEMINI_KEYS: string[] = [];

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const SUPPORTED_GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite (Khuyên dùng - 500 lượt/ngày)" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite (Dự phòng - 500 lượt/ngày)" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Bản chất lượng cao - 20 lượt/ngày)" },
];

export const PURE_VIETNAMESE_SYSTEM_INSTRUCTION = `Bạn là chuyên gia dịch thuật văn học Trung - Việt hàng đầu. Nhiệm vụ của bạn là chuyển ngữ tác phẩm sang tiếng Việt một cách thuần Việt, tự nhiên, mượt mà và giàu cảm xúc văn học.
Tuyệt đối tuân thủ các quy tắc bất di bất dịch sau:
1. Thuần Việt 100% & Không sót tiếng Trung: Diễn đạt trôi chảy theo thói quen ngôn ngữ và phong cách văn học của người Việt. Loại bỏ hoàn toàn các cấu trúc câu gượng gạo, thô cứng của tiếng Hán (tuyệt đối không lạm dụng các từ: đích, ngay tại, đem, liền, chẳng qua là, bất quá...). Tuyệt đối không để sót bất kỳ chữ Hán nào trong bản dịch.
2. Xưng hô thân tộc thuần Việt chuẩn mực: Sử dụng linh hoạt, chuẩn xác các danh xưng gia đình thuần Việt (Bố, Mẹ, Ông, Bà, Bác, Chú, Cô, Dì, Thím, Cậu, Mợ, Anh, Chị, Em...). Giữ vững tính nhất quán của vai vế thân tộc theo đúng quan hệ nhân vật trong phân cảnh, không tự ý thay đổi lộn xộn.
3. Cấm tuyệt đối từ ngữ ngoại lai: Tuyệt đối không sử dụng từ tiếng Anh trong bản dịch (ví dụ: cấm dùng "instant", phải dịch là "ngay lập tức" hoặc "tức thì").
4. Cấm tuyệt đối tiếng lóng viết tắt thô tục: Cấm dùng từ viết tắt kiểu mạng xã hội (như "cmn", "đm"; phải dịch chuẩn văn học thành "mẹ kiếp", "chết tiệt", "khốn khiếp").
5. Cấm để lọt âm Pinyin: Phiên âm tên riêng và danh từ phải dùng 100% âm Hán Việt chuẩn xác (CẤM âm Pinyin như "Gang" -> phải là "Cương"; "Ming" -> phải là "Minh").
6. Liền mạch câu văn & Chuẩn hóa dấu câu: Tuyệt đối không ngắt dòng vỡ đôi câu văn sau dấu phẩy (,) phỏng theo ngắt dòng lỗi của web nguồn Trung Quốc. Ghép các vế câu liền mạch thành đoạn văn trọn vẹn. Cặp dấu ngoặc kép đối thoại “ ” phải mở và đóng đầy đủ, cân xứng.
7. Trọn vẹn nội dung & Tiêu đề chương: Dịch đầy đủ 100% không tóm tắt, giữ nguyên vẹn tiêu đề và ranh giới từng chương (ví dụ "Chương N: [Tiêu đề]" và "Chương N+1: [Tiêu đề]").
8. Định dạng đầu ra: Chỉ trả về nội dung bản dịch tiếng Việt bên trong thẻ <BAN_DICH id="...">...</BAN_DICH>, không kèm bất kỳ lời chào, giải thích hoặc lời bình ngoài truyện.`;

function maskKey(key?: string): string {
  if (!key || key.length < 10) return "...";
  return key.slice(0, 7) + "..." + key.slice(-4);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("Tác vụ dịch đã bị hủy."));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Tác vụ dịch đã bị hủy."));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class GeminiApiAdapter {
  private keys: string[] = [];
  private activeKeyIndex = 0;
  private currentModel: string = DEFAULT_GEMINI_MODEL;
  private configuredModel: string = DEFAULT_GEMINI_MODEL;
  private batchChapters: number = 2;
  private abortController?: AbortController;
  private readonly emitter = new EventEmitter();
  private currentStatus: "idle" | "ready" | "busy" | "error" = "ready";
  private statusMessage?: string;
  private readonly keyUsageMap = new Map<string, KeyUsageRecord>();

  private getTodayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private getUsage(key: string): KeyUsageRecord {
    const today = this.getTodayString();
    let record = this.keyUsageMap.get(key);
    if (!record || record.lastDate !== today) {
      record = {
        usedToday: record && record.lastDate === today ? record.usedToday : 0,
        lastDate: today,
        lastStatus: record ? record.lastStatus : "untested",
        lastMessage: record ? record.lastMessage : undefined,
        serviceTier: record ? record.serviceTier : undefined,
      };
      this.keyUsageMap.set(key, record);
    }
    return record;
  }

  private recordKeySuccess(key: string): void {
    const usage = this.getUsage(key);
    usage.usedToday += 1;
    usage.lastStatus = "ready";
  }

  private recordKeyError(key: string, status: "quota_exceeded" | "blocked" | "error", message: string): void {
    const usage = this.getUsage(key);
    usage.lastStatus = status;
    usage.lastMessage = message;
  }

  public constructor(options: GeminiApiAdapterOptions = {}) {
    this.keys = (options.apiKeys && options.apiKeys.length > 0)
      ? options.apiKeys.filter((k) => k && k.trim().length > 5)
      : [...DEFAULT_GEMINI_KEYS];
    this.configuredModel = options.model?.trim() || DEFAULT_GEMINI_MODEL;
    this.currentModel = this.configuredModel;
    this.batchChapters = options.batchChaptersCount ?? 2;
    this.updateStatus("ready", `API sẵn sàng (${this.keys.length} key - ${this.currentModel})`);
  }

  public getKeys(): string[] {
    return [...this.keys];
  }

  public setKeys(newKeys: string[]): void {
    const valid = newKeys.map((k) => k.trim()).filter((k) => k.length > 5);
    this.keys = valid.length > 0 ? valid : [...DEFAULT_GEMINI_KEYS];
    this.activeKeyIndex = 0;
    this.updateStatus("ready", `Đã cập nhật ${this.keys.length} API key (${this.currentModel})`);
  }

  public getModel(): string {
    return this.currentModel;
  }

  public setModel(model: string): void {
    if (model && model.trim()) {
      this.configuredModel = model.trim();
      this.currentModel = this.configuredModel;
      this.updateStatus("ready", `Đã chọn model ${this.currentModel} (${this.keys.length} key)`);
    }
  }

  public getBatchChaptersCount(): number {
    return this.batchChapters;
  }

  public setBatchChaptersCount(count: number): void {
    this.batchChapters = Math.max(1, Math.min(5, Math.trunc(count) || 2));
  }

  public async ensureReady(): Promise<void> {
    if (this.keys.length === 0) {
      this.updateStatus("error", "Chưa có API key nào.");
      throw new Error("Chưa có API key Gemini hợp lệ.");
    }
  }

  public async startNewConversation(): Promise<void> {
    // Stateless API: Reset any ongoing request state
    this.abortController = undefined;
  }

  public cancelGeneration(): void {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // Ignore abort race errors
      }
      this.abortController = undefined;
    }
    this.updateStatus("ready", `Đã dừng lượt dịch.`);
  }

  public status(): GeminiApiStatusSnapshot {
    return {
      status: this.currentStatus,
      message: this.statusMessage,
      activeKeyMasked: this.keys[this.activeKeyIndex] ? maskKey(this.keys[this.activeKeyIndex]) : undefined,
      totalKeys: this.keys.length,
      model: this.currentModel,
    };
  }

  public onStatus(listener: (snapshot: GeminiApiStatusSnapshot) => void): () => void {
    this.emitter.on("status", listener);
    return () => this.emitter.off("status", listener);
  }

  private updateStatus(status: "idle" | "ready" | "busy" | "error", message?: string): void {
    this.currentStatus = status;
    this.statusMessage = message;
    this.emitter.emit("status", this.status());
  }

  /**
   * Sends the prompt to Gemini REST API with automated key-pool rotation on quota/rate limits.
   */
  public async sendAndWait(message: string, options: SendMessageOptions = {}): Promise<string> {
    await this.ensureReady();
    if (!message || message.trim().length === 0) {
      throw new TypeError("Nội dung gửi Gemini API không được để trống.");
    }

    this.updateStatus("busy", `Đang gửi bản dịch qua Gemini API (${this.currentModel})...`);
    this.abortController = new AbortController();

    const signal = options.signal
      ? AbortSignal.any([options.signal, this.abortController.signal])
      : this.abortController.signal;

    const maxAttempts = Math.max(this.keys.length * 4, 8);
    let attempts = 0;
    let highDemandAttempts = 0;
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      if (signal.aborted) {
        throw new Error("Tác vụ dịch đã bị hủy.");
      }

      const currentKey = this.keys[this.activeKeyIndex] || this.keys[0];
      if (!currentKey) {
        throw new Error("Không có API key nào khả dụng.");
      }
      attempts += 1;

      try {
        const result = await this.callGeminiApi(currentKey, this.currentModel, message, signal);
        this.recordKeySuccess(currentKey);
        this.updateStatus("ready", `Dịch xong lượt với key ${maskKey(currentKey)} (${this.currentModel})`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errMessage = lastError.message || "";

        // Check if error is related to quota, rate limit, high demand, or forbidden project
        const isQuotaOrRateLimit = /429|quota|RESOURCE_EXHAUSTED|rateLimitExceeded/iu.test(errMessage);
        const isHighDemand = /503|high demand|overloaded|spikes in demand|timeout|fetch failed|ECONNRESET/iu.test(errMessage);
        const isProjectDisabled = /403|free tier is not available|PERMISSION_DENIED/iu.test(errMessage);

        const errorDetails = (lastError as any).details as Array<any> | undefined;
        const violations = errorDetails?.find((d) => d["@type"]?.includes("QuotaFailure"))?.violations;
        const violation = violations?.[0];
        const retryInfo = errorDetails?.find((d) => d["@type"]?.includes("RetryInfo"));
        const retryDelayStr = retryInfo?.retryDelay || "";
        const retrySec = parseInt(retryDelayStr, 10) || 0;
        const isMinuteLimit = violation?.quotaMetric?.includes("minute")
          || /per minute/i.test(violation?.description || "")
          || /per minute/i.test(errMessage)
          || (retrySec > 0 && retrySec <= 60);

        if (isQuotaOrRateLimit) {
          const quotaLimit = Number(violation?.quotaValue) || (this.currentModel.includes("2.5-flash") && !this.currentModel.includes("lite") ? 20 : 500);
          this.recordKeyError(currentKey, "quota_exceeded", isMinuteLimit ? "Chạm hạn mức phút (15 RPM)" : `Hết hạn mức ngày (${quotaLimit} RPD)`);
        } else if (isProjectDisabled) {
          this.recordKeyError(currentKey, "blocked", "Chưa bật Free Tier (403)");
        }

        // 1. Minute limit (15 RPM): If multiple keys, rotate key immediately without delay
        if (isMinuteLimit && isQuotaOrRateLimit && this.keys.length > 1) {
          const prevKeyMasked = maskKey(currentKey);
          this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
          const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
          this.updateStatus(
            "busy",
            `Key ${prevKeyMasked} chạm 15 RPM. Tự động đổi sang key ${nextKeyMasked} và tiếp tục...`,
          );
          await delay(600, signal);
          continue;
        }

        // If single key hit per-minute limit (RPM), cool down for 15s instead of crashing
        if (isMinuteLimit && attempts < maxAttempts) {
          const waitTime = Math.min(Math.max(retrySec, 15), 30);
          this.updateStatus("busy", `Chạm hạn mức 15 RPM. Tự động tạm nghỉ ${waitTime}s để hạ nhiệt rồi dịch tiếp...`);
          await delay(waitTime * 1000, signal);
          continue;
        }

        // 2. Daily Quota exhausted (RPD limit):
        // Strategy: 3.5-flash-lite (500) -> 3.1-flash-lite (500) on same key -> then rotate to next key!
        if (isQuotaOrRateLimit && !isMinuteLimit) {
          if (this.currentModel === "gemini-3.5-flash-lite") {
            this.currentModel = "gemini-3.1-flash-lite";
            this.updateStatus(
              "busy",
              `Key ${maskKey(currentKey)} hết 500 lượt của 3.5. Tự động chuyển sang Gemini 3.1 Flash-Lite (thêm 500 lượt) trên cùng key...`,
            );
            await delay(800, signal);
            continue;
          }

          if (this.currentModel === "gemini-3.1-flash-lite" && this.keys.length > 1) {
            const prevKeyMasked = maskKey(currentKey);
            this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
            this.currentModel = this.configuredModel; // Reset back to configured model for the fresh new key!
            const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
            this.updateStatus(
              "busy",
              `Key ${prevKeyMasked} đã dùng hết cả 1,000 lượt (3.5 & 3.1). Tự động xoay sang key ${nextKeyMasked} với ${this.currentModel}...`,
            );
            await delay(800, signal);
            continue;
          }

          if (this.currentModel !== "gemini-2.5-flash" && this.keys.length === 1) {
            this.currentModel = "gemini-2.5-flash";
            this.updateStatus("busy", `Hết 1,000 lượt 3.5/3.1. Chuyển sang Gemini 2.5 Flash và gửi lại...`);
            await delay(800, signal);
            continue;
          }
        }

        // 3. High demand / server overloaded (503, spikes in demand, timeout, network reset)
        if (isHighDemand) {
          highDemandAttempts += 1;
          const waitSec = Math.min(2 + highDemandAttempts * 2, 12);
          const prevKeyMasked = maskKey(currentKey);

          // If current model is 3.5 Flash-Lite and high demand persists (>= 2 attempts or single key),
          // fallback to 3.1 Flash-Lite (runs on independent cluster)
          if (this.currentModel === "gemini-3.5-flash-lite" && (highDemandAttempts >= 2 || this.keys.length <= 1)) {
            this.currentModel = "gemini-3.1-flash-lite";
            this.updateStatus(
              "busy",
              `Cụm máy chủ 3.5 Flash-Lite quá tải (503). Tự động chuyển sang Gemini 3.1 Flash-Lite (nghỉ ${waitSec}s) và gửi lại...`,
            );
            await delay(waitSec * 1000, signal);
            continue;
          }

          if (this.currentModel === "gemini-3.1-flash-lite" && highDemandAttempts >= 4) {
            this.currentModel = "gemini-2.5-flash";
            this.updateStatus(
              "busy",
              `Cụm máy chủ Flash-Lite quá tải (503). Tự động chuyển sang Gemini 2.5 Flash (nghỉ ${waitSec}s) và gửi lại...`,
            );
            await delay(waitSec * 1000, signal);
            continue;
          }

          if (this.keys.length > 1) {
            this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
            const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
            this.updateStatus(
              "busy",
              `Máy chủ Google quá tải (503) với key ${prevKeyMasked}. Đổi sang key ${nextKeyMasked}, tạm nghỉ ${waitSec}s rồi gửi lại...`,
            );
            await delay(waitSec * 1000, signal);
            continue;
          } else {
            this.updateStatus(
              "busy",
              `Máy chủ Google tạm thời quá tải (503). Tạm nghỉ ${waitSec}s để hạ nhiệt rồi gửi lại (lần ${attempts}/${maxAttempts})...`,
            );
            await delay(waitSec * 1000, signal);
            continue;
          }
        }

        // 4. Project disabled / forbidden (403)
        if (isProjectDisabled && this.keys.length > 1) {
          const prevKeyMasked = maskKey(currentKey);
          this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
          const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
          this.updateStatus(
            "busy",
            `Key ${prevKeyMasked} chưa mở free tier (403). Tự động đổi sang key ${nextKeyMasked} và gửi lại...`,
          );
          await delay(800, signal);
          continue;
        }

        // Fatal non-retryable error
        this.updateStatus("error", `Lỗi Gemini API: ${errMessage}`);
        throw lastError;
      }
    }

    this.updateStatus("error", `Đã thử tất cả API key nhưng đều báo bận/hết hạn mức.`);
    throw lastError || new Error("Không thể hoàn tất lượt dịch qua Gemini API.");
  }

  private async callGeminiApi(
    key: string,
    model: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    const isAnalysisOrScout = /^\[TDT_(?:SCOUT|V3_ANALYSIS)\]/u.test(prompt) || prompt.startsWith('[TDT_V3_ANALYSIS]');
    const isLocalizedRepair = prompt.includes('<CAU_CAN_SUA>') || prompt.includes('SỬA CỤC BỘ');

    let systemText = PURE_VIETNAMESE_SYSTEM_INSTRUCTION;
    if (isAnalysisOrScout) {
      systemText = "Bạn là chuyên gia phân tích và trinh sát nội dung truyện. Tuân thủ tuyệt đối cấu trúc JSON trong prompt. CHỈ trả về duy nhất 1 khối JSON hợp lệ theo định dạng yêu cầu, tuyệt đối KHÔNG dịch văn bản, KHÔNG xuất thẻ HTML và KHÔNG thêm lời chào.";
    } else if (isLocalizedRepair) {
      systemText = "Bạn là chuyên gia dịch thuật và biên tập văn học Trung - Việt. Nhiệm vụ của bạn là sửa chữa các câu tiếng Việt có sót chữ Hán sang tiếng Việt thuần túy, tự nhiên, chuẩn văn cảnh truyện. Tuyệt đối KHÔNG để sót bất kỳ chữ Hán nào. Chỉ trả về các thẻ <CAU_DA_SUA id=\"...\">câu tiếng Việt đã sửa</CAU_DA_SUA>, không thêm lời chào, giải thích hoặc lời bình.";
    }

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: isAnalysisOrScout ? 0.1 : isLocalizedRepair ? 0.2 : 0.3,
        topP: 0.95,
        maxOutputTokens: 65536,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    let data: {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: Array<any>;
      };
    } | undefined;

    const responseText = await response.text();
    try {
      data = JSON.parse(responseText);
    } catch {
      // Non-JSON response (e.g. HTML 503 error)
    }

    if (!response.ok || data?.error) {
      const code = data?.error?.code ?? response.status;
      const msg = data?.error?.message ?? (responseText.slice(0, 300) || response.statusText);
      const err = new Error(`Gemini API HTTP ${code}: ${msg}`);
      (err as any).details = data?.error?.details;
      (err as any).code = code;
      throw err;
    }

    const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPart || typeof textPart !== "string" || textPart.trim().length === 0) {
      throw new Error("Gemini API không trả về nội dung dịch.");
    }

    return textPart.trim();
  }

  /**
   * Diagnostic method to test a single API key directly against Google,
   * reading rate limits, active tier, and remaining quota.
   */
  public async testKey(
    key: string,
    modelToTest = this.currentModel,
  ): Promise<GeminiKeyTestResult> {
    const trimmed = key ? key.trim() : "";
    if (!trimmed || trimmed.length < 5) {
      return {
        ok: false,
        status: "error",
        message: "API key không được để trống.",
      };
    }

    const testModel = modelToTest?.trim() || this.currentModel || DEFAULT_GEMINI_MODEL;
    const usage = this.getUsage(trimmed);

    try {
      // Step 1: Lightweight authentication check (0 RPM quota burned, instant response)
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}`;
      const listRes = await fetch(listUrl, {
        method: "GET",
        signal: AbortSignal.timeout(12000),
      });

      if (!listRes.ok) {
        const listData = (await listRes.json().catch(() => ({}))) as {
          error?: { message?: string; code?: number };
        };
        const code = listData.error?.code ?? listRes.status;
        const msg = listData.error?.message || listRes.statusText;

        if (code === 400 || code === 401 || /API key not valid|UNAUTHENTICATED/iu.test(msg)) {
          usage.lastStatus = "error";
          return {
            ok: false,
            status: "error",
            message: "API key không hợp lệ (sai key hoặc đã bị xóa).",
          };
        }
        if (code === 403 || /free tier is not available|PERMISSION_DENIED/iu.test(msg)) {
          usage.lastStatus = "blocked";
          return {
            ok: false,
            status: "blocked",
            message: "Dự án bị chặn hoặc chưa bật billing (403).",
          };
        }
        return {
          ok: false,
          status: "error",
          message: `Lỗi Google API (${code}): ${msg.slice(0, 80)}`,
        };
      }

      // Step 2: Micro-probe generateContent (1 token) to verify quota and tier
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(testModel)}:generateContent?key=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "1" }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 },
        }),
        signal: AbortSignal.timeout(12000),
      });

      const serviceTierHeader = res.headers.get("x-gemini-service-tier") || "";
      const serviceTier = serviceTierHeader === "standard" ? "Free (Standard)" : (serviceTierHeader || "Free Tier");
      const rpdLimit = (testModel.includes("2.5-flash") && !testModel.includes("lite")) ? 20 : 500;

      const data = (await res.json().catch(() => ({}))) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string; code?: number; details?: Array<any> };
      };

      if (res.ok && data.candidates?.[0]?.content?.parts?.[0]) {
        usage.usedToday += 1;
        usage.lastStatus = "ready";
        usage.serviceTier = serviceTier;
        return {
          ok: true,
          status: "ready",
          model: testModel,
          serviceTier,
          message: `Key sẵn sàng! Tier: ${serviceTier}. Hạn mức: 15 RPM / ${rpdLimit} RPD.`,
          quota: {
            rpm: 15,
            rpd: rpdLimit,
            usedToday: usage.usedToday,
          },
        };
      }

      if (res.status === 403 || /free tier is not available|PERMISSION_DENIED/iu.test(data.error?.message || "")) {
        usage.lastStatus = "blocked";
        return {
          ok: false,
          status: "blocked",
          message: "Chưa mở Free Tier (Cần billing).",
        };
      }

      if (res.status === 429 || /RESOURCE_EXHAUSTED|quota|rateLimitExceeded/iu.test(data.error?.message || "")) {
        usage.lastStatus = "quota_exceeded";
        const violations = data.error?.details?.find((d) => d["@type"]?.includes("QuotaFailure"))?.violations;
        const violation = violations?.[0];
        const retryInfo = data.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
        const retryDelayStr = retryInfo?.retryDelay || "";
        const retrySec = parseInt(retryDelayStr, 10) || 0;
        const isMinute = violation?.quotaMetric?.includes("minute")
          || /per minute/i.test(violation?.description || "")
          || /per minute/i.test(data.error?.message || "")
          || (retrySec > 0 && retrySec <= 60);
        const quotaLimit = Number(violation?.quotaValue) || rpdLimit;

        let retryText = "";
        if (retrySec > 3600) {
          const hours = Math.round(retrySec / 3600);
          retryText = ` (Google báo reset sau ~${hours} giờ)`;
        } else if (retrySec > 60) {
          const mins = Math.round(retrySec / 60);
          retryText = ` (Google báo reset sau ~${mins} phút)`;
        } else if (retrySec > 0) {
          retryText = ` (Google báo đợi ~${retrySec} giây)`;
        }

        return {
          ok: false,
          status: "quota_exceeded",
          message: isMinute
            ? "Chạm hạn mức phút (15 RPM). Tự động hồi phục sau ~30 giây."
            : `Đã hết hạn mức ngày (${quotaLimit} RPD) cho model này.${retryText}`,
          quota: {
            rpm: 15,
            rpd: quotaLimit,
            usedToday: isMinute ? usage.usedToday : quotaLimit,
          },
        };
      }

      if (res.status === 404 || /no longer available/iu.test(data.error?.message || "")) {
        return {
          ok: false,
          status: "error",
          message: `Model ${testModel} không khả dụng (404). Hãy chọn Gemini 3.5 Flash-Lite hoặc Gemini 2.5 Flash-Lite.`,
        };
      }

      // If models list was 200 OK, key is genuinely valid
      if (res.ok) {
        usage.lastStatus = "ready";
        return {
          ok: true,
          status: "ready",
          model: testModel,
          serviceTier,
          message: `Key sẵn sàng! Tier: ${serviceTier}.`,
          quota: { rpm: 15, rpd: 1500, usedToday: usage.usedToday },
        };
      }

      return {
        ok: false,
        status: "error",
        message: data.error?.message || `Lỗi phản hồi Google API (${res.status}).`,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: "error",
        message: `Lỗi kết nối tới Google AI: ${errMsg}`,
      };
    }
  }
}
