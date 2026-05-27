# Changelog

🌐 [English](CHANGELOG.md) | [繁體中文](CHANGELOG.zh-TW.md)

All notable changes to `aiecsjs` are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for 0.2

- Implement `aiecsjs/relations`: `defineRelation`, `addRelation`, `removeRelation`, `getRelationTargets`, `ChildOf`.
- Add `pipeAsync` for async system composition.
- Doc-test harness so README code blocks are mechanically verified.

### Planned for 0.3

- Promote `aiecsjs/relations` and `aiecsjs/worker` to `stable`.
- Stabilize the network delta wire format.
- Add automated benchmark suite committed to repo.

### Planned for 1.0

- API freeze for the 1.x line.
- Drop the experimental status label.

## [0.1.0] - 2026-05-27

**Initial release.** All 50 documented exports across 7 modules are implemented and covered by 84 passing Vitest behaviour tests. Built with tsup to dual ESM + CJS, ships `.d.ts` declarations and source maps.

### Implementation notes

- **Storage**: world-level TypedArray columns per SoA component field, sized to world capacity. Archetypes track entity membership (a `Uint32Array entities[]`) but do not own column data. This makes archetype migration O(1) and lets `Position.x[eid]` work directly without per-archetype indirection. Trade-off: iteration over archetypes reads columns at potentially non-contiguous offsets; for hot data this stays in L1.
- **EntityId is unversioned in 0.1**: `EntityId` is the entity index. Generation is tracked internally for slot reuse but not encoded in the ID. `getEntityIndex` / `getEntityGeneration` / `packEntity` are identity helpers. ABA-safe references via a separate `EntityRef` type are planned for 0.2.
- **Bitmask queries**: multi-word Uint32 masks, default 8 words (256 components). Per-world bit allocation, global component identity.
- **Worker / SAB**: 0.1 implements snapshot-copy semantics (serialize-into-SAB on send, deserialize-on-adopt) rather than true shared-memory column aliasing. The API surface matches the documented contract; true shared columns ship in 0.2.
- **Binary serialization**: a JSON payload wrapped in a 4-byte magic + version header. Compact binary column encoding is planned for 0.2.

### Added

- `README.md` (English) and `README.zh-TW.md` (Traditional Chinese) with quick start, guide, API reference, performance notes, multi-threading guide, WebGPU interop section, serialization guide, migration guides, and "For AI Agents" section.
- `llms.txt` — Jeremy Howard format AI-discovery file.
- `llms-full.txt` — Single-file complete reference for LLM consumption.
- `api.json` — Machine-readable export manifest with stability and `since` fields on every entry.
- `STABILITY.md` and `STABILITY.zh-TW.md` — Per-export stability contract.
- `docs/MIGRATION.md` and `docs/MIGRATION.zh-TW.md` — Migration guides from bitECS 0.4, miniplex 2.0, and ECSY.

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
