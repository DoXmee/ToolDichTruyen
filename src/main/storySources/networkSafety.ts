import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { BrowserContext, Request, Route } from "playwright-core";
import { StorySourceError } from "./types.js";
import { siteForHostname } from "./urlRules.js";

export type StoryNetworkRequestKind = "navigation" | "subresource" | "font" | "transcode";
export type StoryHostResolver = (hostname: string) => Promise<readonly string[]>;

// Keep families in separate lists. Node represents IPv4 values internally as
// mapped IPv6 in a mixed BlockList; adding ::ffff:0:0/96 to that same object
// would therefore make every public IPv4 address look blocked.
const BLOCKED_IPV4_ADDRESSES = new BlockList();
const BLOCKED_IPV6_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8], ["2001:db8::", 32],
] as const) BLOCKED_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6");

const defaultResolver: StoryHostResolver = async (hostname) => (
  await lookup(hostname, { all: true, verbatim: true })
).map(({ address }) => address);

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/gu, "");
}

export function isBlockedStoryNetworkAddress(raw: string): boolean {
  const address = raw.split("%")[0] ?? raw;
  const family = isIP(address);
  if (family === 4) return BLOCKED_IPV4_ADDRESSES.check(address, "ipv4");
  if (family === 6) return BLOCKED_IPV6_ADDRESSES.check(address, "ipv6");
  return true;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home.arpa");
}

/**
 * Validates immediately before each browser/API request. DNS is deliberately
 * resolved without an application cache so a later request cannot reuse a
 * previously-public answer after a rebinding attempt.
 */
export async function assertSafeStoryNetworkRequest(
  rawUrl: string,
  kind: StoryNetworkRequestKind,
  resolveHost: StoryHostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trình duyệt đã chặn một URL mạng không hợp lệ.", { cause: error });
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || (url.port && !["80", "443"].includes(url.port))
  ) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trình duyệt chỉ cho phép request HTTP(S) không kèm thông tin đăng nhập/cổng lạ.");
  }

  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname.endsWith(".") || isLocalHostname(hostname)) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trình duyệt đã chặn request tới localhost/mạng nội bộ.");
  }
  if ((kind === "navigation" || kind === "font") && !siteForHostname(hostname)) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trang hoặc font đã chuyển ra ngoài các website truyện được cho phép.");
  }
  if ((kind === "navigation" || kind === "font" || kind === "transcode") && url.protocol !== "https:") {
    throw new StorySourceError("UNSAFE_REDIRECT", "Trang, font và endpoint nguồn truyện chỉ được kết nối qua HTTPS.");
  }
  if (
    kind === "transcode"
    && (url.protocol !== "https:" || hostname !== "www.timotxt.com" || url.pathname !== "/chapter/transcode.html")
  ) {
    throw new StorySourceError("UNSAFE_REDIRECT", "Endpoint giải mã TimoTXT không khớp URL cố định được cho phép.");
  }

  const literalFamily = isIP(hostname);
  let addresses: readonly string[];
  try {
    addresses = literalFamily ? [hostname] : await resolveHost(hostname);
  } catch (error) {
    throw new StorySourceError("UNSAFE_REDIRECT", `Không xác minh được DNS công khai của ${hostname}.`, { cause: error });
  }
  if (!addresses.length || addresses.some(isBlockedStoryNetworkAddress)) {
    throw new StorySourceError(
      "UNSAFE_REDIRECT",
      `Đã chặn ${hostname} vì DNS/IP trỏ tới mạng riêng, loopback, link-local hoặc dải dành riêng (${addresses.join(", ") || "không có kết quả"}).`,
    );
  }
  return url;
}

export class StoryNetworkGuard {
  private navigationFailure?: StorySourceError;

  public constructor(private readonly resolveHost: StoryHostResolver = defaultResolver) {}

  public assert(rawUrl: string, kind: StoryNetworkRequestKind): Promise<URL> {
    return assertSafeStoryNetworkRequest(rawUrl, kind, this.resolveHost);
  }

  public rememberNavigationFailure(error: StorySourceError): void {
    this.navigationFailure = error;
  }

  public clearNavigationFailure(): void {
    this.navigationFailure = undefined;
  }

  public takeNavigationFailure(): StorySourceError | undefined {
    const failure = this.navigationFailure;
    this.navigationFailure = undefined;
    return failure;
  }
}

function isTopLevelNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame().parentFrame() === null;
  } catch {
    return false;
  }
}

export async function guardStoryBrowserRoute(
  route: Pick<Route, "abort" | "continue">,
  request: Pick<Request, "url" | "resourceType" | "isNavigationRequest" | "frame">,
  guard: StoryNetworkGuard,
): Promise<void> {
  const topLevel = isTopLevelNavigation(request as Request);
  const kind: StoryNetworkRequestKind = topLevel
    ? "navigation"
    : request.resourceType() === "font" ? "font" : "subresource";
  try {
    await guard.assert(request.url(), kind);
  } catch (error) {
    const failure = error instanceof StorySourceError
      ? error
      : new StorySourceError("UNSAFE_REDIRECT", "Request trình duyệt bị chặn an toàn.", { cause: error });
    if (topLevel) guard.rememberNavigationFailure(failure);
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
}

export async function installStoryNetworkRoutes(
  context: BrowserContext,
  guard: StoryNetworkGuard,
): Promise<void> {
  await context.route("**/*", (route, request) => guardStoryBrowserRoute(route, request, guard));
  await context.routeWebSocket("**/*", (websocket) => websocket.close({
    code: 1008,
    reason: "WebSocket disabled for story-source isolation",
  }));
}
