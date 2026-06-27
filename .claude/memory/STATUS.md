# Status

**最後更新**：2026-06-26（session：兵棋紀錄片引擎 + 823 砲戰史實場景）
**分支**：`master`（本機領先 origin **109 commits**；本次新功能**尚未 commit**）

## 本次 session 完成

### 兵棋紀錄片引擎（移植 battle-of-hong-kong-1941 概念）
- **目標**：用兵棋的底（WARGAME engine）做戰史紀錄片式場景，先做 823 砲戰
- 新增 `src/wargame/cinema/`：
  - `storyboard.ts` — 分鏡資料模型（CinemaShot[] 綁 atSimSec + 雙語旁白 + 相機關鍵格）
  - `director.ts` — 分鏡 state machine，讀 `wargameClock.getSimTime()`（live + replay 都通）驅動 Mapbox `flyTo`；grab-to-pause（拖動/縮放 3.5s 內不搶鏡）
  - `track.ts` — `sampleTrack(track, simSec)` 時間插值（移植 HK entities.js，改 sim-sec 軸 + bearing）
  - `cinemaTracks.ts` — 823 作者手刻航線（中海/臺生/美樂 + 沱江/維源 + 3 魚雷艇），對齊分鏡節點
- `src/wargame/symbology/flagMarkers.ts` — canvas 畫 1958 期旗當 marker（藍→青天白日滿地紅 12 道光芒、紅→五星紅旗）；紀錄片開啟時取代 NATO 軍標
- `src/components/CinemaControls.tsx` — 紀錄片 toggle + lower-third 字幕 HUD（日期/標題/雙語旁白/中EN 切換/殘存戰力）
- `wargameSymbolLayer.ts` — 紀錄片開啟時：icon 換期旗 + 有 track 的單位用 sampleTrack 覆寫座標（靜態單位 fallback 引擎位置）
- `WargameApp.tsx` — 掛 CinemaControls + registerFlagMarkers

### 823 砲戰場景（史實化，參維基「金門炮戰」）
- `scenarios/kinmen_823_1958.ts`（18 單位）+ 註冊進 registry
- 引擎對應：reskin `missile_launcher`→岸砲（canEngage domain-agnostic，陸對陸原生可跑）
- 史實：指揮官葉飛/胡璉、開戰 17:30 / 5.7 萬發 / 趙家驤章傑陣亡、砲群廈門/圍頭/蓮河/大嶝、M55 八吋自走砲、艦中海/臺生/美樂 + 沱江/維源、九二海戰、閃電計畫(美艦護航3浬)、單打雙不打
- 勝負：hold_area 料羅灣 5 分鐘(藍勝) / destroy 中海艦(紅勝) / eliminate / time_limit

### 驗證
- `npx tsc -b` exit 0（多輪）
- `sampleTrack` 臨時 tsx 單元測試 PASS（船團向西北插值駛入料羅灣）
- 一致性檢查 PASS（storyboard focus / track key / victory unitId 全 ∈ 18 單位）
- 期旗 standalone canvas render 確認畫對
- 瀏覽器（Playwright headless）：流程通、字幕/運鏡/期旗正常、零 pageerror

## 本次 session commits（atomic）

**尚未 commit**——本次純前端新功能（cinema 引擎 + 823 場景 + flag marker），無 cross-repo / 無 DB / 無 migration。等用戶決定是否 commit + push。

## 等用戶執行

- [ ] **啟動**：`npm run dev` → http://localhost:5173/ →（預設 wargame）→ 戰役模式 → 823 砲戰 → 全局觀察 → 進入戰役 → Esc 關簡報 → 點「紀錄片」
- [ ] decide commit：本次功能未 commit；要的話建議拆 `feat(wargame-cinema)` + `feat(scenario-823)` + `memory:` 三類
- [ ] （可選）固化「scenario 一致性檢查」成腳本（storyboard/track/victory ID ∈ units）
- [ ] （可選）修根 CLAUDE.md「Session 開頭必讀」舊路徑 → 指向 memory/（見 INCIDENTS 2026-06-26）

## 新增規則（待 PRINCIPLES.md 定型）

- **驗證 engine 純函式用 tsx 單元測試**（2026-06-26）：插值/規則/評分寫臨時 .ts import 真模組斷言跑完刪，別靠 dev server + Playwright 截圖計時
- **紀錄片/overlay HUD 會蓋頂部控制列**（2026-06-26）：headless 測試先設速度再開 HUD
- **cinema marker 座標覆寫一律 gate**（2026-06-26）：cinemaOn && 命中 track 才覆寫，靜態單位 fallback 引擎真實位置
- **歷史/寫實場景先 WebFetch 權威來源**（2026-06-26）：人名地名艦名數字落進 briefing+storyboard 再開工

## 下一步候選（[BACKLOG.md](BACKLOG.md)）

- **BL-7** reservoir_daily_ops 04-23 停擺診斷（P3 但容易做）
- **BL-4** 淹水潛勢多情境 slider（P2，17,303 polygon × 10 情境）
- **W001** 警戒水位視覺化（P2，需先 seed `river_stations` 空表）

## 累計狀態快照

- **兵棋（?mode=wargame，預設）**：9 場景含 **823 砲戰史實場景**；紀錄片引擎（cinema：storyboard 分鏡 + director flyTo + sampleTrack 航線插值 + canvas 期旗 marker + 雙語字幕 HUD），engine 純函式可 headless（mcp-server）
- 40 座水庫 / 1,304 雨量站 / 332 河川水位站 / 733 地下水井 / **2,800+ iot_wra 站**（civilian 模式）
- Timeline 五層同步回放（rain / river / reservoir / groundwater / iotWraRiver）
- **15 個水資源圖層上線**（9 靜態 backdrop + 6 動態）
- 監測站視覺 pattern：delta_since_day_start 著色（跨站可比，timeline 撥放動）
- **Pre-aggregate pattern**：8 個 cron refresh job（ship/flight/freeway/youbike/disaster/temp/iot 2）錯開分鐘
- **PostgREST 20K cap 已修 2 + 1 預防**（060 / 060b / 063 daily 字串編碼）
- 3D 視覺：水位計 + 點選後雙排日柱
- 記憶系統：v2 9 檔 + SessionStart auto-load + /wrap-up
- **研究報告區**：`docs/research/`（2 篇 + 方法論 SOP 進 PB-09/PB-10）

詳細：[DATA_SCOPE.md](DATA_SCOPE.md) / [BACKLOG.md](BACKLOG.md) / [REFLECTIONS.md](REFLECTIONS.md)
