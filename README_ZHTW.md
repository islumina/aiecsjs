# aiecsjs

TypeScript-first archetype ECS，提供 TypedArray SoA component、command buffer、relations、serialization，以及 SAB-ready snapshot transport。

> **狀態：0.6.0 - 穩定 1.0 軌道核心。** Root ECS API 穩定；worker transport 仍取決於執行環境。0.6.0 含破壞性變更（snapshot format 2、更嚴格的參數驗證），請見 [CHANGELOG](CHANGELOG.md)。

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
  defineQuery,
  forEachEntityIndexed,
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

// SoA columns are TypedArrays; index them with `i`, the entity's slot index.
const movers = defineQuery([Position, Velocity]);
forEachEntityIndexed(world, movers, (entity, i, pos, vel) => {
  pos.x[i] += vel.x[i];
  pos.y[i] += vel.y[i];
});
```

marker component 用 `defineTag()`；需要物件參照而非 TypedArray storage 時用 `defineObjectComponent()`。SoA 欄位是 TypedArray，請用 slot 索引 `i` 存取；不要用封裝後的 `entity` id 索引欄位，slot 被回收後它就不再等於 slot 索引。

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

## Snapshot

`toJSON` / `serializeWorld` 會寫出 snapshot format 2：entity 資料，加上這些資料用到的 component 表（穩定 key、kind、SoA 欄位）。請為每個要存檔的 component 指定 `key`，載入端就能以任意順序定義 component：

```ts
const Position = defineComponent({ x: Types.f32, y: Types.f32 }, { key: "position" });
const Player = defineTag({ key: "player" });

const bytes = serializeWorld(world); // aiecsjs/serialize
const restored = deserializeWorld(bytes); // or fromJSON(toJSON(world))
```

- 載入時會先解析所有 component，再建立 world：有 key 的依 key 對應，沒有 key 的依建立順序 id 對應。component 在目前行程中未定義時丟出 `EcsError`（傳入 `onUnknownComponent: "skip"` 可略過該 component 的資料）；kind 或 SoA 欄位不符時也丟出 `EcsError`。
- 0.5.x snapshot 預設以 `EcsError` 拒絕；`{ onUnknownVersion: "best-effort" }` 會依 id 載入並檢查 kind。請見 [0.5.x -> 0.6.0 snapshots](docs/MIGRATION_ZHTW.md#05x---060-snapshots)。
- 還原後的 entity 依 snapshot 順序取得新 id（slot 範圍中的空洞會被補齊），因此存在 component 資料中的 EntityId 不會重新對應。Delta `apply()` 會保留 slot 索引。

## Relations

```ts
import { ChildOf, addRelation, getRelationTargets } from "aiecsjs/relations";

addRelation(world, child, ChildOf, parent);
getRelationTargets(world, child, ChildOf); // [parent]
```

- `addRelation` 在 source 或 target 已不存在時丟出 `EcsError`，與 `addComponent` 一致。端點可能已過期時，請先用 `entityExists` 檢查。
- `destroyEntity` 與 `resetWorld` 會移除被刪除 entity 的所有 edge；`removeRelation` 對已不存在的端點不做任何事。

## 錯誤

- 誤用與不變式違反會在做任何變更前丟出 `EcsError`（訊息為 `aiecsjs: ...`）：非整數的 world 選項、已不存在的 entity、未知的 component、無效的 component key、不是函式的 callback（observer handler、`forEachEntity`、`withCommandBuffer`、`pipe` system、AoS factory），以及 snapshot 錯誤。
- 由 `attachWorld(buffer, { readOnly: true })` 取得的 world 會以 `EcsError` 拒絕所有 mutator：`createEntity`、`destroyEntity`、`addComponent`、`removeComponent`、`setComponent`、`resetWorld`、`addRelation`、`removeRelation` 與 delta `apply()`。
- `defineComponent` 欄位宣告錯誤，以及傳給 query 函式的非 Query 輸入，會丟出 `TypeError`。`createLoop`（`aiecsjs/loop` 沒有錯誤類別）會丟出 `TypeError` / `RangeError`。

## 注意事項

- Query loop 期間可以 structural mutation，但在 system 內 add/remove/destroy entity 時建議用 `withCommandBuffer()`。
- Reactive query buffers 在 drain 前沒有上限。請每 frame 或每 event tick poll 並清空。
- Query 在整個行程中共用快取；structural change 會走訪所有參照到該 component 的 reactive（enter/exit）source query，不論它由哪個 world 註冊。
- Exclusive relation cleanup 的 exclusive-slot reverse index 部分在 destroy 時為 `O(incoming)`，但每次 destroy 仍會掃過所有 relation 的 `data` payload sources 與 `outgoing`（非 exclusive）edge lists——整體成本是 `O(incoming + data sources + outgoing sources)`（跨所有 relations 加總），即使該 entity 根本沒有任何 relation 也一樣。
- Serialization restore capacity 有安全 clamp，但不可信 snapshot 仍應視為 hostile input。
- Worker/SAB helper 取決於環境。瀏覽器中請 feature-detect `SharedArrayBuffer` 與 cross-origin isolation。
- `pnpm lint` 目前回報 84 個 `noExplicitAny` warnings，多數是測試中的轉型，另有公開的 query callback 型別；不阻擋 release。

## AI Context

- 短索引：[`llms.txt`](llms.txt)
- 完整生成內容：[`llms-full.txt`](llms-full.txt)
- 穩定度契約：[`STABILITY.md`](STABILITY.md)
- 目前 review backlog：[`REVIEW.md`](REVIEW.md)
- 機器可讀 API：[`api.json`](api.json)
- 版本紀錄：[`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
