# aiecsjs Review

Current review state after the 2026-09-29 ai*js 0.6.0 pass. Historical fixed findings were summarised to keep AI context focused on still-relevant work.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P3 | Reactive buffers | Documented | Enter/exit buffers are unbounded until drained; callers must poll/clear them. |
| P3 | Snapshot entity ids | Documented | `fromJSON` / `deserializeWorld` re-create entities in snapshot order with fresh ids (holes in the slot range close up), so EntityIds stored inside component data are not remapped. Deferred: keeping slot indices on restore would let one hostile `eid` force the full-capacity allocation that the ECS-S-01 clamp prevents; it needs a design (an id remap table or a bounded slot-preserving restore). Delta `apply()` already keeps slots within the target's `maxEntities`. |
| P3 | Query argument typing | Open | The query functions accept a raw component array at runtime, but their TypeScript signatures take `Query` only, so TypeScript users must call `defineQuery` (the README does). Deferred: widening the signatures is an API addition that belongs with the per-arity query typing design below. |
| P3 | Lint noise | Open | Biome reports 84 `noExplicitAny` warnings (was 133): 80 are casts in tests, and the 4 in `src` are the public `forEachEntity` / `forEachEntityIndexed` callback types and `ComponentLike`. Deferred: removing those needs per-arity query typing across the public API, a separate design; the 0.6.0 pass only made local, behaviour-free reductions with identical public `.d.ts` signatures. |

## Fixed Summary

- `addRelation` throws `EcsError` for a dead source or target, so a recycled slot no longer inherits an edge added to its dead predecessor.
- Snapshots are format 2 with a component table; components have optional stable keys, and every loader (`fromJSON`, `deserializeWorld`, delta `apply()`, `adoptSnapshot`, `attachWorld`) resolves them by key (by id when keyless) and rejects unknown components (unless `onUnknownComponent: 'skip'`) and kind/SoA-field mismatches before creating or writing anything; 0.5.x snapshots load only with `onUnknownVersion: 'best-effort'`.
- `createWorld` rejects non-integer `initialCapacity` / `maxEntities` / `indexBits` / `generationBits` before its range checks, instead of truncating typed arrays.
- `resetWorld` rejects read-only (worker-attached) worlds like every other mutator.
- Every plain `Error` misuse throw is `EcsError` with the same message.
- Non-function observer handlers, `forEachEntity` / `forEachEntityIndexed` / `withCommandBuffer` callbacks, `pipe` systems and AoS factories, nullish AoS factory results, non-relation handles and a bad `createLoop` configuration are rejected at the call instead of failing later.
- `enterQuery` / `exitQuery` / `observe` accept raw component arrays and reject other non-Query input without caching a broken reactive query.
- A failing AoS factory leaves the entity unchanged instead of half-added.
- The `components` allowlist of `deserializeWorld` applies to local components, not the snapshot's source ids.
- package.json `exports` resolve `.d.cts` types under `require`.
- The README Quick Start no longer replaces a SoA column with a string.
- `noExplicitAny` warnings reduced from 133 to 84 with unchanged public types.
- `destroyEntity` no longer recurses or corrupts state when an onRemove/observe handler destroys (or resets) the same entity during teardown.
- `sideEffects: false` no longer lets bundlers drop the component/mask-change registration wiring, which broke queries in bundled consumers.
- Query observers (`observe(..., 'add'|'remove')`) fire on real match transitions instead of missing `none`-term enter/exit and firing spurious removes.
- The delta serializer replicates AoS component changes instead of aliasing live objects and comparing them to themselves.
- `toJSON`/delta capture no longer drop component-less live entities (archetype 0) from snapshots.
- `flush()` detaches the command-buffer queue before applying it, so a failed flush no longer replays Phase 1 and duplicates entities on retry.
- Command-buffer ops queued mid-flush (from onAdd/onRemove handlers) are resolved in further rounds instead of throwing or being silently dropped.
- Component-level `onRemove` handlers can read the outgoing component on the `removeComponent` path, matching the `destroyEntity` path.
- `forEachEntity`/`forEachEntityIndexed`/`iterQuery`/`runQuery` accept raw component arrays and throw a clear `TypeError` for other non-Query input instead of silently iterating nothing.
- In-loop `addComponent`/`removeComponent` that moves the visited entity no longer causes double-visits or skipped entities within one `forEachEntity` pass.
- `observe(..., 'set')` fires only for entities that actually match the query, and for `any`-only components too.
- `fromJSON`/`toJSON` deep-copy AoS component data instead of sharing live object references.
- Dual ESM+CJS package copies share one component/query/world registry via a `globalThis` key, instead of colliding ids across copies.
- Restored worlds (`fromJSON`/`deserializeWorld`) carry `maxEntities`/`indexBits`/`generationBits` from the snapshot instead of falling back to defaults.
- The fixed-timestep loop ends a stale tick chain on stop/restart instead of stacking concurrent chains or yielding a wrong dt/alpha.
- Reactive (enter/exit) queries are indexed per-world instead of registering foreign components as a side effect of unrelated structural changes.
- `observe()` on an enter/exitQuery registers the source query directly instead of forcing registration via `runQuery`, which previously left the observer permanently inert.
- `iterQuery`/`forEachEntity`/`forEachEntityIndexed` drain their reactive buffer up front, so an early `break` or a throwing callback no longer re-delivers already-seen entities.
- README/STABILITY state relation-destroy cost as `O(incoming + data sources + outgoing sources)`, not `O(incoming)` alone.
- Delta `apply()` rejects non-integer `eid`s instead of corrupting entity-slot allocation.
- `deref`/`aliveRef` docs say "never throws for a live world" instead of an unqualified "never throws" — both throw `EcsError` once the world is disposed.
- The fixed-timestep loop clamps `dtMs` to non-negative, so a first-tick timestamp earlier than `start()`'s sample can no longer drive `onRender`'s alpha negative.
- `createEntity`'s maxEntities guard throws `EcsError` (matching the JSDoc), not a plain `Error`.
- Hostile snapshot capacity restore is clamped.
- Query loops re-read archetype size and current contents instead of relying on stale loop bounds.
- Worker transferable snapshot types now include `SharedArrayBuffer | ArrayBuffer`.
- README no longer promises build-mode-gated validation that the runtime does not provide.
- Exclusive relation destroy cleanup's slot cleanup is `O(incoming)` via a reverse index (was `O(capacity)`); large sparse relation tables no longer pay a full-capacity scan per destroy.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:dist`
- `pnpm verify:llms`
- `pnpm check:size`
- `pnpm lint` exits successfully but emits 84 known `noExplicitAny` warnings.
