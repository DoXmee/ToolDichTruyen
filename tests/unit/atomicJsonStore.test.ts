import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AtomicJsonStore } from "../../src/main/persistence/AtomicJsonStore";

describe("AtomicJsonStore", () => {
  it("writes and reads back data accurately", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "atomic-store-test-"));
    try {
      const filePath = path.join(tempDir, "data.json");
      const store = new AtomicJsonStore<{ count: number; name: string }>(filePath);
      await store.write({ count: 42, name: "test-run" });

      const data = await store.read({ count: 0, name: "" });
      expect(data).toEqual({ count: 42, name: "test-run" });

      const raw = await readFile(filePath, "utf8");
      expect(JSON.parse(raw)).toEqual({ count: 42, name: "test-run" });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("returns fallback if file does not exist", async () => {
    const filePath = path.join(os.tmpdir(), `non-existent-${Date.now()}.json`);
    const store = new AtomicJsonStore<{ status: string }>(filePath);
    const data = await store.read({ status: "fallback" });
    expect(data).toEqual({ status: "fallback" });
  });
});
