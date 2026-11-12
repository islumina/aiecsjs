import { describe, expect, it } from 'vitest'
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineQuery,
  enterQuery,
  exitQuery,
  forEachEntity,
  queryArchetypes,
  removeComponent,
  runQuery,
} from '../src/index.js'
import { getWorldState } from '../src/internal/world.js'

describe('column views follow the declaration order of the query that was passed', () => {
  it('defineQuery([B, A]) after defineQuery([A, B]) passes (b, a)', () => {
    const A = defineComponent({ a: 'f32' })
    const B = defineComponent({ b: 'f32' })
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, A, { a: 1 })
    addComponent(w, e, B, { b: 2 })

    const ab = defineQuery([A, B])
    const seenAB: string[][] = []
    forEachEntity(w, ab, (_e, a, b) => seenAB.push([Object.keys(a)[0]!, Object.keys(b)[0]!]))
    expect(seenAB).toEqual([['a', 'b']])

    const ba = defineQuery([B, A])
    const seenBA: string[][] = []
    forEachEntity(w, ba, (_e, b, a) => seenBA.push([Object.keys(b)[0]!, Object.keys(a)[0]!]))
    expect(seenBA).toEqual([['b', 'a']])
  })

  it('each order is cached, and orders share one id', () => {
    const A = defineComponent({ a: 'f32' })
    const B = defineComponent({ b: 'f32' })
    const ab = defineQuery([A, B])
    const ba = defineQuery([B, A])
    expect(defineQuery([A, B])).toBe(ab)
    expect(defineQuery([B, A])).toBe(ba)
    expect(ba.id).toBe(ab.id)
  })

  it('enter / exit views of a [B, A] query pass (b, a) after the [A, B] views exist', () => {
    const A = defineComponent({ a: 'f32' })
    const B = defineComponent({ b: 'f32' })
    const ab = defineQuery([A, B])
    const ba = defineQuery([B, A])
    const enAB = enterQuery(ab)
    const exAB = exitQuery(ab)
    const enBA = enterQuery(ba)
    const exBA = exitQuery(ba)
    const w = createWorld()
    const e = createEntity(w)
    const f = createEntity(w)
    for (const x of [e, f]) {
      addComponent(w, x, A, { a: 1 })
      addComponent(w, x, B, { b: 2 })
    }

    const keys = (u: object, v: object) => [Object.keys(u)[0]!, Object.keys(v)[0]!]
    const seen: unknown[][] = []
    forEachEntity(w, enBA, (x, b, a) => seen.push([x, ...keys(b, a)]))
    forEachEntity(w, enAB, (x, a, b) => seen.push([x, ...keys(a, b)]))
    expect(seen).toEqual([
      [e, 'b', 'a'],
      [f, 'b', 'a'],
    ])

    seen.length = 0
    removeComponent(w, e, A)
    forEachEntity(w, exBA, (x, b, a) => seen.push([x, ...keys(b, a)]))
    removeComponent(w, f, A)
    forEachEntity(w, exAB, (x, a, b) => seen.push([x, ...keys(a, b)]))
    expect(seen).toEqual([
      [e, 'b', 'a'],
      [f, 'a', 'b'],
    ])
  })

  it('every order of a reactive view shares one id and one buffer', () => {
    const A = defineComponent({ a: 'f32' })
    const B = defineComponent({ b: 'f32' })
    const ab = defineQuery([A, B])
    const ba = defineQuery([B, A])
    // The [A, B] variants are created first, so they are the indexed ones.
    const enAB = enterQuery(ab)
    const exAB = exitQuery(ab)
    expect(enterQuery(ba).id).toBe(enAB.id)
    expect(exitQuery(ba).id).toBe(exAB.id)
    expect(enterQuery(ba)).toBe(enterQuery(ba))
    const w = createWorld()
    const state = getWorldState(w)
    // queryArchetypes registers the [B, A] copy first; the indexed [A, B]
    // variant that later receives the events must count as registered
    // instead of replacing it.
    queryArchetypes(w, enterQuery(ba))
    const registered = state.queries[enterQuery(ab).id]
    expect(registered).toBe(enterQuery(ba))
    const e = createEntity(w)
    addComponent(w, e, A)
    addComponent(w, e, B)

    // An id delivered through one order is not delivered again through the
    // other, and no event is pushed twice into the shared buffer.
    expect(runQuery(w, enterQuery(ab))).toEqual([e])
    expect(runQuery(w, enterQuery(ba))).toEqual([])
    removeComponent(w, e, B)
    expect(runQuery(w, exitQuery(ba))).toEqual([e])
    expect(runQuery(w, exitQuery(ab))).toEqual([])
    expect(state.queries[enterQuery(ab).id]).toBe(registered)
  })

  it('alternating orders do not re-register the query and reset its archetype cache', () => {
    const A = defineComponent({ a: 'f32' })
    const B = defineComponent({ b: 'f32' })
    const ab = defineQuery([A, B])
    const ba = defineQuery([B, A])
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, A)
    addComponent(w, e, B)
    const state = getWorldState(w)

    expect(runQuery(w, ab)).toEqual([e])
    const cached = state.queryArchetypeCache[ab.id]
    expect(runQuery(w, ba)).toEqual([e])
    expect(runQuery(w, ab)).toEqual([e])
    expect(state.queryArchetypeCache[ab.id]).toBe(cached)
  })

  it('a reactive source registered under another order is not re-registered on every change', () => {
    const A = defineComponent({ a: 'f32' })
    const B = defineComponent({ b: 'f32' })
    const ab = defineQuery([A, B])
    const ba = defineQuery([B, A])
    const en = enterQuery(ab)
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, A)
    addComponent(w, e, B)
    expect(runQuery(w, en)).toEqual([e])
    const state = getWorldState(w)

    // Register the other order, fill the archetype cache, then make a mask
    // change on a component the reactive source references.
    expect(runQuery(w, ba)).toEqual([e])
    const cached = state.queryArchetypeCache[ab.id]
    expect(cached).not.toBeNull()
    const f = createEntity(w)
    addComponent(w, f, A)
    expect(state.queryArchetypeCache[ab.id]).toBe(cached)
    expect(runQuery(w, ba)).toEqual([e])
  })
})
