/**
 * Plan Mode 收掉底部控制台後，選中單位時在右下角浮出單位卡（編輯屬性 / 刪除），
 * 沒選單位就不佔畫面。內容沿用控制台中欄的 ConsoleUnitInfo。
 */
import { useSyncExternalStore } from "react";
import { scenarioStore } from "../../wargame/scenarioStore";
import { ConsoleUnitInfo } from "./ConsoleUnitInfo";

function selectedId(): string | null {
  return scenarioStore.getSelectedUnit()?.id ?? null;
}

export function PlanModeUnitCard() {
  const id = useSyncExternalStore(scenarioStore.subscribe, selectedId, selectedId);
  if (!id) return null;
  return (
    <div data-testid="plan-unit-card" style={{
      position: "absolute", right: 16, bottom: 16, zIndex: 26,
      width: 440, maxWidth: "calc(100vw - 32px)", height: 196,
      padding: "10px 14px", borderRadius: 8,
      background: "linear-gradient(to bottom, rgba(15, 23, 42, 0.96), rgba(8, 13, 26, 0.98))",
      border: "1px solid rgba(251, 146, 60, 0.5)",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
      color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif",
      display: "flex", flexDirection: "column", overflow: "auto",
    }}>
      <ConsoleUnitInfo />
    </div>
  );
}
