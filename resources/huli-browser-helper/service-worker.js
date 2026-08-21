import {
  authHeaders,
  CATALOG_NEXT_TIMEOUT_MS,
  CHAPTER_NEXT_TIMEOUT_MS,
  classifyCommandPollStatus,
  COMMAND_TIMEOUT_MS,
  EXTENSION_VERSION,
  HEARTBEAT_PORT_NAME,
  assertPairingPageUrl,
  companionPageIdentity,
  huliPageIdentity,
  normalizeCompanionUrl,
  normalizeHuliUrl,
  mustWaitForPairedTab,
  nextPollFailureState,
  pairedTabAction,
  POLL_HTTP_TIMEOUT_MS,
  resolveHeartbeatSenderUrl,
  safeError,
  SNAPSHOT_TIMEOUT_MS,
  validatePairingCredentials,
  validateCompanionCommand,
} from "./lib/protocol.js";

let inFlightPoll;
let pairingGeneration = 0;
let pendingPairSessionId;
let disconnecting = false;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
]);

class BridgeSessionGoneError extends Error {}

async function sessionGet() {
  const { pairing } = await chrome.storage.session.get("pairing");
  return pairing;
}

async function setStatus(status, detail = "") {
  await chrome.storage.session.set({ helperStatus: { status, detail, at: Date.now() } });
}

async function assertCurrentPairing(pairing) {
  const current = await sessionGet();
  if (
    !current
    || current.sessionId !== pairing.sessionId
    || current.token !== pairing.token
    || disconnecting
    || (pendingPairSessionId && pendingPairSessionId !== pairing.sessionId)
  ) {
    throw new BridgeSessionGoneError("Pairing was replaced or closed.");
  }
  return current;
}

async function setSessionStatus(pairing, status, detail = "") {
  await assertCurrentPairing(pairing);
  await setStatus(status, detail);
}

async function clearPairing(pairing, detail) {
  try {
    await assertCurrentPairing(pairing);
  } catch {
    return false;
  }
  await chrome.storage.session.remove("pairing");
  await setStatus("disconnected", detail);
  return true;
}

async function pair(message, sender, generation) {
  if (!sender.tab?.id || !sender.tab.url || !message.bridgeOrigin || !message.sessionId || !message.token) throw new Error("Pairing tab is missing.");
  const senderOrigin = assertPairingPageUrl(sender.tab.url);
  if (senderOrigin !== message.bridgeOrigin) throw new Error("Pairing origin mismatch.");
  const credentials = validatePairingCredentials(message.sessionId, message.token);
  const pairing = {
    bridgeOrigin: message.bridgeOrigin,
    ...credentials,
    tabId: sender.tab.id,
    failures: 0,
  };
  const response = await fetch(`${pairing.bridgeOrigin}/v1/extension/pair`, {
    method: "POST",
    headers: authHeaders(pairing.token, true),
    body: JSON.stringify({ sessionId: pairing.sessionId, extensionVersion: EXTENSION_VERSION }),
  });
  if (response.status !== 204) throw new Error(`Bridge rejected pairing (${response.status}).`);
  if (generation !== pairingGeneration) throw new Error("Pairing was superseded by a newer request.");
  await chrome.storage.session.set({ pairing });
  if (generation !== pairingGeneration) throw new Error("Pairing was superseded by a newer request.");
  pendingPairSessionId = undefined;
  await setStatus("connected", "Đã ghép nối với Tool Dịch Truyện.");
}

async function resetFailures(pairing) {
  if (!pairing.failures) return;
  const current = await assertCurrentPairing(pairing);
  current.failures = 0;
  pairing.failures = 0;
  await chrome.storage.session.set({ pairing: current });
}

async function recordNetworkFailure(pairing, error) {
  let current;
  try {
    current = await assertCurrentPairing(pairing);
  } catch {
    return { connected: false };
  }
  const state = nextPollFailureState(current.failures);
  if (!state.connected) {
    await clearPairing(pairing, "Không thể liên lạc với Tool Dịch Truyện sau 3 lần thử.");
    return { connected: false, error: safeError(error) };
  }
  current.failures = state.failures;
  await chrome.storage.session.set({ pairing: current });
  await setSessionStatus(pairing, "disconnected", `Mất kết nối tạm thời (${state.failures}/3).`);
  return { connected: true, retryAfterMs: 1_000, error: safeError(error) };
}

async function timedCommandPoll(pairing) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_HTTP_TIMEOUT_MS);
  try {
    return await fetch(`${pairing.bridgeOrigin}/v1/extension/commands`, {
      // POST reliably forces Edge's strict CORS preflight/extension Origin;
      // keep the session identifier in JSON rather than the URL.
      method: "POST",
      headers: authHeaders(pairing.token, true),
      body: JSON.stringify({ sessionId: pairing.sessionId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sendResult(pairing, body) {
  await assertCurrentPairing(pairing);
  const response = await fetch(`${pairing.bridgeOrigin}/v1/extension/results`, {
    method: "POST",
    headers: authHeaders(pairing.token, true),
    body: JSON.stringify({ sessionId: pairing.sessionId, ...body }),
  });
  if (response.status === 204 || response.status === 409) return;
  if ([401, 403, 404, 410].includes(response.status)) throw new BridgeSessionGoneError("Bridge session is no longer available.");
  throw new Error(`Bridge rejected result (${response.status}).`);
}

async function tabComplete(tabId, expectedUrl) {
  const started = Date.now();
  while (Date.now() - started < COMMAND_TIMEOUT_MS) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { throw new Error("Paired browser tab was closed."); }
    let current;
    try { current = normalizeCompanionUrl(tab.url); } catch { current = undefined; }
    try {
      if (companionPageIdentity(current) === companionPageIdentity(expectedUrl) && tab.status === "complete") return;
    } catch {
      // Keep waiting until the tab reaches the exact allow-listed page identity.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the allow-listed story page to finish loading.");
}

async function collectSnapshot(tabId, requestedUrl) {
  // Exactly one current-DOM snapshot per command. The app owns all bounded
  // passive-verification polling and sends a new same-URL command when needed.
  const reply = await withTimeout(
    chrome.tabs.sendMessage(tabId, { type: "collect-snapshot", requestedUrl }),
    SNAPSHOT_TIMEOUT_MS,
    "Timed out collecting page content.",
  );
  if (!reply?.ok || !reply.snapshot) throw new Error(reply?.error || "Content script returned no snapshot.");
  return reply.snapshot;
}

async function advanceCatalogSnapshot(tabId, requestedUrl) {
  // `advance-catalog-page` is a fixed content-script operation: it clicks
  // only #pagination #nextPage after validating the current Huli catalog and
  // waits for #chapterList to change.  No selector or script originates from
  // the app/bridge command.
  const reply = await withTimeout(
    chrome.tabs.sendMessage(tabId, { type: "advance-catalog-page", requestedUrl }),
    CATALOG_NEXT_TIMEOUT_MS,
    "Timed out advancing the Huliwang catalog page.",
  );
  if (!reply?.ok || !reply.snapshot) throw new Error(reply?.error || "Content script did not advance the catalog.");
  return reply.snapshot;
}

function chapterReference(rawUrl) {
  const normalizedUrl = normalizeHuliUrl(rawUrl);
  const match = /^\/(\d+)\/(\d+)(?:\/(\d+))?\.html$/u.exec(new URL(normalizedUrl).pathname);
  if (!match?.[1] || !match[2]) throw new Error("The Huliwang reader target is not a chapter page.");
  return {
    bookId: match[1],
    chapterKey: match[2],
    page: match[3] ? Number.parseInt(match[3], 10) : 1,
    normalizedUrl,
  };
}

async function resolveChapterNextTarget(tabId, currentUrl) {
  // The page only returns its strictly validated data-url. The worker owns
  // actual navigation so a normal full reader navigation survives tab reload.
  const reply = await withTimeout(
    chrome.tabs.sendMessage(tabId, { type: "resolve-chapter-next", requestedUrl: currentUrl }),
    CHAPTER_NEXT_TIMEOUT_MS,
    "Timed out resolving the Huliwang chapter next-page target.",
  );
  if (!reply?.ok || typeof reply.nextUrl !== "string") {
    throw new Error(reply?.error || "Content script did not resolve a chapter target.");
  }
  const current = chapterReference(currentUrl);
  const next = chapterReference(reply.nextUrl);
  if (
    next.bookId !== current.bookId
    || next.chapterKey !== current.chapterKey
    || next.page !== current.page + 1
  ) throw new Error("The Huliwang reader next-page target is unsafe.");
  return next.normalizedUrl;
}

async function advanceChapterNavigation(tabId, currentUrl) {
  const nextUrl = await resolveChapterNextTarget(tabId, currentUrl);
  await chrome.tabs.update(tabId, { url: nextUrl });
  await tabComplete(tabId, nextUrl);
  await delay(250);
  // Keep the command's current-page URL as requestedUrl. The bridge validates
  // that field against its pending command, then separately validates the
  // actual snapshot URL as the safe sequential next page.
  return collectSnapshot(tabId, currentUrl);
}

async function execute(pairing, command) {
  await setSessionStatus(pairing, "working", `Đang đọc ${command.url}`);
  try {
    await assertCurrentPairing(pairing);
    let tab;
    try { tab = await chrome.tabs.get(pairing.tabId); } catch { tab = undefined; }
    let snapshot;
    if (command.type === "catalog-next") {
      if (!tab?.id) throw new Error("The paired Huliwang catalog tab was closed.");
      let currentUrl;
      try { currentUrl = normalizeHuliUrl(tab.url); } catch { currentUrl = undefined; }
      if (!currentUrl || huliPageIdentity(currentUrl) !== huliPageIdentity(command.url)) {
        throw new Error("The paired tab is no longer the requested Huliwang catalog.");
      }
      snapshot = await advanceCatalogSnapshot(tab.id, command.url);
    } else if (command.type === "chapter-next") {
      if (!tab?.id) throw new Error("The paired Huliwang chapter tab was closed.");
      let currentUrl;
      try { currentUrl = normalizeHuliUrl(tab.url); } catch { currentUrl = undefined; }
      if (!currentUrl || huliPageIdentity(currentUrl) !== huliPageIdentity(command.url)) {
        throw new Error("The paired tab is no longer the requested Huliwang chapter.");
      }
      snapshot = await advanceChapterNavigation(tab.id, currentUrl);
    } else {
      const action = pairedTabAction(tab?.url, command.url, Boolean(tab));
      if (action.type === "create") {
        tab = await chrome.tabs.create({ url: action.url, active: true });
        const currentPairing = await assertCurrentPairing(pairing);
        currentPairing.tabId = tab.id;
        pairing.tabId = tab.id;
        await chrome.storage.session.set({ pairing: currentPairing });
      } else if (action.type === "navigate") {
        await assertCurrentPairing(pairing);
        tab = await chrome.tabs.update(pairing.tabId, { url: action.url });
      }
      if (!tab?.id) throw new Error("Could not create or reuse the paired browser tab.");
      if (mustWaitForPairedTab(action.type, tab.status)) await tabComplete(tab.id, command.url);
      await delay(250);
      snapshot = await collectSnapshot(tab.id, command.url);
    }
    await sendResult(pairing, { commandId: command.id, ok: true, snapshot });
    await setSessionStatus(pairing, "connected", `Đã đọc xong ${command.url}`);
    return { reportedError: false };
  } catch (error) {
    if (error instanceof BridgeSessionGoneError) throw error;
    await sendResult(pairing, { commandId: command.id, ok: false, error: safeError(error) });
    await setSessionStatus(pairing, "error", safeError(error));
    return { reportedError: true };
  }
}

async function pollOnce(pairing) {
  let response;
  try {
    response = await timedCommandPoll(pairing);
  } catch (error) {
    return recordNetworkFailure(pairing, error);
  }

  try {
    await assertCurrentPairing(pairing);
  } catch {
    return { connected: false };
  }

  const status = classifyCommandPollStatus(response.status);
  if (status === "gone") {
    await clearPairing(pairing, "Phiên kết nối Tool Dịch Truyện đã kết thúc.");
    return { connected: false };
  }
  if (status === "busy") return { connected: true, retryAfterMs: 1_000 };
  if (status !== "ok") return recordNetworkFailure(pairing, new Error(`Bridge command poll failed (${response.status}).`));

  let payload;
  try {
    payload = await response.json();
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.commands) || payload.commands.length > 1) {
      throw new TypeError("Bridge returned an invalid command payload.");
    }
  } catch (error) {
    return recordNetworkFailure(pairing, error);
  }

  await resetFailures(pairing);
  const rawCommand = payload.commands[0];
  if (!rawCommand) {
    await setSessionStatus(pairing, "connected", "Đã kết nối, đang chờ yêu cầu.");
    return { connected: true, retryAfterMs: 0, commandProcessed: false };
  }

  let command;
  try {
    command = validateCompanionCommand(rawCommand);
  } catch (error) {
    if (typeof rawCommand?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(rawCommand.id)) {
      return recordNetworkFailure(pairing, error);
    }
    try {
      await sendResult(pairing, { commandId: rawCommand.id, ok: false, error: safeError(error) });
    } catch (sendError) {
      if (sendError instanceof BridgeSessionGoneError) {
        await clearPairing(pairing, "Phiên kết nối Tool Dịch Truyện đã kết thúc.");
        return { connected: false };
      }
      return recordNetworkFailure(pairing, sendError);
    }
    return { connected: true, retryAfterMs: 0, commandProcessed: true };
  }

  try {
    const result = await execute(pairing, command);
    return { connected: true, retryAfterMs: 0, commandProcessed: true, ...result };
  } catch (error) {
    if (error instanceof BridgeSessionGoneError) {
      await clearPairing(pairing, "Phiên kết nối Tool Dịch Truyện đã kết thúc.");
      return { connected: false };
    }
    return recordNetworkFailure(pairing, error);
  }
}

async function coalescedPoll() {
  const pairing = await sessionGet();
  if (!pairing) return { connected: false };
  if (inFlightPoll?.sessionId === pairing.sessionId) return inFlightPoll.promise;
  const operation = pollOnce(pairing);
  const tracked = operation.finally(() => {
    if (inFlightPoll?.promise === tracked) inFlightPoll = undefined;
  });
  inFlightPoll = { sessionId: pairing.sessionId, promise: tracked };
  return tracked;
}

function postPortMessage(port, state, message) {
  if (state.disconnected) return false;
  try {
    port.postMessage(message);
    return true;
  } catch {
    state.disconnected = true;
    return false;
  }
}

async function runHeartbeatPort(port, state) {
  const initialDeadline = Date.now() + 10_000;
  let everConnected = false;
  while (!state.disconnected) {
    const pairing = await sessionGet();
    if (!pairing) {
      if (everConnected || Date.now() >= initialDeadline) {
        postPortMessage(port, state, { connected: false });
        break;
      }
      postPortMessage(port, state, { connected: false, awaitingPairing: true });
      await delay(100);
      continue;
    }

    everConnected = true;
    let result;
    try {
      result = await coalescedPoll();
    } catch (error) {
      const current = await sessionGet();
      result = current ? await recordNetworkFailure(current, error) : { connected: false };
    }
    if (!postPortMessage(port, state, result) || !result?.connected) break;
    const requestedDelay = Number(result.retryAfterMs);
    if (Number.isFinite(requestedDelay) && requestedDelay > 0) {
      await delay(Math.min(5_000, Math.max(25, Math.trunc(requestedDelay))));
    }
  }
  if (!state.disconnected) {
    state.disconnected = true;
    try { port.disconnect(); } catch { /* already disconnected */ }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  const senderUrl = resolveHeartbeatSenderUrl(port.sender);
  if (
    port.name !== HEARTBEAT_PORT_NAME
    || !port.sender?.tab?.id
    || !senderUrl
  ) {
    try { port.disconnect(); } catch { /* invalid port already closed */ }
    return;
  }
  const state = { disconnected: false };
  port.onDisconnect.addListener(() => { state.disconnected = true; });
  void runHeartbeatPort(port, state).catch(() => {
    state.disconnected = true;
    try { port.disconnect(); } catch { /* already disconnected */ }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pair") {
    const generation = ++pairingGeneration;
    pendingPairSessionId = typeof message.sessionId === "string" ? message.sessionId : "invalid";
    disconnecting = false;
    void pair(message, sender, generation).then(() => sendResponse({ ok: true }), (error) => {
      if (generation === pairingGeneration) {
        pendingPairSessionId = undefined;
        void setStatus("error", safeError(error));
      }
      sendResponse({ ok: false, error: safeError(error) });
    });
    return true;
  }
  if (message?.type === "pair-error") void setStatus("error", safeError(message.message));
  if (message?.type === "disconnect") {
    pairingGeneration += 1;
    pendingPairSessionId = undefined;
    disconnecting = true;
    void chrome.storage.session.remove("pairing").then(() => setStatus("idle", "Đã ngắt kết nối.")).finally(() => { disconnecting = false; });
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => { void setStatus("idle", "Chưa ghép nối."); });
