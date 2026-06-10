import { VERSION } from '../version.js'
import { cloneMask, copyMask, createMask, maskHash } from './bitmask.js'
import { EcsError } from './errors.js'
import type {
  ArchetypeState,
  ComponentInfo,
  FieldInfo,
  ResolvedWorldOptions,
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

let nextWorldId = 1
const worldRegistry = new Map<number, WorldState>()

export function getWorldState(world: World): WorldState {
  const state = worldRegistry.get(world.id)
  if (!state) throw new EcsError(`aiecsjs: world ${world.id} is destroyed or unknown`)
  if (state.destroyed) throw new EcsError(`aiecsjs: world ${world.id} is destroyed`)
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

export function createEmptyArchetype(maskWordCount: number, maxComponents: number): ArchetypeState {
  return {
    id: 0,
    mask: createMask(maskWordCount),
    size: 0,
    capacity: 16,
    entities: new Uint32Array(16),
    entityRow: new Map<number, number>(),
    componentBits: [],
    edgeAdd: new Int32Array(maxComponents).fill(-1),
    edgeRemove: new Int32Array(maxComponents).fill(-1),
  }
}

export function createWorld(options?: WorldOptions): World {
  const resolved = resolveOptions(options)
  const id = nextWorldId++

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
  const empty = createEmptyArchetype(resolved.maskWordCount, resolved.maxComponents)
  empty.id = 0
  state.archetypes.push(empty)
  state.archetypeByMaskHash.set(maskHash(empty.mask), 0)

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
  const state = worldRegistry.get(world.id)
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
  state.generations = new Uint8Array(0)
  state.freeList = []
  state.componentBitFor.clear()
  state.bitToQueries.clear()
  state.queryArchetypeStamp = []
  state.sab = null
  unregisterWorld(world.id)
}

export function resetWorld(world: World): void {
  const state = getWorldState(world)
  // Keep capacity and registered components; clear entities and per-entity state.
  state.size = 0
  state.nextFreshIndex = 1
  state.freeList = []
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
  const genCtor: any = state.generations.constructor
  const newGen = new genCtor(newCap) as Uint8Array | Uint16Array
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

function growSoAColumns(soa: Record<string, any>, fields: FieldInfo[], newCap: number): void {
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
    componentBits: collectBits(mask),
    edgeAdd: new Int32Array(state.options.maxComponents).fill(-1),
    edgeRemove: new Int32Array(state.options.maxComponents).fill(-1),
  }
  state.archetypes.push(arch)
  state.archetypeByMaskHash.set(key, id)
  state.queryVersion++
  return { archId: id, created: true }
}

export function ensureArchetypeCapacity(arch: ArchetypeState, needed: number): void {
  if (needed <= arch.capacity) return
  let newCap = arch.capacity
  while (newCap < needed) newCap *= 2
  const next = new Uint32Array(newCap)
  next.set(arch.entities)
  arch.entities = next
  arch.capacity = newCap
}

function collectBits(mask: Uint32Array): number[] {
  const bits: number[] = []
  for (let w = 0; w < mask.length; w++) {
    let word = mask[w] ?? 0
    while (word !== 0) {
      const lsb = word & -word
      const bit = (w << 5) + (31 - Math.clz32(lsb))
      bits.push(bit)
      word &= word - 1
    }
  }
  return bits
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
    const soa: Record<string, any> = {}
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
