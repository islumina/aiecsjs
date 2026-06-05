import { describe, expect, it } from 'vitest'
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineQuery,
  defineTag,
  destroyEntity,
  enterQuery,
  exitQuery,
  forEachEntity,
  forEachEntityIndexed,
  getComponent,
  getEntityGeneration,
  getEntityIndex,
  hasComponent,
  iterQuery,
  queryArchetypes,
  removeComponent,
  runQuery,
  setComponent,
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
      const pos = w as any
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

describe('forEachEntityIndexed', () => {
  const DEFAULT_INDEX_MASK = 0xffffff // default indexBits=24

  // A1 invariant (0.5.3): forEachEntityIndexed yields the masked column index `i`
  // alongside the packed EntityId, so `pos.x[i]` is correct WITH NO manual masking
  // even after a slot is recycled (gen >= 1) — the exact scenario where `pos.x[e]`
  // would corrupt by reading an out-of-bounds slot. Mirrors the forEachEntity
  // recycle regression in tests/entity.test.ts but proves the indexed helper makes
  // the safe path the default.
  it('recycle-correctness: i === getEntityIndex(e) and pos.x[i] hits the right slot after recycle', () => {
    const w = createWorld()

    // Spawn a batch, destroy them so their slots return to the free list with a
    // bumped generation, then re-spawn so those slots are reused at gen >= 1.
    const firstWave: number[] = []
    for (let i = 0; i < 8; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: 0, y: 0 })
      addComponent(w, e, Velocity, { x: 1, y: 2 })
      firstWave.push(e as number)
    }
    for (const e of firstWave) destroyEntity(w, e as any)

    const secondWave: number[] = []
    for (let i = 0; i < 8; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: 0, y: 0 })
      addComponent(w, e, Velocity, { x: 1, y: 2 })
      secondWave.push(e as number)
    }
    // At least one slot recycled with gen >= 1 → packed id diverges from its index.
    const recycled = secondWave.filter((e) => getEntityIndex(e as any) !== (e as any))
    expect(recycled.length).toBeGreaterThan(0)
    for (const e of recycled) {
      expect(getEntityGeneration(e as any)).toBeGreaterThanOrEqual(1)
    }

    // Movement-style loop indexing columns with the yielded `i` — NO manual masking.
    const movers = defineQuery([Position, Velocity])
    const dt = 0.5
    forEachEntityIndexed(w, movers, (e, i, pos: any, vel: any) => {
      // The whole point: `i` is the safe subscript and equals getEntityIndex(e).
      expect(i).toBe(getEntityIndex(e))
      pos.x[i] += vel.x[i] * dt
      pos.y[i] += vel.y[i] * dt
    })

    // Every live entity was integrated correctly, read back via the masked index.
    for (const e of secondWave) {
      const i = getEntityIndex(e as any)
      const pos = getComponent(w, e as any, Position) as any
      expect(pos.x[i]).toBeCloseTo(0.5) // 1 * 0.5
      expect(pos.y[i]).toBeCloseTo(1.0) // 2 * 0.5
    }

    // And confirm the masked index is in-bounds for the column (unlike the packed
    // id for a recycled entity, which the forEachEntity regression proves is past
    // the column end).
    const posStorage = getComponent(w, recycled[0] as any, Position) as any
    const recycledIndex = getEntityIndex(recycled[0] as any)
    expect(recycledIndex).toBeLessThan(posStorage.x.length)
    expect((recycled[0] as number) >= posStorage.x.length).toBe(true)
  })

  it('parity: i-sequence equals iterQuery indices and e-sequence equals forEachEntity', () => {
    const w = createWorld()
    for (let i = 0; i < 6; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: i, y: i })
      addComponent(w, e, Velocity, { x: i, y: i })
    }
    const q = defineQuery([Position, Velocity])

    const indexedEs: number[] = []
    const indexedIs: number[] = []
    forEachEntityIndexed(w, q, (e, i) => {
      indexedEs.push(e as number)
      indexedIs.push(i)
    })

    // Same entity order as forEachEntity.
    const plainEs: number[] = []
    forEachEntity(w, q, (e) => {
      plainEs.push(e as number)
    })
    expect(indexedEs).toEqual(plainEs)

    // i-sequence equals the masked iterQuery order.
    const expectedIs = [...iterQuery(w, q)].map((e) => (e as number) & DEFAULT_INDEX_MASK)
    expect(indexedIs).toEqual(expectedIs)
    // And each yielded i is exactly e & mask.
    for (let k = 0; k < indexedEs.length; k++) {
      expect(indexedIs[k]).toBe(indexedEs[k]! & DEFAULT_INDEX_MASK)
    }
  })

  it('reactive: enterQuery yields correct indices and drains the buffer', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    const entering = enterQuery(q)
    // Register q with this world first so bitToQueries is populated.
    runQuery(w, q)
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })

    const seen: Array<[number, number]> = []
    forEachEntityIndexed(w, entering, (eid, i) => {
      seen.push([eid as number, i])
    })
    expect(seen.length).toBe(1)
    expect(seen[0]![0]).toBe(e as number)
    expect(seen[0]![1]).toBe(getEntityIndex(e as any))

    // Second call — buffer is drained.
    const seen2: number[] = []
    forEachEntityIndexed(w, entering, (eid) => seen2.push(eid as number))
    expect(seen2.length).toBe(0)
  })

  it('reactive: exitQuery yields correct indices and drains the buffer', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    const leaving = exitQuery(q)
    runQuery(w, q)
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    removeComponent(w, e, Position)

    const seen: Array<[number, number]> = []
    forEachEntityIndexed(w, leaving, (eid, i) => {
      seen.push([eid as number, i])
    })
    expect(seen.length).toBe(1)
    expect(seen[0]![0]).toBe(e as number)
    expect(seen[0]![1]).toBe(getEntityIndex(e as any))

    // Buffer drained on second pass.
    const seen2: number[] = []
    forEachEntityIndexed(w, leaving, (eid) => seen2.push(eid as number))
    expect(seen2.length).toBe(0)
  })

  it('reactive: returns early with no buffer / empty buffer', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    const entering = enterQuery(q)
    // No buffer exists for this world yet → early return, no throw.
    let calls = 0
    forEachEntityIndexed(w, entering, () => {
      calls++
    })
    expect(calls).toBe(0)
  })

  // Arity coverage: exercise 0,1,2,3,4,5 and >=6 columns so every
  // callWithColsIndexed branch (cases 0-5 + spread default) runs.
  describe('arity coverage (callWithColsIndexed branches)', () => {
    const A1c = defineComponent({ a: Types.f32 })
    const A2c = defineComponent({ b: Types.f32 })
    const A3c = defineComponent({ c: Types.f32 })
    const A4c = defineComponent({ d: Types.f32 })
    const A5c = defineComponent({ e: Types.f32 })
    const A6c = defineComponent({ f: Types.f32 })

    it('0-column query calls fn with (e, i) only', () => {
      const w = createWorld()
      const q = defineQuery({ all: [], any: [] })
      const e = createEntity(w)
      let seenE = -1
      let seenI = -1
      let colCount = -1
      forEachEntityIndexed(w, q, (eid, i, ...cols) => {
        seenE = eid as number
        seenI = i
        colCount = cols.length
      })
      expect(seenE).toBe(e as number)
      expect(seenI).toBe(getEntityIndex(e as any))
      expect(colCount).toBe(0)
    })

    it('1-column query', () => {
      const w = createWorld()
      const q = defineQuery([A1c])
      const e = createEntity(w)
      addComponent(w, e, A1c, { a: 7 })
      let colCount = -1
      let val = -1
      forEachEntityIndexed(w, q, (_e, i, a: any) => {
        colCount = 1
        val = a.a[i]
      })
      expect(colCount).toBe(1)
      expect(val).toBe(7)
    })

    it('2-column query', () => {
      const w = createWorld()
      const q = defineQuery([A1c, A2c])
      const e = createEntity(w)
      addComponent(w, e, A1c, { a: 1 })
      addComponent(w, e, A2c, { b: 2 })
      let colCount = -1
      forEachEntityIndexed(w, q, (_e, _i, a, b) => {
        colCount = [a, b].length
      })
      expect(colCount).toBe(2)
    })

    it('3-column query', () => {
      const w = createWorld()
      const q = defineQuery([A1c, A2c, A3c])
      const e = createEntity(w)
      addComponent(w, e, A1c)
      addComponent(w, e, A2c)
      addComponent(w, e, A3c)
      let colCount = -1
      forEachEntityIndexed(w, q, (_e, _i, a, b, c) => {
        colCount = [a, b, c].length
      })
      expect(colCount).toBe(3)
    })

    it('4-column query', () => {
      const w = createWorld()
      const q = defineQuery([A1c, A2c, A3c, A4c])
      const e = createEntity(w)
      addComponent(w, e, A1c)
      addComponent(w, e, A2c)
      addComponent(w, e, A3c)
      addComponent(w, e, A4c)
      let colCount = -1
      forEachEntityIndexed(w, q, (_e, _i, a, b, c, d) => {
        colCount = [a, b, c, d].length
      })
      expect(colCount).toBe(4)
    })

    it('5-column query', () => {
      const w = createWorld()
      const q = defineQuery([A1c, A2c, A3c, A4c, A5c])
      const e = createEntity(w)
      addComponent(w, e, A1c)
      addComponent(w, e, A2c)
      addComponent(w, e, A3c)
      addComponent(w, e, A4c)
      addComponent(w, e, A5c)
      let colCount = -1
      forEachEntityIndexed(w, q, (_e, _i, a, b, c, d, f) => {
        colCount = [a, b, c, d, f].length
      })
      expect(colCount).toBe(5)
    })

    it('6+-column query (spread default branch)', () => {
      const w = createWorld()
      const q = defineQuery([A1c, A2c, A3c, A4c, A5c, A6c])
      const e = createEntity(w)
      addComponent(w, e, A1c)
      addComponent(w, e, A2c)
      addComponent(w, e, A3c)
      addComponent(w, e, A4c)
      addComponent(w, e, A5c)
      addComponent(w, e, A6c)
      let colCount = -1
      let seenI = -1
      forEachEntityIndexed(w, q, (eid, i, ...cols) => {
        colCount = cols.length
        seenI = i
        expect(i).toBe(getEntityIndex(eid))
      })
      expect(colCount).toBe(6)
      expect(seenI).toBe(getEntityIndex(e as any))
    })
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
  return entities.filter((e) => {
    if (spec.all) {
      for (const c of spec.all) if (!hasComponent(w, e as any, c)) return false
    }
    if (spec.any && spec.any.length > 0) {
      let hit = false
      for (const c of spec.any)
        if (hasComponent(w, e as any, c)) {
          hit = true
          break
        }
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
    const expected = naiveFilter(w, ents, { all: [Position], any: [Velocity, Health] }).sort(
      (a, b) => a - b,
    )
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
