import { describe, expect, it } from 'vitest'
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineObjectComponent,
  defineQuery,
  enterQuery,
  exitQuery,
  getComponent,
  getEntityIndex,
  hasComponent,
  removeComponent,
  runQuery,
} from '../src/index.js'
import { observe } from '../src/observers.js'

describe('a query remove observer that re-adds the component', () => {
  it('SoA: the re-added value survives the outer removeComponent', () => {
    const Hp = defineComponent({ v: 'f32' })
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Hp, { v: 10 })
    const q = defineQuery([Hp])
    let n = 0
    observe(w, q, 'remove', (eid) => {
      if (n++ === 0) addComponent(w, eid, Hp, { v: 5 })
    })
    removeComponent(w, e, Hp)
    expect(hasComponent(w, e, Hp)).toBe(true)
    const col = getComponent(w, e, Hp) as { v: Float32Array }
    expect(col.v[getEntityIndex(e)]).toBe(5)
  })

  it('AoS: the re-added instance survives the outer removeComponent', () => {
    const Bag = defineObjectComponent(() => ({ items: [] as number[] }))
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Bag)
    const q = defineQuery([Bag])
    let n = 0
    observe(w, q, 'remove', (eid) => {
      if (n++ === 0) addComponent(w, eid, Bag, { items: [1] })
    })
    removeComponent(w, e, Bag)
    expect(hasComponent(w, e, Bag)).toBe(true)
    expect(getComponent(w, e, Bag)).toEqual({ items: [1] })
  })

  it('reactive buffers end consistent with the final state (entity matches)', () => {
    const T = defineComponent({ v: 'f32' })
    const w = createWorld()
    const e = createEntity(w)
    const q = defineQuery([T])
    const en = enterQuery(q)
    const ex = exitQuery(q)
    addComponent(w, e, T, { v: 1 })
    runQuery(w, en)
    runQuery(w, ex)
    let n = 0
    observe(w, q, 'remove', (eid) => {
      if (n++ === 0) addComponent(w, eid, T, { v: 2 })
    })
    removeComponent(w, e, T)
    expect(runQuery(w, q)).toEqual([e])
    expect([runQuery(w, ex).length, runQuery(w, en).length]).toEqual([1, 1])
  })
})
