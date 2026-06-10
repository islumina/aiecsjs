# Stability Contract

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
| `getEntityGeneration` | stable | 0.3.0 | Returns real generation value packed into EntityId (default 24-bit index, 8-bit generation). For non-default `createWorld({ indexBits, generationBits })`, use `EntityRef` + `deref` instead. |
| `packEntity` | stable | 0.3.0 | Packs index + generation into an EntityId using default 24/8 bit layout. For non-default bit sizes, use `EntityRef` + `deref` instead. |
| `refOf` | stable | 0.3.0 | Throws `EntityNotAliveError` for dead entity. |
| `deref` | stable | 0.3.0 | Returns null for stale / cross-world refs; never throws. |
| `aliveRef` | stable | 0.3.0 | Boolean guard form of `deref`; never throws. |
| `EntityRef` (type) | stable | 0.3.0 | In-memory only; not serializable. |
| `EcsError` | stable | 0.5.6 | Base error for core invariant failures (bad world options, destroyed/unknown world, exhausted component slots, capacity overflow). `instanceof`-catchable; `aiecsjs:`-prefixed message. |
| `EntityNotAliveError` | stable | 0.3.0 | Thrown only by `refOf`. |
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

**Reactive query must-drain contract (`enterQuery` / `exitQuery`).** The enter and exit buffers are **unbounded** — there is no cap and no drop-oldest policy. Each structural change that flips an entity into (enter) or out of (exit) a query pushes exactly one id; the buffer shrinks only when the reactive view is read (`runQuery`, `iterQuery`, `forEachEntity`, `forEachEntityIndexed`). A view that is created but never read — a disabled system, or reading only one of the enter/exit pair — accumulates one number per matching event for the lifetime of the world, which is an unbounded memory leak under churn. **Read every reactive view you create, once per frame.** Capping is deliberately omitted: silently dropping ids would break enter/exit symmetry, so draining is the caller's contract, not the library's.

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

### `aiecsjs/relations` (stable sub-path since 0.4.0)

The relations sub-path is **stable** as of 0.4.0. The graph API (`defineRelation`, `addRelation`, `removeRelation`, `getRelationTargets`, `getRelationData`) and the built-in `ChildOf` relation are frozen for the 1.x track.

**Raw slot-keying ABA semantic:** relation storage keys edges by raw entity slot index (`entityId & indexMask`), not by the full packed EntityId (which includes a generation counter). If entity A is destroyed and a different entity B is later created occupying the same slot, B will inherit A's outgoing and incoming edges unless the destroy cleanup hook ran. The cleanup hook fires automatically when `destroyEntity` is called, so normal usage is safe. Callers holding cached EntityId values across destroy/recreate cycles should validate liveness with `entityExists` before reading relation data if ABA is a concern.

| Export | Stability | Since | Notes |
|---|---|---|---|
| `defineRelation` | stable | 0.1.0 | |
| `addRelation` | stable | 0.1.0 | |
| `removeRelation` | stable | 0.1.0 | |
| `getRelationTargets` | stable | 0.1.0 | |
| `ChildOf` (constant) | stable | 0.1.0 | Built-in exclusive relation. |
| `getRelationData` | stable | 0.4.0 | Returns the data payload attached via `addRelation`, or `undefined` if no such edge or no data was stored. Subject to the raw slot-keying ABA semantic described above. |

### `aiecsjs/internal/*`

Everything under this prefix is **internal**. It exists for the implementation's own use and may break in any release. Do not import.

## Roadmap

| Version | Focus | Stability shift |
|---|---|---|
| 0.1.x | Core surface (world, entity, component, query, system, loop, commands, observers, serialize) | Initial publish; all marked experimental at the package level but per-export stable where listed. |
| 0.2.0 | Safety + alignment | Prototype-pollution hardening, observer `{ signal? }`, `disposeWorld` alias, `getEntityGeneration` / `packEntity` re-labelled experimental, `verify:llms` gate. See [CHANGELOG.md](./CHANGELOG.md#020---2026-05-28). |
| 0.3.x | EntityRef + generation packing | ABA-safe; `getEntityGeneration` / `packEntity` → stable. |
| 0.4.0 | Relations stabilisation | `aiecsjs/relations` graduated to stable; `getRelationData` added. `aiecsjs/worker` remains experimental (true SAB shared-memory columns deferred). |
| 0.6+ | Multi-World snapshot diff transport (placeholder) | experimental — design TBD. |
| 1.0.0 | API freeze | All `stable` exports frozen for 1.x. |

## How to check stability at runtime

```ts
import { VERSION } from 'aiecsjs'

if (VERSION.startsWith('0.')) {
  console.warn('aiecsjs is in pre-1.0; API surface may shift')
}
```

For programmatic introspection, parse [`api.json`](./api.json) — each entry has `stability` and `since` fields.
