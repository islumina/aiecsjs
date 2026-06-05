// aiecsjs — public root entry.
// Re-exports the core API and wires up the lazy cross-module references.

export { VERSION } from './version.js'

import {
  getComponentByInternalId,
  registerMaskChangeDispatch,
  registerObserverDispatch,
} from './internal/component.js'
import { registerObserversAPI, registerRelationsCleanup } from './internal/entity.js'
import { recordEntityMaskChange, registerComponentLookup } from './internal/query.js'
import type { EntityId, WorldState } from './internal/types.js'

// Wire query → component lookup
registerComponentLookup((id) => getComponentByInternalId(id))

// Wire component mask-change → query reactive update
registerMaskChangeDispatch((state, eid, bit, prev, next) => {
  recordEntityMaskChange(state, eid, bit, prev, next)
})

// Observer dispatch is registered lazily by observers.ts on first import.
// Relations cleanup is registered lazily by relations.ts on first import.

// --- Type re-exports ---
export type {
  EntityId,
  World,
  WorldOptions,
  System,
  SoAComponent,
  AoSComponent,
  TagComponent,
  ComponentLike,
  ComponentInit,
  ComponentView,
  SoAColumns,
  SoASchema,
  SoAFieldType,
  SoAFieldDecl,
  Query,
  QueryDescriptor,
  Archetype,
} from './internal/types.js'

// --- World ---
export {
  createWorld,
  destroyWorld,
  resetWorld,
  getWorldSize,
  getWorldCapacity,
  isWorld,
} from './internal/world.js'

// `disposeWorld` is the new preferred name (added 0.2.0). It is the same
// function as `destroyWorld`, exported under a name that aligns with the ai*js
// ecosystem `dispose()` convention (aifsmjs Runtime, aibridgejs Bridge).
//
// `destroyWorld` is the original 0.1.x export. It is now deprecated as of 0.2.0
// and is scheduled for removal in 1.0. New code should import `disposeWorld`.
export { destroyWorld as disposeWorld } from './internal/world.js'

// --- Entity ---
export {
  createEntity,
  destroyEntity,
  entityExists,
  getEntityIndex,
  getEntityGeneration,
  packEntity,
  isEntity,
} from './internal/entity.js'

// --- Component ---
export {
  defineComponent,
  defineTag,
  defineObjectComponent,
  addComponent,
  removeComponent,
  hasComponent,
  getComponent,
  setComponent,
} from './internal/component.js'

export { Types } from './internal/types.js'

// --- Query ---
export {
  defineQuery,
  runQuery,
  iterQuery,
  forEachEntity,
  forEachEntityIndexed,
  enterQuery,
  exitQuery,
  queryArchetypes,
} from './internal/query.js'

// --- System ---
export { pipe } from './internal/pipe.js'

// --- Utility ---
export const IS_SAB_SUPPORTED: boolean = typeof SharedArrayBuffer !== 'undefined'

// --- EntityRef (ABA-safe references) ---
export type { EntityRef } from './ref.js'
export { refOf, deref, aliveRef, EntityNotAliveError } from './ref.js'
