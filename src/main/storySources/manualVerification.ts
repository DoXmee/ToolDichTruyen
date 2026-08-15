import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  StorySourceError,
  type ManualVerificationLauncher,
  type ManualVerificationLaunchOptions,
} from "./types.js";

const execFileAsync = promisify(execFile);

/** The only association registry entry that decides a user's HTTPS browser. */
export const WINDOWS_HTTPS_USER_CHOICE_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice";

export interface WindowsRegistryReader {
  /**
   * Returns an unexpanded string registry value, or undefined when the key or
   * named value is absent.  Keeping this small makes the Windows boundary
   * deterministic in tests and avoids exposing any browser profile data.
   */
  readString(key: string, valueName?: string): Promise<string | undefined>;
}

export interface DefaultBrowserProcessLauncher {
  /** Launches an already validated ordinary browser command without a shell. */
  launch(executable: string, args: readonly string[]): Promise<void>;
}

export interface ResolvedWindowsDefaultBrowser {
  progId: string;
  browserName: "Microsoft Edge" | "Google Chrome";
  executable: string;
  args: string[];
}

export interface DefaultBrowserLauncherDependencies {
  /**
   * Legacy test override.  When it is the only supplied dependency, this
   * deliberately bypasses OS dispatch exactly as earlier tests did.
   */
  openExternal?: (url: string) => Promise<void>;
  /** Injectable shell fallback for non-Windows or missing UserChoice. */
  shellOpenExternal?: (url: string) => Promise<void>;
  platform?: NodeJS.Platform;
  windowsRegistryReader?: WindowsRegistryReader;
  browserProcessLauncher?: DefaultBrowserProcessLauncher;
  environment?: NodeJS.ProcessEnv;
}

interface BrowserAssociationRule {
  browserName: ResolvedWindowsDefaultBrowser["browserName"];
  progId: RegExp;
  executableName: string;
  /** Blocks a generic executable name (especially browser.exe) outside its vendor installation. */
  trustedExecutablePath: RegExp;
}

const BROWSER_ASSOCIATION_RULES: readonly BrowserAssociationRule[] = [
  {
    browserName: "Microsoft Edge",
    progId: /^MSEdgeHTM(?:\.[A-Za-z\d._-]+)?$/iu,
    executableName: "msedge.exe",
    trustedExecutablePath: /\\microsoft\\edge(?: [^\\]+)?\\application\\msedge\.exe$/iu,
  },
  {
    browserName: "Google Chrome",
    progId: /^ChromeHTML(?:\.[A-Za-z\d._-]+)?$/iu,
    executableName: "chrome.exe",
    trustedExecutablePath: /\\google\\chrome(?: [^\\]+)?\\application\\chrome\.exe$/iu,
  },
];

const FORBIDDEN_BROWSER_ARGUMENTS = [
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--user-data-dir",
  "--profile-directory",
  "--headless",
  "--enable-automation",
  "--no-sandbox",
  "--load-extension",
  "--disable-web-security",
  "--incognito",
  "--guest",
] as const;

function assertPairingUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new StorySourceError("UNSUPPORTED_URL", "URL ghép nối trình duyệt không hợp lệ.", { cause: error });
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/v1/pair"
    || url.search
    || !/^#tdt-pair=[A-Za-z\d_-]{80,1024}$/u.test(url.hash)
  ) {
    throw new StorySourceError(
      "UNSUPPORTED_URL",
      "Chỉ được mở trang ghép nối Huliwang cục bộ do tool tạo.",
    );
  }

  try {
    const encoded = url.hash.slice("#tdt-pair=".length);
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("bad payload");
    const record = payload as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2
      || typeof record.sessionId !== "string"
      || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(record.sessionId)
      || typeof record.token !== "string"
      || !/^[A-Za-z\d_-]{43}$/u.test(record.token)
    ) {
      throw new Error("bad payload");
    }
  } catch (error) {
    throw new StorySourceError("UNSUPPORTED_URL", "Dữ liệu ghép nối trình duyệt không hợp lệ.", { cause: error });
  }
  return url.toString();
}

function registryCommandKey(progId: string): string {
  return `HKCR\\${progId}\\shell\\open\\command`;
}

function registryValueFromRegQuery(output: string): string | undefined {
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*(?:\(Default\)|[^\s]+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/iu.exec(line);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

const nativeWindowsRegistryReader: WindowsRegistryReader = {
  async readString(key, valueName) {
    const args = valueName === undefined
      ? ["query", key, "/ve"]
      : ["query", key, "/v", valueName];
    try {
      const { stdout } = await execFileAsync("reg.exe", args, {
        windowsHide: true,
        encoding: "utf8",
      });
      return registryValueFromRegQuery(stdout);
    } catch (error) {
      // reg.exe uses exit code 1 for an absent key/value.  That is the one
      // case where Windows' normal dispatcher remains an appropriate fallback.
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 1) {
        return undefined;
      }
      throw error;
    }
  },
};

function splitWindowsCommandLine(command: string): string[] {
  const args: string[] = [];
  let index = 0;

  while (index < command.length) {
    while (/\s/u.test(command[index] ?? "")) index += 1;
    if (index >= command.length) break;

    let argument = "";
    let inQuotes = false;
    while (index < command.length) {
      const current = command[index]!;
      if (current === "\\") {
        let slashCount = 0;
        while (command[index] === "\\") {
          slashCount += 1;
          index += 1;
        }
        if (command[index] === '"') {
          argument += "\\".repeat(Math.floor(slashCount / 2));
          if (slashCount % 2 === 1) {
            argument += '"';
          } else if (inQuotes && command[index + 1] === '"') {
            argument += '"';
            index += 1;
          } else {
            inQuotes = !inQuotes;
          }
          index += 1;
          continue;
        }
        argument += "\\".repeat(slashCount);
        continue;
      }
      if (current === '"') {
        inQuotes = !inQuotes;
        index += 1;
        continue;
      }
      if (/\s/u.test(current) && !inQuotes) break;
      argument += current;
      index += 1;
    }
    if (inQuotes) throw new Error("Dòng lệnh registry có dấu nháy không cân bằng.");
    if (!argument) throw new Error("Dòng lệnh registry có đối số rỗng không hợp lệ.");
    args.push(argument);
    while (/\s/u.test(command[index] ?? "")) index += 1;
  }
  return args;
}

function environmentValue(name: string, environment: NodeJS.ProcessEnv): string | undefined {
  const exact = environment[name];
  if (typeof exact === "string") return exact;
  const actualName = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase());
  return actualName ? environment[actualName] : undefined;
}

function expandWindowsEnvironment(input: string, environment: NodeJS.ProcessEnv): string {
  return input.replace(/%([^%]+)%/gu, (whole, variable: string) => {
    const value = environmentValue(variable, environment);
    if (!value) throw new Error(`Biến môi trường %${variable}% trong liên kết trình duyệt không tồn tại.`);
    return value;
  });
}

function associationError(message: string, cause?: unknown): StorySourceError {
  return new StorySourceError(
    "SOURCE_BLOCKED",
    `Liên kết HTTPS của Windows không hợp lệ: ${message}`,
    cause === undefined ? undefined : { cause },
  );
}

function associationRuleFor(progId: string): BrowserAssociationRule {
  if (!/^[A-Za-z\d._-]{1,128}$/u.test(progId)) {
    throw associationError("ProgId mặc định chứa ký tự không an toàn.");
  }
  const rule = BROWSER_ASSOCIATION_RULES.find((candidate) => candidate.progId.test(progId));
  if (!rule) {
    throw associationError(
      `ProgId \"${progId}\" không phải Microsoft Edge hoặc Google Chrome. `
      + "Hãy đặt Edge hoặc Chrome làm trình duyệt mặc định cho liên kết HTTPS rồi thử lại.",
    );
  }
  return rule;
}

function hasForbiddenBrowserArgument(argument: string): boolean {
  const normalized = argument.toLowerCase();
  return FORBIDDEN_BROWSER_ARGUMENTS.some((forbidden) => normalized === forbidden || normalized.startsWith(`${forbidden}=`));
}

function resolveAssociationCommand(
  progId: string,
  command: string,
  pairingUrl: string,
  environment: NodeJS.ProcessEnv,
): ResolvedWindowsDefaultBrowser {
  const rule = associationRuleFor(progId);
  let tokens: string[];
  try {
    tokens = splitWindowsCommandLine(command.trim());
  } catch (error) {
    throw associationError("lệnh mở trình duyệt không đọc được.", error);
  }
  if (tokens.length < 2) {
    throw associationError("lệnh mở trình duyệt phải chứa đường dẫn chương trình và %1.");
  }

  let executable: string;
  let args: string[];
  try {
    executable = expandWindowsEnvironment(tokens[0]!, environment);
    args = tokens.slice(1).map((argument) => expandWindowsEnvironment(argument, environment));
  } catch (error) {
    throw associationError("không thể mở rộng đường dẫn chương trình mặc định.", error);
  }

  if (!path.win32.isAbsolute(executable)) {
    throw associationError("đường dẫn chương trình mặc định không phải đường dẫn tuyệt đối.");
  }
  const normalizedExecutable = executable.replaceAll("/", "\\");
  if (path.win32.basename(normalizedExecutable).toLowerCase() !== rule.executableName) {
    throw associationError(`ProgId \"${progId}\" phải mở ${rule.browserName}, không phải ${path.win32.basename(normalizedExecutable) || "chương trình khác"}.`);
  }
  if (!rule.trustedExecutablePath.test(normalizedExecutable)) {
    throw associationError(`đường dẫn ${rule.browserName} không nằm trong thư mục cài đặt thông thường.`);
  }

  let substitutedUrl = false;
  const resolvedArgs = args.map((argument) => argument.replace(/%[1l]/giu, () => {
    substitutedUrl = true;
    return pairingUrl;
  }));
  if (!substitutedUrl) {
    throw associationError("lệnh mở trình duyệt thiếu tham số URL %1.");
  }
  if (resolvedArgs.some((argument) => /%(?:\*|[2-9])/u.test(argument))) {
    throw associationError("lệnh mở trình duyệt chứa tham số liên kết không được hỗ trợ.");
  }
  if (resolvedArgs.some(hasForbiddenBrowserArgument)) {
    throw associationError("lệnh mở trình duyệt chứa cờ tự động hóa hoặc hồ sơ riêng không được phép.");
  }

  return {
    progId,
    browserName: rule.browserName,
    executable: normalizedExecutable,
    args: resolvedArgs,
  };
}

/**
 * Resolves the exact HTTPS UserChoice association.  It intentionally does not
 * inspect StartMenuInternet: that legacy value can point at a different
 * browser (for example Cốc Cốc) than Windows' actual HTTPS UserChoice.
 */
export async function resolveWindowsHttpsDefaultBrowser(
  pairingUrl: string,
  options: Pick<DefaultBrowserLauncherDependencies, "windowsRegistryReader" | "environment"> = {},
): Promise<ResolvedWindowsDefaultBrowser | undefined> {
  const registry = options.windowsRegistryReader ?? nativeWindowsRegistryReader;
  const rawProgId = await registry.readString(WINDOWS_HTTPS_USER_CHOICE_KEY, "ProgId");
  if (rawProgId === undefined) return undefined;
  const progId = rawProgId.trim();
  if (!progId) throw associationError("không tìm thấy ProgId HTTPS mặc định.");
  const command = await registry.readString(registryCommandKey(progId));
  if (!command?.trim()) {
    throw associationError(`không tìm thấy lệnh mở cho ProgId \"${progId}\".`);
  }
  return resolveAssociationCommand(progId, command, pairingUrl, options.environment ?? process.env);
}

async function electronOpenExternal(url: string): Promise<void> {
  const { shell } = await import("electron");
  await shell.openExternal(url);
}

const nativeBrowserProcessLauncher: DefaultBrowserProcessLauncher = {
  async launch(executable, args) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [...args], {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  },
};

function legacyOpenExternalOverride(dependencies: DefaultBrowserLauncherDependencies): ((url: string) => Promise<void>) | undefined {
  // Existing tests and isolated-browser tests intentionally inject only this
  // callback to avoid touching the real daily browser.  Keep that boundary
  // intact; production passes no dependencies and always resolves UserChoice.
  if (
    dependencies.openExternal
    && !dependencies.shellOpenExternal
    && !dependencies.platform
    && !dependencies.windowsRegistryReader
    && !dependencies.browserProcessLauncher
    && !dependencies.environment
  ) {
    return dependencies.openExternal;
  }
  return undefined;
}

/**
 * Opens the loopback-owned pairing page in the actual Windows HTTPS UserChoice
 * browser/profile.  On Windows this launches the exact registered Edge or
 * Chrome executable with only that association's normal URL
 * arguments. No CDP, automation, private profile, or Huliwang URL crosses
 * this boundary. Other platforms retain Electron's normal shell dispatcher.
 */
export async function launchDefaultBrowserPairingPage(
  options: ManualVerificationLaunchOptions,
  dependencies: DefaultBrowserLauncherDependencies = {},
): Promise<void> {
  const safeUrl = assertPairingUrl(options.url);
  const override = legacyOpenExternalOverride(dependencies);
  const shellOpenExternal = dependencies.shellOpenExternal ?? electronOpenExternal;
  if (override) {
    try {
      await override(safeUrl);
      return;
    } catch (error) {
      throw new StorySourceError(
        "SOURCE_BLOCKED",
        "Không thể mở trình duyệt mặc định để kết nối Huliwang Companion.",
        { cause: error },
      );
    }
  }

  try {
    if ((dependencies.platform ?? process.platform) === "win32") {
      const browser = await resolveWindowsHttpsDefaultBrowser(safeUrl, dependencies);
      if (browser) {
        await (dependencies.browserProcessLauncher ?? nativeBrowserProcessLauncher).launch(browser.executable, browser.args);
        return;
      }
    }
    // A missing UserChoice is the one safe Windows fallback.  Do not fall back
    // after a malformed/unapproved association, otherwise StartMenuInternet
    // could silently launch a different browser than HTTPS actually selected.
    await shellOpenExternal(safeUrl);
  } catch (error) {
    if (error instanceof StorySourceError) throw error;
    throw new StorySourceError(
      "SOURCE_BLOCKED",
      "Không thể mở trình duyệt mặc định để kết nối Huliwang Companion.",
      { cause: error },
    );
  }
}

export const defaultManualVerificationLauncher: ManualVerificationLauncher = async (options) =>
  launchDefaultBrowserPairingPage(options);

/** @deprecated Compatibility boundary; now opens only a loopback pairing page. */
export const launchManualHuliwangVerification = launchDefaultBrowserPairingPage;
/** @deprecated Native browser process spawning was removed in favor of OS default-browser dispatch. */
export interface NativeBrowserProcess {
  once(event: "spawn" | "error", listener: (() => void) | ((error: Error) => void)): this;
  unref(): void;
}
/** @deprecated Native browser process spawning was removed in favor of OS default-browser dispatch. */
export interface NativeBrowserSpawnOptions {
  detached: true;
  stdio: "ignore";
  windowsHide: false;
}
