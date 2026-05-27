// aiecsjs/worker — SharedArrayBuffer helpers (experimental, snapshot-copy in 0.1).
//
// Note: 0.1 implements SAB as a transferable snapshot pattern rather than true
// shared-memory aliasing. The world is serialized into the SAB, and the worker
// reconstructs a fresh world from those bytes via adoptSnapshot/attachWorld.
// True shared-column memory is on the 0.2 roadmap. The API matches the
// documented contract and survives postMessage cleanly.

import type {
  TransferableSnapshot,
  World,
  WorldMeta,
  WorldState,
} from './internal/types.js'
import { VERSION } from './version.js'
import {
  getWorldState,
  destroyWorld,
  isWorldRegistered,
} from './internal/world.js'
import { serializeWorld, deserializeWorld } from './serialize.js'

const MAGIC = 0x41494543 // 'AIEC' little-endian as uint32

export function transferableSnapshot(world: World): TransferableSnapshot {
  const state = getWorldState(world)
  const bytes = serializeWorld(world)

  if (typeof SharedArrayBuffer === 'undefined') {
    // Fallback: ArrayBuffer wrapped to look like a SAB at runtime
    const ab = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(ab).set(bytes)
    return {
      buffer: ab as unknown as SharedArrayBuffer,
      meta: buildMeta(state),
    }
  }

  const sab = new SharedArrayBuffer(bytes.byteLength)
  new Uint8Array(sab).set(bytes)
  return { buffer: sab, meta: buildMeta(state) }
}

export function adoptSnapshot(snap: TransferableSnapshot): World {
  validateMeta(snap.meta)
  const bytes = new Uint8Array(snap.buffer)
  return deserializeWorld(bytes)
}

export function attachWorld(
  buffer: SharedArrayBuffer,
  options?: { readOnly?: boolean },
): World {
  const bytes = new Uint8Array(buffer)
  const world = deserializeWorld(bytes)
  if (options?.readOnly) {
    const state = getWorldState(world)
    state.readOnly = true
  }
  return world
}

export function detachWorld(world: World): void {
  if (isWorldRegistered(world.id)) {
    destroyWorld(world)
  }
}

function buildMeta(state: WorldState): WorldMeta {
  const componentSchemas: WorldMeta['componentSchemas'] = []
  for (const info of state.componentInfoByBit) {
    if (!info) continue
    componentSchemas.push({ id: info.id, kind: info.kind, schema: info.schema })
  }
  return {
    magic: MAGIC,
    formatVersion: 1,
    aiecsjsVersion: VERSION,
    indexBits: state.options.indexBits,
    generationBits: state.options.generationBits,
    maxComponents: state.options.maxComponents,
    maskWordCount: state.options.maskWordCount,
    capacity: state.capacity,
    componentSchemas,
  }
}

function validateMeta(meta: WorldMeta): void {
  if (meta.magic !== MAGIC) {
    throw new Error('aiecsjs: invalid snapshot meta (wrong magic)')
  }
  if (meta.formatVersion !== 1) {
    throw new Error(`aiecsjs: unsupported snapshot format version ${meta.formatVersion}`)
  }
}
