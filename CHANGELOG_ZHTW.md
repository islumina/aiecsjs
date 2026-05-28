# 變更紀錄

[English](CHANGELOG.md) | [繁體中文](CHANGELOG_ZHTW.md)

`aiecsjs` 的所有重要變更都記錄在本檔案。

格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，並遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 變更（0.1.0 後文件誠實化）

- README 與 STABILITY 現以「snapshot-copy 傳輸」誠實描述 `aiecsjs/worker` 在 0.1 的實作；真正的共享欄位仍為 0.2 目標。README 與 `package.json` description 同步更新。
- README 註明 0.1 的 `EntityId` 為純索引值；內部世代計數用於追蹤槽位重用但不編入 ID。具 ABA 安全的 `EntityRef` 列入 0.2 roadmap。
- STABILITY 重新定位 sub-path（`loop` / `commands` / `observers` / `serialize` / `worker` / `relations`）為 utility / adapter sub-path；根目錄 `aiecsjs` 才是穩定核心。應用未引用的 sub-path 可被 tree-shake 移除。
- README 新增「aiecsjs 明確不做的事」章節，列出非目標：系統排程、render 綁定、物理、網路複製、value-predicate 反應式查詢、prefab / 繼承。
- 語言版本檔名由 `*.zh-TW.md` 改名為 `*_ZHTW.md`。跨檔連結、`llms.txt`、`package.json` `files` 同步更新。未來其他語言版本依相同的大寫 ISO 639-1 規則命名。
- 文件移除 emoji（語言切換器、狀態旗標等）。

### 建置與工具

- tsup 建置開啟 `minify: true`。
- 新增 size-limit dev 相依；CI 對每個 export 加 budget gate：core ≤ 8 kB gzip，每個 sub-path 各自設限。實測：core 5.49 kB，全 sub-paths 合計 12.6 kB gzip。
- 新增 GitHub Actions CI workflow：在 push 與 PR 至 `main` 時跑 typecheck → test → build → size check。


### 0.2 規劃

- 實作 `aiecsjs/relations`：`defineRelation`、`addRelation`、`removeRelation`、`getRelationTargets`、`ChildOf`。
- 加入 `pipeAsync` 以支援非同步系統組合。
- 引入 doc-test 工具，使 README 中的程式碼區塊能被機械化驗證。

### 0.3 規劃

- 將 `aiecsjs/relations` 與 `aiecsjs/worker` 提升為 `stable`。
- 穩定網路 delta 的 wire format。
- 加入自動化效能評測套件並提交於 repo。

### 1.0 規劃

- 凍結 1.x 系列的 API。
- 移除 experimental 狀態標籤。

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
