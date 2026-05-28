# Changelog

[English](CHANGELOG.md) | [繁體中文](CHANGELOG_ZHTW.md)

All notable changes to `aiecsjs` are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for 0.3+

- Implement ABA-safe `EntityRef` and graduate `getEntityGeneration` / `packEntity` from experimental → stable.
- Add `pipeAsync` for async system composition.
- Doc-test harness so README code blocks are mechanically verified.
- Promote `aiecsjs/relations` and `aiecsjs/worker` (true SAB-shared columns) to `stable`.

## [0.2.0] - 2026-05-28

### Fixed (correctness + security)

- **Prototype-pollution hardening in AoS `writeInitial`** ([src/internal/component.ts](src/internal/component.ts)): replaced `Object.assign(inst, initial)` with an explicit own-key copy that filters `__proto__` / `constructor` / `prototype`. Closes a path where a malicious `JSON.parse` payload reaching `addComponent` / `setComponent` / `fromJSON` / `deserializeWorld` could clobber the per-instance prototype.
- **Observer dispatch is now safe against unsubscribe-during-iteration** ([src/observers.ts](src/observers.ts)): every `fire*` walks a snapshot of `state.observers` (`Array.from(...)` + `includes` guard) so a handler that calls its own returned disposer no longer skips sibling observers in the same fire round.
- **`removeComponent` writes the new entity mask BEFORE firing observers** ([src/internal/component.ts](src/internal/component.ts)): query-targeted `remove` observers read `state.entityMask` to decide if the entity left the matching set; with the previous ordering the bit was still set during dispatch and the remove never fired. Brings `removeComponent` in line with `addComponent`'s "mutate then fire" order.
- **`destroyEntity` now emits query-targeted `remove` events** ([src/observers.ts](src/observers.ts) `dispatchDestroyObservers`): in addition to per-component `onRemove`, the destroy hook now walks query observers and fires `remove` for any query the entity was matching pre-destroy. `wasMatch` is computed against a **snapshot of the pre-destroy mask** (not live `state.entityMask`) so a Phase 1 reentrant handler that mutates the entity's mask cannot suppress query removes in Phase 2 (regression caught by the round-2 review).
- **`deserializeWorld` / `attachWorld` / `adoptSnapshot` binary length fields are bounds-checked** ([src/serialize.ts](src/serialize.ts)): `verLen` and `jsonLen` carry explicit `off + len <= bytes.length` assertions and a 64 MiB cap. `attachWorld` and `adoptSnapshot` ([src/worker.ts](src/worker.ts)) both carry SECURITY JSDocs that document the trust boundary expectation for SAB / TransferableSnapshot transports.

### Added (API)

- **`disposeWorld(world)`** — new export that aliases `destroyWorld`. Aligns with the ai*js ecosystem `dispose()` convention (`aifsmjs.Runtime.dispose`, `aibridgejs.Bridge.dispose`). Prefer this name in new code; `destroyWorld` is retained as a deprecated alias and is scheduled for removal in 1.0.
- **`{ signal?: AbortSignal }` on every observer**: `onAdd`, `onRemove`, `onSet`, and `observe` now accept an options object. When the signal aborts, the observer auto-unsubscribes. The returned unsubscribe function remains valid and idempotent. New exported type `ObserverOptions` documents the shape. This closes a long-running gap noted in the AI ecosystem audit — long-lived observers on user-controlled lifecycles (UI components, async pipelines) no longer require manual cleanup wiring.

### Changed (stability)

- `getEntityGeneration` and `packEntity` re-classified from `stable` → `experimental` in `STABILITY.md` and `api.json`. In 0.1 these returned `0` / identity and that has not changed — the relabel honestly admits the deferred encoding work. Real values arrive when ABA-safe `EntityRef` lands.
- `destroyWorld` re-classified from `stable` → `deprecated`. Behaviour unchanged; the deprecation is the API-naming alignment described above. Use `disposeWorld` instead.

### Documentation

- `onSet` now carries a JSDoc and README paragraph clarifying that it is a **low-level mutation hook**, not a reactive value-predicate query. `enterQuery` / `exitQuery` continue to be the structural-change surface; reactive value tracking remains an explicit non-goal of the core.
- README observer section gains an `AbortController`-based unsubscribe example.

### Build & tooling

- Added [Biome](https://biomejs.dev/) lint + format (`biome.json`, `npm run lint`, `npm run format`). Brings parity with `aifsmjs` and `aibridgejs` and surfaces `noExplicitAny` warnings in legacy `src/internal/*` for follow-up cleanup.
- Added `scripts/verify-exports.mjs` and the `npm run verify:exports` script; gates that every `package.json#exports` entry has a real file in `dist/`. Wired into `prepublishOnly`.
- New `CONTRIBUTING.md` with the same shape used by `aifsmjs` (quick start, scope policy, release flow).

### Compatibility

This release is **non-breaking at runtime**. All existing code that called `destroyWorld(world)`, registered observers without options, or read `getEntityGeneration` continues to work. The stability label change is documentation-only.

## [0.1.4] - 2026-05-28

Docs-only release. Adds a cross-package integration section pointing at the `aibridgejs` JSON envelope contract; no source code changes.

### Documentation

- README and README_ZHTW gained an "Integration with aibridgejs" section explaining that `bridge.call` / `bridge.emit` enforce JSON-safe payloads and silently drop `Date`, `Map`, `Set`, and class instances. The correct shape for streaming world state across the bridge is `toJSON(world)` (or `serializeWorld(world)` wrapped in a JSON envelope) before emitting, not `getComponent(...)` direct. See [aiecsjs README · Integration with aibridgejs](README.md#integration-with-aibridgejs).
- Verified via the `aijs-integration-smoke` companion project: every named export from `aifsmjs@0.1.2`, `aibridgejs@0.1.3`, and `aiecsjs@0.1.3` can coexist in a single TypeScript module with zero identifier collisions under `tsc --noEmit --strict`.

## [0.1.3] - 2026-05-28

A "no known silent bugs" release. Two correctness fixes, one hot-path allocation removal, and a small batch of style cleanups. No public API behaviour changes; `_getWorldState` is removed from the root export (was undocumented, unused by every sub-path, leading underscore signalled internal).

### Fixed

- `aiecsjs/relations` relation data store no longer keys edges by `srcEid * worldCapacity + tgtEid`. After the world grew, the same `(src, tgt)` pair computed a different key and earlier entries became orphaned. Storage is now a nested `Map<srcEid, Map<tgtEid, data>>`, independent of capacity. The cleanup hook on `destroyEntity` was updated to match. v0.1 has no public retrieve API so the bug was user-invisible, but it would have surfaced the moment a retrieve surface landed in 0.2.
- Per-world resolved query bitmasks no longer live on the module-global `QueryInternal`. When the same `defineQuery(...)` handle was used by two worlds whose component registration orders differed, the second world's per-world mask overwrote the first world's, and `runQuery` silently returned wrong rows in world A. Masks now live in `WorldState.queryMasks: Map<queryId, QueryMaskBundle>`, isolated per world. Regression test in `tests/multi-world.test.ts` exercises the cross-order scenario.

### Changed (internal)

- Observer dispatch (`dispatchQueryObservers`) no longer allocates a temporary `Uint32Array` on every mutation event. Added `matchesEntityMask` helper in `bitmask.ts` that reads directly from `state.entityMask` at a base offset.
- Shared bit-iteration extracted as `forEachSetBit(mask, base, words, fn)` in `bitmask.ts`. `clearAllEntityStorages` (`component.ts`) and `dispatchDestroyObservers` (`observers.ts`) now share that single implementation instead of inlining the same `word & -word` / `Math.clz32` pattern three times.
- `state.generations[idx]` is written without an `as any` cast. `Uint8Array | Uint16Array` already supports indexed read/write.
- Removed the `void oldCap` no-op from `growEntityArrays`.
- Removed `_getWorldState` from the root `aiecsjs` export. Sub-paths (`aiecsjs/serialize`, `aiecsjs/worker`) already import `getWorldState` directly from the internal module; the leading-underscore root re-export had no consumer.

### Planned for 0.3

- Promote `aiecsjs/relations` and `aiecsjs/worker` to `stable`.
- Stabilize the network delta wire format.
- Add automated benchmark suite committed to repo.

### Planned for 1.0

- API freeze for the 1.x line.
- Drop the experimental status label.

## [0.1.2] - 2026-05-28

CI/CD smoke-test release. No user-facing source or behavioural changes since 0.1.1; this bump exists solely to validate the tag-triggered publish workflow (see `.github/workflows/publish.yml`) end-to-end against the npm registry with provenance attestation.

### Build & tooling

- Confirmed that pushing a `v*.*.*` tag triggers `.github/workflows/publish.yml`, runs `prepublishOnly` (typecheck + tests + build + size budget), and publishes to npm with sigstore provenance.

## [0.1.1] - 2026-05-28

The "documentation honesty + test backstop" release. No new public APIs; this is the version of 0.1.0 that ships with the public surface, the documentation, and the test coverage in agreement.

### Fixed

- `destroyEntity` now clears the SoA columns and undefines the AoS slots that the destroyed entity owned. Previously only the entity mask was cleared, leaving stale data at the slot visible to debug snapshots and the serialisation path. Public `hasComponent` / query behaviour was already correct, so user-visible behaviour is unchanged; this closes the gap surfaced by the new `destroyEntity zeroes the destroyed entity’s SoA slot` test.

### Changed (docs hygiene)

- README and STABILITY now describe `aiecsjs/worker` honestly as a snapshot-copy transport for 0.1; true shared columns remain a 0.2 target. README description and `package.json` description updated accordingly.
- README clarifies that 0.1 `EntityId` is a bare slot index; internal generation is tracked for slot reuse but not encoded in the ID. ABA-safe `EntityRef` is on the 0.2 roadmap.
- Sub-paths (`loop` / `commands` / `observers` / `serialize` / `worker` / `relations`) re-positioned in STABILITY as utility / adapter sub-paths; the root `aiecsjs` is the stable core surface. Tree-shakers should drop any sub-path the app does not import.
- README adds a "What aiecsjs does NOT do" section listing explicit non-goals (system scheduler, render binding, physics, network replication, value-predicate reactive queries, prefab/inheritance).
- Language version filenames renamed from `*.zh-TW.md` to `*_ZHTW.md`. Cross-links, `llms.txt`, and `package.json` `files` updated. Future language variants follow the same uppercase ISO 639-1 pattern.
- Removed emoji from documentation prose (language switchers, status banners).

### Build & tooling

- tsup build now runs with `minify: true`.
- `size-limit` added as a dev dependency; per-export gzip budgets enforced via `npm run size`. Current measurements: core 5.49 kB, all sub-paths combined 12.6 kB gzip.
- GitHub Actions CI workflow added: typecheck → test → build → size check on push and PR to `main`.
- `prepublishOnly` now runs typecheck, tests, build, and the size budget gate before allowing publish.

### Tests

- Test count increased from 84 to 140. New file `tests/internal/bitmask.test.ts` covers the multi-word bitmask helpers in isolation (27 cases including `matches` truth table). New file `tests/multi-world.test.ts` covers per-world isolation when the same component is reused. Existing files gained: naive linear-filter cross-check against `runQuery` for all clause combinations, archetype migration boundary path, query mid-traversal stability and lazy cache behaviour, SoA field clear assertions on both `removeComponent` and `destroyEntity`, SoA vector-length round trip, `maxEntities` / `maxComponents` boundary throws, observer fan-out for destroy across multiple components, `onSet` value content, query observer ignores unrelated mutation, relation source-side destroy cleanup, exclusive relation storage resize, worker `readOnly` rejects add / remove / destroy, serialize `options.components` filter, `onUnknownVersion: throw | best-effort` paths, command buffer placeholder resolves into a queryable entity, slot-reuse limitation made explicit. Loop tests rewritten on top of `vi.useFakeTimers({ toFake: ['performance', ...] })` for deterministic dt validation.

## [0.1.0] - 2026-05-27

**Initial release.** All 50 documented exports across 7 modules are implemented and covered by 84 passing Vitest behaviour tests. Built with tsup to dual ESM + CJS, ships `.d.ts` declarations and source maps.

### Implementation notes

- **Storage**: world-level TypedArray columns per SoA component field, sized to world capacity. Archetypes track entity membership (a `Uint32Array entities[]`) but do not own column data. This makes archetype migration O(1) and lets `Position.x[eid]` work directly without per-archetype indirection. Trade-off: iteration over archetypes reads columns at potentially non-contiguous offsets; for hot data this stays in L1.
- **EntityId is unversioned in 0.1**: `EntityId` is the entity index. Generation is tracked internally for slot reuse but not encoded in the ID. `getEntityIndex` / `getEntityGeneration` / `packEntity` are identity helpers. ABA-safe references via a separate `EntityRef` type are planned for 0.2.
- **Bitmask queries**: multi-word Uint32 masks, default 8 words (256 components). Per-world bit allocation, global component identity.
- **Worker / SAB**: 0.1 implements snapshot-copy semantics (serialize-into-SAB on send, deserialize-on-adopt) rather than true shared-memory column aliasing. The API surface matches the documented contract; true shared columns ship in 0.2.
- **Binary serialization**: a JSON payload wrapped in a 4-byte magic + version header. Compact binary column encoding is planned for 0.2.

### Added

- `README.md` (English) and `README_ZHTW.md` (Traditional Chinese) with quick start, guide, API reference, performance notes, multi-threading guide, WebGPU interop section, serialization guide, migration guides, and "For AI Agents" section.
- `llms.txt` — Jeremy Howard format AI-discovery file.
- `llms-full.txt` — Single-file complete reference for LLM consumption.
- `api.json` — Machine-readable export manifest with stability and `since` fields on every entry.
- `STABILITY.md` and `STABILITY_ZHTW.md` — Per-export stability contract.
- `docs/MIGRATION.md` and `docs/MIGRATION_ZHTW.md` — Migration guides from bitECS 0.4, miniplex 2.0, and ECSY.

### API surface declared

- Core: `createWorld`, `destroyWorld`, `resetWorld`, `getWorldSize`, `getWorldCapacity`.
- Entity: `createEntity`, `destroyEntity`, `entityExists`, `getEntityIndex`, `getEntityGeneration`, `packEntity`.
- Component: `defineComponent`, `defineTag`, `defineObjectComponent`, `addComponent`, `removeComponent`, `hasComponent`, `getComponent`, `setComponent`, `Types`.
- Query: `defineQuery`, `runQuery`, `forEachEntity`, `iterQuery`, `enterQuery`, `exitQuery`, `queryArchetypes` (experimental).
- System: `pipe`.
- Subpath `aiecsjs/loop`: `createLoop`.
- Subpath `aiecsjs/commands`: `createCommandBuffer`, `flush`, `withCommandBuffer`.
- Subpath `aiecsjs/observers`: `observe`, `onAdd`, `onRemove`, `onSet`.
- Subpath `aiecsjs/serialize`: `serializeWorld`, `deserializeWorld`, `toJSON`, `fromJSON`, `createDeltaSerializer` (experimental).
- Subpath `aiecsjs/worker` (experimental): `transferableSnapshot`, `adoptSnapshot`, `attachWorld`, `detachWorld`.
- Subpath `aiecsjs/relations` (experimental, not implemented): `defineRelation`, `addRelation`, `removeRelation`, `getRelationTargets`, `ChildOf`.
- Utility: `VERSION`, `IS_SAB_SUPPORTED`, `isWorld`, `isEntity`.

### Known limitations in 0.1

- `aiecsjs/relations` and `aiecsjs/worker` are implemented but tagged experimental; API may shift.
- Network delta wire format is JSON-based; binary patch format is planned for 0.2.
- AoS components are main-thread only; cannot be shared via SharedArrayBuffer.
- No automatic system scheduler / parallel execution.
- Worker/SAB uses snapshot-copy in 0.1 rather than true shared-memory aliasing.
- EntityId is unversioned; ABA-safe references arrive with `EntityRef` in 0.2.

[Unreleased]: https://github.com/yshengliao/aiecsjs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yshengliao/aiecsjs/releases/tag/v0.1.0
