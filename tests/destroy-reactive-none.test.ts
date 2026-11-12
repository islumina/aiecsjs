import { describe, expect, it } from 'vitest'
import {
  addComponent,
  createEntity,
  createWorld,
  defineQuery,
  defineTag,
  destroyEntity,
  enterQuery,
  exitQuery,
  runQuery,
} from '../src/index.js'

describe('destroyEntity must not report an enter for a query the entity never matched', () => {
  it('{ all: [A], none: [B] } with an entity holding A and B', () => {
    const A = defineTag()
    const B = defineTag()
    const q = defineQuery({ all: [A], none: [B] })
    const en = enterQuery(q)
    const ex = exitQuery(q)
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, B) // B gets the lower bit in this world
    addComponent(w, e, A)
    expect(runQuery(w, q)).toEqual([])
    expect(runQuery(w, en)).toEqual([])
    expect(runQuery(w, ex)).toEqual([])
    destroyEntity(w, e)
    expect(runQuery(w, en)).toEqual([])
    expect(runQuery(w, ex)).toEqual([])
  })

  it('{ none: [B] } with an entity holding B gets no enter on destroy', () => {
    const B = defineTag()
    const q = defineQuery({ none: [B] })
    const en = enterQuery(q)
    const ex = exitQuery(q)
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, B)
    runQuery(w, en)
    runQuery(w, ex)
    destroyEntity(w, e)
    expect(runQuery(w, en)).toEqual([])
    expect(runQuery(w, ex)).toEqual([])
  })

  it('a query the entity matched on several components still gets exactly one exit', () => {
    const A = defineTag()
    const B = defineTag()
    const C = defineTag()
    const q = defineQuery({ all: [A, B], any: [C] })
    const en = enterQuery(q)
    const ex = exitQuery(q)
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, C)
    addComponent(w, e, B)
    addComponent(w, e, A)
    expect(runQuery(w, en)).toEqual([e])
    destroyEntity(w, e)
    expect(runQuery(w, en)).toEqual([])
    expect(runQuery(w, ex)).toEqual([e])
  })
})
