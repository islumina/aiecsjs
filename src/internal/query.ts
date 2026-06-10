import { createMask, isMaskZero, listBits, matches, setBit } from './bitmask.js'
import { getComponentInfo } from './component.js'
import type {
  Archetype,
  ComponentInfo,
  ComponentLike,
  EntityId,
  Query,
  QueryDescriptor,
  QueryInternal,
  QueryMaskBundle,
  ReactiveBuffer,
  World,
  WorldState,
} from './types.js'
import {
  getOrRegisterComponentBit,
  getWorldState,
  readEntityMask,
  tryGetComponentBit,
} from './world.js'

let nextQueryId = 1
const moduleQueryCache = new Map<string, QueryInternal>()

function descKey(d: QueryDescriptor): string {
  const all = (d.all ?? [])
    .map((c) => c.__id)
    .sort((a, b) => a - b)
    .join('-')
  const any = (d.any ?? [])
    .map((c) => c.__id)
    .sort((a, b) => a - b)
    .join('-')
  const none = (d.none ?? [])
    .map((c) => c.__id)
    .sort((a, b) => a - b)
    .join('-')
  return `A${all}|Y${any}|N${none}`
}

export function defineQuery(arg: ComponentLike[] | QueryDescriptor): Query {
  const desc: QueryDescriptor = Array.isArray(arg) ? { all: arg } : arg

  // Validate all members are components
  for (const c of [...(desc.all ?? []), ...(desc.any ?? []), ...(desc.none ?? [])]) {
    if (!c || typeof c !== 'object' || typeof (c as any).__id !== 'number') {
      throw new TypeError('aiecsjs: defineQuery received a non-component value')
    }
  }

  const key = descKey(desc)
  const cached = moduleQueryCache.get(key)
  if (cached) return cached

  const q: QueryInternal = {
    id: nextQueryId++,
    mask: [],
    all: (desc.all ?? []).map((c) => c.__id),
    any: (desc.any ?? []).map((c) => c.__id),
    none: (desc.none ?? []).map((c) => c.__id),
    columnViewCache: [...(desc.all ?? []), ...(desc.any ?? [])],
    reactiveKind: 'normal',
    sourceQueryId: -1,
    sourceQuery: null,
  }
  moduleQueryCache.set(key, q)
  return q
}

export function enterQuery(query: Query): Query {
  const q = query as QueryInternal
  const key = `enter:${q.id}`
  const cached = moduleQueryCache.get(key)
  if (cached) return cached
  const reactive: QueryInternal = {
    id: nextQueryId++,
    mask: [],
    all: q.all,
    any: q.any,
    none: q.none,
    columnViewCache: q.columnViewCache,
    reactiveKind: 'enter',
    sourceQueryId: q.id,
    sourceQuery: q,
  }
  moduleQueryCache.set(key, reactive)
  return reactive
}

export function exitQuery(query: Query): Query {
  const q = query as QueryInternal
  const key = `exit:${q.id}`
  const cached = moduleQueryCache.get(key)
  if (cached) return cached
  const reactive: QueryInternal = {
    id: nextQueryId++,
    mask: [],
    all: q.all,
    any: q.any,
    none: q.none,
    columnViewCache: q.columnViewCache,
    reactiveKind: 'exit',
    sourceQueryId: q.id,
    sourceQuery: q,
  }
  moduleQueryCache.set(key, reactive)
  return reactive
}

// --- Per-world query setup ---

function ensureQueryRegistered(state: WorldState, q: QueryInternal): void {
  if (state.queries[q.id] === q && state.queryMasks.has(q.id)) return

  // Build per-world bitmasks (this may register new bits)
  const ww = state.options.maskWordCount
  const withMask = createMask(ww)
  const anyMask = createMask(ww)
  const noneMask = createMask(ww)
  for (const compId of q.all) {
    const info = getComponentInfoById(compId)
    const bit = getOrRegisterComponentBit(state, info)
    setBit(withMask, bit)
  }
  for (const compId of q.any) {
    const info = getComponentInfoById(compId)
    const bit = getOrRegisterComponentBit(state, info)
    setBit(anyMask, bit)
  }
  for (const compId of q.none) {
    const info = getComponentInfoById(compId)
    const bit = getOrRegisterComponentBit(state, info)
    setBit(noneMask, bit)
  }

  const bundle: QueryMaskBundle = {
    withMask,
    anyMask,
    noneMask,
    anyHasBits: !isMaskZero(anyMask),
  }
  state.queryMasks.set(q.id, bundle)

  state.queries[q.id] = q
  state.queryArchetypeCache[q.id] = null
  state.queryArchetypeStamp[q.id] = -1

  // Build bit → queries index for fast reactive lookup
  const involvedBits: number[] = [
    ...listBits(withMask),
    ...listBits(anyMask),
    ...listBits(noneMask),
  ]
  for (const b of involvedBits) {
    let s = state.bitToQueries.get(b)
    if (!s) {
      s = new Set<number>()
      state.bitToQueries.set(b, s)
    }
    s.add(q.id)
  }

  // Initialize reactive buffer for enter/exit queries
  if (q.reactiveKind !== 'normal') {
    if (!state.reactiveBuffers.has(q.id)) {
      state.reactiveBuffers.set(q.id, { entered: [], exited: [] })
    }
    // Also register the source query so recordEntityMaskChange will see it
    if (q.sourceQuery) ensureQueryRegistered(state, q.sourceQuery)
  }
}

function getQueryArchetypes(state: WorldState, q: QueryInternal): number[] {
  ensureQueryRegistered(state, q)
  if (state.queryArchetypeCache[q.id] && state.queryArchetypeStamp[q.id] === state.queryVersion) {
    return state.queryArchetypeCache[q.id]!
  }
  const bundle = state.queryMasks.get(q.id)!
  const words = state.options.maskWordCount
  const list: number[] = []
  for (let i = 0; i < state.archetypes.length; i++) {
    const arch = state.archetypes[i]!
    if (
      matches(arch.mask, bundle.withMask, bundle.anyMask, bundle.noneMask, bundle.anyHasBits, words)
    ) {
      list.push(i)
    }
  }
  state.queryArchetypeCache[q.id] = list
  state.queryArchetypeStamp[q.id] = state.queryVersion
  return list
}

export function queryArchetypes(world: World, query: Query): readonly Archetype[] {
  const state = getWorldState(world)
  const q = query as QueryInternal
  const ids = getQueryArchetypes(state, q)
  const out: Archetype[] = []
  for (const id of ids) {
    const arch = state.archetypes[id]!
    out.push({ id: arch.id, mask: Array.from(arch.mask), size: arch.size })
  }
  return out
}

export function runQuery(world: World, query: Query): readonly EntityId[] {
  const state = getWorldState(world)
  const q = query as QueryInternal
  const out: EntityId[] = []
  if (q.reactiveKind === 'enter') {
    const buf = state.reactiveBuffers.get(q.id)
    if (buf) {
      for (const e of buf.entered) out.push(e as EntityId)
      buf.entered.length = 0
    }
    return out
  }
  if (q.reactiveKind === 'exit') {
    const buf = state.reactiveBuffers.get(q.id)
    if (buf) {
      for (const e of buf.exited) out.push(e as EntityId)
      buf.exited.length = 0
    }
    return out
  }
  const archIds = getQueryArchetypes(state, q)
  for (const id of archIds) {
    const arch = state.archetypes[id]!
    for (let r = 0; r < arch.size; r++) {
      out.push(arch.entities[r] as EntityId)
    }
  }
  return out
}

export function* iterQuery(world: World, query: Query): IterableIterator<EntityId> {
  const state = getWorldState(world)
  const q = query as QueryInternal
  if (q.reactiveKind !== 'normal') {
    const buf = state.reactiveBuffers.get(q.id)
    if (!buf) return
    const src = q.reactiveKind === 'enter' ? buf.entered : buf.exited
    for (const e of src) yield e as EntityId
    src.length = 0
    return
  }
  const archIds = getQueryArchetypes(state, q)
  for (const id of archIds) {
    const arch = state.archetypes[id]!
    for (let r = 0; r < arch.size; r++) {
      yield arch.entities[r] as EntityId
    }
  }
}

/**
 * Iterate every entity matching `query`, invoking `fn(e, ...cols)` once per row
 * with the packed {@link EntityId} and the query's SoA column views.
 *
 * **Caution — `e` is a packed EntityId, not a column subscript.** It carries the
 * generation in its high bits, so indexing a column view with it directly
 * (`pos.x[e]`) reads out of bounds once a slot has been recycled. Use `e` only
 * for identity operations (`destroyEntity` / `hasComponent` / `refOf`). To index
 * columns safely, prefer {@link forEachEntityIndexed} — which yields the masked
 * slot index `i` alongside `e` — or mask it yourself with {@link getEntityIndex}.
 *
 * @see {@link forEachEntityIndexed} — same iteration plus the safe column index `i`.
 * @see {@link getEntityIndex} — mask a packed EntityId to its raw slot index.
 */
export function forEachEntity(
  world: World,
  query: Query,
  fn: (eid: EntityId, ...cols: any[]) => void,
): void {
  const state = getWorldState(world)
  const q = query as QueryInternal

  if (q.reactiveKind !== 'normal') {
    const buf = state.reactiveBuffers.get(q.id)
    if (!buf) return
    const src = q.reactiveKind === 'enter' ? buf.entered : buf.exited
    if (src.length === 0) return
    const cols = buildColumnViews(state, q)
    for (let i = 0; i < src.length; i++) {
      const e = src[i] as EntityId
      callWithCols(fn, e, cols)
    }
    src.length = 0
    return
  }

  ensureQueryRegistered(state, q)
  const archIds = getQueryArchetypes(state, q)
  const cols = buildColumnViews(state, q)
  for (const id of archIds) {
    const arch = state.archetypes[id]!
    const ents = arch.entities
    // Re-read `arch.size` each iteration (do NOT cache it as `n`): an in-loop
    // `destroyEntity` swap-pops the visited row, shrinks `arch.size`, and zeroes
    // the freed tail slot. A cached bound would keep walking into those zeroed
    // tail rows and hand the callback the reserved sentinel eid 0 (ECS-B-01).
    // The swapped-in survivor is intentionally skipped this pass (deferred to the
    // next). This is a scalar property read — no per-iteration allocation, so the
    // zero-allocation hot-path contract holds. Mirrors runQuery (:230) / iterQuery.
    for (let r = 0; r < arch.size; r++) {
      callWithCols(fn, ents[r] as EntityId, cols)
    }
  }
}

function callWithCols(
  fn: (eid: EntityId, ...cols: any[]) => void,
  eid: EntityId,
  cols: any[],
): void {
  // Specialise for low arities to avoid spread allocation.
  switch (cols.length) {
    case 0:
      fn(eid)
      break
    case 1:
      fn(eid, cols[0])
      break
    case 2:
      fn(eid, cols[0], cols[1])
      break
    case 3:
      fn(eid, cols[0], cols[1], cols[2])
      break
    case 4:
      fn(eid, cols[0], cols[1], cols[2], cols[3])
      break
    case 5:
      fn(eid, cols[0], cols[1], cols[2], cols[3], cols[4])
      break
    default:
      fn(eid, ...cols)
  }
}

/**
 * Like {@link forEachEntity}, but yields the masked column index `i` alongside
 * the packed `EntityId`. The callback signature is `(e, i, ...cols)`:
 *
 *   - `e` — the packed EntityId (carries the generation in its high bits). Use
 *     it for in-loop `destroyEntity` / `hasComponent` / `refOf`, exactly as with
 *     `forEachEntity`.
 *   - `i` — `e & indexMask`, the raw slot index. This is the **correct subscript**
 *     for SoA column views (`pos.x[i]`), and stays correct after a slot is
 *     recycled — where indexing with the packed `e` would read out of bounds.
 *   - `...cols` — the same column views `forEachEntity` passes.
 *
 * This closes the packed-EntityId footgun (A1): callers no longer need to call
 * `getEntityIndex(e)` (or hand-mask) themselves to index columns safely.
 */
export function forEachEntityIndexed(
  world: World,
  query: Query,
  fn: (e: EntityId, i: number, ...cols: any[]) => void,
): void {
  const state = getWorldState(world)
  const q = query as QueryInternal
  const indexMask = state.options.indexMask

  if (q.reactiveKind !== 'normal') {
    const buf = state.reactiveBuffers.get(q.id)
    if (!buf) return
    const src = q.reactiveKind === 'enter' ? buf.entered : buf.exited
    if (src.length === 0) return
    const cols = buildColumnViews(state, q)
    for (let i = 0; i < src.length; i++) {
      const e = src[i] as EntityId
      callWithColsIndexed(fn, e, e & indexMask, cols)
    }
    src.length = 0
    return
  }

  ensureQueryRegistered(state, q)
  const archIds = getQueryArchetypes(state, q)
  const cols = buildColumnViews(state, q)
  for (const id of archIds) {
    const arch = state.archetypes[id]!
    const ents = arch.entities
    // Re-read `arch.size` each iteration — see forEachEntity for the rationale.
    // An in-loop `destroyEntity` swap-pops the row and zeroes the freed tail; a
    // cached bound would replay the sentinel eid 0 across the public boundary
    // (ECS-B-01). Scalar read only; the zero-allocation hot-path contract holds.
    for (let r = 0; r < arch.size; r++) {
      const e = ents[r] as EntityId
      callWithColsIndexed(fn, e, e & indexMask, cols)
    }
  }
}

function callWithColsIndexed(
  fn: (e: EntityId, i: number, ...cols: any[]) => void,
  e: EntityId,
  i: number,
  cols: any[],
): void {
  // Specialise for low arities to avoid spread allocation.
  switch (cols.length) {
    case 0:
      fn(e, i)
      break
    case 1:
      fn(e, i, cols[0])
      break
    case 2:
      fn(e, i, cols[0], cols[1])
      break
    case 3:
      fn(e, i, cols[0], cols[1], cols[2])
      break
    case 4:
      fn(e, i, cols[0], cols[1], cols[2], cols[3])
      break
    case 5:
      fn(e, i, cols[0], cols[1], cols[2], cols[3], cols[4])
      break
    default:
      fn(e, i, ...cols)
  }
}

function buildColumnViews(state: WorldState, q: QueryInternal): any[] {
  const out: any[] = []
  for (const comp of q.columnViewCache) {
    const info = getComponentInfo(comp)
    const bit = state.componentBitFor.get(info.id)
    if (bit === undefined) {
      out.push(undefined)
      continue
    }
    const storage = state.componentStorageByBit[bit]
    if (!storage) {
      out.push(undefined)
      continue
    }
    if (storage.kind === 'soa') out.push(storage.soa)
    else if (storage.kind === 'aos') out.push(storage.aos)
    else out.push(true) // tag
  }
  return out
}

// --- Reactive query updates (called from migration code) ---

export function recordEntityMaskChange(
  state: WorldState,
  eid: EntityId,
  changedBit: number,
  prevMask: Uint32Array,
  nextMask: Uint32Array,
): void {
  // Lazy-register any reactive queries (and their sources) so we can correctly
  // determine match transitions even if the user only ever called enterQuery/exitQuery.
  for (const q of moduleQueryCache.values()) {
    if (q.reactiveKind === 'normal') continue
    if (q.sourceQuery && state.queries[q.sourceQuery.id] !== q.sourceQuery) {
      ensureQueryRegistered(state, q.sourceQuery)
    }
  }

  const involved = state.bitToQueries.get(changedBit)
  if (!involved) return
  const words = state.options.maskWordCount
  for (const qid of involved) {
    const q = state.queries[qid]
    if (!q) continue
    if (q.reactiveKind !== 'normal') continue
    const bundle = state.queryMasks.get(qid)
    if (!bundle) continue
    const wasMatch = matches(
      prevMask,
      bundle.withMask,
      bundle.anyMask,
      bundle.noneMask,
      bundle.anyHasBits,
      words,
    )
    const isMatch = matches(
      nextMask,
      bundle.withMask,
      bundle.anyMask,
      bundle.noneMask,
      bundle.anyHasBits,
      words,
    )
    if (!wasMatch && isMatch) {
      pushReactive(state, qid, 'enter', eid)
    } else if (wasMatch && !isMatch) {
      pushReactive(state, qid, 'exit', eid)
    }
  }
}

function pushReactive(
  state: WorldState,
  queryId: number,
  kind: 'enter' | 'exit',
  eid: EntityId,
): void {
  // Walk the module cache (not just state.queries) so reactive variants that
  // haven't been registered with this world yet still receive events.
  for (const r of moduleQueryCache.values()) {
    if (r.sourceQueryId !== queryId) continue
    if (r.reactiveKind !== kind) continue
    // Lazily register the reactive query in this world so subsequent reads can find it
    ensureQueryRegistered(state, r)
    const buf = ensureReactiveBuffer(state, r.id)
    if (kind === 'enter') buf.entered.push(eid as number)
    else buf.exited.push(eid as number)
  }
}

function ensureReactiveBuffer(state: WorldState, qid: number): ReactiveBuffer {
  let buf = state.reactiveBuffers.get(qid)
  if (!buf) {
    buf = { entered: [], exited: [] }
    state.reactiveBuffers.set(qid, buf)
  }
  return buf
}

// --- Helpers ---

function getComponentInfoById(componentId: number): ComponentInfo {
  // We need access to the component registry's lookup by id. Re-import dynamically to avoid cycles.
  const info = lazyGetComponentInfo(componentId)
  if (!info) throw new Error(`aiecsjs: component id ${componentId} not registered`)
  return info
}

let _getComponentInfoFn: ((id: number) => ComponentInfo | undefined) | null = null
export function registerComponentLookup(fn: (id: number) => ComponentInfo | undefined): void {
  _getComponentInfoFn = fn
}
function lazyGetComponentInfo(id: number): ComponentInfo | undefined {
  return _getComponentInfoFn ? _getComponentInfoFn(id) : undefined
}

export function _resetQueryRegistry_FOR_TESTS_ONLY(): void {
  moduleQueryCache.clear()
  nextQueryId = 1
}
