import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiApiAdapter } from "../../src/main/gemini/GeminiApiAdapter";

describe("GeminiApiAdapter 503 resilience and model fallback", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("falls back from 3.5 to 3.1 and retries when encountering HTTP 503", async () => {
    const adapter = new GeminiApiAdapter({
      apiKeys: ["AIzaSyKey1ValidKey123", "AIzaSyKey2ValidKey456"],
      model: "gemini-3.5-flash-lite",
    });

    const calls: Array<{ url: string; key: string; model: string }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      const url = new URL(urlStr);
      const modelMatch = url.pathname.match(/\/models\/([^:]+)/);
      const model = modelMatch?.[1] ? decodeURIComponent(modelMatch[1]) : "";
      const key = url.searchParams.get("key") || "";
      calls.push({ url: urlStr, key, model });

      // First call (key1, 3.5): 503 high demand
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
              status: "UNAVAILABLE",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      // Second call (key2, 3.5 or fallback): 503 high demand
      if (calls.length === 2) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "This model is currently experiencing high demand.",
              status: "UNAVAILABLE",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      // Third call (fallback to 3.1): succeeds!
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "<BAN_DICH id=\"V3-CH1-CH2\">Nội dung dịch thành công</BAN_DICH>" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const promise = adapter.sendAndWait("Dịch đoạn 1");

    // Advance fake timers through retry backoffs
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toContain("Nội dung dịch thành công");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // At least one call should have fallen back to gemini-3.1-flash-lite
    expect(calls.some((c) => c.model === "gemini-3.1-flash-lite")).toBe(true);
  });

  it("handles single-key HTTP 503 by falling back to 3.1 and retrying", async () => {
    const adapter = new GeminiApiAdapter({
      apiKeys: ["AIzaSyKey1ValidKey123"],
      model: "gemini-3.5-flash-lite",
    });

    const calls: Array<{ model: string }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      const url = new URL(urlStr);
      const modelMatch = url.pathname.match(/\/models\/([^:]+)/);
      const model = modelMatch?.[1] ? decodeURIComponent(modelMatch[1]) : "";
      calls.push({ model });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "This model is currently experiencing high demand.",
              status: "UNAVAILABLE",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Bản dịch đơn key thành công" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const promise = adapter.sendAndWait("Dịch đoạn 2");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("Bản dịch đơn key thành công");
    expect(calls.length).toBe(2);
    expect(calls[0]?.model).toBe("gemini-3.5-flash-lite");
    expect(calls[1]?.model).toBe("gemini-3.1-flash-lite");
  });
});
