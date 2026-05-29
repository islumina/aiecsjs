# Changelog

All notable changes to `aiecsjs` are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-05-29

Consistency patch — packaging and documentation surface aligned to the ai*js family. **No runtime API change; `dist/` is byte-identical to 0.4.0 apart from the bumped `VERSION` string.**

### Changed

- **`package.json` packaging metadata aligned to family conventions**: `engines.node` `">=18"` → `">=18.0.0"`; `repository.url` gains the `git+` prefix (`git+https://github.com/yshengliao/aiecsjs.git`). Both are semantically equivalent — registry/tooling hygiene only.
- **`files[]` trimmed to the family-minimal set plus `api.json`**: the npm tarball now ships `dist`, `README.md`, `README_ZHTW.md`, `LICENSE`, `llms.txt`, `llms-full.txt`, and `api.json`. `LICENSE` is now listed explicitly (it was already published via npm's automatic root-LICENSE inclusion). `STABILITY.md`, `CHANGELOG.md`, and `docs/` are no longer bundled — they remain in the repository and stay reachable from the README/`llms.txt` links on GitHub. `api.json` is **deliberately retained**: it is the machine-readable export manifest (stability + `since` per entry) that this package's "AI-readable docs" contract advertises, so it remains the tarball's stability surface for tooling.

### Removed

- **Redundant Traditional-Chinese doc duplicates**: `STABILITY_ZHTW.md` and `CHANGELOG_ZHTW.md` removed. The family keeps `README_ZHTW.md` as the single Traditional-Chinese entry point; per-export stability and the changelog are English-canonical (with `api.json` carrying the machine-readable stability surface). The plain-pipe language-switcher line atop `STABILITY.md` / `CHANGELOG.md` and the now-dangling `_ZHTW` references inside `README_ZHTW.md` were removed accordingly.

## [0.4.0] - 2026-05-29

### Added

- **`getRelationData(world, source, rel, target)`**: new stable export on `aiecsjs/relations`. Returns the `data` payload attached via `addRelation`, or `undefined` when no such edge exists or no data was stored. Closes the write-only-data asymmetry present since 0.1: `addRelation` accepted a data argument but there was no corresponding public read path.

### Changed

- **`aiecsjs/relations` graduated from experimental to stable.** The graph API (`defineRelation`, `addRelation`, `removeRelation`, `getRelationTargets`, `getRelationData`) and the built-in `ChildOf` relation are now frozen for the 1.x track. See [`STABILITY.md`](./STABILITY.md) for the full stability contract, including the raw slot-keying ABA semantic.
- **`aiecsjs/worker` remains experimental.** True SAB shared-memory column aliasing is deferred; the worker sub-path continues on snapshot-copy semantics.

### Build & Tooling

- **size-limit → `scripts/check-size.mjs`**: replaced the `size-limit` + `@size-limit/file` dev dependencies with a zero-dependency script that measures transitive chunk-closure gzip size per ESM entry. Required because `tsup splitting: true` (introduced in 0.3.1) makes each entry a thin re-export shell; the vanilla single-file measurement reported ~899 B for index when the true closure is ~7295 B. The new script resolves chunk imports recursively via BFS, sums per-file gzip, and enforces per-entry budgets.
- **npm → pnpm**: migrated from `package-lock.json` to `pnpm-lock.yaml`. Added `"packageManager": "pnpm@9.12.3"` and `"publishConfig": { "access": "public" }`. CI and publish workflows updated to use `pnpm/action-setup@v6` + `pnpm install --frozen-lockfile`. `npm publish --provenance --access public` in the publish workflow is intentionally preserved (OIDC trusted publishing requires npm CLI, not pnpm publish).
- **Coverage tests added + unreachable gaps documented**: new tests cover previously-unreachable paths in `serialize.ts`, `component.ts`, `query.ts`, and `loop.ts`. Thresholds updated to the honestly-achieved floor (statements 95 / branches 81 / functions 98 / lines 99). Unreachable-by-design gaps are now documented in `vitest.config.ts` with Chesterton rationale.

## [0.3.1] - 2026-05-29

### Fixed

- **Packed EntityId signed-overflow for generation ≥ 128**: `createEntity` returned a negative number diverging from the unsigned value stored in archetype row arrays (`Uint32Array`), so query iteration (`runQuery`/`iterQuery`/`forEachEntity`) yielded an eid that failed `entityRow` lookups; `refOf`/`entityExists`/`deref` on a query-iterated high-generation entity misbehaved (`refOf` threw on a live entity). `packEid`/`packEntity` now normalise with `>>> 0`. No public-bundle behaviour change beyond the corrected eid representation (EntityId is opaque + in-memory-only).
- **`toJSON` silently dropped high-generation entities** (gen ≥ 128 with default 8-bit generation): `toJSON` contained its own inline pack expression that produced a signed (negative) result, diverging from the unsigned key stored in `arch.entityRow`. The affected entity passed the archetype check but failed `entityRow.has()`, so it was omitted from every snapshot and `serializeWorld` call. Fixed by replacing the inline expression with the canonical `packEid` (which applies `>>> 0`). SPOT principle: one pack source of truth.
- **Cross-subpath registry isolation** (`tsup splitting: false` → `splitting: true`): each compiled entry point (`dist/index.js`, `dist/serialize.js`, etc.) previously bundled its own private copy of `internal/world.ts`, including the module-scope `worldRegistry`. A world created via the core subpath was invisible to `serializeWorld`/`getRelationTargets`/`transferableSnapshot` imported from their respective subpaths, causing `world N is destroyed or unknown` at runtime. With `splitting: true`, esbuild extracts a shared chunk used by all entries; ESM and CJS are both verified by the new `scripts/check-dist-subpaths.mjs` smoke script.
- **`getRelationTargets` returned raw index as `EntityId`** (gen always 0): `addRelation` stores the target as a raw slot index (`& indexMask`). The previous return path cast this raw index directly to `EntityId`, which is equivalent to a packed id with generation 0. For any target that had been recycled (gen > 0), callers received a stale id that failed `entityExists`, `entityRow` lookups, and component access. Fixed by re-packing each raw index against the current generation via `packEid` before returning.
- **`resolveOptions` did not validate `indexBits + generationBits ≤ 32`**: the individual range checks (`indexBits ∈ [1, 24]`, `generationBits ∈ [0, 16]`) allowed combinations such as `indexBits=24, generationBits=16` (40 bits), where `gen << 24` silently overflowed and high-generation bits were lost. A sum check is now enforced with a clear error message. The `[Unreleased]` example corrected accordingly (`indexBits: 16, generationBits: 16` = 32 bits).

### Known Limitations

- **`createDeltaSerializer.apply` with a recycled target world**: `apply` uses the raw entity index from the delta snapshot as the `EntityId` directly. When the target world has already recycled any of those slots (generation > 0), component operations silently act on the wrong packed id. This is a known limitation of the experimental delta API; the common usage (delta → a fresh gen-0 render-mirror world) is unaffected. A proper raw-index-to-packed-id mapping is planned for 0.4. Avoid `apply` against a world that has previously destroyed entities.

### Documentation

- README / README_ZHTW updated to reflect the shipped 0.3.0 `EntityRef` API: the previous README still described EntityRef as "targeted for 0.3+" and `getEntityGeneration`/`packEntity` as experimental. Both files now correctly state EntityId has been packed since 0.3, and `EntityRef` / `refOf` / `deref` / `aliveRef` / `EntityNotAliveError` are all stable since 0.3.0. API table entries for these symbols added.

### Build & Tooling

- Coverage gate: `@vitest/coverage-v8` installed and wired into `prepublishOnly` (replaces `npm run test`) and CI. Thresholds: statements 95 / branches 80 / functions 97 / lines 98 — the achievable bar on pristine source. The branch figure honours the `?? 0` / `noUncheckedIndexedAccess` idiom on TypedArray reads (nullish-fallback branches unreachable by design); thresholds are raised only by adding tests, never by stripping defensive guards or scattering `/* v8 ignore */`.
- `fast-check` property tests (`tests/properties.test.ts`): pack/unpack round-trip invariant (asserts `e >= 0` to guard the P0 regression) and ABA-deref always-null invariant.
- Dispose three-cycle tests, error-path tests, and observer handler-throw behaviour documented in `tests/world.test.ts` / `tests/observers.test.ts`.
- `scripts/check-dist-subpaths.mjs` (`npm run verify:dist`): post-build smoke test that imports `createWorld`+`createEntity` from the core subpath and calls `serializeWorld`, `addRelation`/`getRelationTargets`, and `transferableSnapshot` from their respective subpaths for both ESM (`dist/*.js`) and CJS (`dist/*.cjs`). Wired into `prepublishOnly` (after `build`) and CI.

## [Unreleased]

### Planned for 0.4+

- Add `pipeAsync` for async system composition.
- Doc-test harness so README code blocks are mechanically verified.
- Promote `aiecsjs/worker` to `stable` once true SAB shared-memory column aliasing is implemented.
- Document the 8-bit generation wrap caveat in [STABILITY.md](./STABILITY.md): with the
  default `generationBits=8`, a single slot recycled 256 times wraps back to its
  starting generation, briefly re-opening the ABA window. Safe for v0.5 shmup
  workloads (~5000 frame to wrap a single slot at 60 fps × ~1k destroys); high-churn
  pools should set `createWorld({ indexBits: 16, generationBits: 16 })` (16 + 16 = 32 bits;
  65 536 entities × 65 536 generations). See test
  [tests/ref.test.ts](./tests/ref.test.ts) `generation wrap` describe block.

## [0.3.0] - 2026-05-29

### Added (API)

- **`EntityRef<T>`** — ABA-safe entity reference. `refOf(world, eid)` builds one;
  `deref(world, ref)` returns the entity id when still alive (generation match)
  or `null` otherwise; `aliveRef(world, ref)` is the boolean guard form. Phantom
  type `T` lets callers distinguish ref kinds (e.g. `EntityRef<'bullet'>`) without
  runtime cost. Refs are in-memory only — not serializable across worker / disk.
- **`EntityNotAliveError`** — thrown by `refOf` when the entity is dead or invalid.
  `deref` / `aliveRef` never throw.

### Changed

- **`EntityId` now packs index + generation** into a single 32-bit number
  `(generation << indexBits) | index` (default `indexBits=24, generationBits=8`).
  `EntityId` remains opaque per STABILITY contract; the layout is implementation
  detail. **Migration note**: do not compare `EntityId` numbers directly
  (`eid === 42` will break across slot recycles); use
  `getEntityIndex(eid)` for index comparison or `refOf(world, eid).id` for
  identity matching that survives slot reuse.
- **`getEntityGeneration` / `packEntity` graduate to `stable`** (were `experimental`
  since 0.2.0). Both now return real values. These functions use default 24/8 bit
  layout; for non-default `createWorld({ indexBits, generationBits })`, use
  `EntityRef` and `deref` instead of manual unpacking.

### Fixed

- **ABA bug on entity slot recycle**: previously `entityExists` and `isAliveInternal`
  only checked archetype membership; a stale `EntityId` pointing at a recycled slot
  would silently report alive. With packed generation + `deref` generation match,
  stale refs now correctly invalidate.
- **`destroyEntity` generation wrap mask aligned with `options.generationBits`**
  (was hard-coded `& 0xffff`). The mask now correctly uses
  `state.options.generationMask`, fixing inconsistency for non-default
  `generationBits` values.

### Documentation

- `onSet` JSDoc clarifies that `addComponent` does NOT trigger `onSet`, and
  direct writes to column views returned by `getComponent` (e.g. `col.x[idx] = 5`)
  also do NOT trigger `onSet`. Only `setComponent` on an already-present
  component fires the callback. Anti-pattern example included.

### Compatibility

- `EntityId` layout change is **not** breaking at the type system level (opaque
  branded number), but consumers who relied on `eid === N` direct comparison
  will need to migrate (see Migration note above).
- All existing `stable` exports unchanged.
- `aiecsjs/worker` snapshot wire format unchanged (still uses raw indices).
- `aiecsjs/serialize` wire format unchanged.

### Build & tooling

- `VERSION` constant bumped to `0.3.0`.

## [0.2.1] - 2026-05-28

### Security

- **Resolve two Dependabot moderate advisories** on the transitive dev-only graph by upgrading `vitest` 1.6.0 → 4.1.7. Adds `vite` 8.0.14 as a direct devDependency to satisfy vitest 4's peer range (`^6 || ^7 || ^8`). These are dev-only — runtime surface unchanged.
  - [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) `esbuild <=0.24.2` CORS development server data leak (fixed in 0.25.0).
  - [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) `vite <=6.4.1` path traversal in optimized deps `.map` handling (fixed in 6.4.2 / 7.3.2 / 8.0.5).

### Changed

- **README opening unified across the ai*js family**: five-badge shields row (npm + CI + License + AI Generated + 繁體中文/English), one-line tagline as blockquote, ecosystem footer linking to the other two packages. Replaces the previous mixed style (text language switcher + 5 ad-hoc badges).
- **`VERSION` constant bumped to 0.2.1** ([src/version.ts](src/version.ts)) so `world.version` and snapshot meta reflect this release.

Runtime surface unchanged. Production bundles are byte-identical to 0.2.0.

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
