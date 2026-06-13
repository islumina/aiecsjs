import { clearBit, cloneMask, forEachSetBit, setBit, testBit } from './bitmask.js'
import { isAliveInternal } from './entity.js'
import type {
  AoSComponent,
  ComponentInfo,
  ComponentInit,
  ComponentLike,
  EntityId,
  FieldInfo,
  SoAColumns,
  SoAComponent,
  SoAFieldDecl,
  SoAFieldType,
  SoASchema,
  TagComponent,
  TypedArrayConstructor,
  World,
  WorldComponentStorage,
  WorldState,
} from './types.js'
import {
  ensureArchetypeCapacity,
  findOrCreateArchetype,
  getOrRegisterComponentBit,
  getWorldState,
  readEntityMask,
  tryGetComponentBit,
  writeEntityMask,
} from './world.js'

// --- Component factories ---

let nextComponentId = 1

const TYPE_CTOR: Record<string, TypedArrayConstructor> = {
  i8: Int8Array,
  u8: Uint8Array,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  eid: Uint32Array,
  bool: Uint8Array,
}

const componentInfoById = new Map<number, ComponentInfo>()

export function defineComponent<S extends SoASchema>(schema: S): SoAComponent<S> {
  const fields: FieldInfo[] = []
  for (const [name, decl] of Object.entries(schema) as [string, SoAFieldDecl][]) {
    let type: SoAFieldType
    let vectorLen = 1
    if (typeof decl === 'string') {
      type = decl
    } else if (Array.isArray(decl)) {
      const [t, len] = decl
      type = t
      vectorLen = len
    } else {
      throw new TypeError(`aiecsjs: invalid field declaration for "${name}"`)
    }
    const ctor = TYPE_CTOR[type]
    if (!ctor) throw new TypeError(`aiecsjs: unknown field type "${type}" for field "${name}"`)
    fields.push({
      name,
      type,
      vectorLen,
      ctor,
      bytesPerElement: ctor.BYTES_PER_ELEMENT,
    })
  }
  const id = nextComponentId++
  const info: ComponentInfo = { id, kind: 'soa', schema, fields, factory: null }
  componentInfoById.set(id, info)
  const handle: SoAComponent<S> = {
    __kind: 'soa',
    __id: id,
    __schema: schema,
  }
  return handle
}

export function defineTag(): TagComponent {
  const id = nextComponentId++
  const info: ComponentInfo = { id, kind: 'tag', schema: null, fields: [], factory: null }
  componentInfoById.set(id, info)
  return { __kind: 'tag', __id: id }
}

export function defineObjectComponent<T>(factory?: () => T): AoSComponent<T> {
  const id = nextComponentId++
  const fac = factory ?? (() => ({}) as T)
  const info: ComponentInfo = {
    id,
    kind: 'aos',
    schema: null,
    fields: [],
    factory: fac as () => unknown,
  }
  componentInfoById.set(id, info)
  return { __kind: 'aos', __id: id, __factory: fac }
}

export function getComponentInfo(component: ComponentLike): ComponentInfo {
  const info = componentInfoById.get(component.__id)
  if (!info)
    throw new Error(
      'aiecsjs: component is not registered (call defineComponent/defineTag/defineObjectComponent)',
    )
  return info
}

// --- Component ops on entities ---

export function addComponent<C extends ComponentLike>(
  world: World,
  eid: EntityId,
  component: C,
  initial?: ComponentInit<C>,
): void {
  const state = getWorldState(world)
  if (state.readOnly) throw new Error('aiecsjs: cannot mutate a read-only world')
  if (!isAliveInternal(state, eid)) {
    throw new Error(`aiecsjs: addComponent on dead entity ${eid}`)
  }
  const info = getComponentInfo(component)
  const bit = getOrRegisterComponentBit(state, info)

  const prevMask = readEntityMask(state, eid)
  if (testBit(prevMask, bit)) {
    if (initial !== undefined) writeInitial(state, eid as number, component, initial)
    return
  }
  const newMask = cloneMask(prevMask)
  setBit(newMask, bit)
  migrateEntity(state, eid as number, newMask)

  writeInitial(state, eid as number, component, initial)

  fireAddObservers(state, eid, bit)
  notifyMaskChange(state, eid, bit, prevMask, newMask)
}

export function removeComponent<C extends ComponentLike>(
  world: World,
  eid: EntityId,
  component: C,
): void {
  const state = getWorldState(world)
  if (state.readOnly) throw new Error('aiecsjs: cannot mutate a read-only world')
  if (!isAliveInternal(state, eid)) return
  const info = getComponentInfo(component)
  const bit = tryGetComponentBit(state, info)
  if (bit === undefined) return
  const prevMask = readEntityMask(state, eid)
  if (!testBit(prevMask, bit)) return

  // Write the new mask BEFORE firing observers so query-targeted observers
  // reading `state.entityMask` see the post-removal state (and thus correctly
  // detect "entity left this query"). Without this reorder, a query that
  // requires the removed component would still match during dispatch and the
  // remove observer would never fire. Component-targeted observers receive the
  // bit directly and don't depend on mask timing. addComponent already follows
  // this "mutate then fire" order; keeping removeComponent consistent.
  const newMask = cloneMask(prevMask)
  clearBit(newMask, bit)
  migrateEntity(state, eid as number, newMask)

  fireRemoveObservers(state, eid, bit)

  const idx = (eid as number) & state.options.indexMask
  const storage = state.componentStorageByBit[bit]
  if (storage?.kind === 'soa' && storage.soa) {
    clearSoAEntity(storage.soa, info.fields, idx)
  } else if (storage?.kind === 'aos' && storage.aos) {
    storage.aos[idx] = undefined
  }

  notifyMaskChange(state, eid, bit, prevMask, newMask)
}

export function hasComponent<C extends ComponentLike>(
  world: World,
  eid: EntityId,
  component: C,
): boolean {
  const state = getWorldState(world)
  if (!isAliveInternal(state, eid)) return false
  const info = getComponentInfo(component)
  const bit = tryGetComponentBit(state, info)
  if (bit === undefined) return false
  const mask = readEntityMask(state, eid)
  return testBit(mask, bit)
}

export function getComponent<C extends ComponentLike>(
  world: World,
  eid: EntityId,
  component: C,
): unknown {
  const state = getWorldState(world)
  if (!isAliveInternal(state, eid)) return undefined
  const info = getComponentInfo(component)
  const bit = tryGetComponentBit(state, info)
  if (bit === undefined) return undefined
  const mask = readEntityMask(state, eid)
  if (!testBit(mask, bit)) return undefined
  const storage = state.componentStorageByBit[bit]
  if (!storage) return undefined
  if (storage.kind === 'soa') return storage.soa
  if (storage.kind === 'aos') {
    const idx = (eid as number) & state.options.indexMask
    return storage.aos?.[idx]
  }
  return true // tag
}

export function setComponent<C extends ComponentLike, V>(
  world: World,
  eid: EntityId,
  component: C,
  value: V,
): void {
  const state = getWorldState(world)
  if (state.readOnly) throw new Error('aiecsjs: cannot mutate a read-only world')
  if (!isAliveInternal(state, eid)) throw new Error(`aiecsjs: setComponent on dead entity ${eid}`)
  const info = getComponentInfo(component)
  const bit = tryGetComponentBit(state, info)
  if (bit === undefined) {
    // Adding via set
    addComponent(world, eid, component, value as ComponentInit<C>)
    return
  }
  const mask = readEntityMask(state, eid)
  if (!testBit(mask, bit)) {
    addComponent(world, eid, component, value as ComponentInit<C>)
    return
  }
  writeInitial(state, eid as number, component, value)
  fireSetObservers(state, eid, bit, value)
}

// --- Internals ---

function writeInitial(
  state: WorldState,
  packedEid: number,
  component: ComponentLike,
  initial: unknown,
): void {
  const info = getComponentInfo(component)
  const bit = state.componentBitFor.get(info.id)
  if (bit === undefined) return
  const storage = state.componentStorageByBit[bit]
  if (!storage) return
  // Unpack to raw index for storage access
  const idx = packedEid & state.options.indexMask
  if (info.kind === 'soa' && storage.soa) {
    if (initial == null) return
    const obj = initial as Record<string, unknown>
    for (const f of info.fields) {
      if (!(f.name in obj)) continue
      const col = storage.soa[f.name]
      if (!col) continue
      const val = obj[f.name]
      if (f.vectorLen === 1) {
        col[idx] = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val)
      } else if (Array.isArray(val) || ArrayBuffer.isView(val)) {
        const base = idx * f.vectorLen
        const arr = val as ArrayLike<number>
        for (let i = 0; i < f.vectorLen; i++) col[base + i] = Number(arr[i] ?? 0)
      }
    }
  } else if (info.kind === 'aos' && storage.aos) {
    const factory = info.factory ?? (() => ({}))
    let inst = storage.aos[idx]
    if (inst === undefined) {
      inst = factory()
      storage.aos[idx] = inst
    }
    if (initial && typeof initial === 'object') {
      // SECURITY: do NOT use `Object.assign(inst, initial)` here. When `initial`
      // comes from `JSON.parse(untrustedBytes)` — e.g. via `fromJSON`,
      // `deserializeWorld`, or app code piping a bridge payload — the parsed
      // object can carry an OWN `__proto__` property, and `Object.assign` uses
      // [[Set]] semantics which would trigger the proto setter and clobber the
      // instance's prototype chain. Explicit own-key copy with a deny-list
      // closes the prototype-pollution path.
      const src = initial as Record<string, unknown>
      const target = inst as Record<string, unknown>
      for (const key of Object.keys(src)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        target[key] = src[key]
      }
    }
  }
  // tag: nothing
}

function clearSoAEntity(soa: SoAColumns, fields: FieldInfo[], eid: number): void {
  for (const f of fields) {
    const col = soa[f.name]
    if (!col) continue
    if (f.vectorLen === 1) {
      col[eid] = 0
    } else {
      const base = eid * f.vectorLen
      for (let i = 0; i < f.vectorLen; i++) col[base + i] = 0
    }
  }
}

// Clear every component-storage slot that the entity currently owns.
// Walks the entity's mask; for each set bit, zeroes the SoA columns or
// undefines the AoS slot at the entity index. Tag storages are bit-only.
// Caller (e.g. destroyEntity) is expected to clear the mask separately.
export function clearAllEntityStorages(state: WorldState, eid: EntityId): void {
  const wordCount = state.options.maskWordCount
  const idx = (eid as number) & state.options.indexMask
  const base = idx * wordCount
  forEachSetBit(state.entityMask, base, wordCount, (bit) => {
    const storage = state.componentStorageByBit[bit]
    const info = state.componentInfoByBit[bit]
    if (storage?.kind === 'soa' && storage.soa && info) {
      clearSoAEntity(storage.soa, info.fields, idx)
    } else if (storage?.kind === 'aos' && storage.aos) {
      storage.aos[idx] = undefined
    }
  })
}

function migrateEntity(state: WorldState, packedEid: number, newMask: Uint32Array): void {
  // Unpack to raw index for sparse-array lookups
  const idx = packedEid & state.options.indexMask
  const srcArchId = state.entityArchetype[idx] ?? 0
  const srcArch = state.archetypes[srcArchId]
  if (!srcArch) return

  const found = findOrCreateArchetype(state, newMask)
  const destArchId = found.archId
  const destArch = state.archetypes[destArchId]
  if (!destArch) return

  if (destArchId !== srcArchId) {
    // Swap-pop from src (arch.entities / entityRow use packed eid as key)
    const row = srcArch.entityRow.get(packedEid)
    if (row !== undefined) {
      const lastRow = srcArch.size - 1
      if (row !== lastRow) {
        const moved = srcArch.entities[lastRow] ?? 0
        srcArch.entities[row] = moved
        srcArch.entityRow.set(moved, row)
      }
      srcArch.entities[lastRow] = 0
      srcArch.entityRow.delete(packedEid)
      srcArch.size--
    }

    // Append to dest (store packed eid)
    ensureArchetypeCapacity(destArch, destArch.size + 1)
    const newRow = destArch.size
    destArch.entities[newRow] = packedEid
    destArch.entityRow.set(packedEid, newRow)
    destArch.size++

    state.entityArchetype[idx] = destArchId
  }

  writeEntityMask(state, packedEid, newMask)
}

// --- Observer dispatch (lazy-bound) ---

interface ObserversDispatchAPI {
  fireAdd(state: WorldState, eid: EntityId, bit: number): void
  fireRemove(state: WorldState, eid: EntityId, bit: number): void
  fireSet(state: WorldState, eid: EntityId, bit: number, value: unknown): void
}
let _dispatch: ObserversDispatchAPI = {
  fireAdd: () => {},
  fireRemove: () => {},
  fireSet: () => {},
}

type MaskChangeFn = (
  state: WorldState,
  eid: EntityId,
  bit: number,
  prev: Uint32Array,
  next: Uint32Array,
) => void
let _maskChange: MaskChangeFn = () => {}
export function registerMaskChangeDispatch(fn: MaskChangeFn): void {
  _maskChange = fn
}
function notifyMaskChange(
  state: WorldState,
  eid: number,
  bit: number,
  prev: Uint32Array,
  next: Uint32Array,
): void {
  _maskChange(state, eid as EntityId, bit, prev, next)
}

// Fire the reactive enter/exit mask-change notification for an entity being
// destroyed. destroyEntity clears the entity's mask wholesale rather than
// removing components one-by-one, so it never reaches removeComponent's
// `notifyMaskChange` call — leaving exitQuery buffers empty on destroy while a
// component-by-component teardown would have populated them (asymmetric with
// observe(q,'remove')). We replay the removals here.
//
// CORRECTNESS: transition ONE bit at a time through evolving masks, exactly as a
// sequence of removeComponent() calls would. Passing a single (prevMask, empty)
// pair once per set bit double-counts — a query matching on several of the
// entity's components would see wasMatch=true,isMatch=false on every bit and push
// the same exit N times. Clearing bits incrementally flips wasMatch=false after
// the first component that breaks each query's match, so every query records
// exactly one exit.
//
// SNAPSHOT DISCIPLINE: `prevMask` is captured at destroy entry (a private copy,
// same discipline as dispatchDestroyObservers' preMask) so reentrant handlers
// run earlier in destroy cannot mutate live state and suppress the exit. We
// iterate that snapshot and mutate only our own clones.
export function dispatchDestroyMaskChange(
  state: WorldState,
  eid: EntityId,
  prevMask: Uint32Array,
): void {
  const w = state.options.maskWordCount
  const before = cloneMask(prevMask) // current bit still set
  const after = cloneMask(prevMask) // current bit cleared
  forEachSetBit(prevMask, 0, w, (bit) => {
    clearBit(after, bit)
    notifyMaskChange(state, eid as number, bit, before, after)
    clearBit(before, bit)
  })
}
export function registerObserverDispatch(api: ObserversDispatchAPI): void {
  _dispatch = api
}
function fireAddObservers(state: WorldState, eid: number, bit: number): void {
  _dispatch.fireAdd(state, eid as EntityId, bit)
}
function fireRemoveObservers(state: WorldState, eid: number, bit: number): void {
  _dispatch.fireRemove(state, eid as EntityId, bit)
}
function fireSetObservers(state: WorldState, eid: number, bit: number, value: unknown): void {
  _dispatch.fireSet(state, eid as EntityId, bit, value)
}

// --- Helper for serialize/worker ---

export function getComponentByInternalId(id: number): ComponentInfo | undefined {
  return componentInfoById.get(id)
}

export function listAllComponents(): ComponentInfo[] {
  return Array.from(componentInfoById.values())
}

export function _resetComponentRegistry_FOR_TESTS_ONLY(): void {
  componentInfoById.clear()
  nextComponentId = 1
}
