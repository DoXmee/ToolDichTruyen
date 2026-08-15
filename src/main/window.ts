import { BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface CreateMainWindowOptions {
  devServerUrl?: string;
  onCreated?: (window: BrowserWindow) => void;
}

/**
 * Keep the complete desktop workspace visible on short laptop displays without
 * turning individual workflow cards into independently scrolling panes.
 */
// 792px is the largest tested reference that still leaves the compact desktop
// CSS branch active at 1366x720, so the workspace uses the available height
// without restoring panel scrollbars or clipping controls.
const COMPACT_WORKSPACE_REFERENCE_HEIGHT = 792;
const MINIMUM_COMPACT_WORKSPACE_ZOOM = 0.76;

export function compactWorkspaceZoomFactor(contentHeight: number): number {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return 1;
  return Math.max(
    MINIMUM_COMPACT_WORKSPACE_ZOOM,
    Math.min(1, contentHeight / COMPACT_WORKSPACE_REFERENCE_HEIGHT),
  );
}

function moduleDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function navigationAllowed(targetUrl: string, devServerUrl?: string): boolean {
  if (!devServerUrl) {
    try {
      const expected = pathToFileURL(path.join(moduleDirectory(), "../renderer/index.html"));
      const candidate = new URL(targetUrl);
      candidate.hash = "";
      candidate.search = "";
      return candidate.href === expected.href;
    } catch {
      return false;
    }
  }
  try {
    return new URL(targetUrl).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

export async function createMainWindow(options: CreateMainWindowOptions = {}): Promise<BrowserWindow> {
  // Sandboxed preload scripts are emitted as explicit CommonJS bundles.
  const preload = path.join(moduleDirectory(), "../preload/index.cjs");
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    title: "Tool dịch truyện Trung - Việt",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  const applyCompactWorkspaceZoom = () => {
    const targetFactor = compactWorkspaceZoomFactor(window.getContentBounds().height);
    if (Math.abs(window.webContents.getZoomFactor() - targetFactor) < 0.001) return;
    window.webContents.setZoomFactor(targetFactor);
  };

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!navigationAllowed(targetUrl, options.devServerUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  // On Windows, BrowserWindow's `resize` event may run before the new client
  // height is observable. Defer once so zoom is based on the final bounds,
  // including programmatic setContentSize calls used by a compact workspace.
  window.on("resize", () => { setTimeout(applyCompactWorkspaceZoom, 0); });
  window.webContents.on("did-finish-load", applyCompactWorkspaceZoom);
  window.once("ready-to-show", () => {
    applyCompactWorkspaceZoom();
    window.show();
  });
  options.onCreated?.(window);

  if (options.devServerUrl) {
    await window.loadURL(options.devServerUrl);
  } else {
    await window.loadFile(path.join(moduleDirectory(), "../renderer/index.html"));
  }
  return window;
}

export function hardenDefaultSession(isDevelopment: boolean, devServerUrl?: string): void {
  const trustedRenderer = (url: string): boolean => navigationAllowed(url, devServerUrl);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write" && trustedRenderer(webContents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(
      webContents &&
        permission === "clipboard-sanitized-write" &&
        trustedRenderer(webContents.getURL()),
    ),
  );
  session.defaultSession.on("will-download", (event) => event.preventDefault());

  if (!isDevelopment) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (!details.url.startsWith("file://")) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
              "object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
          ],
        },
      });
    });
  }
}
