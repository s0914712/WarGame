# Mini Taiwan Pulse — Wargame Mode

> 在原台灣即時資料視覺化專案上建構的**單人台海/離島兵棋平台**。
> 同一個 Mapbox 底圖、同一份 codebase，URL 加上 `?mode=wargame` 即進入兵棋模式。

---

## 一、專案是什麼

把原本「資料視覺化 demo」變成可推演的戰場：
- 可暫停即時制（1×/5×/30×/60× 加速）
- 14 種單位（機動飛彈車 / 無人機 / 銳鳶 UAV / 銳穫 UAV / 船艦 / 潛艦 / 戰機 / 反潛直升機 /
  雷達站 / 機動雷達車 / 海岸 SAM / 愛國者 SAM / 補給艦 / 空軍基地）
- NATO APP-6 軍事符號（藍方 / 紅方 / 中立分色與形狀）
- 偵測 + 戰爭迷霧 + 隱身（stealth）
- 航線規劃編輯器 + 驗證（地形 / 油料 / 時間）
- 自動接戰（auto-engage）+ 飛彈飛行 + 命中判定 + 戰報
- LLM JSON 介接（state out / commands in / result back）

兩種模式並存：
- 預設 / `?mode=civilian` → 原視覺化（App.tsx）
- `?mode=wargame` → 兵棋（WargameApp.tsx）

---

## 二、目錄與模組地圖

每個檔案責任單一、可獨立替換。下方依照「資料 → 引擎 → 視覺 → UI」分層。

### `src/wargame/types.ts` — 中央型別
| 型別 | 用途 |
|---|---|
| `UnitKind` | 14 種：`missile_launcher` / `drone` / `uav_ruiyuan` / `uav_ruihuo` / `ship_surface` / `submarine` / `fighter` / `asw_helo` / `radar_station` / `mobile_radar` / `sam_coastal` / `sam_patriot` / `supply_ship` / `airbase` |
| `Domain` | `land` / `air` / `sea` / `subsurface` |
| `CoreAttributes` | 5 個 UI 可調屬性：rangeKm / speedKnots / movementRangeKm / detectionRangeKm / hpMax |
| `ExtensionKey` | 15 個保留 enum（armor / stealthRcs / ecmStrength / ...） |
| `Side` | 陣營定義 + 顏色 + 敵對關係 |
| `Unit` | runtime instance（含位置、core、extensions、detectedBy、hpCurrent、waypoints） |
| `Command` | 排隊指令（set_waypoints / set_speed / engage / hold） |
| `Missile` / `Explosion` | 戰鬥視覺實體 |
| `Scenario` | 場景定義（含 sides / units / camera / 勝利條件） |
| `SimulationState` | engine 內部唯一狀態 |
| `EngagementEvent` | 偵測 / 開火 / 命中 / 落空 / 擊毀 事件 |

### `src/wargame/clock.ts` — 兵推時鐘
平行於民用 `timeStore`，管理 **sim-time T+**：
- `wargameClock.pause() / resume() / toggle() / setRate(n) / seek(sec)`
- `tickFromWall(now)` — 由 `useWargameClock` RAF 驅動
- `subscribe(cb)` — UI / engine 訂閱用

### `src/wargame/scenarioStore.ts` — 場景狀態 external store
- `getState()` / `setState()` — engine 唯一寫入點
- `loadScenario(s)` — 重置整個世界
- `setSelectedUnitId(id)` / `getSelectedUnit()` — UI 選單位
- `updateUnitAttribute(id, key, value)` — slider 即時改 core
- `enqueueCommand(cmd)` — 編輯器與 LLM 都走這
- `isFogOfWar() / setFogOfWar(v)` — FoW 嚴格 / 寬鬆切換
- `subscribe(cb)` — symbol / route / radar / log 層全部訂閱

### `src/wargame/catalog/units.ts` — 單位目錄
`UNIT_CATALOG: Record<UnitKind, UnitCatalogEntry>` 一個物件管全 14 種：
- `domain` / `iconShape` / `defaultAltitudeM`
- `defaultCore` — 場景未指定就用這套
- `defaultExtensions` — 放置 / 載入場景時預填的 extension（如 UAV 的 `endurance` 滯空時數、`commandRadiusKm` 作戰半徑）
- `uiRanges` — slider 的 min/max/step/unit
- `constraints` — `forbidDomains` / `defaultPlanTimeLimitSec` / `requireRoundTrip`

加新單位 = 改 `UnitKind` enum + 加一筆 catalog 條目 + 加一筆 SIDC。

### `src/wargame/scenarios/`
| 檔 | 用途 |
|---|---|
| `empty.ts` | Phase 1 預設空場景 |
| `strait_2030.ts` | 台海中線對峙 ~35 單位 |

未來加場景：新 `.ts` 檔，匯出 `Scenario` 物件即可被 ScenarioPicker 載入。

### `src/wargame/sim/` — 模擬引擎（純函式）
| 檔 | 用途 |
|---|---|
| `engine.ts` | `tick(state, dt)` + `step(state, dt)` 含 0.5s sub-tick 切片 |
| `movement.ts` | `advanceUnit(u, dt)` — waypoint 跟隨 + 大圓插值 + 油料上限自動停 |
| `detection.ts` | `computeDetection(units, sides)` — 全陣營 sensor pool + stealth 折扣 |
| `commands.ts` | `applyDueCommands(state)` — 到期指令套用 |
| `combat.ts` | `runCombat(state, ruleSet, dt)` — auto-engage / 開火 / 飛彈推進 / 命中 / 擊毀 |
| `rules/v1.ts` | `COMBAT_RULES_V1` — CombatRuleSet 預設實作（pluggable） |
| `terrain.ts` | `TerrainProbe` 介面 + 台灣陸地多邊形預設 |
| `validate.ts` | `validatePlan(unit, waypoints, opts)` — 燃料 / 時間 / domain 違規 |
| `geo.ts` | Haversine 距離 / bearing / advanceTowardKm / knots→km/s |
| `rng.ts` | deterministic LCG（重播用） |

### `src/wargame/editor/editorStore.ts` — 編輯器狀態
- `editorMode: "view" | "planRoute"`
- `startPlanRoute(unitId)` — 自動暫停 clock、進規劃模式
- `appendWaypoint(lng, lat)` / `removeLastWaypoint()` / `clearPending()`
- `commit()` — 驗證通過後 enqueueCommand
- `cancel()` — 丟棄 pending、恢復播放
- `clearUnitWaypoints(id)` — 一鍵清航線

### `src/wargame/symbology/` — NATO 符號
| 檔 | 用途 |
|---|---|
| `sidc.ts` | 14 種 × 5 陣營 = 70 SIDC，iconNameOf() 對應 |
| `loadSymbols.ts` | 啟動時用 milsymbol 產 SVG → Mapbox `addImage` |

### `src/wargame/search/` — 無人機搜索規劃（IAMSAR）
純函式解算，依《搜索參數的選擇與機率》與《六大搜索圖形》實作。完整模型與出處見
[`docs/search-planning.md`](./docs/search-planning.md)。

| 檔 | 用途 |
|---|---|
| `sweepWidth.ts` | 未修正掃掠寬度 Wu 查表（高度 × 能見度 × 目標尺寸）+ `W = Wu × Fw × Fv × Ff` |
| `pod.ts` | 覆蓋因子 `C = W/S`、POD 曲線（由文件表 4-2 反解）、累積 POD、顯示封頂 |
| `patterns.ts` | 六大圖形 metadata + 擴展方形航段表（表 4-3）+ 航跡間距上限 + 圖形建議 |
| `planner.ts` | 兩個解算方向：`solveForTime()`（給架數→時間/POD）、`solveForAssets()`（給時間→架數/圖形） |
| `tracks.ts` | 圖形 → 每架無人機的 waypoint 陣列（PS/CS/SS/VS/TS；等高線不自動產生） |
| `searchPlannerStore.ts` | external store：搜索區、參數、產生的航線、指派到單位 |

搜索五要素 `A = T × N × P × S`。產生的航線經 `enqueueCommand({ kind: "set_waypoints" })`
下達，engine 仍是 units 的唯一 mutator。

### `src/wargame/llm/` — LLM 介接
| 檔 | 用途 |
|---|---|
| `schema.ts` | 3 個 document type：State / Commands / Result |
| `exportState.ts` | scenarioStore → JSON（給 LLM 看的戰場態勢） |
| `applyCommands.ts` | LLM JSON → 驗證 → enqueue → 回 result |
| `schemaDoc.ts` | Markdown schema doc（給 LLM 當 system prompt） |

支援 5 種指令：`set_waypoints`、`set_speed`、`engage`、`hold`、`update_attributes`。

### `src/map/` — Mapbox 視覺層（兵棋部分）
| 檔 | 用途 |
|---|---|
| `wargameSymbolLayer.ts` | NATO 符號 + callsign 標籤 + FoW 過濾 |
| `wargameRangeRings.ts` | 選中單位 射程圈（紅）/ 偵測圈（黃） |
| `wargameRouteLayer.ts` | current 航線（淡藍虛線）+ pending（亮橘） |
| `wargameCombatLayer.ts` | 飛彈光點 + 拖尾 + 爆炸環（hit 黃 / miss 灰） |
| `wargameRadarLayer.ts` | 雷達常駐偵測圈（青虛線）+ 資料鏈（黃虛線） |
| `wargameSearchLayer.ts` | 搜索區框 + 掃掠帶 + 各架搜索航線（分色）+ 面積/時間/POD 標籤 |

### `src/components/` — UI（兵棋部分）
| 檔 | 用途 |
|---|---|
| `WargameClockHUD.tsx` | 左上 T+ 顯示 + 暫停按鈕 + 速率切換 + FoW 開關 |
| `UnitEditorPanel.tsx` | 右側選中單位面板：5 slider + 規劃航線 / 驗證 |
| `EngagementLog.tsx` | 左下戰報滾動（含 50 條最近事件 + 摺疊） |
| `LLMPanel.tsx` | 全螢幕 modal：State / Commands / Schema 三分頁 |
| `SearchPlannerPanel.tsx` | 右側搜索規劃器：框搜索區 → 解算掃區時間 / POD / 建議架數與圖形 → 產生航線並指派 |

### `src/hooks/`
| 檔 | 用途 |
|---|---|
| `useWargameClock.ts` | RAF 驅動 `wargameClock.tickFromWall` + 同步寫 `timeStore` + UI snapshot |
| `useSimLoop.ts` | 監聽 sim-time 變化 → 呼叫 `engine.step()` |

### 頂層
| 檔 | 用途 |
|---|---|
| `src/main.tsx` | `?mode=wargame` 分流到 WargameApp |
| `src/WargameApp.tsx` | 載場景 + 掛 5 個 Mapbox layer + click 路由（view / planRoute） |

---

## 三、架構模式

### External store + RAF + Mapbox layers
**為什麼不用 Redux**：60 FPS RAF 不該觸發 React re-render。三個 store 各管一塊：
- `timeStore`（民用時間）/ `wargameClock`（sim-time）— 時間
- `scenarioStore` — 世界內容
- `editorStore` — UI 模式（規劃 / 檢視）

UI 用 `useSyncExternalStore` + 快取 snapshot 訂閱；Mapbox layer 用 `subscribe()` 重畫 source。

### Engine pipeline（每 tick）
```
1. applyDueCommands  — 到期指令套用
2. movement          — 所有單位 waypoint 跟隨 + 油料判定
3. detection         — 偵測狀態更新（含 stealth）
4. combat            — auto-engage / 開火 / 飛彈推進 / 命中 / 擊毀
```

**Sub-tick guard**：60× 速率下單一 frame ≈ 0.96 秒 sim time，太粗。`step()` 切成 ≤ 0.5s 的 sub-tick 避免飛彈交戰時序錯亂。

### 命令流（Editor / LLM 共用）
```
UI / LLM
  ↓ enqueueCommand(cmd)
scenarioStore.pendingCommands
  ↓ engine.tick → applyDueCommands
units[id].waypoints / speed / engagingTargetId 改寫
  ↓ Mapbox layers subscribe → setData
畫面更新
```

**規則**：engine 是 units 的唯一 mutator；其他都走 `enqueueCommand`。`updateUnitAttribute` 例外（給 UI slider 即時反饋用，不走指令佇列）。

---

## 四、擴展 hook

| 想做的事 | 動哪裡 |
|---|---|
| 換更精準地形（GeoJSON / DEM） | `setTerrainProbe(impl)` |
| 換戰鬥公式（Salvo / Lanchester） | 實作新 `CombatRuleSet`，engine 換 ruleSet |
| 加新 unit attribute（不必改 schema） | 用 `unit.extensions[k]` + 加 `ExtensionKey` enum |
| 加新移動限制（禁飛 / 天候） | `validate.ts` 加新 `RouteIssueType` |
| 加新 LLM 命令 | `schema.ts` 加 union member + `applyCommands.ts` 加 switch case |
| 加新單位種類 | `UnitKind` enum + `UNIT_CATALOG` + `sidc.ts` 加 SIDC + `UnitPalette` KIND_OPTIONS + `scriptedAiV2.roleOf` + `UnitScene.domainOf` |
| 換符號集（MIL-STD-2525D） | `loadSymbols.ts` 改 milsymbol 版本 / 加 standard option |
| FoW 升級為 4 級漸進 | `detection.ts` 加 unknown/classified 計時器 + symbol layer 多 opacity 階段 |

---

## 五、Roadmap：多方對戰（紅方人/AI 操作）

目前**紅方只跑 scripted scenario commands**，藍方是玩家。下一階段讓紅方也成為「玩家」：

### Phase 7a — POV / 陣營所有權
- 新型別 `SideOwnership = "human" | "ai" | "scripted"` 加到 `Side`
- 新 store `viewStore.activeSideId` — 玩家當下「視角」是哪個陣營
- 改 `wargameSymbolLayer.ts` + `wargameRadarLayer.ts` 把 `PLAYER_SIDE` 常數改成 `viewStore.activeSideId`
- UI 加「視角切換」（右上角 dropdown）
- 同樣的 FoW / detection 規則套到任一視角

### Phase 7b — LLM as Adversary（紅方 LLM 操控）
- 新 hook `useAiSideLoop({ sideId: "red", intervalSec: 30 })`
- 每 30 sim-sec：
  1. 建 LLM state export（**只含紅方 POV** — 過濾 detectedBy.red）
  2. 呼叫使用者設定的 LLM endpoint（Anthropic / OpenAI / 本地）
  3. 收到 commands JSON → applyLlmCommands 加 `{ pauseFirst: false, sideFilter: "red" }`
- `applyCommands.ts` 加 `sideFilter` 選項：拒絕對非該陣營單位的指令
- UI：設定 LLM API key + interval

### Phase 7c — 簡單腳本 AI（不用真 LLM）
- `src/wargame/ai/scriptedAi.ts`：直接寫 if/else 邏輯
- 例如：「敵方 < 100km → 退；自己彈藥充足 + 敵方未偵測自己 → 接近」
- 跑相同的 useAiSideLoop pattern，只是換成 local function

### Phase 7d — 雙人對戰（網路）
- 需要：authoritative server + deterministic engine + 命令同步
- 既有 deterministic RNG（rng.ts）+ pure engine.tick 已具雛形
- 工作量：~1 週，先 PoC：WebRTC P2P + lockstep simulation

### Phase 7e — Replay 系統
- `src/wargame/replay/recorder.ts` — 每 10 sim-sec 寫 SimulationState snapshot + 所有 enqueueCommand
- `src/wargame/replay/player.ts` — replay 模式：禁止互動、setState 依序套用
- Export 成 JSON 檔可分享給觀眾

---

## 六、單位屬性擬真依據（v2 數值）

數值參考各國公開資料（射程 / 速度 / 偵測範圍）。為視覺化考量縮放（雷達實際偵測範圍對彈道飛彈可達 5000 km，畫面上會塞滿，故限縮至 800 km 為任務偵測範圍）。

| 單位 | rangeKm | speedKnots | movementRangeKm | detectionRangeKm | hpMax | 參考 |
|---|---|---|---|---|---|---|
| 飛彈發射車 | 250 | 60 | 800 | 30 | 80 | 雄三 ASM 射程 150–400 km |
| 無人機 | 100 | 180 | 2000 | 200 | 20 | 翼龍/騰雲級偵察 |
| 船艦 | 150 | 30 | 8000 | 250 | 300 | DDG/FFG 反艦飛彈 + AESA |
| 潛艦 | 50 | 20 | 15000 | 60 | 200 | 魚雷 + 被動聲納 |
| 戰機 | 100 | 800 | 1500 | 180 | 50 | AAM + 機載 AESA |
| 雷達站 | 0 | 0 | 0 | 800 | 250 | PAVE PAWS（任務模式） |

潛艦 stealth = 0.7–0.75（被動聲納特性）。

---

## 七、開發約定

- 任何寫入 `scenarioStore.units` 必須走 `engine.tick` 或 `updateUnitAttribute()` 兩條路
- 任何寫入 `pendingCommands` 必須走 `enqueueCommand()`
- 訂閱 sim 時間：**禁止** 把 simTime 放 React deps，必須用 `wargameClock.subscribe` 或同步 `getSimTime()`
- 加新 Mapbox layer 必須提供 cleanup function（HMR 友善）
- TS 嚴格 `noUncheckedIndexedAccess` 開啟 — array 存取要 fallback 或顯式判 undefined
- Commit 前 `npx tsc -b` 必須 pass
