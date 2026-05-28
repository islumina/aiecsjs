# Stability Contract

[English](STABILITY.md) | [繁體中文](STABILITY_ZHTW.md)

This document is the per-export stability promise for `aiecsjs`. It is the contract AI tools and human users can rely on when pinning versions and writing import paths.

## Policy

aiecsjs follows [semver](https://semver.org/). Within the **0.x** series:
- **`stable`** exports do not change in breaking ways across minor versions (e.g. 0.1 → 0.2).
- **`experimental`** exports may change shape, name, or behaviour in any minor release. Pin the exact version if you depend on them.
- **`internal`** is not part of the API. May change in any patch release. Do not import.
- **`deprecated`** still works as documented but is scheduled for removal. The deprecation notice states the target version.

At **1.0**, the `stable` surface freezes for the entire 1.x series.

The full machine-readable export list lives in [`api.json`](./api.json), with the `stability` and `since` fields on every entry.

## By module

The **root** entry (`aiecsjs`) is the stable core: world, entity, component, query, system. Everything under a sub-path (`aiecsjs/<name>`) is a **utility or adapter sub-path** — useful but non-essential, decoupled from the core, and importable a la carte. Tree-shakers should be able to drop any sub-path the application does not import.

### `aiecsjs` (root core)

| Export | Stability | Since | Notes |
|---|---|---|---|
| `createWorld` | stable | 0.1.0 | |
| `disposeWorld` | stable | 0.2.0 | Alias for `destroyWorld`; aligns with the ai*js ecosystem `dispose()` convention. Prefer this name in new code. |
| `destroyWorld` | **deprecated** | 0.1.0 | Use `disposeWorld` instead. Scheduled for removal in 1.0. |
| `resetWorld` | stable | 0.1.0 | |
| `getWorldSize` | stable | 0.1.0 | |
| `getWorldCapacity` | stable | 0.1.0 | |
| `createEntity` | stable | 0.1.0 | |
| `destroyEntity` | stable | 0.1.0 | |
| `entityExists` | stable | 0.1.0 | |
| `getEntityIndex` | stable | 0.1.0 | |
| `getEntityGeneration` | **experimental** | 0.1.0 | Returns 0 in 0.x (generation tracked internally but not encoded in EntityId). Real values arrive with ABA-safe `EntityRef` in **0.3+**. |
| `packEntity` | **experimental** | 0.1.0 | Identity helper in 0.x. Returns the index unchanged. Real packing arrives with `EntityRef` in **0.3+**. |
| `defineComponent` | stable | 0.1.0 | |
| `defineTag` | stable | 0.1.0 | |
| `defineObjectComponent` | stable | 0.1.0 | AoS components are main-thread only; not SAB-shareable. |
| `addComponent` | stable | 0.1.0 | Argument order `(world, eid, component, init?)` is final. |
| `removeComponent` | stable | 0.1.0 | |
| `hasComponent` | stable | 0.1.0 | |
| `getComponent` | stable | 0.1.0 | |
| `setComponent` | stable | 0.1.0 | |
| `Types` | stable | 0.1.0 | Constant map; field names are part of the contract. |
| `defineQuery` | stable | 0.1.0 | |
| `runQuery` | stable | 0.1.0 | |
| `forEachEntity` | stable | 0.1.0 | |
| `iterQuery` | stable | 0.1.0 | |
| `enterQuery` | stable | 0.1.0 | |
| `exitQuery` | stable | 0.1.0 | |
| `queryArchetypes` | **experimental** | 0.1.0 | `Archetype.id` is opaque-internal; the shape of `Archetype` may grow. |
| `pipe` | stable | 0.1.0 | |
| `VERSION` | stable | 0.1.0 | |
| `IS_SAB_SUPPORTED` | stable | 0.1.0 | |
| `isWorld` | stable | 0.1.0 | |
| `isEntity` | stable | 0.1.0 | |

### `aiecsjs/loop` (utility sub-path)

Fixed-timestep accumulator loop. Drop this sub-path if you already drive frame updates yourself (PixiJS `Ticker`, requestAnimationFrame, server-side simulation).

| Export | Stability | Since | Notes |
|---|---|---|---|
| `createLoop` | stable | 0.1.0 | |

### `aiecsjs/commands` (utility sub-path)

Deferred structural mutations so systems can mutate world structure mid-iteration without invalidating queries.

| Export | Stability | Since | Notes |
|---|---|---|---|
| `createCommandBuffer` | stable | 0.1.0 | |
| `flush` | stable | 0.1.0 | |
| `withCommandBuffer` | stable | 0.1.0 | |

### `aiecsjs/observers` (utility sub-path)

Component lifecycle hooks. The core does not require observers; install this sub-path only if a system needs add/remove/set callbacks.

| Export | Stability | Since | Notes |
|---|---|---|---|
| `observe` | stable | 0.1.0 | Accepts `{ signal?: AbortSignal }` since 0.2.0. |
| `onAdd` | stable | 0.1.0 | Accepts `{ signal?: AbortSignal }` since 0.2.0. |
| `onRemove` | stable | 0.1.0 | Accepts `{ signal?: AbortSignal }` since 0.2.0. |
| `onSet` | stable | 0.1.0 | Low-level mutation hook; NOT a reactive value-predicate query. Accepts `{ signal?: AbortSignal }` since 0.2.0. |

### `aiecsjs/serialize` (utility sub-path)

| Export | Stability | Since | Notes |
|---|---|---|---|
| `serializeWorld` | stable | 0.1.0 | Binary format includes a version stamp. |
| `deserializeWorld` | stable | 0.1.0 | |
| `toJSON` | stable | 0.1.0 | |
| `fromJSON` | stable | 0.1.0 | |
| `createDeltaSerializer` | **experimental** | 0.1.0 | Wire format may change before 1.0. |

### `aiecsjs/worker` (experimental adapter sub-path)

The entire subpath is **experimental** in 0.x. **In 0.x the implementation is a snapshot-copy transport** — serialize the world into the SAB on send, deserialize into a fresh world on adopt. It is not true shared-memory column aliasing. The API surface matches the documented contract; true shared columns are targeted for **0.3+**. Snapshot layout and capability flags may change.

| Export | Stability | Since | Notes |
|---|---|---|---|
| `transferableSnapshot` | experimental | 0.1.0 | |
| `adoptSnapshot` | experimental | 0.1.0 | |
| `attachWorld` | experimental | 0.1.0 | |
| `detachWorld` | experimental | 0.1.0 | |

### `aiecsjs/relations` (experimental adapter sub-path)

The entire subpath is **experimental** in 0.1 but implemented. Targeted for stabilization in 0.3.

| Export | Stability | Since | Notes |
|---|---|---|---|
| `defineRelation` | experimental | 0.1.0 | |
| `addRelation` | experimental | 0.1.0 | |
| `removeRelation` | experimental | 0.1.0 | |
| `getRelationTargets` | experimental | 0.1.0 | |
| `ChildOf` (constant) | experimental | 0.1.0 | Built-in exclusive relation. |

### `aiecsjs/internal/*`

Everything under this prefix is **internal**. It exists for the implementation's own use and may break in any release. Do not import.

## Roadmap

| Version | Focus | Stability shift |
|---|---|---|
| 0.1.x | Core surface (world, entity, component, query, system, loop, commands, observers, serialize) | Initial publish; all marked experimental at the package level but per-export stable where listed. |
| 0.2.0 | Safety + alignment | Prototype-pollution hardening, observer `{ signal? }`, `disposeWorld` alias, `getEntityGeneration` / `packEntity` re-labelled experimental, `verify:llms` gate. See [CHANGELOG.md](./CHANGELOG.md#020---2026-05-28). |
| 0.3+ | Relations stabilisation + EntityRef + SAB | `aiecsjs/relations` graduates to stable; ABA-safe `EntityRef` lands and `getEntityGeneration` / `packEntity` start returning real values; `aiecsjs/worker` adopts true shared-memory column aliasing. |
| 0.3.x | Hardening, relations stabilization, multi-threading polish | `aiecsjs/relations` and `aiecsjs/worker` → stable. |
| 1.0.0 | API freeze | All `stable` exports frozen for 1.x. |

## How to check stability at runtime

```ts
import { VERSION } from 'aiecsjs'

if (VERSION.startsWith('0.')) {
  console.warn('aiecsjs is in pre-1.0; API surface may shift')
}
```

For programmatic introspection, parse [`api.json`](./api.json) — each entry has `stability` and `since` fields.
