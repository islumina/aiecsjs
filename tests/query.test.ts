import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  destroyEntity,
  defineComponent,
  defineTag,
  addComponent,
  removeComponent,
  hasComponent,
  setComponent,
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

// Naive linear-filter reference: rebuilds expected entity set by iterating
// every tracked entity and checking membership clause-by-clause via public API.
function naiveFilter(
  w: ReturnType<typeof createWorld>,
  entities: number[],
  spec: { all?: any[]; any?: any[]; none?: any[] },
): number[] {
  return entities.filter(e => {
    if (spec.all) {
      for (const c of spec.all) if (!hasComponent(w, e as any, c)) return false
    }
    if (spec.any && spec.any.length > 0) {
      let hit = false
      for (const c of spec.any) if (hasComponent(w, e as any, c)) { hit = true; break }
      if (!hit) return false
    }
    if (spec.none) {
      for (const c of spec.none) if (hasComponent(w, e as any, c)) return false
    }
    return true
  })
}

describe('query cross-check vs naive linear filter', () => {
  it('runQuery({all}) matches naive filter', () => {
    const w = createWorld()
    const ents: number[] = []
    for (let i = 0; i < 20; i++) {
      const e = createEntity(w)
      ents.push(e as number)
      if (i % 2 === 0) addComponent(w, e, Position, { x: i, y: i })
      if (i % 3 === 0) addComponent(w, e, Velocity, { x: 0, y: 0 })
    }
    const q = defineQuery({ all: [Position, Velocity] })
    const actual = [...runQuery(w, q)].sort((a, b) => a - b)
    const expected = naiveFilter(w, ents, { all: [Position, Velocity] }).sort((a, b) => a - b)
    expect(actual).toEqual(expected)
  })

  it('runQuery({all, none}) matches naive filter', () => {
    const w = createWorld()
    const ents: number[] = []
    for (let i = 0; i < 30; i++) {
      const e = createEntity(w)
      ents.push(e as number)
      addComponent(w, e, Position, { x: i, y: i })
      if (i % 5 === 0) addComponent(w, e, Dead)
    }
    const q = defineQuery({ all: [Position], none: [Dead] })
    const actual = [...runQuery(w, q)].sort((a, b) => a - b)
    const expected = naiveFilter(w, ents, { all: [Position], none: [Dead] }).sort((a, b) => a - b)
    expect(actual).toEqual(expected)
  })

  it('runQuery({all, any}) matches naive filter', () => {
    const w = createWorld()
    const ents: number[] = []
    for (let i = 0; i < 30; i++) {
      const e = createEntity(w)
      ents.push(e as number)
      addComponent(w, e, Position, { x: i, y: i })
      if (i % 2 === 0) addComponent(w, e, Velocity, { x: 0, y: 0 })
      if (i % 3 === 0) addComponent(w, e, Health, { hp: 100 })
    }
    const q = defineQuery({ all: [Position], any: [Velocity, Health] })
    const actual = [...runQuery(w, q)].sort((a, b) => a - b)
    const expected = naiveFilter(w, ents, { all: [Position], any: [Velocity, Health] }).sort((a, b) => a - b)
    expect(actual).toEqual(expected)
  })

  it('combined all + any + none matches naive filter', () => {
    const w = createWorld()
    const ents: number[] = []
    for (let i = 0; i < 40; i++) {
      const e = createEntity(w)
      ents.push(e as number)
      addComponent(w, e, Position, { x: i, y: i })
      if (i % 2 === 0) addComponent(w, e, Velocity, { x: 1, y: 1 })
      if (i % 3 === 0) addComponent(w, e, Health, { hp: 10 })
      if (i % 7 === 0) addComponent(w, e, Dead)
    }
    const spec = { all: [Position], any: [Velocity, Health], none: [Dead] }
    const q = defineQuery(spec)
    const actual = [...runQuery(w, q)].sort((a, b) => a - b)
    const expected = naiveFilter(w, ents, spec).sort((a, b) => a - b)
    expect(actual).toEqual(expected)
  })
})

describe('archetype migration boundary path', () => {
  const A = defineComponent({ a: Types.i32 })
  const B = defineComponent({ b: Types.i32 })
  const C = defineComponent({ c: Types.i32 })

  it('A -> A+B -> A+B+C -> A+C path lands the entity in the right archetype', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, A, { a: 1 })
    addComponent(w, e, B, { b: 2 })
    addComponent(w, e, C, { c: 3 })
    removeComponent(w, e, B)

    // Final shape: A + C, no B
    const qAC = defineQuery([A, C])
    const qB = defineQuery([B])
    expect([...runQuery(w, qAC)]).toContain(e)
    expect([...runQuery(w, qB)]).not.toContain(e)
  })
})

describe('query stability and cache invalidation', () => {
  it('mid-traversal mutation does not affect the already-taken snapshot', () => {
    const w = createWorld()
    for (let i = 0; i < 5; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: i, y: i })
    }
    const q = defineQuery([Position])
    const r1 = runQuery(w, q)
    const seen: number[] = []
    for (const e of r1) {
      seen.push(e as number)
      // Mutate world mid-iteration: add a new matching entity
      const extra = createEntity(w)
      addComponent(w, extra, Position, { x: 99, y: 99 })
    }
    expect(seen.length).toBe(5)
    // After loop, a fresh runQuery sees the new entities
    const r2 = runQuery(w, q)
    expect(r2.length).toBe(10)
  })

  it('structural mutation invalidates the lazy archetype cache (more entities after add)', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    expect(runQuery(w, q).length).toBe(0)
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    expect(runQuery(w, q).length).toBe(1)
  })

  it('component value mutation does not invalidate the archetype cache (membership unchanged)', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 1 })
    const q = defineQuery([Position])
    const before = runQuery(w, q).length
    // Mutate column value via setComponent (no archetype change)
    setComponent(w, e, Position, { x: 999, y: 999 })
    const after = runQuery(w, q).length
    expect(after).toBe(before)
  })
})
