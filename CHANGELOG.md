# Changelog

All notable changes to aiecsjs are summarized here. Detailed historical review notes live in Git history; this file keeps current release context compact.

## [Unreleased]

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
- Docs: relation-destroy cost is documented as `O(incoming + data sources + outgoing sources)` (was understated as `O(incoming)` alone).
- Docs: `deref`/`aliveRef` are documented as "never throws for a live world" (was an unqualified "never throws") — both throw `EcsError` once the world has been disposed.

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
