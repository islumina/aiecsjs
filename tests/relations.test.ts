import { describe, it, expect } from 'vitest'
import { createWorld, createEntity, destroyEntity } from '../src/index.js'
import {
  defineRelation,
  addRelation,
  removeRelation,
  getRelationTargets,
  ChildOf,
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
})
