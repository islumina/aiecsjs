// Multi-word Uint32 bitmask helpers.

export function createMask(wordCount: number): Uint32Array {
  return new Uint32Array(wordCount)
}

export function setBit(mask: Uint32Array, bit: number): void {
  const w = bit >>> 5
  mask[w] = (mask[w] ?? 0) | (1 << (bit & 31))
}

export function clearBit(mask: Uint32Array, bit: number): void {
  const w = bit >>> 5
  mask[w] = (mask[w] ?? 0) & ~(1 << (bit & 31))
}

export function testBit(mask: Uint32Array, bit: number): boolean {
  const w = bit >>> 5
  return ((mask[w] ?? 0) & (1 << (bit & 31))) !== 0
}

export function copyMask(dst: Uint32Array, src: Uint32Array): void {
  const n = src.length
  for (let i = 0; i < n; i++) dst[i] = src[i] ?? 0
}

export function cloneMask(src: Uint32Array): Uint32Array {
  const out = new Uint32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] ?? 0
  return out
}

export function maskEquals(a: Uint32Array, b: Uint32Array): boolean {
  const n = a.length
  if (b.length !== n) return false
  for (let i = 0; i < n; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false
  return true
}

export function maskHash(m: Uint32Array): string {
  // Stable string key for Map lookups. Hex-joined.
  const parts: string[] = []
  for (let i = 0; i < m.length; i++) {
    parts.push((m[i] ?? 0).toString(16))
  }
  return parts.join(',')
}

export function isMaskZero(m: Uint32Array): boolean {
  for (let i = 0; i < m.length; i++) if ((m[i] ?? 0) !== 0) return false
  return true
}

export function unionMask(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out = new Uint32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) | (b[i] ?? 0)
  return out
}

export function listBits(mask: Uint32Array): number[] {
  const out: number[] = []
  forEachSetBit(mask, 0, mask.length, (bit) => out.push(bit))
  return out
}

// Iterate set bits in a slice of a larger Uint32Array starting at `base`.
// Shared by destroy paths and storage cleanup so the bit-extraction maths
// lives in exactly one place.
export function forEachSetBit(
  mask: Uint32Array,
  base: number,
  words: number,
  fn: (bit: number) => void,
): void {
  for (let wi = 0; wi < words; wi++) {
    let word = mask[base + wi] ?? 0
    while (word !== 0) {
      const bit = (wi << 5) + ctz32(word)
      fn(bit)
      word &= word - 1
    }
  }
}

/**
 * Match a query against a mask stored at word offset `base` of `entityMask`
 * (base 0 for a standalone archetype / entity mask). Reading directly from the
 * parent array avoids a temporary Uint32Array on every observer dispatch.
 *   - withMask: all of these bits must be present
 *   - anyMask:  if anyHasBits, at least one of these bits must be present
 *   - noneMask: none of these bits may be present
 */
export function matchesEntityMask(
  entityMask: Uint32Array,
  base: number,
  words: number,
  withMask: Uint32Array,
  anyMask: Uint32Array,
  noneMask: Uint32Array,
  anyHasBits: boolean,
): boolean {
  let anyHit = !anyHasBits
  for (let i = 0; i < words; i++) {
    const m = entityMask[base + i] ?? 0
    const wm = withMask[i] ?? 0
    const am = anyMask[i] ?? 0
    const nm = noneMask[i] ?? 0
    if ((m & wm) !== wm) return false
    if ((m & nm) !== 0) return false
    if (!anyHit && (m & am) !== 0) anyHit = true
  }
  return anyHit
}

function ctz32(v: number): number {
  // Count trailing zeros in a 32-bit integer (assumes v !== 0)
  return 31 - Math.clz32(v & -v)
}
