// aiecsjs/worker — SharedArrayBuffer helpers (experimental, snapshot-copy).
//
// Note: 0.x implements SAB as a transferable snapshot pattern rather than true
// shared-memory aliasing. The world is serialized into the SAB, and the worker
// reconstructs a fresh world from those bytes via adoptSnapshot/attachWorld.
// True shared-column memory is targeted for a future stable release.
// The API matches the documented contract and survives postMessage cleanly.
//
// EntityRef is in-memory only — not preserved across worker boundaries.
// Generation counters reset on adoptSnapshot/attachWorld. Pass `EntityRef.id`
// (the packed EntityId) across the worker boundary only if you understand that
// the generation portion will be stale after a round-trip snapshot.

import { EcsError } from './internal/errors.js'
import type {
  DeserializeOptions,
  TransferableSnapshot,
  World,
  WorldMeta,
  WorldState,
} from './internal/types.js'
import { destroyWorld, getWorldState, isWorldRegistered } from './internal/world.js'
import { deserializeWorld, serializeWorld } from './serialize.js'
import { VERSION } from './version.js'

const MAGIC = 0x41494543 // 'AIEC' little-endian as uint32

export function transferableSnapshot(world: World): TransferableSnapshot {
  const state = getWorldState(world)
  const bytes = serializeWorld(world)
  // Fallback: a plain ArrayBuffer where SharedArrayBuffer is unavailable (no
  // cross-origin isolation). TransferableSnapshot.buffer is typed
  // `SharedArrayBuffer | ArrayBuffer`, so the type tells the truth instead of
  // pretending the fallback is a SAB.
  const buffer =
    typeof SharedArrayBuffer === 'undefined'
      ? new ArrayBuffer(bytes.byteLength)
      : new SharedArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return { buffer, meta: buildMeta(state) }
}

/**
 * Adopt a snapshot previously produced by `transferableSnapshot`.
 *
 * `options` are the `deserializeWorld` options: component resolution by key,
 * `onUnknownComponent`, and `onUnknownVersion` (which also governs the meta's
 * format version).
 *
 * SECURITY: same trust expectation as `attachWorld` — the sender of the
 * `TransferableSnapshot` (typically a Web Worker) must be trusted. The
 * function runs `validateMeta` and `deserializeWorld`, which enforce magic
 * + format version + length bounds on the binary header; but the inner
 * JSON payload, once decoded, is fed to `addComponent` and reaches AoS
 * components. For untrusted senders, use `aibridgejs` + `toJSON(world)` at
 * the application boundary instead.
 */
export function adoptSnapshot(snap: TransferableSnapshot, options?: DeserializeOptions): World {
  validateMeta(snap?.meta, options)
  return deserializeWorld(new Uint8Array(snap.buffer), options)
}

/**
 * Adopt a SharedArrayBuffer-backed snapshot produced by `transferableSnapshot`.
 *
 * `options` takes the `deserializeWorld` options plus `readOnly`, which makes
 * every mutator (including `resetWorld`) throw `EcsError` on the result.
 *
 * SECURITY: the SAB sender must be trusted. `attachWorld` performs the same
 * magic + version + length-bounds checks as `deserializeWorld`, but the JSON
 * payload itself is deserialised into AoS components via `addComponent`. If
 * the sender is untrusted (e.g. a third-party Web Worker that you do not
 * audit), prefer the higher-level `aibridgejs` channel + `toJSON(world)`
 * pattern, which lets you validate the shape at the application boundary
 * before constructing entities.
 */
export function attachWorld(
  buffer: SharedArrayBuffer | ArrayBuffer,
  options?: DeserializeOptions & { readOnly?: boolean },
): World {
  const world = deserializeWorld(new Uint8Array(buffer), options)
  if (options?.readOnly) getWorldState(world).readOnly = true
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
    formatVersion: 2,
    aiecsjsVersion: VERSION,
    indexBits: state.options.indexBits,
    generationBits: state.options.generationBits,
    maxComponents: state.options.maxComponents,
    maskWordCount: state.options.maskWordCount,
    capacity: state.capacity,
    componentSchemas,
  }
}

function validateMeta(meta: WorldMeta, options: DeserializeOptions | undefined): void {
  if (meta?.magic !== MAGIC) {
    throw new EcsError('aiecsjs: invalid snapshot meta (wrong magic)')
  }
  if (meta.formatVersion !== 2 && options?.onUnknownVersion !== 'best-effort') {
    throw new EcsError(`aiecsjs: format version ${meta.formatVersion} not supported`)
  }
}
