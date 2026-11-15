import { EventEmitter } from "node:events";
import type { SendMessageOptions } from "../chatgpt/ChatGptWebAdapter.js";

export interface DeepSeekApiAdapterOptions {
  apiKeys?: string[];
  model?: string;
  batchChaptersCount?: number;
}

export interface DeepSeekApiStatusSnapshot {
  status: "idle" | "ready" | "busy" | "error";
  message?: string;
  activeKeyMasked?: string;
  totalKeys?: number;
  model?: string;
  balance?: string;
}

export interface DeepSeekKeyTestResult {
  ok: boolean;
  status: "ready" | "error" | "rate_limited" | "insufficient_balance";
  message: string;
  balance?: string;
}

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

export const SUPPORTED_DEEPSEEK_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek V3 (Khuyên dùng - Rẻ nhất)" },
];

export const PURE_VIETNAMESE_SYSTEM_INSTRUCTION = `Bạn là chuyên gia dịch thuật văn học Trung - Việt hàng đầu. Nhiệm vụ của bạn là chuyển ngữ tác phẩm sang tiếng Việt một cách thuần Việt, tự nhiên, mượt mà và giàu cảm xúc văn học.
Tuyệt đối tuân thủ các quy tắc bất di bất dịch sau:
1. Thuần Việt 100% & Không sót tiếng Trung: Diễn đạt trôi chảy theo thói quen ngôn ngữ và phong cách văn học của người Việt. Loại bỏ hoàn toàn các cấu trúc câu gượng gạo, từ ngữ Hán-Việt thô kệch, tối nghĩa hoặc ngữ pháp dịch máy cứng nhắc.
2. Bảo toàn tuyệt đối danh xưng đã khóa: Mọi tên nhân vật, địa danh, thế lực hoặc thuật ngữ được bọc trong dấu ngoặc khóa ⟦...⟧ BẮT BUỘC phải giữ nguyên vẹn 100% chữ bên trong và giữ nguyên cặp ngoặc ⟦...⟧ bao quanh. Tuyệt đối không tự ý đổi tên, không dịch nghĩa các từ đã khóa, không làm rơi rớt ngoặc ⟦...⟧.
3. Đồng nhất xưng hô theo ngữ cảnh: Giữ vững hệ thống xưng hô phù hợp với bối cảnh truyện (gia đình, tông môn, công sở, quan hệ thân - sơ).
4. Định dạng đầu ra: Không thêm lời chào, không giải thích, không thêm nhận xét cá nhân. Chỉ xuất duy nhất nội dung bản dịch tiếng Việt hoàn chỉnh.`;

function maskKey(key?: string): string {
  if (!key) return "chưa có";
  if (key.length <= 10) return key;
  return key.slice(0, 8) + "..." + key.slice(-4);
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

export class DeepSeekApiAdapter {
  private keys: string[] = [];
  private activeKeyIndex = 0;
  private currentModel: string = DEFAULT_DEEPSEEK_MODEL;
  private configuredModel: string = DEFAULT_DEEPSEEK_MODEL;
  private abortController?: AbortController;
  private readonly emitter = new EventEmitter();
  private currentStatus: "idle" | "ready" | "busy" | "error" = "ready";
  private statusMessage?: string;
  private keyBalanceMap = new Map<string, string>();

  public constructor(options: DeepSeekApiAdapterOptions = {}) {
    this.keys = (options.apiKeys && options.apiKeys.length > 0)
      ? options.apiKeys.filter((k) => k && k.trim().length > 5)
      : [];
    this.configuredModel = options.model?.trim() || DEFAULT_DEEPSEEK_MODEL;
    this.currentModel = this.configuredModel;
    this.updateStatus("ready", `DeepSeek API sẵn sàng (${this.keys.length} key)`);
  }

  public getKeys(): string[] {
    return [...this.keys];
  }

  public setKeys(newKeys: string[]): void {
    const valid = newKeys.map((k) => k.trim()).filter((k) => k.length > 5);
    this.keys = valid;
    this.activeKeyIndex = 0;
    this.updateStatus("ready", `Đã cập nhật ${this.keys.length} DeepSeek API key`);
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

  public async ensureReady(): Promise<void> {
    if (this.keys.length === 0) {
      this.updateStatus("error", "Chưa có API key DeepSeek nào.");
      throw new Error("Chưa có API key DeepSeek hợp lệ.");
    }
  }

  public async startNewConversation(): Promise<void> {
    this.abortController = undefined;
  }

  public cancelGeneration(): void {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // Ignore abort race
      }
      this.abortController = undefined;
    }
    this.updateStatus("ready", "Đã dừng lượt dịch.");
  }

  public status(): DeepSeekApiStatusSnapshot {
    const activeKey = this.keys[this.activeKeyIndex];
    return {
      status: this.currentStatus,
      message: this.statusMessage,
      activeKeyMasked: activeKey ? maskKey(activeKey) : undefined,
      totalKeys: this.keys.length,
      model: this.currentModel,
      balance: activeKey ? this.keyBalanceMap.get(activeKey) : undefined,
    };
  }

  public onStatus(listener: (snapshot: DeepSeekApiStatusSnapshot) => void): () => void {
    this.emitter.on("status", listener);
    return () => this.emitter.off("status", listener);
  }

  private updateStatus(status: "idle" | "ready" | "busy" | "error", message?: string): void {
    this.currentStatus = status;
    this.statusMessage = message;
    this.emitter.emit("status", this.status());
  }

  /**
   * Fetches real-time account balance from DeepSeek API
   * Formatted strictly as e.g. "0.08 USD"
   */
  public async fetchBalance(key: string): Promise<string> {
    const trimmed = key ? key.trim() : "";
    if (!trimmed) return "0.00 USD";

    try {
      const response = await fetch("https://api.deepseek.com/user/balance", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${trimmed}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return "0.00 USD";
      }

      const data = (await response.json()) as {
        is_available?: boolean;
        balance_infos?: Array<{
          currency?: string;
          total_balance?: string;
        }>;
      };

      const info = data.balance_infos?.[0];
      if (info && info.total_balance) {
        const val = parseFloat(info.total_balance);
        const formatted = `${isNaN(val) ? "0.00" : val.toFixed(2)} ${info.currency || "USD"}`;
        this.keyBalanceMap.set(trimmed, formatted);
        return formatted;
      }
    } catch {
      // Fallback on cached or 0
    }

    return this.keyBalanceMap.get(trimmed) || "0.00 USD";
  }

  /**
   * Tests a DeepSeek API key and returns validity and balance
   */
  public async testKey(key: string): Promise<DeepSeekKeyTestResult> {
    const trimmed = key ? key.trim() : "";
    if (!trimmed || trimmed.length < 5) {
      return {
        ok: false,
        status: "error",
        message: "API key không được để trống.",
      };
    }

    try {
      const response = await fetch("https://api.deepseek.com/user/balance", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${trimmed}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401) {
        return {
          ok: false,
          status: "error",
          message: "API key không hợp lệ hoặc sai định dạng (401).",
        };
      }

      if (response.status === 402) {
        return {
          ok: false,
          status: "insufficient_balance",
          message: "Tài khoản hết số dư (402). Vui lòng nạp thêm tiền.",
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          status: "error",
          message: `Lỗi kết nối DeepSeek API (HTTP ${response.status}).`,
        };
      }

      const data = (await response.json()) as {
        is_available?: boolean;
        balance_infos?: Array<{
          currency?: string;
          total_balance?: string;
        }>;
      };

      const info = data.balance_infos?.[0];
      const val = parseFloat(info?.total_balance || "0");
      const formatted = `${isNaN(val) ? "0.00" : val.toFixed(2)} ${info?.currency || "USD"}`;
      this.keyBalanceMap.set(trimmed, formatted);

      return {
        ok: true,
        status: "ready",
        message: `Key hoạt động tốt · Số dư: ${formatted}`,
        balance: formatted,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: "error",
        message: `Lỗi kiểm tra key: ${err?.message || "Không thể kết nối"}`,
      };
    }
  }

  /**
   * Calls DeepSeek Chat Completions API with key rotation and backoff.
   */
  public async sendAndWait(message: string, options: SendMessageOptions = {}): Promise<string> {
    await this.ensureReady();
    if (!message || message.trim().length === 0) {
      throw new TypeError("Nội dung gửi DeepSeek API không được để trống.");
    }

    this.updateStatus("busy", `Đang gửi bản dịch qua DeepSeek API (${this.currentModel})...`);
    this.abortController = new AbortController();

    const signal = options.signal
      ? AbortSignal.any([options.signal, this.abortController.signal])
      : this.abortController.signal;

    const maxAttempts = Math.max(this.keys.length * 3, 6);
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      if (signal.aborted) {
        throw new Error("Tác vụ dịch đã bị hủy.");
      }

      const currentKey = this.keys[this.activeKeyIndex] || this.keys[0];
      if (!currentKey) {
        throw new Error("Không có DeepSeek API key nào khả dụng.");
      }
      attempts += 1;

      try {
        const result = await this.callDeepSeekApi(currentKey, this.currentModel, message, signal);
        this.updateStatus("ready", `Dịch xong lượt với key ${maskKey(currentKey)} (${this.currentModel})`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errMessage = lastError.message || "";

        const isQuotaOrRateLimit = /429|rate_limit|insufficient_quota/iu.test(errMessage);
        const isServerBusy = /500|502|503|504|overloaded|timeout|ECONNRESET/iu.test(errMessage);

        if (isQuotaOrRateLimit && this.keys.length > 1) {
          const prevKeyMasked = maskKey(currentKey);
          this.activeKeyIndex = (this.activeKeyIndex + 1) % this.keys.length;
          const nextKeyMasked = maskKey(this.keys[this.activeKeyIndex]);
          this.updateStatus(
            "busy",
            `Key ${prevKeyMasked} chạm rate limit. Tự động đổi sang key ${nextKeyMasked} và tiếp tục...`
          );
          await delay(1000, signal);
          continue;
        }

        if (isQuotaOrRateLimit) {
          this.updateStatus("busy", "Chạm giới hạn tốc độ. Tự động tạm nghỉ 10s rồi thử lại...");
          await delay(10000, signal);
          continue;
        }

        if (isServerBusy) {
          const waitTime = Math.min(attempts * 2, 8);
          this.updateStatus("busy", `Máy chủ DeepSeek bận (HTTP 5xx). Đợi ${waitTime}s rồi thử lại...`);
          await delay(waitTime * 1000, signal);
          continue;
        }

        this.updateStatus("error", `Lỗi DeepSeek API: ${errMessage}`);
        throw lastError;
      }
    }

    this.updateStatus("error", "Đã thử tất cả API key DeepSeek nhưng đều gặp lỗi.");
    throw lastError || new Error("Không thể hoàn tất lượt dịch qua DeepSeek API.");
  }

  private async callDeepSeekApi(
    key: string,
    model: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const url = "https://api.deepseek.com/chat/completions";

    const isAnalysisOrScout = /^\[TDT_(?:SCOUT|V3_ANALYSIS)\]/u.test(prompt) || prompt.startsWith("[TDT_V3_ANALYSIS]");
    const isLocalizedRepair = prompt.includes("<CAU_CAN_SUA>") || prompt.includes("SỬA CỤC BỘ");

    let systemText = PURE_VIETNAMESE_SYSTEM_INSTRUCTION;
    if (isAnalysisOrScout) {
      systemText = "Bạn là chuyên gia phân tích và trinh sát nội dung truyện. Tuân thủ tuyệt đối cấu trúc JSON trong prompt. CHỈ trả về duy nhất 1 khối JSON hợp lệ theo định dạng yêu cầu, tuyệt đối KHÔNG dịch văn bản, KHÔNG xuất thẻ HTML và KHÔNG thêm lời chào.";
    } else if (isLocalizedRepair) {
      systemText = "Bạn là chuyên gia dịch thuật và biên tập văn học Trung - Việt. Nhiệm vụ của bạn là sửa chữa các câu tiếng Việt có sót chữ Hán sang tiếng Việt thuần túy, tự nhiên, chuẩn văn cảnh truyện. Tuyệt đối KHÔNG để sót bất kỳ chữ Hán nào. Chỉ trả về các thẻ <CAU_DA_SUA id=\"...\">câu tiếng Việt đã sửa</CAU_DA_SUA>, không thêm lời chào, giải thích hoặc lời bình.";
    }

    const requestBody = {
      model: model || "deepseek-chat",
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: prompt },
      ],
      temperature: isAnalysisOrScout ? 0.1 : isLocalizedRepair ? 0.2 : 0.3,
      max_tokens: 8192,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    let data: {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      error?: {
        message?: string;
        type?: string;
        code?: string | number;
      };
    } | undefined;

    const responseText = await response.text();
    try {
      data = JSON.parse(responseText);
    } catch {
      // Non-json response
    }

    if (!response.ok || data?.error) {
      const code = data?.error?.code ?? response.status;
      const msg = data?.error?.message ?? (responseText.slice(0, 300) || response.statusText);
      const err = new Error(`DeepSeek API HTTP ${code}: ${msg}`);
      (err as any).code = code;
      throw err;
    }

    let content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("DeepSeek API không trả về nội dung dịch.");
    }
    content = content.trim();

    let finishReason = data?.choices?.[0]?.finish_reason;

    // Auto-continuation if output hit max_tokens (8192) and was cut off mid-sentence
    let continuationAttempts = 0;
    while (finishReason === "length" && continuationAttempts < 2 && !signal.aborted) {
      continuationAttempts++;
      this.updateStatus(
        "busy",
        `Bản dịch dài chạm trần 8.192 token. Đang tự động gọi tiếp phần còn lại (lần ${continuationAttempts}/2)...`
      );

      const lastSentence = content.slice(-120).trim();
      const continuePrompt = `Đoạn dịch trước đã bị ngắt nửa chừng ở phần cuối: "${lastSentence}".\nHãy dịch tiếp tục phần còn lại cho đến hết văn bản gốc, tuyệt đối KHÔNG dịch lại phần đã có, KHÔNG mở đầu bằng lời chào:`;

      const continueBody: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature: number;
        max_tokens: number;
      } = {
        model: model || "deepseek-chat",
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: prompt },
          { role: "assistant", content: content },
          { role: "user", content: continuePrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      };

      try {
        const contRes: Response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(continueBody),
          signal,
        });

        if (contRes.ok) {
          const contData: any = await contRes.json();
          const contText: string = contData?.choices?.[0]?.message?.content || "";
          finishReason = contData?.choices?.[0]?.finish_reason;
          if (contText.trim()) {
            content = content + "\n" + contText.trim();
          } else {
            break;
          }
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    return content;
  }
}
