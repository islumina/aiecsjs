import { describe, expect, it } from 'vitest'
import {
  createEntity,
  createWorld,
  destroyEntity,
  entityExists,
  getEntityGeneration,
  getEntityIndex,
  isEntity,
  packEntity,
} from '../src/index.js'

describe('entity', () => {
  it('createEntity never returns 0', () => {
    const w = createWorld()
    for (let i = 0; i < 10; i++) {
      const e = createEntity(w)
      expect(e).toBeGreaterThan(0)
    }
  })

  it('entityExists tracks live status', () => {
    const w = createWorld()
    const e = createEntity(w)
    expect(entityExists(w, e)).toBe(true)
    destroyEntity(w, e)
    expect(entityExists(w, e)).toBe(false)
  })

  it('destroyEntity twice is a no-op', () => {
    const w = createWorld()
    const e = createEntity(w)
    destroyEntity(w, e)
    expect(() => destroyEntity(w, e)).not.toThrow()
  })

  it('recycles freed entities (slot reuse — same index, different generation)', () => {
    const w = createWorld()
    const a = createEntity(w)
    destroyEntity(w, a)
    const b = createEntity(w)
    // Same raw slot index, but different packed value (generation bumped)
    expect(getEntityIndex(b)).toBe(getEntityIndex(a))
    expect(entityExists(w, b)).toBe(true)
  })

  it('getEntityIndex / packEntity round-trip in 0.3', () => {
    expect(getEntityIndex(packEntity(42, 3))).toBe(42)
    expect(getEntityGeneration(packEntity(42, 3))).toBe(3)
    expect(getEntityIndex(packEntity(1, 0))).toBe(1)
    expect(getEntityGeneration(packEntity(1, 0))).toBe(0)
  })

  it('isEntity checks liveness, rejects 0', () => {
    const w = createWorld()
    const e = createEntity(w)
    expect(isEntity(w, e)).toBe(true)
    expect(isEntity(w, 0)).toBe(false)
    expect(isEntity(w, 'hello')).toBe(false)
  })

  it('allocates many entities up to capacity', () => {
    const w = createWorld({ initialCapacity: 8 })
    const ents: number[] = []
    for (let i = 0; i < 50; i++) ents.push(createEntity(w) as number)
    // After 50 entities, the world should have grown beyond 8
    expect(ents.length).toBe(50)
    expect(new Set(ents).size).toBe(50)
  })

  // Documents the v0.3 ABA protection: packed EntityId encodes generation.
  // After destroy + create on the same slot, the old EntityId has a different
  // packed value (stale generation) and is correctly reported as dead.
  it('ABA protection works: reused slot gets new packed EntityId', () => {
    const w = createWorld()
    const a = createEntity(w)
    const aIdx = getEntityIndex(a)
    destroyEntity(w, a)
    const b = createEntity(w)
    // Same slot index, but packed value differs (generation bumped)
    expect(getEntityIndex(b)).toBe(aIdx)
    expect(b).not.toBe(a) // packed values differ due to generation
    // Old packed eid is now stale — must report dead
    expect(entityExists(w, a)).toBe(false)
    // New entity is live
    expect(entityExists(w, b)).toBe(true)
  })

  it('generationBits=0 degenerate mode: spawn/destroy still works', () => {
    const w = createWorld({ generationBits: 0 })
    const e = createEntity(w)
    expect(entityExists(w, e)).toBe(true)
    destroyEntity(w, e)
    expect(entityExists(w, e)).toBe(false)
  })

  it('generationBits=16 boundary: spawn/destroy works', () => {
    const w = createWorld({ generationBits: 16 })
    const e = createEntity(w)
    expect(entityExists(w, e)).toBe(true)
    destroyEntity(w, e)
    expect(entityExists(w, e)).toBe(false)
  })

  it('indexBits=10 small range: throws on 1025th entity', () => {
    const w = createWorld({ indexBits: 10, maxEntities: 1023 })
    for (let i = 0; i < 1023; i++) createEntity(w)
    expect(() => createEntity(w)).toThrow()
  })

  it('entityExists returns false for garbage numbers (large, negative, float)', () => {
    const w = createWorld()
    expect(entityExists(w, 999999999 as any)).toBe(false)
    expect(entityExists(w, -1 as any)).toBe(false)
    expect(entityExists(w, 1.5 as any)).toBe(false)
    expect(entityExists(w, 0 as any)).toBe(false)
  })
})
