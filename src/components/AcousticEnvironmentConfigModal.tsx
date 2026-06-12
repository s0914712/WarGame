/**
 * 聲學環境設定畫面（反潛場景開戰前）。
 *
 * 使用者設定 BT 溫度剖面、海況、底質、水深 → 即時導出聲速剖面、層深(SLD)、環境噪音、
 * Figure of Merit（聲納優值）與 >50% 偵測有效距離 R₅₀，套進場景的聲納模型。
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import type { AcousticEnvironment } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";
import { uiStore } from "../wargame/uiStore";
import {
  soundSpeedMackenzie, deriveSonicLayerDepthM, seaStateToAmbientNlDb,
  bottomLossDbPerKm, passiveFigureOfMeritDb, activeMaxOneWayTlDb,
  effectiveDetectionRangeKm, DEFAULT_SALINITY_PPT,
} from "../wargame/sim/acousticEnvironment";
import { transmissionLossDb } from "../wargame/sim/sonar";

type BtPoint = { depthM: number; tempC: number };

// 標準深度（公尺）— 使用者在這些深度輸入溫度（BT bathythermograph）
const STANDARD_DEPTHS = [10, 50, 100, 200, 400, 800, 1000];
// 預設初始值（副熱帶夏季）：°C @ 各標準深度
const DEFAULT_TEMPS: Record<number, number> = { 10: 28, 50: 24, 100: 18, 200: 14, 400: 10, 800: 6, 1000: 5 };

// 預設曲線 → 一鍵填入標準深度溫度表
const BT_PRESETS: { name: string; temps: Record<number, number> }[] = [
  { name: "夏季強躍層", temps: { 10: 28, 50: 18, 100: 14, 200: 11, 400: 9, 800: 6, 1000: 5 } },
  { name: "深混合層", temps: { 10: 20, 50: 20, 100: 19.5, 200: 13, 400: 9, 800: 6, 1000: 5 } },
  { name: "弱躍層", temps: { 10: 23, 50: 21, 100: 17, 200: 13, 400: 9, 800: 7, 1000: 6 } },
  { name: "冬季等溫", temps: { 10: 15, 50: 15, 100: 15, 200: 14, 400: 10, 800: 7, 1000: 6 } },
];

const BOTTOM_OPTIONS: { v: AcousticEnvironment["bottomType"]; label: string }[] = [
  { v: "rock", label: "岩石（反射佳）" },
  { v: "sand", label: "沙" },
  { v: "mud", label: "泥（吸聲強）" },
];

// 參考目標對（用於 FOM / R₅₀ 讀數）
const SUB_PASSIVE = { arrayGainDb: 20, dtDb: 5, selfNoiseDb: 42 };
const SHIP_PASSIVE = { arrayGainDb: 12, dtDb: 8, selfNoiseDb: 55 };
const SHIP_SL_MOVING = 168;     // 移動水面艦輻射噪音
const SHIP_PING_SL = 230;       // 艦載主動聲納 ping
const SUB_TS = 12;              // 潛艦目標強度

function tempAtDepth(bt: BtPoint[], z: number): number {
  const pts = [...bt].sort((a, b) => a.depthM - b.depthM);
  if (z <= pts[0]!.depthM) return pts[0]!.tempC;
  if (z >= pts[pts.length - 1]!.depthM) return pts[pts.length - 1]!.tempC;
  for (let i = 1; i < pts.length; i++) {
    if (z <= pts[i]!.depthM) {
      const a = pts[i - 1]!, b = pts[i]!;
      const f = (z - a.depthM) / (b.depthM - a.depthM);
      return a.tempC + f * (b.tempC - a.tempC);
    }
  }
  return pts[pts.length - 1]!.tempC;
}

function isOpen(): boolean { return uiStore.isAcousticConfigOpen(); }

export function AcousticEnvironmentConfigModal() {
  const open = useSyncExternalStore(uiStore.subscribe, isOpen, isOpen);
  const [temps, setTemps] = useState<Record<number, number>>(DEFAULT_TEMPS);
  const [seaState, setSeaState] = useState(3);
  const [bottomType, setBottomType] = useState<AcousticEnvironment["bottomType"]>("sand");
  const [waterDepthM, setWaterDepthM] = useState(2000);

  // 由標準深度溫度表組成 BT 剖面
  const bt: BtPoint[] = STANDARD_DEPTHS.map((d) => ({ depthM: d, tempC: temps[d] ?? 15 }));

  const derived = useMemo(() => {
    const sld = deriveSonicLayerDepthM(bt, DEFAULT_SALINITY_PPT);
    const ambientNl = seaStateToAmbientNlDb(seaState);
    const bottom = bottomLossDbPerKm(bottomType, waterDepthM);
    const fomPassive = passiveFigureOfMeritDb({ sourceLevelDb: SHIP_SL_MOVING, passive: SUB_PASSIVE, receiverSpeedKnots: 6, ambientNlDb: ambientNl });
    const r50Passive = effectiveDetectionRangeKm(fomPassive, { layerCrossing: true, bottomLossDbPerKm: bottom });
    const activeTl = activeMaxOneWayTlDb({ pingSourceLevelDb: SHIP_PING_SL, targetStrengthDb: SUB_TS, passive: SHIP_PASSIVE, receiverSpeedKnots: 18, ambientNlDb: ambientNl });
    const r50Active = effectiveDetectionRangeKm(activeTl, { layerCrossing: true, bottomLossDbPerKm: bottom });
    // SSP 取樣（c vs depth）
    const maxZ = Math.max(400, ...bt.map((p) => p.depthM));
    const ssp: { z: number; c: number }[] = [];
    for (let z = 0; z <= maxZ; z += maxZ / 40) ssp.push({ z, c: soundSpeedMackenzie(tempAtDepth(bt, z), DEFAULT_SALINITY_PPT, z) });
    // TL 曲線（被動規劃用）
    const tl: { r: number; v: number }[] = [];
    for (let r = 0.5; r <= 80; r += 1.5) tl.push({ r, v: transmissionLossDb(r, true, 0, bottom) });
    return { sld, ambientNl, bottom, fomPassive, r50Passive, r50Active, ssp, tl, maxZ };
  }, [temps, seaState, bottomType, waterDepthM]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const apply = () => {
    const env: AcousticEnvironment = {
      btProfile: bt, salinityPpt: DEFAULT_SALINITY_PPT, seaState, bottomType, waterDepthM,
      layerDepthM: deriveSonicLayerDepthM(bt, DEFAULT_SALINITY_PPT),
    };
    scenarioStore.applyAcousticEnv(env);
    uiStore.setAcousticConfigOpen(false);
  };

  // SSP 圖（c 越大越右）
  const cMin = Math.min(...derived.ssp.map((p) => p.c)), cMax = Math.max(...derived.ssp.map((p) => p.c));
  const sspPath = derived.ssp.map((p) => {
    const x = 8 + ((p.c - cMin) / Math.max(1, cMax - cMin)) * 120;
    const y = 8 + (p.z / derived.maxZ) * 150;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const sldY = 8 + (derived.sld / derived.maxZ) * 150;
  // TL 圖
  const tlMax = Math.max(...derived.tl.map((p) => p.v));
  const tlPath = derived.tl.map((p) => {
    const x = 8 + (p.r / 80) * 150;
    const y = 8 + (p.v / tlMax) * 150;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 60, background: "rgba(2,6,23,0.78)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      <div style={{
        width: 720, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto",
        background: "rgba(15,23,42,0.97)", border: "1px solid rgba(56,189,248,0.4)",
        borderRadius: 12, color: "#e2e8f0", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>反潛聲學環境設定</div>
        <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 14 }}>
          設定 BT 溫度剖面、海況、底質、水深 → 導出聲速剖面、層深、聲納優值與有效偵測距離，套進本場景。
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* 左：輸入 */}
          <div>
            <Label>BT 溫度剖面（各深度水溫 °C）</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {BT_PRESETS.map((p) => (
                <button key={p.name} onClick={() => setTemps({ ...p.temps })}
                  style={{ ...chip(false), padding: "4px 8px", fontSize: 12 }}>{p.name}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 12 }}>
              {STANDARD_DEPTHS.map((d) => (
                <div key={d} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{d}m</div>
                  <input
                    type="number" step={0.5} value={temps[d] ?? ""}
                    onChange={(e) => setTemps({ ...temps, [d]: Number(e.target.value) })}
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "4px 2px", fontSize: 13,
                      textAlign: "center", borderRadius: 4, border: "1px solid rgba(148,163,184,0.35)",
                      background: "rgba(30,41,59,0.9)", color: "#e2e8f0",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  />
                </div>
              ))}
            </div>

            <Label>海況（Beaufort）：{seaState} 級 → 環境噪音 {derived.ambientNl.toFixed(0)} dB</Label>
            <input type="range" min={0} max={6} step={1} value={seaState}
              onChange={(e) => setSeaState(Number(e.target.value))} style={{ width: "100%", accentColor: "#38bdf8" }} />

            <Label>底質</Label>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {BOTTOM_OPTIONS.map((o) => (
                <button key={o.v} onClick={() => setBottomType(o.v)} style={chip(o.v === bottomType)}>{o.label}</button>
              ))}
            </div>

            <Label>水深：{waterDepthM} m {waterDepthM >= 1000 ? "（深水·會聚區成立）" : "（淺水·底反射損失）"}</Label>
            <input type="range" min={50} max={4000} step={50} value={waterDepthM}
              onChange={(e) => setWaterDepthM(Number(e.target.value))} style={{ width: "100%", accentColor: "#38bdf8" }} />
          </div>

          {/* 右：圖 */}
          <div>
            <Label>聲速剖面 c(z)　·　層深 SLD = {derived.sld} m</Label>
            <svg width="100%" viewBox="0 0 136 166" style={{ background: "rgba(2,6,23,0.6)", borderRadius: 6 }}>
              <polyline points={sspPath} fill="none" stroke="#7dd3fc" strokeWidth="1.5" />
              <line x1="0" y1={sldY} x2="136" y2={sldY} stroke="#fbbf24" strokeWidth="0.8" strokeDasharray="3 2" />
              <text x="10" y={sldY - 2} fill="#fbbf24" fontSize="6">SLD {derived.sld}m</text>
              <text x="2" y="162" fill="#64748b" fontSize="6">深↓ · 聲速→</text>
            </svg>
            <Label>傳播損失 TL(距離)</Label>
            <svg width="100%" viewBox="0 0 166 166" style={{ background: "rgba(2,6,23,0.6)", borderRadius: 6 }}>
              <polyline points={tlPath} fill="none" stroke="#fb923c" strokeWidth="1.5" />
              <line x1={8 + (derived.r50Passive / 80) * 150} y1="0" x2={8 + (derived.r50Passive / 80) * 150} y2="166" stroke="#86efac" strokeWidth="0.8" strokeDasharray="3 2" />
              <text x="2" y="162" fill="#64748b" fontSize="6">距離→ · TL↓</text>
            </svg>
          </div>
        </div>

        {/* 讀數 */}
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Stat label="層深 SLD" value={`${derived.sld} m`} />
          <Stat label="環境噪音 NL" value={`${derived.ambientNl.toFixed(0)} dB`} />
          <Stat label="底反射損失" value={`${derived.bottom.toFixed(1)} dB/km`} />
          <Stat label="被動 FOM（潛艦聽艦）" value={`${derived.fomPassive.toFixed(0)} dB`} />
          <Stat label="R₅₀ 被動有效距離" value={`${derived.r50Passive.toFixed(1)} km`} hi />
          <Stat label="R₅₀ 主動偵潛距離" value={`${derived.r50Active.toFixed(1)} km`} hi />
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => uiStore.setAcousticConfigOpen(false)} style={btnGhost}>略過（用場景預設）</button>
          <button onClick={apply} style={btnPrimary}>套用此環境 ▶</button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: "#cbd5e1", margin: "6px 0 6px", fontWeight: 600 }}>{children}</div>;
}
function Stat({ label, value, hi }: { label: string; value: string; hi?: boolean }) {
  return (
    <div style={{ background: "rgba(30,41,59,0.7)", borderRadius: 8, padding: "8px 10px", border: hi ? "1px solid rgba(134,239,172,0.4)" : "1px solid rgba(148,163,184,0.2)" }}>
      <div style={{ fontSize: 12, color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: hi ? "#86efac" : "#e2e8f0", fontFamily: "ui-monospace, monospace" }}>{value}</div>
    </div>
  );
}
function chip(active: boolean): React.CSSProperties {
  return {
    padding: "6px 10px", fontSize: 13, borderRadius: 6, cursor: "pointer",
    border: active ? "1px solid #38bdf8" : "1px solid rgba(148,163,184,0.3)",
    background: active ? "rgba(56,189,248,0.22)" : "rgba(148,163,184,0.1)", color: "#e2e8f0",
  };
}
const btnPrimary: React.CSSProperties = {
  padding: "10px 18px", fontSize: 16, fontWeight: 600, borderRadius: 8, border: "none",
  background: "#38bdf8", color: "#04263b", cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "10px 16px", fontSize: 15, borderRadius: 8, cursor: "pointer",
  border: "1px solid rgba(148,163,184,0.3)", background: "transparent", color: "#cbd5e1",
};
