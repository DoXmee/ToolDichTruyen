import { BrowserWindow, screen, session } from "electron";
import { existsSync } from "node:fs";
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
// The custom Windows title bar consumes vertical room on short laptop screens.
// This reference keeps the complete workspace visible without restoring panel
// scrollbars or clipping controls.
const COMPACT_WORKSPACE_REFERENCE_HEIGHT = 870;
const COMPACT_WORKSPACE_REFERENCE_WIDTH = 1_200;
const MINIMUM_COMPACT_WORKSPACE_ZOOM = 0.76;

export function compactWorkspaceZoomFactor(contentHeight: number, contentWidth = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return 1;
  const widthFactor = Number.isFinite(contentWidth) && contentWidth > 0
    ? contentWidth / COMPACT_WORKSPACE_REFERENCE_WIDTH
    : 1;
  return Math.max(
    MINIMUM_COMPACT_WORKSPACE_ZOOM,
    Math.min(1, contentHeight / COMPACT_WORKSPACE_REFERENCE_HEIGHT, widthFactor),
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
  // Windows taskbar uses the BrowserWindow icon, not only the executable's icon.
  // Keep it identical to the desktop shortcut and the app's book mark.
  const packagedIcon = path.join(process.resourcesPath, "ToolDichTruyen.ico");
  // Electron's development/test executable has a different resources folder.
  // Fall back to the same source asset so the smoke app exercises the window
  // icon path without failing before its renderer becomes available.
  const icon = existsSync(packagedIcon)
    ? packagedIcon
    : path.join(process.cwd(), "build", "tool-dich-truyen.ico");
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 720,
    minHeight: 560,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#181818",
    icon,
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

  let pendingZoomTimer: ReturnType<typeof setTimeout> | undefined;
  const clearPendingWorkspaceZoom = (): void => {
    if (pendingZoomTimer === undefined) return;
    clearTimeout(pendingZoomTimer);
    pendingZoomTimer = undefined;
  };
  const applyCompactWorkspaceZoom = (allowHidden = false) => {
    pendingZoomTimer = undefined;
    if (
      window.isDestroyed()
      || window.isMinimized()
      || (!allowHidden && !window.isVisible())
      || window.webContents.isDestroyed()
    ) return;
    const bounds = window.getContentBounds();
    // Content bounds can still cover the auto-hide taskbar while Windows is
    // showing it. The display work area is the authoritative usable region.
    const workArea = screen.getDisplayMatching(window.getBounds()).workAreaSize;
    const targetFactor = compactWorkspaceZoomFactor(
      Math.min(bounds.height, workArea.height),
      Math.min(bounds.width, workArea.width),
    );
    if (Math.abs(window.webContents.getZoomFactor() - targetFactor) < 0.001) return;
    window.webContents.setZoomFactor(targetFactor);
  };
  const scheduleCompactWorkspaceZoom = (delay = 80): void => {
    clearPendingWorkspaceZoom();
    pendingZoomTimer = setTimeout(applyCompactWorkspaceZoom, delay);
  };

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!navigationAllowed(targetUrl, options.devServerUrl)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  // On Windows, BrowserWindow's `resize` event may run before the new client
  // height is observable. Defer once so zoom is based on the final bounds,
  // including programmatic setContentSize calls used by a compact workspace.
  window.on("resize", () => scheduleCompactWorkspaceZoom());
  window.on("minimize", clearPendingWorkspaceZoom);
  window.on("restore", () => scheduleCompactWorkspaceZoom());
  window.on("maximize", () => scheduleCompactWorkspaceZoom());
  window.on("unmaximize", () => scheduleCompactWorkspaceZoom());
  window.on("enter-full-screen", () => scheduleCompactWorkspaceZoom());
  window.on("leave-full-screen", () => scheduleCompactWorkspaceZoom());
  // Windows changes a maximized window's usable bounds when the taskbar is
  // hidden/shown or when it moves between displays. Refit after those display
  // metric events instead of leaving the bottom controls clipped.
  const onDisplayMetricsChanged = (): void => scheduleCompactWorkspaceZoom(100);
  screen.on("display-metrics-changed", onDisplayMetricsChanged);
  window.once("closed", () => {
    clearPendingWorkspaceZoom();
    screen.removeListener("display-metrics-changed", onDisplayMetricsChanged);
  });
  window.webContents.on("did-finish-load", () => applyCompactWorkspaceZoom(true));
  window.once("ready-to-show", () => {
    // Windows can otherwise retain Electron's fallback taskbar icon from the
    // first window frame. Reapply our packaged icon before the window appears.
    window.setIcon(icon);
    applyCompactWorkspaceZoom(true);
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
