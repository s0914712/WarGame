/**
 * 指令卡（星海式）— 桌面底部控制台右欄。
 *
 * 固定 3×4 格位，每格一個指令 + 快捷鍵；不適用的格子灰掉但位置不變（肌肉記憶）。
 *   R 規劃航線   C 清除航線   H 停止
 *   F 自由接戰   T 限制接戰   D 僅防禦
 *   G 停止接戰   S 主動聲納   Y 拖曳陣列
 *   B 佈聲標     右鍵 移動    右鍵 攻擊
 *
 * 規劃航線 / 佈聲標模式時整張卡換成 ✓ 套用 / ✗ 取消 / ⌫ 移除末點。
 */
import { useEffect, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Route, Eraser, Square, Crosshair, ShieldHalf, Shield, Ban, Radio, Waves, Grid3x3,
  Move, Target, Check, X, Delete,
} from "lucide-react";
import type { Command, RoeMode, Unit } from "../../wargame/types";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore } from "../../wargame/viewStore";
import { editorStore } from "../../wargame/editor/editorStore";
import { wargameClock } from "../../wargame/clock";
import { UNIT_CATALOG } from "../../wargame/catalog/units";
import { submitCommand } from "../../wargame/net/commandBus";
import { netStore } from "../../wargame/net/netStore";
import { unitHasTowedArray } from "../../wargame/sim/sonar";
import { validatePlan } from "../../wargame/sim/validate";
import { getSnapshot, subscribe } from "../UnitEditorPanel";

interface Cell {
  key: string;            // 顯示用快捷鍵
  code?: string;          // KeyboardEvent.code（無 = 滑鼠操作提示格）
  label: string;
  Icon: LucideIcon;
  enabled: boolean;
  active?: boolean;       // 目前狀態（ROE / 聲納開關）
  accent?: string;
  title?: string;
  run?: () => void;
}

type Cmd = Command extends infer C ? C extends Command ? Omit<C, "id" | "unitId" | "simAtSec"> : never : never;

function issue(unit: Unit, cmd: Cmd) {
  submitCommand({
    ...cmd,
    id: `card-${cmd.kind}-${Date.now()}`,
    unitId: unit.id,
    simAtSec: wargameClock.getSimTime(),
  } as Command);
}

/** 目前可指揮的選中單位（非己方 / 多人非本陣營 / 已毀 → null） */
function controllableUnit(): Unit | null {
  const u = scenarioStore.getSelectedUnit();
  if (!u || u.hpCurrent <= 0) return null;
  const pov = viewStore.getActiveSideId();
  if (pov && u.sideId !== pov) return null;
  if (!netStore.canControlSide(u.sideId)) return null;
  return u;
}

function buildCells(): Cell[] {
  const mode = editorStore.getMode();

  if (mode === "planRoute") {
    const unitId = editorStore.getPlanningUnitId();
    const unit = unitId ? scenarioStore.getState().units[unitId] : undefined;
    const pending = editorStore.getPendingWaypoints();
    const ok = !!unit && pending.length > 0
      && validatePlan(unit, pending, { currentSimSec: wargameClock.getSimTime() }).ok;
    return modeCells([
      { key: "↵", label: `套用 ${pending.length}`, Icon: Check, enabled: ok, accent: "#fb923c", run: () => editorStore.commit() },
      { key: "Esc", label: "取消", Icon: X, enabled: true, run: () => editorStore.cancel() },
      { key: "⌫", label: "刪點", Icon: Delete, title: "移除最後一個航點", enabled: pending.length > 0, run: () => editorStore.removeLastWaypoint() },
    ]);
  }
  if (mode === "defineSonobuoyArea") {
    const d = editorStore.getSonobuoyDraft();
    return modeCells([
      { key: "↵", label: "佈放", Icon: Check, enabled: !!(d.cornerA && d.cornerB), accent: "#38bdf8", run: () => editorStore.commitSonobuoyField() },
      { key: "Esc", label: "取消", Icon: X, enabled: true, run: () => editorStore.cancel() },
    ]);
  }

  const u = controllableUnit();
  const cat = u ? UNIT_CATALOG[u.kind] : null;
  const side = u ? scenarioStore.getState().scenario.sides.find((s) => s.id === u.sideId) : null;
  const roe: RoeMode = u?.roe ?? side?.roe ?? "weapons_free";
  const mobile = !!u && u.core.speedKnots > 0;
  const canPing = cat?.acoustics?.active != null;
  const towed = !!u && unitHasTowedArray(u);
  const canBuoy = cat?.domain === "air" && cat?.acoustics?.passive != null;
  const ROE_TITLE: Record<RoeMode, string> = {
    weapons_free: "ROE 自由接戰：偵測到敵方即開火",
    weapons_tight: "ROE 限制接戰：僅對已識別目標開火",
    defensive_only: "ROE 僅防禦：只在受攻擊時還擊",
    weapons_hold: "ROE 停止接戰：不開火",
  };
  const roeCell = (key: string, code: string, value: RoeMode, label: string, Icon: LucideIcon, accent: string): Cell => ({
    key, code, label, Icon, accent, title: ROE_TITLE[value],
    enabled: !!u, active: !!u && roe === value,
    run: () => u && issue(u, { kind: "set_roe", roe: value }),
  });

  return [
    { key: "R", code: "KeyR", label: "航線", Icon: Route, enabled: mobile, accent: "#60a5fa",
      title: "規劃航線：連點地圖放航點，Enter 套用", run: () => u && editorStore.startPlanRoute(u.id) },
    { key: "C", code: "KeyC", label: "清線", Icon: Eraser, title: "清除目前航線", enabled: !!u && u.waypoints.length > 0,
      run: () => u && editorStore.clearUnitWaypoints(u.id) },
    { key: "H", code: "KeyH", label: "停止", Icon: Square, enabled: mobile,
      title: "原地停止並清除航線", run: () => u && issue(u, { kind: "hold" }) },

    roeCell("F", "KeyF", "weapons_free", "自由", Crosshair, "#ef4444"),
    roeCell("T", "KeyT", "weapons_tight", "限制", ShieldHalf, "#f59e0b"),
    roeCell("D", "KeyD", "defensive_only", "防禦", Shield, "#22c55e"),

    roeCell("G", "KeyG", "weapons_hold", "停火", Ban, "#94a3b8"),
    { key: "S", code: "KeyS", label: "聲納", Icon: Radio, enabled: canPing,
      active: !!u?.activeSonar, accent: "#38bdf8",
      title: "主動聲納：偵潛距離大增，但曝露自身位置",
      run: () => u && issue(u, { kind: "set_active_sonar", on: !u.activeSonar }) },
    { key: "Y", code: "KeyY", label: "拖曳", Icon: Waves, title: "拖曳陣列（被動高增益偵潛）", enabled: towed,
      active: towed && u?.towedArrayDeployed !== false, accent: "#34d399",
      run: () => u && issue(u, { kind: "set_towed_array", on: u.towedArrayDeployed === false }) },

    { key: "B", code: "KeyB", label: "聲標", Icon: Grid3x3, enabled: canBuoy, accent: "#38bdf8",
      title: "點地圖兩角定義反潛搜索框", run: () => u && editorStore.startSonobuoyArea(u.id) },
    { key: "右鍵", label: "移動", Icon: Move, enabled: mobile, title: "右鍵點地圖＝立即前往；Shift＋右鍵＝排隊航點" },
    { key: "右鍵", label: "攻擊", Icon: Target, enabled: !!u, title: "右鍵點敵方單位＝下達接戰" },
  ];
}

/** 模式卡：把少數指令放在前幾格，其餘補空格保持 3×4 */
function modeCells(cells: Cell[]): Cell[] {
  const filler: Cell = { key: "", label: "", Icon: Square, enabled: false };
  return [...cells, ...Array.from({ length: 12 - cells.length }, () => filler)];
}

export function CommandCard() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cells = buildCells();

  // 快捷鍵：只在 view 模式（規劃中的 Enter/Esc/⌫ 由 usePlanningHotkeys 處理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (editorStore.getMode() !== "view") return;
      const cell = buildCells().find((c) => c.code === e.code);
      if (cell?.enabled && cell.run) {
        e.preventDefault();
        cell.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(4, 1fr)",
      gap: 6, height: "100%",
    }}>
      {cells.map((c, i) => <CardButton key={i} cell={c} />)}
    </div>
  );
}

function CardButton({ cell }: { cell: Cell }) {
  const { Icon, enabled, active, accent = "#60a5fa" } = cell;
  if (!cell.label) return <div style={{ borderRadius: 6, background: "rgba(30, 41, 59, 0.25)" }} />;
  const clickable = enabled && !!cell.run;
  return (
    <button
      onClick={clickable ? cell.run : undefined}
      disabled={!enabled}
      title={cell.title ?? cell.label}
      className={clickable ? "wg-btn" : undefined}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 6,
        padding: "0 8px",
        minWidth: 0,
        borderRadius: 6,
        border: `1px solid ${active ? accent : "rgba(148, 163, 184, 0.22)"}`,
        background: active ? `${accent}33` : enabled ? "rgba(30, 41, 59, 0.75)" : "rgba(30, 41, 59, 0.3)",
        color: enabled ? "#e2e8f0" : "#475569",
        cursor: clickable ? "pointer" : "default",
        fontFamily: "inherit", fontSize: 13, fontWeight: 600,
        textAlign: "left",
      }}
    >
      <Icon size={16} color={enabled ? (active ? accent : "#cbd5e1") : "#475569"} style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{cell.label}</span>
      <kbd style={{
        fontSize: 10, fontFamily: "ui-monospace, monospace", fontWeight: 700,
        padding: "1px 4px", borderRadius: 3,
        color: enabled ? "#fbbf24" : "#475569",
        border: `1px solid ${enabled ? "rgba(251, 191, 36, 0.45)" : "rgba(71, 85, 105, 0.5)"}`,
        flexShrink: 0,
      }}>{cell.key}</kbd>
    </button>
  );
}
