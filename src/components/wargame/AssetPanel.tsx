/**
 * 資產面板 —— 「給定資產」的兵棋設定：
 *   1. 攻擊優序：每類目標 0–5 分 + 優序 / 距離權衡（sim/targetPriority.ts），存在 Side.targetPriority
 *   2. 偵察計畫：下一階段（建議派遣 → 一鍵套用）
 *
 * 入口：桌面頂部列「資產」鈕。
 */
import { useState, useSyncExternalStore } from "react";
import { ReconTab } from "./ReconTab";
import { Crosshair, X, RotateCcw, ScanSearch } from "lucide-react";
import type { SideId } from "../../wargame/types";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore } from "../../wargame/viewStore";
import { netStore } from "../../wargame/net/netStore";
import { useLang } from "../../wargame/i18n/lang";
import { detectionRank } from "../../wargame/sim/detection";
import {
  CATEGORY_OF, DEFAULT_WEIGHT, MAX_PRIORITY, TARGET_CATEGORIES, TARGET_PRIORITY_PRESETS,
  presetProfile, type TargetCategory, type TargetPriorityPresetId, type TargetPriorityProfile,
} from "../../wargame/sim/targetPriority";

// ── 開關狀態 ──────────────────────────────────────────────
export type AssetTab = "priority" | "recon";
let open = false;
let tab: AssetTab = "priority";
/** 面板目前檢視的陣營（偵察盲區圖層用） */
let viewSide: SideId | null = null;
let version = 0;
const listeners = new Set<() => void>();
function emit() { version++; for (const cb of listeners) cb(); }
export const assetPanelStore = {
  isOpen: () => open,
  getTab: () => tab,
  getSide: () => viewSide,
  setSide(s: SideId | null): void {
    if (viewSide === s) return;
    viewSide = s;
    emit();
  },
  /** useSyncExternalStore snapshot：開關 / 分頁任一改變都遞增 */
  getVersion: () => version,
  setOpen(v: boolean): void {
    if (open === v) return;
    open = v;
    emit();
  },
  setTab(t: AssetTab): void {
    if (tab === t) return;
    tab = t;
    emit();
  },
  toggle(): void { this.setOpen(!open); },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};

/** 面板寬度（尺規控制列據此讓位） */
export const ASSET_PANEL_WIDTH = 400;

const CAT_TEXT: Record<TargetCategory, { zh: string; en: string; hintZh: string; hintEn: string }> = {
  amphibious: { zh: "登陸 / 兩棲", en: "Amphibious", hintZh: "登陸艦", hintEn: "Landing ships" },
  air_defense: { zh: "防空", en: "Air defence", hintZh: "中程 SAM、愛國者", hintEn: "SAM, Patriot" },
  sensor: { zh: "雷達 / 感測", en: "Radar / sensors", hintZh: "雷達站、機動雷達車", hintEn: "Radar sites, mobile radars" },
  base_logistics: { zh: "基地 / 後勤", en: "Bases / logistics", hintZh: "機場、補給艦", hintEn: "Airbases, supply ships" },
  surface_combatant: { zh: "水面作戰艦", en: "Surface combatants", hintZh: "驅逐 / 巡防 / 航艦", hintEn: "Destroyers, frigates, carriers" },
  submarine: { zh: "潛艦", en: "Submarines", hintZh: "潛艦", hintEn: "Submarines" },
  aircraft: { zh: "戰機 / 直升機", en: "Aircraft", hintZh: "戰機、反潛直升機", hintEn: "Fighters, ASW helicopters" },
  uav: { zh: "無人機", en: "UAVs", hintZh: "偵察 / 攻擊 / 自殺無人機", hintEn: "Recon, strike, one-way attack UAVs" },
  missile_launcher: { zh: "飛彈車", en: "Missile launchers", hintZh: "機動飛彈車", hintEn: "Mobile missile launchers" },
};

const TEXT = {
  zh: {
    title: "資產", tabPriority: "攻擊優序", tabRecon: "偵察計畫", soon: "下一階段",
    side: "陣營", unset: "未設定 —— 自動交戰打最近的目標", presets: "範本", custom: "自訂",
    blend: "選目標依據", distance: "距離", priority: "優序", known: "已知",
    zero: "不打", clear: "清除（回到打最近）", start: "開始設定",
    note: "0 分 = 不主動攻擊該類（仍可用右鍵 / 指令卡下令攻擊）。只影響自動交戰；明確的攻擊命令不受限。",
    blendNote: (b: number) => `權衡 ${Math.round(b * 100)}%：差 1 分約需距離差 ${b >= 1 ? "∞" : Math.round((b * 0.2) / Math.max(1e-6, 1 - b) * 100)}% 射程才會改打較近的目標`,
    readonly: "多人對戰中由房主設定攻擊優序（各方自設將於後續版本開放）",
    samWarn: "⚠ 本方防空飛彈對戰機 / 無人機為 0 分，不會自動接戰這類目標（攔截來襲飛彈不受影響）。",
    samFix: "讓防空照打空中目標",
    shooter: "攻擊方", allShooters: "全部（陣營預設）", inherit: "沿用預設", clearOverride: "清除此攻擊方覆寫",
    shooterNote: "只改選定攻擊方對各類目標的分數；虛框數字為沿用陣營預設。",
    reconSoon: "偵察計畫建議（關注區、覆蓋缺口、派遣建議、一鍵套用）將在下一階段加入。",
  },
  en: {
    title: "Assets", tabPriority: "Target priority", tabRecon: "Recon plan", soon: "next phase",
    side: "Side", unset: "Not set — auto-engage picks the nearest target", presets: "Presets", custom: "Custom",
    blend: "Target selection", distance: "Distance", priority: "Priority", known: "known",
    zero: "skip", clear: "Clear (back to nearest)", start: "Set priorities",
    note: "0 = never auto-engage this category (explicit attack orders still work). Only affects automatic target selection.",
    blendNote: (b: number) => `Blend ${Math.round(b * 100)}%: a 1-point edge is overridden only by a distance gap above ${b >= 1 ? "∞" : Math.round((b * 0.2) / Math.max(1e-6, 1 - b) * 100)}% of weapon range`,
    readonly: "In multiplayer the host sets target priorities (per-player settings coming later)",
    samWarn: "⚠ This side's SAMs score aircraft / UAVs at 0 and won't auto-engage them (intercepting incoming missiles is unaffected).",
    samFix: "Let air defence keep engaging air targets",
    shooter: "Shooter", allShooters: "All (side default)", inherit: "inherits default", clearOverride: "Clear this shooter's overrides",
    shooterNote: "Overrides only the selected shooter type; dashed numbers inherit the side default.",
    reconSoon: "Recon plan suggestions (areas of interest, coverage gaps, tasking, one-click apply) come in the next phase.",
  },
} as const;

/**
 * @param width / maxHeight 行動版用：寬度貼齊螢幕、高度避開底部 dock
 */
export function AssetPanel({ top, left = 16, width = ASSET_PANEL_WIDTH, maxHeight }: {
  top: number; left?: number; width?: number | string; maxHeight?: string;
}) {
  useSyncExternalStore(assetPanelStore.subscribe, assetPanelStore.getVersion, assetPanelStore.getVersion);
  useSyncExternalStore(scenarioStore.subscribe, scenarioStore.getState, scenarioStore.getState);
  const net = useSyncExternalStore(netStore.subscribe, netStore.get, netStore.get);
  const lang = useLang() === "en" ? "en" : "zh";
  const [selectedSide, setSelectedSide] = useState<SideId | null>(null);
  /** null = 編輯陣營預設；否則編輯該攻擊方類別的覆寫 */
  const [shooter, setShooter] = useState<TargetCategory | null>(null);
  const t = TEXT[lang];
  if (!open) return null;

  const state = scenarioStore.getState();
  // 可設定的陣營：有敵對對象的（中立方不需要）
  const sides = state.scenario.sides.filter((s) => s.isHostileTo.length > 0);
  const active = viewStore.getActiveSideId();
  const sideId: SideId | undefined = (selectedSide && sides.some((s) => s.id === selectedSide) ? selectedSide : null)
    ?? (active && sides.some((s) => s.id === active) ? active : sides[0]?.id);
  const side = sides.find((s) => s.id === sideId);
  // 通知地圖圖層目前檢視哪個陣營（排到 render 之後；值沒變時 setSide 不會觸發重繪）
  queueMicrotask(() => assetPanelStore.setSide(sideId ?? null));
  // 多人：host 才寫得進引擎（client 不跑 engine），且只改自己的陣營
  const editable = net.role === "off" || (net.role === "host" && netStore.canControlSide(sideId ?? "blue"));
  const profile = side?.targetPriority ?? null;

  // 各類別目前已知（≥ 已分類）的敵方數量
  const known: Partial<Record<TargetCategory, number>> = {};
  if (side) {
    for (const u of Object.values(state.units)) {
      if (!side.isHostileTo.includes(u.sideId) || u.hpCurrent <= 0) continue;
      if (detectionRank(u.detectedBy[side.id]) < 2) continue;
      const c = CATEGORY_OF[u.kind];
      known[c] = (known[c] ?? 0) + 1;
    }
  }

  const setProfile = (p: TargetPriorityProfile | null) => {
    if (sideId && editable) scenarioStore.setSideTargetPriority(sideId, p);
  };
  const setWeight = (c: TargetCategory, w: number) => {
    if (!profile) return;
    if (shooterCat) {
      const cur = profile.byShooter?.[shooterCat] ?? {};
      setProfile({ ...profile, byShooter: { ...profile.byShooter, [shooterCat]: { ...cur, [c]: w } } });
      return;
    }
    setProfile({ ...profile, weights: { ...profile.weights, [c]: w }, presetId: undefined });
  };
  const clearShooterOverride = (cat: TargetCategory) => {
    if (!profile?.byShooter) return;
    const { [cat]: _drop, ...rest } = profile.byShooter;
    setProfile({ ...profile, byShooter: Object.keys(rest).length > 0 ? rest : undefined });
  };

  // 本方有武裝的攻擊方類別（覆寫選單用）
  const ownShooterCats = TARGET_CATEGORIES.filter((c) => Object.values(state.units).some(
    (u) => u.sideId === sideId && u.hpCurrent > 0 && CATEGORY_OF[u.kind] === c && (u.ammoMax > 0 || u.core.rangeKm > 0),
  ));
  const shooterCat = shooter && ownShooterCats.includes(shooter) ? shooter : null;
  const effective = (c: TargetCategory, sc: TargetCategory | null): { w: number; inherited: boolean } => {
    const o = sc ? profile?.byShooter?.[sc]?.[c] : undefined;
    if (o !== undefined) return { w: o, inherited: false };
    return { w: profile?.weights[c] ?? DEFAULT_WEIGHT, inherited: sc !== null };
  };
  const hasSam = Object.values(state.units).some((u) => u.sideId === sideId && (u.kind === "sam_coastal" || u.kind === "sam_patriot"));
  const samBlocked = !!profile && hasSam
    && (effective("aircraft", "air_defense").w === 0 || effective("uav", "air_defense").w === 0);

  return (
    <div className="wg-fade-in" style={{
      position: "absolute", top, left, zIndex: 26, width,
      maxHeight: maxHeight ?? `calc(100vh - ${top + 24}px)`, overflowY: "auto", boxSizing: "border-box",
      padding: "10px 12px", borderRadius: 10,
      background: "rgba(15, 23, 42, 0.95)", backdropFilter: "blur(6px)",
      border: "1px solid rgba(148, 163, 184, 0.3)", boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
      color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Crosshair size={15} color="#f97316" />
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t.title}</span>
        <span style={{ flex: 1 }} />
        <button className="wg-btn" onClick={() => assetPanelStore.setOpen(false)} style={iconBtn} aria-label="close">
          <X size={13} />
        </button>
      </div>

      {/* 分頁 */}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="wg-btn" onClick={() => assetPanelStore.setTab("priority")}
          style={{ ...tabStyle, ...(assetPanelStore.getTab() === "priority" ? tabOn : {}) }}>
          <Crosshair size={12} /> {t.tabPriority}
        </button>
        <button className="wg-btn" onClick={() => assetPanelStore.setTab("recon")}
          style={{ ...tabStyle, ...(assetPanelStore.getTab() === "recon" ? tabOn : {}) }}>
          <ScanSearch size={12} /> {t.tabRecon}
        </button>
      </div>

      {/* 陣營 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>{t.side}</span>
        {sides.map((s) => (
          <button key={s.id} className="wg-btn" onClick={() => setSelectedSide(s.id)}
            style={{
              ...chip,
              borderColor: s.id === sideId ? s.colorPrimary : "rgba(148,163,184,0.3)",
              background: s.id === sideId ? `${s.colorPrimary}33` : "rgba(30,41,59,0.6)",
              fontWeight: s.id === sideId ? 700 : 400,
            }}>
            {s.displayName}
          </button>
        ))}
      </div>

      {assetPanelStore.getTab() === "recon" ? (
        sideId ? <ReconTab sideId={sideId} lang={lang} canCommand={net.role === "off" || netStore.canControlSide(sideId)} /> : null
      ) : (<>
      {!editable && <div style={warn}>{t.readonly}</div>}

      {!profile ? (
        <>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>{t.unset}</div>
          {editable && (
            <PresetRow lang={lang} current={undefined} onPick={(id) => setProfile(presetProfile(id))} label={t.presets} />
          )}
        </>
      ) : (
        <>
          {editable && (
            <PresetRow lang={lang} current={profile.presetId} label={t.presets}
              onPick={(id) => setProfile({ ...presetProfile(id, profile.blend), byShooter: profile.byShooter })} customLabel={t.custom} />
          )}
          {profile.presetId && (
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>
              {lang === "en" ? TARGET_PRIORITY_PRESETS[profile.presetId].descEn : TARGET_PRIORITY_PRESETS[profile.presetId].descZh}
            </div>
          )}

          {/* 攻擊方：陣營預設 / 各攻擊方類別覆寫 */}
          {ownShooterCats.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>{t.shooter}</span>
              <button className="wg-btn" onClick={() => setShooter(null)}
                style={{ ...chip, ...(shooterCat === null ? chipOn : {}) }}>{t.allShooters}</button>
              {ownShooterCats.map((c) => {
                const n = Object.keys(profile.byShooter?.[c] ?? {}).length;
                return (
                  <button key={c} className="wg-btn" onClick={() => setShooter(c)}
                    style={{ ...chip, ...(shooterCat === c ? chipOn : {}) }}>
                    {lang === "en" ? CAT_TEXT[c].en : CAT_TEXT[c].zh}{n > 0 ? ` ·${n}` : ""}
                  </button>
                );
              })}
            </div>
          )}
          {shooterCat && <div style={{ fontSize: 11, color: "#64748b" }}>{t.shooterNote}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {TARGET_CATEGORIES.map((c) => {
              const { w, inherited } = effective(c, shooterCat);
              const n = known[c] ?? 0;
              return (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }} title={lang === "en" ? CAT_TEXT[c].hintEn : CAT_TEXT[c].hintZh}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: w === 0 ? "#64748b" : "#e2e8f0" }}>
                      {lang === "en" ? CAT_TEXT[c].en : CAT_TEXT[c].zh}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {lang === "en" ? CAT_TEXT[c].hintEn : CAT_TEXT[c].hintZh}
                      {n > 0 && <span style={{ color: "#fca5a5" }}> · {t.known} {n}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    {Array.from({ length: MAX_PRIORITY + 1 }, (_, v) => (
                      <button key={v} className="wg-btn" disabled={!editable} onClick={() => setWeight(c, v)}
                        title={v === 0 ? t.zero : String(v)}
                        style={{
                          ...scoreBtn,
                          ...(w === v ? (inherited ? scoreInherited : v === 0 ? scoreOnZero : scoreOn) : {}),
                          cursor: editable ? "pointer" : "default",
                        }}>
                        {v === 0 ? "✕" : v}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ color: "#94a3b8", width: 76, flexShrink: 0 }}>{t.blend}</span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.distance}</span>
              <input type="range" min={0} max={1} step={0.05} value={profile.blend} disabled={!editable}
                onChange={(e) => setProfile({ ...profile, blend: Number(e.target.value) })}
                style={{ flex: 1, accentColor: "#f97316" }} />
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.priority}</span>
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{t.blendNote(profile.blend)}</div>
          </div>

          {shooterCat && editable && Object.keys(profile.byShooter?.[shooterCat] ?? {}).length > 0 && (
            <button className="wg-btn" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => clearShooterOverride(shooterCat)}>
              {t.clearOverride}
            </button>
          )}
          {samBlocked && (
            <div style={warn}>
              {t.samWarn}
              {editable && (
                <button className="wg-btn" style={{ ...chip, marginLeft: 6, marginTop: 4 }} onClick={() => setProfile({
                  ...profile,
                  byShooter: {
                    ...profile.byShooter,
                    air_defense: { ...profile.byShooter?.air_defense, aircraft: 5, uav: 5 },
                  },
                })}>{t.samFix}</button>
              )}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{t.note}</div>
          {editable && (
            <button className="wg-btn" style={{ ...chip, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4 }}
              onClick={() => setProfile(null)}>
              <RotateCcw size={12} /> {t.clear}
            </button>
          )}
        </>
      )}
      </>)}
    </div>
  );
}

function PresetRow({ lang, current, onPick, label, customLabel }: {
  lang: "zh" | "en"; current: TargetPriorityPresetId | undefined;
  onPick: (id: TargetPriorityPresetId) => void; label: string; customLabel?: string;
}) {
  const ids = Object.keys(TARGET_PRIORITY_PRESETS) as TargetPriorityPresetId[];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "#94a3b8" }}>{label}</span>
      {ids.map((id) => (
        <button key={id} className="wg-btn" onClick={() => onPick(id)} style={{
          ...chip,
          ...(current === id ? { borderColor: "#f97316", background: "rgba(249,115,22,0.2)", fontWeight: 700 } : {}),
        }}>
          {lang === "en" ? TARGET_PRIORITY_PRESETS[id].en : TARGET_PRIORITY_PRESETS[id].zh}
        </button>
      ))}
      {customLabel && !current && (
        <span style={{ ...chip, borderColor: "#f97316", fontWeight: 700, cursor: "default" }}>{customLabel}</span>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  padding: "3px 5px", borderRadius: 4, cursor: "pointer", display: "flex",
  background: "rgba(30,41,59,0.8)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.3)",
};
const chip: React.CSSProperties = {
  padding: "3px 9px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
  background: "rgba(30,41,59,0.6)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.3)",
};
const tabStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, fontSize: 13,
  border: "1px solid rgba(148,163,184,0.3)", background: "rgba(30,41,59,0.5)", color: "#cbd5e1",
  cursor: "pointer", fontFamily: "inherit",
};
const tabOn: React.CSSProperties = { borderColor: "#f97316", background: "rgba(249,115,22,0.18)", color: "#ffedd5", fontWeight: 700 };
const scoreBtn: React.CSSProperties = {
  width: 26, height: 24, padding: 0, borderRadius: 4, fontSize: 12, fontFamily: "ui-monospace, monospace",
  background: "rgba(30,41,59,0.6)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.25)",
};
const scoreOn: React.CSSProperties = { background: "rgba(249,115,22,0.35)", color: "#fff7ed", borderColor: "#f97316", fontWeight: 700 };
const chipOn: React.CSSProperties = { borderColor: "#f97316", background: "rgba(249,115,22,0.2)", fontWeight: 700 };
/** 沿用陣營預設的分數：虛框 */
const scoreInherited: React.CSSProperties = { borderStyle: "dashed", borderColor: "#f97316", color: "#fdba74" };
const scoreOnZero: React.CSSProperties = { background: "rgba(100,116,139,0.35)", color: "#e2e8f0", borderColor: "#94a3b8", fontWeight: 700 };
const warn: React.CSSProperties = {
  fontSize: 12, color: "#fed7aa", padding: "5px 8px", borderRadius: 4,
  background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)",
};
