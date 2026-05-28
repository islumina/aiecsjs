// aiecsjs/ref — ABA-safe entity references.
//
// EntityRef<T> wraps a packed EntityId with a world identity check so that
// stale references (pointing at a recycled slot with a different generation)
// safely return null rather than silently accessing the wrong entity.
//
// EntityRef is in-memory only. Do not pass across worker boundaries or persist
// to disk. The packed id field has meaning only within the world that issued it.
// Generation counters reset on resetWorld / deserializeWorld / adoptSnapshot.

import { isAliveInternal, unpackGen, unpackIdx } from './internal/entity.js'
import type { EntityId, World } from './internal/types.js'
import { getWorldState } from './internal/world.js'

/**
 * ABA-safe entity reference.
 *
 * Holds the packed EntityId and the id of the world that issued it.
 * Use `deref(world, ref)` to validate and retrieve the live entity id.
 *
 * The phantom type `T` allows callers to distinguish reference kinds at the
 * type system level — e.g. `EntityRef<'bullet'>` vs `EntityRef<'player'>` —
 * without any runtime overhead.
 *
 * @example
 * const ref = refOf<'bullet'>(world, e)
 * // later, in a system:
 * const live = deref(world, ref)
 * if (live !== null) {
 *   // entity is still alive with the same generation
 * }
 */
export interface EntityRef<T = unknown> {
  readonly id: EntityId // packed value (index + generation)
  readonly worldId: number // world.id — guards against cross-world deref
  readonly __phantom?: T // phantom type tag; zero runtime size
}

/**
 * Thrown by `refOf` when the entity is not alive.
 * `deref` and `aliveRef` never throw — they return null/false.
 */
export class EntityNotAliveError extends Error {
  readonly eid: number
  constructor(eid: number) {
    super(`aiecsjs: entity ${eid} is not alive`)
    this.name = 'EntityNotAliveError'
    this.eid = eid
  }
}

/**
 * Create an ABA-safe reference to a live entity.
 *
 * @throws {EntityNotAliveError} if the entity is not alive (dead, never created, or eid === 0).
 *
 * The returned object is frozen. `id` is the packed EntityId; `worldId` is
 * the world's numeric id used by `deref` to reject cross-world lookups.
 *
 * The function may be called on the hot path — each call returns a new object
 * but performs no allocation beyond that.
 */
export function refOf<T = unknown>(world: World, entity: EntityId): EntityRef<T> {
  const state = getWorldState(world)
  if (!isAliveInternal(state, entity as number)) {
    throw new EntityNotAliveError(entity as number)
  }
  return Object.freeze({ id: entity, worldId: state.id }) as EntityRef<T>
}

/**
 * Resolve a ref to its live EntityId, or return null if stale.
 *
 * Returns null when any of the following hold:
 * 1. `ref.worldId !== state.id` — cross-world ref
 * 2. `getEntityIndex(ref.id) >= state.capacity` — index out-of-bounds
 * 3. `getEntityIndex(ref.id) === 0` — sentinel slot
 * 4. entity is not in any archetype's entityRow (slot released)
 * 5. generation mismatch → ABA: old ref points at recycled slot
 *
 * Never throws.
 */
export function deref<T = unknown>(world: World, ref: EntityRef<T>): EntityId | null {
  const state = getWorldState(world)

  // Cross-world guard
  if (ref.worldId !== state.id) return null

  const eid = ref.id as number
  const idx = unpackIdx(eid, state.options)

  // Sentinel and OOB guards
  if (idx <= 0) return null
  if (idx >= state.capacity) return null

  // Archetype membership check
  const archId = state.entityArchetype[idx] ?? 0
  const arch = state.archetypes[archId]
  if (!arch) return null
  if (!arch.entityRow.has(ref.id)) return null

  // Generation match — the core ABA protection
  const storedGen = state.generations[idx] ?? 0
  const refGen = unpackGen(eid, state.options)
  if (storedGen !== refGen) return null

  return ref.id
}

/**
 * Boolean guard form of `deref`. Equivalent to `deref(world, ref) !== null`.
 * Use in guard clauses when you do not need the resolved EntityId.
 *
 * Never throws.
 */
export function aliveRef<T = unknown>(world: World, ref: EntityRef<T>): boolean {
  return deref(world, ref) !== null
}
