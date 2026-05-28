# 移轉指引

🌐 [English](MIGRATION.md) | [繁體中文](MIGRATION_ZHTW.md)

從其他 JavaScript ECS 函式庫切換到 `aiecsjs` 的具體名稱對照與心態調整筆記。

## 從 bitECS 0.4 移轉

bitECS 與 aiecsjs 共享最多 DNA：都是函式式、都用 TypedArray 欄位、都用 `pipe` 組合系統。差異雖真實但不大。

### 名稱對照

| bitECS 0.4 | aiecsjs 0.1 |
|---|---|
| `createWorld()` | `createWorld()` |
| `defineComponent({ x: Types.f32 })` | `defineComponent({ x: Types.f32 })` |
| `addComponent(world, Comp, eid)` | `addComponent(world, eid, Comp, init?)` ← **參數順序！** |
| `removeComponent(world, Comp, eid)` | `removeComponent(world, eid, Comp)` |
| `hasComponent(world, Comp, eid)` | `hasComponent(world, eid, Comp)` |
| `addEntity(world)` | `createEntity(world)` |
| `removeEntity(world, eid)` | `destroyEntity(world, eid)` |
| `defineQuery([Comp])(world)` | `forEachEntity(world, defineQuery([Comp]), fn)` |
| `enterQuery(query)` | `enterQuery(defineQuery([...]))`（無 `world` 參數） |
| `exitQuery(query)` | `exitQuery(defineQuery([...]))` |
| `Not(Comp)` | `defineQuery({ all: [...], none: [Comp] })` |
| `pipe(s1, s2)(world)` | `pipe(s1, s2)(world, ctx)`（ctx 會被串接） |
| `defineSerializer(...)` | `createDeltaSerializer(world, { components })` |
| `createRelation(...)` | `defineRelation(...)`（目標 0.2） |
| `withVersioning(bits)` | `createWorld({ indexBits, generationBits })` |
| `observe(world, query, ...)` | `observe(world, query, event, handler)` |

### 心態調整

**儲存模型。** bitECS 用每元件 SparseSet + bitmask。aiecsjs 用 archetype 表格。效能特性不同：

- 每幀 add/remove 一個 tag 在 **bitECS 較便宜**（sparse set O(1) toggle）。
- 對 1 萬實體做熱查詢迭代在 **aiecsjs 較便宜**（連續 archetype 欄位）。
- 經常切換的 tag，請改用穩定元件內的 `boolean` 欄位，不要 `add`/`removeComponent`。

**參數順序。** 移植時最常出 bug 的點：

```ts
// bitECS:
addComponent(world, Position, eid)

// aiecsjs:
addComponent(world, eid, Position, { x: 0, y: 0 })
```

aiecsjs 順序為 `(world, eid, component, init)` — 實體在前，因為它才是操作主體。

**查詢迭代。** bitECS 是 query 呼叫直接回傳實體陣列。aiecsjs 將定義與執行分離：

```ts
// bitECS:
const movers = defineQuery([Position, Velocity])
const eids = movers(world)
for (let i = 0; i < eids.length; i++) {
  const e = eids[i]
  Position.x[e] += Velocity.x[e]
}

// aiecsjs:
const movers = defineQuery([Position, Velocity])
forEachEntity(world, movers, (e, pos, vel) => {
  pos.x[e] += vel.x[e]
})
```

aiecsjs 寫法較短，且 callback 內可取得已對型的欄位 view。

**實體版本控制。** 兩者都支援。bitECS 透過 `withVersioning(bits)`；aiecsjs 直接在 `WorldOptions` 中取 `indexBits` 與 `generationBits`。

```ts
// bitECS:
const world = createWorld(withVersioning(8))

// aiecsjs:
const world = createWorld({ indexBits: 24, generationBits: 8 })
```

### 系統移植範例

bitECS:
```ts
const movementSystem = (world) => {
  const ents = movers(world)
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i]
    Position.x[eid] += Velocity.x[eid]
    Position.y[eid] += Velocity.y[eid]
  }
  return world
}
```

aiecsjs:
```ts
const movementSystem = (world, dt = 1) => {
  forEachEntity(world, movers, (e, pos, vel) => {
    pos.x[e] += vel.x[e] * dt
    pos.y[e] += vel.y[e] * dt
  })
  return world
}
```

## 從 miniplex 移轉

miniplex 是 OO 且以實體 shape 為主；aiecsjs 是函式式且以元件宣告為主。移植需要一點心態調整，但若你需要 TypedArray 效能或多執行緒支援就值得。

### 名稱對照

| miniplex 2.0 | aiecsjs 0.1 |
|---|---|
| `const world = new World<Entity>()` | `const world = createWorld()` |
| `world.add({ position: {x, y}, velocity: {x, y} })` | `createEntity` + 多次 `addComponent` |
| `world.with('position', 'velocity')` | `defineQuery([Position, Velocity])` |
| `world.archetype('position', 'velocity')` | `defineQuery([Position, Velocity])` |
| `query.entities` | `runQuery(world, query)` |
| `for (const e of query)` | `forEachEntity(world, query, fn)` |
| `query.onEntityAdded.add(fn)` | `enterQuery(query)` + 在系統內 observe |
| `query.onEntityRemoved.add(fn)` | `exitQuery(query)` |
| `world.remove(entity)` | `destroyEntity(world, eid)` |
| `world.queue.add(...)`、`world.queue.flush()` | `withCommandBuffer(world, cb => cb.create() ...)` |
| `world.where(predicate)` | （在 `forEachEntity` callback 內過濾） |
| `<Entities of={query}>`（miniplex-react） | （尚未支援，見 roadmap） |

### 心態調整

**元件需預先宣告。** miniplex 中，元件是你賦值就存在的物件屬性名。aiecsjs 中，元件必須先宣告：

```ts
// miniplex:
const e = world.add({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 } })

// aiecsjs:
const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
const e = createEntity(world)
addComponent(world, e, Position, { x: 0, y: 0 })
addComponent(world, e, Velocity, { x: 1, y: 0 })
```

收益是 TypedArray 欄位（快速迭代）與 SAB 安全儲存。代價是元件需要事先宣告。

**異質參考。** 若 miniplex 實體有 `mesh: THREE.Mesh` 屬性，aiecsjs 中請用 `defineObjectComponent`：

```ts
const MeshRef = defineObjectComponent<{ mesh: THREE.Mesh | null }>(() => ({ mesh: null }))
addComponent(world, e, MeshRef, { mesh: someMesh })
```

但記住：AoS 元件僅限主執行緒。

**iteration callback vs. iterator。** miniplex 的 `for (const e of query)` 方便但每幀分配 iterator。`forEachEntity(world, query, fn)` 是熱路徑；只有需要 `for...of` 語義時才使用 `iterQuery`。

### 系統移植範例

miniplex:
```ts
const movement = (dt: number) => {
  for (const e of world.with('position', 'velocity')) {
    e.position.x += e.velocity.x * dt
    e.position.y += e.velocity.y * dt
  }
}
```

aiecsjs:
```ts
const movers = defineQuery([Position, Velocity])
const movement = (world, dt) => {
  forEachEntity(world, movers, (e, pos, vel) => {
    pos.x[e] += vel.x[e] * dt
    pos.y[e] += vel.y[e] * dt
  })
  return world
}
```

## 從 ECSY 移轉

ECSY 已[封存](https://github.com/ecsyjs/ecsy)（2025 年 4 月）。移轉到 aiecsjs 並不困難，因為兩者皆為 archetype-style。ECSY 的 OO 慣用可直接對應到 aiecsjs 的函式式 API。

### 名稱對照

| ECSY | aiecsjs 0.1 |
|---|---|
| `class C extends Component { static schema = { x: { type: Types.Number } } }` | `defineComponent({ x: Types.f64 })` |
| `class Tag extends TagComponent {}` | `defineTag()` |
| `class S extends System { static queries = { foo: { components: [...] } }; execute(dt) { this.queries.foo.results.forEach(...) } }` | `const fooQ = defineQuery([...])`；`const S = (world, dt) => { forEachEntity(world, fooQ, fn); return world }` |
| `world.registerComponent(C)` | （在 `defineComponent` 時自動完成） |
| `world.registerSystem(S)` | （無 — `pipe` 決定順序） |
| `world.execute(dt, time)` | `tick(world, dt)`，其中 `tick = pipe(S1, S2, ...)` |
| `world.createEntity()` | `createEntity(world)` |
| `entity.addComponent(C, data)` | `addComponent(world, eid, C, data)` |
| `entity.removeComponent(C)` | `removeComponent(world, eid, C)` |
| `entity.getComponent(C)` | `getComponent(world, eid, C)` |
| `entity.getMutableComponent(C)` | `getComponent(world, eid, C)`（aiecsjs 永遠是可變的） |
| `queries.foo.added` | `enterQuery(fooQ)` |
| `queries.foo.removed` | `exitQuery(fooQ)` |
| `queries.foo.changed` | （用 `onSet` observer 或自行追蹤） |

### 心態調整

**不用寫 `class System`。** 系統是函式不是 class。捨棄 `extends System`、`execute`、`static queries` — 在模組頂層定義 query，並傳給 `forEachEntity`。

```ts
// ECSY:
class MovementSystem extends System {
  static queries = { movers: { components: [Position, Velocity] } }
  execute(dt: number) {
    this.queries.movers.results.forEach((e) => {
      const pos = e.getMutableComponent(Position)
      const vel = e.getComponent(Velocity)
      pos.x += vel.x * dt
      pos.y += vel.y * dt
    })
  }
}
world.registerSystem(MovementSystem)
world.execute(1/60)
```

```ts
// aiecsjs:
const movers = defineQuery([Position, Velocity])
const movement = (world, dt) => {
  forEachEntity(world, movers, (e, pos, vel) => {
    pos.x[e] += vel.x[e] * dt
    pos.y[e] += vel.y[e] * dt
  })
  return world
}
const tick = pipe(movement)
tick(world, 1/60)
```

**SoA 欄位 vs. 元件實例。** ECSY 元件是 class 實例，欄位如 `pos.x`。aiecsjs SoA 元件是欄位對應表；以實體 ID 索引：`pos.x[e]`。

**沒有 `priority` 或排程 DSL。** aiecsjs 系統以 `pipe()` 順序執行。若你依賴 ECSY 的 `priority` 排序，直接把 pipe 順序寫對即可。

**`Types.Number` → `Types.f64`（或 `f32`）。** ECSY 的數值型別為雙精度；aiecsjs 讓你選擇寬度。一般遊戲資料用 `f32`，真的需要才用 `f64`。

## 移轉常見陷阱（任一函式庫）

1. **忘了用 `pipe(...)` 串系統** — 手動逐一呼叫各系統卻沒把 world 參考帶過去。請用 `pipe` 串好，再 `tick(world, ctx)`。
2. **在系統內呼叫 `defineComponent`** — 元件是 identity-based，必須是 module-level 常數。
3. **快取 `getComponent()` 回傳值** — 實體 archetype 改變後該 view 已失效。每幀請重新取得。
4. **對 `runQuery` 結果用 `for...of` 迭代** — `runQuery` 每次呼叫都分配陣列。熱路徑請改用 `forEachEntity`。
5. **嘗試跨 Worker 共享 AoS 元件** — 僅 SoA 元件能存於 SharedArrayBuffer。多執行緒前請先把 AoS 換成 SoA。
