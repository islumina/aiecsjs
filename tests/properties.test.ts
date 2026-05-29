// fast-check property tests for aiecsjs core invariants.
// Tests two invariants:
//  1. packEid/unpackIdx/unpackGen round-trip is lossless and always non-negative.
//  2. ABA: a stale EntityRef deref to null after the slot is recycled n>=1 times.

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createEntity, createWorld, destroyEntity } from '../src/index.js'
import { deref, refOf } from '../src/index.js'
import { packEid, unpackGen, unpackIdx } from '../src/internal/entity.js'
import type { ResolvedWorldOptions } from '../src/internal/types.js'

const DEFAULT_OPTS: ResolvedWorldOptions = {
  indexBits: 24,
  generationBits: 8,
  indexMask: 0xffffff,
  generationMask: 0xff,
  maxEntities: 1_000_000,
  initialCapacity: 1024,
  maxComponents: 256,
  maskWordCount: 8,
  buffer: null,
  bufferByteOffset: 0,
}

describe('property: packEid/unpackIdx/unpackGen round-trip', () => {
  it('round-trips index and generation, always non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0xffffff }),
        fc.integer({ min: 0, max: 0xff }),
        (idx, gen) => {
          const eid = packEid(idx, gen, DEFAULT_OPTS)
          return (
            unpackIdx(eid as number, DEFAULT_OPTS) === idx &&
            unpackGen(eid as number, DEFAULT_OPTS) === gen &&
            (eid as number) >= 0
          )
        },
      ),
    )
  })

  it('eid is always >= 0 including the signed-overflow boundary (gen=128..255)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0xffffff }),
        fc.integer({ min: 128, max: 0xff }),
        (idx, gen) => {
          const eid = packEid(idx, gen, DEFAULT_OPTS)
          return (eid as number) >= 0
        },
      ),
    )
  })
})

describe('property: ABA deref always returns null after slot recycling', () => {
  it('deref of stale ref returns null after n >= 1 destroy+create cycles', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (n) => {
        const w = createWorld()
        let e = createEntity(w)
        const staleRef = refOf(w, e)

        // Recycle the slot n times — generation now differs from staleRef
        for (let i = 0; i < n; i++) {
          destroyEntity(w, e)
          e = createEntity(w)
        }

        // The stale ref's generation is behind by at least n — must deref null
        return deref(w, staleRef) === null
      }),
    )
  })
})
