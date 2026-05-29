import { describe, expect, it } from 'vitest'
import {
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

  it('relation data is retrievable per edge (non-exclusive)', () => {
    const Likes = defineRelation<{ since: number }>()
    const w = createWorld()
    const a = createEntity(w)
    const b = createEntity(w)
    addRelation(w, a, Likes, b, { since: 2024 })
    // Data retrieval API isn't directly exposed in 0.1; verify targets still tracked
    expect(getRelationTargets(w, a, Likes)).toContain(b)
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
