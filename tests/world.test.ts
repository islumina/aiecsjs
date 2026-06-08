import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  destroyEntity,
  destroyWorld,
  disposeWorld,
  getWorldCapacity,
  getWorldSize,
  isWorld,
  resetWorld,
} from '../src/index.js'
import { getWorldState } from '../src/internal/world.js'

describe('world', () => {
  it('creates a world with default options', () => {
    const w = createWorld()
    expect(w.id).toBeGreaterThan(0)
    expect(w.version).toBe(pkg.version)
    expect(getWorldSize(w)).toBe(0)
    expect(getWorldCapacity(w)).toBe(1024)
  })

  it('honors initialCapacity', () => {
    const w = createWorld({ initialCapacity: 64 })
    expect(getWorldCapacity(w)).toBe(64)
  })

  it('isWorld true for live world, false for plain object', () => {
    const w = createWorld()
    expect(isWorld(w)).toBe(true)
    expect(isWorld({ id: 99999, capacity: 1, version: '0.0.0' })).toBe(false)
    expect(isWorld(null)).toBe(false)
    expect(isWorld(undefined)).toBe(false)
  })

  it('getWorldSize tracks alive entities', () => {
    const w = createWorld()
    createEntity(w)
    createEntity(w)
    createEntity(w)
    expect(getWorldSize(w)).toBe(3)
  })

  it('destroyWorld removes the world', () => {
    const w = createWorld()
    destroyWorld(w)
    expect(isWorld(w)).toBe(false)
    expect(() => createEntity(w)).toThrow()
  })

  it('disposeWorld is an alias for destroyWorld', () => {
    expect(disposeWorld).toBe(destroyWorld)
    const w = createWorld()
    disposeWorld(w)
    expect(isWorld(w)).toBe(false)
    expect(() => createEntity(w)).toThrow()
  })

  it('resetWorld wipes entities but keeps capacity and components', () => {
    const w = createWorld({ initialCapacity: 128 })
    const Position = defineComponent({ x: Types.f32, y: Types.f32 })
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 7, y: 9 })
    expect(getWorldSize(w)).toBe(1)
    resetWorld(w)
    expect(getWorldSize(w)).toBe(0)
    expect(getWorldCapacity(w)).toBe(128)
  })

  it('multiple worlds have distinct ids', () => {
    const a = createWorld()
    const b = createWorld()
    expect(a.id).not.toBe(b.id)
  })

  it('throws when indexBits is out of range', () => {
    expect(() => createWorld({ indexBits: 0 })).toThrow()
    expect(() => createWorld({ indexBits: 25 })).toThrow()
  })

  // Regression [P1-A]: resolveOptions only checked each dimension independently.
  // indexBits=24 + generationBits=16 = 40 bits > 32 → packEid overflow. The sum check
  // now throws early with a clear message.
  it('throws when indexBits + generationBits exceeds 32', () => {
    expect(() => createWorld({ indexBits: 24, generationBits: 16 })).toThrow(
      /indexBits.*generationBits.*must be <= 32/,
    )
  })

  it('accepts indexBits + generationBits exactly equal to 32', () => {
    const w = createWorld({ indexBits: 16, generationBits: 16 })
    expect(w).toBeTruthy()
    const e = createEntity(w)
    expect(e).toBeGreaterThanOrEqual(0)
    destroyEntity(w, e)
    const e2 = createEntity(w)
    expect(e2).toBeGreaterThanOrEqual(0)
  })

  it('throws when entity allocation exceeds maxEntities', () => {
    const w = createWorld({ initialCapacity: 4, maxEntities: 4 })
    for (let i = 0; i < 3; i++) createEntity(w) // indices 1..3 (0 reserved)
    // The 4th allocation should bring nextFreshIndex to 4 (the cap), then throw
    expect(() => {
      createEntity(w)
      createEntity(w)
    }).toThrow(/maxEntities/)
  })

  // Dispose three-cycle
  it('(a) normal dispose — world removed from registry', () => {
    const w = createWorld()
    disposeWorld(w)
    expect(isWorld(w)).toBe(false)
  })

  it('(b) dispose then createEntity throws "destroyed"', () => {
    const w = createWorld()
    disposeWorld(w)
    expect(() => createEntity(w)).toThrow(/destroyed/)
  })

  it('(b) dispose then addComponent throws "destroyed"', () => {
    const Position = defineComponent({ x: Types.f32 })
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0 })
    disposeWorld(w)
    expect(() => addComponent(w, e, Position, { x: 1 })).toThrow(/destroyed/)
  })

  it('(c) disposeWorld called twice is idempotent — no throw', () => {
    const w = createWorld()
    disposeWorld(w)
    expect(() => disposeWorld(w)).not.toThrow()
  })

  // Regression: disposeWorld must release the large per-entity arrays it
  // previously left allocated (entityMask/entityArchetype/generations etc.).
  // The capacity getter closure pins `state`, so these would otherwise survive
  // for as long as the public world handle. Behaviour is unchanged: post-dispose
  // ops still throw via getWorldState.
  it('dispose still rejects operations as before (no behavioural regression)', () => {
    const Position = defineComponent({ x: Types.f32 })
    const w = createWorld({ initialCapacity: 256 })
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1 })
    disposeWorld(w)
    expect(isWorld(w)).toBe(false)
    expect(() => createEntity(w)).toThrow(/destroyed/)
    expect(() => getWorldSize(w)).toThrow(/destroyed/)
  })

  it('dispose empties the large per-entity arrays (GC release)', () => {
    const w = createWorld({ initialCapacity: 1024 })
    // Capture the live internal state reference BEFORE dispose; disposeWorld
    // mutates this same object in place (the public handle's getter closes over it).
    const state = getWorldState(w)
    expect(state.entityMask.length).toBeGreaterThan(0)
    expect(state.entityArchetype.length).toBeGreaterThan(0)
    expect(state.generations.length).toBeGreaterThan(0)

    disposeWorld(w)

    expect(state.entityMask.length).toBe(0)
    expect(state.entityArchetype.length).toBe(0)
    expect(state.generations.length).toBe(0)
    expect(state.freeList.length).toBe(0)
    expect(state.componentBitFor.size).toBe(0)
    expect(state.bitToQueries.size).toBe(0)
    expect(state.queryArchetypeStamp.length).toBe(0)
    expect(state.sab).toBeNull()
  })
})
