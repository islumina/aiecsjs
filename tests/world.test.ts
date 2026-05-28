import { describe, it, expect } from 'vitest'
import {
  createWorld,
  destroyWorld,
  resetWorld,
  getWorldSize,
  getWorldCapacity,
  isWorld,
  createEntity,
  defineComponent,
  addComponent,
  Types,
} from '../src/index.js'

describe('world', () => {
  it('creates a world with default options', () => {
    const w = createWorld()
    expect(w.id).toBeGreaterThan(0)
    expect(w.version).toBe('0.1.3')
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

  it('throws when entity allocation exceeds maxEntities', () => {
    const w = createWorld({ initialCapacity: 4, maxEntities: 4 })
    for (let i = 0; i < 3; i++) createEntity(w) // indices 1..3 (0 reserved)
    // The 4th allocation should bring nextFreshIndex to 4 (the cap), then throw
    expect(() => {
      createEntity(w)
      createEntity(w)
    }).toThrow(/maxEntities/)
  })
})
