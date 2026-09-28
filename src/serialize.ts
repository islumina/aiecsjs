// aiecsjs/serialize — binary, JSON, and delta serializers.

import { testBit } from './internal/bitmask.js'
import {
  addComponent,
  defineComponent,
  defineObjectComponent,
  defineTag,
  getComponentByInternalId,
  getComponentInfo,
} from './internal/component.js'
import { createEntity, destroyEntity, ensureEntityAtSlot, packEid } from './internal/entity.js'
import type {
  ComponentInfo,
  ComponentInit,
  ComponentLike,
  DeltaSerializer,
  DeserializeOptions,
  EntityId,
  SerializeOptions,
  World,
  WorldOptions,
  WorldSnapshot,
} from './internal/types.js'
import { createWorld, getWorldState } from './internal/world.js'
import { VERSION } from './version.js'

const MAGIC = 'AIEC'
const FORMAT_VERSION = 1

export function serializeWorld(world: World, options?: SerializeOptions): Uint8Array {
  return packBinary(snapshotWorld(world, allowlistOf(options?.components)))
}

export function deserializeWorld(bytes: Uint8Array, options?: DeserializeOptions): World {
  const snapshot = unpackBinary(bytes, options)
  const allow = allowlistOf(options?.components)
  if (allow) {
    snapshot.entities = snapshot.entities.map((e) => ({
      eid: e.eid,
      components: e.components.filter((c) => allow.has(c.id)),
    }))
  }
  return fromJSON(snapshot)
}

// `options.components` allowlist as a set of component ids; null = everything.
function allowlistOf(components: ComponentLike[] | undefined): Set<number> | null {
  return components ? new Set(components.map((c) => c.__id)) : null
}

/**
 * Serialize a world snapshot to a plain JSON-compatible object.
 *
 * AoS component data is deep-copied (`structuredClone`), so the snapshot never
 * aliases live component instances; AoS values must therefore be cloneable.
 *
 * Note: `EntityRef` is in-memory only — not preserved across serialize/deserialize.
 * Generation counters reset on world load. Stale refs from before serialization
 * will deref to null after loading the snapshot into a new world.
 */
export function toJSON(world: World): WorldSnapshot {
  return snapshotWorld(world, null)
}

// toJSON restricted to the `allow` component ids (null = all). Components
// outside the allowlist are skipped before their data is read or cloned.
function snapshotWorld(world: World, allow: Set<number> | null): WorldSnapshot {
  const state = getWorldState(world)
  const entities: WorldSnapshot['entities'] = []
  // Iterate by raw slot index; snapshot stores raw idx in the `eid` field
  // (wire format unchanged — idx is used for load-side entity re-creation).
  for (let idx = 1; idx < state.capacity; idx++) {
    // Archetype 0 is the empty mask, which also holds live component-less
    // entities, so liveness is decided by the row lookup below, not the id.
    const archId = state.entityArchetype[idx] ?? 0
    const arch = state.archetypes[archId]
    if (!arch) continue

    // Build the packed eid from idx + current generation to do alive check
    const gen = state.generations[idx] ?? 0
    const packedEid = packEid(idx, gen, state.options)
    if (!arch.entityRow.has(packedEid)) continue

    const w = state.options.maskWordCount
    const base = idx * w
    const components: WorldSnapshot['entities'][0]['components'] = []
    for (let wi = 0; wi < w; wi++) {
      let word = state.entityMask[base + wi] ?? 0
      while (word !== 0) {
        const lsb = word & -word
        const bit = (wi << 5) + (31 - Math.clz32(lsb))
        const info = state.componentInfoByBit[bit]
        if (info && (!allow || allow.has(info.id))) {
          const storage = state.componentStorageByBit[bit]
          let data: unknown = null
          if (info.kind === 'soa' && storage?.soa) {
            const obj: Record<string, unknown> = {}
            for (const f of info.fields) {
              const col = storage.soa[f.name]
              if (!col) continue
              if (f.vectorLen === 1) {
                obj[f.name] = col[idx]
              } else {
                const arr: number[] = []
                const baseI = idx * f.vectorLen
                for (let i = 0; i < f.vectorLen; i++) arr.push(col[baseI + i] ?? 0)
                obj[f.name] = arr
              }
            }
            data = obj
          } else if (info.kind === 'aos' && storage?.aos) {
            // Deep copy: handing out the live instance would let a snapshot
            // (or a world restored from it) share nested objects with the
            // source world, and mutating the snapshot would mutate the world.
            const inst = storage.aos[idx]
            data = inst == null ? null : structuredClone(inst)
          } else {
            data = true
          }
          components.push({ kind: info.kind, id: info.id, data })
        }
        word &= word - 1
      }
    }
    // Wire format stores raw idx (not packed) for cross-session portability
    entities.push({ eid: idx, components })
  }
  return {
    version: state.version,
    capacity: state.capacity,
    maxEntities: state.options.maxEntities,
    indexBits: state.options.indexBits,
    generationBits: state.options.generationBits,
    entities,
  }
}

// Default initial-capacity floor for a restored world (matches createWorld's
// own default). Keeps the common round-trip from needlessly shrinking while
// staying a trivial allocation (~36 KB of index arrays at 1024 slots).
const RESTORE_CAPACITY_FLOOR = 1024

// SECURITY (ECS-S-01): the snapshot `capacity` field is attacker-controlled on
// any untrusted-load path (localStorage, network — both documented flows for the
// stable deserializeWorld). createWorld only clamps to 1<<indexBits (16,777,216),
// so an inflated value forces a near-600 MB TypedArray allocation from a tiny
// payload — a browser-tab OOM DoS. Clamp the *starting* capacity to the real
// entity count (fromJSON re-creates entities via createEntity, which grows the
// world on demand, so a tight initial hint never loses data). A garbage/missing
// value falls back to the count too.
function clampRestoreCapacity(rawCapacity: unknown, entityCount: number): number {
  const needed = Math.max(RESTORE_CAPACITY_FLOOR, entityCount + 1)
  if (typeof rawCapacity !== 'number' || !Number.isFinite(rawCapacity) || rawCapacity <= 0) {
    return needed
  }
  return Math.min(Math.floor(rawCapacity), needed)
}

// The source world's maxEntities / indexBits / generationBits, so a restored
// world keeps its limits and bit layout (only the starting capacity is
// clamped). Non-integer values are ignored; out-of-range bit widths are
// rejected by createWorld like any other options.
function restoredWorldOptions(snapshot: WorldSnapshot): WorldOptions {
  const opts: WorldOptions = {}
  if (Number.isInteger(snapshot.maxEntities)) opts.maxEntities = snapshot.maxEntities!
  if (Number.isInteger(snapshot.indexBits)) opts.indexBits = snapshot.indexBits!
  if (Number.isInteger(snapshot.generationBits)) opts.generationBits = snapshot.generationBits!
  return opts
}

export function fromJSON(snapshot: WorldSnapshot): World {
  const initialCapacity = clampRestoreCapacity(snapshot.capacity, snapshot.entities.length)
  const world = createWorld({ ...restoredWorldOptions(snapshot), initialCapacity })
  const eidMap = new Map<number, EntityId>()
  for (const e of snapshot.entities) {
    const eid = createEntity(world)
    eidMap.set(e.eid, eid)
  }
  for (const e of snapshot.entities) {
    const eid = eidMap.get(e.eid)!
    for (const comp of e.components) {
      const info = getComponentByInternalId(comp.id)
      if (!info) {
        // Component missing — silently skip; future version may throw based on options
        continue
      }
      const handle = getComponentHandle(info)
      if (handle) {
        addComponent(world, eid, handle, comp.data as ComponentInit<ComponentLike>)
      }
    }
  }
  return world
}

// Reconstruct a component handle from its ComponentInfo. Since defineComponent
// returns plain handles { __kind, __id, __schema }, we can synthesize them.
function getComponentHandle(info: ComponentInfo): ComponentLike | null {
  if (info.kind === 'soa') {
    return { __kind: 'soa', __id: info.id, __schema: info.schema ?? {} } as ComponentLike
  }
  if (info.kind === 'aos') {
    const factory = info.factory ?? (() => ({}))
    return { __kind: 'aos', __id: info.id, __factory: factory } as ComponentLike
  }
  return { __kind: 'tag', __id: info.id } as ComponentLike
}

// --- Binary packing (wrapped JSON for 0.1) ---

function packBinary(snapshot: WorldSnapshot): Uint8Array {
  const json = JSON.stringify(snapshot)
  const jsonBytes = new TextEncoder().encode(json)
  const versionBytes = new TextEncoder().encode(VERSION)
  const headerSize = 4 + 4 + 4 + versionBytes.length + 4
  const total = headerSize + jsonBytes.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let off = 0
  out[off++] = MAGIC.charCodeAt(0)
  out[off++] = MAGIC.charCodeAt(1)
  out[off++] = MAGIC.charCodeAt(2)
  out[off++] = MAGIC.charCodeAt(3)
  view.setUint32(off, FORMAT_VERSION, true)
  off += 4
  view.setUint32(off, versionBytes.length, true)
  off += 4
  out.set(versionBytes, off)
  off += versionBytes.length
  view.setUint32(off, jsonBytes.length, true)
  off += 4
  out.set(jsonBytes, off)
  return out
}

function unpackBinary(bytes: Uint8Array, options?: DeserializeOptions): WorldSnapshot {
  if (bytes.length < 12) throw new Error('aiecsjs: bytes too short to be a valid snapshot')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes[0] !== MAGIC.charCodeAt(0) ||
    bytes[1] !== MAGIC.charCodeAt(1) ||
    bytes[2] !== MAGIC.charCodeAt(2) ||
    bytes[3] !== MAGIC.charCodeAt(3)
  ) {
    throw new Error('aiecsjs: invalid magic bytes')
  }
  let off = 4
  const formatVersion = view.getUint32(off, true)
  off += 4
  const onUnknown = options?.onUnknownVersion ?? 'throw'
  if (formatVersion !== FORMAT_VERSION && onUnknown === 'throw') {
    throw new Error(`aiecsjs: format version ${formatVersion} not supported`)
  }

  // SECURITY: explicit bounds checks on every length field. DataView itself
  // throws on out-of-range reads, but an attacker who controls the bytes can
  // still craft a `verLen` that skips past data of their choosing — we make
  // each step's invariant explicit and impose a sane cap to short-circuit
  // pathological payloads early.
  const MAX_FIELD_LEN = 64 * 1024 * 1024 // 64 MiB
  if (off + 4 > bytes.length) {
    throw new Error('aiecsjs: snapshot truncated before verLen')
  }
  const verLen = view.getUint32(off, true)
  off += 4
  if (verLen > MAX_FIELD_LEN || off + verLen > bytes.length) {
    throw new Error(`aiecsjs: snapshot verLen=${verLen} out of bounds`)
  }
  off += verLen // skip the aiecsjs version string

  if (off + 4 > bytes.length) {
    throw new Error('aiecsjs: snapshot truncated before jsonLen')
  }
  const jsonLen = view.getUint32(off, true)
  off += 4
  if (jsonLen > MAX_FIELD_LEN || off + jsonLen > bytes.length) {
    throw new Error(`aiecsjs: snapshot jsonLen=${jsonLen} out of bounds`)
  }
  const jsonBytes = bytes.subarray(off, off + jsonLen)
  const json = new TextDecoder().decode(jsonBytes)
  // Wrap the parse so a malformed body (e.g. a truncated/garbled payload reached
  // under onUnknownVersion:'best-effort') surfaces a namespaced `aiecsjs:` error
  // instead of leaking a raw SyntaxError — consistent with the rest of the module.
  // Bounds checks above already guarantee `json` covers exactly the declared body.
  try {
    return JSON.parse(json) as WorldSnapshot
  } catch (cause) {
    throw new Error('aiecsjs: snapshot body is not valid JSON', { cause })
  }
}

// --- Delta serializer ---

interface DeltaState {
  world: World
  // `options.components` allowlist (component ids); null = every component.
  allow: Set<number> | null
  // Per-entity JSON signature of the last captured components. Stored as
  // strings (not the snapshot objects) because toJSON hands out AoS data by
  // reference: a retained snapshot would alias the live instances and every
  // in-place AoS change would compare equal to itself.
  lastSigs: Map<number, string> | null
}

export function createDeltaSerializer(world: World, options?: SerializeOptions): DeltaSerializer {
  const state: DeltaState = {
    world,
    allow: allowlistOf(options?.components),
    lastSigs: null,
  }
  return {
    capture(): Uint8Array {
      const current = snapshotWorld(state.world, state.allow)
      const sigs = new Map<number, string>()
      for (const e of current.entities) sigs.set(e.eid, JSON.stringify(e.components))
      let delta: WorldSnapshot
      if (!state.lastSigs) {
        delta = current
      } else {
        // Compute simple delta: entities with changed components
        delta = computeDelta(state.lastSigs, current, sigs)
      }
      state.lastSigs = sigs
      return packBinary(delta)
    },
    apply(targetWorld: World, deltaBytes: Uint8Array): void {
      const snapshot = unpackBinary(deltaBytes)
      // Materialise each snapshot entity at the SAME slot index the source used
      // (the wire stores raw slot indices in `eid`). ensureEntityAtSlot reuses a
      // live slot, reclaims a freed one, or advances the frontier — so apply() is
      // sound on a non-pristine / independently-churned replica (it uses the
      // slot's CURRENT generation, never gen=0) and never spawns phantom padding
      // entities for holes in the source's slot range.
      //
      // CAVEAT: deltas carry added/changed entities only (see computeDelta) —
      // entity REMOVALS are not represented, so a replica is not pruned when the
      // source destroys an entity, and a component removed on the source is not
      // removed on the replica. apply() is additive/updating.
      const targetState = getWorldState(targetWorld)
      for (const e of snapshot.entities) {
        if (!Number.isInteger(e.eid) || e.eid <= 0 || e.eid >= targetState.options.maxEntities)
          continue
        const eid = ensureEntityAtSlot(targetState, e.eid)
        for (const comp of e.components) {
          if (state.allow && !state.allow.has(comp.id)) continue
          const info = getComponentByInternalId(comp.id)
          if (!info) continue
          const handle = getComponentHandle(info)
          if (handle)
            addComponent(targetWorld, eid, handle, comp.data as ComponentInit<ComponentLike>)
        }
      }
    },
    reset(): void {
      state.lastSigs = null
    },
  }
}

function computeDelta(
  prevSigs: Map<number, string>,
  curr: WorldSnapshot,
  currSigs: Map<number, string>,
): WorldSnapshot {
  const changed: WorldSnapshot['entities'] = []
  for (const e of curr.entities) {
    if (prevSigs.get(e.eid) !== currSigs.get(e.eid)) changed.push(e)
  }
  return { version: curr.version, capacity: curr.capacity, entities: changed }
}
