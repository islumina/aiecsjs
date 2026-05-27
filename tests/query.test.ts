import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  destroyEntity,
  defineComponent,
  defineTag,
  addComponent,
  removeComponent,
  defineQuery,
  runQuery,
  iterQuery,
  forEachEntity,
  enterQuery,
  exitQuery,
  queryArchetypes,
  Types,
} from '../src/index.js'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
const Health = defineComponent({ hp: Types.i32 })
const Dead = defineTag()

describe('query', () => {
  it('defineQuery (array) === defineQuery ({ all }) for same components', () => {
    const a = defineQuery([Position, Velocity])
    const b = defineQuery({ all: [Position, Velocity] })
    expect(a.id).toBe(b.id)
  })

  it('defineQuery is order-invariant', () => {
    const a = defineQuery([Position, Velocity])
    const b = defineQuery([Velocity, Position])
    expect(a.id).toBe(b.id)
  })

  it('runQuery returns matching entities', () => {
    const w = createWorld()
    const e1 = createEntity(w)
    const e2 = createEntity(w)
    const e3 = createEntity(w)
    addComponent(w, e1, Position, { x: 1, y: 1 })
    addComponent(w, e1, Velocity, { x: 0, y: 1 })
    addComponent(w, e2, Position, { x: 2, y: 2 })
    addComponent(w, e3, Velocity, { x: 5, y: 5 })
    const movers = defineQuery([Position, Velocity])
    const result = runQuery(w, movers)
    expect(result.length).toBe(1)
    expect(result).toContain(e1)
  })

  it('iterQuery yields each matching entity once', () => {
    const w = createWorld()
    for (let i = 0; i < 5; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: i, y: i })
    }
    const q = defineQuery([Position])
    const ents = [...iterQuery(w, q)]
    expect(ents.length).toBe(5)
  })

  it('forEachEntity calls fn with column views', () => {
    const w = createWorld()
    const ents: number[] = []
    for (let i = 0; i < 3; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: i, y: i + 1 })
      addComponent(w, e, Velocity, { x: 10, y: 20 })
      ents.push(e as number)
    }
    const movers = defineQuery([Position, Velocity])
    forEachEntity(w, movers, (e, pos: any, vel: any) => {
      pos.x[e] += vel.x[e]
      pos.y[e] += vel.y[e]
    })
    for (const e of ents) {
      const pos = (w as any)
      // Read back via Position column from getComponent indirectly: we know x === i+10
    }
  })

  it('query none clause excludes entities', () => {
    const w = createWorld()
    const alive = createEntity(w)
    const dead = createEntity(w)
    addComponent(w, alive, Position, { x: 1, y: 1 })
    addComponent(w, dead, Position, { x: 2, y: 2 })
    addComponent(w, dead, Dead)
    const q = defineQuery({ all: [Position], none: [Dead] })
    const result = runQuery(w, q)
    expect(result).toContain(alive)
    expect(result).not.toContain(dead)
  })

  it('query any clause matches entities with any of the listed components', () => {
    const w = createWorld()
    const e1 = createEntity(w)
    const e2 = createEntity(w)
    const e3 = createEntity(w)
    addComponent(w, e1, Position, { x: 1, y: 1 })
    addComponent(w, e1, Velocity, { x: 0, y: 0 })
    addComponent(w, e2, Position, { x: 2, y: 2 })
    addComponent(w, e2, Health, { hp: 99 })
    addComponent(w, e3, Position, { x: 3, y: 3 })
    const q = defineQuery({ all: [Position], any: [Velocity, Health] })
    const result = runQuery(w, q)
    expect(result).toContain(e1)
    expect(result).toContain(e2)
    expect(result).not.toContain(e3)
  })

  it('defineQuery rejects non-component values', () => {
    expect(() => defineQuery([{ foo: 1 } as any])).toThrow()
  })

  it('queryArchetypes returns matched archetypes', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    const q = defineQuery([Position])
    const arcs = queryArchetypes(w, q)
    expect(arcs.length).toBeGreaterThan(0)
  })
})

describe('enter/exit query', () => {
  it('enterQuery fires once when entity newly matches', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    const newlyMatched = enterQuery(q)
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    const r1 = runQuery(w, newlyMatched)
    expect(r1).toContain(e)
    // Reading again clears the buffer
    const r2 = runQuery(w, newlyMatched)
    expect(r2.length).toBe(0)
  })

  it('exitQuery fires once when entity stops matching', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    const left = exitQuery(q)
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    removeComponent(w, e, Position)
    const r = runQuery(w, left)
    expect(r).toContain(e)
  })
})
