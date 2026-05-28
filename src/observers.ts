// aiecsjs/observers — observe component add/remove/set events.

import { forEachSetBit, matchesEntityMask } from './internal/bitmask.js'
import { getComponentInfo, registerObserverDispatch } from './internal/component.js'
import { registerObserversAPI } from './internal/entity.js'
import { runQuery } from './internal/query.js'
import type {
  ComponentLike,
  EntityId,
  ObserverEntry,
  ObserverEvent,
  Query,
  QueryInternal,
  World,
  WorldState,
} from './internal/types.js'
import { getOrRegisterComponentBit, getWorldState } from './internal/world.js'

/**
 * Options accepted by every observer registration. `signal` aborts the
 * subscription when fired; the returned unsubscribe is still safe to call.
 */
export interface ObserverOptions {
  signal?: AbortSignal
}

function bindAbortSignal(unsubscribe: () => void, signal: AbortSignal | undefined): () => void {
  if (!signal) return unsubscribe
  if (signal.aborted) {
    unsubscribe()
    return () => {}
  }
  const onAbort = (): void => {
    unsubscribe()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  let detached = false
  return () => {
    if (detached) return
    detached = true
    signal.removeEventListener('abort', onAbort)
    unsubscribe()
  }
}

export function onAdd(
  world: World,
  component: ComponentLike,
  handler: (eid: EntityId) => void,
  opts?: ObserverOptions,
): () => void {
  return bindAbortSignal(registerComponentObserver(world, component, 'add', handler), opts?.signal)
}

export function onRemove(
  world: World,
  component: ComponentLike,
  handler: (eid: EntityId) => void,
  opts?: ObserverOptions,
): () => void {
  return bindAbortSignal(
    registerComponentObserver(world, component, 'remove', handler),
    opts?.signal,
  )
}

/**
 * Low-level mutation hook. Fires after `setComponent(world, eid, comp, value)`
 * when the component is already present on the entity.
 *
 * Does NOT fire for:
 * - `addComponent` (use `onAdd` for that path; `addComponent + setComponent`
 *   fires `onAdd` then `onSet`)
 * - Direct writes to a column view returned by `getComponent`. The column
 *   array is the raw `TypedArray` / object — mutations bypass observer
 *   dispatch.
 *
 * @example
 * // ❌ Anti-pattern: no `onSet` callback fires.
 * const col = getComponent(world, eid, Position)   // raw column object
 * col.x[getEntityIndex(eid)] = 5
 *
 * // ✅ Correct: triggers `onSet`.
 * setComponent(world, eid, Position, { x: 5 })
 *
 * This is NOT a reactive value-predicate query — see `enterQuery` /
 * `exitQuery` for structural change tracking, and validate value predicates
 * in app code if you need them.
 */
export function onSet<C extends ComponentLike>(
  world: World,
  component: C,
  handler: (eid: EntityId, value: unknown) => void,
  opts?: ObserverOptions,
): () => void {
  return bindAbortSignal(registerComponentObserver(world, component, 'set', handler), opts?.signal)
}

export function observe(
  world: World,
  query: Query,
  event: ObserverEvent,
  handler: (eid: EntityId) => void,
  opts?: ObserverOptions,
): () => void {
  const state = getWorldState(world)
  // Force registration of the query into this world so dispatch can find it.
  runQuery(world, query)
  const entry: ObserverEntry = {
    event,
    componentBit: -1,
    queryId: (query as QueryInternal).id,
    handler: handler as (eid: EntityId, value?: unknown) => void,
  }
  state.observers.push(entry)
  const unsubscribe = (): void => {
    const idx = state.observers.indexOf(entry)
    if (idx >= 0) state.observers.splice(idx, 1)
  }
  return bindAbortSignal(unsubscribe, opts?.signal)
}

function registerComponentObserver(
  world: World,
  component: ComponentLike,
  event: ObserverEvent,
  handler: (eid: EntityId, value?: unknown) => void,
): () => void {
  const state = getWorldState(world)
  const info = getComponentInfo(component)
  let bit = state.componentBitFor.get(info.id)
  if (bit === undefined) {
    bit = getOrRegisterComponentBit(state, info)
  }
  const entry: ObserverEntry = { event, componentBit: bit, queryId: -1, handler }
  state.observers.push(entry)
  return () => {
    const idx = state.observers.indexOf(entry)
    if (idx >= 0) state.observers.splice(idx, 1)
  }
}

// --- Dispatch impls (wired into component.ts) ---
//
// CORRECTNESS: every dispatch loop snapshots `state.observers` via `Array.from`
// before iterating. A handler may call its returned unsubscribe (which splices
// `state.observers`), and mutating the backing array while iterating with a
// for-of would skip the next sibling observer. The snapshot pins the visit
// list; already-removed entries are filtered via `state.observers.includes`
// so an in-flight unsubscribe also skips subsequent fires of the same dispatch.

function fireAdd(state: WorldState, eid: EntityId, bit: number): void {
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event !== 'add') continue
    if (obs.componentBit !== bit) continue
    if (!state.observers.includes(obs)) continue
    obs.handler(eid)
  }
  // Query-targeted observers: check if the entity's mask now matches the query
  // (uses the post-mutation mask, which the caller already wrote)
  dispatchQueryObservers(state, eid, 'add', /*prev*/ null, /*current*/ true)
}

function fireRemove(state: WorldState, eid: EntityId, bit: number): void {
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event !== 'remove') continue
    if (obs.componentBit !== bit) continue
    if (!state.observers.includes(obs)) continue
    obs.handler(eid)
  }
  dispatchQueryObservers(state, eid, 'remove', /*prev*/ true, /*current*/ null)
}

function fireSet(state: WorldState, eid: EntityId, bit: number, value: unknown): void {
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event !== 'set') continue
    if (!state.observers.includes(obs)) continue
    if (obs.componentBit === bit) obs.handler(eid, value)
    else if (obs.queryId !== -1) {
      const q = state.queries[obs.queryId]
      if (q?.all.includes(state.componentInfoByBit[bit]?.id ?? -1)) {
        obs.handler(eid, value)
      }
    }
  }
}

// Helper: when a component changes, walk query observers to see if their query
// match status changed. Reads state.entityMask in place; no per-call allocation.
function dispatchQueryObservers(
  state: WorldState,
  eid: EntityId,
  event: 'add' | 'remove',
  _prev: unknown,
  _current: unknown,
): void {
  const w = state.options.maskWordCount
  const base = ((eid as number) & state.options.indexMask) * w
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event !== event) continue
    if (obs.queryId === -1) continue
    if (!state.observers.includes(obs)) continue
    const bundle = state.queryMasks.get(obs.queryId)
    if (!bundle) continue
    const isMatch = matchesEntityMask(
      state.entityMask,
      base,
      w,
      bundle.withMask,
      bundle.anyMask,
      bundle.noneMask,
      bundle.anyHasBits,
    )
    // For 'add' event, fire if newly matched. For 'remove', fire if newly unmatched.
    // We approximate "newly" by always firing on event when match status agrees;
    // duplicates are acceptable for 0.1 query observers.
    if (event === 'add' && isMatch) obs.handler(eid)
    if (event === 'remove' && !isMatch) obs.handler(eid)
  }
}

// Wire the dispatch into component.ts
registerObserverDispatch({ fireAdd, fireRemove, fireSet })

// Register destroy hook so onRemove fires for every component on destroy
// AND so query-targeted observers see the entity exit any matched query.
registerObserversAPI({
  dispatchDestroyObservers(state: WorldState, eid: EntityId): void {
    const w = state.options.maskWordCount
    const base = ((eid as number) & state.options.indexMask) * w

    // Snapshot the pre-destroy mask so Phase 2's `wasMatch` is computed
    // against the state at destroy entry — Phase 1 handlers might reentrant-
    // mutate `state.entityMask` (e.g. by calling removeComponent on a
    // sibling), and we still want query observers to fire for queries the
    // entity was matching *before* the destroy began.
    const preMask = new Uint32Array(w)
    for (let i = 0; i < w; i++) preMask[i] = state.entityMask[base + i] ?? 0

    // Phase 1: component-level remove for every bit set at destroy entry.
    forEachSetBit(preMask, 0, w, (bit) => {
      const snapshot = Array.from(state.observers)
      for (const obs of snapshot) {
        if (obs.event !== 'remove') continue
        if (obs.componentBit !== bit) continue
        if (!state.observers.includes(obs)) continue
        obs.handler(eid)
      }
    })

    // Phase 2: query-level remove for any query that was matching this entity.
    // Read the pre-destroy mask snapshot (not live state.entityMask) so this
    // phase is decoupled from Phase 1 reentrant mutations.
    const querySnapshot = Array.from(state.observers)
    for (const obs of querySnapshot) {
      if (obs.event !== 'remove') continue
      if (obs.queryId === -1) continue
      if (!state.observers.includes(obs)) continue
      const bundle = state.queryMasks.get(obs.queryId)
      if (!bundle) continue
      const wasMatch = matchesEntityMask(
        preMask,
        0,
        w,
        bundle.withMask,
        bundle.anyMask,
        bundle.noneMask,
        bundle.anyHasBits,
      )
      if (wasMatch) obs.handler(eid)
    }
  },
})
