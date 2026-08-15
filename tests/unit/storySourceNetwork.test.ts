import { describe, expect, it } from 'vitest';
import {
  assertSafeStoryNetworkRequest,
  isBlockedStoryNetworkAddress,
} from '../../src/main/storySources/networkSafety';

describe('story source network safety', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', 'fc00::1',
  ])('blocks private/reserved address %s', (address) => {
    expect(isBlockedStoryNetworkAddress(address)).toBe(true);
  });

  it.each([
    '104.21.48.59', '172.67.179.18', '198.2.197.38',
    '2606:4700:3037::6815:303b', '2606:4700:3030::ac43:b312',
  ])('allows public address %s', (address) => {
    expect(isBlockedStoryNetworkAddress(address)).toBe(false);
  });

  it('allows a supported host only when every DNS answer is public', async () => {
    await expect(assertSafeStoryNetworkRequest(
      'https://www.timotxt.com/1509589610/dir',
      'navigation',
      async () => ['104.21.48.59', '2606:4700:3037::6815:303b'],
    )).resolves.toBeInstanceOf(URL);
    await expect(assertSafeStoryNetworkRequest(
      'https://www.timotxt.com/1509589610/dir',
      'navigation',
      async () => ['104.21.48.59', '127.0.0.1'],
    )).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
  });

  it('allows only public HTTPS Xbanxia navigation and rejects spoofed or private destinations', async () => {
    const publicResolver = async () => ['8.8.8.8'] as const;
    await expect(assertSafeStoryNetworkRequest(
      'https://www.xbanxia.cc/books/143300/28251886.html',
      'navigation',
      publicResolver,
    )).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'www.xbanxia.cc',
    });
    await expect(assertSafeStoryNetworkRequest(
      'https://xbanxia.cc/books/143300.html',
      'navigation',
      publicResolver,
    )).resolves.toMatchObject({ hostname: 'xbanxia.cc' });

    for (const url of [
      'http://www.xbanxia.cc/books/143300.html',
      'https://evil.xbanxia.cc/books/143300.html',
      'https://www.xbanxia.cc.evil.test/books/143300.html',
      'https://www.xbanxia.cc./books/143300.html',
    ]) {
      await expect(assertSafeStoryNetworkRequest(url, 'navigation', publicResolver), url)
        .rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
    }

    await expect(assertSafeStoryNetworkRequest(
      'https://www.xbanxia.cc/books/143300.html',
      'navigation',
      async () => ['192.168.1.20'],
    )).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
    await expect(assertSafeStoryNetworkRequest(
      'https://www.xbanxia.cc/books/143300.html',
      'navigation',
      async () => ['8.8.8.8', '127.0.0.1'],
    )).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
  });
});
