import { describe, expect, it } from "vitest";
import { detectOfflineLoginIdentity } from "../../src/main/accounts/offlineProbe";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

describe("detectOfflineLoginIdentity", () => {
  it("returns hasEvidence: false when profile directory has no database files", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result).toEqual({
        hasEvidence: false,
        email: undefined,
        label: undefined,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("extracts email and label from History urls containing login_hint without falsely asserting session evidence", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    const defaultDir = path.join(tmpDir, "Default");
    await fs.mkdir(defaultDir, { recursive: true });
    const historyPath = path.join(defaultDir, "History");

    const db = new DatabaseSync(historyPath);
    db.exec(`
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url TEXT,
        title TEXT
      );
    `);
    db.prepare(`
      INSERT INTO urls (url, title) VALUES
      ('https://auth.openai.com/api/accounts/authorize?client_id=123&login_hint=testuser%2B123%40gmail.com', 'Login'),
      ('https://chatgpt.com/', 'ChatGPT');
    `).run();
    db.close();

    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result.hasEvidence).toBe(false);
      expect(result.email).toBe("testuser+123@gmail.com");
      expect(result.label).toBe("testuser+123");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("detects evidence when session cookies are present in Network/Cookies", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    const netDir = path.join(tmpDir, "Default", "Network");
    await fs.mkdir(netDir, { recursive: true });
    const cookiesPath = path.join(netDir, "Cookies");

    const db = new DatabaseSync(cookiesPath);
    db.exec(`
      CREATE TABLE cookies (
        host_key TEXT,
        name TEXT
      );
    `);
    db.prepare(`
      INSERT INTO cookies (host_key, name) VALUES
      ('.chatgpt.com', '__Secure-next-auth.session-token.0');
    `).run();
    db.close();

    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result.hasEvidence).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("extracts email and full_name from Preferences account_info without falsely asserting session evidence", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    const defaultDir = path.join(tmpDir, "Default");
    await fs.mkdir(defaultDir, { recursive: true });
    const prefPath = path.join(defaultDir, "Preferences");
    await fs.writeFile(
      prefPath,
      JSON.stringify({
        account_info: [
          {
            email: "user@example.com",
            full_name: "Test User",
          },
        ],
      }),
      "utf-8",
    );

    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result.hasEvidence).toBe(false);
      expect(result.email).toBe("user@example.com");
      expect(result.label).toBe("Test User");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("combines Preferences identity with authenticated cookie session evidence", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    const defaultDir = path.join(tmpDir, "Default");
    const netDir = path.join(defaultDir, "Network");
    await fs.mkdir(netDir, { recursive: true });
    const prefPath = path.join(defaultDir, "Preferences");
    await fs.writeFile(
      prefPath,
      JSON.stringify({
        account_info: [
          {
            email: "verified@example.com",
            full_name: "Verified User",
          },
        ],
      }),
      "utf-8",
    );
    const cookiesPath = path.join(netDir, "Cookies");
    const db = new DatabaseSync(cookiesPath);
    db.exec(`
      CREATE TABLE cookies (
        host_key TEXT,
        name TEXT
      );
    `);
    db.prepare(`
      INSERT INTO cookies (host_key, name) VALUES
      ('.chatgpt.com', '__Secure-next-auth.session-token');
    `).run();
    db.close();

    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result.hasEvidence).toBe(true);
      expect(result.email).toBe("verified@example.com");
      expect(result.label).toBe("Verified User");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("does not assert evidence when only auth.openai.com portal cookies are present", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    const defaultDir = path.join(tmpDir, "Default");
    const netDir = path.join(defaultDir, "Network");
    await fs.mkdir(netDir, { recursive: true });
    const cookiesPath = path.join(netDir, "Cookies");

    const db = new DatabaseSync(cookiesPath);
    db.exec(`
      CREATE TABLE cookies (
        host_key TEXT,
        name TEXT
      );
    `);
    db.prepare(`
      INSERT INTO cookies (host_key, name) VALUES
      ('.auth.openai.com', 'session');
    `).run();
    db.close();

    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result.hasEvidence).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("does not assert evidence when only chatgpt IndexedDB leveldb directory is present without session cookies", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-probe-test-"));
    const idbDir = path.join(tmpDir, "Default", "IndexedDB", "https_chatgpt.com_0.indexeddb.leveldb");
    await fs.mkdir(idbDir, { recursive: true });

    try {
      const result = await detectOfflineLoginIdentity(tmpDir, "chatgpt");
      expect(result.hasEvidence).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});


