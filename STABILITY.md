# Stability Contract

aiecsjs keeps the root ECS surface stable and treats subpaths as explicit public modules.

## Stable Surface

| Surface | Status | Notes |
| --- | --- | --- |
| `aiecsjs` root | Stable | World/entity/component/query/system helpers, `Types`, refs, `VERSION`, `EcsError`. |
| `aiecsjs/loop` | Stable utility | Loop helper only; scheduler policy remains app-owned. |
| `aiecsjs/commands` | Stable utility | Command buffers for deferred structural mutations. |
| `aiecsjs/observers` | Stable utility | Add/remove/set observer helpers. |
| `aiecsjs/serialize` | Stable utility | Binary and JSON snapshots with capacity clamps; format 2; keyed components; mismatch rejected. |
| `aiecsjs/worker` | Experimental adapter | Environment-dependent SAB/transfer helpers. |
| `aiecsjs/relations` | Stable | Relations and `ChildOf`; `addRelation` throws `EcsError` for a dead source or target, mirroring `addComponent`; destroy cleanup cost remains documented. |
| `aiecsjs/internal/*` | Private | No compatibility guarantee. |

## Behavioral Contract

- Re-entrancy (ai*js rule for pure fan-out emitters): observer dispatch (`onAdd`, `onRemove`, `onSet`, `observe`) is synchronous and depth-first. A structural change made inside a handler, with its own notifications, runs to completion before the outer dispatch resumes; the outer dispatch keeps iterating its pre-taken snapshot and skips observers removed meanwhile; nested dispatch is never rejected or queued. aiecsjs has no `once` observers.
- Structural changes are applied at once, never queued. A handler that destroys the entity being destroyed, or removes the component being removed, makes the nested call a no-op and the outer call finishes. `flush()` on a buffer that is already flushing returns immediately; ops queued during a flush run in later rounds of that flush, in queue order.
- Misuse throws `EcsError` (message `aiecsjs: <subject> must be <constraint>` or `aiecsjs: <operation> on dead entity <eid>`) before any change is made: a non-integer `initialCapacity` / `maxEntities` / `indexBits` / `generationBits`; an empty, non-string or duplicate component `key`; a non-function observer handler, `forEachEntity` / `forEachEntityIndexed` / `withCommandBuffer` callback, `pipe` system or AoS factory; an AoS factory that returns `null` / `undefined`; a value that is not a relation handle; a missing world or component handle.
- `defineComponent` field-declaration errors and non-Query input to the query functions throw `TypeError`. `aiecsjs/loop` exports no error class: `createLoop` throws `TypeError` for a missing options object or a non-function `onUpdate` / `onRender` and `RangeError` for a `fixed` that is not a finite number > 0 or a `maxSubSteps` that is not a finite number >= 1.
- A read-only world (`attachWorld(buffer, { readOnly: true })`) rejects every mutator with `EcsError`: `createEntity`, `destroyEntity`, `addComponent`, `removeComponent`, `setComponent`, `resetWorld`, `addRelation`, `removeRelation` and delta `apply()`.
- `addRelation` throws `EcsError` for a dead source or target; `removeRelation` is lenient. `destroyEntity` and `resetWorld` drop the edges of the entities they remove, so relation storage never holds an edge for a dead entity.
- Snapshots are format 2: `toJSON`, `serializeWorld` and delta `capture()` write `formatVersion: 2` and a table of every referenced component (`id`, `key`, `kind`, SoA `fields`). `fromJSON`, `deserializeWorld`, delta `apply()`, `adoptSnapshot` and `attachWorld` resolve every component (by `key`, by `id` when keyless) before they create or write anything. An undefined component throws `EcsError` unless `onUnknownComponent: 'skip'`; a kind or SoA-field mismatch always throws. A snapshot of another format version (every 0.5.x snapshot) throws unless `onUnknownVersion: 'best-effort'`, which resolves by `id` with a kind check only.

## Behavioral Boundaries

- Entity ids are generational numeric ids. Use refs (`refOf`, `deref`, `aliveRef`) when storing ids across time.
- Query iteration is synchronous and direct. Use command buffers for structural changes inside systems.
- Reactive query buffers must be drained by the caller.
- Serialization accepts trusted snapshots; hostile input is bounded but not a sandbox.
- `fromJSON` / `deserializeWorld` re-create entities in snapshot order with fresh ids; EntityIds stored inside component data are not remapped.
- No build-mode-gated runtime validation policy is promised.
- Worker support depends on `SharedArrayBuffer`, transfer support, and browser isolation policy.

## Current Caveats

- Queries are cached process-wide, and reactive (enter/exit) source queries are indexed process-wide by component: a structural change visits every such source that references the changed component, whichever world registered it.
- Exclusive relation cleanup avoids a full relation-capacity scan (via a reverse index it touches only `O(incoming)` exclusive edges), but it still walks every relation's `data` payload sources and `outgoing` (non-exclusive) edge lists on every destroy: `O(incoming + data sources + outgoing sources)` across all relations, even for entities with no relations.
- Lint reports `noExplicitAny` warnings, mostly test casts plus the public query callback types (typed per arity only in a future design).
