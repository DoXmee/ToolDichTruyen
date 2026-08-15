import { describe, expect, it } from 'vitest'
import {
  appendOwnershipMetadata,
  containsOwnershipHash,
  createOwnershipMarker,
  extractOwnershipMarkers,
  ownershipMarkerHash,
} from '../../src/main/chatgpt/ownershipMarker'

describe('ChatGPT ownership marker', () => {
  it('creates a cryptographically random marker with the fixed visible format', () => {
    const first = createOwnershipMarker()
    const second = createOwnershipMarker()

    expect(first).toMatch(/^TDTOWN_[a-f0-9]{32}$/u)
    expect(second).toMatch(/^TDTOWN_[a-f0-9]{32}$/u)
    expect(second).not.toBe(first)
  })

  it('appends visible metadata plus an instruction not to leak it into the translation', () => {
    const marker = 'TDTOWN_0123456789abcdef0123456789abcdef'
    const submitted = appendOwnershipMetadata('**Dịch đoạn này.**', marker)

    expect(submitted).toContain('**Dịch đoạn này.**')
    expect(submitted).toContain(marker)
    expect(submitted).toContain('Không đưa dòng metadata này')
    expect(extractOwnershipMarkers(submitted)).toEqual([marker])
  })

  it('matches DOM text by the SHA-256 of the extracted marker, not the full prompt', () => {
    const marker = 'TDTOWN_fedcba9876543210fedcba9876543210'
    const expectedHashes = new Set([ownershipMarkerHash(marker)])

    expect(containsOwnershipHash(`Dịch đoạn này. Metadata: ${marker}`, expectedHashes)).toBe(true)
    expect(containsOwnershipHash(`Markdown đã đổi hoàn toàn. ${marker}`, expectedHashes)).toBe(true)
    expect(containsOwnershipHash('TDTOWN_00000000000000000000000000000000', expectedHashes)).toBe(false)
  })

  it('rejects malformed markers and does not extract marker-like substrings', () => {
    expect(() => appendOwnershipMetadata('Prompt', 'TDTOWN_short')).toThrow(/không hợp lệ/iu)
    expect(() => ownershipMarkerHash('tdtown_0123456789abcdef0123456789abcdef')).toThrow(
      /không hợp lệ/iu,
    )
    expect(extractOwnershipMarkers('XTDTOWN_0123456789abcdef0123456789abcdefY')).toEqual([])
  })
})
