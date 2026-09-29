// aiecsjs/observers — observe component add/remove/set events.

import { forEachSetBit, matchesEntityMask } from './internal/bitmask.js'
import { getComponentInfo, registerObserverDispatch } from './internal/component.js'
import { registerObserversAPI } from './internal/entity.js'
import { EcsError } from './internal/errors.js'
import { asQueryInternal, ensureQueryRegistered } from './internal/query.js'
import type {
  ComponentLike,
  EntityId,
  ObserverEntry,
  ObserverEvent,
  Query,
  QueryMaskBundle,
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
  return registerComponentObserver(world, component, 'add', handler, opts)
}

export function onRemove(
  world: World,
  component: ComponentLike,
  handler: (eid: EntityId) => void,
  opts?: ObserverOptions,
): () => void {
  return registerComponentObserver(world, component, 'remove', handler, opts)
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
  return registerComponentObserver(world, component, 'set', handler, opts)
}

/**
 * Observe a query: `'add'` fires when an entity starts matching, `'remove'`
 * when it stops matching (including on destroy), `'set'` after `setComponent`
 * writes one of the query's `all`/`any` components on a matching entity.
 * `query` may be a raw component array, as for `runQuery`.
 */
export function observe(
  world: World,
  query: Query,
  event: ObserverEvent,
  handler: (eid: EntityId) => void,
  opts?: ObserverOptions,
): () => void {
  const state = getWorldState(world)
  assertHandler(handler)
  // Register the query (and, for enter/exit queries, its source query and
  // reactive buffer) into this world so dispatch can find it. Unlike
  // `runQuery`, this never drains a reactive buffer as a side effect.
  const q = asQueryInternal(query)
  ensureQueryRegistered(state, q)
  return addObserver(state, event, -1, q.id, handler, opts)
}

// A non-function handler would be accepted here and then throw from inside
// every later structural change — after the change was committed but before
// reactive queries were notified — so it is rejected before any side effect.
function assertHandler(handler: unknown): void {
  if (typeof handler !== 'function') throw new EcsError('aiecsjs: handler must be a function')
}

function registerComponentObserver(
  world: World,
  component: ComponentLike,
  event: ObserverEvent,
  handler: (eid: EntityId, value?: unknown) => void,
  opts: ObserverOptions | undefined,
): () => void {
  const state = getWorldState(world)
  assertHandler(handler)
  const bit = getOrRegisterComponentBit(state, getComponentInfo(component))
  return addObserver(state, event, bit, -1, handler, opts)
}

// Push an observer entry; returns its unsubscribe, bound to `opts.signal`.
function addObserver(
  state: WorldState,
  event: ObserverEvent,
  componentBit: number,
  queryId: number,
  handler: (eid: EntityId, value?: unknown) => void,
  opts: ObserverOptions | undefined,
): () => void {
  const entry: ObserverEntry = { event, componentBit, queryId, handler }
  state.observers.push(entry)
  return bindAbortSignal(() => {
    const idx = state.observers.indexOf(entry)
    if (idx >= 0) state.observers.splice(idx, 1)
  }, opts?.signal)
}

// --- Dispatch impls (wired into component.ts) ---
//
// CORRECTNESS: every dispatch loop snapshots `state.observers` via `Array.from`
// before iterating. A handler may call its returned unsubscribe (which splices
// `state.observers`), and mutating the backing array while iterating with a
// for-of would skip the next sibling observer. The snapshot pins the visit
// list; already-removed entries are filtered via `state.observers.includes`
// so an in-flight unsubscribe also skips subsequent fires of the same dispatch.

// Component-level observers of `event` registered on `bit`.
function fireComponent(
  state: WorldState,
  eid: EntityId,
  bit: number,
  event: ObserverEvent,
  value?: unknown,
): void {
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event !== event) continue
    if (obs.componentBit !== bit) continue
    if (!state.observers.includes(obs)) continue
    obs.handler(eid, value)
  }
}

// Whether the entity mask stored in `mask` at word offset `base` matches.
function bundleMatches(bundle: QueryMaskBundle, mask: Uint32Array, base: number, w: number) {
  const { withMask, anyMask, noneMask, anyHasBits } = bundle
  return matchesEntityMask(mask, base, w, withMask, anyMask, noneMask, anyHasBits)
}

function fireAdd(
  state: WorldState,
  eid: EntityId,
  bit: number,
  prev: Uint32Array,
  next: Uint32Array,
): void {
  fireComponent(state, eid, bit, 'add')
  dispatchQueryObservers(state, eid, prev, next)
}

// Component-level remove. removeComponent calls this BEFORE writing the new
// mask, so handlers can still read the outgoing value via getComponent.
function fireRemove(state: WorldState, eid: EntityId, bit: number): void {
  fireComponent(state, eid, bit, 'remove')
}

function fireSet(state: WorldState, eid: EntityId, bit: number, value: unknown): void {
  const w = state.options.maskWordCount
  const base = ((eid as number) & state.options.indexMask) * w
  const componentId = state.componentInfoByBit[bit]?.id ?? -1
  fireComponent(state, eid, bit, 'set', value)
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event !== 'set' || obs.queryId === -1) continue
    if (!state.observers.includes(obs)) continue
    // Query 'set' fires when the written component is one of the query's
    // `all` / `any` terms AND the entity currently matches the query.
    const q = state.queries[obs.queryId]
    const bundle = state.queryMasks.get(obs.queryId)
    if (!q || !bundle) continue
    if (!q.all.includes(componentId) && !q.any.includes(componentId)) continue
    if (bundleMatches(bundle, state.entityMask, base, w)) obs.handler(eid, value)
  }
}

// Helper: when a component changes, walk query observers and fire on match
// transitions — 'add' when the entity starts matching, 'remove' when it stops —
// whichever structural op (add or remove) caused it. Mirrors the reactive
// enter/exit path (recordEntityMaskChange). `prev` / `next` are the caller's
// private mask snapshots, so reentrant handlers cannot skew the comparison.
function dispatchQueryObservers(
  state: WorldState,
  eid: EntityId,
  prev: Uint32Array,
  next: Uint32Array,
): void {
  const w = state.options.maskWordCount
  const snapshot = Array.from(state.observers)
  for (const obs of snapshot) {
    if (obs.event === 'set' || obs.queryId === -1) continue
    if (!state.observers.includes(obs)) continue
    const bundle = state.queryMasks.get(obs.queryId)
    if (!bundle) continue
    const wasMatch = bundleMatches(bundle, prev, 0, w)
    const isMatch = bundleMatches(bundle, next, 0, w)
    if (obs.event === 'add' ? !wasMatch && isMatch : wasMatch && !isMatch) obs.handler(eid)
  }
}

// Wire the dispatch into component.ts
registerObserverDispatch({
  fireAdd,
  fireRemove,
  fireRemoveQuery: dispatchQueryObservers,
  fireSet,
})

// Register destroy hook so onRemove fires for every component on destroy
// AND so query-targeted observers see the entity exit any matched query.
registerObserversAPI({
  dispatchDestroyObservers(state: WorldState, eid: EntityId): void {
    const w = state.options.maskWordCount
    const idx = (eid as number) & state.options.indexMask
    const base = idx * w

    // Snapshot the pre-destroy mask so Phase 1 visits a stable bit list even
    // if a handler reentrant-mutates `state.entityMask`.
    const preMask = state.entityMask.slice(base, base + w)

    // Phase 1: component-level remove for every bit set at destroy entry that
    // is still set now. A handler that removed a sibling component via
    // removeComponent already fired that component's onRemove; firing it here
    // again would double-report it. An in-flight removeComponent of a bit
    // (whose onRemove handler destroyed the entity) is already firing its
    // onRemove too.
    forEachSetBit(preMask, 0, w, (bit) => {
      if (!((state.entityMask[base + (bit >>> 5)] ?? 0) & (1 << (bit & 31)))) return
      if (state.removing.has(idx * state.options.maxComponents + bit)) return
      fireComponent(state, eid, bit, 'remove')
    })

    // Phase 2: query-level remove for any query this entity matches after
    // Phase 1. Reentrant component changes made by Phase 1 handlers went
    // through add/removeComponent, which already dispatched their own query
    // transitions, so the live mask is the state the entity is leaving from.
    const querySnapshot = Array.from(state.observers)
    for (const obs of querySnapshot) {
      if (obs.event !== 'remove' || obs.queryId === -1) continue
      if (!state.observers.includes(obs)) continue
      const bundle = state.queryMasks.get(obs.queryId)
      if (bundle && bundleMatches(bundle, state.entityMask, base, w)) obs.handler(eid)
    }
  },
})
