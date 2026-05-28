# 變更紀錄

[English](CHANGELOG.md) | [繁體中文](CHANGELOG_ZHTW.md)

`aiecsjs` 的所有重要變更都記錄在本檔案。

格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，並遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 0.3+ 規劃

- 實作 ABA-safe `EntityRef`，把 `getEntityGeneration` / `packEntity` 從 experimental 升回 stable。
- 加入 `pipeAsync` 以支援非同步系統組合。
- 引入 doc-test 工具，使 README 中的程式碼區塊能被機械化驗證。
- 將 `aiecsjs/relations` 與 `aiecsjs/worker`（真正 SAB 共享 columns）升為 stable。

## [0.2.0] - 2026-05-28

### 修復（correctness + security）

- **AoS `writeInitial` 原型污染強化**（[src/internal/component.ts](src/internal/component.ts)）：以明確 own-key 複製取代 `Object.assign(inst, initial)`，過濾 `__proto__` / `constructor` / `prototype`。封堵惡意 `JSON.parse` payload 經由 `addComponent` / `setComponent` / `fromJSON` / `deserializeWorld` 攻破 per-instance prototype 的路徑。
- **觀察者派送對 dispatch 中 unsubscribe 安全**（[src/observers.ts](src/observers.ts)）：每個 `fire*` 對 `state.observers` 取 snapshot（`Array.from(...)` + `includes` 守衛），handler 呼叫自己的 disposer 時不再跳過同一輪派送中後續的兄弟觀察者。
- **`removeComponent` 先寫入新 mask，再 fire observers**（[src/internal/component.ts](src/internal/component.ts)）：query 觀察者讀 `state.entityMask` 判定 entity 是否離開匹配集合；舊順序在派送時 bit 仍在，導致 remove 不觸發。對齊 `addComponent` 的「先變更後派送」順序。
- **`destroyEntity` 現在會送 query-targeted `remove`**（[src/observers.ts](src/observers.ts) `dispatchDestroyObservers`）：除原本逐 component 的 `onRemove`，現在追加 query 觀察者掃描，對 entity 在 destroy 前匹配的每個 query 都送 `remove`。
- **`deserializeWorld` / `attachWorld` 二進位長度欄位含邊界檢查**（[src/serialize.ts](src/serialize.ts)）：`verLen` 與 `jsonLen` 加入 `off + len <= bytes.length` 與 64 MiB 上限。`attachWorld` 的 JSDoc 補上 SAB transport 的信任邊界說明。

### 新增（API）

- **`disposeWorld(world)`** ─ `destroyWorld` 的別名 export，與 ai*js 生態 `dispose()` 慣例（`aifsmjs.Runtime.dispose`、`aibridgejs.Bridge.dispose`）對齊。新程式碼請用 `disposeWorld`；`destroyWorld` 標 deprecated，預計 1.0 移除。
- **觀察者新增 `{ signal?: AbortSignal }`**：`onAdd` / `onRemove` / `onSet` / `observe` 皆接受 options 物件。signal abort 時觀察者自動取消訂閱；回傳的 unsubscribe 仍為冪等可用。新增匯出型別 `ObserverOptions`。彌補 AI 生態稽核指出的長期缺口 ─ 接 UI 元件、async pipeline 等使用者控制生命週期的長期觀察者，不再需要手動接線清理。

### 變更（穩定度）

- `getEntityGeneration` 與 `packEntity` 由 `stable` 改為 `experimental`（同步更新 `STABILITY.md` 與 `api.json`）。0.1 至今行為始終為 0 / identity；relabel 是誠實承認 deferred encoding。真正值會在 ABA-safe `EntityRef` 上線時提供。
- `destroyWorld` 由 `stable` 改為 `deprecated`。行為未變；deprecation 為上述命名對齊。請改用 `disposeWorld`。

### 文件

- `onSet` 加上 JSDoc 與 README 段，明確聲明它是 **low-level mutation hook**，非反應式 value-predicate query。`enterQuery` / `exitQuery` 仍是結構變化的反應介面；反應式 value 追蹤仍為核心的明示非目標。
- README 觀察者段新增 `AbortController` 取消訂閱範例。

### 建置與工具

- 引入 [Biome](https://biomejs.dev/) lint + format（`biome.json`、`npm run lint`、`npm run format`），與 `aifsmjs` / `aibridgejs` 對齊。同時揭露既有 `src/internal/*` 的 `noExplicitAny` 警告以供後續清理。
- 新增 `scripts/verify-exports.mjs` 與 `npm run verify:exports` 指令，gate `package.json#exports` 的每個入口都對應到實際 `dist/` 檔案。納入 `prepublishOnly`。
- 新增 `CONTRIBUTING.md`（複用 `aifsmjs` 樣板）：quick start、scope policy、release flow。

### 相容性

執行期**完全不破壞**。既有呼叫 `destroyWorld(world)`、無 options 註冊觀察者、讀取 `getEntityGeneration` 的程式碼皆繼續運作。穩定度標籤變更純屬文件層面。

## [0.1.4] - 2026-05-28

純文件版本。新增與 `aibridgejs` 的跨包整合章節，指向後者的 JSON envelope 契約；無 source code 變動。

### 文件

- README 與 README_ZHTW 新增「與 aibridgejs 整合」章節，說明 `bridge.call` / `bridge.emit` 強制 JSON-safe payload，會無聲剝除 `Date`、`Map`、`Set` 與類別實例。透過 bridge 傳輸 world 狀態的正確寫法是先 `toJSON(world)`（或將 `serializeWorld(world)` 包成 JSON envelope）再 emit，**不要**直接 emit `getComponent(...)`。詳見 [aiecsjs README · 與 aibridgejs 整合](README_ZHTW.md#與-aibridgejs-整合)。
- 透過 `aijs-integration-smoke` 同伴 repo 驗證：`aifsmjs@0.1.2`、`aibridgejs@0.1.3`、`aiecsjs@0.1.3` 三套件所有 named export 可在同一個 TypeScript module 共存，`tsc --noEmit --strict` 零 identifier 衝突。

## [0.1.3] - 2026-05-28

「無已知 silent bug」版本。兩個正確性修正、一個熱路徑分配移除，加上一小批風格清理。公開 API 行為無任何改變；`_getWorldState` 從 root export 移除（原本就未文件化、無 sub-path 引用，前綴底線即內部訊號）。

### 修正

- `aiecsjs/relations` 的 relation data store 不再以 `srcEid * worldCapacity + tgtEid` 當 key。world 擴容後同一組 `(src, tgt)` 會算出不同 key，原有 entry 變孤兒。改為 nested `Map<srcEid, Map<tgtEid, data>>`，與 capacity 完全脫鉤；`destroyEntity` 清理 hook 同步更新。v0.1 並無對外 retrieve API 故 user-invisible，但只要 0.2 推出 retrieve surface 就會立即引爆。
- 每個 query 在 world 上 resolve 後的 bitmask 不再寫回 module-global 的 `QueryInternal`。當同一個 `defineQuery(...)` handle 被兩個 component 註冊順序不同的 world 共用時，後者的 per-world mask 會覆寫前者，導致 world A 的 `runQuery` 靜默回傳錯誤的 rows。mask 改存於 `WorldState.queryMasks: Map<queryId, QueryMaskBundle>`，per-world 隔離。`tests/multi-world.test.ts` 新增 cross-order 場景的 regression。

### 變更（內部）

- Observer dispatch 路徑（`dispatchQueryObservers`）每次 mutation 不再分配臨時 `Uint32Array`。`bitmask.ts` 新增 `matchesEntityMask` helper，可直接以 base offset 讀 `state.entityMask`。
- 共用的 bit 提取邏輯抽成 `bitmask.ts` 的 `forEachSetBit(mask, base, words, fn)`。`clearAllEntityStorages`（`component.ts`）與 `dispatchDestroyObservers`（`observers.ts`）改用同一個實作，不再三處各自 inline `word & -word` / `Math.clz32` 的相同算式。
- `state.generations[idx]` 寫入不再需要 `as any`。`Uint8Array | Uint16Array` 兩者皆支援 indexed read/write。
- `growEntityArrays` 內的 `void oldCap` no-op 刪除。
- root `aiecsjs` 移除 `_getWorldState` export。`aiecsjs/serialize` 與 `aiecsjs/worker` 都已直接從 internal module import `getWorldState`，前綴底線的 root re-export 從來沒有消費者。

### 0.3 規劃

- 將 `aiecsjs/relations` 與 `aiecsjs/worker` 提升為 `stable`。
- 穩定網路 delta 的 wire format。
- 加入自動化效能評測套件並提交於 repo。

### 1.0 規劃

- 凍結 1.x 系列的 API。
- 移除 experimental 狀態標籤。

## [0.1.2] - 2026-05-28

CI/CD smoke-test 版本。自 0.1.1 起無使用者可見的程式碼或行為變動；本次 bump 純粹用來端對端驗證 tag 觸發的 publish workflow（見 `.github/workflows/publish.yml`）能成功把套件帶 provenance 證明發到 npm registry。

### 建置與工具

- 確認 push `v*.*.*` tag 會觸發 `.github/workflows/publish.yml`、跑完 `prepublishOnly`（typecheck + 測試 + build + size 預算），並以 sigstore provenance 發佈到 npm。

## [0.1.1] - 2026-05-28

「文件誠實化 + 測試補強」版本。沒有新增公開 API；本版讓 0.1.0 公開的表面、文件與測試覆蓋三者完全一致。

### 修正

- `destroyEntity` 現在會清零該實體所擁有的 SoA 欄位、並把 AoS 槽位設為 undefined。先前僅清除實體 mask，導致殘留資料殘留於欄位中、會被 debug snapshot 與序列化路徑看見。公開 API（`hasComponent` / query）行為原本就正確，所以對使用者不可見；本次補上新測試「`destroyEntity` zeroes the destroyed entity’s SoA slot」覆蓋之。

### 變更（文件誠實化）

- README 與 STABILITY 現以「snapshot-copy 傳輸」誠實描述 `aiecsjs/worker` 在 0.1 的實作；真正的共享欄位仍為 0.2 目標。README 與 `package.json` description 同步更新。
- README 註明 0.1 的 `EntityId` 為純索引值；內部世代計數用於追蹤槽位重用但不編入 ID。具 ABA 安全的 `EntityRef` 列入 0.2 roadmap。
- STABILITY 重新定位 sub-path（`loop` / `commands` / `observers` / `serialize` / `worker` / `relations`）為 utility / adapter sub-path；根目錄 `aiecsjs` 才是穩定核心。應用未引用的 sub-path 可被 tree-shake 移除。
- README 新增「aiecsjs 明確不做的事」章節，列出非目標：系統排程、render 綁定、物理、網路複製、value-predicate 反應式查詢、prefab / 繼承。
- 語言版本檔名由 `*.zh-TW.md` 改名為 `*_ZHTW.md`。跨檔連結、`llms.txt`、`package.json` `files` 同步更新。未來其他語言版本依相同的大寫 ISO 639-1 規則命名。
- 文件移除 emoji（語言切換器、狀態旗標等）。

### 建置與工具

- tsup 建置開啟 `minify: true`。
- 新增 `size-limit` dev 相依；以 `npm run size` 強制每個 export 的 gzip 預算。實測：core 5.49 kB、全 sub-paths 合計 12.6 kB gzip。
- 新增 GitHub Actions CI workflow：在 push 與 PR 至 `main` 時跑 typecheck → test → build → size check。
- `prepublishOnly` 現在會依序跑 typecheck、test、build、size gate，全綠才允許發佈。

### 測試

- 測試數由 84 增至 140。新增 `tests/internal/bitmask.test.ts`（27 個案例，含 `matches` 真值表）覆蓋多字位元遮罩 helper；新增 `tests/multi-world.test.ts` 覆蓋同 component 跨 world 隔離。現有檔案補上：runQuery 與 naive 線性 filter 全 clause 對照、archetype migration 邊界、查詢迭代中變動的穩定性與 lazy cache、`removeComponent` 與 `destroyEntity` 後 SoA 欄位清零斷言、SoA vectorLen round-trip、`maxEntities` / `maxComponents` 上限拋錯、destroy 多 component 觸發 onRemove fan-out、`onSet` value 內容、query observer 不被無關 mutation 觸發、relation 來源側 destroy 清理、exclusive relation 儲存 resize、worker `readOnly` 阻止 add/remove/destroy、serialize `options.components` filter、`onUnknownVersion: throw | best-effort` 兩種路徑、command buffer placeholder 解析後可被查詢、slot 重用限制明文化。Loop 測試改寫於 `vi.useFakeTimers({ toFake: ['performance', ...] })` 之上以達 deterministic dt 驗證。

## [0.1.0] - 2026-05-27

**首次發佈。** 7 個模組共 50 個公開匯出皆已實作，並通過 84 個 Vitest 行為測試。以 tsup 編譯 ESM + CJS 雙版本，附帶 `.d.ts` 與 source map。

### 實作備註

- **儲存模型**：每個 SoA 元件欄位在 world 層級配發一個 TypedArray（大小為 world capacity）。Archetype 追蹤實體歸屬（一個 `Uint32Array entities[]`），但不擁有欄位資料。這讓 archetype 遷移為 O(1)，並讓 `Position.x[eid]` 可直接使用無需轉換。代價：迭代某 archetype 時，欄位讀取在 non-contiguous 位置；熱資料仍能停在 L1。
- **EntityId 在 0.1 為無版本**：`EntityId` 即實體 index。Generation 在內部追蹤以管理 slot 回收，但不編碼在 ID 中。`getEntityIndex` / `getEntityGeneration` / `packEntity` 為 identity helper。ABA-safe 的 `EntityRef` 預計於 0.2 加入。
- **Bitmask 查詢**：多字元 Uint32 mask，預設 8 字元（256 個元件）。Per-world 的位元分配、全域元件身分。
- **Worker / SAB**：0.1 採 snapshot-copy 語義（傳送時序列化進 SAB、接收時 deserialize），而非真正的共享記憶體欄位別名。API 符合契約；真正的共享欄位於 0.2 推出。
- **二進位序列化**：JSON payload 包在 4 byte magic + version header 內。緊湊的二進位欄位編碼預計於 0.2 加入。

### 新增

- `README.md`（英文）與 `README_ZHTW.md`（繁體中文）：含快速上手、使用指引、API 參考、效能、多執行緒指引、WebGPU 互通區段、序列化指引、移轉指引以及「給 AI 助手」區段。
- `llms.txt` — Jeremy Howard 格式 AI 探索檔。
- `llms-full.txt` — LLM 直接吃整份 API 與範例的單檔。
- `api.json` — 機器可讀的匯出清單，每筆都有 stability 與 `since` 欄位。
- `STABILITY.md` 與 `STABILITY_ZHTW.md` — 各 export 的穩定度契約。
- `docs/MIGRATION.md` 與 `docs/MIGRATION_ZHTW.md` — 從 bitECS 0.4、miniplex 2.0、ECSY 移轉的指引。

### API 表面公告

- Core：`createWorld`、`destroyWorld`、`resetWorld`、`getWorldSize`、`getWorldCapacity`。
- Entity：`createEntity`、`destroyEntity`、`entityExists`、`getEntityIndex`、`getEntityGeneration`、`packEntity`。
- Component：`defineComponent`、`defineTag`、`defineObjectComponent`、`addComponent`、`removeComponent`、`hasComponent`、`getComponent`、`setComponent`、`Types`。
- Query：`defineQuery`、`runQuery`、`forEachEntity`、`iterQuery`、`enterQuery`、`exitQuery`、`queryArchetypes`（experimental）。
- System：`pipe`。
- Subpath `aiecsjs/loop`：`createLoop`。
- Subpath `aiecsjs/commands`：`createCommandBuffer`、`flush`、`withCommandBuffer`。
- Subpath `aiecsjs/observers`：`observe`、`onAdd`、`onRemove`、`onSet`。
- Subpath `aiecsjs/serialize`：`serializeWorld`、`deserializeWorld`、`toJSON`、`fromJSON`、`createDeltaSerializer`（experimental）。
- Subpath `aiecsjs/worker`（experimental）：`transferableSnapshot`、`adoptSnapshot`、`attachWorld`、`detachWorld`。
- Subpath `aiecsjs/relations`（experimental，尚未實作）：`defineRelation`、`addRelation`、`removeRelation`、`getRelationTargets`、`ChildOf`。
- 工具：`VERSION`、`IS_SAB_SUPPORTED`、`isWorld`、`isEntity`。

### 0.1 已知限制

- `aiecsjs/relations` 與 `aiecsjs/worker` 已實作但仍標 experimental；API 可能調整。
- 網路 delta 為 JSON 格式；緊湊二進位 patch format 預計於 0.2 加入。
- AoS 元件僅限主執行緒；無法經由 SharedArrayBuffer 共享。
- 尚無自動系統排程器 / 平行執行。
- Worker/SAB 在 0.1 採 snapshot-copy 而非真正的共享記憶體別名。
- EntityId 無版本；ABA-safe 的 `EntityRef` 預計於 0.2 加入。

[Unreleased]: https://github.com/yshengliao/aiecsjs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yshengliao/aiecsjs/releases/tag/v0.1.0
