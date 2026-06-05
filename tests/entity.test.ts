import { describe, expect, it } from 'vitest'
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineQuery,
  destroyEntity,
  entityExists,
  exitQuery,
  forEachEntity,
  getComponent,
  getEntityGeneration,
  getEntityIndex,
  isEntity,
  packEntity,
  runQuery,
} from '../src/index.js'
import { refOf } from '../src/index.js'

describe('entity', () => {
  it('createEntity never returns 0', () => {
    const w = createWorld()
    for (let i = 0; i < 10; i++) {
      const e = createEntity(w)
      expect(e).toBeGreaterThan(0)
    }
  })

  it('entityExists tracks live status', () => {
    const w = createWorld()
    const e = createEntity(w)
    expect(entityExists(w, e)).toBe(true)
    destroyEntity(w, e)
    expect(entityExists(w, e)).toBe(false)
  })

  it('destroyEntity twice is a no-op', () => {
    const w = createWorld()
    const e = createEntity(w)
    destroyEntity(w, e)
    expect(() => destroyEntity(w, e)).not.toThrow()
  })

  it('recycles freed entities (slot reuse — same index, different generation)', () => {
    const w = createWorld()
    const a = createEntity(w)
    destroyEntity(w, a)
    const b = createEntity(w)
    // Same raw slot index, but different packed value (generation bumped)
    expect(getEntityIndex(b)).toBe(getEntityIndex(a))
    expect(entityExists(w, b)).toBe(true)
  })

  it('getEntityIndex / packEntity round-trip in 0.3', () => {
    expect(getEntityIndex(packEntity(42, 3))).toBe(42)
    expect(getEntityGeneration(packEntity(42, 3))).toBe(3)
    expect(getEntityIndex(packEntity(1, 0))).toBe(1)
    expect(getEntityGeneration(packEntity(1, 0))).toBe(0)
  })

  it('isEntity checks liveness, rejects 0', () => {
    const w = createWorld()
    const e = createEntity(w)
    expect(isEntity(w, e)).toBe(true)
    expect(isEntity(w, 0)).toBe(false)
    expect(isEntity(w, 'hello')).toBe(false)
  })

  it('allocates many entities up to capacity', () => {
    const w = createWorld({ initialCapacity: 8 })
    const ents: number[] = []
    for (let i = 0; i < 50; i++) ents.push(createEntity(w) as number)
    // After 50 entities, the world should have grown beyond 8
    expect(ents.length).toBe(50)
    expect(new Set(ents).size).toBe(50)
  })

  // Documents the v0.3 ABA protection: packed EntityId encodes generation.
  // After destroy + create on the same slot, the old EntityId has a different
  // packed value (stale generation) and is correctly reported as dead.
  it('ABA protection works: reused slot gets new packed EntityId', () => {
    const w = createWorld()
    const a = createEntity(w)
    const aIdx = getEntityIndex(a)
    destroyEntity(w, a)
    const b = createEntity(w)
    // Same slot index, but packed value differs (generation bumped)
    expect(getEntityIndex(b)).toBe(aIdx)
    expect(b).not.toBe(a) // packed values differ due to generation
    // Old packed eid is now stale — must report dead
    expect(entityExists(w, a)).toBe(false)
    // New entity is live
    expect(entityExists(w, b)).toBe(true)
  })

  // Regression: destroyEntity must fire the reactive exitQuery surface, not just
  // the component-targeted observe(q,'remove') path. Previously destroyEntity
  // cleared the mask wholesale without notifying recordEntityMaskChange, so
  // exitQuery buffers stayed empty on destroy (asymmetric with removeComponent).
  it('destroyEntity populates exitQuery buffer (reactive exit on destroy)', () => {
    const Position = defineComponent({ x: Types.f32 })
    const w = createWorld()
    const left = exitQuery(defineQuery([Position]))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1 })
    // Drain any enter/exit churn from the add so we isolate the destroy.
    runQuery(w, left)

    destroyEntity(w, e)

    const exited = runQuery(w, left)
    expect(exited).toContain(e)
    // Buffer drains on read.
    expect(runQuery(w, left).length).toBe(0)
  })

  // Regression (review): a query matching MULTIPLE of the destroyed entity's
  // components must record it EXACTLY ONCE. destroy replays removals one bit at
  // a time; a naive (prevMask, emptyMask)-per-bit dispatch double-counts (the
  // entity would appear once per matching component bit).
  it('destroyEntity exits a multi-component query exactly once', () => {
    const Position = defineComponent({ x: Types.f32 })
    const Velocity = defineComponent({ x: Types.f32 })
    const w = createWorld()
    const left = exitQuery(defineQuery([Position, Velocity]))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1 })
    addComponent(w, e, Velocity, { x: 2 })
    runQuery(w, left) // drain enter/exit churn from the adds

    destroyEntity(w, e)

    const exited = runQuery(w, left)
    expect(exited.filter((x) => x === e).length).toBe(1)
    expect(runQuery(w, left).length).toBe(0)
  })

  it('generationBits=0 degenerate mode: spawn/destroy still works', () => {
    const w = createWorld({ generationBits: 0 })
    const e = createEntity(w)
    expect(entityExists(w, e)).toBe(true)
    destroyEntity(w, e)
    expect(entityExists(w, e)).toBe(false)
  })

  it('generationBits=16 boundary: spawn/destroy works', () => {
    const w = createWorld({ indexBits: 16, generationBits: 16 })
    const e = createEntity(w)
    expect(entityExists(w, e)).toBe(true)
    destroyEntity(w, e)
    expect(entityExists(w, e)).toBe(false)
  })

  it('indexBits=10 small range: throws on 1025th entity', () => {
    const w = createWorld({ indexBits: 10, maxEntities: 1023 })
    for (let i = 0; i < 1023; i++) createEntity(w)
    expect(() => createEntity(w)).toThrow()
  })

  it('entityExists returns false for garbage numbers (large, negative, float)', () => {
    const w = createWorld()
    expect(entityExists(w, 999999999 as any)).toBe(false)
    expect(entityExists(w, -1 as any)).toBe(false)
    expect(entityExists(w, 1.5 as any)).toBe(false)
    expect(entityExists(w, 0 as any)).toBe(false)
  })

  // P0 regression: signed-overflow for generation >= 128
  // pre-fix: createEntity returned a negative eid; arch.entities (Uint32Array)
  // stored it unsigned; runQuery/forEachEntity returned the unsigned value which
  // did NOT match the negative eid stored in entityRow, so entityExists/refOf broke.
  it('query iteration and refOf agree for high-generation entities (gen >= 128)', () => {
    const Position = defineComponent({ x: Types.f32 })
    const w = createWorld()
    let e = createEntity(w)
    addComponent(w, e, Position, { x: 1 })
    for (let i = 0; i < 200; i++) {
      destroyEntity(w, e)
      e = createEntity(w)
      addComponent(w, e, Position, { x: 1 })
    }
    expect(getEntityGeneration(e)).toBeGreaterThanOrEqual(128)
    const q = defineQuery([Position])
    const ids = runQuery(w, q)
    expect(ids.length).toBe(1)
    expect(ids[0]).toBe(e) // pre-fix FAILS: unsigned readback ≠ negative e
    expect(entityExists(w, ids[0]!)).toBe(true) // pre-fix FAILS: entityRow keyed negative
    expect(() => refOf(w, ids[0]!)).not.toThrow() // pre-fix THROWS on live entity
    let seen: number | null = null
    forEachEntity(w, q, (eid) => {
      seen = eid as number
    })
    expect(seen).toBe(e)
  })

  // A1 regression (0.5.3): forEachEntity yields a PACKED EntityId, not a column
  // index. Doc examples historically wrote `pos.x[e]`, which is only correct
  // while generation 0 (e === getEntityIndex(e)). Once a slot is recycled the
  // packed id carries a non-zero generation in its high bits, so indexing a
  // column with the raw `e` reads an out-of-bounds slot (undefined/NaN), while
  // `getEntityIndex(e)` reads the correct slot. This test proves BOTH the bug
  // (raw `e` is wrong) and the fix (getEntityIndex(e) is right) after recycle.
  it('forEachEntity: index SoA columns with getEntityIndex(e), not the packed e (recycle regression)', () => {
    const Position = defineComponent({ x: Types.f32, y: Types.f32 })
    const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
    const w = createWorld()

    // Spawn a batch, then destroy them so their slots return to the free list
    // with a bumped generation. Re-spawning reuses those slots at generation >= 1.
    const firstWave: number[] = []
    for (let i = 0; i < 8; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: 0, y: 0 })
      addComponent(w, e, Velocity, { x: 1, y: 2 })
      firstWave.push(e as number)
    }
    for (const e of firstWave) destroyEntity(w, e as any)

    // Second wave reuses the recycled slots; assert the packed id now differs
    // from its index (generation bumped), so `e` and `getEntityIndex(e)` diverge.
    const secondWave: number[] = []
    for (let i = 0; i < 8; i++) {
      const e = createEntity(w)
      addComponent(w, e, Position, { x: 0, y: 0 })
      addComponent(w, e, Velocity, { x: 1, y: 2 })
      secondWave.push(e as number)
    }
    const recycled = secondWave.filter((e) => getEntityIndex(e as any) !== (e as any))
    expect(recycled.length).toBeGreaterThan(0) // at least one slot recycled with gen >= 1
    for (const e of recycled) {
      expect(getEntityGeneration(e as any)).toBeGreaterThanOrEqual(1)
    }

    // Run a movement-style loop indexing columns with getEntityIndex(e) (the fix).
    const movers = defineQuery([Position, Velocity])
    const dt = 0.5
    forEachEntity(w, movers, (e, pos: any, vel: any) => {
      const i = getEntityIndex(e)
      pos.x[i] += vel.x[i] * dt
      pos.y[i] += vel.y[i] * dt
    })

    // Correct read path: every live entity integrated by velocity * dt.
    for (const e of secondWave) {
      const i = getEntityIndex(e as any)
      const pos = getComponent(w, e as any, Position) as any
      expect(pos.x[i]).toBeCloseTo(0.5) // 1 * 0.5
      expect(pos.y[i]).toBeCloseTo(1.0) // 2 * 0.5
    }

    // Demonstrate the BUG: indexing the same column with the raw packed `e`
    // (for a recycled, gen>=1 entity) reads outside the written range. The
    // column is capacity-sized, so the high-bit-shifted index is out of bounds
    // → TypedArray returns undefined.
    const posStorage = getComponent(w, recycled[0] as any, Position) as any
    const packed = recycled[0] as number
    expect(packed).toBeGreaterThanOrEqual(posStorage.x.length) // packed id is past the column end
    expect(posStorage.x[packed]).toBeUndefined() // raw-`e` indexing → out of bounds
  })
})
