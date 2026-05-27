import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  defineComponent,
  defineTag,
  defineObjectComponent,
  addComponent,
  hasComponent,
  getComponent,
  Types,
} from '../src/index.js'
import {
  serializeWorld,
  deserializeWorld,
  toJSON,
  fromJSON,
  createDeltaSerializer,
} from '../src/serialize.js'

describe('serialize', () => {
  const Position = defineComponent({ x: Types.f32, y: Types.f32 })
  const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
  const Player = defineTag()
  const Inventory = defineObjectComponent<{ items: string[] }>(() => ({ items: [] }))

  function setupWorld() {
    const w = createWorld()
    const e1 = createEntity(w)
    addComponent(w, e1, Position, { x: 1.5, y: -2.25 })
    addComponent(w, e1, Velocity, { x: 0.1, y: 0.2 })
    const e2 = createEntity(w)
    addComponent(w, e2, Position, { x: 7, y: 8 })
    addComponent(w, e2, Player)
    const e3 = createEntity(w)
    addComponent(w, e3, Inventory, { items: ['sword', 'shield'] })
    return { w, e1, e2, e3 }
  }

  it('binary round-trip preserves entities and components', () => {
    const { w, e1, e2, e3 } = setupWorld()
    const bytes = serializeWorld(w)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.byteLength).toBeGreaterThan(12)
    const w2 = deserializeWorld(bytes)
    expect(hasComponent(w2, e1 as any, Position)).toBe(true)
    expect(hasComponent(w2, e2 as any, Player)).toBe(true)
    const inv = getComponent(w2, e3 as any, Inventory) as any
    expect(inv?.items).toEqual(['sword', 'shield'])
  })

  it('binary magic byte check rejects bad bytes', () => {
    const badBytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => deserializeWorld(badBytes)).toThrow(/magic/)
  })

  it('toJSON / fromJSON round-trip', () => {
    const { w, e1 } = setupWorld()
    const snap = toJSON(w)
    expect(snap.version).toBe('0.1.0')
    expect(snap.entities.length).toBe(3)
    const w2 = fromJSON(snap)
    expect(hasComponent(w2, e1 as any, Position)).toBe(true)
  })

  it('delta serializer: first capture is full', () => {
    const { w } = setupWorld()
    const tx = createDeltaSerializer(w)
    const first = tx.capture()
    expect(first.byteLength).toBeGreaterThan(20)
  })

  it('delta serializer: second capture without changes is small', () => {
    const { w } = setupWorld()
    const tx = createDeltaSerializer(w)
    const first = tx.capture()
    const second = tx.capture()
    expect(second.byteLength).toBeLessThan(first.byteLength)
  })

  it('delta reset clears prior state', () => {
    const { w } = setupWorld()
    const tx = createDeltaSerializer(w)
    tx.capture()
    tx.reset()
    const next = tx.capture()
    // After reset, capture is full again
    expect(next.byteLength).toBeGreaterThan(20)
  })
})
