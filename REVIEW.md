# aiecsjs Review

Current review state after the 2026-09-28 ai*js pass. Historical fixed findings were summarized to keep AI context focused on still-relevant work.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P2 | Relations: dead-entity edges | Open | `addRelation` does no liveness check on source/target; an edge to/from an already-destroyed entity is stored by raw slot and inherited by whatever entity is later recycled into that slot. Fix: check `isAliveInternal` on both endpoints and throw, mirroring `addComponent`'s dead-entity guard. |
| P2 | Serialization: component identity | Open | Snapshots identify components by process-global creation-order id with no schema/kind check; a different `defineComponent` call order in the loading session silently misroutes data to the wrong component. Fix: a stable component key and/or a schema table, verified (and rejected on mismatch) on load. |
| P2 | World options validation | Open | `resolveOptions` doesn't reject non-integer/non-finite `initialCapacity`/`maxEntities`; a fractional or `NaN` value silently truncates typed arrays and drops entities. Fix: validate every numeric option with `Number.isInteger` before clamping. |
| P3 | `resetWorld` on read-only worlds | Open | `resetWorld` ignores `state.readOnly`, so a worker-attached read-only world can be wiped even though every other mutating op rejects it. Fix: throw when `state.readOnly`. Deferred: a new thrown condition on a stable API is an API change, out of scope for a small P3 fix this pass. |
| P3 | Reactive buffers | Documented | Enter/exit buffers are unbounded until drained; callers must poll/clear them. |
| P3 | Lint noise | Open | Biome reports 133 `noExplicitAny` warnings, concentrated in `src/internal/query.ts` column-view typing and `types.ts`'s `SoAComponent<any>`. Deferred: needs generic per-arity typing across the query API, not a small/local change. |

## Fixed Summary

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
- The delta serializer and `deserializeWorld` honour the `components` allowlist option instead of ignoring it.
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
- `pnpm lint` exits successfully but emits known warnings.
