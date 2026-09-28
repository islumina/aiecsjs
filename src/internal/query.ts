import { createMask, isMaskZero, listBits, matches, setBit } from './bitmask.js'
import {
  getComponentByInternalId,
  getComponentInfo,
  registerMaskChangeDispatch,
} from './component.js'
import { isAliveInternal } from './entity.js'
import { ids, shared } from './registry.js'
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

// Shared across every loaded copy of the package (see registry.ts).
const moduleQueryCache = shared.queryCache
const reactiveBySource = shared.reactiveBySource
const reactiveSourcesByComponent = shared.reactiveSourcesByComponent

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
    id: ids.query++,
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

/**
 * Reactive "entered" view of `query`: each read drains the entities that began
 * matching since the last read (via `runQuery` / `iterQuery` / `forEachEntity`).
 *
 * **MUST-DRAIN CONTRACT (unbounded buffer).** The enter buffer has **no cap**.
 * Every structural change that makes an entity newly match pushes one id; the
 * buffer only shrinks when you read the reactive view. A view that is created
 * but never read — e.g. a disabled system, or reading only the {@link exitQuery}
 * twin — accumulates one number per event **forever**, an unbounded memory leak
 * at churn rates (e.g. ~1k spawns/frame). Read every enter view you create, once
 * per frame. Dropping ids silently would corrupt enter/exit symmetry, so capping
 * is intentionally not done — draining is the caller's responsibility.
 */
export function enterQuery(query: Query): Query {
  const q = query as QueryInternal
  const key = `enter:${q.id}`
  const cached = moduleQueryCache.get(key)
  if (cached) return cached
  const reactive: QueryInternal = {
    id: ids.query++,
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
  indexReactive(q, reactive)
  return reactive
}

/**
 * Reactive "exited" view of `query`: each read drains the entities that stopped
 * matching since the last read (via `runQuery` / `iterQuery` / `forEachEntity`).
 *
 * **MUST-DRAIN CONTRACT (unbounded buffer).** The exit buffer has **no cap** —
 * same discipline as {@link enterQuery}. An unread exit view accumulates one id
 * per matching structural change (including every `destroyEntity` of a matching
 * entity) without bound. Read every exit view you create, once per frame. Capping
 * is intentionally not done because dropping ids would break enter/exit symmetry.
 */
export function exitQuery(query: Query): Query {
  const q = query as QueryInternal
  const key = `exit:${q.id}`
  const cached = moduleQueryCache.get(key)
  if (cached) return cached
  const reactive: QueryInternal = {
    id: ids.query++,
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
  indexReactive(q, reactive)
  return reactive
}

// Index a new enter/exit variant so structural changes find it without
// scanning the module query cache: by its source query (pushReactive) and, on
// the source's first variant, by every component the source references
// (recordEntityMaskChange).
function indexReactive(source: QueryInternal, reactive: QueryInternal): void {
  const variants = reactiveBySource.get(source.id)
  if (variants) {
    variants.push(reactive)
    return
  }
  reactiveBySource.set(source.id, [reactive])
  for (const id of new Set([...source.all, ...source.any, ...source.none])) {
    const list = reactiveSourcesByComponent.get(id)
    if (list) list.push(source)
    else reactiveSourcesByComponent.set(id, [source])
  }
}

// Normalise the query argument of the read/iterate entry points. A raw
// component array (`forEachEntity(world, [A, B], fn)`) is routed through
// defineQuery; anything else that is not a Query throws instead of silently
// iterating nothing (the reactive branch would look up an undefined buffer).
function asQueryInternal(query: Query): QueryInternal {
  if (Array.isArray(query)) return defineQuery(query as ComponentLike[]) as QueryInternal
  const q = query as QueryInternal
  const kind = q?.reactiveKind
  if (kind !== 'normal' && kind !== 'enter' && kind !== 'exit') {
    throw new TypeError('aiecsjs: expected a Query')
  }
  return q
}

// --- Per-world query setup ---

export function ensureQueryRegistered(state: WorldState, q: QueryInternal): void {
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
  const q = asQueryInternal(query)
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
  const q = asQueryInternal(query)
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
  const q = asQueryInternal(query)
  if (q.reactiveKind !== 'normal') {
    const buf = state.reactiveBuffers.get(q.id)
    if (!buf) return
    // Detach the buffer up front (swap in a fresh array) instead of clearing
    // it after the loop completes, so an early `break` still drains exactly
    // once instead of re-delivering the same entities on the next read.
    let src: number[]
    if (q.reactiveKind === 'enter') {
      src = buf.entered
      buf.entered = []
    } else {
      src = buf.exited
      buf.exited = []
    }
    for (const e of src) yield e as EntityId
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
  const q = asQueryInternal(query)

  if (q.reactiveKind !== 'normal') {
    const buf = state.reactiveBuffers.get(q.id)
    if (!buf) return
    // Detach the buffer before calling back, so a callback that throws
    // partway through still leaves the buffer drained — the already-processed
    // prefix is not re-delivered on the next read.
    let src: number[]
    if (q.reactiveKind === 'enter') {
      src = buf.entered
      buf.entered = []
    } else {
      src = buf.exited
      buf.exited = []
    }
    if (src.length === 0) return
    const cols = buildColumnViews(state, q)
    for (let i = 0; i < src.length; i++) {
      const e = src[i] as EntityId
      callWithCols(fn, e, cols)
    }
    return
  }

  ensureQueryRegistered(state, q)
  const archIds = getQueryArchetypes(state, q)
  const cols = buildColumnViews(state, q)
  const indexMask = state.options.indexMask
  const stamp = beginVisitPass(state)
  for (const id of archIds) {
    const arch = state.archetypes[id]!
    // Re-read `arch.size` AND `arch.entities` each iteration (do NOT cache either):
    //   - `arch.size`: an in-loop `destroyEntity` swap-pops the visited row, shrinks
    //     `arch.size`, and zeroes the freed tail slot. A cached bound would keep
    //     walking into those zeroed tail rows and hand back the sentinel eid 0
    //     (ECS-B-01). The swapped-in survivor is intentionally skipped this pass.
    //   - `arch.entities`: an in-loop create (createEntity / addComponent landing in
    //     this archetype) can grow it past capacity, so ensureArchetypeCapacity
    //     swaps in a NEW, larger Uint32Array. A cached reference would still point at
    //     the OLD shorter array, so its tail rows read `undefined` (C4) — the
    //     sentinel leaking across the public callback boundary again.
    // Both are scalar property reads — no per-iteration allocation, so the
    // zero-allocation hot-path contract holds. Mirrors runQuery (:230) / iterQuery.
    // In-loop add/removeComponent moves (see revisitRow) are handled so every
    // matching live entity is visited exactly once per pass.
    for (let r = 0; r < arch.size; r++) {
      const e = arch.entities[r] as EntityId
      const idx = e & indexMask
      if (state.visitStamp[idx] === stamp) continue
      state.visitStamp[idx] = stamp
      callWithCols(fn, e, cols)
      if (revisitRow(state, arch.entities[r], e)) r--
    }
  }
}

// Stamp one forEachEntity pass. visitStamp[idx] === stamp marks an entity the
// pass already visited, so one that an in-loop add/removeComponent moves into
// an archetype later in the pass is not visited twice. A nested pass takes a
// fresh stamp; the outer pass then merely loses that dedup for the entities
// the inner pass touched. No per-pass allocation after the first.
function beginVisitPass(state: WorldState): number {
  // First pass in this world, or the stamp counter is about to wrap: start
  // from a zeroed array.
  if (state.visitStamp.length < state.capacity || state.visitEpoch === 0xffffffff) {
    state.visitStamp = new Uint32Array(state.capacity)
    state.visitEpoch = 0
  }
  return ++state.visitEpoch
}

// After the callback for `e` at row r: if an in-loop add/removeComponent moved
// the still-live `e` out of this archetype, the swap-pop put an unvisited
// entity into row r — revisit it. After an in-loop destroyEntity the
// swapped-in survivor is still deferred to the next pass (ECS-B-01).
function revisitRow(state: WorldState, current: number | undefined, e: EntityId): boolean {
  return current !== e && isAliveInternal(state, e)
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
  const q = asQueryInternal(query)
  const indexMask = state.options.indexMask

  if (q.reactiveKind !== 'normal') {
    const buf = state.reactiveBuffers.get(q.id)
    if (!buf) return
    // Detach the buffer before calling back — see forEachEntity.
    let src: number[]
    if (q.reactiveKind === 'enter') {
      src = buf.entered
      buf.entered = []
    } else {
      src = buf.exited
      buf.exited = []
    }
    if (src.length === 0) return
    const cols = buildColumnViews(state, q)
    for (let i = 0; i < src.length; i++) {
      const e = src[i] as EntityId
      callWithColsIndexed(fn, e, e & indexMask, cols)
    }
    return
  }

  ensureQueryRegistered(state, q)
  const archIds = getQueryArchetypes(state, q)
  const cols = buildColumnViews(state, q)
  const stamp = beginVisitPass(state)
  for (const id of archIds) {
    const arch = state.archetypes[id]!
    // Re-read `arch.size` AND `arch.entities` each iteration — see forEachEntity
    // for the rationale. An in-loop `destroyEntity` swap-pops the row and zeroes
    // the freed tail; an in-loop create can reallocate `arch.entities`. A cached
    // bound replays the sentinel eid 0, and a cached array reads `undefined` off
    // its stale tail — there `undefined & indexMask === 0`, so a bogus i=0 payload
    // leaks too (C4 / ECS-B-01). Scalar reads only; zero-allocation contract holds.
    // Visit stamps / revisitRow: see forEachEntity.
    for (let r = 0; r < arch.size; r++) {
      const e = arch.entities[r] as EntityId
      const idx = e & indexMask
      if (state.visitStamp[idx] === stamp) continue
      state.visitStamp[idx] = stamp
      callWithColsIndexed(fn, e, idx, cols)
      if (revisitRow(state, arch.entities[r], e)) r--
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
  // Lazy-register the sources of reactive queries that reference the changed
  // component, so match transitions are tracked even if the user only ever
  // called enterQuery/exitQuery. Only sources that can match in this world
  // are registered: one whose `all` (or entire `any`) components this world
  // has never registered cannot match any of its entities, and registering it
  // would allocate storage (and burn component bits) for foreign components.
  // It is picked up by a later change once those components exist here.
  const changedId = state.componentInfoByBit[changedBit]?.id
  const sources = changedId === undefined ? undefined : reactiveSourcesByComponent.get(changedId)
  if (sources) {
    for (const src of sources) {
      if (state.queries[src.id] === src) continue
      if (canMatchIn(state, src)) ensureQueryRegistered(state, src)
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
  // Use the module-wide variant index (not just state.queries) so reactive
  // variants that haven't been registered with this world yet still receive events.
  const variants = reactiveBySource.get(queryId)
  if (!variants) return
  for (const r of variants) {
    if (r.reactiveKind !== kind) continue
    // Lazily register the reactive query in this world so subsequent reads can find it
    ensureQueryRegistered(state, r)
    const buf = ensureReactiveBuffer(state, r.id)
    if (kind === 'enter') buf.entered.push(eid as number)
    else buf.exited.push(eid as number)
  }
}

// Whether any entity of this world could match `q` given the components the
// world has registered: every `all` component, and at least one `any`
// component when `any` is non-empty. (`none` components need not exist.)
function canMatchIn(state: WorldState, q: QueryInternal): boolean {
  for (const id of q.all) if (!state.componentBitFor.has(id)) return false
  if (q.any.length === 0) return true
  for (const id of q.any) if (state.componentBitFor.has(id)) return true
  return false
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
  const info = getComponentByInternalId(componentId)
  if (!info) throw new Error(`aiecsjs: component id ${componentId} not registered`)
  return info
}

// Wire component mask-change → query reactive update. This lives here rather
// than in index.ts: the package declares `sideEffects: false`, so a bundler may
// drop index.js when a consumer imports only re-exported names. Every reactive
// query is created through this module, so registering here guarantees the
// hook is live whenever a reactive buffer can exist.
registerMaskChangeDispatch(recordEntityMaskChange)

export function _resetQueryRegistry_FOR_TESTS_ONLY(): void {
  moduleQueryCache.clear()
  reactiveBySource.clear()
  reactiveSourcesByComponent.clear()
  ids.query = 1
}
