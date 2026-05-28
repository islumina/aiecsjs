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

  it('recycles freed entities (slot reuse)', () => {
    const w = createWorld()
    const a = createEntity(w)
    destroyEntity(w, a)
    const b = createEntity(w)
    expect(b).toBe(a) // same slot
    expect(entityExists(w, b)).toBe(true)
  })

  it('getEntityIndex / packEntity are identity in 0.1', () => {
    expect(getEntityIndex(42 as any)).toBe(42)
    expect(getEntityGeneration(42 as any)).toBe(0)
    expect(packEntity(42, 3)).toBe(42)
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

  // Documents the v0.1 slot reuse behaviour: EntityId is a bare slot index
  // and does not encode generation. After destroy + create, a cached EntityId
  // may alias the new entity. ABA-safe references arrive with `EntityRef` in 0.2.
  it('reused slot returns the same EntityId value (no ABA protection in 0.1)', () => {
    const w = createWorld()
    const a = createEntity(w)
    destroyEntity(w, a)
    const b = createEntity(w)
    expect(b).toBe(a) // same numeric id; intentional in 0.1
    // The cached old EntityId now refers to the new live entity. This is
    // the documented limitation; consumers needing ABA safety wait for 0.2.
    expect(entityExists(w, a)).toBe(true)
  })
})
