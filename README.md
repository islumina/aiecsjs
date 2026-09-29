# aiecsjs

TypeScript-first archetype ECS with TypedArray SoA components, command buffers, relations, serialization, and SAB-ready snapshot transport.

> **Status: 0.6.0 - stable 1.0-track core.** Root ECS APIs are stable; worker transport remains adapter-shaped and environment-dependent. 0.6.0 has breaking changes (snapshot format 2, stricter validation): see the [CHANGELOG](CHANGELOG.md).

## Install

```bash
pnpm add aiecsjs
```

```ts
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineQuery,
  forEachEntityIndexed,
} from "aiecsjs";
```

## Quick Start

```ts
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });

const world = createWorld({ initialCapacity: 1024 });
const e = createEntity(world);
addComponent(world, e, Position, { x: 0, y: 0 });
addComponent(world, e, Velocity, { x: 1, y: 0 });

// SoA columns are TypedArrays; index them with `i`, the entity's slot index.
const movers = defineQuery([Position, Velocity]);
forEachEntityIndexed(world, movers, (entity, i, pos, vel) => {
  pos.x[i] += vel.x[i];
  pos.y[i] += vel.y[i];
});
```

Use `defineTag()` for marker components and `defineObjectComponent()` when you need object references instead of TypedArray storage. Do not index columns with the packed `entity` id: it stops matching the slot once a slot is recycled.

## Public Surface

| Import | Purpose |
| --- | --- |
| `aiecsjs` | World/entity/component/query/system helpers, `Types`, refs, errors, `VERSION`. |
| `aiecsjs/loop` | `createLoop()` for fixed-step style loops. |
| `aiecsjs/commands` | `createCommandBuffer()`, `flush()`, `withCommandBuffer()` for deferred structural changes. |
| `aiecsjs/observers` | `onAdd`, `onRemove`, `onSet`, `observe`. |
| `aiecsjs/serialize` | Binary/JSON world snapshots and delta serializer. |
| `aiecsjs/worker` | Transfer/adopt/attach helpers for worker snapshots. |
| `aiecsjs/relations` | `defineRelation`, `ChildOf`, relation add/remove/read helpers. |

## Snapshots

`toJSON` / `serializeWorld` write snapshot format 2: entity data plus a table of the components it uses (stable key, kind, SoA fields). Give every component you save a `key`, so a loading session can define its components in any order:

```ts
const Position = defineComponent({ x: Types.f32, y: Types.f32 }, { key: "position" });
const Player = defineTag({ key: "player" });

const bytes = serializeWorld(world); // aiecsjs/serialize
const restored = deserializeWorld(bytes); // or fromJSON(toJSON(world))
```

- Loading resolves every component before it creates the world: by key, or by creation-order id for keyless components. It throws `EcsError` when a component is not defined in this process (pass `onUnknownComponent: "skip"` to drop its data) or when its kind or SoA fields differ.
- 0.5.x snapshots are rejected with `EcsError` by default; `{ onUnknownVersion: "best-effort" }` loads them by id with a kind check. See [0.5.x -> 0.6.0 snapshots](docs/MIGRATION.md#05x---060-snapshots).
- Restored entities get fresh ids in snapshot order (holes in the slot range close up), so EntityIds stored inside component data are not remapped. Delta `apply()` keeps slot indices.

## Relations

```ts
import { ChildOf, addRelation, getRelationTargets } from "aiecsjs/relations";

addRelation(world, child, ChildOf, parent);
getRelationTargets(world, child, ChildOf); // [parent]
```

- `addRelation` throws `EcsError` for a dead source or target, mirroring `addComponent`. Check `entityExists` first when an endpoint may be stale.
- `destroyEntity` and `resetWorld` drop every edge of the entities they remove; `removeRelation` is a no-op for dead endpoints.

## Errors

- Misuse and invariant failures throw `EcsError` (message `aiecsjs: ...`) before any change is made: non-integer world options, dead entities, unknown components, invalid component keys, non-function callbacks (observer handlers, `forEachEntity`, `withCommandBuffer`, `pipe` systems, AoS factories) and snapshot errors.
- A world from `attachWorld(buffer, { readOnly: true })` rejects every mutator with `EcsError`: `createEntity`, `destroyEntity`, `addComponent`, `removeComponent`, `setComponent`, `resetWorld`, `addRelation`, `removeRelation` and delta `apply()`.
- `defineComponent` field-declaration errors and non-Query input to query functions throw `TypeError`. `createLoop` (`aiecsjs/loop` has no error class) throws `TypeError` / `RangeError`.

## Sharp Edges

- Structural mutation during a query loop is allowed by the library, but app systems should prefer `withCommandBuffer()` when adding/removing/destroying entities from inside iteration.
- Reactive query buffers are unbounded until drained. Poll and clear them every frame or event tick.
- Queries are cached process-wide, and a structural change visits every reactive (enter/exit) source query that references the changed component, whichever world registered it.
- Exclusive relation cleanup is `O(incoming)` on destroy for the exclusive-slot reverse index, but every destroy also walks all relation `data` payload sources and all `outgoing` (non-exclusive) edge lists — cost is `O(incoming + data sources + outgoing sources)` across all relations, even for entities with no relations at all.
- Serialization restores capacity with safety clamps, but snapshots from untrusted sources should still be treated as hostile input.
- Worker/SAB helpers depend on the runtime environment. Feature-detect `SharedArrayBuffer` and cross-origin isolation in browsers.
- `pnpm lint` reports 84 `noExplicitAny` warnings, mostly casts in tests plus the public query callback types. They are not release-blocking.

## AI Context

- Short index: [`llms.txt`](llms.txt)
- Full generated context: [`llms-full.txt`](llms-full.txt)
- Stability contract: [`STABILITY.md`](STABILITY.md)
- Current review backlog: [`REVIEW.md`](REVIEW.md)
- Machine-readable API: [`api.json`](api.json)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
