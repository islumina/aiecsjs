# 穩定度契約

🌐 [English](STABILITY.md) | [繁體中文](STABILITY_ZHTW.md)

本文件為 `aiecsjs` 中各匯出的穩定度承諾。AI 工具與人類使用者可依此契約來鎖定版本與書寫 import 路徑。

## 規範

aiecsjs 遵循 [semver](https://semver.org/)。在 **0.x** 系列內：
- **`stable`** 匯出於 minor 版本之間（例如 0.1 → 0.2）不會破壞性變更。
- **`experimental`** 匯出可能在任何 minor 釋出時改變形狀、命名或行為。若有依賴請鎖定明確版本。
- **`internal`** 不屬於 API 表面，可能在任何 patch 釋出時改變。請勿匯入。
- **`deprecated`** 仍可正常運作但已排入移除計畫。棄用通知中會載明目標版本。

至 **1.0** 時，`stable` 表面為整個 1.x 系列凍結。

完整機器可讀的匯出清單位於 [`api.json`](./api.json)，每筆都有 `stability` 與 `since` 欄位。

## 依模組分類

### `aiecsjs`（根目錄）

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `createWorld` | stable | 0.1.0 | |
| `destroyWorld` | stable | 0.1.0 | |
| `resetWorld` | stable | 0.1.0 | |
| `getWorldSize` | stable | 0.1.0 | |
| `getWorldCapacity` | stable | 0.1.0 | |
| `createEntity` | stable | 0.1.0 | |
| `destroyEntity` | stable | 0.1.0 | |
| `entityExists` | stable | 0.1.0 | |
| `getEntityIndex` | stable | 0.1.0 | |
| `getEntityGeneration` | stable | 0.1.0 | |
| `packEntity` | stable | 0.1.0 | |
| `defineComponent` | stable | 0.1.0 | |
| `defineTag` | stable | 0.1.0 | |
| `defineObjectComponent` | stable | 0.1.0 | AoS 元件僅限主執行緒；不可跨 SAB 共享。 |
| `addComponent` | stable | 0.1.0 | 參數順序 `(world, eid, component, init?)` 為最終定義。 |
| `removeComponent` | stable | 0.1.0 | |
| `hasComponent` | stable | 0.1.0 | |
| `getComponent` | stable | 0.1.0 | |
| `setComponent` | stable | 0.1.0 | |
| `Types` | stable | 0.1.0 | 常數對應表；欄位名稱屬於契約。 |
| `defineQuery` | stable | 0.1.0 | |
| `runQuery` | stable | 0.1.0 | |
| `forEachEntity` | stable | 0.1.0 | |
| `iterQuery` | stable | 0.1.0 | |
| `enterQuery` | stable | 0.1.0 | |
| `exitQuery` | stable | 0.1.0 | |
| `queryArchetypes` | **experimental** | 0.1.0 | `Archetype.id` 為 opaque 內部值；`Archetype` 的形狀可能增加欄位。 |
| `pipe` | stable | 0.1.0 | |
| `VERSION` | stable | 0.1.0 | |
| `IS_SAB_SUPPORTED` | stable | 0.1.0 | |
| `isWorld` | stable | 0.1.0 | |
| `isEntity` | stable | 0.1.0 | |

### `aiecsjs/loop`

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `createLoop` | stable | 0.1.0 | |

### `aiecsjs/commands`

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `createCommandBuffer` | stable | 0.1.0 | |
| `flush` | stable | 0.1.0 | |
| `withCommandBuffer` | stable | 0.1.0 | |

### `aiecsjs/observers`

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `observe` | stable | 0.1.0 | |
| `onAdd` | stable | 0.1.0 | |
| `onRemove` | stable | 0.1.0 | |
| `onSet` | stable | 0.1.0 | |

### `aiecsjs/serialize`

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `serializeWorld` | stable | 0.1.0 | 二進位格式包含版本戳記。 |
| `deserializeWorld` | stable | 0.1.0 | |
| `toJSON` | stable | 0.1.0 | |
| `fromJSON` | stable | 0.1.0 | |
| `createDeltaSerializer` | **experimental** | 0.1.0 | Wire format 在 1.0 之前可能改變。 |

### `aiecsjs/worker`

整個 subpath 在 0.1 為 **experimental**。Snapshot 佈局與能力旗標可能改變。

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `transferableSnapshot` | experimental | 0.1.0 | |
| `adoptSnapshot` | experimental | 0.1.0 | |
| `attachWorld` | experimental | 0.1.0 | |
| `detachWorld` | experimental | 0.1.0 | |

### `aiecsjs/relations`

整個 subpath 在 0.1 為 **experimental** 但已實作。預期於 0.3 穩定。

| 匯出 | 穩定度 | 起始版本 | 備註 |
|---|---|---|---|
| `defineRelation` | experimental | 0.1.0 | |
| `addRelation` | experimental | 0.1.0 | |
| `removeRelation` | experimental | 0.1.0 | |
| `getRelationTargets` | experimental | 0.1.0 | |
| `ChildOf`（常數） | experimental | 0.1.0 | 內建獨佔關係。 |

### `aiecsjs/internal/*`

此前綴底下的所有內容皆為 **internal**。它存在於實作自用，可能在任何 release 變更。請勿匯入。

## Roadmap

| 版本 | 焦點 | 穩定度變動 |
|---|---|---|
| 0.1.x | 核心表面（world、entity、component、query、system、loop、commands、observers、serialize） | 初次發佈；package 整體標 experimental，但各 export 表中列為 stable 者皆穩定。 |
| 0.2.x | Relations 與階層 | `aiecsjs/relations` 落實實作；仍為 experimental。 |
| 0.3.x | 硬化、Relations 穩定、多執行緒打磨 | `aiecsjs/relations` 與 `aiecsjs/worker` → stable。 |
| 1.0.0 | API 凍結 | 所有 `stable` 匯出於 1.x 系列凍結。 |

## 在執行時檢查穩定度

```ts
import { VERSION } from 'aiecsjs'

if (VERSION.startsWith('0.')) {
  console.warn('aiecsjs 處於 1.0 前；API 表面可能調整')
}
```

如需程式化檢視，請解析 [`api.json`](./api.json) — 每筆都有 `stability` 與 `since` 欄位。
