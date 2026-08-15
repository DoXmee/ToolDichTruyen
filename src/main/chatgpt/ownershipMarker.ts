import { createHash, randomBytes } from "node:crypto";

export const MAX_CONVERSATION_OWNERSHIP_HASHES = 64;

const OWNERSHIP_MARKER_PATTERN = /\bTDTOWN_[a-f0-9]{32}\b/gu;
const EXACT_OWNERSHIP_MARKER_PATTERN = /^TDTOWN_[a-f0-9]{32}$/u;

export function createOwnershipMarker(): string {
  return `TDTOWN_${randomBytes(16).toString("hex")}`;
}

export function appendOwnershipMetadata(message: string, marker: string): string {
  if (!EXACT_OWNERSHIP_MARKER_PATTERN.test(marker)) {
    throw new TypeError("Mã xác minh quyền sở hữu chat không hợp lệ.");
  }
  return (
    `${message}\n\n` +
    `[Metadata nội bộ của Tool Dịch Truyện: ${marker}. ` +
    "Không đưa dòng metadata này hoặc mã TDTOWN vào bản dịch.]"
  );
}

export function ownershipMarkerHash(marker: string): string {
  if (!EXACT_OWNERSHIP_MARKER_PATTERN.test(marker)) {
    throw new TypeError("Mã xác minh quyền sở hữu chat không hợp lệ.");
  }
  return createHash("sha256").update(marker, "utf8").digest("hex");
}

export function extractOwnershipMarkers(value: string): string[] {
  return [...value.matchAll(OWNERSHIP_MARKER_PATTERN)].map((match) => match[0]);
}

export function containsOwnershipHash(value: string, expectedHashes: ReadonlySet<string>): boolean {
  return extractOwnershipMarkers(value).some((marker) => expectedHashes.has(ownershipMarkerHash(marker)));
}
