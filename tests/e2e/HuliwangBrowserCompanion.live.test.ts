// @vitest-environment node

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { HuliwangBrowserBridge } from "../../src/main/storySources/HuliwangBrowserBridge";
import { StorySourceService } from "../../src/main/storySources/StorySourceService";

const execFileAsync = promisify(execFile);
const live = process.env.RUN_HULI_COMPANION_LIVE === "1" ? describe : describe.skip;
const WORKSPACE = path.resolve(import.meta.dirname, "..", "..");
const EXTENSION_DIRECTORY = path.join(WORKSPACE, "resources", "huli-browser-helper");
const REPORT_DIRECTORY = path.join(WORKSPACE, "test-results");
const REPORT_PATH = path.join(REPORT_DIRECTORY, "huli-browser-companion-live.json");
const EDGE_LOG_PATH = path.join(REPORT_DIRECTORY, "huli-browser-companion-edge.log");
// This is the concrete live regression requested for the reader's internal
// pagination: Huli currently serves Chapter 50 in three separate parts.
const TARGET_URL = "https://m.huliwang.net/1703891/50.html";
const CATALOG_URL = "https://m.huliwang.net/dir/1703891.html";
const TEMP_PREFIX = "tdt-huli-companion-live-";

const FORBIDDEN_AUTOMATION_FLAGS = [
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--enable-automation",
  "--headless",
  "--no-sandbox",
  "--disable-web-security",
  "--disable-blink-features=automationcontrolled",
];

interface BrowserProcessEvidence {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  ExecutablePath?: string;
  CommandLine: string;
}

interface LiveReport {
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  targetUrl: string;
  browser?: { executable: string; version: string; detectedDefaultProgId?: string };
  extensionDirectory: string;
  diagnosticExtensionDirectory?: string;
  temporaryProfile?: string;
  launchArgs?: string[];
  forbiddenAutomationFlagsPresent?: string[];
  processes?: BrowserProcessEvidence[];
  paired?: boolean;
  bridgeTrace?: Array<{
    elapsedMs: number;
    paired: boolean;
    pending: boolean;
    pendingDelivered: boolean;
    pollWaiters: number;
  }>;
  bridgeRequests?: Array<{
    method?: string;
    pathname: string;
    origin?: string;
    accessControlRequestMethod?: string;
    accessControlRequestHeaders?: string;
    authorizationPresent: boolean;
    contentType?: string;
    secFetchSite?: string;
  }>;
  snapshot?: {
    status?: number;
    url: string;
    challenge: string;
    title: string;
    titleLength: number;
    contentLength: number;
    bodyLength: number;
    linkCount: number;
    contentSha256: string;
    replacementCharacterPresent: boolean;
    unwantedChromePresent: boolean;
    chapterPagination?: { hasNext: boolean; hasPrevious: boolean; currentPage: number };
    links?: Array<{ href: string; text: string }>;
    contentTail?: string;
  };
  catalogPager?: {
    firstSliceFirstChapterUrl: string;
    nextSliceFirstChapterUrl: string;
    hasNextAfterAdvance: boolean;
    preservedCatalogUrl: boolean;
  };
  challengeSamples?: Array<{
    elapsedMs: number;
    challenge: string;
    title: string;
    titleElementLength: number;
    contentElementLength: number;
    bodyLength: number;
  }>;
  storySourceService?: {
    attempted: boolean;
    ok: boolean;
    inputKind?: string;
    site?: string;
    catalogChapterCount?: number;
    selectedChapterCount?: number;
    fetchedCharacterCount?: number;
    fetchedContentSha256?: string;
    cleanContentChecksPassed?: boolean;
    mergedPartCount?: number;
    sourceUrls?: string[];
    sourceUrlsAreOnlyChapterFifty?: boolean;
    incompleteFooterPresent?: boolean;
    error?: string;
  };
  cleanup?: {
    matchingProcessesBeforeStop: number;
    matchingProcessesAfterStop: number;
    temporaryProfileRemoved: boolean;
  };
  profileEvidence?: string[];
  error?: string;
  edgeLog?: { path: string; capturedCharacters: number };
}

async function prepareDiagnosticExtension(root: string): Promise<string> {
  const destination = path.join(root, "diagnostic-huli-browser-helper");
  await cp(EXTENSION_DIRECTORY, destination, { recursive: true, force: true });
  const pairingPath = path.join(destination, "pairing-content.js");
  const workerPath = path.join(destination, "service-worker.js");
  const huliPath = path.join(destination, "huli-content.js");
  let pairingSource = await readFile(pairingPath, "utf8");
  pairingSource = pairingSource.replace(
    "connectHeartbeat();\n    void chrome.runtime.sendMessage",
    "connectHeartbeat();\n    console.error('[TDT_DIAG] pairing-content requested runtime.connect');\n    void chrome.runtime.sendMessage",
  );
  if (!pairingSource.includes("[TDT_DIAG]")) throw new Error("Could not instrument pairing-content.js.");
  let workerSource = await readFile(workerPath, "utf8");
  if (process.env.HULI_COMPANION_DIAGNOSTIC_REMOVE_CACHE === "1") {
    workerSource = workerSource.replace('      cache: "no-store",\n', "");
    if (workerSource.includes('cache: "no-store"')) throw new Error("Could not remove diagnostic GET cache option.");
  }
  if (process.env.HULI_COMPANION_DIAGNOSTIC_FORCE_ORIGIN === "1") {
    workerSource = workerSource.replace("headers: authHeaders(pairing.token),", "headers: authHeaders(pairing.token, true),");
    if (!workerSource.includes("headers: authHeaders(pairing.token, true),")) {
      throw new Error("Could not force the diagnostic GET preflight/Origin header.");
    }
  }
  workerSource = workerSource.replace(
    "async function pollOnce(pairing) {",
    "async function pollOnce(pairing) {\n  console.error('[TDT_DIAG] pollOnce entered');",
  ).replace(
    "async function timedCommandPoll(pairing) {",
    "async function timedCommandPoll(pairing) {\n  console.error('[TDT_DIAG] timedCommandPoll start', pairing.bridgeOrigin);",
  ).replace(
    "return await fetch(`${pairing.bridgeOrigin}/v1/extension/commands?sessionId=${encodeURIComponent(pairing.sessionId)}`, {",
    "const diagnosticResponse = await fetch(`${pairing.bridgeOrigin}/v1/extension/commands?sessionId=${encodeURIComponent(pairing.sessionId)}`, {",
  ).replace(
    "      signal: controller.signal,\n    });\n  } finally {",
    "      signal: controller.signal,\n    });\n    console.error('[TDT_DIAG] timedCommandPoll response', diagnosticResponse.status);\n    return diagnosticResponse;\n  } catch (error) {\n    console.error('[TDT_DIAG] timedCommandPoll error', error instanceof Error ? error.name + ': ' + error.message : String(error));\n    throw error;\n  } finally {",
  ).replace(
    "async function runHeartbeatPort(port, state) {",
    "async function runHeartbeatPort(port, state) {\n  console.error('[TDT_DIAG] runHeartbeatPort entered');",
  ).replace(
    "chrome.runtime.onConnect.addListener((port) => {",
    "chrome.runtime.onConnect.addListener((port) => {\n  console.error('[TDT_DIAG] worker onConnect', port.name, Boolean(port.sender?.tab?.id), Boolean(port.sender?.tab?.url), Boolean(port.sender?.url));",
  ).replace(
    "if (message?.type === \"pair\") {",
    "if (message?.type === \"pair\") {\n    console.error('[TDT_DIAG] worker received pair message');",
  );
  if ((workerSource.match(/\[TDT_DIAG\]/gu) ?? []).length !== 7) {
    throw new Error("Could not instrument all expected service-worker points.");
  }
  await writeFile(pairingPath, pairingSource, "utf8");
  await writeFile(workerPath, workerSource, "utf8");

  // Temporary live-test-only DOM evidence. This never enters the production
  // helper nor its bridge snapshot. It records only button/link descriptors
  // adjacent to the reader, with every unapproved attribute discarded.
  if (process.env.HULI_COMPANION_DIAGNOSTIC_PAGER === "1") {
    let huliSource = await readFile(huliPath, "utf8");
    const probe = `
;(() => {
  const allowed = new Set(["id", "class", "role", "type", "name", "title", "aria-label", "aria-disabled", "disabled", "onclick", "data-page", "data-action", "data-url", "data-id", "data-next", "data-prev"]);
  const compact = (value, limit = 180) => String(value ?? "").replace(/\\s+/gu, " ").trim().slice(0, limit);
  const descriptor = (element) => {
    const attrs = {};
    for (const attribute of Array.from(element.attributes ?? [])) {
      const name = String(attribute.name ?? "").toLowerCase();
      if (allowed.has(name)) attrs[name] = compact(attribute.value, 160);
    }
    const clone = element.cloneNode(false);
    for (const attribute of Array.from(clone.attributes ?? [])) {
      if (!allowed.has(String(attribute.name ?? "").toLowerCase())) clone.removeAttribute(attribute.name);
    }
    clone.textContent = compact(element.textContent);
    return { tag: String(element.tagName ?? "").toLowerCase(), id: compact(element.id, 120), className: compact(element.className, 180), text: compact(element.textContent), attrs, outerHTML: compact(clone.outerHTML, 700) };
  };
  const pagerDiagnostic = () => {
    const root = document.querySelector("#nr");
    const nearby = new Set();
    for (const selector of ["#nr", ".nr_page", "#pagination", ".pagination", "[class*=page]", "[id*=page]"]) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        nearby.add(element);
        for (const child of Array.from(element.querySelectorAll("button,a,[role=button],input,[onclick],[data-page],[data-action]"))) nearby.add(child);
        const parent = element.parentElement;
        if (parent) for (const child of Array.from(parent.querySelectorAll("button,a,[role=button],input,[onclick],[data-page],[data-action]"))) nearby.add(child);
      }
    }
    const candidates = [...nearby].filter((element) => element.matches?.("button,a,[role=button],input,[onclick],[data-page],[data-action],.nr_page,#pagination,.pagination")).slice(0, 80).map(descriptor);
    console.error("[TDT_PAGER_DIAG]", JSON.stringify({
      path: location.pathname,
      candidates,
      // This diagnostic copy only reports the helper's already-computed
      // boolean/normalized target. It never captures page HTML, cookies, or
      // story text beyond the standard redacted live-test report.
      chapterPagination: typeof chapterPagination === "function" ? chapterPagination() : undefined,
      chapterNextTarget: typeof resolveChapterNextTarget === "function" ? resolveChapterNextTarget() : undefined,
      terminalMarker: typeof hasTerminalContinuationSentinel === "function"
        ? hasTerminalContinuationSentinel(storyTextOf(document.querySelector("#nr")))
        : undefined,
      readerNextDataUrls: Array.from(document.querySelectorAll(".nr_page button#pt_next[data-url]"), (button) => ({
        disabled: button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true",
        dataUrl: compact(button.getAttribute("data-url"), 240),
      })),
    }));
  };
  const originalCollect = collect;
  collect = function diagnosticCollect(requestedUrl) { pagerDiagnostic(); return originalCollect(requestedUrl); };
})();
`;
    huliSource += probe;
    await writeFile(huliPath, huliSource, "utf8");
  }
  return destination;
}

function redactPairingUrl(value: string): string {
  return value.replace(/(#tdt-pair=)[A-Za-z\d_-]+/gu, "$1<redacted>");
}

function redactProcessEvidence(process: BrowserProcessEvidence): BrowserProcessEvidence {
  return { ...process, CommandLine: redactPairingUrl(process.CommandLine) };
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

async function detectBrowser(): Promise<{ executable: string; version: string; detectedDefaultProgId?: string }> {
  const explicit = process.env.HULI_COMPANION_LIVE_BROWSER?.trim();
  const defaultProgId = await powershell(
    "(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice' -ErrorAction SilentlyContinue).ProgId",
  ).catch(() => "");
  const candidates = explicit
    ? [path.resolve(explicit)]
    : /MSEdgeHTM/iu.test(defaultProgId)
      ? [
          path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : [
          path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
        ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      const version = await powershell(
        "(Get-Item -LiteralPath $env:TDT_HULI_BROWSER).VersionInfo.FileVersion",
        { TDT_HULI_BROWSER: candidate },
      );
      return {
        executable: candidate,
        version,
        ...(defaultProgId ? { detectedDefaultProgId: defaultProgId } : {}),
      };
    } catch {
      // Try the next installed ordinary browser.
    }
  }
  throw new Error("No installed Microsoft Edge or Google Chrome executable was found.");
}

async function assertIsOwnedTemporaryProfile(directory: string): Promise<string> {
  const resolvedDirectory = await realpath(directory);
  const resolvedTemp = await realpath(tmpdir());
  const relative = path.relative(resolvedTemp, resolvedDirectory);
  if (
    !relative
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !path.basename(resolvedDirectory).startsWith(TEMP_PREFIX)
  ) {
    throw new Error(`Refusing to manage non-test browser profile: ${resolvedDirectory}`);
  }
  return resolvedDirectory;
}

async function matchingBrowserProcesses(profile: string): Promise<BrowserProcessEvidence[]> {
  const output = await powershell(
    "$needle=$env:TDT_HULI_PROFILE; $items=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -and $_.CommandLine.Contains($needle) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine); if($items.Count -eq 0){'[]'}else{$items | ConvertTo-Json -Compress}",
    { TDT_HULI_PROFILE: profile },
  );
  const parsed = JSON.parse(output || "[]") as BrowserProcessEvidence | BrowserProcessEvidence[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForMatchingBrowserProcess(profile: string, timeoutMs = 15_000): Promise<BrowserProcessEvidence[]> {
  const deadline = Date.now() + timeoutMs;
  do {
    const processes = await matchingBrowserProcesses(profile);
    if (processes.length) return processes;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error("The ordinary browser did not create a process for the isolated live-test profile.");
}

async function stopExactTemporaryBrowserTree(profile: string): Promise<void> {
  await powershell(
    "$needle=$env:TDT_HULI_PROFILE; $all=@(Get-CimInstance Win32_Process); $roots=@($all | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -and $_.CommandLine.Contains($needle) }); $ids=[System.Collections.Generic.HashSet[int]]::new(); foreach($root in $roots){[void]$ids.Add([int]$root.ProcessId)}; do{$added=$false; foreach($item in $all){if($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)){$added=$true}}}while($added); @($ids) | Sort-Object -Descending | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
    { TDT_HULI_PROFILE: profile },
  );
}

async function listProfileEvidence(directory: string): Promise<string[]> {
  try {
    const names = await readdir(directory, { recursive: true });
    return names.map(String).sort().slice(0, 300);
  } catch {
    return [];
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function bridgeState(bridge: HuliwangBrowserBridge, startedAt: number): NonNullable<LiveReport["bridgeTrace"]>[number] {
  const internal = bridge as unknown as {
    paired?: boolean;
    pending?: { delivered?: boolean };
    pollWaiters?: Set<unknown>;
  };
  return {
    elapsedMs: Date.now() - startedAt,
    paired: Boolean(internal.paired),
    pending: Boolean(internal.pending),
    pendingDelivered: Boolean(internal.pending?.delivered),
    pollWaiters: internal.pollWaiters?.size ?? -1,
  };
}

function checkSnapshot(snapshot: Awaited<ReturnType<HuliwangBrowserBridge["client"]["visit"]>>): void {
  expect(snapshot.requestedUrl).toBe(TARGET_URL);
  expect(snapshot.url).toBe(TARGET_URL);
  expect(snapshot.status).toBe(200);
  expect(snapshot.challenge).toBe("none");
  expect(snapshot.elements["#nr_title"]?.[0]?.trim().length).toBeGreaterThan(2);
  // A single internal page can be short even though the fully merged chapter
  // is substantial. This still distinguishes real #nr content from chrome.
  expect(snapshot.elements["#nr"]?.[0]?.trim().length).toBeGreaterThan(100);
  const chapterText = snapshot.elements["#nr"]?.[0] ?? "";
  expect(`${snapshot.title}\n${snapshot.bodyText}\n${chapterText}`).not.toContain("\uFFFD");
  expect(`${snapshot.title}\n${chapterText}`).not.toMatch(
    /(?:Just a moment|Checking your browser|Cloudflare Ray ID|cf-chl-|<script\b|<iframe\b)/iu,
  );
  for (const link of snapshot.links) {
    const parsed = new URL(link.href);
    expect(parsed.protocol).toBe("https:");
    expect(["m.huliwang.net", "www.huliwang.net"]).toContain(parsed.hostname.toLowerCase());
    expect(parsed.username).toBe("");
    expect(parsed.password).toBe("");
    expect(parsed.port).toBe("");
    expect(parsed.pathname).toMatch(/^\/(?:dir\/\d+(?:[-_/]\d+)?\.html|\d+\/?|\d+\/\d+(?:\/\d+)?\.html)\/?$/u);
  }
}

function isChapterFiftyUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return ["m.huliwang.net", "www.huliwang.net"].includes(url.hostname.toLowerCase())
      && /^\/1703891\/50(?:\/\d+)?\.html$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function challengeSample(
  snapshot: Awaited<ReturnType<HuliwangBrowserBridge["client"]["visit"]>>,
  startedAt: number,
): NonNullable<LiveReport["challengeSamples"]>[number] {
  return {
    elapsedMs: Date.now() - startedAt,
    challenge: snapshot.challenge,
    title: snapshot.title.slice(0, 200),
    titleElementLength: snapshot.elements["#nr_title"]?.[0]?.length ?? 0,
    contentElementLength: snapshot.elements["#nr"]?.[0]?.length ?? 0,
    bodyLength: snapshot.bodyText.length,
  };
}

live("Huliwang companion in an ordinary browser (opt-in live)", () => {
  let bridge: HuliwangBrowserBridge | undefined;
  let service: StorySourceService | undefined;
  let child: ChildProcess | undefined;
  let temporaryProfile = "";
  let edgeLog = "";
  const report: LiveReport = {
    startedAt: new Date().toISOString(),
    ok: false,
    targetUrl: TARGET_URL,
    extensionDirectory: EXTENSION_DIRECTORY,
  };

  afterAll(async () => {
    await service?.close().catch(() => undefined);
    await bridge?.close().catch(() => undefined);
    if (temporaryProfile) {
      const verifiedProfile = await assertIsOwnedTemporaryProfile(temporaryProfile);
      const before = await matchingBrowserProcesses(verifiedProfile).catch(() => []);
      await stopExactTemporaryBrowserTree(verifiedProfile).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const after = await matchingBrowserProcesses(verifiedProfile).catch(() => []);
      report.profileEvidence = await listProfileEvidence(verifiedProfile);
      if (!after.length) await rm(verifiedProfile, { recursive: true, force: true });
      report.cleanup = {
        matchingProcessesBeforeStop: before.length,
        matchingProcessesAfterStop: after.length,
        temporaryProfileRemoved: !after.length,
      };
    }
    child?.removeAllListeners();
    report.finishedAt = new Date().toISOString();
    await mkdir(REPORT_DIRECTORY, { recursive: true });
    const safeEdgeLog = redactPairingUrl(edgeLog).slice(0, 2_000_000);
    await writeFile(EDGE_LOG_PATH, safeEdgeLog, "utf8");
    report.edgeLog = { path: EDGE_LOG_PATH, capturedCharacters: safeEdgeLog.length };
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  });

  it("pairs an ordinary temporary Edge profile and proves Huli Chapter 50 is merged from all three internal pages", async () => {
    try {
      await access(path.join(EXTENSION_DIRECTORY, "manifest.json"));
      report.browser = await detectBrowser();
      temporaryProfile = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
      temporaryProfile = await assertIsOwnedTemporaryProfile(temporaryProfile);
      report.temporaryProfile = temporaryProfile;
      const extensionDirectory = process.env.HULI_COMPANION_DIAGNOSTIC === "1"
        ? await prepareDiagnosticExtension(temporaryProfile)
        : EXTENSION_DIRECTORY;
      if (extensionDirectory !== EXTENSION_DIRECTORY) report.diagnosticExtensionDirectory = extensionDirectory;

      bridge = await new HuliwangBrowserBridge({
        pairingTimeoutMs: 60_000,
        visitTimeoutMs: process.env.HULI_COMPANION_DIAGNOSTIC === "1" ? 8_000 : 30_000,
        pollTimeoutMs: 5_000,
      }).start();
      report.bridgeRequests = [];
      const internalServer = (bridge as unknown as { server?: Server }).server;
      if (!internalServer) throw new Error("Bridge server was unavailable for sanitized request tracing.");
      internalServer.on("request", (request: IncomingMessage) => {
        if ((report.bridgeRequests?.length ?? 0) >= 100) return;
        let pathname = "invalid";
        try { pathname = new URL(request.url ?? "", bridge!.bridgeOrigin).pathname; } catch { /* keep invalid */ }
        report.bridgeRequests?.push({
          ...(request.method ? { method: request.method } : {}),
          pathname,
          ...(typeof request.headers.origin === "string" ? { origin: request.headers.origin } : {}),
          ...(typeof request.headers["access-control-request-method"] === "string"
            ? { accessControlRequestMethod: request.headers["access-control-request-method"] }
            : {}),
          ...(typeof request.headers["access-control-request-headers"] === "string"
            ? { accessControlRequestHeaders: request.headers["access-control-request-headers"] }
            : {}),
          authorizationPresent: typeof request.headers.authorization === "string",
          ...(typeof request.headers["content-type"] === "string" ? { contentType: request.headers["content-type"] } : {}),
          ...(typeof request.headers["sec-fetch-site"] === "string" ? { secFetchSite: request.headers["sec-fetch-site"] } : {}),
        });
      });
      const launchArgs = [
        `--user-data-dir=${temporaryProfile}`,
        `--load-extension=${extensionDirectory}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--enable-logging=stderr",
        "--vmodule=extensions*=2,extension*=2,content_scripts*=2",
        "--new-window",
        bridge.pairingUrl,
      ];
      report.launchArgs = launchArgs.map(redactPairingUrl);
      report.forbiddenAutomationFlagsPresent = FORBIDDEN_AUTOMATION_FLAGS.filter((flag) =>
        launchArgs.some((argument) => argument.toLowerCase().startsWith(flag)),
      );
      expect(report.forbiddenAutomationFlagsPresent).toEqual([]);

      child = spawn(report.browser.executable, launchArgs, {
        detached: false,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: false,
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        if (edgeLog.length < 2_000_000) edgeLog += chunk;
      });
      await waitForSpawn(child);
      const observedProcesses = await waitForMatchingBrowserProcess(temporaryProfile);
      report.processes = observedProcesses.map(redactProcessEvidence);
      const rootCommandLines = observedProcesses.map((entry) => entry.CommandLine.toLowerCase()).join("\n");
      for (const forbidden of FORBIDDEN_AUTOMATION_FLAGS) expect(rootCommandLines).not.toContain(forbidden);

      await bridge.waitUntilPaired();
      report.paired = true;
      const traceStartedAt = Date.now();
      report.bridgeTrace = [bridgeState(bridge, traceStartedAt)];
      const traceTimer = setInterval(() => report.bridgeTrace?.push(bridgeState(bridge!, traceStartedAt)), 500);
      let snapshot;
      try {
        snapshot = await bridge.client.visit(TARGET_URL);
      } finally {
        clearInterval(traceTimer);
        report.bridgeTrace.push(bridgeState(bridge, traceStartedAt));
      }
      const challengeStartedAt = Date.now();
      report.challengeSamples = [challengeSample(snapshot, challengeStartedAt)];
      const inspectCurrent = bridge.client.inspectCurrent;
      if (!inspectCurrent) throw new Error("The Huli companion does not support no-reload page inspection.");
      while (snapshot.challenge !== "none" && Date.now() - challengeStartedAt < 35_000) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        snapshot = await inspectCurrent();
        report.challengeSamples.push(challengeSample(snapshot, challengeStartedAt));
      }
      checkSnapshot(snapshot);
      const chapterText = snapshot.elements["#nr"]?.[0] ?? "";
      const unwantedChrome = /(?:Just a moment|Checking your browser|Cloudflare Ray ID|cf-chl-|<script\b|<iframe\b)/iu
        .test(`${snapshot.title}\n${chapterText}`);
      report.snapshot = {
        ...(snapshot.status !== undefined ? { status: snapshot.status } : {}),
        url: snapshot.url,
        challenge: snapshot.challenge,
        title: snapshot.elements["#nr_title"]?.[0]?.slice(0, 300) ?? snapshot.title.slice(0, 300),
        titleLength: snapshot.elements["#nr_title"]?.[0]?.length ?? 0,
        contentLength: chapterText.length,
        bodyLength: snapshot.bodyText.length,
        linkCount: snapshot.links.length,
        contentSha256: createHash("sha256").update(chapterText, "utf8").digest("hex"),
        replacementCharacterPresent: `${snapshot.title}\n${snapshot.bodyText}\n${chapterText}`.includes("\uFFFD"),
        unwantedChromePresent: unwantedChrome,
        ...(snapshot.chapterPagination ? { chapterPagination: snapshot.chapterPagination } : {}),
        links: snapshot.links.slice(0, 20).map((link) => ({ href: link.href, text: link.text.slice(0, 160) })),
        contentTail: chapterText.slice(-500),
      };

      // Regression for the mobile directory's true pager: it has no href and
      // swaps #chapterList in place through #pagination #nextPage.  This
      // invokes only the bridge's fixed `catalog-next` command in an isolated
      // temporary ordinary-browser profile; no CAPTCHA or personal browser
      // data is touched.  The test is opt-in with this whole file.
      let catalogSnapshot = await bridge.client.visit(CATALOG_URL);
      const catalogVerificationStartedAt = Date.now();
      while (catalogSnapshot.challenge !== "none" && Date.now() - catalogVerificationStartedAt < 35_000) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        catalogSnapshot = await inspectCurrent();
      }
      expect(catalogSnapshot.challenge).toBe("none");
      expect(catalogSnapshot.catalogPagination?.hasNext).toBe(true);
      const chapterLinks = (value: typeof catalogSnapshot) => value.links.filter(
        (link) => /^https:\/\/(?:m|www)\.huliwang\.net\/1703891\/\d+\.html$/u.test(link.href),
      );
      const firstSlice = chapterLinks(catalogSnapshot);
      expect(firstSlice.length).toBeGreaterThanOrEqual(50);
      const advanceCatalogPage = bridge.client.advanceCatalogPage;
      if (!advanceCatalogPage) throw new Error("The Huli companion does not support the fixed catalog pager.");
      const nextCatalogSnapshot = await advanceCatalogPage(CATALOG_URL);
      const nextSlice = chapterLinks(nextCatalogSnapshot);
      expect(nextCatalogSnapshot.url).toBe(CATALOG_URL);
      expect(nextCatalogSnapshot.catalogPagination).toBeDefined();
      expect(nextSlice.length).toBeGreaterThanOrEqual(1);
      expect(nextSlice[0]?.href).not.toBe(firstSlice[0]?.href);
      report.catalogPager = {
        firstSliceFirstChapterUrl: firstSlice[0]?.href ?? "",
        nextSliceFirstChapterUrl: nextSlice[0]?.href ?? "",
        hasNextAfterAdvance: nextCatalogSnapshot.catalogPagination?.hasNext === true,
        preservedCatalogUrl: nextCatalogSnapshot.url === CATALOG_URL,
      };

      // The preceding catalog-only regression deliberately leaves the paired
      // tab on its second in-place catalog slice. Reset it to Chapter 50 so
      // StorySourceService starts its own catalog traversal from page one,
      // exactly as the application does for a fresh user import.
      await bridge.client.visit(TARGET_URL);

      report.storySourceService = { attempted: true, ok: false };
      try {
        service = new StorySourceService({
          huliwangCompanionFactory: async () => bridge!,
          manualVerificationLauncher: async () => undefined,
          minRequestIntervalMs: 0,
          verificationWaitMs: 30_000,
        });
        await service.openManualVerification(TARGET_URL);
        const analysis = await service.analyzeUrl(TARGET_URL);
        const fetched = await service.fetchChapters({
          analysisId: analysis.analysisId,
          chapterIds: analysis.defaultSelectedChapterIds,
        });
        expect(analysis.site).toBe("huliwang");
        expect(analysis.inputKind).toBe("chapter");
        expect(analysis.defaultSelectedChapterIds).toHaveLength(1);
        expect(fetched.chapters).toHaveLength(1);
        const fetchedChapter = fetched.chapters[0];
        expect(fetchedChapter?.characterCount).toBeGreaterThan(500);
        // Chapter 50's three reader parts must be merged before translation.
        // Keep this strict so a future template change cannot silently export
        // only page one or drift into Chapter 51.
        expect(fetchedChapter?.mergedPartCount).toBe(3);
        const sourceUrls = fetchedChapter?.sourceUrls ?? [];
        expect(sourceUrls).toHaveLength(3);
        expect(sourceUrls.every(isChapterFiftyUrl)).toBe(true);
        expect(fetched.combinedSource).not.toContain("\uFFFD");
        expect(fetched.combinedSource).not.toMatch(
          /(?:Just a moment|Checking your browser|Cloudflare Ray ID|cf-chl-|\u4e0a\u4e00\u7ae0|\u4e0b\u4e00\u7ae0|\u8fd4\u56de\u76ee\u5f55|\u672c\u7ae0\u672a\u5b8c|\u70b9\u51fb\u4e0b\u4e00\u9875\u7ee7\u7eed|\u6b64\u9875\u4e3a\u672c\u7ae0|\u9605\u8bfb\u6a21\u5f0f|<script\b|<iframe\b)/iu,
        );
        const fetchedText = fetchedChapter?.sourceText ?? "";
        const incompleteFooterPresent = /(?:\u672c\u7ae0\u672a\u5b8c|\u70b9\u51fb\u4e0b\u4e00\u9875\u7ee7\u7eed|\u6b64\u9875\u4e3a\u672c\u7ae0)/iu.test(fetchedText);
        report.storySourceService = {
          attempted: true,
          ok: true,
          inputKind: analysis.inputKind,
          site: analysis.site,
          catalogChapterCount: analysis.chapters.length,
          selectedChapterCount: analysis.defaultSelectedChapterIds.length,
          fetchedCharacterCount: fetchedChapter?.characterCount,
          fetchedContentSha256: createHash("sha256").update(fetchedText, "utf8").digest("hex"),
          cleanContentChecksPassed: true,
          mergedPartCount: fetchedChapter?.mergedPartCount,
          sourceUrls,
          sourceUrlsAreOnlyChapterFifty: sourceUrls.every(isChapterFiftyUrl),
          incompleteFooterPresent,
        };
      } catch (error) {
        report.storySourceService.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw error;
      }

      report.ok = true;
    } catch (error) {
      report.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
      if (temporaryProfile) report.profileEvidence = await listProfileEvidence(temporaryProfile);
      throw error;
    }
  }, 240_000);
});
