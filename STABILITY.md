# Stability Contract

aiecsjs keeps the root ECS surface stable and treats subpaths as explicit public modules.

## Stable Surface

| Surface | Status | Notes |
| --- | --- | --- |
| `aiecsjs` root | Stable | World/entity/component/query/system helpers, `Types`, refs, `VERSION`, `EcsError`. |
| `aiecsjs/loop` | Stable utility | Loop helper only; scheduler policy remains app-owned. |
| `aiecsjs/commands` | Stable utility | Command buffers for deferred structural mutations. |
| `aiecsjs/observers` | Stable utility | Add/remove/set observer helpers. |
| `aiecsjs/serialize` | Stable utility | Binary and JSON snapshots with capacity clamps. |
| `aiecsjs/worker` | Experimental adapter | Environment-dependent SAB/transfer helpers. |
| `aiecsjs/relations` | Stable | Relations and `ChildOf`; destroy cleanup cost remains documented. |
| `aiecsjs/internal/*` | Private | No compatibility guarantee. |

## Behavioral Boundaries

- Entity ids are generational numeric ids. Use refs (`refOf`, `deref`, `aliveRef`) when storing ids across time.
- Query iteration is synchronous and direct. Use command buffers for structural changes inside systems.
- Reactive query buffers must be drained by the caller.
- Serialization accepts trusted snapshots; hostile input is bounded but not a sandbox.
- No build-mode-gated runtime validation policy is promised.
- Worker support depends on `SharedArrayBuffer`, transfer support, and browser isolation policy.

## Current Caveats

- Reactive query registration scans a module-level query cache on structural changes.
- Exclusive relation cleanup scans relation capacity when an entity is destroyed.
- Lint has many `noExplicitAny` warnings pending cleanup.
