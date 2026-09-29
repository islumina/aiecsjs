import { VERSION } from '../version.js'
import type { MaskChangeFn, ObserversDispatchAPI } from './component.js'
import type { ObserversAPI } from './entity.js'
import type { ComponentInfo, EntityId, QueryInternal, Relation, WorldState } from './types.js'

// Process-wide registries, kept on globalThis rather than in module scope.
//
// The package ships separate ESM and CJS builds (and apps can end up with
// duplicated bundles), so several copies of this code can be loaded into one
// process. With module-level registries every copy started its counters at 1:
// a component defined through one copy silently resolved to a DIFFERENT
// component in another (same id), and world / query ids collided the same way.
//
//   - `ids` — version-agnostic id counters shared by every copy of any
//     version, so ids never collide across copies. A handle a copy's own
//     registry does not know then fails loudly instead of aliasing.
//   - `shared` — the registries and cross-module dispatch hooks, keyed by the
//     exact VERSION (their shapes are internal and may change between
//     releases), so copies of the same release interoperate fully.

interface IdCounters {
  component: number
  query: number
  world: number
  relation: number
}

interface SharedRegistry {
  componentInfoById: Map<number, ComponentInfo>
  // stable component key (defineComponent/defineTag/defineObjectComponent
  // `options.key`) → component
  componentInfoByKey: Map<string, ComponentInfo>
  queryCache: Map<string, QueryInternal>
  // source query id → its enter/exit variants
  reactiveBySource: Map<number, QueryInternal[]>
  // component id → source queries (with a reactive variant) that reference it
  reactiveSourcesByComponent: Map<number, QueryInternal[]>
  worlds: Map<number, WorldState>
  childOf: Relation | null
  hooks: {
    observerDispatch: ObserversDispatchAPI | null
    maskChange: MaskChangeFn | null
    destroyObservers: ObserversAPI | null
    relationsCleanup: ((state: WorldState, eid: EntityId) => void) | null
  }
}

const g = globalThis as unknown as Record<symbol, unknown>

const IDS_KEY = Symbol.for('aiecsjs.ids')
g[IDS_KEY] ??= { component: 1, query: 1, world: 1, relation: 1 } satisfies IdCounters
export const ids = g[IDS_KEY] as IdCounters

const SHARED_KEY = Symbol.for(`aiecsjs.registry@${VERSION}`)
g[SHARED_KEY] ??= {
  componentInfoById: new Map(),
  componentInfoByKey: new Map(),
  queryCache: new Map(),
  reactiveBySource: new Map(),
  reactiveSourcesByComponent: new Map(),
  worlds: new Map(),
  childOf: null,
  hooks: {
    observerDispatch: null,
    maskChange: null,
    destroyObservers: null,
    relationsCleanup: null,
  },
} satisfies SharedRegistry
export const shared = g[SHARED_KEY] as SharedRegistry
