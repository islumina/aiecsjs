# Changelog

All notable changes to aiecsjs are summarized here. Detailed historical review notes live in Git history; this file keeps current release context compact.

## [0.6.0] - 2026-09-29

### Breaking

- `toJSON` / `serializeWorld` / `createDeltaSerializer` / `fromJSON` / `deserializeWorld` / `adoptSnapshot` / `attachWorld`: snapshots are now format 2 with a component table, and every loader resolves each component by its stable key (by creation-order id when keyless) and throws `EcsError` for a component the process has not defined or a kind / SoA-field mismatch, because 0.5.x id-only matching silently put data into the wrong components when definition order differed; 0.5.x snapshots (no `formatVersion`, binary or worker meta format 1) are rejected with `EcsError: aiecsjs: format version 1 not supported`. Migration: give every serialized component a key (`defineComponent(schema, { key })`, `defineTag({ key })`, `defineObjectComponent(factory, { key })`), re-export existing 0.5.x snapshots with 0.6.0 or load them once with `{ onUnknownVersion: 'best-effort' }` and save again, pass `{ onUnknownComponent: 'skip' }` where dropping unknown components is intended, and add `formatVersion: 2` plus a `components` table to hand-built snapshots (see docs/MIGRATION.md).
- `addRelation`: a dead source or target now throws `EcsError` (mirroring `addComponent`), because edges are stored by slot and an edge to a dead entity was inherited by whatever entity was later recycled into that slot. Migration: check `entityExists` before `addRelation` when an endpoint may be stale.
- `createWorld`: a non-integer `initialCapacity`, `maxEntities`, `indexBits` or `generationBits` (such as `1.5`, `NaN`, `Infinity` or `'8'`) now throws `EcsError` before the range checks and clamps, because fractional and `NaN` values silently truncated typed arrays and dropped entities. Migration: pass integers for these options (for example `Math.floor(n)`).
- `resetWorld`: a read-only (worker-attached) world now throws `EcsError`, as every other mutator already did, instead of being wiped. Migration: reset a writable world instead (`adoptSnapshot`, or `attachWorld` without `readOnly`).
- `onAdd` / `onRemove` / `onSet` / `observe`, `forEachEntity` / `forEachEntityIndexed`, `withCommandBuffer`, `pipe`, `defineObjectComponent` and the relation helpers: a non-function handler, callback, system or factory, an AoS factory that returns `null` or `undefined`, or a relation argument that is not a `defineRelation` handle now throws `EcsError` at the call, instead of being accepted and failing later (for observers, after the structural change was already committed) or doing nothing. Migration: pass functions, a factory that returns a value and real relation handles; catch `EcsError` where these come from dynamic input.
- `createLoop` (`aiecsjs/loop`): a missing options object or a non-function `onUpdate` / `onRender` now throws `TypeError`, and a `fixed` that is not a finite number > 0 or a `maxSubSteps` that is not a finite number >= 1 throws `RangeError`, instead of failing in the first tick or silently stalling. Migration: pass an options object with a function `onUpdate`, and a positive finite `fixed` and a `maxSubSteps` of at least 1 when you set them.

### Changes

- Added: stable component keys: `defineComponent(schema, { key })`, `defineTag({ key })` and `defineObjectComponent(factory, { key })`; a key must be a non-empty string that is unique in the process (`EcsError` otherwise).
- Added: `DeserializeOptions.onUnknownComponent` (`'throw'` by default, or `'skip'`); `fromJSON(snapshot, options?)` takes `DeserializeOptions` (including the `components` allowlist), and `adoptSnapshot(snap, options?)` and `attachWorld(buffer, { readOnly?, ...DeserializeOptions })` pass them through.
- Added: the `EcsError` constructor accepts an optional `{ cause }`.
- Changed: every plain `Error` misuse throw (read-only guards, the dead-entity guards of `addComponent` / `setComponent`, unregistered components, the missing empty archetype guard, binary snapshot header and body errors, worker meta errors, command-buffer errors) is now `EcsError` with the same message, so callers can branch on the class; `instanceof Error` checks and message matches keep working.
- Changed: `noExplicitAny` lint warnings are down from 133 to 84 (`src` 11 to 4, tests 122 to 80), with the emitted public `.d.ts` signatures unchanged; the 4 left in `src` are the public query callback and `ComponentLike` types.
- Changed: internal refactors keep every entry inside its existing size budget: shared archetype-row and slot-placement helpers, one loop for `forEachEntity` / `forEachEntityIndexed`, one reactive-buffer drain, one mask matcher, and removal of the never-read per-archetype edge tables (two `Int32Array(256)` per archetype) and of unreachable fallback factories; the coverage `functions` threshold is raised to 100.
- Fixed: `destroyEntity` no longer recurses (or corrupts world size/freeList/exit-query state) when an onRemove/observe handler destroys, resets, or otherwise re-enters teardown for the same entity.
- Fixed: the package's `sideEffects: false` no longer lets bundlers drop `dist/index.js`'s component-lookup and mask-change registration, which broke queries (and left reactive enter/exit queries empty) for consumers who imported only chunk-owned bindings.
- Fixed: query observers (`observe(world, query, 'add'|'remove')`) now track match transitions, so queries with `none` terms fire enter/exit correctly and `'remove'` no longer fires for entities that never matched.
- Fixed: the delta serializer now replicates AoS (`defineObjectComponent`) changes; `capture()` previously aliased the live component instance and always diffed it against itself, silently dropping AoS updates.
- Fixed: `toJSON`/delta capture no longer drop component-less live entities (archetype 0) from snapshots.
- Fixed: `flush()` detaches the command-buffer queue before applying it, so a flush that throws partway through no longer replays Phase 1 and duplicates entities on retry.
- Fixed: command-buffer ops enqueued during `flush()` (e.g. from an onAdd/onRemove handler) are now processed in further rounds instead of throwing an unresolved-placeholder error or being silently dropped.
- Fixed: component-level `onRemove` handlers can now read the outgoing component's value via `getComponent` on the `removeComponent` path, matching the existing `destroyEntity` path.
- Fixed: `forEachEntity`/`forEachEntityIndexed`/`iterQuery`/`runQuery` accept a raw component array (routed through `defineQuery`) and throw a `TypeError` for other non-Query input, instead of silently iterating zero entities.
- Fixed: an in-loop `addComponent`/`removeComponent` that moves the currently visited entity into an archetype already covered by the same `forEachEntity`/`forEachEntityIndexed` pass no longer visits it twice or skips another entity.
- Fixed: `observe(world, query, 'set')` now fires only for entities that actually match the query (not merely any entity carrying a component in `query.all`), and fires for `any`-only components too.
- Fixed: `toJSON` deep-copies AoS component data instead of handing out the live instance, so `fromJSON(toJSON(w))` and a mutated snapshot no longer alias/mutate the source world.
- Fixed: the delta serializer's `capture()`/`apply()` and `deserializeWorld` now honour the documented `components` allowlist option instead of silently ignoring it.
- Fixed: component/query/world registries are now shared across duplicate ESM+CJS copies of the package (via a `globalThis` key) instead of colliding on the same auto-incrementing ids.
- Fixed: `fromJSON`/`deserializeWorld` restore `maxEntities`, `indexBits`, and `generationBits` from the snapshot instead of falling back to defaults, so a large or non-default-layout world round-trips without hitting a bogus `maxEntities` cap.
- Fixed: the fixed-timestep loop now ends a tick chain as soon as it is stopped or restarted — even from inside `onUpdate`/`onRender` — so it no longer keeps stepping, renders after `stop()`, or runs two chains concurrently.
- Fixed: reactive (enter/exit) queries are now indexed per world instead of scanning a module-level cache on every structural change, which previously registered foreign components (and could exhaust `maxComponents`) in unrelated worlds.
- Fixed: `observe()` on an `enterQuery`/`exitQuery` now registers the query directly instead of forcing registration via `runQuery`, which drained the (not-yet-registered) reactive buffer as a no-op and left the observer permanently inert.
- Fixed: `iterQuery`/`forEachEntity`/`forEachEntityIndexed` now drain their reactive buffer up front, so breaking out of the loop early or a callback throwing partway through no longer re-delivers already-seen entities on the next read.
- Fixed: the delta serializer's `apply()` rejects a non-integer `eid` instead of corrupting entity-slot allocation (a live slot pushed onto the freeList, a non-integer allocation frontier).
- Fixed: the fixed-timestep loop clamps `dtMs` to non-negative, so a first tick timestamp earlier than `start()`'s sample can no longer drive the accumulator (and `onRender`'s alpha) negative.
- Fixed: `createEntity`'s `maxEntities` guard now throws `EcsError` (matching the documented behaviour) instead of a plain `Error`.
- Fixed: `enterQuery` / `exitQuery` / `observe` now check their query argument like `runQuery`: a raw component array works, and other non-Query input throws the documented `TypeError` instead of an internal `TypeError` (`enterQuery` / `exitQuery` also cached a broken reactive query that later calls returned silently).
- Fixed: `addComponent` builds a new AoS instance before it moves the entity to its new archetype, so a factory that throws leaves the entity unchanged instead of half-added (moved, but never announced to observers or reactive queries).
- Fixed: a missing world handle, component handle, snapshot, worker meta or delta byte array now throws `EcsError` instead of a bare `TypeError` from property access.
- Fixed: `deserializeWorld` applied the `components` allowlist to the snapshot's source-process component ids; `fromJSON` / `deserializeWorld` now apply it to the resolved local components.
- Fixed: package.json `exports` now nest `types` under `import` and `require` for every subpath, with `require.types` pointing at the `.d.cts` file, so CommonJS consumers on `node16`/`nodenext` module resolution get the CommonJS declarations; `verify-exports` walks nested conditions.
- Docs: relation-destroy cost is documented as `O(incoming + data sources + outgoing sources)` (was understated as `O(incoming)` alone).
- Docs: `deref`/`aliveRef` are documented as "never throws for a live world" (was an unqualified "never throws") — both throw `EcsError` once the world has been disposed.
- Docs: the README / README_ZHTW Quick Start no longer corrupts the world: it did `pos.x += vel.x` on the column objects returned by `getComponent`, which replaced the `Position.x` column with a string; it now indexes the columns with `forEachEntityIndexed`'s `i` over a `defineQuery` query (the TypeScript signature does not accept a raw array).
- Docs: README / README_ZHTW gain Snapshots, Relations and Errors sections; STABILITY gains a Behavioral Contract section (the ai*js re-entrancy clause for observer dispatch, argument validation, read-only mutators, relation liveness, snapshot format 2); `docs/MIGRATION.md` / `MIGRATION_ZHTW.md` gain "0.5.x -> 0.6.0 snapshots".
- Docs: README / STABILITY no longer describe reactive-query tracking as a module-level cache scan; it is a per-component index.
- Docs: `api.json` is updated for 0.6.0 signatures and throws, documents that the `defineObjectComponent` factory runs once per entity on first add (not once at definition), and lists `DeserializeOptions.components`.

## [0.5.9] - 2026-06-29

- Fixed: `forEachEntity` / `forEachEntityIndexed` no longer cache the archetype's entity array, so an in-loop `createEntity`/`addComponent` that reallocates the iterated archetype can no longer yield `undefined` EntityIds or a bogus index `0`.
- Fixed: `resetWorld` now clears relation storage, so recycled entity slots no longer inherit stale relation edges/data.
- Docs: relation destroy is documented as `O(incoming)` (was stale `O(capacity)`).

## [0.5.8] - 2026-06-14

- Changed: exclusive-relation destroy cleanup now clears incoming edges in O(incoming) via a reverse index instead of scanning the full relation capacity per destroy. Behaviour is unchanged; large sparse relation tables no longer pay a per-destroy capacity scan.
- Changed: reduced `noExplicitAny` lint warnings in source (154 to 140) with no behaviour change.
- Documentation-only slimming pass across README, stability notes, review backlog, and LLM context. Reactive query world-local indexing remains a deferred follow-up (design note in the review backlog).

## [0.5.7] - 2026-06-10

- Hardened serialization restore capacity and hostile snapshot handling.
- Fixed query iteration safety around archetype size changes.
- Clarified worker snapshot buffer types and runtime validation boundaries.
- Regenerated LLM context from the canonical docs.

## Older releases

- `0.5.6` through `0.5.1` focused on release hygiene, docs accuracy, ECS safety fixes, and family SLSA/provenance metadata.
- `0.5.0` aligned the package with the broader ai*js family release line.
- `0.4.x` added relations and declared the 1.0-track stability policy.
- `0.3.x` expanded serialization, worker/SAB helpers, command buffers, observers, and docs.
- `0.2.x` hardened entity/component correctness and security-sensitive registry behavior.
- `0.1.x` introduced the root world/entity/component/query API and TypedArray SoA storage.
