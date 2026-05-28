import { clearAllEntityStorages } from './component.js'
import type { EntityId, World, WorldState } from './types.js'
import { ensureArchetypeCapacity, ensureCapacity, getWorldState } from './world.js'

export function createEntity(world: World): EntityId {
  const state = getWorldState(world)
  if (state.readOnly) {
    throw new Error('aiecsjs: cannot createEntity on a read-only world (worker-attached)')
  }

  let eid: number
  if (state.freeList.length > 0) {
    eid = state.freeList.pop()!
  } else {
    if (state.nextFreshIndex >= state.options.maxEntities) {
      throw new Error(`aiecsjs: reached maxEntities ${state.options.maxEntities}`)
    }
    if (state.nextFreshIndex >= state.capacity) {
      ensureCapacity(state, state.nextFreshIndex + 1)
    }
    eid = state.nextFreshIndex++
  }

  // Move into the empty archetype (0)
  const arch = state.archetypes[0]
  if (!arch) throw new Error('aiecsjs: missing empty archetype')
  ensureArchetypeCapacity(arch, arch.size + 1)
  const row = arch.size
  arch.entities[row] = eid
  arch.entityRow.set(eid, row)
  arch.size++

  state.entityArchetype[eid] = 0
  // Reset entityMask row for this eid
  const w = state.options.maskWordCount
  const base = eid * w
  for (let i = 0; i < w; i++) state.entityMask[base + i] = 0

  state.size++
  return eid as EntityId
}

export function destroyEntity(world: World, eid: EntityId): void {
  const state = getWorldState(world)
  if (state.readOnly) {
    throw new Error('aiecsjs: cannot destroyEntity on a read-only world')
  }
  if (!isAliveInternal(state, eid)) return

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
  const archId = state.entityArchetype[eid] ?? 0
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
  state.entityArchetype[eid] = 0
  const w = state.options.maskWordCount
  const base = eid * w
  for (let i = 0; i < w; i++) state.entityMask[base + i] = 0
  // bump generation (Uint8Array wraps to 8 bits naturally; Uint16Array to 16)
  const idx = eid as number
  state.generations[idx] = ((state.generations[idx] ?? 0) + 1) & 0xffff

  state.freeList.push(eid)
  state.size--
}

export function entityExists(world: World, eid: EntityId): boolean {
  const state = getWorldState(world)
  return isAliveInternal(state, eid)
}

export function isAliveInternal(state: WorldState, eid: number): boolean {
  if (eid <= 0) return false
  if (eid >= state.capacity) return false
  // An entity is alive iff it is in some archetype (its row map points somewhere).
  const archId = state.entityArchetype[eid] ?? 0
  const arch = state.archetypes[archId]
  if (!arch) return false
  return arch.entityRow.has(eid)
}

export function getEntityIndex(eid: EntityId): number {
  return eid as number
}

export function getEntityGeneration(_eid: EntityId): number {
  // Unversioned in 0.1: generation not encoded in EntityId.
  return 0
}

export function packEntity(index: number, _generation: number): EntityId {
  // Identity in 0.1.
  return index as EntityId
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
