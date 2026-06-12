# 專業兵棋 Gap Analysis

> 目標對標：CMO（Command: Modern Operations）/ VBS3 / JTLS 級正規軍事訓練平台
> 用途：盤點現有 wargame 模式還缺什麼，方便後續分階段補。

## 目前已有
偵測（**漸進狀態機 unknown→classified→tracked，A2 ✅**）/ **ROE 交戰規則（D15 ✅）** /
自動接戰 / 飛彈 + 拖尾 + 爆炸 / **飛行剖面 sea_skim/cruise/ballistic（B7 ✅）** /
**分層防空攔截彈 CIWS/SAM/愛國者 + 反彈道（B8 ✅）** /
**地形遮蔽 + 雷達地平線（A5 ✅）** / **反潛聲納方程式 主動/被動（E20 ✅）** /
殘骸 / NATO SIDC / FoW / 多陣營 / POV /
**8 場景**（含反潛護航）+ 11 單位 / Plan Mode / Replay JSON / LLM Adversary / 勝負判定 / 戰況統計

> 進度（2026-06）：A2 偵測狀態機 + D15 ROE + B7/B8 飛行剖面與分層防空 + A5 地形遮蔽/地平線
> + E20 反潛聲納（聲納方程式）已實作。
> A5 用 `Scenario.terrainOcclusion`（預設啟用）；E20 用 `Scenario.acousticModel`（預設關閉，
> 在「反潛護航」場景啟用）。地形 LOS 為中央山脈三角剖面近似（無 DEM）。
> 下一波建議：B6 多武器掛載（攔截彈與攻擊分艙）、A1 多 sensor type、A5 升級真實 DEM。

下方按 6 大領域 + 24 項缺口分析。每項都帶「為什麼專業級需要」+「在現有架構怎麼插」。

---

## A. 偵測與情資（最大短板）

### A1. 分層感測器（多種 sensor type）
**現況**：每單位只有一個 `detectionRangeKm`
**為什麼重要**：實戰中 radar / IR / passive ESM / sonar / SIGINT 各有特性。對艦雷達看不到水下、IR 看不穿雲、ESM 只能在敵方主動發射時偵測 → 戰術選擇取決於用哪種 sensor。
**如何插**：
- `types.ts` 加 `Sensor[]` 陣列到 Unit（`{ kind: "radar"|"ir"|"passive_em"|"sonar"|"visual", rangeKm, arcDeg, classifyTimeSec, activeEmits }`）
- `sim/detection.ts` 改成遍歷每個 sensor，依目標 domain（air/sea/sub）+ 屬性（IR signature / RCS）算 detect
- catalog 為每種 unit 配預設 sensor 組合

### A2. 偵測狀態機（unknown → classified → tracked → lost）
**現況**：`DetectionState` 型別已定義 4 級，但 detection.ts 只用 hidden/tracked 二值
**為什麼重要**：真實戰場「看到光點 ≠ 知道是誰 ≠ 可以打」。ROE 通常要求 classified 才能開火。timing 是關鍵戰術元素。
**如何插**：
- `detection.ts` 加 `classifyTimer` per 觀察方 × 目標
- 在感測範圍內持續累計 classifyTimeSec → 升級狀態
- 失聯後 30 秒慢慢降級（lost → unknown → hidden）
- combat.ts 的 `canEngage` 改成需要 ≥ classified 才能 fire

### A3. IFF（敵我識別）+ 誤擊風險
**現況**：side 資訊完美知道（沒有誤判）
**為什麼重要**：商船跟敵艦在雷達上長一樣 → IFF 失效時誤擊中立 → 國際事件
**如何插**：
- Sensor 加 `iffCapable: boolean`
- ROE 加 `requireIff: boolean`，否則只能看到 "unknown" 級
- 攻擊未 classified 的目標 → trigger neutral 誤擊事件

### A4. 機率性偵測 + 假信號
**現況**：距離內 100% 偵測
**為什麼重要**：低 RCS / 海雜波 / 大氣折射 → 真實 PD（probability of detection）< 1.0
**如何插**：
- `detection.ts` 改 `detected = rng() < pd(distance, rcs, weather)`
- pd 公式參考雷達方程簡化版
- 利用既有 `rng.ts` 的 seeded RNG 保持 deterministic

### A5. 地形遮蔽 + 雷達 horizon
**現況**：terrain.ts 只做台灣陸地多邊形 point-in-polygon
**為什麼重要**：山脈擋雷達視線、海平面 horizon 限制（高速反艦飛彈低空突防）；專業兵棋必備
**如何插**：
- 改 `TerrainProbe` 介面 — 加 `elevationAt(lng, lat): number`
- 載 SRTM 30m DEM 簡化版（台海區域 ~10MB）
- detection.ts 內加 LOS（line-of-sight）檢查：sensor 與 target 之間採樣 N 點 elevation
- 海平面 horizon：`sqrt(2 * R * (sensorAlt + targetAlt))`

---

## B. 武器與戰鬥

### B6. 多武器掛載 + 武器型別
**現況**：每單位一個 `rangeKm`
**為什麼重要**：F-16V 可能掛 AIM-120 (BVR AAM) + AIM-9 (短距) + Harpoon (反艦)；不同武器對不同目標 PK 不同
**如何插**：
- `types.ts` 加 `WeaponLoadout[]`（`{ kind: "aam_bvr"|"sam"|"asm"|"torpedo"|"gun", count, rangeKm, pKill, targetDomains, maxAlt, minAlt }`）
- combat.ts 開火前選最適武器（in range + target valid + 有彈藥）
- catalog 為每 unit 配預設 loadout

### B7. 飛彈飛行剖面（ballistic / cruise / sea-skim / pop-up）
**現況**：missile 直線飛、速度固定
**為什麼重要**：DF-26 是彈道飛彈（拋物線、Mach 10+ 末端）、Harpoon 是海面掠飛（10m 高）、Tomahawk 是地形匍匐 — 不同剖面決定能否被攔截
**如何插**：
- `Missile` 加 `profile: "ballistic"|"cruise"|"sea_skim"|"pop_up"`
- combat.ts 內 `tickMissile()` 依 profile 算高度（拋物線公式 / 固定低空 / 末端 pop-up）
- 不同 profile 決定誰能攔（CIWS 只攔低空、Patriot 攔高彈道）

### B8. 分層防空（CIWS + 硬殺 + 軟殺）
**現況**：飛彈飛到目標就直接擲骰
**為什麼重要**：真實艦艇用 ESSM (50km) → SM-2 (170km) → SeaRAM (20km) → Phalanx CIWS (1.5km) 多層攔截。一發 Harpoon 通常被攔截
**如何插**：
- combat.ts 在飛彈抵達前 N 秒，呼叫 `runDefense(missile, defenders)` — 各艦自動發 SAM 攔截器（也是 missile）
- 加 `interceptor` type，攔截彈追蹤 missile，rng vs pKill
- 軟殺：發 chaff/flare → 末端 lock 失效機率

### B9. 彈藥追蹤 + 再裝填
**現況**：`ammoCapacity` / `reloadSec` 在 ExtensionKey 預留但無實作
**為什麼重要**：實戰最重要限制之一。VLS 滿載 96 cells，打完要回港；TEL 4 發後要等補給車
**如何插**：
- combat.ts 開火前檢查 `weapon.count > 0`，扣 1
- 加 `WeaponState[]` to Unit（每 weapon 一筆 count + lastFireSimSec）
- reload tick：到 reloadSec 後恢復 1 發（或固定 batch）

### B10. 反制措施（chaff / flare / decoy）
**現況**：無
**為什麼重要**：飛彈末端 lock 階段，目標放 chaff → 影響 PK；嚴重時 lock loss
**如何插**：
- 加 `Countermeasure` action（耗計數）
- 飛彈抵達前 5 秒，被鎖目標 30% 機率主動釋放 → pKill × 0.4

---

## C. 電子戰 / 通訊（C4ISR）

### C11. 主動 / 被動電子戰
**現況**：`ecmStrength` ExtensionKey 預留，無實作
**為什麼重要**：EA-18G Growler 一架壓制半個防空網；J-16D 對應角色。沒 EW 等於沒有現代空戰
**如何插**：
- 新 `EwState`：每單位有 `jamming: { active, ranges, targetSensorKinds }` / `emcon: "silent"|"normal"|"active"`
- detection.ts 內被 jam 範圍的 sensor 有效距離 × (1 - ecm)
- ESM sensor 只在 EMCON !== silent 時可偵測

### C12. 資料鏈 + 通訊降級
**現況**：感測器即時 + 完美共享（同陣營全看到）
**為什麼重要**：Link-16 / CEC 是現代聯合作戰核心；jamming / comms-out 場景 → 各艦只看自己 sensor → 巨大戰術差異
**如何插**：
- 偵測共享改成「兩單位 connected via datalink 才共享」
- 加 `datalinkRangeKm` per unit
- jam 影響範圍內 datalink 中斷 → fallback to own sensor only

### C13. GPS / SATCOM 依賴
**現況**：所有單位永遠知道自己位置
**為什麼重要**：GPS denied 環境下，巡弋飛彈精度退化、UAV 失去資料鏈、長程射擊 CEP 暴漲
**如何插**：
- 新場景元素：GPSDenialZone (polygon)
- 區域內單位的 weapon CEP × 5, datalink degraded

---

## D. 損傷模型 + 任務管理

### D14. 多狀態損傷（mobility / firepower / sensor / comms）
**現況**：單一 hpCurrent
**為什麼重要**：實戰常見「flight-deck damaged 無法起降」「sensor mast 受損但船還在動」「彈藥庫殉爆」— 單一 hp 太粗略
**如何插**：
- Unit 加 `systems: { mobility: number, firepower: number, sensor: number, comms: number }` 各 0–1
- combat.resolveImpact 改成擲骰決定哪個 system 受損 + 嚴重程度
- 各 system 影響不同行為：mobility=0 速度歸零、firepower=0 不能開火、sensor=0 偵測歸零

### D15. ROE（交戰規則）
**現況**：無 — 一律 auto-engage detected 敵方
**為什麼重要**：實戰常 weapons-tight（不主動開火，只能反擊）、weapons-free（看到就打）、defensive-only
**如何插**：
- Side 加 `roe: "weapons_free" | "weapons_tight" | "defensive_only" | "weapons_hold"`
- combat.ts auto-engage 前查 ROE
- LLM Adversary 可以下命令切 ROE

### D16. 燃料耗用 + 後勤
**現況**：`movementRangeKm` 是固定上限，不隨速度 / 高度變
**為什麼重要**：戰機高速 + 後燃 → 燃料消耗 ×3；補給艦 / 油彈船 / RAS 是海軍核心
**如何插**：
- 加 `fuelKg` + `burnRateKgPerHour(speed, alt)`
- movement.ts 改成扣燃料（不是距離）
- 補給單位類型 + RAS 動作（兩艦低速並航交換）

### D17. 海上補給 / 空中加油
**現況**：無
**為什麼重要**：CSG 持續作戰能力靠補給；KC-135 是空戰倍增器
**如何插**：
- 加 `refueler` unit kind + `refuel` command
- 兩單位接近 + 同向 + 速度匹配 → 進加油狀態 → 慢慢補

---

## E. 環境

### E18. 天氣
**現況**：無
**為什麼重要**：颱風影響飛行作業、低能見度影響光學感測、海象 ≥ 6 級影響直升機起降 / 反潛
**如何插**：
- 加 WeatherZone 場景元素（polygon + visibility / cloud / sea state）
- 影響 sensor effective range（IR / visual 在雲中 ×0.3）
- 影響武器 PK（沙漠風暴下精準彈藥 ×0.7）

### E19. 日夜週期
**現況**：無
**為什麼重要**：夜間光學感測無效、紅外更突出、戰術偏好不同
**如何插**：
- wargameClock 加 `getSunAngle(lng, lat)` 換算當地日照
- 對 visual sensor effective range × max(0.1, sin(sunAngle))

### E20. 聲學層（潛艦戰）✅ 已實作
**現況**：`sim/sonar.ts` 主動/被動聲納方程式
（被動 SE = SL−TL−(NL−DI)−DT；主動 SE = SL_ping−2·TL+TS−(NL−DI)−DT）。
傳播損失含球面擴散 + 吸收 + 溫躍層跨層損失；噪音隨航速增加；
主動聲納偵潛遠但 ping 曝露自身。**會聚區（CZ）**於 ~N×55km 環內降低 TL 形成偵測環、環間陰影區聽不到
（`Scenario.convergenceZoneKm`）。`Scenario.acousticModel` 啟用，`asw_escort_2031` 場景示範。

### E21. 被動測向 / TMA / 吊放聲納 / 混響限制 ✅ 已實作
- **被動接觸維持「未定位」**：被動聲納只得方位（`PassiveContact` 測向射線），位置 `contactQuality="bearing"`
  → 符號層不顯示精確位置、combat 不可開火。**三角交會**（≥2 感測器、方位張角 ≥25°）或
  **TMA 機動測距**（單一感測器持續追蹤 ≥60s + 自身機動 ≥30°，Ekelund）→ 升 `"fixed"` 才定位可射控。
  （`sim/localization.ts` + `detection.ts` 的 ranging/passive 分離）
- **主動聲納混響限制（reverberation-limited）**：淺水 / 海底反射強 → `SonarEnv.reverbScatterDb` > 0，
  主動 SE = min(噪音限制, TS+DI−Sr−DT)；回波與混響同隨 SL/距離變化相消 → 拍強 ping 也無益。
- **反潛直升機吊放聲納（dipping sonar）**：新 `asw_helo` 單位種類，懸停（`isDippingActive`）時換能器入水
  做主動點偵測（吊放至層下 → 略過跨層損失）。
- **潛艦深度 × 武器/感測**：可指令 `set_depth`；下潛只能發射魚雷、潛射巡弋飛彈須潛望鏡深度；
  潛望鏡深度可目視 ~7 浬（`PERISCOPE_VISUAL_RANGE_KM`）。**水文（BT 溫深剖面）+ 深度** 決定跨層損失
  → 偵測機率差異（`asw_escort_2031` 場景：層內淺潛易偵獲、層下深潛難偵獲）。
**未做（未來）**：拖曳陣列 left/right 模糊、海底地形 bathymetry、聲速剖面射線追蹤 SSP。

---

## F. C2 / AAR / 場景作者

### F21. Task Force / 編隊
**現況**：單位都是 atomic、沒有上下級
**為什麼重要**：CSG 是 1 CVN + 4 DDG + 2 FFG + 1 SSN + 油彈船 — 玩家下令「TF 向東 20 節」整隊跟著走
**如何插**：
- 加 `TaskForce { id, commanderUnitId, memberUnitIds[] }`
- Plan Mode 加多選 + Group 按鈕
- 命令對 TF → 自動套用所有成員

### F22. ROE / Doctrine reference（教育性）
**現況**：無
**為什麼重要**：訓練場景中說明「為何此時應 hold fire」是教學核心
**如何插**：
- 場景加 `doctrineNotes: { simSec, message }[]` 時間軸提示
- 加 doctrine 卡片 modal（學員點問號開）

### F23. AAR（After Action Review）
**現況**：戰報滾動 + 戰役結算
**為什麼重要**：訓練後檢討是學習關鍵；專業兵棋有「reverse the clock」、heatmap、決策樹分析
**如何插**：
- Replay 系統已有 snapshot 基礎
- 加 AAR 模式：戰後可拖時間軸 + 在地圖畫註解 + 標 "決策點"
- 加 stats dashboard：engagement heatmap、各方 ammo 消耗曲線、偵測延遲統計
- LLM 自動產 narrative：吃 eventsAll → 寫 1 頁 prose

### F24. 場景腳本 / 觸發事件
**現況**：場景靜態，無時間軸事件
**為什麼重要**：「T+30 紅方增援 8 架戰機」、「玩家進入區域 X 觸發 reveal」是 scenario 深度的核心
**如何插**：
- Scenario 加 `events: ScriptedEvent[]`（trigger: time / area_enter / unit_destroyed → action: spawn / message / setROE）
- engine.ts 新 step：`evaluateEvents`
- 場景作者 UI 待 Phase 後續

---

## 優先建議 — 走「正規軍訓級」最少 5 項

依「離專業最遠 × 架構插入容易」排序：

| # | 項目 | 投資（人天） | 影響 |
|---|---|---|---|
| **1** | **A2 偵測狀態機**（unknown→classified→tracked → ROE 可掛） | 2 | 訓練感最高，立刻像 CMO |
| **2** | **B6 多武器掛載**（AAM/SAM/ASM 分開 + 各自 PK） | 3 | 不再是「一個射程」單一武器抽象 |
| **3** | **B7+B8 飛行剖面 + 分層防空**（CIWS 攔截 / sea-skim） | 4 | 戰鬥真實感最大跳躍 |
| **4** | **A5 地形遮蔽**（DEM + LOS）| 3 | 山脈擋雷達、海面 horizon — 戰術深度 |
| **5** | **D15 ROE 系統**（weapons free/tight/hold） | 1 | LLM 兵推核心；玩家可下 doctrine 命令 |

之後第 2 波：F21 編隊 → F23 AAR → C11 EW → E18 天氣 → D16 燃料

---

## 評估
目前約走到 **CMO Free 公開版的 60%**（架構乾淨、模擬完整、Mapbox 視覺強），但缺：
- 戰鬥模擬深度（單一 hp / 單一武器 / 直接擊殺）
- 感測層次（缺多 sensor / 缺狀態機 / 缺地形遮蔽）
- 後勤 / EW / 天氣（完全沒有）

要走到專業訓練級，**A2 + B6 + B7+B8 + A5 + D15** 這五項做完，會跨入「公開可比擬 CMO Free」的層級。再往上的差距是 OOB 規模（real-world platform DB）+ 多人協作（cell-based play），那些是另一個量級的工程。
