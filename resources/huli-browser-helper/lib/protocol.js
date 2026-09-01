export const EXTENSION_VERSION = "1.0.7";
export const HEARTBEAT_PORT_NAME = "huli-heartbeat";
export const PAIR_FRAGMENT_PREFIX = "#tdt-pair=";
export const POLL_DELAY_MS = 800;
export const POLL_ERROR_DELAY_MS = 2_500;
export const POLL_HTTP_TIMEOUT_MS = 25_000;
export const MAX_POLL_FAILURES = 3;
export const COMMAND_TIMEOUT_MS = 45_000;
// The catalog is populated by a small in-page JavaScript request after the
// document reaches "complete". Give the content script time to observe that
// one bounded DOM update without making command handling unbounded.
export const CATALOG_SNAPSHOT_READY_TIMEOUT_MS = 8_000;
export const SNAPSHOT_TIMEOUT_MS = 12_000;
/** The fixed Huli catalog button can trigger one bounded XHR/list swap. */
export const CATALOG_NEXT_TIMEOUT_MS = 10_000;
/** Bounded companion request while resolving one verified reader data-url. */
export const CHAPTER_NEXT_TIMEOUT_MS = 10_000;
// Leave deterministic headroom for the authenticated result envelope
// (sessionId, commandId and JSON keys) under the bridge's 2 MiB request cap.
export const MAX_SNAPSHOT_BYTES = 1_900_000;

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/u;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/u;
const COMMAND_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const HULI_HOSTS = new Set(["m.huliwang.net", "www.huliwang.net"]);
const XSZJ_HOSTS = new Set(["xszj.org", "www.xszj.org"]);
const IXDZS_HOSTS = new Set(["ixdzs8.com", "www.ixdzs8.com"]);
const NOVEL543_HOSTS = new Set(["novel543.com", "www.novel543.com"]);
const XSZJ_BOOK_PATH = /^\/b\/(\d+)\/?$/u;
const XSZJ_CATALOG_PATH = /^\/b\/(\d+)\/cs\/(\d+)\/?$/u;
const XSZJ_CHAPTER_PATH = /^\/b\/(\d+)\/c\/(\d+)\/?$/u;
const IXDZS_BOOK_PATH = /^\/read\/(\d+)\/?$/u;
const IXDZS_CHAPTER_PATH = /^\/read\/(\d+)\/p(\d+)\.html\/?$/u;

export function bridgeOriginFromLoopbackUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    throw new TypeError("Pairing page must use the IPv4 loopback host.");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new TypeError("Loopback bridge port is outside the allowed range.");
  }
  return `http://127.0.0.1:${port}`;
}

export function assertPairingPageUrl(rawUrl) {
  const url = new URL(rawUrl);
  const bridgeOrigin = bridgeOriginFromLoopbackUrl(url.href);
  if (url.pathname !== "/v1/pair" || url.search) throw new TypeError("Invalid loopback pairing page.");
  return bridgeOrigin;
}

export function isAllowedHeartbeatSenderUrl(rawUrl) {
  try {
    assertPairingPageUrl(rawUrl);
    return true;
  } catch {
    try {
      normalizeCompanionUrl(rawUrl);
      return true;
    } catch {
      return false;
    }
  }
}

export function resolveHeartbeatSenderUrl(sender) {
  if (!sender || typeof sender !== "object" || Array.isArray(sender)) return undefined;
  const tabUrl = sender.tab && typeof sender.tab === "object" && typeof sender.tab.url === "string"
    ? sender.tab.url
    : undefined;
  const senderUrl = typeof sender.url === "string" ? sender.url : undefined;
  const candidate = tabUrl ?? senderUrl;
  return candidate && isAllowedHeartbeatSenderUrl(candidate) ? candidate : undefined;
}

export function decodePairingFragment(hash) {
  if (typeof hash !== "string" || !hash.startsWith(PAIR_FRAGMENT_PREFIX)) {
    throw new TypeError("Missing pairing fragment.");
  }
  const encoded = hash.slice(PAIR_FRAGMENT_PREFIX.length);
  if (!BASE64URL.test(encoded) || encoded.length > 768) throw new TypeError("Invalid pairing fragment.");
  const padded = encoded.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  let payload;
  try {
    payload = JSON.parse(atob(padded));
  } catch {
    throw new TypeError("Invalid pairing payload.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Invalid pairing payload.");
  const keys = Object.keys(payload).sort();
  if (keys.join(",") !== "sessionId,token") throw new TypeError("Pairing payload has unknown fields.");
  return validatePairingCredentials(payload.sessionId, payload.token);
}

export function validatePairingCredentials(sessionId, token) {
  if (typeof sessionId !== "string" || typeof token !== "string" || !SESSION_ID.test(sessionId) || !TOKEN.test(token)) {
    throw new TypeError("Invalid pairing credentials.");
  }
  return { sessionId, token };
}

export function normalizeHuliUrl(rawUrl) {
  if (typeof rawUrl !== "string") throw new TypeError("Huliwang URL must be a string.");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !HULI_HOSTS.has(url.hostname.toLowerCase()) || url.port || url.username || url.password) {
    throw new TypeError("Only exact HTTPS Huliwang hosts are allowed.");
  }
  if (url.href.length > 2_048 || !/^\/(?:dir\/\d+(?:[-_/]\d+)?\.html|\d+\/?|\d+\/\d+(?:\/\d+)?\.html)\/?$/u.test(url.pathname)) {
    throw new TypeError("Unsupported Huliwang path.");
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

export function huliPageIdentity(rawUrl) {
  const normalized = new URL(normalizeHuliUrl(rawUrl));
  normalized.hostname = "m.huliwang.net";
  const catalog = /^\/dir\/(\d+)(?:[-_/](\d+))?\.html$/u.exec(normalized.pathname);
  if (catalog?.[1]) {
    const page = catalog[2] ? Number.parseInt(catalog[2], 10) : 1;
    normalized.pathname = page === 1
      ? `/dir/${catalog[1]}.html`
      : `/dir/${catalog[1]}-${page}.html`;
    return normalized.href;
  }
  const pageOne = /^(\/\d+\/\d+)\/1\.html$/u.exec(normalized.pathname);
  if (pageOne?.[1]) normalized.pathname = `${pageOne[1]}.html`;
  return normalized.href;
}

/**
 * XSZJ/爱下电子书 accepts only the same fixed reader, book and catalog route
 * families as the app parser.  `www` aliases and harmless query/hash noise
 * are canonicalized before a visit, so the helper never sends a broad URL to
 * the user's normal browser profile.
 */
export function normalizeXszjUrl(rawUrl) {
  if (typeof rawUrl !== "string") throw new TypeError("XSZJ URL must be a string.");
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (
    url.href.length > 2_048
    || url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || (!XSZJ_HOSTS.has(host) && !IXDZS_HOSTS.has(host))
  ) {
    throw new TypeError("Only exact HTTPS XSZJ/爱下电子书 hosts are allowed.");
  }

  // Match `parseStoryUrl`: the app preserves only the native XSZJ chapter
  // page query, then emits a canonical URL without tracking parameters.
  const path = url.pathname.replace(/\/{2,}/gu, "/");
  const sourcePage = url.searchParams.get("page");
  const safePage = typeof sourcePage === "string" && /^\d+$/u.test(sourcePage)
    ? Number.parseInt(sourcePage, 10)
    : undefined;

  if (XSZJ_HOSTS.has(host)) {
    const book = XSZJ_BOOK_PATH.exec(path);
    const catalog = XSZJ_CATALOG_PATH.exec(path);
    const chapter = XSZJ_CHAPTER_PATH.exec(path);
    if (book?.[1]) return `https://xszj.org/b/${book[1]}`;
    if (catalog?.[1] && catalog[2]) return `https://xszj.org/b/${catalog[1]}/cs/${catalog[2]}`;
    if (chapter?.[1] && chapter[2]) {
      const page = Number.isSafeInteger(safePage) && safePage > 1 ? `?page=${safePage}` : "";
      return `https://xszj.org/b/${chapter[1]}/c/${chapter[2]}${page}`;
    }
  } else {
    const book = IXDZS_BOOK_PATH.exec(path);
    const chapter = IXDZS_CHAPTER_PATH.exec(path);
    if (book?.[1]) return `https://ixdzs8.com/read/${book[1]}/`;
    if (chapter?.[1] && chapter[2]) return `https://ixdzs8.com/read/${chapter[1]}/p${chapter[2]}.html`;
  }
  throw new TypeError("Unsupported XSZJ/爱下电子书 path.");
}

export function normalizeNovel543Url(rawUrl) {
  if (typeof rawUrl !== "string") throw new TypeError("Novel543 URL must be a string.");
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (
    url.href.length > 2_048
    || url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || !NOVEL543_HOSTS.has(host)
  ) throw new TypeError("Only exact HTTPS Novel543 hosts are allowed.");
  const path = url.pathname.replace(/\/{2,}/gu, "/");
  const book = /^\/(\d{6,20})\/?$/u.exec(path);
  const catalog = /^\/(\d{6,20})\/dir\/?$/u.exec(path);
  const chapter = /^\/(\d{6,20})\/(\d+_\d+)(?:_(\d+))?\.html$/u.exec(path);
  if (book?.[1]) return `https://www.novel543.com/${book[1]}/`;
  if (catalog?.[1]) return `https://www.novel543.com/${catalog[1]}/dir`;
  if (chapter?.[1] && chapter[2]) {
    const part = chapter[3] && Number.parseInt(chapter[3], 10) > 1 ? `_${Number.parseInt(chapter[3], 10)}` : "";
    return `https://www.novel543.com/${chapter[1]}/${chapter[2]}${part}.html`;
  }
  throw new TypeError("Unsupported Novel543 path.");
}

/** Return a canonical URL for the extension's two strictly allow-listed sites. */
export function normalizeCompanionUrl(rawUrl) {
  try {
    return normalizeHuliUrl(rawUrl);
  } catch {
    try {
      return normalizeXszjUrl(rawUrl);
    } catch {
      return normalizeNovel543Url(rawUrl);
    }
  }
}

export function companionSite(rawUrl) {
  try {
    normalizeHuliUrl(rawUrl);
    return "huliwang";
  } catch {
    try {
      normalizeXszjUrl(rawUrl);
      return "xszj";
    } catch {
      normalizeNovel543Url(rawUrl);
      return "novel543";
    }
  }
}

/** Huli has aliases; XSZJ and Novel543 routes are canonicalized above. */
export function companionPageIdentity(rawUrl) {
  try {
    return huliPageIdentity(rawUrl);
  } catch {
    try {
      return normalizeXszjUrl(rawUrl);
    } catch {
      return normalizeNovel543Url(rawUrl);
    }
  }
}

export function validateVisitCommand(value) {
  const command = validateCompanionCommand(value);
  if (command.type !== "visit") throw new TypeError("Unsupported command.");
  return command;
}

/**
 * The companion deliberately accepts only fixed commands.  `catalog-next`
 * and `chapter-next` each reuse an already verified current page; neither is
 * a generic DOM-control channel and neither contains selector/script input.
 */
export function validateCompanionCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid command.");
  if (Object.keys(value).sort().join(",") !== "id,type,url") throw new TypeError("Command has unknown fields.");
  if (!COMMAND_ID.test(value.id) || !["visit", "catalog-next", "chapter-next"].includes(value.type)) {
    throw new TypeError("Unsupported command.");
  }
  const url = normalizeCompanionUrl(value.url);
  const site = companionSite(url);
  if (
    value.type === "catalog-next"
    && (site !== "huliwang" || !/^\/dir\/\d+(?:[-_/]\d+)?\.html$/u.test(new URL(url).pathname))
  ) {
    throw new TypeError("catalog-next requires a Huliwang catalog URL.");
  }
  if (
    value.type === "chapter-next"
    && (site !== "huliwang" || !/^\/\d+\/\d+(?:\/\d+)?\.html$/u.test(new URL(url).pathname))
  ) {
    throw new TypeError("chapter-next requires a Huliwang chapter URL.");
  }
  return { id: value.id, type: value.type, url };
}

export function pairedTabAction(tabUrl, requestedUrl, tabExists = true) {
  const normalizedRequest = normalizeCompanionUrl(requestedUrl);
  if (!tabExists) return { type: "create", url: normalizedRequest, active: true };
  try {
    if (companionPageIdentity(tabUrl) === companionPageIdentity(normalizedRequest)) {
      // Preserve the exact URL already loaded by the daily browser. Host and
      // page-1 aliases represent the same page and must not restart Cloudflare.
      return { type: "reuse", url: normalizeCompanionUrl(tabUrl) };
    }
  } catch {
    // The pairing page is loopback, so the first command intentionally navigates once.
  }
  return { type: "navigate", url: normalizedRequest };
}

export function mustWaitForPairedTab(actionType, tabStatus) {
  if (!["create", "navigate", "reuse"].includes(actionType)) throw new TypeError("Unknown paired-tab action.");
  return actionType !== "reuse" || tabStatus !== "complete";
}

export function classifyCommandPollStatus(status) {
  if (status === 200) return "ok";
  if ([401, 403, 404, 409, 410].includes(status)) return "gone";
  if (status === 429) return "busy";
  return "transient";
}

export function nextPollFailureState(currentFailures) {
  const current = Number.isInteger(currentFailures) && currentFailures >= 0 ? currentFailures : 0;
  const failures = Math.min(MAX_POLL_FAILURES, current + 1);
  return { failures, connected: failures < MAX_POLL_FAILURES };
}

export function authHeaders(token, json = false) {
  if (!TOKEN.test(token)) throw new TypeError("Invalid bridge token.");
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 500);
}
