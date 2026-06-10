import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
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
  getWorldCapacity,
  hasComponent,
  runQuery,
  setComponent,
} from '../src/index.js'
import type { WorldSnapshot } from '../src/internal/types.js'
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
    expect(snap.version).toBe(pkg.version)
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

  // unpackBinary best-effort: a corrupt JSON body must surface a namespaced
  // aiecsjs: error rather than a raw SyntaxError. We keep a valid header (magic +
  // version) and clobber a byte inside the JSON region so the body fails to parse.
  it('unpackBinary surfaces a namespaced error on a malformed JSON body', () => {
    const { w } = setupWorld()
    const bytes = serializeWorld(w)
    // The JSON body is the trailing region; flip its final byte (the closing
    // `}`) to a non-structural character so JSON.parse throws.
    bytes[bytes.length - 1] = 0x21 // '!'
    expect(() => deserializeWorld(bytes, { onUnknownVersion: 'best-effort' })).toThrow(/aiecsjs:/)
    expect(() => deserializeWorld(bytes, { onUnknownVersion: 'best-effort' })).not.toThrow(
      /SyntaxError/,
    )
  })

  // --- DeltaSerializer.apply() round-trip (happy path) ---

  it('apply(): full snapshot reproduces entities/components in a FRESH world', () => {
    const { w, e1, e2, e3 } = setupWorld()
    const tx = createDeltaSerializer(w)
    const full = tx.capture() // first capture is a full snapshot

    const fresh = createWorld()
    createDeltaSerializer(fresh).apply(fresh, full)

    // SoA columns are indexed by raw slot; the fresh world re-creates the same
    // slot indices (1..3) so the original packed eids address the same rows.
    expect(hasComponent(fresh, e1 as any, Position)).toBe(true)
    expect(hasComponent(fresh, e1 as any, Velocity)).toBe(true)
    const p1 = getComponent(fresh, e1 as any, Position) as any
    expect(p1.x[e1 as number]).toBeCloseTo(1.5)
    expect(p1.y[e1 as number]).toBeCloseTo(-2.25)

    expect(hasComponent(fresh, e2 as any, Player)).toBe(true)
    const inv = getComponent(fresh, e3 as any, Inventory) as any
    expect(inv?.items).toEqual(['sword', 'shield'])
  })

  it('apply(): an incremental delta updates an existing entity', () => {
    const { w, e1 } = setupWorld()
    const tx = createDeltaSerializer(w)

    // Replica kept in lockstep with the same delta stream.
    const replica = createWorld()
    const rx = createDeltaSerializer(replica)
    rx.apply(replica, tx.capture()) // seed replica with the full snapshot

    // Mutate e1 on the source, then capture the incremental delta.
    setComponent(w, e1, Position, { x: 99, y: 100 })
    const delta = tx.capture()

    rx.apply(replica, delta)

    const p = getComponent(replica, e1 as any, Position) as any
    expect(p.x[e1 as number]).toBeCloseTo(99)
    expect(p.y[e1 as number]).toBeCloseTo(100)
  })

  // DeltaSerializer.apply() is now sound on a non-pristine target: it
  // materialises each snapshot entity at the source's slot index, reusing or
  // reclaiming the slot with its current generation.
  it('apply(): churned replica (advanced generations) does not throw and applies at the right slots', () => {
    const { w } = setupWorld()
    const full = createDeltaSerializer(w).capture()

    // Churn the replica so slots 1..3 carry advanced generations + a freeList.
    const replica = createWorld()
    const tmps = [createEntity(replica), createEntity(replica), createEntity(replica)]
    for (const t of tmps) destroyEntity(replica, t)

    const rx = createDeltaSerializer(replica)
    expect(() => rx.apply(replica, full)).not.toThrow()

    const byEid = new Map(toJSON(replica).entities.map((e) => [e.eid, e]))
    expect([...byEid.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3])
    // Components landed at the right slots (e1 had Position+Velocity, e3 Inventory).
    expect(byEid.get(1)?.components.length ?? 0).toBeGreaterThan(0)
    expect(byEid.get(3)?.components.length ?? 0).toBeGreaterThan(0)
  })

  it('apply(): a hole in the source slot range does not create a phantom entity', () => {
    const { w, e2 } = setupWorld()
    destroyEntity(w, e2) // slot 2 becomes a hole; source keeps slots 1 and 3
    const full = createDeltaSerializer(w).capture()

    const replica = createWorld()
    createDeltaSerializer(replica).apply(replica, full)

    // Exactly the two live source entities — slot 2 is NOT materialised.
    const eids = toJSON(replica)
      .entities.map((e) => e.eid)
      .sort((a, b) => a - b)
    expect(eids).toEqual([1, 3])
  })

  // ECS-S-01 (P1/security): a hostile JSON snapshot can inflate the `capacity`
  // field independently of how many entities it actually carries. fromJSON fed
  // that field straight to createWorld({ initialCapacity }), and world.ts clamps
  // only to 1<<indexBits (16,777,216) — so a ~100-byte payload with capacity
  // 1<<24 forced ~590 MB of TypedArray allocation (entityMask 512 MB +
  // entityArchetype 64 MB + generations 16 MB): a browser-tab OOM DoS. The clamp
  // ties restored capacity to the real entity count, not the attacker's number.
  describe('ECS-S-01: hostile snapshot capacity is clamped', () => {
    function makeHostileSnapshot(capacity: number): WorldSnapshot {
      // A genuinely tiny payload: a single entity carrying one Position, but a
      // wildly inflated capacity. Position's internal id is what the source world
      // assigned it (1-based registration order in this test module).
      return {
        version: pkg.version,
        capacity,
        entities: [{ eid: 1, components: [{ kind: 'soa', id: Position.__id, data: { x: 1, y: 2 } }] }],
      }
    }

    it('fromJSON clamps capacity from a tiny payload (no ~590 MB allocation)', () => {
      const HOSTILE = 1 << 24 // 16,777,216 — the pre-fix path would allocate ~590 MB
      const w = fromJSON(makeHostileSnapshot(HOSTILE))
      // The restored world must NOT honour the inflated number. It tracks the
      // single carried entity (plus a small allocation floor), nowhere near 16 M.
      expect(getWorldCapacity(w)).toBeLessThan(HOSTILE)
      expect(getWorldCapacity(w)).toBeLessThanOrEqual(4096)
      // The world is still usable and the actual entity survived.
      const snap = toJSON(w)
      expect(snap.entities.length).toBe(1)
    })

    it('deserializeWorld (binary path) is clamped too', () => {
      const HOSTILE = 1 << 24
      // Pack the hostile JSON through the real binary writer so the binary entry
      // point (deserializeWorld) is exercised, not just fromJSON.
      const bytes = serializeBinaryFromSnapshot(makeHostileSnapshot(HOSTILE))
      const w = deserializeWorld(bytes)
      expect(getWorldCapacity(w)).toBeLessThan(HOSTILE)
      expect(getWorldCapacity(w)).toBeLessThanOrEqual(4096)
    })

    it('a legitimate large capacity still round-trips (clamp tracks entity count, not a fixed ceiling)', () => {
      // 2,000 real entities → restored capacity must be able to hold them all.
      const w = createWorld()
      for (let i = 0; i < 2000; i++) {
        const e = createEntity(w)
        addComponent(w, e, Position, { x: i, y: i })
      }
      const restored = fromJSON(toJSON(w))
      expect(toJSON(restored).entities.length).toBe(2000)
      expect(getWorldCapacity(restored)).toBeGreaterThanOrEqual(2000)
    })
  })
})

// Build a binary snapshot blob from a raw WorldSnapshot using the SAME header
// layout serializeWorld emits (magic + format version + version string + json),
// so deserializeWorld accepts it. Lets a test feed a hand-crafted hostile body
// through the binary entry point.
function serializeBinaryFromSnapshot(snapshot: WorldSnapshot): Uint8Array {
  const MAGIC = 'AIEC'
  const FORMAT_VERSION = 1
  const json = JSON.stringify(snapshot)
  const jsonBytes = new TextEncoder().encode(json)
  const versionBytes = new TextEncoder().encode(pkg.version)
  const total = 4 + 4 + 4 + versionBytes.length + 4 + jsonBytes.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let off = 0
  out[off++] = MAGIC.charCodeAt(0)
  out[off++] = MAGIC.charCodeAt(1)
  out[off++] = MAGIC.charCodeAt(2)
  out[off++] = MAGIC.charCodeAt(3)
  view.setUint32(off, FORMAT_VERSION, true)
  off += 4
  view.setUint32(off, versionBytes.length, true)
  off += 4
  out.set(versionBytes, off)
  off += versionBytes.length
  view.setUint32(off, jsonBytes.length, true)
  off += 4
  out.set(jsonBytes, off)
  return out
}
