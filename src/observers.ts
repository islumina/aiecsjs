// aiecsjs/observers — observe component add/remove/set events.

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
import { getWorldState, getOrRegisterComponentBit } from './internal/world.js'
import {
  registerObserverDispatch,
  getComponentInfo,
} from './internal/component.js'
import { runQuery } from './internal/query.js'
import { registerObserversAPI } from './internal/entity.js'
import { matches } from './internal/bitmask.js'

export function onAdd(
  world: World,
  component: ComponentLike,
  handler: (eid: EntityId) => void,
): () => void {
  return registerComponentObserver(world, component, 'add', handler)
}

export function onRemove(
  world: World,
  component: ComponentLike,
  handler: (eid: EntityId) => void,
): () => void {
  return registerComponentObserver(world, component, 'remove', handler)
}

export function onSet<C extends ComponentLike>(
  world: World,
  component: C,
  handler: (eid: EntityId, value: unknown) => void,
): () => void {
  return registerComponentObserver(world, component, 'set', handler)
}

export function observe(
  world: World,
  query: Query,
  event: ObserverEvent,
  handler: (eid: EntityId) => void,
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
  return () => {
    const idx = state.observers.indexOf(entry)
    if (idx >= 0) state.observers.splice(idx, 1)
  }
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

function fireAdd(state: WorldState, eid: EntityId, bit: number): void {
  // Component-targeted observers
  for (const obs of state.observers) {
    if (obs.event !== 'add') continue
    if (obs.componentBit === bit) obs.handler(eid)
  }
  // Query-targeted observers: check if the entity's mask now matches the query
  // (uses the post-mutation mask, which the caller already wrote)
  dispatchQueryObservers(state, eid, 'add', /*prev*/null, /*current*/true)
}

function fireRemove(state: WorldState, eid: EntityId, bit: number): void {
  for (const obs of state.observers) {
    if (obs.event !== 'remove') continue
    if (obs.componentBit === bit) obs.handler(eid)
  }
  dispatchQueryObservers(state, eid, 'remove', /*prev*/true, /*current*/null)
}

function fireSet(state: WorldState, eid: EntityId, bit: number, value: unknown): void {
  for (const obs of state.observers) {
    if (obs.event !== 'set') continue
    if (obs.componentBit === bit) obs.handler(eid, value)
    else if (obs.queryId !== -1) {
      const q = state.queries[obs.queryId]
      if (q && q.all.includes(state.componentInfoByBit[bit]?.id ?? -1)) {
        obs.handler(eid, value)
      }
    }
  }
}

// Helper: when a component changes, walk query observers to see if their query
// match status changed. For simplicity, we re-check each query observer's query
// against the entity's current mask.
function dispatchQueryObservers(
  state: WorldState,
  eid: EntityId,
  event: 'add' | 'remove',
  _prev: unknown,
  _current: unknown,
): void {
  // Use entityMask directly
  const w = state.options.maskWordCount
  const base = (eid as number) * w
  const tmpMask = new Uint32Array(w)
  for (let i = 0; i < w; i++) tmpMask[i] = state.entityMask[base + i] ?? 0
  for (const obs of state.observers) {
    if (obs.event !== event) continue
    if (obs.queryId === -1) continue
    const q = state.queries[obs.queryId]
    if (!q) continue
    const isMatch = matches(tmpMask, q.withMask, q.anyMask, q.noneMask, q.anyHasBits, w)
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
registerObserversAPI({
  dispatchDestroyObservers(state: WorldState, eid: EntityId): void {
    // Walk every bit currently set in the entity's mask
    const w = state.options.maskWordCount
    const base = (eid as number) * w
    for (let wi = 0; wi < w; wi++) {
      let word = state.entityMask[base + wi] ?? 0
      while (word !== 0) {
        const lsb = word & -word
        const bit = (wi << 5) + (31 - Math.clz32(lsb))
        for (const obs of state.observers) {
          if (obs.event === 'remove' && obs.componentBit === bit) obs.handler(eid)
        }
        word &= word - 1
      }
    }
  },
})
