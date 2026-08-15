const PREFIX = "#tdt-pair=";
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/u;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/u;
const HEARTBEAT_PORT_NAME = "huli-heartbeat";
let heartbeatPort;
let heartbeatReconnects = 0;

function connectHeartbeat() {
  if (heartbeatPort || heartbeatReconnects >= 3) return;
  heartbeatReconnects += 1;
  try {
    const port = chrome.runtime.connect({ name: HEARTBEAT_PORT_NAME });
    heartbeatPort = port;
    port.onDisconnect.addListener(() => {
      if (heartbeatPort === port) heartbeatPort = undefined;
      setTimeout(connectHeartbeat, 100);
    });
  } catch {
    setTimeout(connectHeartbeat, 100);
  }
}

function pairingData(rawHash) {
  if (location.protocol !== "http:" || location.hostname !== "127.0.0.1" || location.pathname !== "/v1/pair" || location.search) throw new TypeError("Invalid pairing page.");
  const port = Number(location.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new TypeError("Invalid bridge port.");
  const encoded = rawHash.slice(PREFIX.length);
  if (!BASE64URL.test(encoded) || encoded.length > 768) throw new TypeError("Invalid pairing fragment.");
  const padded = encoded.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const payload = JSON.parse(atob(padded));
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).sort().join(",") !== "sessionId,token") throw new TypeError("Invalid pairing payload.");
  if (!SESSION_ID.test(payload.sessionId) || !TOKEN.test(payload.token)) throw new TypeError("Invalid pairing credentials.");
  return { bridgeOrigin: `http://127.0.0.1:${port}`, sessionId: payload.sessionId, token: payload.token };
}

if (location.hash.startsWith(PREFIX)) {
  const rawHash = location.hash;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  try {
    const data = pairingData(rawHash);
    // This exact script is proven to run whenever Pair POST succeeds. Open the
    // Port here instead of relying on a separate content-script file/order.
    connectHeartbeat();
    void chrome.runtime.sendMessage({ type: "pair", ...data });
  } catch (error) {
    chrome.runtime.sendMessage({ type: "pair-error", message: error instanceof Error ? error.message : "Pairing failed." });
  }
}
