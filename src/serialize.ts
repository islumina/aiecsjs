// aiecsjs/serialize — binary, JSON, and delta serializers.

import { forEachSetBit } from './internal/bitmask.js'
import { addComponent, getComponentByInternalId } from './internal/component.js'
import { createEntity, ensureEntityAtSlot, isAliveInternal, packEid } from './internal/entity.js'
import { EcsError } from './internal/errors.js'
import { shared } from './internal/registry.js'
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
// Snapshot format 2 (0.6.0): a component table resolved by stable key.
const FORMAT_VERSION = 2

type SnapshotComponent = WorldSnapshot['components'][number]
type SnapshotEntity = WorldSnapshot['entities'][number]

export function serializeWorld(world: World, options?: SerializeOptions): Uint8Array {
  return packBinary(snapshotWorld(world, allowlistOf(options?.components)))
}

/**
 * Restore a world from `serializeWorld` bytes. Same resolution rules and
 * options as {@link fromJSON}; the binary header's format version is checked
 * against `onUnknownVersion` first.
 */
export function deserializeWorld(bytes: Uint8Array, options?: DeserializeOptions): World {
  return fromJSON(unpackBinary(bytes, options), options)
}

// `options.components` allowlist as a set of component ids; null = everything.
function allowlistOf(components: ComponentLike[] | undefined): Set<number> | null {
  return components ? new Set(components.map((c) => c.__id)) : null
}

/**
 * Serialize a world snapshot to a plain JSON-compatible object (format 2).
 *
 * `components` lists every component the entities reference with its stable
 * `key` (from `defineComponent(..., { key })`), kind and SoA fields, so a
 * loader can match data to components by key rather than by creation order.
 *
 * AoS component data is deep-copied (`structuredClone`), so the snapshot never
 * aliases live component instances; AoS values must therefore be cloneable.
 *
 * Note: `EntityRef` is in-memory only — not preserved across serialize/deserialize.
 * `fromJSON` / `deserializeWorld` re-create entities in snapshot order with
 * fresh ids (generation 0, holes in the slot range closed up), so stale refs
 * deref to null and EntityIds stored inside component data are not remapped.
 */
export function toJSON(world: World): WorldSnapshot {
  return snapshotWorld(world, null)
}

// toJSON restricted to the `allow` component ids (null = all). Components
// outside the allowlist are skipped before their data is read or cloned.
function snapshotWorld(world: World, allow: Set<number> | null): WorldSnapshot {
  const state = getWorldState(world)
  const w = state.options.maskWordCount
  const table = new Map<number, SnapshotComponent>()
  const entities: SnapshotEntity[] = []
  // Iterate by raw slot index; the snapshot stores the raw idx in `eid`.
  for (let idx = 1; idx < state.capacity; idx++) {
    // Archetype 0 also holds live component-less entities, so liveness is the
    // slot's current packed id, not its archetype.
    if (!isAliveInternal(state, packEid(idx, state.generations[idx] ?? 0, state.options))) continue
    const components: SnapshotEntity['components'] = []
    forEachSetBit(state.entityMask, idx * w, w, (bit) => {
      const info = state.componentInfoByBit[bit]
      if (!info || (allow && !allow.has(info.id))) return
      const storage = state.componentStorageByBit[bit]
      let data: unknown = true
      if (info.kind === 'soa' && storage?.soa) {
        const obj: Record<string, unknown> = {}
        for (const f of info.fields) {
          const col = storage.soa[f.name]
          if (!col) continue
          obj[f.name] =
            f.vectorLen === 1
              ? col[idx]
              : Array.from(col.subarray(idx * f.vectorLen, (idx + 1) * f.vectorLen))
        }
        data = obj
      } else if (info.kind === 'aos' && storage?.aos) {
        // Deep copy: handing out the live instance would let a snapshot
        // (or a world restored from it) share nested objects with the
        // source world, and mutating the snapshot would mutate the world.
        const inst = storage.aos[idx]
        data = inst == null ? null : structuredClone(inst)
      }
      components.push({ kind: info.kind, id: info.id, data })
      if (!table.has(info.id)) {
        table.set(info.id, {
          id: info.id,
          key: info.key,
          kind: info.kind,
          fields:
            info.kind === 'soa'
              ? info.fields.map(({ name, type, vectorLen }) => ({ name, type, vectorLen }))
              : null,
        })
      }
    })
    entities.push({ eid: idx, components })
  }
  return {
    formatVersion: FORMAT_VERSION,
    version: state.version,
    capacity: state.capacity,
    maxEntities: state.options.maxEntities,
    indexBits: state.options.indexBits,
    generationBits: state.options.generationBits,
    components: [...table.values()],
    entities,
  }
}

// `kind` plus, for SoA, the fields in declaration order — compared as a whole
// and quoted in the mismatch message.
function describeComponent(
  kind: string,
  fields: readonly { name: string; type: string; vectorLen: number }[] | null,
): string {
  if (kind !== 'soa') return kind
  const list = Array.isArray(fields) ? fields : []
  return `soa(${list.map((f) => `${f.name}:${f.type}${f.vectorLen === 1 ? '' : `*${f.vectorLen}`}`).join(',')})`
}

// Resolve every component a snapshot references to a component of this
// process — before the caller creates or writes anything. Returns snapshot
// component id → component (null = skipped).
//   - Format 2: each table entry resolves by `key` (by `id` when keyless) and
//     must match in kind and, for SoA, in fields; an entity component missing
//     from the table counts as unknown.
//   - Legacy (0.5.x, only with onUnknownVersion: 'best-effort'): resolve by
//     `id` with a kind check only; unknown ids are skipped (0.5.x behaviour).
function resolveComponents(
  snapshot: WorldSnapshot,
  options: DeserializeOptions | undefined,
): Map<number, ComponentInfo | null> {
  if (!snapshot || !Array.isArray(snapshot.entities)) {
    throw new EcsError('aiecsjs: snapshot must be an object with an entities array')
  }
  const version = snapshot.formatVersion ?? 1
  const legacy = version !== FORMAT_VERSION
  if (legacy && options?.onUnknownVersion !== 'best-effort') {
    throw new EcsError(`aiecsjs: format version ${version} not supported`)
  }
  const skip = legacy || options?.onUnknownComponent === 'skip'
  const resolved = new Map<number, ComponentInfo | null>()
  const resolve = (entry: SnapshotComponent, lookup: boolean): void => {
    const name = entry.key ?? `#${entry.id}`
    const info = !lookup
      ? undefined
      : entry.key == null
        ? getComponentByInternalId(entry.id)
        : shared.componentInfoByKey.get(entry.key)
    if (!info) {
      if (!skip) {
        throw new EcsError(`aiecsjs: snapshot component "${name}" is not defined in this process`)
      }
      resolved.set(entry.id, null)
      return
    }
    const expected = describeComponent(info.kind, legacy ? null : info.fields)
    const actual = describeComponent(entry.kind, entry.fields)
    if (expected !== actual) {
      throw new EcsError(
        `aiecsjs: snapshot component "${name}" does not match the registered component: ${expected} vs ${actual}`,
      )
    }
    resolved.set(entry.id, info)
  }
  if (!legacy) for (const entry of snapshot.components ?? []) resolve(entry, true)
  for (const e of snapshot.entities) {
    for (const c of e.components) {
      if (!resolved.has(c.id)) resolve({ id: c.id, key: null, kind: c.kind, fields: null }, legacy)
    }
  }
  return resolved
}

// Write one snapshot entity's resolved components onto `eid`.
function loadComponents(
  world: World,
  eid: EntityId,
  components: SnapshotEntity['components'],
  resolved: Map<number, ComponentInfo | null>,
  allow: Set<number> | null,
): void {
  for (const c of components) {
    const info = resolved.get(c.id)
    if (info && (!allow || allow.has(info.id))) {
      // addComponent resolves a handle by `__id` alone.
      const handle = { __id: info.id } as ComponentLike
      addComponent(world, eid, handle, c.data as ComponentInit<ComponentLike>)
    }
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

/**
 * Restore a world from a `toJSON` snapshot.
 *
 * Every component the snapshot references is resolved before the world is
 * created: by `key` for keyed components, by creation-order id otherwise. A
 * component this process has not defined throws `EcsError` unless
 * `onUnknownComponent: 'skip'`; a kind or SoA-field mismatch always throws
 * `EcsError`. A snapshot without `formatVersion: 2` (every 0.5.x snapshot)
 * throws `EcsError` unless `onUnknownVersion: 'best-effort'`, which loads it by
 * id with a kind check only. `options.components` restricts which components
 * are loaded.
 */
export function fromJSON(snapshot: WorldSnapshot, options?: DeserializeOptions): World {
  const resolved = resolveComponents(snapshot, options)
  const allow = allowlistOf(options?.components)
  const initialCapacity = clampRestoreCapacity(snapshot.capacity, snapshot.entities.length)
  const world = createWorld({ ...restoredWorldOptions(snapshot), initialCapacity })
  for (const e of snapshot.entities) {
    loadComponents(world, createEntity(world), e.components, resolved, allow)
  }
  return world
}

// --- Binary packing (magic + format version + VERSION + JSON body) ---

function packBinary(snapshot: WorldSnapshot): Uint8Array {
  const enc = new TextEncoder()
  const versionBytes = enc.encode(VERSION)
  const jsonBytes = enc.encode(JSON.stringify(snapshot))
  const bodyOffset = 16 + versionBytes.length
  const out = new Uint8Array(bodyOffset + jsonBytes.length)
  const view = new DataView(out.buffer)
  out.set(enc.encode(MAGIC))
  view.setUint32(4, FORMAT_VERSION, true)
  view.setUint32(8, versionBytes.length, true)
  out.set(versionBytes, 12)
  view.setUint32(bodyOffset - 4, jsonBytes.length, true)
  out.set(jsonBytes, bodyOffset)
  return out
}

function unpackBinary(bytes: Uint8Array, options?: DeserializeOptions): WorldSnapshot {
  if (!bytes || bytes.length < 12) {
    throw new EcsError('aiecsjs: bytes too short to be a valid snapshot')
  }
  const dec = new TextDecoder()
  if (dec.decode(bytes.subarray(0, 4)) !== MAGIC) throw new EcsError('aiecsjs: invalid magic bytes')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const formatVersion = view.getUint32(4, true)
  if (formatVersion !== FORMAT_VERSION && options?.onUnknownVersion !== 'best-effort') {
    throw new EcsError(`aiecsjs: format version ${formatVersion} not supported`)
  }

  // SECURITY: explicit bounds checks on every length field. DataView itself
  // throws on out-of-range reads, but an attacker who controls the bytes can
  // still craft a `verLen` that skips past data of their choosing — we make
  // each step's invariant explicit and impose a sane cap to short-circuit
  // pathological payloads early. (`bytes.length >= 12` covers verLen itself.)
  const MAX_FIELD_LEN = 64 * 1024 * 1024 // 64 MiB
  const verLen = view.getUint32(8, true)
  let off = 12
  if (verLen > MAX_FIELD_LEN || off + verLen > bytes.length) {
    throw new EcsError(`aiecsjs: snapshot verLen=${verLen} out of bounds`)
  }
  off += verLen // skip the aiecsjs version string

  if (off + 4 > bytes.length) {
    throw new EcsError('aiecsjs: snapshot truncated before jsonLen')
  }
  const jsonLen = view.getUint32(off, true)
  off += 4
  if (jsonLen > MAX_FIELD_LEN || off + jsonLen > bytes.length) {
    throw new EcsError(`aiecsjs: snapshot jsonLen=${jsonLen} out of bounds`)
  }
  // Wrap the parse so a malformed body (e.g. a truncated/garbled payload reached
  // under onUnknownVersion:'best-effort') surfaces a namespaced `aiecsjs:` error
  // instead of leaking a raw SyntaxError — consistent with the rest of the module.
  // Bounds checks above already guarantee the slice covers exactly the declared body.
  try {
    return JSON.parse(dec.decode(bytes.subarray(off, off + jsonLen))) as WorldSnapshot
  } catch (cause) {
    throw new EcsError('aiecsjs: snapshot body is not valid JSON', { cause })
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
      // Resolve (and reject) the component table before touching the target.
      const resolved = resolveComponents(snapshot, undefined)
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
        loadComponents(targetWorld, eid, e.components, resolved, state.allow)
      }
    },
    reset(): void {
      state.lastSigs = null
    },
  }
}

// The changed entities of `curr`, keeping its format version and component
// table so apply() resolves a delta exactly like a full snapshot.
function computeDelta(
  prevSigs: Map<number, string>,
  curr: WorldSnapshot,
  currSigs: Map<number, string>,
): WorldSnapshot {
  return {
    ...curr,
    entities: curr.entities.filter((e) => prevSigs.get(e.eid) !== currSigs.get(e.eid)),
  }
}
