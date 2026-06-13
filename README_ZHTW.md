# aiecsjs

TypeScript-first archetype ECS，提供 TypedArray SoA component、command buffer、relations、serialization，以及 SAB-ready snapshot transport。

> **狀態：0.5.7 - 穩定 1.0 軌道核心。** Root ECS API 穩定；worker transport 仍取決於執行環境。

## 安裝

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

## 快速開始

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

marker component 用 `defineTag()`；需要物件參照而非 TypedArray storage 時用 `defineObjectComponent()`。

## Public Surface

| Import | 用途 |
| --- | --- |
| `aiecsjs` | World/entity/component/query/system helpers、`Types`、refs、errors、`VERSION`。 |
| `aiecsjs/loop` | `createLoop()` 固定步進 loop helper。 |
| `aiecsjs/commands` | `createCommandBuffer()`、`flush()`、`withCommandBuffer()`，用於延後 structural changes。 |
| `aiecsjs/observers` | `onAdd`、`onRemove`、`onSet`、`observe`。 |
| `aiecsjs/serialize` | Binary/JSON world snapshot 與 delta serializer。 |
| `aiecsjs/worker` | worker snapshot 的 transfer / adopt / attach helpers。 |
| `aiecsjs/relations` | `defineRelation`、`ChildOf` 與 relation add/remove/read helpers。 |

## 注意事項

- Query loop 期間可以 structural mutation，但在 system 內 add/remove/destroy entity 時建議用 `withCommandBuffer()`。
- Reactive query buffers 在 drain 前沒有上限。請每 frame 或每 event tick poll 並清空。
- Query registration 目前使用全域 module cache；大量 worlds/components 會讓 structural change 掃描較多 query metadata。
- Exclusive relation cleanup 在 destroy 時掃 relation capacity；大型稀疏 relation table 會讓 destroy 成本變明顯。
- Serialization restore capacity 有安全 clamp，但不可信 snapshot 仍應視為 hostile input。
- Worker/SAB helper 取決於環境。瀏覽器中請 feature-detect `SharedArrayBuffer` 與 cross-origin isolation。
- `pnpm lint` 目前仍有大量 `noExplicitAny` warnings；不阻擋 release，但會增加 AI review 雜訊。

## AI Context

- 短索引：[`llms.txt`](llms.txt)
- 完整生成內容：[`llms-full.txt`](llms-full.txt)
- 穩定度契約：[`STABILITY.md`](STABILITY.md)
- 目前 review backlog：[`REVIEW.md`](REVIEW.md)
- 機器可讀 API：[`api.json`](api.json)
- 版本紀錄：[`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
