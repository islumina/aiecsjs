import { describe, expect, it } from 'vitest'
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineObjectComponent,
  defineQuery,
  type EntityId,
  getComponent,
  getEntityIndex,
  runQuery,
  type World,
} from '../src/index.js'
import type { ComponentLike } from '../src/internal/types.js'
import {
  createDeltaSerializer,
  deserializeWorld,
  fromJSON,
  serializeWorld,
  toJSON,
} from '../src/serialize.js'
import { VERSION } from '../src/version.js'
import { adoptSnapshot, attachWorld, transferableSnapshot } from '../src/worker.js'

// The JSON body of a binary snapshot (layout: magic, format, verLen, VERSION,
// jsonLen, body).
function bodyOf(bytes: Uint8Array): string {
  const verLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true)
  return new TextDecoder().decode(bytes.subarray(16 + verLen))
}

// The single entity of `w` holding `c`, with its slot index.
function only(w: World, c: ComponentLike) {
  const [e] = runQuery(w, defineQuery([c])) as EntityId[]
  return { e: e!, i: getEntityIndex(e!) }
}

describe('binary snapshot round-trips non-finite floats', () => {
  it('Infinity / -Infinity / NaN survive serializeWorld -> deserializeWorld', () => {
    const Stat = defineComponent({ range: 'f32', cooldown: 'f64', n: 'f32' }, { key: 'test.stat' })
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Stat, { range: Infinity, cooldown: -Infinity, n: NaN })

    const viaObj = fromJSON(toJSON(w))
    const eo = runQuery(viaObj, defineQuery([Stat]))[0]!
    const co = getComponent(viaObj, eo, Stat) as Record<string, Float32Array>
    expect(co.range![getEntityIndex(eo)]).toBe(Infinity)

    const w2 = deserializeWorld(serializeWorld(w))
    const e2 = runQuery(w2, defineQuery([Stat]))[0]!
    const c = getComponent(w2, e2, Stat) as Record<string, Float32Array>
    const i = getEntityIndex(e2)
    expect(c.range![i]).toBe(Infinity)
    expect(c.cooldown![i]).toBe(-Infinity)
    expect(Number.isNaN(c.n![i])).toBe(true)
  })
})

describe('non-finite SoA values on every binary path', () => {
  const Stat = defineComponent({ hp: 'f32', t: 'f64', dir: ['f32', 3] as ['f32', 3] })

  function source(): World {
    const w = createWorld()
    addComponent(w, createEntity(w), Stat, {
      hp: NaN,
      t: Infinity,
      dir: [1, -Infinity, NaN],
    })
    return w
  }

  function expectRestored(w: World): void {
    const { e, i } = only(w, Stat)
    const c = getComponent(w, e, Stat) as Record<string, Float32Array | Float64Array>
    expect(Number.isNaN(c.hp![i])).toBe(true)
    expect(c.t![i]).toBe(Infinity)
    const dir = Array.from(c.dir!.subarray(i * 3, i * 3 + 3))
    expect(dir[0]).toBe(1)
    expect(dir[1]).toBe(-Infinity)
    expect(Number.isNaN(dir[2])).toBe(true)
  }

  it('writes the three tokens only for SoA values (scalar and vector)', () => {
    const body = JSON.parse(bodyOf(serializeWorld(source())))
    expect(body.entities[0].components[0].data).toEqual({
      hp: 'NaN',
      t: 'Infinity',
      dir: [1, '-Infinity', 'NaN'],
    })
  })

  it('serializeWorld -> deserializeWorld restores scalar and vector fields', () => {
    expectRestored(deserializeWorld(serializeWorld(source())))
  })

  it('toJSON keeps plain numbers and fromJSON(toJSON(w)) is unchanged', () => {
    const w = source()
    const snap = toJSON(w)
    expect(snap.entities[0]!.components[0]!.data).toEqual({
      hp: NaN,
      t: Infinity,
      dir: [1, -Infinity, NaN],
    })
    expectRestored(fromJSON(snap))
  })

  it('worker transferableSnapshot -> adoptSnapshot / attachWorld', () => {
    const snap = transferableSnapshot(source())
    expectRestored(adoptSnapshot(snap))
    expectRestored(attachWorld(snap.buffer))
  })

  it('delta: a non-finite value survives capture -> apply', () => {
    const delta = createDeltaSerializer(source())
    const target = createWorld()
    delta.apply(target, delta.capture())
    expectRestored(target)
  })

  it('delta: NaN -> Infinity -> -Infinity is each seen as a change and applied', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Stat, { hp: NaN })
    const col = (getComponent(w, e, Stat) as Record<string, Float32Array>).hp!
    const delta = createDeltaSerializer(w)
    const target = createWorld()
    delta.apply(target, delta.capture())

    for (const v of [Infinity, -Infinity, NaN]) {
      col[getEntityIndex(e)] = v
      const bytes = delta.capture()
      expect(JSON.parse(bodyOf(bytes)).entities).toHaveLength(1)
      delta.apply(target, bytes)
      const t = only(target, Stat)
      expect((getComponent(target, t.e, Stat) as Record<string, Float32Array>).hp![t.i]).toBe(v)
    }
    // No change: an empty delta.
    expect(JSON.parse(bodyOf(delta.capture())).entities).toHaveLength(0)
  })

  it('AoS values are not encoded, even when shaped like a SoA entry', () => {
    const Bag = defineObjectComponent(() => ({}) as Record<string, unknown>)
    const w = createWorld()
    const value = { kind: 'soa', data: { v: Infinity }, x: NaN, s: 'NaN' }
    addComponent(w, createEntity(w), Bag, value)
    const bytes = serializeWorld(w)
    const aos = JSON.parse(bodyOf(bytes)).entities[0].components[0].data
    expect(aos).toEqual({ kind: 'soa', data: { v: null }, x: null, s: 'NaN' })
    const w2 = deserializeWorld(bytes)
    expect(getComponent(w2, only(w2, Bag).e, Bag)).toEqual(aos)
  })
})

describe('snapshots without non-finite SoA values keep their exact bytes', () => {
  // packBinary's layout over JSON.stringify of the toJSON object form, which
  // is what serializeWorld wrote before non-finite values were encoded.
  function legacyBytes(w: World): Uint8Array {
    const enc = new TextEncoder()
    const ver = enc.encode(VERSION)
    const json = enc.encode(JSON.stringify(toJSON(w)))
    const out = new Uint8Array(16 + ver.length + json.length)
    const view = new DataView(out.buffer)
    out.set(enc.encode('AIEC'))
    view.setUint32(4, 2, true)
    view.setUint32(8, ver.length, true)
    out.set(ver, 12)
    view.setUint32(12 + ver.length, json.length, true)
    out.set(json, 16 + ver.length)
    return out
  }

  it('serializeWorld and the first delta capture are byte-identical to the 0.6.0 form', () => {
    const Mixed = defineComponent({
      f: 'f32',
      d: 'f64',
      i: 'i32',
      u: 'u8',
      b: 'bool',
      v: ['f64', 2] as ['f64', 2],
    })
    const Bag = defineObjectComponent(() => ({ tags: [] as string[] }))
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Mixed, { f: 0.5, d: -0, i: -7, u: 255, b: true, v: [1e308, -2.5] })
    addComponent(w, e, Bag, { tags: ['Infinity'] })
    const ints = createEntity(w)
    // Integer columns cannot hold non-finite values: they store 0.
    addComponent(w, ints, Mixed, { i: Infinity, u: NaN })

    const expected = legacyBytes(w)
    expect(serializeWorld(w)).toEqual(expected)
    expect(createDeltaSerializer(w).capture()).toEqual(expected)
  })
})
