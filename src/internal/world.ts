import { VERSION } from '../version.js'
import { cloneMask, createMask, maskHash } from './bitmask.js'
import { EcsError } from './errors.js'
import { ids, shared } from './registry.js'
import type {
  ArchetypeState,
  ComponentInfo,
  FieldInfo,
  ResolvedWorldOptions,
  SoAColumns,
  World,
  WorldComponentStorage,
  WorldOptions,
  WorldState,
} from './types.js'

export const WORLD_BRAND = Symbol.for('aiecsjs.world')

const DEFAULT_OPTIONS: Required<Omit<WorldOptions, 'buffer' | 'bufferByteOffset'>> = {
  initialCapacity: 1024,
  maxEntities: 1_000_000,
  indexBits: 24,
  generationBits: 8,
}

const DEFAULT_MAX_COMPONENTS = 256

// Shared across every loaded copy of the package (see registry.ts).
const worldRegistry = shared.worlds

// destroyWorld unregisters a world in the same call that marks it destroyed,
// so a registered state is always live. `world?.id` keeps a missing handle on
// the EcsError path instead of leaking a TypeError.
export function getWorldState(world: World): WorldState {
  const id = world?.id
  const state = worldRegistry.get(id)
  if (!state) throw new EcsError(`aiecsjs: world ${id} is destroyed or unknown`)
  return state
}

// getWorldState for a mutator: rejects a read-only (worker-attached) world.
export function getWritableState(world: World): WorldState {
  const state = getWorldState(world)
  if (state.readOnly) throw new EcsError('aiecsjs: cannot mutate a read-only world')
  return state
}

export function registerWorld(state: WorldState): void {
  worldRegistry.set(state.id, state)
}

export function unregisterWorld(id: number): void {
  worldRegistry.delete(id)
}

export function isWorldRegistered(id: number): boolean {
  return worldRegistry.has(id)
}

function resolveOptions(opts: WorldOptions | undefined): ResolvedWorldOptions {
  const o = opts ?? {}
  // Integer check first: a fractional / NaN / non-number value would otherwise
  // slip through the range checks below and silently truncate typed arrays.
  for (const name of Object.keys(DEFAULT_OPTIONS) as (keyof typeof DEFAULT_OPTIONS)[]) {
    const v = o[name]
    if (v !== undefined && !Number.isInteger(v)) {
      throw new EcsError(`aiecsjs: ${name} must be an integer`)
    }
  }
  const indexBits = o.indexBits ?? DEFAULT_OPTIONS.indexBits
  const generationBits = o.generationBits ?? DEFAULT_OPTIONS.generationBits
  const maxComponents = DEFAULT_MAX_COMPONENTS
  if (indexBits < 1 || indexBits > 24) {
    throw new EcsError('aiecsjs: indexBits must be in [1, 24]')
  }
  if (generationBits < 0 || generationBits > 16) {
    throw new EcsError('aiecsjs: generationBits must be in [0, 16]')
  }
  if (indexBits + generationBits > 32) {
    throw new EcsError(
      `aiecsjs: indexBits (${indexBits}) + generationBits (${generationBits}) must be <= 32`,
    )
  }
  const maxByIndex = 1 << indexBits
  const initialCapacity = Math.max(
    1,
    Math.min(o.initialCapacity ?? DEFAULT_OPTIONS.initialCapacity, maxByIndex),
  )
  const maxEntities = Math.max(
    initialCapacity,
    Math.min(o.maxEntities ?? DEFAULT_OPTIONS.maxEntities, maxByIndex),
  )
  return {
    initialCapacity,
    maxEntities,
    indexBits,
    generationBits,
    indexMask: (1 << indexBits) - 1,
    generationMask: generationBits === 0 ? 0 : (1 << generationBits) - 1,
    maxComponents,
    maskWordCount: Math.ceil(maxComponents / 32),
    buffer: o.buffer ?? null,
    bufferByteOffset: o.bufferByteOffset ?? 0,
  }
}

/**
 * Create an ECS world. `initialCapacity`, `maxEntities`, `indexBits` and
 * `generationBits` must be integers when given (`EcsError` otherwise); they are
 * then range-checked (`indexBits` 1–24, `generationBits` 0–16, sum <= 32) and
 * clamped (`initialCapacity` to [1, 2^indexBits], `maxEntities` to
 * [initialCapacity, 2^indexBits]).
 */
export function createWorld(options?: WorldOptions): World {
  const resolved = resolveOptions(options)
  const id = ids.world++

  const generationCtor = resolved.generationBits > 8 ? Uint16Array : Uint8Array
  const generations = new generationCtor(resolved.initialCapacity)

  const state: WorldState = {
    id,
    capacity: resolved.initialCapacity,
    version: VERSION,
    options: resolved,
    size: 0,
    nextFreshIndex: 1, // 0 reserved
    freeList: [],
    generations,
    destroyed: false,
    destroying: new Set<number>(),
    removing: new Set<number>(),
    visitStamp: new Uint32Array(0),
    visitEpoch: 0,
    componentBitFor: new Map<number, number>(),
    componentInfoByBit: new Array(resolved.maxComponents).fill(null),
    componentStorageByBit: new Array(resolved.maxComponents).fill(null),
    nextComponentBit: 0,
    entityArchetype: new Uint32Array(resolved.initialCapacity),
    entityMask: new Uint32Array(resolved.initialCapacity * resolved.maskWordCount),
    archetypes: [],
    archetypeByMaskHash: new Map<string, number>(),
    queryVersion: 0,
    queries: [],
    queryMasks: new Map(),
    queryArchetypeCache: [],
    queryArchetypeStamp: [],
    bitToQueries: new Map<number, Set<number>>(),
    reactiveBuffers: new Map(),
    observers: [],
    relationStorage: new Map(),
    sab: resolved.buffer,
    readOnly: false,
  }

  // Seed archetype 0 (the empty mask)
  findOrCreateArchetype(state, createMask(resolved.maskWordCount))

  registerWorld(state)
  return makePublicWorld(state)
}

export function makePublicWorld(state: WorldState): World {
  return {
    id: state.id,
    get capacity() {
      return state.capacity
    },
    version: state.version,
  } as World
}

export function destroyWorld(world: World): void {
  const state = worldRegistry.get(world?.id)
  if (!state || state.destroyed) return
  state.destroyed = true
  // Clear large buffers to help GC. Post-dispose ops already throw via
  // getWorldState (state.destroyed), so releasing internal state can't regress
  // live behaviour; the capacity getter closure in makePublicWorld is the only
  // thing pinning `state`, so we must drop the big per-entity arrays here or
  // they survive as long as the (typically retained) public world handle.
  state.archetypes = []
  state.archetypeByMaskHash.clear()
  state.componentInfoByBit = []
  state.componentStorageByBit = []
  state.queries = []
  state.queryMasks.clear()
  state.queryArchetypeCache = []
  state.observers = []
  state.relationStorage.clear()
  state.reactiveBuffers.clear()
  // Release the remaining large per-entity arrays / indices that the original
  // "clear large buffers" pass left allocated (these dominate memory for big
  // worlds). Swap to length-0 instances rather than mutating in place.
  state.entityMask = new Uint32Array(0)
  state.entityArchetype = new Uint32Array(0)
  state.visitStamp = new Uint32Array(0)
  state.generations = new Uint8Array(0)
  state.freeList = []
  state.destroying.clear()
  state.componentBitFor.clear()
  state.bitToQueries.clear()
  state.queryArchetypeStamp = []
  state.sab = null
  unregisterWorld(state.id)
}

/**
 * Wipe every entity, its component data and relation edges while keeping the
 * world's capacity and registered components (e.g. for hot module reload).
 * Throws `EcsError` on a read-only (worker-attached) world, like every other
 * mutator.
 */
export function resetWorld(world: World): void {
  const state = getWritableState(world)
  // Keep capacity and registered components; clear entities and per-entity state.
  state.size = 0
  state.nextFreshIndex = 1
  state.freeList = []
  // Abort any destroyEntity in flight (a teardown handler called resetWorld):
  // the outer call sees its eid gone from this set and skips its own teardown.
  state.destroying.clear()
  state.generations.fill(0)
  state.entityArchetype.fill(0)
  state.entityMask.fill(0)
  // Wipe archetype memberships but keep archetype graph for stability.
  for (const arch of state.archetypes) {
    arch.size = 0
    arch.entityRow.clear()
  }
  // Clear SoA columns and AoS instances; storage allocation is preserved.
  for (const storage of state.componentStorageByBit) {
    if (!storage) continue
    if (storage.kind === 'soa' && storage.soa) {
      for (const k of Object.keys(storage.soa)) {
        storage.soa[k]?.fill(0)
      }
    } else if (storage.kind === 'aos' && storage.aos) {
      storage.aos.fill(undefined as unknown as never)
    }
  }
  // Clear relation edges, exactly as destroyWorld does. relationStorage is keyed
  // by raw slot index; resetWorld restarts nextFreshIndex=1 and zeroes generations,
  // so recycled slots would otherwise inherit the prior occupant's relation edges
  // and data (C5). Storage is recreated lazily on the next addRelation.
  state.relationStorage.clear()
  state.queryVersion++
  for (const buf of state.reactiveBuffers.values()) {
    buf.entered.length = 0
    buf.exited.length = 0
  }
}

export function getWorldSize(world: World): number {
  return getWorldState(world).size
}

export function getWorldCapacity(world: World): number {
  return getWorldState(world).capacity
}

// --- Capacity growth ---

export function ensureCapacity(state: WorldState, needed: number): void {
  if (needed <= state.capacity) return
  if (needed > state.options.maxEntities) {
    throw new EcsError(
      `aiecsjs: requested capacity ${needed} exceeds maxEntities ${state.options.maxEntities}`,
    )
  }
  let newCap = state.capacity
  while (newCap < needed) newCap = Math.min(newCap * 2, state.options.maxEntities)
  growEntityArrays(state, newCap)
}

function growEntityArrays(state: WorldState, newCap: number): void {
  // generations
  const genCtor = state.generations.constructor as new (len: number) => Uint8Array | Uint16Array
  const newGen = new genCtor(newCap)
  ;(newGen as Uint8Array).set(state.generations as Uint8Array)
  state.generations = newGen

  // entityArchetype
  const newArch = new Uint32Array(newCap)
  newArch.set(state.entityArchetype)
  state.entityArchetype = newArch

  // entityMask
  const wordCount = state.options.maskWordCount
  const newMask = new Uint32Array(newCap * wordCount)
  newMask.set(state.entityMask)
  state.entityMask = newMask

  // visit stamps (allocated lazily by the first forEachEntity pass); copied so
  // a pass that grows the world mid-loop keeps its stamps
  if (state.visitStamp.length > 0) {
    const newStamp = new Uint32Array(newCap)
    newStamp.set(state.visitStamp)
    state.visitStamp = newStamp
  }

  // Component storages (SoA columns + AoS arrays)
  for (const storage of state.componentStorageByBit) {
    if (!storage) continue
    if (storage.kind === 'soa' && storage.soa) {
      const info = state.componentInfoByBit[storage.bit]
      if (info) growSoAColumns(storage.soa, info.fields, newCap)
    } else if (storage.kind === 'aos' && storage.aos) {
      storage.aos.length = newCap
    }
  }

  state.capacity = newCap
}

function growSoAColumns(soa: SoAColumns, fields: FieldInfo[], newCap: number): void {
  for (const f of fields) {
    const old = soa[f.name]
    if (!old) continue
    const newLen = newCap * f.vectorLen
    if (old.length >= newLen) continue
    const next = new f.ctor(newLen)
    next.set(old)
    soa[f.name] = next
  }
}

// --- Archetype management ---

export function findOrCreateArchetype(
  state: WorldState,
  mask: Uint32Array,
): { archId: number; created: boolean } {
  const key = maskHash(mask)
  const existing = state.archetypeByMaskHash.get(key)
  if (existing !== undefined) return { archId: existing, created: false }

  const id = state.archetypes.length
  const arch: ArchetypeState = {
    id,
    mask: cloneMask(mask),
    size: 0,
    capacity: 16,
    entities: new Uint32Array(16),
    entityRow: new Map<number, number>(),
  }
  state.archetypes.push(arch)
  state.archetypeByMaskHash.set(key, id)
  state.queryVersion++
  return { archId: id, created: true }
}

// Append `eid` as the last row of `arch`, doubling its row storage when full.
export function addRow(arch: ArchetypeState, eid: number): void {
  if (arch.size === arch.capacity) {
    arch.capacity *= 2
    const next = new Uint32Array(arch.capacity)
    next.set(arch.entities)
    arch.entities = next
  }
  arch.entities[arch.size] = eid
  arch.entityRow.set(eid, arch.size++)
}

// Swap-pop `eid`'s row out of `arch`: the last row moves into the freed one
// and the vacated tail slot is zeroed. No-op when `eid` has no row here.
export function removeRow(arch: ArchetypeState, eid: number): void {
  const row = arch.entityRow.get(eid)
  if (row === undefined) return
  const last = --arch.size
  const moved = arch.entities[last] ?? 0
  arch.entities[row] = moved
  arch.entityRow.set(moved, row)
  arch.entities[last] = 0
  arch.entityRow.delete(eid)
}

// --- Component registration in a world ---

export function getOrRegisterComponentBit(state: WorldState, info: ComponentInfo): number {
  const existing = state.componentBitFor.get(info.id)
  if (existing !== undefined) return existing

  if (state.nextComponentBit >= state.options.maxComponents) {
    throw new EcsError(`aiecsjs: world reached maxComponents=${state.options.maxComponents}`)
  }
  const bit = state.nextComponentBit++
  state.componentBitFor.set(info.id, bit)
  state.componentInfoByBit[bit] = info

  // Create storage
  let storage: WorldComponentStorage
  if (info.kind === 'soa') {
    const soa: SoAColumns = {}
    for (const f of info.fields) {
      soa[f.name] = new f.ctor(state.capacity * f.vectorLen)
    }
    storage = { kind: 'soa', componentId: info.id, bit, soa }
  } else if (info.kind === 'aos') {
    storage = { kind: 'aos', componentId: info.id, bit, aos: new Array(state.capacity) }
  } else {
    storage = { kind: 'tag', componentId: info.id, bit }
  }
  state.componentStorageByBit[bit] = storage
  return bit
}

// Read a bitmask out of state.entityMask[] into a fresh Uint32Array.
export function readEntityMask(state: WorldState, eid: number): Uint32Array {
  const w = state.options.maskWordCount
  const out = new Uint32Array(w)
  const idx = eid & state.options.indexMask
  const base = idx * w
  for (let i = 0; i < w; i++) out[i] = state.entityMask[base + i] ?? 0
  return out
}

export function writeEntityMask(state: WorldState, eid: number, mask: Uint32Array): void {
  const w = state.options.maskWordCount
  const idx = eid & state.options.indexMask
  const base = idx * w
  for (let i = 0; i < w; i++) state.entityMask[base + i] = mask[i] ?? 0
}

// Get the bit of a component within a world without registering.
export function tryGetComponentBit(state: WorldState, info: ComponentInfo): number | undefined {
  return state.componentBitFor.get(info.id)
}

export function isWorld(x: unknown): x is World {
  if (!x || typeof x !== 'object') return false
  const obj = x as { id?: unknown; version?: unknown }
  if (typeof obj.id !== 'number') return false
  if (typeof obj.version !== 'string') return false
  return worldRegistry.has(obj.id)
}
