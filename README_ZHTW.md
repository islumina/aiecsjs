# aiecsjs

[![npm version](https://img.shields.io/npm/v/aiecsjs.svg)](https://www.npmjs.com/package/aiecsjs)
[![CI](https://github.com/yshengliao/aiecsjs/actions/workflows/ci.yml/badge.svg)](https://github.com/yshengliao/aiecsjs/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)
[![AI Generated](https://img.shields.io/badge/AI_Generated-Claude_Code_Opus_4.7_Max-blueviolet.svg)](https://www.anthropic.com/claude-code)
[![English](https://img.shields.io/badge/lang-English-blue.svg)](README.md)

> 為 TypeScript 而設計的原型式 ECS，支援瀏覽器與 Node，內建 SAB 快照傳輸（snapshot transport）與 AI 可讀文件。

隸屬 [ai\*js micro-runtime 生態系](https://github.com/yshengliao) ─ 另見 [aifsmjs](https://github.com/yshengliao/aifsmjs)（FSM）與 [aibridgejs](https://github.com/yshengliao/aibridgejs)（cross-context RPC）。

aiecsjs 採用 **原型表格搭配 TypedArray 欄位** 與 **位元遮罩查詢**，這正是 piecs 與 wolf-ecs 在公開效能評測中名列前茅所採用的架構。API 為 **函式式且可 tree-shake**，以 `pipe()` 組合。元件（Component）同時支援 SoA（結構陣列）與 AoS（結構物件）兩種佈局。自 0.3 起，`EntityId` 將 index 與 generation 打包為單一 32-bit 數字；具 ABA 安全的 `EntityRef` API 已於 0.3.0 正式推出。

```ts
import { createWorld, createEntity, defineComponent, defineQuery, pipe, forEachEntity, Types } from 'aiecsjs'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

const world = createWorld()
const eid = createEntity(world)
addComponent(world, eid, Position, { x: 0, y: 0 })
addComponent(world, eid, Velocity, { x: 1, y: 2 })

const movers = defineQuery([Position, Velocity])
const movement = (w, dt) => { forEachEntity(w, movers, (e, pos, vel) => { pos.x[e] += vel.x[e] * dt; pos.y[e] += vel.y[e] * dt }); return w }

pipe(movement)(world, 1/60)
```

> **狀態：實驗版（v0.1.x）。** `STABILITY.md` 中載明的 API 表面在 0.x 系列內承諾穩定，但仍可能微調。1.0 穩定凍結會在收集社群回饋後執行。

## 目錄

- [為什麼選 aiecsjs？](#為什麼選-aiecsjs)
- [安裝](#安裝)
- [快速上手](#快速上手)
- [核心概念](#核心概念)
- [使用指引](#使用指引)
- [API 參考](#api-參考)
- [效能](#效能)
- [多執行緒指引](#多執行緒指引)
- [WebGPU 互通](#webgpu-互通)
- [序列化指引](#序列化指引)
- [移轉指引](#移轉指引)
- [給 AI 助手](#給-ai-助手)
- [常見問答](#常見問答)
- [注意事項與已知限制](#注意事項與已知限制)
- [貢獻](#貢獻)
- [變更紀錄](#變更紀錄)
- [授權](#授權)

## 為什麼選 aiecsjs？

- **原型優先儲存** — 擁有相同元件集合的實體共用一張連續表格；查詢時直接以 `for` 迴圈走訪平行的 TypedArray。從架構上就保證快取友善。
- **零設定的 TypeScript 推導** — `defineQuery([Position, Velocity])` 回傳的迭代器會丟出 `(eid, posCols, velCols)`，欄位型別自動從 `defineComponent` 推導。不必手寫泛型。
- **AI 優先的文件契約** — 每個公開匯出都有穩定度標籤與 `since` 版本。內建 `llms.txt`、`llms-full.txt`、`api.json`，讓 LLM 工具直接讀懂 API 表面。

### 與其他函式庫比較

| 項目 | aiecsjs 0.1 | bitECS 0.4 | miniplex 2.0 | becsy 0.15 |
|---|---|---|---|---|
| 儲存模型 | 原型 + SoA 欄位 | SparseSet + bitmask + SoA/AoS | 原型 + JS 物件 | 可選（packed/sparse/compact）+ ArrayBuffer |
| API 風格 | 函式式 + `pipe` | 函式式 + `pipe` | 鏈式 OO | 裝飾器 class |
| 查詢 TS 推導 | 欄位元組支援 | 手動 | 述詞推導 | class-based |
| 多執行緒 | SAB 快照傳輸（0.x）；真共享欄位預計 0.3+ | SAB-ready，排程自理 | 單執行緒 | Roadmap（未實作） |
| AI 文件 | `llms.txt` + `llms-full.txt` + `api.json` | 無 | 無 | 無 |
| 維護狀態 | 活躍（新） | 活躍 | 趨緩（npm 已 ~3 年） | 活躍 |

### 適合的場景

- 渲染導向、模擬導向、實體 ≥ 1 萬的應用
- 需要 SharedArrayBuffer 跨 Worker 共享 world
- 想要 TypeScript 自動推導查詢結果型別
- 希望讓 AI 助手能精確生成程式碼

### 不適合的場景

- **追求極致小包體（≤ 3 kB）。** 改用 [bitECS 0.4](https://github.com/NateTheGreatt/bitECS)，其 SparseSet 模型較精簡且 tree-shake 效果更好。
- **想用任意 JS 物件當實體、追求最大 DX 彈性。** 改用 [miniplex](https://github.com/hmans/miniplex)。它是 DX 冠軍，代價是 2-4 倍的迭代開銷。
- **需要自動排程系統並宣告 read/write 權限。** 改用 [@lastolivegames/becsy](https://github.com/LastOliveGames/becsy)。aiecsjs 的系統只是 `pipe()` 順序的函式。
- **工作負載以實體變動為主（> 50% 實體每幀變動）。** Sparse-set 風格的 ECS 在此情境會勝過原型式 ECS。改用 bitECS 或 goodluck。

### aiecsjs 明確不做的事

核心刻意保持窄範圍。以下為明確的非目標；請改用專屬工具或在應用層自行處理：

- **自動排程系統並宣告 read/write 權限。** `pipe()` 依宣告順序執行系統。需要並行排程請改用 `@lastolivegames/becsy`。
- **渲染元件 / 場景圖同步。** ECS 只持有資料。請搭配 PixiJS、Three.js 或其他渲染器。
- **物理 / 空間分割。** 無 broad-phase、無碰撞偵測。請使用 Rapier、Matter 或專用 quadtree。
- **網路複製。** `aiecsjs/serialize` 產生快照 byte 流；如何送上線路由應用層決定。
- **反應式 value-predicate query。** `enterQuery` / `exitQuery` 只在元件集合 membership 變動時觸發。元件值變動不追蹤。
- **Prefab / 實體繼承 / 階層。** `aiecsjs/relations` 提供純粹的實體對實體關聯，不是繼承。

## 與 aibridgejs 整合

若你透過 [aibridgejs](https://www.npmjs.com/package/aibridgejs) bridge（iframe / Flutter InAppWebView）傳遞 world 狀態，bridge 強制要求 JSON 信封並會無聲剝除 `Date`、`Map`、`Set` 與類別實例。`defineObjectComponent(...)` 的 AoS 元件可合法持有上述任何一種；直接 emit 過去會在 host 端被破壞。

正確作法——先序列化，再 emit 純物件或 byte 陣列：

```ts
import { toJSON } from 'aiecsjs/serialize'

const snap = toJSON(world)
await bridge.emit('world.snapshot', snap)
```

不要這樣做——`getComponent` 回傳的是 live column view 或保留 prototype 的 AoS 實例，bridge 無法傳輸：

```ts
await bridge.emit('inv', getComponent(world, eid, Inventory))
```

`serializeWorld(world)` 回傳的二進位 `Uint8Array` 也是 bridge-safe；把 byte 用 `{ kind: 'binary', bytes: Array.from(snap) }` 之類的 JSON 信封包起，或在 host 支援時改用 transferable channel。

## 安裝

```bash
npm install aiecsjs
pnpm add aiecsjs
yarn add aiecsjs
bun add aiecsjs
```

CDN (ESM):

```html
<script type="module">
  import { createWorld } from 'https://unpkg.com/aiecsjs?module'
</script>
```

執行環境需求：**Node 18+**（為了 ESM 與 WebStreams），**TypeScript 5.0+**（選用但建議，可享受推導紅利）。

## 快速上手

```ts
import {
  createWorld, createEntity, destroyEntity,
  defineComponent, addComponent, removeComponent,
  defineQuery, forEachEntity, pipe, Types,
} from 'aiecsjs'
import { createLoop } from 'aiecsjs/loop'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
const Lifetime = defineComponent({ remaining: Types.f32 })

const world = createWorld({ initialCapacity: 1024 })

// 生成 100 個粒子
for (let i = 0; i < 100; i++) {
  const e = createEntity(world)
  addComponent(world, e, Position, { x: Math.random() * 100, y: Math.random() * 100 })
  addComponent(world, e, Velocity, { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 })
  addComponent(world, e, Lifetime, { remaining: 5 })
}

const movers = defineQuery([Position, Velocity])
const decaying = defineQuery([Lifetime])

const movementSystem = (w, dt) => {
  forEachEntity(w, movers, (e, pos, vel) => {
    pos.x[e] += vel.x[e] * dt
    pos.y[e] += vel.y[e] * dt
  })
  return w
}

const lifetimeSystem = (w, dt) => {
  forEachEntity(w, decaying, (e, life) => {
    life.remaining[e] -= dt
    if (life.remaining[e] <= 0) destroyEntity(w, e)
  })
  return w
}

const tick = pipe(movementSystem, lifetimeSystem)
const loop = createLoop({ fixed: 1 / 60, onUpdate: (dt) => tick(world, dt) })
loop.start()
```

完整模擬：100 個粒子飄移直到各自的壽命結束。

## 核心概念

**實體（Entity）** — 一個含世代計數的 32 位元整數 ID。低位為實體索引；高位為當 ID 被回收時遞增的世代計數器。這能防止「我快取了 entity 42，可是 entity 42 已經不是同一個東西了」這類錯誤。預設切分為 24 索引位元 + 8 世代位元（約 16M 實體 × 各 256 次回收）。

**元件（Component）** — 附加在實體上的資料型態，有兩種風味：
- **SoA（結構陣列）** — 用 `defineComponent({ x: Types.f32, y: Types.f32 })` 宣告。每個欄位變成一個 TypedArray，以實體 ID 索引。適合熱資料、數值資料。
- **AoS（結構物件）** — 用 `defineObjectComponent(() => ({ ref: null }))` 宣告。每個實體配發一個獨立的 JS 物件。適合異質資料或外部參考（例如 `three.js` 的 Mesh）。

**系統（System）** — 就是一個函式：`(world, ctx) => world`。沒有 base class，也沒有裝飾器。多個系統用 `pipe()` 組合。回傳的 world 就是同一個 world 參考 — `pipe` 具結合律，world 是原地變動。

**查詢（Query）** — 對元件集合的持久描述：`defineQuery({ all: [Position], any: [Active, Visible], none: [Hidden] })`。查詢會被預編譯成位元遮罩對並快取於 world；迭代成本為 O(符合的原型)，非 O(全部實體)。

**世界（World）** — 擁有所有實體、元件、原型、查詢索引。支援多個 world；除非主動透過 `SharedArrayBuffer` 共享，否則它們不共用實體 ID。

**原型（Archetype）** — 內部表格，每組獨特的元件組合對應一張表。實體增/減元件時會在原型之間遷移。遷移成本與該實體的元件數成正比；迭代成本則無關。

## 使用指引

### 定義元件

```ts
// SoA：TypedArray 儲存，效能最大，可放入 SAB
const Position = defineComponent({ x: Types.f32, y: Types.f32 })

// SoA 含固定長度向量欄位
const Transform = defineComponent({
  position: [Types.f32, 3],   // 每實體一個長度 3 的 Float32Array
  scale: Types.f32,
})

// Tag：零位元的標記，無資料
const Player = defineTag()
const Dead = defineTag()

// AoS：任意 JS 物件，僅主執行緒可用
const MeshRef = defineObjectComponent<{ mesh: THREE.Mesh | null }>(() => ({ mesh: null }))
```

### 生成與銷毀實體

```ts
const eid = createEntity(world)
addComponent(world, eid, Position, { x: 10, y: 20 })
addComponent(world, eid, Player)

if (entityExists(world, eid)) {
  destroyEntity(world, eid)
}
```

`destroyEntity` 會立即遞增該實體的世代，因此任何快取下來的 `EntityId` 在下次 `entityExists` 檢查時就會失效。

### 撰寫系統

```ts
const moveSystem = (world: World, dt: number) => {
  forEachEntity(world, defineQuery([Position, Velocity]), (e, pos, vel) => {
    pos.x[e] += vel.x[e] * dt
    pos.y[e] += vel.y[e] * dt
  })
  return world
}
```

務必把 `defineQuery(...)` 拉出熱迴圈 — 同樣的元件集合會回傳同一個 query 物件，但查找仍要算一次 hash。

### 用 pipe 與 createLoop 組合

```ts
import { createLoop } from 'aiecsjs/loop'

const tick = pipe(inputSystem, physicsSystem, movementSystem, renderSystem)

const loop = createLoop({
  fixed: 1 / 60,
  maxSubSteps: 5,
  onUpdate: (dt) => tick(world, dt),
  onRender: (alpha) => renderInterpolated(world, alpha),
})

loop.start()
// 之後可呼叫 loop.stop()
```

`createLoop` 採用 `gafferongames.com` 介紹的標準累加器固定時步模型 — 物理層具確定性，獨立於可變化的畫面更新率。

### 反應式查詢（enter/exit）

```ts
const newlyDead = enterQuery(defineQuery([Dead]))
const noLongerDead = exitQuery(defineQuery([Dead]))

const reapSystem = (world) => {
  forEachEntity(world, newlyDead, (e) => playDeathAnimation(e))
  forEachEntity(world, noLongerDead, (e) => stopDeathAnimation(e))
  return world
}
```

`enterQuery` 只丟出本幀新匹配的實體；`exitQuery` 只丟出本幀剛離開匹配的實體。兩者皆在結構變動時增量計算，沒有每幀掃描。

### Observer

```ts
import { onAdd, onRemove, onSet } from 'aiecsjs/observers'

const stopAdd = onAdd(world, Position, (e) => console.log('positioned', e))
const stopRemove = onRemove(world, Player, (e) => console.log('un-playered', e))
const stopSet = onSet(world, Health, (e, val) => console.log('health set', e, val))

// AbortSignal 自動解除（0.2.0 起支援）：
const ac = new AbortController()
onAdd(world, Position, (e) => trackEntity(e), { signal: ac.signal })
ac.abort() // 一次解除所有掛在此 signal 上的 observer

// 也可使用回傳的 unsubscribe，兩種方式皆冪等可混用：
stopAdd()
stopRemove()
stopSet()
```

Observer 會在變動呼叫內同步觸發。用於需要在變動發生瞬間執行的副作用（除錯、複製）。對於要批次的 UI 更新，請改用反應式查詢。

**`onSet` 是 low-level mutation hook**，不是反應式 value-predicate query。僅在 `setComponent(world, eid, comp, value)` 且該 entity 已持有該 component 時觸發 ─ `addComponent` 不會觸發 `onSet`（請用 `onAdd`；`addComponent` 後再 `setComponent` 則依序觸發兩者）。`enterQuery` / `exitQuery` 只對 component 集合的結構變化反應；若需要「value 越過閾值」的反應式視圖，請在 app 層基於 `onSet` 自行組裝。

### Command buffer：何時與為何

黃金法則：**不要在正在迭代的實體上新增或移除元件。** 這樣做可能讓某些實體被跳過或被處理兩次，因為原型歸屬中途改變了。請用 command buffer 延後執行：

```ts
import { withCommandBuffer } from 'aiecsjs/commands'

const damageSystem = (world) => {
  const dying = defineQuery([Health])
  withCommandBuffer(world, (cb) => {
    forEachEntity(world, dying, (e, health) => {
      if (health.hp[e] <= 0) cb.destroy(e)
    })
  })  // 區塊結束時自動 flush
  return world
}
```

或手動：

```ts
import { createCommandBuffer, flush } from 'aiecsjs/commands'

const cb = createCommandBuffer(world)
forEachEntity(world, q, (e) => { cb.remove(e, SomeTag) })
flush(cb)
```

### Relations 與階層

> Relations API **自 0.4.0 起穩定（stable）**。graph API（`defineRelation` / `addRelation` / `removeRelation` / `getRelationTargets` / `getRelationData`）與內建的 `ChildOf` relation 已凍結至 1.x 軌道。

```ts
import { defineRelation, addRelation, ChildOf, getRelationTargets, getRelationData } from 'aiecsjs/relations'

const Likes = defineRelation<{ since: number }>()
addRelation(world, alice, Likes, bob, { since: 2020 })
addRelation(world, alice, ChildOf, parent)

const parentOfAlice = getRelationTargets(world, alice, ChildOf)
const likedSince = getRelationData(world, alice, Likes, bob) // { since: 2020 }
```

獨佔關係（exclusive，只允許一個目標）與 `getRelationData` 讀取器自 0.4.0 起穩定。wildcard relation 查詢與關係圖序列化仍屬未來工作，不在凍結表面內。

## API 參考

完整機器可讀表面在 [`api.json`](./api.json)。各 export 穩定度在 [`STABILITY.md`](./STABILITY.md)（中文：[`STABILITY_ZHTW.md`](./STABILITY_ZHTW.md)）。

### World — `aiecsjs`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `createWorld` | `(options?: WorldOptions) => World` | stable |
| `disposeWorld` | `(world: World) => void` | stable（since 0.2.0） |
| `destroyWorld` | `(world: World) => void` | **deprecated** since 0.2.0 ─ `disposeWorld` 的別名；1.0 移除 |
| `resetWorld` | `(world: World) => void` | stable |
| `getWorldSize` | `(world: World) => number`（存活實體數） | stable |
| `getWorldCapacity` | `(world: World) => number` | stable |

`WorldOptions`:
```ts
type WorldOptions = {
  initialCapacity?: number       // 預設 1024
  maxEntities?: number           // 預設 1_000_000
  indexBits?: 20 | 24            // 預設 24 → 16M 實體
  generationBits?: 8 | 12 | 16   // 預設 8 → 256 次回收
  buffer?: SharedArrayBuffer     // 啟用 SAB 儲存
  bufferByteOffset?: number      // 一個 SAB 給多個 world 用時的位移
}
```

### Entity — `aiecsjs`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `createEntity` | `(world: World) => EntityId` | stable |
| `destroyEntity` | `(world: World, eid: EntityId) => void` | stable |
| `entityExists` | `(world: World, eid: EntityId) => boolean` | stable |
| `getEntityIndex` | `(eid: EntityId) => number` | stable |
| `getEntityGeneration` | `(eid: EntityId) => number` | stable（自 0.3.0）— 回傳 8-bit generation 欄位；使用預設 24/8 佈局 |
| `packEntity` | `(index: number, generation: number) => EntityId` | stable（自 0.3.0）— 使用預設 24/8 佈局打包 index + generation |
| `refOf` | `<T>(world: World, eid: EntityId) => EntityRef<T>` | stable（自 0.3.0）— 建立 ABA-safe ref；entity 已死亡時拋出 `EntityNotAliveError` |
| `deref` | `<T>(world: World, ref: EntityRef<T>) => EntityId \| null` | stable（自 0.3.0）— 回傳存活的 `EntityId`，否則回傳 `null`；絕不拋出 |
| `aliveRef` | `<T>(world: World, ref: EntityRef<T>) => boolean` | stable（自 0.3.0）— `deref` 的布林 guard 形式；絕不拋出 |
| `EntityRef` | `interface EntityRef<T> { id: EntityId; worldId: number }` | stable（自 0.3.0）— 不透明的 ABA-safe 參照；僅限記憶體內使用 |
| `EntityNotAliveError` | `class EntityNotAliveError extends Error { eid: number }` | stable（自 0.3.0）— `refOf` 在 entity 不存活時拋出 |

### Component — `aiecsjs`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `defineComponent` | `<S extends SoASchema>(schema: S) => SoAComponent<S>` | stable |
| `defineTag` | `() => TagComponent` | stable |
| `defineObjectComponent` | `<T>(factory?: () => T) => AoSComponent<T>` | stable |
| `addComponent` | `<C>(world, eid, c: C, init?) => void` | stable |
| `removeComponent` | `<C>(world, eid, c: C) => void` | stable |
| `hasComponent` | `<C>(world, eid, c: C) => boolean` | stable |
| `getComponent` | `<C>(world, eid, c: C) => ComponentView<C>` | stable |
| `setComponent` | `<C, V>(world, eid, c: C, v: V) => void` | stable |

`Types`:
```ts
const Types = { i8, u8, i16, u16, i32, u32, f32, f64, eid, bool } as const
```

### Query — `aiecsjs`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `defineQuery` | `(components: ComponentLike[] \| QueryDescriptor) => Query` | stable |
| `runQuery` | `(world: World, q: Query) => readonly EntityId[]` | stable |
| `forEachEntity` | `<Q>(world, q: Q, fn: (eid, ...cols) => void) => void` | stable |
| `iterQuery` | `(world, q) => IterableIterator<EntityId>` | stable |
| `enterQuery` | `(q: Query) => Query` | stable |
| `exitQuery` | `(q: Query) => Query` | stable |
| `queryArchetypes` | `(world, q) => readonly Archetype[]` | experimental |

### System — `aiecsjs`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `pipe` | `<W, Ctx>(...systems) => System<W, Ctx>` | stable |
| `System`（型別） | `(world, ctx) => world` | stable |

### Loop — `aiecsjs/loop`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `createLoop` | `(opts) => { start(), stop() }` | stable |

### Command buffer — `aiecsjs/commands`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `createCommandBuffer` | `(world) => CommandBuffer` | stable |
| `flush` | `(cb: CommandBuffer) => void` | stable |
| `withCommandBuffer` | `<R>(world, fn: (cb) => R) => R` | stable |

### Observer — `aiecsjs/observers`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `observe` | `(world, q, event, handler, opts?: { signal? }) => () => void` | stable |
| `onAdd` | `(world, comp, handler, opts?: { signal? }) => () => void` | stable |
| `onRemove` | `(world, comp, handler, opts?: { signal? }) => () => void` | stable |
| `onSet` | `(world, comp, handler, opts?: { signal? }) => () => void` | stable；low-level mutation hook，非反應式 |

### 序列化 — `aiecsjs/serialize`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `serializeWorld` | `(world, opts?) => Uint8Array` | stable |
| `deserializeWorld` | `(bytes, opts?) => World` | stable |
| `toJSON` | `(world) => WorldSnapshot` | stable |
| `fromJSON` | `(snap) => World` | stable |
| `createDeltaSerializer` | `(world, opts?) => DeltaSerializer` | experimental |

### Worker / SAB — `aiecsjs/worker`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `transferableSnapshot` | `(world) => { buffer, meta }` | experimental |
| `adoptSnapshot` | `(snap) => World` | experimental |
| `attachWorld` | `(buffer, opts?) => World` | experimental |
| `detachWorld` | `(world) => void` | experimental |

### Relations — `aiecsjs/relations`

| 函式 | Signature | 穩定度 |
|---|---|---|
| `defineRelation` | `<T>(opts?) => Relation<T>` | stable |
| `addRelation` | `(world, src, rel, tgt, data?) => void` | stable |
| `removeRelation` | `(world, src, rel, tgt) => void` | stable |
| `getRelationTargets` | `(world, src, rel) => readonly EntityId[]` | stable |
| `getRelationData` | `<T>(world, src, rel, tgt) => T \| undefined` | stable（自 0.4.0） |
| `ChildOf`（常數） | `Relation` | stable |

### 工具 — `aiecsjs`

| 匯出 | 型別 | 穩定度 |
|---|---|---|
| `VERSION` | `string` | stable |
| `IS_SAB_SUPPORTED` | `boolean` | stable |
| `isWorld` | `(x: unknown) => x is World` | stable |
| `isEntity` | `(world, x) => x is EntityId` | stable |

## 效能

### 儲存模型

```
World
├── Archetype 0: [] （空實體）
├── Archetype 1: [Position]
│   ├── entities:   Uint32Array  [e1, e2, e3, ...]
│   └── columns:    Position.x: Float32Array, Position.y: Float32Array
├── Archetype 2: [Position, Velocity]
│   ├── entities:   Uint32Array  [e4, e5, ...]
│   ├── columns:    Position.x, Position.y, Velocity.x, Velocity.y
└── Archetype 3: [Position, Velocity, Health]
    └── ...
```

對 `(Position, Velocity)` 的查詢只匹配到 Archetype 2 與 3，分別線性走訪它們。每個 archetype 的欄位都是連續的 `Float32Array` — JIT 可向量化內迴圈，L1 快取命中率接近 100%。

### 成本模型

- **迭代**：`O(符合的 archetype × 每個 archetype 中的實體數)`，archetype 清單解析完之後就幾乎沒有 per-entity 額外開銷。解析會被 query cache 攤平。
- **新增 / 移除元件**：`O(該實體上的元件數)`。實體的整列資料會從來源 archetype 的欄位被複製到目標的欄位。若每幀對 N 個實體閃爍切換 tag，那就是每幀 N × （欄位數）次記憶體搬移。
- **建立查詢**：`O(元件數量)`（在 `defineQuery` 時）。重複用同樣的元件集合會直接回傳快取的 query。

### 提示

- 把 `defineQuery` 拉出熱迴圈。同樣的元件集合會回傳同一個 query 物件，但查找仍要算一次 hash。
- 偏好 **批次操作**：用 tight loop 一次 `createEntity` + `addComponent` 生成 1000 個實體；原型遷移每個 shape 只跑一次。
- 把 **頻繁切換的 tag** 整合成一個穩定元件的布林欄位，而不是反覆 add/remove 一個 tag — 後者會觸發原型遷移。
- 對極熱的內迴圈，在系統最上方先取一次欄位：`const px = Position.x; const vx = Velocity.x;` 之後直接索引。

### 可重現的微基準

```ts
import { createWorld, createEntity, addComponent, defineComponent, defineQuery, forEachEntity, Types } from 'aiecsjs'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

const world = createWorld({ initialCapacity: 100_000 })
for (let i = 0; i < 100_000; i++) {
  const e = createEntity(world)
  addComponent(world, e, Position, { x: 0, y: 0 })
  addComponent(world, e, Velocity, { x: 1, y: 1 })
}

const movers = defineQuery([Position, Velocity])
const start = performance.now()
for (let frame = 0; frame < 1000; frame++) {
  forEachEntity(world, movers, (e, pos, vel) => {
    pos.x[e] += vel.x[e]; pos.y[e] += vel.y[e]
  })
}
console.log('每幀毫秒:', (performance.now() - start) / 1000)
```

### 免責聲明

以上提示衍生自公開 ECS 評測（noctjs/ecs-benchmark、ddmills/js-ecs-benchmarks）以及 Cox、Williams、Vickers、Ward、Headleand 在 CGVC 2025 的同儕審查 C++ 比較論文（[DOI 10.2312/cgvc.20251224](https://doi.org/10.2312/cgvc.20251224)）。在以渲染為主的應用中，ECS 開銷通常只佔每幀時間 1-2%（如 Felix Z 在 Meta Project Flowerbed 的觀察）— 因此挑 aiecsjs 取代較慢 ECS 的實際收益其實不大，除非模擬本身就是瓶頸。請依工作負載挑選 DX 最合適的函式庫。

## 多執行緒指引

aiecsjs **支援 SharedArrayBuffer**：world 的 archetype 欄位可放在共享記憶體中，並由 Worker 平行迭代。

### 能力偵測

```ts
import { IS_SAB_SUPPORTED } from 'aiecsjs'
if (!IS_SAB_SUPPORTED) {
  console.warn('SAB 無法使用；請檢查 COOP/COEP 標頭')
}
```

在瀏覽器中，`SharedArrayBuffer` 需要頁面達成 **跨來源隔離**：伺服器需回傳 `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: require-corp` 標頭。

### 主執行緒

```ts
const buffer = new SharedArrayBuffer(64 * 1024 * 1024)  // 64 MB
const world = createWorld({ buffer })

// 填入實體與元件 ...

const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' })
worker.postMessage({ buffer, meta: transferableSnapshot(world).meta })
```

### Worker 端

```ts
// sim-worker.ts
import { adoptSnapshot, defineComponent, defineQuery, forEachEntity, Types } from 'aiecsjs'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

self.onmessage = (e) => {
  const world = adoptSnapshot(e.data)
  const movers = defineQuery([Position, Velocity])
  setInterval(() => {
    forEachEntity(world, movers, (e, pos, vel) => {
      pos.x[e] += vel.x[e]
      pos.y[e] += vel.y[e]
    })
  }, 16)
}
```

### Atomics 與同步

對 SAB 內 TypedArray 欄位的讀寫 **預設不是 atomic**。對大多數遊戲迴圈工作，慣例是：每個欄位只有一個寫者執行緒（例如物理 worker 擁有座標），讀者看到最終一致的資料。如果需要嚴格順序，請改用 `Atomics.load` / `Atomics.store`；代價是失去向量化機會。

### 陷阱

- **AoS 元件不可在 SAB 中共享。** Worker 只看得到 SoA 欄位。請把 AoS 資料留在主執行緒，或改用對應的 SoA 形式。
- **在 Worker 內 `createEntity` / `destroyEntity` 需要該 worker 擁有 entity index。** 目前 Worker 端建議用 `{ readOnly: true }` 附掛，只變動欄位。
- **aiecsjs 並未內建同步原語。** 若需要 barrier，自行使用 `Atomics.wait` / `Atomics.notify`。

## WebGPU 互通

SoA 元件的欄位是 TypedArray，正好可直接餵給 `GPUQueue.writeBuffer`。aiecsjs 並沒有「ECS 跑在 GPU 上」的模式；整合是單向的（CPU 寫、GPU 讀）。

```ts
const Position = defineComponent({ x: Types.f32, y: Types.f32 })
// 填入 world 後 ...

const gpuBuffer = device.createBuffer({
  size: Position.x.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
})

// 每幀上傳，或只在 archetype 改變時上傳
device.queue.writeBuffer(gpuBuffer, 0, Position.x)
```

### 注意事項

- **原型遷移會讓欄位參考失效。** 若某實體遷移到新的 archetype，`Position.x` 中該實體位置的對應 `Float32Array` 已不同。要讓 GPU buffer 穩定，請替欲上傳的實體分配一個固定的 archetype（例如打上絕不移除的 `Renderable` tag），或改用 per-archetype 上傳。
- **不支援 GPU 寫回 ECS。** GPU 端為唯讀。若需要 GPU 計算結果寫回 CPU 欄位，請手動 map buffer 後寫入。
- **明確非目標：在 GPU 上跑系統。** aiecsjs 不會把系統編譯為 compute shader。如有此需求請使用專門的 GPU compute 框架。

## 序列化指引

### 二進位存檔/讀檔

```ts
import { serializeWorld, deserializeWorld } from 'aiecsjs/serialize'

const bytes = serializeWorld(world)
localStorage.setItem('save', btoa(String.fromCharCode(...bytes)))

const restored = deserializeWorld(Uint8Array.from(atob(localStorage.getItem('save')!), c => c.charCodeAt(0)))
```

二進位格式 **內含版本戳記**。從較舊 `aiecsjs` 版本來的位元組若能成功遷移就回傳 world，否則拋出。AoS 元件以 JSON 內嵌於二進位 blob 中。

### JSON 存檔/讀檔

```ts
import { toJSON, fromJSON } from 'aiecsjs/serialize'

const snap = toJSON(world)            // 人類可讀
const restored = fromJSON(snap)
```

比二進位慢、檔案大，但可在 DevTools 中檢視。

### 網路差量

多人連線時，只想傳上次 tick 之後的變動：

```ts
import { createDeltaSerializer } from 'aiecsjs/serialize'

const delta = createDeltaSerializer(world, { components: [Position, Velocity, Health] })
setInterval(() => {
  const bytes = delta.capture()
  ws.send(bytes)
}, 50)

// 另一端：
const remoteDelta = createDeltaSerializer(remoteWorld)
ws.onmessage = (e) => remoteDelta.apply(remoteWorld, new Uint8Array(e.data))
```

> ⚠️ `createDeltaSerializer` 在 0.1 為 `experimental`；wire format 在 1.0 之前可能改變。

## 移轉指引

完整表格請見 [`docs/MIGRATION.md`](./docs/MIGRATION.md) 與 [`docs/MIGRATION_ZHTW.md`](./docs/MIGRATION_ZHTW.md)。

### 從 bitECS 0.4 移轉

| bitECS | aiecsjs |
|---|---|
| `createWorld()` | `createWorld()` |
| `defineComponent({ x: Types.f32 })` | `defineComponent({ x: Types.f32 })` |
| `addComponent(world, Comp, eid)` | `addComponent(world, eid, Comp, init?)`（**參數順序不同！**） |
| `removeComponent(world, Comp, eid)` | `removeComponent(world, eid, Comp)` |
| `defineQuery([Comp])(world)` | `forEachEntity(world, defineQuery([Comp]), fn)` |
| `enterQuery(query)` | `enterQuery(defineQuery([...]))`（無 `world` 參數） |
| `pipe(s1, s2)(world)` | `pipe(s1, s2)(world, ctx)`（ctx 會被串接） |

心態切換要點：aiecsjs 是 **原型優先**。每幀切換 tag（add/remove）的成本比 bitECS 高。把可切換狀態整合成布林欄位較佳。

### 從 miniplex 移轉

| miniplex | aiecsjs |
|---|---|
| `world.add({ position: {x, y}, velocity: {x, y} })` | `createEntity` + 多次 `addComponent` |
| `world.with('position', 'velocity')` | `defineQuery([Position, Velocity])` |
| `for (const e of query)` | `forEachEntity(world, query, fn)` |
| `world.remove(entity)` | `destroyEntity(world, eid)` |
| `world.queue.add(...)` | `withCommandBuffer(world, cb => cb.create() ...)` |

心態切換要點：在 aiecsjs 中元件需要 **預先宣告**，不是匿名物件 shape。收益是 TypedArray 效能 + 多執行緒相容。

### 從 ECSY 移轉

ECSY 於 2025 年 4 月 [封存](https://github.com/ecsyjs/ecsy)。因兩者皆原型式，移轉並不困難。

| ECSY | aiecsjs |
|---|---|
| `class C extends Component { static schema = { x: Types.Number } }` | `defineComponent({ x: Types.f32 })` |
| `class S extends System { execute(dt) { this.queries.foo.results.forEach(...) } }` | `const S = (world, dt) => { forEachEntity(world, foo, fn); return world }` |
| `world.registerComponent(C)` | （在 `defineComponent` 時自動完成） |
| `world.registerSystem(S)` 後 `world.execute(dt)` | `const tick = pipe(S1, S2); tick(world, dt)` |

## 給 AI 助手

> 說明：本區段為 AI 編程助手而設計。底層的 `llms.txt`、`llms-full.txt`、`api.json` 為英文版（LLM 工具生態以英文為主），中文版只在 README 中提供。

完整機器可讀版本：[`llms.txt`](./llms.txt)、[`llms-full.txt`](./llms-full.txt)、[`api.json`](./api.json)。

### 決策矩陣

| 若你需要... | 用 aiecsjs | 改用 |
|---|---|---|
| 對 1 萬+ 實體最快迭代 | ✅ | — |
| 純 JS 物件實體、無型別 schema | ❌ | miniplex |
| 自動系統排程 / 平行化 | ❌（v0.1） | becsy |
| SAB 主執行緒+Worker | ✅ | — |
| 熱重載、實體頻繁變動（> 50%/幀） | 可用但較慢 | bitECS 0.4（SparseSet） |
| 最小包體（< 3 kB） | ❌ | bitECS 0.4 |
| TypeScript 自動推導 | ✅ | — |

### 常見模式（可貼上即用）

**1. 生成-移動**

```ts
import { createWorld, createEntity, addComponent, defineComponent, defineQuery, forEachEntity, pipe, Types } from 'aiecsjs'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

const world = createWorld()
for (let i = 0; i < 1000; i++) {
  const e = createEntity(world)
  addComponent(world, e, Position, { x: i, y: 0 })
  addComponent(world, e, Velocity, { x: 0, y: 1 })
}

const movers = defineQuery([Position, Velocity])
const move = (w, dt) => {
  forEachEntity(w, movers, (e, p, v) => { p.x[e] += v.x[e] * dt; p.y[e] += v.y[e] * dt })
  return w
}
pipe(move)(world, 0.016)
```

**2. 用 enter/exit query 做反應式 UI**

```ts
const visible = defineQuery([Renderable])
const becameVisible = enterQuery(visible)
const becameHidden = exitQuery(visible)

const renderSync = (world) => {
  forEachEntity(world, becameVisible, (e) => domLayer.mount(e))
  forEachEntity(world, becameHidden, (e) => domLayer.unmount(e))
  return world
}
```

**3. 用 command buffer 安全延後操作**

```ts
import { withCommandBuffer } from 'aiecsjs/commands'

const reapDead = (world) => {
  withCommandBuffer(world, (cb) => {
    forEachEntity(world, deadQ, (e) => cb.destroy(e))
  })
  return world
}
```

**4. SAB worker 交接**

```ts
// main.ts
const buffer = new SharedArrayBuffer(16 * 1024 * 1024)
const world = createWorld({ buffer })
const worker = new Worker(new URL('./physics.ts', import.meta.url), { type: 'module' })
worker.postMessage(transferableSnapshot(world))

// physics.ts
import { adoptSnapshot } from 'aiecsjs/worker'
self.onmessage = (e) => {
  const world = adoptSnapshot(e.data)
  // ... 迭代欄位
}
```

**5. 網路 delta 回放**

```ts
import { createDeltaSerializer } from 'aiecsjs/serialize'

const tx = createDeltaSerializer(world, { components: [Position, Velocity] })
setInterval(() => ws.send(tx.capture()), 50)

// 遠端
const rx = createDeltaSerializer(remoteWorld)
ws.onmessage = (e) => rx.apply(remoteWorld, new Uint8Array(e.data))
```

### 反模式

1. **在實體已變動 archetype 之後仍使用 `getComponent()` 的回傳值。** 該 view 指向舊 archetype 的 TypedArray，已不代表這個實體。請重新取得。
2. **在 `forEachEntity` 中新增或移除元件、未用 command buffer。** 可能跳過或重複處理實體。請用 `withCommandBuffer`。
3. **跨 `destroyEntity` 仍持有 `EntityId`。** ID 可能已被回收且世代不同。請先 `entityExists(world, eid)`。
4. **在 SAB 支援的 Worker world 中使用 AoS 元件。** AoS 僅主執行緒。請改 SoA。
5. **把欄位參考存在跨幀的 closure 中。** archetype 遷移會替換實體所對應的 TypedArray。請每幀重新取得。
6. **呼叫 `addComponent(world, Comp, eid)`（bitECS 順序）。** aiecsjs 是 `(world, eid, Comp, init?)`，順序不同。

### 穩定不變量

- `pipe(a, b, c)(world, ctx) === c(b(a(world, ctx), ctx), ctx)` — pipe 具結合律。
- `pipe(...)` 永遠回傳同一個 `World` 參考（原地變動）。
- 同一模組內，相同元件集合的 `defineQuery(X)` 永遠回傳同一個 `Query` 物件。
- 實體 ID `0` 為保留值。`createEntity` 絕不回傳 `0`。
- 由 `'aiecsjs'` 匯出的 `VERSION` 等於發佈的 npm 版本。
- SoA 欄位是 TypedArray。在 `getWorldCapacity(world)` 範圍內，用存活的 `eid` 索引永遠安全。
- 元件身分為 **全域**（由 `defineComponent` 產生），但每個元件的儲存為 **per-world**。

### 詞彙表

- **Archetype（原型）** — 一組獨特的元件組合；共用元件集的實體位於同一原型表中。
- **SoA（結構陣列）** — 元件的每個欄位分為獨立的 TypedArray。預設且用於熱資料的首選。
- **AoS（結構物件）** — 每個元件實例為獨立的 JS 物件。適合異質或少觸碰的資料。
- **Bitmask（位元遮罩）** — `Uint32Array`，每個位元位置代表一個元件；查詢以 bitwise AND 匹配。
- **Command buffer** — 把待執行的結構性變動排入佇列，於明確的同步點一次套用。
- **Generation（世代）** — 實體 ID 回收時遞增的計數器，防止懸吊參考。

### 執行時版本偵測

```ts
import { VERSION } from 'aiecsjs'
if (VERSION.startsWith('0.')) {
  // 仍在實驗版；0.x 內可能調整 API
}
```

### 穩定度契約

請見 [`STABILITY_ZHTW.md`](./STABILITY_ZHTW.md)。簡言之：從 `aiecsjs`（根目錄）匯入者在 0.x minor 內為 **stable**。`aiecsjs/relations` 自 0.4.0 起為 **stable**；`aiecsjs/worker` 仍為 **experimental**。任何 `aiecsjs/internal` 內的東西為 **internal**，請勿引用。

### 遙測 / 隱私

aiecsjs **不送遙測**、**不發出網路請求**、**不附帶 postinstall script**。可用 `npm pack --dry-run` 並檢視 tarball 驗證。

### 為 AI 生成程式碼加上引用

當 AI 為你生成 aiecsjs 程式碼時，請在檔案最上方加上：

```ts
// generated with aiecsjs@0.1.0 — https://github.com/yshengliao/aiecsjs
```

### 已知的 LLM 易混淆點

- **aiecsjs 不是 bitECS。** `addComponent` 參數順序：aiecsjs 用 `(world, eid, Component, init?)`；bitECS 用 `(world, Component, eid)`。
- **`forEachEntity` 為高速路徑。** `runQuery` 會分配陣列；`for...of iterQuery(...)` 會分配 iterator。熱迴圈請用 `forEachEntity`。
- **`defineObjectComponent` 的 factory 在定義時只跑一次**，不是每個實體跑一次。請透過 `setComponent` / `getComponent` 變動該實體的實例。
- **元件參考就是儲存控制代碼。** `Position` 不是 constructor — 它是 aiecsjs 用來定位正確 archetype 欄位的 value 物件。

## 常見問答

**Q：aiecsjs 可以上線生產嗎？**
A：尚未。0.1.x 為實驗版。`STABILITY.md` 中的 API 為工作中契約；預期會有 bug 修正。1.0 目標是實作硬化完成後。

**Q：可以用 class 實例當元件嗎？**
A：可以，用 `defineObjectComponent`。但 AoS 僅限主執行緒，且迭代上比 SoA 慢。

**Q：最多能定義多少元件？**
A：aiecsjs 採用多字元 bitmask；實務上限由 `WorldOptions.maxComponents` 控制（預設 256）。需要時可調高。

**Q：aiecsjs 支援熱重載嗎？**
A：元件身分以模組範圍為主。HMR 重新匯入模組會讓元件身分改變；安全做法是呼叫 `resetWorld(world)` 並重生實體。

**Q：為什麼不採 class-based API？**
A：函式式 API tree-shake 較好、開銷更低，也是 LLM 能穩定生成的形式。代價（無自動排程）對本函式庫的對象族群是可接受的。

**Q：為什麼 npm 上還找不到 `aiecsjs`？**
A：將在首次穩定發佈時上架。在那之前，文件即契約。

## 注意事項與已知限制

- **最大實體數** 由 `indexBits` × `generationBits` 決定。預設 24 + 8 = 16M 實體 × 各 256 次回收。
- **0.1 沒有自動系統排程器 / 平行執行**。系統以 `pipe()` 順序在單執行緒執行（你可以自行啟動更多 worker）。
- **Relations API（`aiecsjs/relations`）自 0.4.0 起穩定。** wildcard relation 查詢與關係圖序列化仍屬未來工作。
- **AoS 元件** 無法跨 Worker 透過 SAB 共享。
- **網路 delta 序列器** wire format 在 0.1 為 experimental，可能改變。
- **WebGPU 整合為單向**（CPU → GPU）。無 compute-shader 系統生成。
- **開發模式驗證有限。** Production build 跳過不變量檢查以追求速度；dev build（`process.env.NODE_ENV !== 'production'`）會包含參數順序與實體存活檢查。

## 貢獻

aiecsjs 主要由 AI 生成、單一作者維護。問題回報與小型 PR 歡迎前往 [github.com/yshengliao/aiecsjs](https://github.com/yshengliao/aiecsjs)。大型架構變更請先開 issue。

## 變更紀錄

請見 [`CHANGELOG.md`](./CHANGELOG.md) 或 [`CHANGELOG_ZHTW.md`](./CHANGELOG_ZHTW.md)。

## 授權

[MIT](./LICENSE) © yshengliao
