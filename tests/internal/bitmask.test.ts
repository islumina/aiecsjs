import { describe, it, expect } from 'vitest'
import {
  createMask,
  setBit,
  clearBit,
  testBit,
  copyMask,
  cloneMask,
  maskEquals,
  maskHash,
  isMaskZero,
  unionMask,
  matches,
  listBits,
} from '../../src/internal/bitmask.js'

describe('createMask', () => {
  it('returns a zeroed Uint32Array of requested word count', () => {
    const m = createMask(3)
    expect(m).toBeInstanceOf(Uint32Array)
    expect(m.length).toBe(3)
    expect(Array.from(m)).toEqual([0, 0, 0])
  })
})

describe('setBit / testBit / clearBit', () => {
  it('sets and tests bits within a single word', () => {
    const m = createMask(1)
    setBit(m, 0)
    setBit(m, 5)
    setBit(m, 31)
    expect(testBit(m, 0)).toBe(true)
    expect(testBit(m, 5)).toBe(true)
    expect(testBit(m, 31)).toBe(true)
    expect(testBit(m, 1)).toBe(false)
    expect(testBit(m, 30)).toBe(false)
  })

  it('crosses word boundary (bit 32 lives in word 1)', () => {
    const m = createMask(2)
    setBit(m, 32)
    setBit(m, 63)
    expect(testBit(m, 32)).toBe(true)
    expect(testBit(m, 63)).toBe(true)
    expect(testBit(m, 31)).toBe(false)
    expect(m[0]).toBe(0)
    expect(m[1]).not.toBe(0)
  })

  it('clearBit removes a previously set bit', () => {
    const m = createMask(1)
    setBit(m, 7)
    expect(testBit(m, 7)).toBe(true)
    clearBit(m, 7)
    expect(testBit(m, 7)).toBe(false)
  })

  it('clearBit on an unset bit is a no-op', () => {
    const m = createMask(1)
    clearBit(m, 3)
    expect(testBit(m, 3)).toBe(false)
    expect(m[0]).toBe(0)
  })

  it('setBit is idempotent', () => {
    const m = createMask(1)
    setBit(m, 10)
    const after1 = m[0]
    setBit(m, 10)
    expect(m[0]).toBe(after1)
  })
})

describe('copyMask / cloneMask', () => {
  it('copyMask writes src content into dst', () => {
    const a = createMask(2)
    setBit(a, 3)
    setBit(a, 40)
    const b = createMask(2)
    copyMask(b, a)
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('cloneMask returns a new array with same content', () => {
    const a = createMask(2)
    setBit(a, 17)
    const b = cloneMask(a)
    expect(b).not.toBe(a)
    expect(b.length).toBe(a.length)
    expect(testBit(b, 17)).toBe(true)
  })
})

describe('maskEquals', () => {
  it('returns true for identical contents', () => {
    const a = createMask(2)
    const b = createMask(2)
    setBit(a, 5); setBit(b, 5)
    expect(maskEquals(a, b)).toBe(true)
  })

  it('returns false when contents differ', () => {
    const a = createMask(2)
    const b = createMask(2)
    setBit(a, 5); setBit(b, 6)
    expect(maskEquals(a, b)).toBe(false)
  })

  it('returns false when lengths differ', () => {
    const a = createMask(2)
    const b = createMask(3)
    expect(maskEquals(a, b)).toBe(false)
  })
})

describe('maskHash', () => {
  it('produces the same key for equal masks', () => {
    const a = createMask(2)
    const b = createMask(2)
    setBit(a, 3); setBit(a, 42)
    setBit(b, 3); setBit(b, 42)
    expect(maskHash(a)).toBe(maskHash(b))
  })

  it('produces different keys for different masks', () => {
    const a = createMask(2)
    const b = createMask(2)
    setBit(a, 3)
    setBit(b, 4)
    expect(maskHash(a)).not.toBe(maskHash(b))
  })

  it('distinguishes word position (bit 31 vs bit 32)', () => {
    const a = createMask(2)
    const b = createMask(2)
    setBit(a, 31)
    setBit(b, 32)
    expect(maskHash(a)).not.toBe(maskHash(b))
  })
})

describe('isMaskZero', () => {
  it('returns true for a freshly created mask', () => {
    expect(isMaskZero(createMask(4))).toBe(true)
  })

  it('returns false when any bit is set', () => {
    const m = createMask(2)
    setBit(m, 40)
    expect(isMaskZero(m)).toBe(false)
  })

  it('returns true after every set bit is cleared', () => {
    const m = createMask(2)
    setBit(m, 1); setBit(m, 33)
    clearBit(m, 1); clearBit(m, 33)
    expect(isMaskZero(m)).toBe(true)
  })
})

describe('unionMask', () => {
  it('returns OR of two masks', () => {
    const a = createMask(2)
    const b = createMask(2)
    setBit(a, 5); setBit(a, 33)
    setBit(b, 6); setBit(b, 34)
    const u = unionMask(a, b)
    expect(testBit(u, 5)).toBe(true)
    expect(testBit(u, 6)).toBe(true)
    expect(testBit(u, 33)).toBe(true)
    expect(testBit(u, 34)).toBe(true)
    expect(testBit(u, 4)).toBe(false)
  })
})

describe('matches (archetype query truth table)', () => {
  // Construct masks: with=[A,B], any=[C,D], none=[E]
  const words = 1
  const A = 0, B = 1, C = 2, D = 3, E = 4

  function build(bits: number[]): Uint32Array {
    const m = createMask(words)
    for (const b of bits) setBit(m, b)
    return m
  }

  const withMask = build([A, B])
  const anyMask = build([C, D])
  const noneMask = build([E])

  it('passes when all with-bits present, one any-bit present, no none-bit', () => {
    const m = build([A, B, C])
    expect(matches(m, withMask, anyMask, noneMask, true, words)).toBe(true)
  })

  it('fails when a with-bit is missing', () => {
    const m = build([A, C]) // missing B
    expect(matches(m, withMask, anyMask, noneMask, true, words)).toBe(false)
  })

  it('fails when no any-bit is present (anyHasBits=true)', () => {
    const m = build([A, B]) // no C or D
    expect(matches(m, withMask, anyMask, noneMask, true, words)).toBe(false)
  })

  it('passes when anyHasBits=false (any clause not required)', () => {
    const m = build([A, B])
    expect(matches(m, withMask, anyMask, noneMask, false, words)).toBe(true)
  })

  it('fails when a none-bit is present', () => {
    const m = build([A, B, C, E])
    expect(matches(m, withMask, anyMask, noneMask, true, words)).toBe(false)
  })

  it('passes with both any-bits set', () => {
    const m = build([A, B, C, D])
    expect(matches(m, withMask, anyMask, noneMask, true, words)).toBe(true)
  })

  it('empty query (all zero masks, anyHasBits=false) matches anything', () => {
    const zero = createMask(words)
    const m = build([A])
    expect(matches(m, zero, zero, zero, false, words)).toBe(true)
  })
})

describe('listBits', () => {
  it('returns set bits in ascending order across word boundary', () => {
    const m = createMask(2)
    setBit(m, 0)
    setBit(m, 31)
    setBit(m, 32)
    setBit(m, 33)
    setBit(m, 63)
    expect(listBits(m)).toEqual([0, 31, 32, 33, 63])
  })

  it('returns empty array for an empty mask', () => {
    expect(listBits(createMask(2))).toEqual([])
  })
})
