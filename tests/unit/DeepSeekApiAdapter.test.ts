import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeepSeekApiAdapter } from "../../src/main/deepseek/DeepSeekApiAdapter";

describe("DeepSeekApiAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("khởi tạo adapter và quản lý keys chính xác", () => {
    const adapter = new DeepSeekApiAdapter({
      apiKeys: ["sk-1234567890", "sk-abcdefghij"],
      model: "deepseek-chat",
    });

    expect(adapter.getKeys()).toEqual(["sk-1234567890", "sk-abcdefghij"]);
    expect(adapter.getModel()).toBe("deepseek-chat");
    const status = adapter.status();
    expect(status.status).toBe("ready");
    expect(status.totalKeys).toBe(2);
  });

  it("fetchBalance đọc và format đúng 0.08 USD", async () => {
    const fakeResponse = {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "0.08",
          granted_balance: "0.00",
          topped_up_balance: "0.08",
        },
      ],
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => fakeResponse,
    } as any);

    const adapter = new DeepSeekApiAdapter({
      apiKeys: ["sk-validkey123"],
    });

    const balance = await adapter.fetchBalance("sk-validkey123");
    expect(balance).toBe("0.08 USD");
  });

  it("sendAndWait gửi request và nhận kết quả dịch thành công", async () => {
    const fakeChatResponse = {
      id: "chatcmpl-test",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Nàng đẩy cửa ra, nhìn thấy hoa mai trắng nở rộ trong sân.",
          },
          finish_reason: "stop",
        },
      ],
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(fakeChatResponse),
    } as any);

    const adapter = new DeepSeekApiAdapter({
      apiKeys: ["sk-testkey12345"],
      model: "deepseek-chat",
    });

    const result = await adapter.sendAndWait("她推开门，看见庭院里的白梅。");
    expect(result).toBe("Nàng đẩy cửa ra, nhìn thấy hoa mai trắng nở rộ trong sân.");
  });

  it("testKey trả về status ready và số dư 0.08 USD", async () => {
    const fakeBalanceResponse = {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "0.08",
        },
      ],
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fakeBalanceResponse,
    } as any);

    const adapter = new DeepSeekApiAdapter();
    const result = await adapter.testKey("sk-testkey12345");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.balance).toBe("0.08 USD");
  });
});
