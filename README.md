# aiecsjs

TypeScript-first archetype ECS with TypedArray SoA components, command buffers, relations, serialization, and SAB-ready snapshot transport.

> **Status: 0.5.7 - stable 1.0-track core.** Root ECS APIs are stable; worker transport remains adapter-shaped and environment-dependent.

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
  forEachEntity,
  getComponent,
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

forEachEntity(world, [Position, Velocity], (entity) => {
  const pos = getComponent(world, entity, Position);
  const vel = getComponent(world, entity, Velocity);
  pos.x += vel.x;
  pos.y += vel.y;
});
```

Use `defineTag()` for marker components and `defineObjectComponent()` when you need object references instead of TypedArray storage.

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

## Sharp Edges

- Structural mutation during a query loop is allowed by the library, but app systems should prefer `withCommandBuffer()` when adding/removing/destroying entities from inside iteration.
- Reactive query buffers are unbounded until drained. Poll and clear them every frame or event tick.
- Query registration currently uses a global module cache; many worlds/components can make structural changes scan more query metadata than expected.
- Exclusive relation cleanup scans relation capacity on destroy. Large sparse relation tables can make destroy cost visible.
- Serialization restores capacity with safety clamps, but snapshots from untrusted sources should still be treated as hostile input.
- Worker/SAB helpers depend on the runtime environment. Feature-detect `SharedArrayBuffer` and cross-origin isolation in browsers.
- `pnpm lint` currently reports many `noExplicitAny` warnings. They are not release-blocking, but they add AI-review noise.

## AI Context

- Short index: [`llms.txt`](llms.txt)
- Full generated context: [`llms-full.txt`](llms-full.txt)
- Stability contract: [`STABILITY.md`](STABILITY.md)
- Current review backlog: [`REVIEW.md`](REVIEW.md)
- Machine-readable API: [`api.json`](api.json)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
