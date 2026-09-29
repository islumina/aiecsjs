// Snapshot format 2 (0.6.0): stable component keys, the component table, and
// load-time resolution. "Another process" is simulated by clearing the
// process-wide component registry and re-defining the components in a
// different order, so this file keeps its registry resets to itself (same
// isolation discipline as tests/internal/reset-helpers.test.ts).

import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import {
  EcsError,
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineObjectComponent,
  defineTag,
  getComponent,
  getWorldSize,
  hasComponent,
} from '../src/index.js'
import { _resetComponentRegistry_FOR_TESTS_ONLY } from '../src/internal/component.js'
import { ids } from '../src/internal/registry.js'
import type { EntityId, WorldSnapshot } from '../src/internal/types.js'
import {
  createDeltaSerializer,
  deserializeWorld,
  fromJSON,
  serializeWorld,
  toJSON,
} from '../src/serialize.js'
import { adoptSnapshot, attachWorld, transferableSnapshot } from '../src/worker.js'

// Start this "process" from an empty registry.
function newProcess(): void {
  _resetComponentRegistry_FOR_TESTS_ONLY()
}

// A JSON round-trip, as if the snapshot crossed a network or storage boundary.
function viaJson(snap: WorldSnapshot): WorldSnapshot {
  return JSON.parse(JSON.stringify(snap)) as WorldSnapshot
}

// Rewrite a binary snapshot's header format version (bytes 4..7, LE uint32).
function withHeaderVersion(bytes: Uint8Array, version: number): Uint8Array {
  const out = bytes.slice()
  new DataView(out.buffer).setUint32(4, version, true)
  return out
}

// A 0.5.x-shaped snapshot: no formatVersion, no component table.
function asLegacy(snap: WorldSnapshot): WorldSnapshot {
  const { formatVersion: _format, components: _table, ...legacy } = viaJson(snap)
  return legacy as WorldSnapshot
}

function xOf(world: Parameters<typeof getComponent>[0], e: EntityId, c: object): number {
  const cols = getComponent(world, e, c as never) as { x: Float32Array }
  return cols.x[e & 0xffffff]!
}

describe('component keys', () => {
  it('defineComponent/defineTag/defineObjectComponent accept a stable key', () => {
    newProcess()
    defineComponent({ x: Types.f32 }, { key: 'k.soa' })
    defineTag({ key: 'k.tag' })
    defineObjectComponent(() => ({ n: 0 }), { key: 'k.aos' })
    const w = createWorld()
    expect(toJSON(w).components).toEqual([])
  })

  it('rejects an empty or non-string key before consuming an id', () => {
    newProcess()
    const before = ids.component
    expect(() => defineComponent({ x: Types.f32 }, { key: '' })).toThrow(EcsError)
    expect(() => defineTag({ key: 7 as unknown as string })).toThrow(
      /component key must be a non-empty string/,
    )
    expect(ids.component).toBe(before)
  })

  it('rejects a duplicate key with the offending key in the message', () => {
    newProcess()
    defineTag({ key: 'dup' })
    const before = ids.component
    expect(() => defineObjectComponent(undefined, { key: 'dup' })).toThrow(EcsError)
    expect(() => defineComponent({ a: Types.u8 }, { key: 'dup' })).toThrow(
      /component key "dup" is already defined/,
    )
    expect(ids.component).toBe(before)
  })

  it('returns the existing component when a key is redefined with the same layout', () => {
    newProcess()
    const Pos = defineComponent({ x: Types.f32, v: [Types.f32, 2] }, { key: 'pos' })
    const Tag = defineTag({ key: 't' })
    const Bag = defineObjectComponent(() => ({ n: 1 }), { key: 'bag' })
    const before = ids.component
    // A module re-run (HMR, editor script reload) defines the same keys again.
    const Pos2 = defineComponent({ x: Types.f32, v: [Types.f32, 2] }, { key: 'pos' })
    const Tag2 = defineTag({ key: 't' })
    const Bag2 = defineObjectComponent(() => ({ n: 2 }), { key: 'bag' })
    expect(ids.component).toBe(before)
    expect(Pos2.__id).toBe(Pos.__id)
    expect(Tag2.__id).toBe(Tag.__id)
    expect(Bag2.__id).toBe(Bag.__id)
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Bag)
    expect(getComponent(w, e, Bag)).toEqual({ n: 2 })
    expect(() => defineComponent({ x: Types.f64, v: [Types.f32, 2] }, { key: 'pos' })).toThrow(
      /component key "pos" is already defined with a different layout/,
    )
    expect(() => defineComponent({ x: Types.f32, v: [Types.f32, 3] }, { key: 'pos' })).toThrow(
      EcsError,
    )
    expect(() => defineComponent({ x: Types.f32 }, { key: 't' })).toThrow(EcsError)
    expect(ids.component).toBe(before)
  })
})

describe('snapshot format 2', () => {
  it('toJSON writes formatVersion 2 and a table of every referenced component', () => {
    newProcess()
    const Pos = defineComponent({ x: Types.f32, v: [Types.f32, 3] }, { key: 'pos' })
    const Tag = defineTag()
    defineTag({ key: 'unused' })
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Pos, { x: 1 })
    addComponent(w, e, Tag)
    const snap = toJSON(w)
    expect(snap.formatVersion).toBe(2)
    expect(snap.version).toBe(pkg.version)
    expect(snap.components).toEqual([
      {
        id: Pos.__id,
        key: 'pos',
        kind: 'soa',
        fields: [
          { name: 'x', type: 'f32', vectorLen: 1 },
          { name: 'v', type: 'f32', vectorLen: 3 },
        ],
      },
      { id: Tag.__id, key: null, kind: 'tag', fields: null },
    ])
    expect(snap.entities[0]!.components.map((c) => c.id)).toEqual([Pos.__id, Tag.__id])
  })

  it('keyed components round-trip across a reversed definition order', () => {
    newProcess()
    const APos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    const AVel = defineComponent({ x: Types.f32 }, { key: 'vel' })
    const AInv = defineObjectComponent(() => ({ items: [] as string[] }), { key: 'inv' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, APos, { x: 1 })
    addComponent(src, e, AVel, { x: 2 })
    addComponent(src, e, AInv, { items: ['sword'] })
    const bytes = serializeWorld(src)
    const json = viaJson(toJSON(src))

    // Loading process: same keys, reversed definition order, so every
    // creation-order id differs from the source's.
    newProcess()
    const BInv = defineObjectComponent(() => ({ items: [] as string[] }), { key: 'inv' })
    const BVel = defineComponent({ x: Types.f32 }, { key: 'vel' })
    const BPos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    expect(BPos.__id).not.toBe(APos.__id)

    for (const w of [deserializeWorld(bytes), fromJSON(json)]) {
      expect(xOf(w, e, BPos)).toBe(1)
      expect(xOf(w, e, BVel)).toBe(2)
      expect((getComponent(w, e, BInv) as { items: string[] }).items).toEqual(['sword'])
    }
  })

  it('keyless components are resolved by id and a schema mismatch is rejected', () => {
    newProcess()
    const A = defineComponent({ x: Types.f32, y: Types.f32 })
    defineComponent({ hp: Types.i32 })
    const src = createWorld()
    addComponent(src, createEntity(src), A, { x: 1, y: 2 })
    const snap = viaJson(toJSON(src))

    // Reversed order: id 1 is now the i32 component.
    newProcess()
    defineComponent({ hp: Types.i32 })
    defineComponent({ x: Types.f32, y: Types.f32 })
    expect(() => fromJSON(snap)).toThrow(EcsError)
    expect(() => fromJSON(snap)).toThrow(
      /snapshot component "#1" does not match the registered component: soa\(hp:i32\) vs soa\(x:f32,y:f32\)/,
    )
  })

  it('rejects a kind, field order, field type or vector length mismatch on a keyed component', () => {
    newProcess()
    const T = defineComponent({ x: Types.f32, y: Types.f32, v: [Types.f32, 2] }, { key: 'k' })
    const src = createWorld()
    addComponent(src, createEntity(src), T, { x: 1 })
    const snap = viaJson(toJSON(src))
    const variants: Array<() => void> = [
      () => defineTag({ key: 'k' }),
      () => defineComponent({ y: Types.f32, x: Types.f32, v: [Types.f32, 2] }, { key: 'k' }),
      () => defineComponent({ x: Types.f64, y: Types.f32, v: [Types.f32, 2] }, { key: 'k' }),
      () => defineComponent({ x: Types.f32, y: Types.f32, v: [Types.f32, 3] }, { key: 'k' }),
    ]
    for (const define of variants) {
      newProcess()
      define()
      expect(() => fromJSON(snap)).toThrow(EcsError)
      expect(() => fromJSON(snap, { onUnknownComponent: 'skip' })).toThrow(
        /snapshot component "k" does not match the registered component/,
      )
    }
  })

  it('an unknown key throws by default and is dropped with onUnknownComponent: skip', () => {
    newProcess()
    const Known = defineComponent({ x: Types.f32 }, { key: 'known' })
    const Ghost = defineTag({ key: 'ghost' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, Known, { x: 5 })
    addComponent(src, e, Ghost)
    const bytes = serializeWorld(src)

    newProcess()
    const Known2 = defineComponent({ x: Types.f32 }, { key: 'known' })
    expect(() => deserializeWorld(bytes)).toThrow(EcsError)
    expect(() => deserializeWorld(bytes)).toThrow(
      /snapshot component "ghost" is not defined in this process/,
    )
    const w = deserializeWorld(bytes, { onUnknownComponent: 'skip' })
    expect(xOf(w, e, Known2)).toBe(5)
    expect(getWorldSize(w)).toBe(1)
  })

  it('rejects a snapshot that is not an object with an entities array', () => {
    expect(() => fromJSON(null as unknown as WorldSnapshot)).toThrow(EcsError)
    expect(() => fromJSON({} as WorldSnapshot)).toThrow(/entities array/)
  })

  it('the components allowlist applies to the resolved (local) components', () => {
    newProcess()
    const APos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    const AVel = defineComponent({ x: Types.f32 }, { key: 'vel' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, APos, { x: 1 })
    addComponent(src, e, AVel, { x: 2 })
    const snap = viaJson(toJSON(src))

    newProcess()
    const BVel = defineComponent({ x: Types.f32 }, { key: 'vel' })
    const BPos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    const w = fromJSON(snap, { components: [BPos] })
    expect(hasComponent(w, e, BPos)).toBe(true)
    expect(hasComponent(w, e, BVel)).toBe(false)
  })
})

describe('0.5.x (format 1) snapshots', () => {
  it('a JSON snapshot without formatVersion is rejected by default', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 })
    const src = createWorld()
    addComponent(src, createEntity(src), P, { x: 3 })
    const legacy = asLegacy(toJSON(src))
    expect(() => fromJSON(legacy)).toThrow(EcsError)
    expect(() => fromJSON(legacy)).toThrow(/aiecsjs: format version 1 not supported/)
  })

  it('best-effort loads a legacy snapshot by id, skipping unknown ids', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, P, { x: 3 })
    const legacy = asLegacy(toJSON(src))
    legacy.entities[0]!.components.push({ kind: 'tag', id: 999, data: true })
    const w = fromJSON(legacy, { onUnknownVersion: 'best-effort' })
    expect(xOf(w, e, P)).toBe(3)
  })

  it('best-effort still rejects a kind mismatch on a legacy snapshot', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 })
    const src = createWorld()
    addComponent(src, createEntity(src), P, { x: 3 })
    const legacy = asLegacy(toJSON(src))
    newProcess()
    defineTag() // id 1 is now a tag
    expect(() => fromJSON(legacy, { onUnknownVersion: 'best-effort' })).toThrow(
      /snapshot component "#1" does not match the registered component: tag vs soa\(\)/,
    )
  })

  it('a binary snapshot with header format version 1 is rejected unless best-effort', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, P, { x: 4 })
    const v1 = withHeaderVersion(serializeWorld(src), 1)
    expect(() => deserializeWorld(v1)).toThrow(EcsError)
    expect(() => deserializeWorld(v1)).toThrow(/aiecsjs: format version 1 not supported/)
    // The body is still format 2, so best-effort resolves it by its table.
    expect(xOf(deserializeWorld(v1, { onUnknownVersion: 'best-effort' }), e, P)).toBe(4)
  })
})

describe('delta apply() with the component table', () => {
  it('routes keyed data by key into a replica defined in another order', () => {
    newProcess()
    const APos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    const AVel = defineComponent({ x: Types.f32 }, { key: 'vel' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, APos, { x: 1 })
    addComponent(src, e, AVel, { x: 2 })
    const ds = createDeltaSerializer(src)
    const full = ds.capture()
    ;(getComponent(src, e, APos) as { x: Float32Array }).x[e] = 10
    const delta = ds.capture()

    newProcess()
    const BVel = defineComponent({ x: Types.f32 }, { key: 'vel' })
    const BPos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    const replica = createWorld()
    const rx = createDeltaSerializer(replica)
    rx.apply(replica, full)
    rx.apply(replica, delta)
    expect(xOf(replica, e, BPos)).toBe(10)
    expect(xOf(replica, e, BVel)).toBe(2)
  })

  it('a delta carries formatVersion and the table', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 }, { key: 'p' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, P, { x: 1 })
    const ds = createDeltaSerializer(src)
    ds.capture()
    ;(getComponent(src, e, P) as { x: Float32Array }).x[e] = 2
    const body = ds.capture()
    const json = new TextDecoder().decode(body.subarray(16 + pkg.version.length))
    const delta = JSON.parse(json) as WorldSnapshot
    expect(delta.formatVersion).toBe(2)
    expect(delta.components.map((c) => c.key)).toEqual(['p'])
    expect(delta.entities).toHaveLength(1)
  })

  it('rejects an unknown component before touching the target world', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 }, { key: 'p' })
    const Ghost = defineTag({ key: 'ghost' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, P, { x: 1 })
    addComponent(src, createEntity(src), Ghost)
    const full = createDeltaSerializer(src).capture()

    newProcess()
    defineComponent({ x: Types.f32 }, { key: 'p' })
    const replica = createWorld()
    expect(() => createDeltaSerializer(replica).apply(replica, full)).toThrow(EcsError)
    expect(getWorldSize(replica)).toBe(0)
  })

  it('apply() on a read-only world throws EcsError', () => {
    newProcess()
    const P = defineComponent({ x: Types.f32 }, { key: 'p' })
    const src = createWorld()
    addComponent(src, createEntity(src), P, { x: 1 })
    const bytes = serializeWorld(src)
    const view = attachWorld(transferableSnapshot(src).buffer, { readOnly: true })
    expect(() => createDeltaSerializer(view).apply(view, bytes)).toThrow(EcsError)
    expect(() => createDeltaSerializer(view).apply(view, bytes)).toThrow(/read-only/)
  })
})

describe('worker adopt/attach with the component table', () => {
  function makeSource() {
    newProcess()
    const APos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    const AGhost = defineTag({ key: 'ghost' })
    const src = createWorld()
    const e = createEntity(src)
    addComponent(src, e, APos, { x: 7 })
    addComponent(src, e, AGhost)
    const snap = structuredClone(transferableSnapshot(src))
    newProcess()
    const BPos = defineComponent({ x: Types.f32 }, { key: 'pos' })
    return { e, snap, BPos }
  }

  it('adoptSnapshot resolves by key and honours onUnknownComponent', () => {
    const { e, snap, BPos } = makeSource()
    expect(() => adoptSnapshot(snap)).toThrow(/"ghost" is not defined in this process/)
    const w = adoptSnapshot(snap, { onUnknownComponent: 'skip' })
    expect(xOf(w, e, BPos)).toBe(7)
  })

  it('attachWorld resolves by key and honours onUnknownComponent with readOnly', () => {
    const { e, snap, BPos } = makeSource()
    expect(() => attachWorld(snap.buffer)).toThrow(EcsError)
    const view = attachWorld(snap.buffer, { readOnly: true, onUnknownComponent: 'skip' })
    expect(xOf(view, e, BPos)).toBe(7)
    expect(() => createEntity(view)).toThrow(/read-only/)
  })

  it('adoptSnapshot rejects meta format version 1 unless best-effort', () => {
    const { e, snap, BPos } = makeSource()
    const v1 = {
      buffer: withHeaderVersion(new Uint8Array(snap.buffer), 1).buffer,
      meta: { ...snap.meta, formatVersion: 1 },
    }
    expect(() => adoptSnapshot(v1)).toThrow(EcsError)
    expect(() => adoptSnapshot(v1)).toThrow(/aiecsjs: format version 1 not supported/)
    const w = adoptSnapshot(v1, { onUnknownVersion: 'best-effort', onUnknownComponent: 'skip' })
    expect(xOf(w, e, BPos)).toBe(7)
  })
})
