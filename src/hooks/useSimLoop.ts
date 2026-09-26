/**
 * useSimLoop — 把 wargameClock 的時間流轉成 scenarioStore.setState() 呼叫。
 *
 * 啟動單一 RAF：每幀算與上一幀的 sim-time 差，呼叫 engine.step()。
 *
 * 暫停時：wargameClock.tickFromWall 是 no-op，simTime 不變 → 我們也 skip。
 *
 * 注意：useWargameClock 已經有一個 RAF 在跑（推進 wargameClock）。
 * 這裡是「監聽 wargameClock 的時間變化」獨立 loop。
 * 為了避免雙 RAF 浪費，可以共用：但兩個關心點不同，分開比較清楚。
 */
import { useEffect } from "react";
import { wargameClock } from "../wargame/clock";
import { scenarioStore } from "../wargame/scenarioStore";
import { step } from "../wargame/sim/engine";
import { replayPlayer } from "../wargame/replay/player";
import { netStore } from "../wargame/net/netStore";

export function useSimLoop() {
  useEffect(() => {
    let raf = 0;
    let lastSimTime = wargameClock.getSimTime();
    // 上次 step 產出的 state 時間；若 state 被外部整個換掉（loadScenario / 多人重連還原），
    // 以當下時鐘重新對基準，避免把 seek 造成的時鐘跳動當成 dt 再推進一次
    let lastProducedSimSec: number | null = null;

    const loop = () => {
      const now = wargameClock.getSimTime();
      const stateSec = scenarioStore.getState().simTimeSec;
      if (lastProducedSimSec !== null && stateSec !== lastProducedSimSec) lastSimTime = now;
      const dt = now - lastSimTime;
      lastSimTime = now;

      // Replay 模式時跳過 engine.tick，state 完全由 replayPlayer 控制
      // 多人 client 不跑 engine：state 由 host snapshot（net/snapshot.ts clientApplier）寫入
      if (dt > 0 && !replayPlayer.isActive() && !netStore.isClient()) {
        const cur = scenarioStore.getState();
        const next = step(cur, dt);
        if (next !== cur) scenarioStore.setState(next);
      }
      lastProducedSimSec = scenarioStore.getState().simTimeSec;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, []);
}
