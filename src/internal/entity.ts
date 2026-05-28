import { clearAllEntityStorages } from './component.js'
import type { EntityId, ResolvedWorldOptions, World, WorldState } from './types.js'
import { ensureArchetypeCapacity, ensureCapacity, getWorldState } from './world.js'

// --- Default bit layout constants (used by public getEntityIndex / getEntityGeneration / packEntity) ---
// These use the default 24/8 split. See §4.4 limitation: callers using non-default
// createWorld({ indexBits, generationBits }) should not rely on these functions for unpacking.
export const DEFAULT_INDEX_BITS = 24
export const DEFAULT_GENERATION_BITS = 8
export const DEFAULT_INDEX_MASK = (1 << DEFAULT_INDEX_BITS) - 1
export const DEFAULT_GENERATION_MASK = (1 << DEFAULT_GENERATION_BITS) - 1

// --- Internal pack/unpack helpers (world-options-aware) ---

export function packEid(idx: number, gen: number, opts: ResolvedWorldOptions): EntityId {
  return (((gen & opts.generationMask) << opts.indexBits) | (idx & opts.indexMask)) as EntityId
}

export function unpackIdx(eid: number, opts: ResolvedWorldOptions): number {
  return eid & opts.indexMask
}

export function unpackGen(eid: number, opts: ResolvedWorldOptions): number {
  return (eid >>> opts.indexBits) & opts.generationMask
}

export function createEntity(world: World): EntityId {
  const state = getWorldState(world)
  if (state.readOnly) {
    throw new Error('aiecsjs: cannot createEntity on a read-only world (worker-attached)')
  }

  let idx: number
  if (state.freeList.length > 0) {
    idx = state.freeList.pop()!
  } else {
    if (state.nextFreshIndex >= state.options.maxEntities) {
      throw new Error(`aiecsjs: reached maxEntities ${state.options.maxEntities}`)
    }
    if (state.nextFreshIndex >= state.capacity) {
      ensureCapacity(state, state.nextFreshIndex + 1)
    }
    idx = state.nextFreshIndex++
  }

  const gen = state.generations[idx] ?? 0
  const eid = packEid(idx, gen, state.options)

  // Move into the empty archetype (0)
  const arch = state.archetypes[0]
  if (!arch) throw new Error('aiecsjs: missing empty archetype')
  ensureArchetypeCapacity(arch, arch.size + 1)
  const row = arch.size
  arch.entities[row] = eid
  arch.entityRow.set(eid, row)
  arch.size++

  state.entityArchetype[idx] = 0
  // Reset entityMask row for this idx
  const w = state.options.maskWordCount
  const base = idx * w
  for (let i = 0; i < w; i++) state.entityMask[base + i] = 0

  state.size++
  return eid
}

export function destroyEntity(world: World, eid: EntityId): void {
  const state = getWorldState(world)
  if (state.readOnly) {
    throw new Error('aiecsjs: cannot destroyEntity on a read-only world')
  }
  if (!isAliveInternal(state, eid)) return

  const idx = eid & state.options.indexMask

  // Fire onRemove for every component the entity has, plus reactive exit
  // (Late-bound to avoid circular imports — done via observers module.)
  const { dispatchDestroyObservers } = lazyObservers()
  dispatchDestroyObservers(state, eid)

  // Clean up relations referring to this entity
  cleanupRelationsOnDestroy(state, eid)

  // Zero the SoA columns / undefine the AoS slots the entity owned, before
  // the mask is cleared. Without this, destroyed entities leave stale data
  // visible to snapshots and serialisation.
  clearAllEntityStorages(state, eid)

  // Swap-pop from its archetype
  const archId = state.entityArchetype[idx] ?? 0
  const arch = state.archetypes[archId]
  if (arch) {
    const row = arch.entityRow.get(eid)
    if (row !== undefined) {
      const lastRow = arch.size - 1
      if (row !== lastRow) {
        const moved = arch.entities[lastRow] ?? 0
        arch.entities[row] = moved
        arch.entityRow.set(moved, row)
      }
      arch.entities[lastRow] = 0
      arch.entityRow.delete(eid)
      arch.size--
    }
  }

  // Wipe state
  state.entityArchetype[idx] = 0
  const w = state.options.maskWordCount
  const base = idx * w
  for (let i = 0; i < w; i++) state.entityMask[base + i] = 0
  // Bump generation — use generationMask so non-default generationBits wraps correctly
  state.generations[idx] = ((state.generations[idx] ?? 0) + 1) & state.options.generationMask

  // freeList stores raw idx (not packed); createEntity packs on re-use
  state.freeList.push(idx)
  state.size--
}

export function entityExists(world: World, eid: EntityId): boolean {
  const state = getWorldState(world)
  return isAliveInternal(state, eid)
}

export function isAliveInternal(state: WorldState, eid: number): boolean {
  const idx = eid & state.options.indexMask
  if (idx <= 0) return false
  if (idx >= state.capacity) return false
  const archId = state.entityArchetype[idx] ?? 0
  const arch = state.archetypes[archId]
  if (!arch) return false
  if (!arch.entityRow.has(eid)) return false
  // Generation comparison: packed eid must match stored generation
  const storedGen = state.generations[idx] ?? 0
  const refGen = (eid >>> state.options.indexBits) & state.options.generationMask
  return storedGen === refGen
}

/**
 * Extract the index portion of a packed entity ID.
 *
 * Uses the default 24-bit index layout. If you created the world with a
 * non-default `indexBits`, use `EntityRef` + `deref` instead.
 */
export function getEntityIndex(eid: EntityId): number {
  return (eid as number) & DEFAULT_INDEX_MASK
}

/**
 * Extract the generation portion of a packed entity ID.
 *
 * Uses the default 8-bit generation layout. If you created the world with a
 * non-default `generationBits`, use `EntityRef` + `deref` instead.
 */
export function getEntityGeneration(eid: EntityId): number {
  return ((eid as number) >>> DEFAULT_INDEX_BITS) & DEFAULT_GENERATION_MASK
}

/**
 * Pack an index and generation into an EntityId using the default 24/8 bit layout.
 *
 * Uses the default `indexBits=24, generationBits=8`. If you created the world
 * with non-default bit sizes, this will produce values with incorrect layout.
 * Use `EntityRef` and `deref` for portable cross-world identity matching.
 */
export function packEntity(index: number, generation: number): EntityId {
  return (((generation & DEFAULT_GENERATION_MASK) << DEFAULT_INDEX_BITS) |
    (index & DEFAULT_INDEX_MASK)) as EntityId
}

export function isEntity(world: World, x: unknown): x is EntityId {
  if (typeof x !== 'number') return false
  return entityExists(world, x as EntityId)
}

// --- Lazy loaders to break import cycles ---

interface ObserversAPI {
  dispatchDestroyObservers(state: WorldState, eid: EntityId): void
}
let _observersAPI: ObserversAPI | null = null
export function registerObserversAPI(api: ObserversAPI): void {
  _observersAPI = api
}
function lazyObservers(): ObserversAPI {
  if (!_observersAPI) {
    return { dispatchDestroyObservers: () => {} }
  }
  return _observersAPI
}

let _relationsCleanup: ((state: WorldState, eid: EntityId) => void) | null = null
export function registerRelationsCleanup(fn: (state: WorldState, eid: EntityId) => void): void {
  _relationsCleanup = fn
}
function cleanupRelationsOnDestroy(state: WorldState, eid: EntityId): void {
  if (_relationsCleanup) _relationsCleanup(state, eid)
}
