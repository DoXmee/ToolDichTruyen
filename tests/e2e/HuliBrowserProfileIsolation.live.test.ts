// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ChatGptWebAdapter } from "../../src/main/chatgpt/ChatGptWebAdapter";
import { HuliwangBrowserBridge } from "../../src/main/storySources/HuliwangBrowserBridge";
import { launchDefaultBrowserPairingPage } from "../../src/main/storySources/manualVerification";

const execFileAsync = promisify(execFile);
const live = process.env.RUN_HULI_PROFILE_ISOLATION_LIVE === "1" ? describe : describe.skip;
const WORKSPACE = path.resolve(import.meta.dirname, "..", "..");
const EXTENSION_DIRECTORY = path.join(WORKSPACE, "resources", "huli-browser-helper");
const REPORT_DIRECTORY = path.join(WORKSPACE, "test-results");
const REPORT_PATH = path.join(REPORT_DIRECTORY, "huli-browser-profile-isolation-live.json");
const TEMP_PREFIX = "tdt-huli-isolation-live-";
const FORBIDDEN_ORDINARY_FLAGS = [
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--enable-automation",
  "--headless",
  "--no-sandbox",
  "--disable-web-security",
];

interface ProcessEvidence {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  ExecutablePath?: string;
  CommandLine: string;
}

interface IsolationReport {
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  browser?: { executable: string; version: string };
  chatGptProfile?: string;
  ordinaryHelperProfile?: string;
  chatGptStatus?: string;
  paired?: boolean;
  launchBoundary: {
    productionUrlValidationExercised: boolean;
    injectedSafeOpenExternalExercised: boolean;
    electronShellOpenExternalExercised: false;
    reasonElectronDispatcherSkipped: string;
  };
  chatGptProcesses?: ProcessEvidence[];
  ordinaryHelperProcesses?: ProcessEvidence[];
  assertions?: {
    processSetsDisjoint: boolean;
    chatGptHasRemoteDebuggingPipe: boolean;
    pairingUrlAbsentFromChatGptTree: boolean;
    pairingUrlPresentOnlyInOrdinaryRoot: boolean;
    ordinaryHasHelperExtension: boolean;
    ordinaryForbiddenFlags: string[];
  };
  cleanup?: {
    chatGptProcessesAfterClose: number;
    ordinaryProcessesBeforeStop: number;
    ordinaryProcessesAfterStop: number;
    profilesRemoved: boolean;
  };
  error?: string;
}

async function powershell(command: string, environment: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function findEdge(): Promise<{ executable: string; version: string }> {
  const candidates = [
    path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  for (const executable of candidates) {
    try {
      await access(executable);
      const version = await powershell("(Get-Item -LiteralPath $env:TDT_BROWSER).VersionInfo.FileVersion", { TDT_BROWSER: executable });
      return { executable, version };
    } catch {
      // Try the next Edge installation.
    }
  }
  throw new Error("Microsoft Edge is required for this Windows isolation test.");
}

async function assertOwnedTemp(directory: string): Promise<string> {
  const resolved = await realpath(directory);
  const root = await realpath(tmpdir());
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(resolved).startsWith(TEMP_PREFIX)) {
    throw new Error(`Refusing to manage a non-test profile: ${resolved}`);
  }
  return resolved;
}

async function profileProcesses(profile: string): Promise<ProcessEvidence[]> {
  const output = await powershell(
    "$needle=$env:TDT_PROFILE; $items=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -and $_.CommandLine.Contains($needle) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine); if($items.Count -eq 0){'[]'}else{$items | ConvertTo-Json -Compress}",
    { TDT_PROFILE: profile },
  );
  const parsed = JSON.parse(output || "[]") as ProcessEvidence | ProcessEvidence[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForProfileProcesses(profile: string, timeoutMs = 15_000): Promise<ProcessEvidence[]> {
  const deadline = Date.now() + timeoutMs;
  do {
    const found = await profileProcesses(profile);
    if (found.length) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`No browser process appeared for isolated profile ${profile}.`);
}

async function stopExactProfileProcesses(profile: string): Promise<void> {
  await powershell(
    "$needle=$env:TDT_PROFILE; $all=@(Get-CimInstance Win32_Process); $roots=@($all | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -and $_.CommandLine.Contains($needle) }); $ids=[System.Collections.Generic.HashSet[int]]::new(); foreach($root in $roots){[void]$ids.Add([int]$root.ProcessId)}; do{$added=$false; foreach($item in $all){if($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)){$added=$true}}}while($added); @($ids) | Sort-Object -Descending | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
    { TDT_PROFILE: profile },
  );
}

function spawned(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function redactSecret(value: string): string {
  return value.replace(/(#tdt-pair=)[A-Za-z\d_-]+/gu, "$1<redacted>");
}

function redacted(entries: ProcessEvidence[]): ProcessEvidence[] {
  return entries.map((entry) => ({ ...entry, CommandLine: redactSecret(entry.CommandLine) }));
}

live("ordinary Huli browser stays isolated from app-owned Playwright Edge (opt-in live)", () => {
  let chatAdapter: ChatGptWebAdapter | undefined;
  let bridge: HuliwangBrowserBridge | undefined;
  let ordinaryChild: ChildProcess | undefined;
  let rootDirectory = "";
  let chatGptProfile = "";
  let ordinaryProfile = "";
  const report: IsolationReport = {
    startedAt: new Date().toISOString(),
    ok: false,
    launchBoundary: {
      productionUrlValidationExercised: false,
      injectedSafeOpenExternalExercised: false,
      electronShellOpenExternalExercised: false,
      reasonElectronDispatcherSkipped: "The real Windows HTTPS dispatcher would open the user's existing default-browser profile; this safety test is forbidden from touching it.",
    },
  };

  afterAll(async () => {
    await bridge?.close().catch(() => undefined);
    await chatAdapter?.close().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const chatAfter = chatGptProfile ? await profileProcesses(chatGptProfile).catch(() => []) : [];
    const ordinaryBefore = ordinaryProfile ? await profileProcesses(ordinaryProfile).catch(() => []) : [];
    if (ordinaryProfile) await stopExactProfileProcesses(ordinaryProfile).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const ordinaryAfter = ordinaryProfile ? await profileProcesses(ordinaryProfile).catch(() => []) : [];
    ordinaryChild?.removeAllListeners();
    let profilesRemoved = false;
    if (rootDirectory && !chatAfter.length && !ordinaryAfter.length) {
      const verified = await assertOwnedTemp(rootDirectory);
      await rm(verified, { recursive: true, force: true });
      profilesRemoved = true;
    }
    report.cleanup = {
      chatGptProcessesAfterClose: chatAfter.length,
      ordinaryProcessesBeforeStop: ordinaryBefore.length,
      ordinaryProcessesAfterStop: ordinaryAfter.length,
      profilesRemoved,
    };
    report.finishedAt = new Date().toISOString();
    await mkdir(REPORT_DIRECTORY, { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  });

  it("keeps pairing URL and helper out of the ChatGPT remote-debugging process tree", async () => {
    try {
      report.browser = await findEdge();
      await access(path.join(EXTENSION_DIRECTORY, "manifest.json"));
      rootDirectory = await assertOwnedTemp(await mkdtemp(path.join(tmpdir(), TEMP_PREFIX)));
      chatGptProfile = path.join(rootDirectory, "chatgpt-tool-profile");
      ordinaryProfile = path.join(rootDirectory, "ordinary-helper-profile");
      await mkdir(chatGptProfile, { recursive: true });
      await mkdir(ordinaryProfile, { recursive: true });
      report.chatGptProfile = chatGptProfile;
      report.ordinaryHelperProfile = ordinaryProfile;

      chatAdapter = new ChatGptWebAdapter({
        profileDirectory: chatGptProfile,
        executablePath: report.browser.executable,
        headless: true,
      });
      try {
        report.chatGptStatus = (await chatAdapter.openLogin()).status;
      } catch (error) {
        // The profile/process boundary is testable even when ChatGPT itself is
        // unavailable. Keep only that non-secret diagnostic in the report.
        report.chatGptStatus = `open-error: ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`;
      }
      const chatProcesses = await waitForProfileProcesses(chatGptProfile);

      bridge = await new HuliwangBrowserBridge({ pairingTimeoutMs: 60_000, visitTimeoutMs: 30_000 }).start();
      await launchDefaultBrowserPairingPage(
        { url: bridge.pairingUrl },
        {
          openExternal: async (safePairingUrl) => {
            report.launchBoundary.injectedSafeOpenExternalExercised = true;
            ordinaryChild = spawn(report.browser!.executable, [
              `--user-data-dir=${ordinaryProfile}`,
              `--load-extension=${EXTENSION_DIRECTORY}`,
              "--no-first-run",
              "--no-default-browser-check",
              "--new-window",
              safePairingUrl,
            ], { detached: false, stdio: "ignore", windowsHide: false });
            await spawned(ordinaryChild);
          },
        },
      );
      report.launchBoundary.productionUrlValidationExercised = true;
      await bridge.waitUntilPaired();
      report.paired = true;
      const ordinaryProcesses = await waitForProfileProcesses(ordinaryProfile);

      const chatLines = chatProcesses.map((entry) => entry.CommandLine.toLowerCase()).join("\n");
      const ordinaryLines = ordinaryProcesses.map((entry) => entry.CommandLine.toLowerCase()).join("\n");
      const chatIds = new Set(chatProcesses.map((entry) => entry.ProcessId));
      const processSetsDisjoint = ordinaryProcesses.every((entry) => !chatIds.has(entry.ProcessId));
      const chatHasRemoteDebuggingPipe = chatLines.includes("--remote-debugging-pipe");
      const pairingMarker = bridge.pairingUrl.toLowerCase();
      const pairingUrlAbsentFromChatGptTree = !chatLines.includes(pairingMarker);
      const pairingUrlPresentOnlyInOrdinaryRoot = ordinaryLines.includes(pairingMarker);
      // Win32_Process.CommandLine can replace non-ASCII path characters with
      // '?' even though Edge received the correct UTF-16 argument. Pairing
      // proves the helper loaded; assert the stable flag and path suffix here.
      const ordinaryHasHelperExtension = ordinaryLines.includes("--load-extension=")
        && ordinaryLines.includes("resources\\huli-browser-helper");
      const ordinaryForbiddenFlags = FORBIDDEN_ORDINARY_FLAGS.filter((flag) => ordinaryLines.includes(flag));
      report.assertions = {
        processSetsDisjoint,
        chatGptHasRemoteDebuggingPipe: chatHasRemoteDebuggingPipe,
        pairingUrlAbsentFromChatGptTree,
        pairingUrlPresentOnlyInOrdinaryRoot,
        ordinaryHasHelperExtension,
        ordinaryForbiddenFlags,
      };
      report.chatGptProcesses = redacted(chatProcesses);
      report.ordinaryHelperProcesses = redacted(ordinaryProcesses);

      expect(processSetsDisjoint).toBe(true);
      expect(chatHasRemoteDebuggingPipe).toBe(true);
      expect(pairingUrlAbsentFromChatGptTree).toBe(true);
      expect(pairingUrlPresentOnlyInOrdinaryRoot).toBe(true);
      expect(ordinaryHasHelperExtension).toBe(true);
      expect(ordinaryForbiddenFlags).toEqual([]);
      report.ok = true;
    } catch (error) {
      report.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
      throw error;
    }
  }, 150_000);
});
