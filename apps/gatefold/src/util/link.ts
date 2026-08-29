import type { Design } from '@gatefold/model'
import { serializeDesign } from '@gatefold/model'

/**
 * Shareable-link encoding: a design is serialized to JSON, gzipped, then base64url-encoded
 * into a `?d=` query parameter. `decodeDesignLink` reverses this so a link can initialize
 * the app state. Uses the native `CompressionStream`/`DecompressionStream` (gzip) — the
 * caller is expected to handle the case where those are unavailable.
 */

/** Query-parameter key that carries the encoded design. */
export const LINK_QUERY_KEY = 'd'

/** A single-shot `ReadableStream` over the given bytes. */
function bytesStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

// The DOM types `CompressionStream`/`DecompressionStream` expose their writable side as
// `WritableStream<BufferSource>`, which `pipeThrough` rejects for a `Uint8Array` source —
// narrow them to a byte-transform stream.
type ByteTransform = TransformStream<Uint8Array, Uint8Array>

async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const stream = bytesStream(data).pipeThrough(new CompressionStream('gzip') as unknown as ByteTransform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const stream = bytesStream(data).pipeThrough(new DecompressionStream('gzip') as unknown as ByteTransform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Encode raw bytes as URL-safe base64 (RFC 4648 §5): `+`→`-`, `/`→`_`, no padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode URL-safe base64 back to raw bytes. */
export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Build a shareable URL for the design: current origin/path plus `?d=<gzip+base64url>`. */
export async function encodeDesignLink(design: Design): Promise<string> {
  const json = serializeDesign(design)
  const gz = await gzipBytes(new TextEncoder().encode(json))
  const payload = bytesToBase64Url(gz)
  return `${window.location.origin}${window.location.pathname}?${LINK_QUERY_KEY}=${payload}`
}

/** Decode a `?d=` link's search string back to its serialized-design JSON, or null. */
export async function decodeDesignLink(search: string): Promise<string | null> {
  const param = new URLSearchParams(search).get(LINK_QUERY_KEY)
  if (!param) return null
  try {
    const bytes = base64UrlToBytes(param)
    const gz = await gunzipBytes(bytes)
    return new TextDecoder().decode(gz)
  } catch {
    return null
  }
}
