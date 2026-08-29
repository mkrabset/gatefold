import { describe, expect, it } from 'vitest'
import { LINK_QUERY_KEY, base64UrlToBytes, bytesToBase64Url, decodeDesignLink, encodeDesignLink } from './link'
import { createDemoDesign } from '../state/editorStore'

describe('shareable-link encoding', () => {
  it('round-trips raw bytes through URL-safe base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
    const encoded = bytesToBase64Url(bytes)
    // No base64 padding or `+`/`/` in the URL-safe form.
    expect(encoded).not.toContain('=')
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(base64UrlToBytes(encoded)).toEqual(bytes)
  })

  it('returns null when the query parameter is absent', async () => {
    expect(await decodeDesignLink('')).toBeNull()
    expect(await decodeDesignLink('?other=1')).toBeNull()
  })

  it('returns null for a corrupt payload', async () => {
    // Valid URL-safe base64 but not a gzip stream → decode fails and is swallowed.
    expect(await decodeDesignLink(`?${LINK_QUERY_KEY}=AAAA`)).toBeNull()
  })

  it.runIf(typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined')(
    'round-trips a design through encode and decode',
    async () => {
      const design = createDemoDesign()
      const url = await encodeDesignLink(design)
      expect(url).toContain(`?${LINK_QUERY_KEY}=`)

      const json = await decodeDesignLink(new URL(url).search)
      expect(json).not.toBeNull()
      expect(JSON.parse(json!)).toEqual(design)
    },
  )
})
