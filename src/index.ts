// aiecsjs — public root entry.
// Re-exports the core API.

export { VERSION } from './version.js'

import { registerObserverDispatch } from './internal/component.js'
import { registerObserversAPI, registerRelationsCleanup } from './internal/entity.js'
import type { EntityId, WorldState } from './internal/types.js'

// Component lookup and mask-change → reactive-query wiring live in
// internal/query.ts, so they survive a bundler dropping this entry module
// (`sideEffects: false`) when a consumer imports only re-exported names.
// Observer dispatch is registered lazily by observers.ts on first import.
// Relations cleanup is registered lazily by relations.ts on first import.

// --- Component ---
export {
  addComponent,
  defineComponent,
  defineObjectComponent,
  defineTag,
  getComponent,
  hasComponent,
  removeComponent,
  setComponent,
} from './internal/component.js'
// --- Entity ---
export {
  createEntity,
  destroyEntity,
  entityExists,
  getEntityGeneration,
  getEntityIndex,
  isEntity,
  packEntity,
} from './internal/entity.js'
// --- System ---
export { pipe } from './internal/pipe.js'
// --- Query ---
export {
  defineQuery,
  enterQuery,
  exitQuery,
  forEachEntity,
  forEachEntityIndexed,
  iterQuery,
  queryArchetypes,
  runQuery,
} from './internal/query.js'
// --- Type re-exports ---
export type {
  AoSComponent,
  Archetype,
  ComponentInit,
  ComponentLike,
  ComponentView,
  EntityId,
  Query,
  QueryDescriptor,
  SoAColumns,
  SoAComponent,
  SoAFieldDecl,
  SoAFieldType,
  SoASchema,
  System,
  TagComponent,
  World,
  WorldOptions,
} from './internal/types.js'

export { Types } from './internal/types.js'
// --- World ---
// `disposeWorld` is the new preferred name (added 0.2.0). It is the same
// function as `destroyWorld`, exported under a name that aligns with the ai*js
// ecosystem `dispose()` convention (aifsmjs Runtime, aibridgejs Bridge).
//
// `destroyWorld` is the original 0.1.x export. It is now deprecated as of 0.2.0
// and is scheduled for removal in 1.0. New code should import `disposeWorld`.
export {
  createWorld,
  destroyWorld,
  destroyWorld as disposeWorld,
  getWorldCapacity,
  getWorldSize,
  isWorld,
  resetWorld,
} from './internal/world.js'

// --- Utility ---
export const IS_SAB_SUPPORTED: boolean = typeof SharedArrayBuffer !== 'undefined'

// --- Errors ---
export { EcsError } from './internal/errors.js'

// --- EntityRef (ABA-safe references) ---
export type { EntityRef } from './ref.js'
export { aliveRef, deref, EntityNotAliveError, refOf } from './ref.js'
