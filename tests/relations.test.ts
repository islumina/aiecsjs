import { describe, expect, it } from 'vitest'
import {
  type EntityId,
  createEntity,
  createWorld,
  destroyEntity,
  entityExists,
  getEntityGeneration,
} from '../src/index.js'
import {
  ChildOf,
  addRelation,
  defineRelation,
  getRelationData,
  getRelationTargets,
  removeRelation,
} from '../src/relations.js'

describe('relations', () => {
  it('defineRelation returns a handle', () => {
    const Likes = defineRelation()
    expect(Likes.__kind).toBe('relation')
    expect(typeof Likes.__id).toBe('number')
  })

  it('addRelation / getRelationTargets for non-exclusive', () => {
    const Likes = defineRelation()
    const w = createWorld()
    const alice = createEntity(w)
    const bob = createEntity(w)
    const carol = createEntity(w)
    addRelation(w, alice, Likes, bob)
    addRelation(w, alice, Likes, carol)
    const targets = getRelationTargets(w, alice, Likes)
    expect(targets).toContain(bob)
    expect(targets).toContain(carol)
  })

  it('removeRelation removes a single edge', () => {
    const Likes = defineRelation()
    const w = createWorld()
    const alice = createEntity(w)
    const bob = createEntity(w)
    const carol = createEntity(w)
    addRelation(w, alice, Likes, bob)
    addRelation(w, alice, Likes, carol)
    removeRelation(w, alice, Likes, bob)
    const targets = getRelationTargets(w, alice, Likes)
    expect(targets).not.toContain(bob)
    expect(targets).toContain(carol)
  })

  it('exclusive relation replaces target', () => {
    const w = createWorld()
    const alice = createEntity(w)
    const dad = createEntity(w)
    const mom = createEntity(w)
    addRelation(w, alice, ChildOf, dad)
    expect(getRelationTargets(w, alice, ChildOf)).toEqual([dad])
    addRelation(w, alice, ChildOf, mom)
    expect(getRelationTargets(w, alice, ChildOf)).toEqual([mom])
  })

  it('getRelationData returns the payload passed to addRelation (non-exclusive)', () => {
    const Likes = defineRelation<{ since: number }>()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    addRelation(w, a, Likes, b, { since: 2024 })
    expect(getRelationData(w, a, Likes, b)).toEqual({ since: 2024 })
  })

  it('getRelationData returns undefined for an edge with no data', () => {
    const Likes = defineRelation<{ since: number }>()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    addRelation(w, a, Likes, b) // no data argument
    expect(getRelationData(w, a, Likes, b)).toBeUndefined()
  })

  it('getRelationData returns undefined for a non-existent edge', () => {
    const Likes = defineRelation<{ since: number }>()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    expect(getRelationData(w, a, Likes, b)).toBeUndefined()
  })

  it('getRelationData returns undefined after removeRelation', () => {
    const Likes = defineRelation<{ since: number }>()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    addRelation(w, a, Likes, b, { since: 2024 })
    expect(getRelationData(w, a, Likes, b)).toEqual({ since: 2024 })
    removeRelation(w, a, Likes, b)
    expect(getRelationData(w, a, Likes, b)).toBeUndefined()
  })

  it('getRelationData works for exclusive relations (data round-trip)', () => {
    const Owns = defineRelation<{ qty: number }>({ exclusive: true })
    const w = createWorld()
    const owner = createEntity(w)
    const item = createEntity(w)
    addRelation(w, owner, Owns, item, { qty: 3 })
    expect(getRelationData(w, owner, Owns, item)).toEqual({ qty: 3 })
  })

  it('getRelationData returns undefined for a relation whose storage was never created', () => {
    const Unrelated = defineRelation<{ x: number }>()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    // addRelation never called for this world — storage Map entry doesn't exist
    expect(getRelationData(w, a, Unrelated, b)).toBeUndefined()
  })

  it('getRelationData drops stale data when an exclusive relation is redirected', () => {
    const Equipped = defineRelation<{ slot: string }>({ exclusive: true })
    const w = createWorld()
    const hero = createEntity(w)
    const sword = createEntity(w)
    const shield = createEntity(w)
    addRelation(w, hero, Equipped, sword, { slot: 'main' })
    expect(getRelationData(w, hero, Equipped, sword)).toEqual({ slot: 'main' })
    // Redirect the exclusive relation to a different target.
    addRelation(w, hero, Equipped, shield, { slot: 'off' })
    // Topology reports only the new target...
    expect(getRelationTargets(w, hero, Equipped)).toEqual([shield])
    // ...and the data view agrees: new target has data, old target is cleared.
    expect(getRelationData(w, hero, Equipped, shield)).toEqual({ slot: 'off' })
    expect(getRelationData(w, hero, Equipped, sword)).toBeUndefined()
  })

  it('destroyEntity cleans up relations involving the entity', () => {
    const Likes = defineRelation()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    addRelation(w, a, Likes, b)
    destroyEntity(w, b)
    const targets = getRelationTargets(w, a, Likes)
    expect(targets).not.toContain(b)
  })

  it('ChildOf is a relation', () => {
    expect(ChildOf.__kind).toBe('relation')
    expect(ChildOf.__exclusive).toBe(true)
  })

  it('destroyEntity on the source side cleans up its outgoing edges', () => {
    const Likes = defineRelation()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    const c = createEntity(w)
    addRelation(w, a, Likes, b)
    addRelation(w, a, Likes, c)
    destroyEntity(w, a)
    // After source is destroyed, querying its targets returns nothing
    expect(getRelationTargets(w, a, Likes)).toEqual([])
  })

  it('exclusive relation resizes its storage when source index exceeds initial capacity', () => {
    const w = createWorld({ initialCapacity: 4 })
    // Force the world to grow past initialCapacity then use ChildOf on a high-index entity
    const parents: number[] = []
    for (let i = 0; i < 12; i++) parents.push(createEntity(w) as number)
    const target = createEntity(w)
    // The ChildOf storage's exclusive Int32Array is sized to initial capacity; this
    // exercises the resize branch in addRelation.
    addRelation(w, parents[parents.length - 1] as any, ChildOf, target)
    expect(getRelationTargets(w, parents[parents.length - 1] as any, ChildOf)).toEqual([target])
  })

  // Regression for F1: relation data Map previously keyed `src * capacity + tgt`,
  // which silently aliased entries once the world capacity grew. The cleanup hook
  // also depended on that arithmetic. Nested Map<src, Map<tgt, data>> removes the
  // dependency on `state.capacity` entirely. There is no public retrieve API in
  // 0.1, so this asserts the observable cleanup side: destroying entities after
  // a grow must still wipe all relation edges involving them.
  // Regression [P1-B]: getRelationTargets returned raw idx (= packed id with gen=0).
  // For a target that has been recycled (gen>0), the returned id failed entityExists
  // and getEntityGeneration checks. Fix: re-pack with current generation via packEid.
  it('getRelationTargets returns correct packed id after target slot is recycled (non-exclusive)', () => {
    const Follows = defineRelation()
    const w = createWorld()
    const src = createEntity(w)
    let target = createEntity(w)
    // Recycle the target slot 3 times so gen>0
    for (let i = 0; i < 3; i++) {
      destroyEntity(w, target)
      target = createEntity(w)
    }
    const expectedGen = getEntityGeneration(target)
    expect(expectedGen).toBeGreaterThan(0)

    addRelation(w, src, Follows, target)
    const targets = getRelationTargets(w, src, Follows)
    expect(targets).toHaveLength(1)
    const returned = targets[0]!
    expect(entityExists(w, returned)).toBe(true)
    expect(getEntityGeneration(returned)).toBe(expectedGen)
  })

  it('getRelationTargets returns correct packed id after target slot is recycled (exclusive)', () => {
    const w = createWorld()
    const src = createEntity(w)
    let target = createEntity(w)
    for (let i = 0; i < 3; i++) {
      destroyEntity(w, target)
      target = createEntity(w)
    }
    const expectedGen = getEntityGeneration(target)
    expect(expectedGen).toBeGreaterThan(0)

    addRelation(w, src, ChildOf, target)
    const targets = getRelationTargets(w, src, ChildOf)
    expect(targets).toHaveLength(1)
    const returned = targets[0]!
    expect(entityExists(w, returned)).toBe(true)
    expect(getEntityGeneration(returned)).toBe(expectedGen)
  })

  // --- Exclusive-relation destroy cleanup (Finding 1: bounded incoming cleanup) ---
  // These pin the OBSERVABLE behaviour of destroying an entity that is the TARGET
  // of one or more exclusive edges. The cleanup must clear every source that
  // pointed at the destroyed target, leave unrelated edges intact, and stay correct
  // across exclusive redirects and capacity growth. They are behaviour-preserving:
  // they pass against the full-capacity-scan implementation and the reverse-index
  // optimisation alike (the optimisation only changes *how much* is scanned).

  it('destroying an exclusive target clears the single source pointing at it', () => {
    const w = createWorld()
    const child = createEntity(w)
    const parent = createEntity(w)
    addRelation(w, child, ChildOf, parent)
    expect(getRelationTargets(w, child, ChildOf)).toEqual([parent])

    destroyEntity(w, parent)
    // The source's exclusive slot must be cleared now that its target is gone.
    expect(getRelationTargets(w, child, ChildOf)).toEqual([])
  })

  it('destroying an exclusive target clears ALL sources pointing at it', () => {
    const w = createWorld()
    const parent = createEntity(w)
    const sources: EntityId[] = []
    for (let i = 0; i < 8; i++) {
      const s = createEntity(w)
      addRelation(w, s, ChildOf, parent)
      sources.push(s)
    }
    // Every source resolves to the shared parent.
    for (const s of sources) {
      expect(getRelationTargets(w, s, ChildOf)).toEqual([parent])
    }

    destroyEntity(w, parent)
    // Destroying the shared target must clear every incoming source.
    for (const s of sources) {
      expect(getRelationTargets(w, s, ChildOf)).toEqual([])
    }
  })

  it('destroying an exclusive target leaves edges aimed at OTHER targets intact', () => {
    const w = createWorld()
    const parentA = createEntity(w)
    const parentB = createEntity(w)
    const childA = createEntity(w)
    const childB = createEntity(w)
    addRelation(w, childA, ChildOf, parentA)
    addRelation(w, childB, ChildOf, parentB)

    destroyEntity(w, parentA)
    // Only childA's edge drops; childB → parentB is untouched.
    expect(getRelationTargets(w, childA, ChildOf)).toEqual([])
    expect(getRelationTargets(w, childB, ChildOf)).toEqual([parentB])
  })

  it('exclusive redirect updates incoming bookkeeping: destroying the OLD target is a no-op', () => {
    const w = createWorld()
    const hero = createEntity(w)
    const sword = createEntity(w)
    const shield = createEntity(w)
    addRelation(w, hero, ChildOf, sword)
    // Redirect to a new target; hero no longer points at sword.
    addRelation(w, hero, ChildOf, shield)
    expect(getRelationTargets(w, hero, ChildOf)).toEqual([shield])

    // Destroying the stale (old) target must NOT disturb the live edge.
    destroyEntity(w, sword)
    expect(getRelationTargets(w, hero, ChildOf)).toEqual([shield])

    // Destroying the live (new) target clears the edge.
    destroyEntity(w, shield)
    expect(getRelationTargets(w, hero, ChildOf)).toEqual([])
  })

  it('removeRelation updates incoming bookkeeping: later destroy of the ex-target is a no-op', () => {
    const w = createWorld()
    const child = createEntity(w)
    const parent = createEntity(w)
    addRelation(w, child, ChildOf, parent)
    removeRelation(w, child, ChildOf, parent)
    expect(getRelationTargets(w, child, ChildOf)).toEqual([])

    // The edge is already gone; destroying the former target must not throw or
    // resurrect anything.
    expect(() => destroyEntity(w, parent)).not.toThrow()
    expect(getRelationTargets(w, child, ChildOf)).toEqual([])
  })

  it('destroying the SOURCE of an exclusive edge clears it and frees the slot for reuse', () => {
    const w = createWorld()
    const child = createEntity(w)
    const parent = createEntity(w)
    addRelation(w, child, ChildOf, parent)

    destroyEntity(w, child)
    // Source gone: no targets, and destroying the (still-alive) parent afterwards
    // must be a clean no-op for this relation.
    expect(getRelationTargets(w, child, ChildOf)).toEqual([])
    expect(() => destroyEntity(w, parent)).not.toThrow()
  })

  it('destroy cleanup is correct on a large SPARSE exclusive table', () => {
    // Grow the exclusive Int32Array large (many high-index sources) while keeping
    // only a couple of live edges — the sparse case the optimisation targets. The
    // observable contract is unchanged: destroying a shared target clears exactly
    // the sources pointing at it and nothing else.
    const w = createWorld({ initialCapacity: 4 })
    // Fill enough entities to force several doublings of capacity.
    const ents: EntityId[] = []
    for (let i = 0; i < 5000; i++) ents.push(createEntity(w))

    const target = ents[4000]!
    const srcHigh = ents[4999]!
    const srcMid = ents[2500]!
    addRelation(w, srcHigh, ChildOf, target)
    addRelation(w, srcMid, ChildOf, target)
    // An unrelated edge that must survive.
    const otherTarget = ents[10]!
    const otherSrc = ents[20]!
    addRelation(w, otherSrc, ChildOf, otherTarget)

    expect(getRelationTargets(w, srcHigh, ChildOf)).toEqual([target])
    expect(getRelationTargets(w, srcMid, ChildOf)).toEqual([target])

    destroyEntity(w, target)

    // Both incoming sources cleared; the unrelated edge is intact.
    expect(getRelationTargets(w, srcHigh, ChildOf)).toEqual([])
    expect(getRelationTargets(w, srcMid, ChildOf)).toEqual([])
    expect(getRelationTargets(w, otherSrc, ChildOf)).toEqual([otherTarget])
  })

  it('exclusive incoming cleanup survives a capacity grow between add and destroy', () => {
    const w = createWorld({ initialCapacity: 4 })
    const child = createEntity(w)
    const parent = createEntity(w)
    addRelation(w, child, ChildOf, parent)
    // Grow capacity AFTER the edge exists, so the exclusive array is resized while
    // the incoming bookkeeping must stay consistent.
    for (let i = 0; i < 64; i++) createEntity(w)
    expect(getRelationTargets(w, child, ChildOf)).toEqual([parent])

    destroyEntity(w, parent)
    expect(getRelationTargets(w, child, ChildOf)).toEqual([])
  })

  it('relation data survives a capacity grow and cleans up correctly on destroy', () => {
    const Likes = defineRelation<{ since: number }>()
    const w = createWorld({ initialCapacity: 4 })
    const a = createEntity(w)
    const b = createEntity(w)
    addRelation(w, a, Likes, b, { since: 2024 })
    expect(getRelationTargets(w, a, Likes)).toEqual([b])

    // Allocate enough fresh entities to push capacity past 4 (doubles to 8, 16...).
    const filler: number[] = []
    for (let i = 0; i < 20; i++) filler.push(createEntity(w) as number)

    // Edge still observable after grow.
    expect(getRelationTargets(w, a, Likes)).toEqual([b])

    // Add a second edge using high-index entities to exercise the post-grow path.
    const high = filler[filler.length - 1]!
    addRelation(w, a as any, Likes, high as any, { since: 2025 })
    expect([...getRelationTargets(w, a, Likes)].sort()).toEqual([b, high].sort())

    // Destroy target b — outgoing edge to b must drop; high remains.
    destroyEntity(w, b)
    expect(getRelationTargets(w, a, Likes)).toEqual([high])

    // Destroy source a — all outgoing edges drop.
    destroyEntity(w, a)
    expect(getRelationTargets(w, a, Likes)).toEqual([])
  })
})
