import { copyFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { AiProvider } from "../../shared/types.js";

export interface OfflineIdentityResult {
  hasEvidence: boolean;
  email?: string;
  label?: string;
}

/**
 * Probes a browser profile directory directly from SQLite History, Cookies,
 * and Preferences without opening any browser process. This is completely immune to
 * Cloudflare challenges, bot detection, and timing out during page hydration.
 */
export async function detectOfflineLoginIdentity(
  profileDirectory: string,
  provider: AiProvider,
): Promise<OfflineIdentityResult> {
  const result: OfflineIdentityResult = {
    hasEvidence: false,
    email: undefined,
    label: undefined,
  };

  let candidateEmail: string | undefined;
  let candidateLabel: string | undefined;

  // 0. Check Preferences (Edge / Chromium stores signed-in account_info)
  // In Windows Edge, Preferences.account_info can hold a Microsoft Account sync identity
  // (edge_account_environment_string: login.microsoftonline.com). That sync identity belongs
  // to the Windows user / Edge profile, NOT to ChatGPT / DeepSeek / Kimi!
  const preferencesPath = path.join(profileDirectory, "Default", "Preferences");
  try {
    const prefRaw = await readFile(preferencesPath, "utf-8");
    const pref = JSON.parse(prefRaw);
    if (Array.isArray(pref.account_info) && pref.account_info.length > 0) {
      for (const acc of pref.account_info) {
        if (
          provider !== "gemini" &&
          (acc.edge_account_environment_string === "login.microsoftonline.com" ||
            acc.edge_account_type !== undefined)
        ) {
          continue;
        }
        if (acc.email && typeof acc.email === "string" && !candidateEmail) {
          candidateEmail = acc.email;
        }
        if (acc.full_name && typeof acc.full_name === "string" && !candidateLabel) {
          candidateLabel = acc.full_name;
        }
      }
    }
  } catch {
    // Preferences may be absent or not yet written
  }

  try {
    const { DatabaseSync } = await import("node:sqlite");

    // 1. Check History for login_hint or user email (identity hints only, not proof of session)
    const historyPath = path.join(profileDirectory, "Default", "History");
    const tmpHistory = path.join(
      profileDirectory,
      "Default",
      `History_probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    );
    try {
      await copyFile(historyPath, tmpHistory);
      const db = new DatabaseSync(tmpHistory, { open: true, readOnly: true });
      const rows = db.prepare(
        "SELECT url, title FROM urls WHERE url LIKE '%login_hint%' OR url LIKE '%idnf%' OR url LIKE '%identifier%' OR url LIKE '%Email%' ORDER BY id DESC LIMIT 50",
      ).all() as Array<{ url?: string; title?: string }>;

      for (const r of rows) {
        if (!r.url) continue;
        if (!candidateEmail) {
          const match = /(?:login_hint|idnf|identifier|Email)=([^&]+)/i.exec(r.url);
          if (match?.[1]) {
            try {
              const decoded = decodeURIComponent(match[1]);
              if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(decoded)) {
                candidateEmail = decoded;
              }
            } catch {}
          }
        }
      }
      db.close();
    } catch {
      // History file may be absent or locked
    } finally {
      await unlink(tmpHistory).catch(() => undefined);
    }

    // 2. Check Cookies for genuine authenticated session tokens
    const cookiesPath = path.join(profileDirectory, "Default", "Network", "Cookies");
    const tmpCookies = path.join(
      profileDirectory,
      "Default",
      "Network",
      `Cookies_probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    );
    try {
      await copyFile(cookiesPath, tmpCookies);
      const db = new DatabaseSync(tmpCookies, { open: true, readOnly: true });
      const cookieRows = db.prepare(
        "SELECT host_key, name FROM cookies WHERE host_key LIKE '%chatgpt%' OR host_key LIKE '%openai%' OR host_key LIKE '%google%' OR host_key LIKE '%deepseek%' OR host_key LIKE '%kimi%' OR host_key LIKE '%moonshot%'",
      ).all() as Array<{ host_key?: string; name?: string }>;

      const hasCookieForHost = (hostSubstr: string, validNames: string[]): boolean => {
        return cookieRows.some(
          (c) => (c.host_key?.toLowerCase().includes(hostSubstr)) && validNames.includes(c.name ?? ""),
        );
      };

      if (provider === "chatgpt") {
        if (
          hasCookieForHost("chatgpt.com", [
            "__Secure-next-auth.session-token",
            "__Secure-next-auth.session-token.0",
            "__Secure-next-auth.session-token.1",
            "session-token",
          ]) ||
          (hasCookieForHost("chatgpt.com", ["_account"]) && hasCookieForHost("chatgpt.com", ["oai-client-auth-info"]))
        ) {
          result.hasEvidence = true;
        }
      } else if (provider === "deepseek") {
        if (
          hasCookieForHost("deepseek.com", [
            "userToken",
            "token",
            "auth_token",
            "user_token",
            "ds_token",
          ])
        ) {
          result.hasEvidence = true;
        }
      } else if (provider === "kimi") {
        if (
          hasCookieForHost("kimi.ai", [
            "kimi-user-token",
            "refresh_token",
            "token",
            "k_token",
          ]) ||
          hasCookieForHost("moonshot.cn", ["token", "refresh_token"])
        ) {
          result.hasEvidence = true;
        }
      } else if (provider === "gemini") {
        if (hasCookieForHost("google.com", ["SID", "__Secure-1PSID", "SSID", "__Secure-3PSID"])) {
          result.hasEvidence = true;
        }
      }

      db.close();
    } catch {
      // Cookies file may be absent or locked
    } finally {
      await unlink(tmpCookies).catch(() => undefined);
    }
  } catch {
    // node:sqlite fallback
  }

  result.email = candidateEmail;
  if (candidateLabel) {
    result.label = candidateLabel;
  } else if (candidateEmail) {
    result.label = candidateEmail.split("@")[0];
  }

  return result;
}
