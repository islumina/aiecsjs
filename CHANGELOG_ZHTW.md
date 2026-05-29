# 變更紀錄

[English](CHANGELOG.md) | [繁體中文](CHANGELOG_ZHTW.md)

`aiecsjs` 的所有重要變更都記錄在本檔案。

格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，並遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [0.4.0] - 2026-05-29

### 新增

- **`getRelationData(world, source, rel, target)`**：`aiecsjs/relations` 新增 stable 匯出。回傳透過 `addRelation` 附加的 `data` payload，若 edge 不存在或未儲存 data 則回傳 `undefined`。補足自 0.1 起存在的寫入而無讀取 API 的不對稱。

### 變更

- **`aiecsjs/relations` 由 experimental 升為 stable。** 圖形 API（`defineRelation`、`addRelation`、`removeRelation`、`getRelationTargets`、`getRelationData`）以及內建 `ChildOf` 關係已為 1.x 凍結。完整穩定度契約（含 raw slot-keying ABA 語意說明）詳見 [`STABILITY_ZHTW.md`](./STABILITY_ZHTW.md)。
- **`aiecsjs/worker` 維持 experimental。** 真正 SAB 共享記憶體欄位 aliasing 延後；worker sub-path 仍使用 snapshot-copy 語義。

### 建置與工具

- **size-limit → `scripts/check-size.mjs`**：以零相依的自製腳本取代 `size-limit` + `@size-limit/file` devDep。腳本量測每個 ESM entry 的遞迴 chunk closure gzip 大小。背景：`tsup splitting: true`（0.3.1 引入）使每個 entry 僅是薄殼，傳統單檔量測對 index.js 僅報 ~899 B，實際 closure 為 ~7295 B。新腳本透過 BFS 遞迴解析 chunk import、加總各檔 gzip，並對每個 entry 套用預算上限。
- **npm → pnpm**：`package-lock.json` 遷移至 `pnpm-lock.yaml`；加入 `"packageManager": "pnpm@9.12.3"` 與 `"publishConfig": { "access": "public" }`；CI 與 publish workflow 改用 `pnpm/action-setup@v6` + `pnpm install --frozen-lockfile`。publish workflow 中刻意保留 `npm publish --provenance --access public`（OIDC trusted publishing 需要 npm CLI）。
- **Coverage 補測 + 缺口文件化**：新增測試覆蓋 `serialize.ts`、`component.ts`、`query.ts`、`loop.ts` 的可達路徑；門檻調整為誠實達到的 floor（statements 95 / branches 81 / functions 98 / lines 99）；設計上不可達的殘餘缺口已在 `vitest.config.ts` 以 Chesterton 理由說明。

## [0.3.1] - 2026-05-29

### 修復

- **packed EntityId 有號溢位（generation ≥ 128）**：`createEntity` 在 generation ≥ 128 時回傳負數，與 archetype row 陣列（`Uint32Array`）儲存的 unsigned 值不一致，導致查詢迭代（`runQuery`/`iterQuery`/`forEachEntity`）吐出的 eid 無法通過 `entityRow` 查詢；對查詢迭代出的高 generation entity 呼叫 `refOf`/`entityExists`/`deref` 行為異常（對活著的 entity，`refOf` 拋出例外）。`packEid`/`packEntity` 現以 `>>> 0` 正規化為 unsigned。公開 bundle 行為除修正後的 eid 表示外無其他改動（EntityId 為 opaque + 僅限記憶體內）。
- **`toJSON` 靜默遺漏高 generation entity（gen ≥ 128，預設 8-bit generation）**：`toJSON` 有自己的 inline pack 算式，對 gen ≥ 128 產生負數，與 `arch.entityRow` 儲存的 unsigned key 不一致。受影響的 entity 雖通過 archetype 檢查，卻無法通過 `entityRow.has()`，導致它從所有 snapshot 與 `serializeWorld` 呼叫中遺失。修正：以 `packEid`（含 `>>> 0`）取代 inline 算式（SPOT 原則：唯一的 pack 來源）。
- **跨 subpath registry 隔離**（`tsup splitting: false` → `splitting: true`）：每個編譯後的 entry（`dist/index.js`、`dist/serialize.js` 等）原本各自捆一份 `internal/world.ts` 的私有副本，包含 module-scope 的 `worldRegistry`。透過核心 subpath 建立的 world，對從其他 subpath import 的 `serializeWorld`/`getRelationTargets`/`transferableSnapshot` 均不可見，導致 `world N is destroyed or unknown`。改為 `splitting: true` 後，esbuild 抽出共用 chunk；ESM 與 CJS 皆由新的 `scripts/check-dist-subpaths.mjs` 冒煙測試驗證。
- **`getRelationTargets` 回傳 raw index 當作 `EntityId`（generation 永遠為 0）**：`addRelation` 以 raw slot index（`& indexMask`）儲存 target。舊版回傳路徑直接將此 raw index 轉型為 `EntityId`，等同於 generation=0 的 packed id。對任何已回收的 target（gen > 0），呼叫端拿到的是過期 id，導致 `entityExists`、`entityRow` 查詢、component 存取全部失敗。修正：回傳前以 `packEid` 將每個 raw index 與當前 generation 重新 pack。
- **`resolveOptions` 未驗證 `indexBits + generationBits ≤ 32`**：各自的範圍檢查（`indexBits ∈ [1, 24]`、`generationBits ∈ [0, 16]`）允許 `indexBits=24, generationBits=16`（40 bits），此時 `gen << 24` 靜默溢位，高 generation bits 遺失。現在加入加總上限驗證，並附上清楚的錯誤訊息。`[Unreleased]` 中的範例同步修正（`indexBits: 16, generationBits: 16` = 32 bits）。

### 已知限制

- **`createDeltaSerializer.apply` 與已回收 target world**：`apply` 直接以 delta snapshot 內的 raw entity index 作為 `EntityId` 使用。若 target world 已回收任何 slot（generation > 0），component 操作會靜默作用在錯誤的 packed id 上。這是 experimental delta API 的已知限制；常見用途（delta → 全新 gen-0 render mirror world）不受影響。正確的 raw-index-to-packed-id 映射留待 0.4 修正。避免對已有 destroy entity 的 world 使用 `apply`。

### 文件

- README / README_ZHTW 同步更新以反映已出貨的 0.3.0 `EntityRef` API：先前 README 仍將 EntityRef 描述為「0.3+ 預計推出」，並將 `getEntityGeneration`/`packEntity` 標為 experimental。兩份文件現均正確說明 EntityId 自 0.3 起已打包，且 `EntityRef` / `refOf` / `deref` / `aliveRef` / `EntityNotAliveError` 均已於 0.3.0 升為 stable。API table 補齊上述符號的條目。

### 建置與工具

- Coverage gate：安裝 `@vitest/coverage-v8` 並接入 `prepublishOnly`（取代 `npm run test`）及 CI。門檻：statements 95 / branches 80 / functions 97 / lines 98 — 純淨原始碼上可達的實際標準。branch 數字尊重 TypedArray 讀取的 `?? 0` / `noUncheckedIndexedAccess` 慣用法（nullish fallback 分支依設計不可達）；門檻只透過補測試提升，絕不靠移除防禦碼或灑 `/* v8 ignore */`。
- `fast-check` property test（`tests/properties.test.ts`）：pack/unpack round-trip 不變式（斷言 `e >= 0` 以防守 P0 回歸）與 ABA-deref 必為 null 不變式。
- dispose 三循環測試、error-path 測試、observer handler throw 行為文件化，分別加入 `tests/world.test.ts` 與 `tests/observers.test.ts`。
- `scripts/check-dist-subpaths.mjs`（`npm run verify:dist`）：build 後冒煙測試，從核心 subpath import `createWorld`+`createEntity`，再從各自 subpath 呼叫 `serializeWorld`、`addRelation`/`getRelationTargets`、`transferableSnapshot`；ESM（`dist/*.js`）與 CJS（`dist/*.cjs`）均驗證。納入 `prepublishOnly`（`build` 之後）及 CI。

## [Unreleased]

### 0.4+ 規劃

- 加入 `pipeAsync` 以支援非同步系統組合。
- 引入 doc-test 工具，使 README 中的程式碼區塊能被機械化驗證。
- 待真正 SAB 共享記憶體欄位 aliasing 完成後，將 `aiecsjs/worker` 升為 stable。
- 在 [STABILITY.md](./STABILITY_ZHTW.md) 中說明 8-bit generation wrap 的注意事項：
  預設 `generationBits=8` 下，同一 slot 連續回收 256 次後 generation wrap 回原值，
  ABA 防護視窗會短暫失效。對 v0.5 飛行射擊試做工作負載安全（60 fps × ~1k destroy/sec
  下單 slot 約需 5000 frame 才 wrap）；高生滅率 pool 建議改用
  `createWorld({ indexBits: 16, generationBits: 16 })`（16 + 16 = 32 bits；
  65 536 個 entity × 65 536 個 generation）。對應測試見
  [tests/ref.test.ts](./tests/ref.test.ts) 的 `generation wrap` describe block。

## [0.3.0] - 2026-05-29

### 新增（API）

- **`EntityRef<T>`** — ABA-safe entity reference。`refOf(world, eid)` 建立 ref；
  `deref(world, ref)` 在 entity 仍存活（generation 符合）時回傳 entity id，
  否則回傳 `null`；`aliveRef(world, ref)` 為布林 guard 形式。
  Phantom type `T` 讓呼叫方在型別系統中區分 ref 種類（如 `EntityRef<'bullet'>`），
  不產生任何執行期開銷。Ref 僅限記憶體內使用，不可序列化至 worker / 磁碟。
- **`EntityNotAliveError`** — `refOf` 在 entity 已死亡或無效時拋出此錯誤。
  `deref` / `aliveRef` 絕不拋出。

### 變更

- **`EntityId` 現在將 index + generation 打包**為單一 32-bit 數字
  `(generation << indexBits) | index`（預設 `indexBits=24, generationBits=8`）。
  `EntityId` 依 STABILITY 契約仍為 opaque；佈局屬實作細節。
  **遷移注意**：請勿直接比對 `EntityId` 數字（`eid === 42` 在 slot 回收後會失效）；
  改用 `getEntityIndex(eid)` 進行 index 比對，或用 `refOf(world, eid).id` 做
  能跨 slot 回收的 identity 比對。
- **`getEntityGeneration` / `packEntity` 升為 `stable`**（自 0.2.0 起為 experimental）。
  兩者現回傳真實值，使用預設 24/8 bit 佈局；
  若使用非預設 `createWorld({ indexBits, generationBits })`，
  請改用 `EntityRef` + `deref` 取代手動拆解。

### 修復

- **entity slot 回收的 ABA bug**：舊版 `entityExists` 與 `isAliveInternal` 僅
  檢查 archetype 成員資格；指向已回收 slot 的過期 `EntityId` 會誤報為存活。
  透過打包 generation + `deref` 的 generation 比對，過期 ref 現在可正確失效。
- **`destroyEntity` generation wrap mask 改為對應 `options.generationBits`**
  （原為 hard-coded `& 0xffff`）。mask 現在正確使用 `state.options.generationMask`，
  修正非預設 `generationBits` 下的不一致問題。

### 文件

- `onSet` JSDoc 說明 `addComponent` **不會**觸發 `onSet`，且
  直接寫入 `getComponent` 回傳的 column view（如 `col.x[idx] = 5`）
  同樣**不會**觸發 `onSet`。只有 `setComponent` 對已存在的 component 才會
  觸發 callback。加入 anti-pattern 範例。

### 相容性

- `EntityId` 佈局變更在型別系統層面**不屬於 breaking change**（opaque branded number），
  但依賴 `eid === N` 直接比對的消費者需遷移（見上方遷移注意）。
- 所有既有 `stable` 匯出簽名不變。
- `aiecsjs/worker` snapshot wire format 不變（仍使用 raw index）。
- `aiecsjs/serialize` wire format 不變。

### 建置與工具

- `VERSION` 常數升至 `0.3.0`。

## [0.2.1] - 2026-05-28

### 安全

- **解掉兩個 Dependabot moderate 報告**，升級 `vitest` 1.6.0 → 4.1.7。新增 `vite` 8.0.14 為直接 devDependency 以滿足 vitest 4 的 peer 範圍（`^6 || ^7 || ^8`）。皆為 dev-only ─ 執行階段表面無變動。
  - [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) `esbuild <=0.24.2` 開發伺服器 CORS 資料外洩（0.25.0 修正）。
  - [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) `vite <=6.4.1` 在 optimized deps `.map` 處理的路徑遍歷（6.4.2 / 7.3.2 / 8.0.5 修正）。

### 變更

- **README 開頭統一為 ai*js 家族同款**：五徽章樣式（npm + CI + License + AI Generated + 語言切換）、單行 tagline 引用、生態系 footer 互連。取代過去的混搭風格。
- **`VERSION` constant 升至 0.2.1**（[src/version.ts](src/version.ts)），讓 `world.version` 與 snapshot meta 反映本次發版。

執行階段表面未變動。Production bundles 與 0.2.0 一致。

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
