/**
 * 點選單位後相機跟隨。
 *
 * 行為：
 *   - 選單位 → 相機 panTo 該單位（throttled 500ms）
 *   - 使用者拖地圖 / scroll zoom → 自動解除跟隨（直到下次選新單位）
 *   - 取消選單位 → 跟隨停止
 */
import { useEffect } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";

const FOLLOW_THROTTLE_MS = 500;

export function useCameraFollow(map: MapboxMap | null) {
  useEffect(() => {
    if (!map) return;

    let lastFollowedId: string | null = null;
    let userOverrode = false;
    let lastPanAt = 0;
    let suppressDragEvent = false;

    const onDragStart = () => {
      if (suppressDragEvent) return;
      userOverrode = true;
    };
    map.on("dragstart", onDragStart);
    map.on("wheel", () => { userOverrode = true; });

    const refresh = () => {
      const id = scenarioStore.getSelectedUnitId();
      // 切換選單位 → 重置 userOverride
      if (id !== lastFollowedId) {
        lastFollowedId = id;
        userOverrode = false;
      }
      if (!id || userOverrode) return;

      const unit = scenarioStore.getState().units[id];
      if (!unit) return;

      const now = performance.now();
      if (now - lastPanAt < FOLLOW_THROTTLE_MS) return;
      lastPanAt = now;

      // 鎖定我們的 panTo，避免被自己觸發的 dragstart 誤判
      suppressDragEvent = true;
      map.panTo([unit.position.lng, unit.position.lat], { duration: 400 });
      // panTo 完成才放開 flag
      setTimeout(() => { suppressDragEvent = false; }, 450);
    };

    const unsub = scenarioStore.subscribe(refresh);

    return () => {
      unsub();
      map.off("dragstart", onDragStart);
    };
  }, [map]);
}
