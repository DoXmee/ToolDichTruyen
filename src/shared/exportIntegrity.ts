import type { FinalChapterExportInput } from './types';

/**
 * A deterministic SHA-256 fingerprint for data that has crossed the
 * renderer/main-process boundary.  This deliberately lives in `shared` so
 * the browser renderer and the Node export service calculate exactly the
 * same value without trusting a filename, chapter number, or word count.
 *
 * Web Crypto would make the renderer implementation asynchronous and would
 * make it easy for a later checkpoint to race an in-flight export.  The
 * inputs here are individual chapter documents (or one final compilation),
 * so a small synchronous implementation keeps the identity check atomic at
 * the call site while remaining independent of Node built-ins.
 */
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** SHA-256 in lower-case hexadecimal, with no platform-specific encoding. */
export function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  // Export inputs are capped at 128 MiB, far below the Uint32/Array limits
  // used here. The extra 9 bytes account for the 1 bit and 64-bit length.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const highLength = Math.floor(bitLength / 0x1_0000_0000);
  const lowLength = bitLength >>> 0;
  const finalOffset = paddedLength - 8;
  padded[finalOffset] = (highLength >>> 24) & 0xff;
  padded[finalOffset + 1] = (highLength >>> 16) & 0xff;
  padded[finalOffset + 2] = (highLength >>> 8) & 0xff;
  padded[finalOffset + 3] = highLength & 0xff;
  padded[finalOffset + 4] = (lowLength >>> 24) & 0xff;
  padded[finalOffset + 5] = (lowLength >>> 16) & 0xff;
  padded[finalOffset + 6] = (lowLength >>> 8) & 0xff;
  padded[finalOffset + 7] = lowLength & 0xff;

  let hash0 = 0x6a09e667;
  let hash1 = 0xbb67ae85;
  let hash2 = 0x3c6ef372;
  let hash3 = 0xa54ff53a;
  let hash4 = 0x510e527f;
  let hash5 = 0x9b05688c;
  let hash6 = 0x1f83d9ab;
  let hash7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      schedule[index] = (
        (padded[position]! << 24)
        | (padded[position + 1]! << 16)
        | (padded[position + 2]! << 8)
        | padded[position + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15]!;
      const previous2 = schedule[index - 2]!;
      const smallSigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const smallSigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = (schedule[index - 16]! + smallSigma0 + schedule[index - 7]! + smallSigma1) >>> 0;
    }

    let a = hash0;
    let b = hash1;
    let c = hash2;
    let d = hash3;
    let e = hash4;
    let f = hash5;
    let g = hash6;
    let h = hash7;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + bigSigma1 + choose + SHA256_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash0 = (hash0 + a) >>> 0;
    hash1 = (hash1 + b) >>> 0;
    hash2 = (hash2 + c) >>> 0;
    hash3 = (hash3 + d) >>> 0;
    hash4 = (hash4 + e) >>> 0;
    hash5 = (hash5 + f) >>> 0;
    hash6 = (hash6 + g) >>> 0;
    hash7 = (hash7 + h) >>> 0;
  }

  return [hash0, hash1, hash2, hash3, hash4, hash5, hash6, hash7]
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * The serialized input is intentionally unambiguous: a title/content change
 * cannot be hidden by the same chapter number or the same word count.
 */
export function chapterFingerprintPayload(
  chapter: Pick<FinalChapterExportInput, 'index' | 'sourceChapterNumber' | 'title' | 'content' | 'wordCount'>,
): string {
  return JSON.stringify([
    2,
    chapter.index,
    chapter.sourceChapterNumber ?? null,
    chapter.title.normalize('NFC'),
    chapter.content.normalize('NFC'),
    chapter.wordCount,
  ]);
}

export function chapterContentFingerprint(
  chapter: Pick<FinalChapterExportInput, 'index' | 'sourceChapterNumber' | 'title' | 'content' | 'wordCount'>,
): string {
  return sha256Hex(chapterFingerprintPayload(chapter));
}

export function combinedChapterContentFingerprint(
  startChapter: number,
  endChapter: number,
  chapters: ReadonlyArray<Pick<FinalChapterExportInput, 'index' | 'sourceChapterNumber' | 'title' | 'content' | 'wordCount'>>,
): string {
  return sha256Hex(JSON.stringify([
    2,
    startChapter,
    endChapter,
    chapters.map(chapterFingerprintPayload),
  ]));
}
