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

    const loop = () => {
      const now = wargameClock.getSimTime();
      const dt = now - lastSimTime;
      lastSimTime = now;

      // Replay 模式 / 多人 guest 時跳過 engine.tick：
      //   replay → 由 replayPlayer 控制；guest → 由主機廣播 setState 控制
      if (dt > 0 && !replayPlayer.isActive() && !netStore.isGuest()) {
        const cur = scenarioStore.getState();
        const next = step(cur, dt);
        if (next !== cur) scenarioStore.setState(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, []);
}
