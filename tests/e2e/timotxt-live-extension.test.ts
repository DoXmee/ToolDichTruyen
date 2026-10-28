import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { HuliwangBrowserBridge } from "../../src/main/storySources/HuliwangBrowserBridge";
import { StorySourceService } from "../../src/main/storySources/StorySourceService";
import { TimotxtF24092Decoder, containsTimotxtEncodedCodepoints } from "../../src/main/storySources/timotxtDecoder";

describe("live TimoTXT extension bridge", () => {
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let profileDirectory = "";
  let storyProfile = "";
  let service: StorySourceService | undefined;

  afterEach(async () => {
    // Close the browser first so its long-poll request can release the bridge server.
    await browser?.close();
    await service?.close();
    if (storyProfile) await rm(storyProfile, { recursive: true, force: true });
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  });

  it("reads and decodes a new public TimoTXT chapter through Browser Helper 1.0.11", async () => {
    const extensionPath = path.resolve("resources/huli-browser-helper");
    profileDirectory = await mkdtemp(path.join(tmpdir(), "timotxt-extension-profile-"));
    storyProfile = await mkdtemp(path.join(tmpdir(), "timotxt-story-profile-"));
    browser = await chromium.launchPersistentContext(profileDirectory, {
      executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const pairingPage = await browser.newPage();
    const bridge = new HuliwangBrowserBridge({ site: "timotxt", pairingTimeoutMs: 30_000, visitTimeoutMs: 90_000 });
    await bridge.start();
    service = new StorySourceService({
      profileDirectory: storyProfile,
      huliwangCompanionFactory: async () => bridge,
      manualVerificationLauncher: async ({ url }) => { await pairingPage.goto(url); },
      minRequestIntervalMs: 100,
    });

    await service.openManualVerification("https://www.timotxt.com/1509589610/13.html");
    const url = "https://www.timotxt.com/1509589610/13.html";
    const snapshot = await bridge.client.visit(url);
    const raw = snapshot.elements[".chapter-content .content"]?.[0] ?? "";
    const fontAsset = snapshot.fontAssets?.find((asset) => asset.family.toLowerCase() === "bqg");
    expect(snapshot.title).toBe("第13章");
    expect(raw.length).toBeGreaterThan(500);
    expect(containsTimotxtEncodedCodepoints(raw)).toBe(true);
    expect(fontAsset?.sha256).toBe("4287ef986834d02762283c9265285cd7aa29b90c1dc1e7671d959359786c7db2");
    const decoded = new TimotxtF24092Decoder().decode({ site: "timotxt", url, text: raw, fontHash: fontAsset!.sha256 });
    expect(decoded.length).toBeGreaterThan(500);
    expect(containsTimotxtEncodedCodepoints(decoded)).toBe(false);
    expect(decoded).not.toContain("\uFFFD");
    console.log("LIVE_RESULT", JSON.stringify({
      title: snapshot.title,
      rawCharacters: raw.length,
      decodedCharacters: decoded.length,
      fontFamily: fontAsset?.family,
      fontHash: fontAsset?.sha256,
      sourceUrl: url,
    }));
  }, 120_000);
});
