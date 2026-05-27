// aiecsjs/serialize — binary, JSON, and delta serializers.

import type {
  ComponentInfo,
  ComponentLike,
  DeltaSerializer,
  DeserializeOptions,
  EntityId,
  SerializeOptions,
  World,
  WorldSnapshot,
} from './internal/types.js'
import { VERSION } from './version.js'
import { getWorldState, createWorld } from './internal/world.js'
import {
  addComponent,
  defineComponent,
  defineObjectComponent,
  defineTag,
  getComponentInfo,
  getComponentByInternalId,
  listAllComponents,
} from './internal/component.js'
import { createEntity, destroyEntity, entityExists } from './internal/entity.js'
import { testBit } from './internal/bitmask.js'

const MAGIC = 'AIEC'
const FORMAT_VERSION = 1

export function serializeWorld(world: World, options?: SerializeOptions): Uint8Array {
  const snapshot = toJSON(world)
  if (options?.components) {
    snapshot.entities = snapshot.entities.map(e => ({
      eid: e.eid,
      components: e.components.filter(c =>
        options.components!.some(comp => comp.__id === c.id),
      ),
    }))
  }
  return packBinary(snapshot)
}

export function deserializeWorld(bytes: Uint8Array, options?: DeserializeOptions): World {
  const snapshot = unpackBinary(bytes, options)
  return fromJSON(snapshot)
}

export function toJSON(world: World): WorldSnapshot {
  const state = getWorldState(world)
  const entities: WorldSnapshot['entities'] = []
  for (let eid = 1; eid < state.capacity; eid++) {
    if (!entityExists(world, eid as EntityId)) continue
    const archId = state.entityArchetype[eid] ?? 0
    if (archId === 0) continue // unattached (shouldn't happen for alive)

    const w = state.options.maskWordCount
    const base = eid * w
    const components: WorldSnapshot['entities'][0]['components'] = []
    for (let wi = 0; wi < w; wi++) {
      let word = state.entityMask[base + wi] ?? 0
      while (word !== 0) {
        const lsb = word & -word
        const bit = (wi << 5) + (31 - Math.clz32(lsb))
        const info = state.componentInfoByBit[bit]
        if (info) {
          const storage = state.componentStorageByBit[bit]
          let data: unknown = null
          if (info.kind === 'soa' && storage?.soa) {
            const obj: Record<string, unknown> = {}
            for (const f of info.fields) {
              const col = storage.soa[f.name]
              if (!col) continue
              if (f.vectorLen === 1) {
                obj[f.name] = col[eid]
              } else {
                const arr: number[] = []
                const baseI = eid * f.vectorLen
                for (let i = 0; i < f.vectorLen; i++) arr.push(col[baseI + i] ?? 0)
                obj[f.name] = arr
              }
            }
            data = obj
          } else if (info.kind === 'aos' && storage?.aos) {
            data = storage.aos[eid] ?? null
          } else {
            data = true
          }
          components.push({ kind: info.kind, id: info.id, data })
        }
        word &= word - 1
      }
    }
    entities.push({ eid, components })
  }
  return {
    version: state.version,
    capacity: state.capacity,
    entities,
  }
}

export function fromJSON(snapshot: WorldSnapshot): World {
  const world = createWorld({ initialCapacity: snapshot.capacity })
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
        addComponent(world, eid, handle, comp.data as any)
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
  view.setUint32(off, FORMAT_VERSION, true); off += 4
  view.setUint32(off, versionBytes.length, true); off += 4
  out.set(versionBytes, off); off += versionBytes.length
  view.setUint32(off, jsonBytes.length, true); off += 4
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
  const formatVersion = view.getUint32(off, true); off += 4
  const onUnknown = options?.onUnknownVersion ?? 'throw'
  if (formatVersion !== FORMAT_VERSION && onUnknown === 'throw') {
    throw new Error(`aiecsjs: format version ${formatVersion} not supported`)
  }
  const verLen = view.getUint32(off, true); off += 4
  off += verLen // skip the aiecsjs version string
  const jsonLen = view.getUint32(off, true); off += 4
  const jsonBytes = bytes.subarray(off, off + jsonLen)
  const json = new TextDecoder().decode(jsonBytes)
  return JSON.parse(json) as WorldSnapshot
}

// --- Delta serializer ---

interface DeltaState {
  world: World
  components: ComponentLike[]
  lastSnapshot: WorldSnapshot | null
}

export function createDeltaSerializer(
  world: World,
  options?: SerializeOptions,
): DeltaSerializer {
  const state: DeltaState = {
    world,
    components: options?.components ?? listAllComponents().map(i => getComponentHandle(i)!).filter(Boolean),
    lastSnapshot: null,
  }
  return {
    capture(): Uint8Array {
      const current = toJSON(state.world)
      let delta: WorldSnapshot
      if (!state.lastSnapshot) {
        delta = current
      } else {
        // Compute simple delta: entities with changed components
        delta = computeDelta(state.lastSnapshot, current)
      }
      state.lastSnapshot = current
      return packBinary(delta)
    },
    apply(targetWorld: World, deltaBytes: Uint8Array): void {
      const snapshot = unpackBinary(deltaBytes)
      // Apply: ensure entities exist, then add/update their components
      const targetState = getWorldState(targetWorld)
      for (const e of snapshot.entities) {
        if (e.eid >= targetState.capacity) continue
        if (!entityExists(targetWorld, e.eid as EntityId)) {
          // Create the entity. For simplicity, we just spawn until we have enough.
          while (targetState.size < e.eid) {
            createEntity(targetWorld)
          }
        }
        for (const comp of e.components) {
          const info = getComponentByInternalId(comp.id)
          if (!info) continue
          const handle = getComponentHandle(info)
          if (handle) addComponent(targetWorld, e.eid as EntityId, handle, comp.data as any)
        }
      }
    },
    reset(): void {
      state.lastSnapshot = null
    },
  }
}

function computeDelta(prev: WorldSnapshot, curr: WorldSnapshot): WorldSnapshot {
  const prevByEid = new Map(prev.entities.map(e => [e.eid, e]))
  const changed: WorldSnapshot['entities'] = []
  for (const e of curr.entities) {
    const prevE = prevByEid.get(e.eid)
    if (!prevE) {
      changed.push(e)
      continue
    }
    const prevSig = JSON.stringify(prevE.components)
    const currSig = JSON.stringify(e.components)
    if (prevSig !== currSig) changed.push(e)
  }
  return { version: curr.version, capacity: curr.capacity, entities: changed }
}
