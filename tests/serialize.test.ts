import { describe, expect, it } from 'vitest'
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineObjectComponent,
  defineQuery,
  defineTag,
  destroyEntity,
  getComponent,
  hasComponent,
  runQuery,
} from '../src/index.js'
import {
  createDeltaSerializer,
  deserializeWorld,
  fromJSON,
  serializeWorld,
  toJSON,
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
    expect(snap.version).toBe('0.4.1')
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

  it('options.components filters out components not in the allowlist', () => {
    const { w, e1 } = setupWorld()
    // Serialise only Position; Velocity and Player should not survive
    const bytes = serializeWorld(w, { components: [Position] })
    const w2 = deserializeWorld(bytes)
    expect(hasComponent(w2, e1 as any, Position)).toBe(true)
    expect(hasComponent(w2, e1 as any, Velocity)).toBe(false)
  })

  it('onUnknownVersion=throw rejects a format version mismatch', () => {
    const { w } = setupWorld()
    const bytes = serializeWorld(w)
    // Bytes 4..7 are the little-endian uint32 format version. Corrupt it.
    bytes[4] = 0xff
    bytes[5] = 0xff
    bytes[6] = 0xff
    bytes[7] = 0xfe
    expect(() => deserializeWorld(bytes, { onUnknownVersion: 'throw' })).toThrow(/format version/)
  })

  it('onUnknownVersion=best-effort tolerates a format version mismatch', () => {
    const { w } = setupWorld()
    const bytes = serializeWorld(w)
    bytes[4] = 0xff
    bytes[5] = 0xff
    bytes[6] = 0xff
    bytes[7] = 0xfe
    expect(() => deserializeWorld(bytes, { onUnknownVersion: 'best-effort' })).not.toThrow()
  })

  // Regression [P0-A]: toJSON used an inline signed pack expression; for gen≥128 the
  // result was negative, diverging from the unsigned key stored in arch.entityRow, so
  // the entity was silently dropped from the snapshot. packEid (>>> 0) fixes this.
  it('toJSON/fromJSON round-trip preserves a high-generation entity (gen≥128)', () => {
    const HighGen = defineComponent({ hp: Types.i32 })
    const w = createWorld()
    let e = createEntity(w)
    addComponent(w, e, HighGen, { hp: 99 })

    // Recycle the same slot 130 times to reach gen≥128 (default generationBits=8, wraps at 256)
    for (let i = 0; i < 130; i++) {
      destroyEntity(w, e)
      e = createEntity(w)
    }
    addComponent(w, e, HighGen, { hp: 42 })

    const snap = toJSON(w)
    // Verify the entity is actually present in the snapshot (was silently dropped before fix)
    expect(snap.entities).toHaveLength(1)
    expect(snap.entities[0]?.eid).toBeDefined()

    // fromJSON rebuilds with fresh gen-0 entities; use a query to find the entity in w2
    const w2 = fromJSON(snap)
    const results = runQuery(w2, defineQuery([HighGen]))
    expect(results).toHaveLength(1)
    const eInW2 = results[0]!
    // SoA getComponent returns column views; index by the entity id
    const cols = getComponent(w2, eInW2, HighGen) as any
    expect(cols).not.toBeNull()
    expect(cols.hp[eInW2]).toBe(42)
  })
})
