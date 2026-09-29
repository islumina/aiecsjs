// aiecsjs/relations — entity-to-entity relations (experimental in 0.1).

import { isAliveInternal, packEid, registerRelationsCleanup } from './internal/entity.js'
import { EcsError } from './internal/errors.js'
import { ids, shared } from './internal/registry.js'
import type { EntityId, Relation, RelationStorage, World, WorldState } from './internal/types.js'
import { getWorldState, getWritableState } from './internal/world.js'

export function defineRelation<T = void>(options?: { exclusive?: boolean }): Relation<T> {
  const id = ids.relation++
  return {
    __kind: 'relation',
    __id: id,
    __exclusive: options?.exclusive ?? false,
    __hasData: false,
  } as Relation<T>
}

// One ChildOf for every loaded copy of the package (see registry.ts), so a
// hierarchy built through one copy is visible through another.
shared.childOf ??= defineRelation({ exclusive: true })
export const ChildOf: Relation = shared.childOf

// The relation's storage in this world (undefined until its first edge).
// Rejects a value that is not a `defineRelation` handle.
function storageOf(state: WorldState, rel: Relation<unknown>): RelationStorage | undefined {
  if (rel?.__kind !== 'relation') throw new EcsError('aiecsjs: rel must be a relation')
  return state.relationStorage.get(rel.__id)
}

function getOrCreateStorage(state: WorldState, rel: Relation<unknown>): RelationStorage {
  let storage = storageOf(state, rel)
  if (storage) return storage
  storage = {
    rel,
    exclusive: rel.__exclusive ? new Int32Array(state.capacity).fill(-1) : null,
    incoming: rel.__exclusive ? new Map<number, Set<number>>() : null,
    outgoing: new Map<number, number[]>(),
    data: new Map<number, Map<number, unknown>>(),
  }
  state.relationStorage.set(rel.__id, storage)
  return storage
}

// --- Exclusive reverse-index (incoming) helpers ---
// `incoming` mirrors the `exclusive` array: incoming.get(tgt) is the set of
// source slots whose exclusive[src] === tgt. Every place that writes a non-`-1`
// value into `exclusive` must call `linkIncoming`, and every place that clears a
// slot (sets it back to -1) must call `unlinkIncoming`, so the reverse index
// never drifts from the forward array.

function linkIncoming(storage: RelationStorage, src: number, tgt: number): void {
  const incoming = storage.incoming
  if (!incoming) return
  let set = incoming.get(tgt)
  if (!set) {
    set = new Set<number>()
    incoming.set(tgt, set)
  }
  set.add(src)
}

function unlinkIncoming(storage: RelationStorage, src: number, tgt: number): void {
  const incoming = storage.incoming
  if (!incoming) return
  const set = incoming.get(tgt)
  if (!set) return
  set.delete(src)
  if (set.size === 0) incoming.delete(tgt)
}

/**
 * Add a relation edge from `source` to `target` (replacing `source`'s current
 * target for an exclusive relation such as `ChildOf`), optionally with a data
 * payload read back by {@link getRelationData}.
 *
 * Throws `EcsError` when `source` or `target` is not alive, mirroring
 * `addComponent`: edges are stored by slot, so an edge to a dead entity would
 * otherwise be inherited by whatever entity is later recycled into that slot.
 * Check `entityExists` first when an endpoint may be stale.
 */
export function addRelation<T>(
  world: World,
  source: EntityId,
  rel: Relation<T>,
  target: EntityId,
  data?: T,
): void {
  const state = getWritableState(world)
  if (!isAliveInternal(state, source)) {
    throw new EcsError(`aiecsjs: addRelation on dead source entity ${source}`)
  }
  if (!isAliveInternal(state, target)) {
    throw new EcsError(`aiecsjs: addRelation on dead target entity ${target}`)
  }
  const storage = getOrCreateStorage(state, rel as Relation<unknown>)
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
      unlinkIncoming(storage, src, prevTgt)
    }
    storage.exclusive[src] = tgt
    if (prevTgt !== tgt) linkIncoming(storage, src, tgt)
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
  const state = getWritableState(world)
  const storage = storageOf(state, rel as Relation<unknown>)
  if (!storage) return
  const src = (source as number) & state.options.indexMask
  const tgt = (target as number) & state.options.indexMask
  if (storage.exclusive) {
    if (src < storage.exclusive.length && storage.exclusive[src] === tgt) {
      storage.exclusive[src] = -1
      unlinkIncoming(storage, src, tgt)
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
  const storage = storageOf(state, rel as Relation<unknown>)
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
 * **Slot keying:** relation storage keys edges by raw entity slot index
 * (`entityId & indexMask`), not by the full packed EntityId. `addRelation`
 * rejects dead endpoints and `destroyEntity` / `resetWorld` drop every edge of
 * the entities they remove, so storage never holds an edge for a dead entity.
 * A *stale* EntityId whose slot was recycled still addresses the slot's
 * current occupant here, so validate cached ids with `entityExists` (or use
 * `EntityRef`) before reading.
 */
export function getRelationData<T>(
  world: World,
  source: EntityId,
  rel: Relation<T>,
  target: EntityId,
): T | undefined {
  const state = getWorldState(world)
  const storage = storageOf(state, rel as Relation<unknown>)
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
      // `e` as a SOURCE: clear its own exclusive slot and unlink it from whatever
      // target it currently points at, so the reverse index stays consistent.
      if (e < storage.exclusive.length) {
        const cur = storage.exclusive[e] ?? -1
        if (cur >= 0) unlinkIncoming(storage, e, cur)
        storage.exclusive[e] = -1
      }
      // `e` as a TARGET: clear every source that points at it. Use the reverse
      // index to touch only the actual incoming sources (O(incoming)) instead of
      // scanning the entire `exclusive` capacity (O(capacity)) — the bounded-cost
      // path for large sparse relation tables. Behaviour is identical to the old
      // full scan: every src with exclusive[src] === e is reset to -1.
      const incomingSet = storage.incoming?.get(e)
      if (incomingSet) {
        for (const src of incomingSet) {
          if (src < storage.exclusive.length) storage.exclusive[src] = -1
        }
        storage.incoming?.delete(e)
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
