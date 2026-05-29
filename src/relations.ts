// aiecsjs/relations — entity-to-entity relations (experimental in 0.1).

import { packEid, registerRelationsCleanup } from './internal/entity.js'
import type { EntityId, Relation, RelationStorage, World, WorldState } from './internal/types.js'
import { getWorldState } from './internal/world.js'

let nextRelationId = 1

export function defineRelation<T = void>(options?: { exclusive?: boolean }): Relation<T> {
  const id = nextRelationId++
  return {
    __kind: 'relation',
    __id: id,
    __exclusive: options?.exclusive ?? false,
    __hasData: false,
  } as Relation<T>
}

export const ChildOf: Relation = defineRelation({ exclusive: true })

function getOrCreateStorage(state: WorldState, rel: Relation<any>): RelationStorage {
  let storage = state.relationStorage.get(rel.__id)
  if (storage) return storage
  storage = {
    rel,
    exclusive: rel.__exclusive ? new Int32Array(state.capacity).fill(-1) : null,
    outgoing: new Map<number, number[]>(),
    data: new Map<number, Map<number, unknown>>(),
  }
  state.relationStorage.set(rel.__id, storage)
  return storage
}

export function addRelation<T>(
  world: World,
  source: EntityId,
  rel: Relation<T>,
  target: EntityId,
  data?: T,
): void {
  const state = getWorldState(world)
  if (state.readOnly) throw new Error('aiecsjs: cannot mutate a read-only world')
  const storage = getOrCreateStorage(state, rel as Relation<any>)
  // Use raw idx as keys in relation storage so slot reuse invalidation is consistent
  const src = (source as number) & state.options.indexMask
  const tgt = (target as number) & state.options.indexMask

  if (storage.exclusive) {
    if (src >= storage.exclusive.length) {
      const next = new Int32Array(Math.max(src + 1, storage.exclusive.length * 2)).fill(-1)
      next.set(storage.exclusive)
      storage.exclusive = next
    }
    // Exclusive redirect: if this source already pointed at a different target,
    // drop that previous target's data entry so getRelationData stays consistent
    // with getRelationTargets, which reports only the current exclusive target.
    const prevTgt = storage.exclusive[src] ?? -1
    if (prevTgt >= 0 && prevTgt !== tgt) {
      const prevInner = storage.data.get(src)
      prevInner?.delete(prevTgt)
      if (prevInner && prevInner.size === 0) storage.data.delete(src)
    }
    storage.exclusive[src] = tgt
  } else {
    let list = storage.outgoing.get(src)
    if (!list) {
      list = []
      storage.outgoing.set(src, list)
    }
    if (!list.includes(tgt)) list.push(tgt)
  }

  if (data !== undefined) {
    let inner = storage.data.get(src)
    if (!inner) {
      inner = new Map<number, unknown>()
      storage.data.set(src, inner)
    }
    inner.set(tgt, data)
  }
}

export function removeRelation(
  world: World,
  source: EntityId,
  rel: Relation,
  target: EntityId,
): void {
  const state = getWorldState(world)
  if (state.readOnly) throw new Error('aiecsjs: cannot mutate a read-only world')
  const storage = state.relationStorage.get(rel.__id)
  if (!storage) return
  const src = (source as number) & state.options.indexMask
  const tgt = (target as number) & state.options.indexMask
  if (storage.exclusive) {
    if (src < storage.exclusive.length && storage.exclusive[src] === tgt) {
      storage.exclusive[src] = -1
    }
  } else {
    const list = storage.outgoing.get(src)
    if (list) {
      const idx = list.indexOf(tgt)
      if (idx >= 0) list.splice(idx, 1)
      if (list.length === 0) storage.outgoing.delete(src)
    }
  }
  const inner = storage.data.get(src)
  if (inner) {
    inner.delete(tgt)
    if (inner.size === 0) storage.data.delete(src)
  }
}

export function getRelationTargets(
  world: World,
  source: EntityId,
  rel: Relation,
): readonly EntityId[] {
  const state = getWorldState(world)
  const storage = state.relationStorage.get(rel.__id)
  if (!storage) return []
  const src = (source as number) & state.options.indexMask
  if (storage.exclusive) {
    if (src < storage.exclusive.length) {
      const tgt = storage.exclusive[src] ?? -1
      if (tgt >= 0) {
        const gen = state.generations[tgt] ?? 0
        return [packEid(tgt, gen, state.options)]
      }
    }
    return []
  }
  const list = storage.outgoing.get(src)
  if (!list) return []
  return list.map((tIdx) => {
    const gen = state.generations[tIdx] ?? 0
    return packEid(tIdx, gen, state.options)
  })
}

/**
 * Read the data payload attached to a relation edge.
 *
 * Returns the `data` value that was supplied to {@link addRelation} for the
 * `(source, rel, target)` triple, or `undefined` when:
 * - the relation has never been stored for this world,
 * - no edge from `source` to `target` via `rel` exists, or
 * - the edge was added without a data argument.
 *
 * **Slot-keying semantic (ABA caveat):** relation storage keys edges by raw
 * entity slot index (`entityId & indexMask`), not by the full packed EntityId
 * that includes the generation counter. This means that if entity A is
 * destroyed and a *different* entity B is later created in the same slot, B
 * will inherit any edges that A had — unless the destroy cleanup hook ran
 * (which it does when `destroyEntity` is called). Callers that cache a
 * source/target EntityId should validate liveness with `entityExists` before
 * calling `getRelationData` if slot recycling is a concern.
 */
export function getRelationData<T>(
  world: World,
  source: EntityId,
  rel: Relation<T>,
  target: EntityId,
): T | undefined {
  const state = getWorldState(world)
  const storage = state.relationStorage.get(rel.__id)
  if (!storage) return undefined
  const src = (source as number) & state.options.indexMask
  const tgt = (target as number) & state.options.indexMask
  return storage.data.get(src)?.get(tgt) as T | undefined
}

// Cleanup hook: when an entity is destroyed, remove all relations involving it.
registerRelationsCleanup((state: WorldState, eid: EntityId) => {
  const e = (eid as number) & state.options.indexMask
  for (const storage of state.relationStorage.values()) {
    if (storage.exclusive) {
      if (e < storage.exclusive.length) storage.exclusive[e] = -1
      // Also clear any references TO this entity as target
      for (let i = 0; i < storage.exclusive.length; i++) {
        if (storage.exclusive[i] === e) storage.exclusive[i] = -1
      }
    }
    storage.outgoing.delete(e)
    for (const [src, list] of storage.outgoing) {
      const idx = list.indexOf(e)
      if (idx >= 0) {
        list.splice(idx, 1)
        if (list.length === 0) storage.outgoing.delete(src)
      }
    }
    // Clear data entries involving this entity. The outer key is the source
    // eid; entries whose source IS this entity drop entirely. Entries that
    // reference this entity as a target are pruned from each inner map.
    storage.data.delete(e)
    for (const [src, inner] of storage.data) {
      inner.delete(e)
      if (inner.size === 0) storage.data.delete(src)
    }
  }
})
