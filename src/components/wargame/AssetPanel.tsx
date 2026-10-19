/**
 * 資產面板 —— 「給定資產」的兵棋設定：
 *   1. 攻擊優序：每類目標 0–5 分 + 優序 / 距離權衡（sim/targetPriority.ts），存在 Side.targetPriority
 *      —— 未設定時也顯示分數表（全部同分），點任一分數即開始自訂；上方即時顯示「攻擊順序」摘要；
 *         依攻擊方覆寫收在「進階」，編輯時改用藍色強調以區隔陣營預設
 *   2. 偵察計畫：下一階段（建議派遣 → 一鍵套用）
 *
 * 入口：桌面頂部列「資產」鈕。
 */
import { useState, useSyncExternalStore } from "react";
import { ReconTab } from "./ReconTab";
import { Crosshair, X, RotateCcw, ScanSearch, ChevronDown, ChevronRight } from "lucide-react";
import type { SideId } from "../../wargame/types";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore } from "../../wargame/viewStore";
import { netStore } from "../../wargame/net/netStore";
import { useLang } from "../../wargame/i18n/lang";
import { detectionRank } from "../../wargame/sim/detection";
import {
  CATEGORY_OF, DEFAULT_BLEND, DEFAULT_WEIGHT, MAX_PRIORITY, TARGET_CATEGORIES, TARGET_PRIORITY_PRESETS,
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
    title: "資產", subtitle: "決定自動交戰先打什麼、派誰去偵察",
    tabPriority: "攻擊優序", tabRecon: "偵察計畫",
    side: "陣營", presets: "快速套用", custom: "自訂",
    unsetHint: "目前未設定：自動交戰一律打最近的目標。套用範本，或直接點下方分數開始調整。",
    order: "攻擊順序", orderUnset: "未設定 —— 不分類別，打最近的", skipList: "不打",
    category: "目標類別", scaleSkip: "不打", scaleLow: "低", scaleHigh: "高",
    scoreTitle: ["不打（不主動攻擊）", "很低", "低", "普通", "高", "最優先"],
    known: "已發現",
    blend: "距離 vs 優序", blendStops: ["就近", "兼顧", "嚴守優序"],
    blendNote: (b: number) => {
      if (b <= 0.05) return "只看距離：分數只用來排除「不打」的類別。";
      if (b >= 0.99) return "嚴守優序：永遠先打分數高的，同分才比距離。";
      const pct = Math.round((b * 0.2) / (1 - b) * 100);
      return pct >= 100
        ? "幾乎總是先打分數高的；只有距離差非常懸殊時才改打近的。"
        : `分數高 1 級的目標優先，除非低分目標近了 ${pct}% 射程以上。`;
    },
    note: "「不打」只影響自動交戰；右鍵 / 指令卡下的明確攻擊命令不受限。",
    readonly: "多人對戰中由房主設定攻擊優序（各方自設將於後續版本開放）",
    samWarn: "⚠ 本方防空飛彈對戰機 / 無人機為「不打」，不會自動接戰這類目標（攔截來襲飛彈不受影響）。",
    samFix: "讓防空照打空中目標",
    adv: "進階：依攻擊方另設分數", advCount: (n: number) => `已另設 ${n} 類`,
    advNote: "例如：全陣營不打無人機，但防空單位照打。選一類攻擊方後，上方分數只套用到它。",
    editing: (name: string) => `正在設定「${name}」單位專用的分數`,
    editingNote: "虛框 = 沿用陣營預設；點分數即另設。",
    backToSide: "回到陣營預設", clearOverride: "清除此類另設",
    clear: "清除（回到打最近）",
  },
  en: {
    title: "Assets", subtitle: "What auto-engage shoots first, and who goes scouting",
    tabPriority: "Target priority", tabRecon: "Recon plan",
    side: "Side", presets: "Quick apply", custom: "Custom",
    unsetHint: "Not set: auto-engage always picks the nearest target. Apply a preset, or click a score below to start.",
    order: "Engagement order", orderUnset: "Not set — nearest target, any category", skipList: "Skip",
    category: "Target category", scaleSkip: "skip", scaleLow: "low", scaleHigh: "high",
    scoreTitle: ["Skip (never auto-engage)", "Very low", "Low", "Normal", "High", "Top priority"],
    known: "spotted",
    blend: "Distance vs priority", blendStops: ["Nearest", "Balanced", "Strict"],
    blendNote: (b: number) => {
      if (b <= 0.05) return "Distance only: scores just exclude the skipped categories.";
      if (b >= 0.99) return "Strict: always the higher score first; distance only breaks ties.";
      const pct = Math.round((b * 0.2) / (1 - b) * 100);
      return pct >= 100
        ? "Almost always the higher score first; a nearer target wins only when it is far, far closer."
        : `A 1-point higher target goes first unless a lower one is closer by more than ${pct}% of weapon range.`;
    },
    note: "“Skip” only affects auto-engage; explicit attack orders (right-click / command card) still work.",
    readonly: "In multiplayer the host sets target priorities (per-player settings coming later)",
    samWarn: "⚠ This side's SAMs skip aircraft / UAVs and won't auto-engage them (intercepting incoming missiles is unaffected).",
    samFix: "Let air defence keep engaging air targets",
    adv: "Advanced: scores per shooter type", advCount: (n: number) => `${n} customised`,
    advNote: "E.g. the side skips UAVs but air defence still shoots them. Pick a shooter type; the scores above then apply to it only.",
    editing: (name: string) => `Editing scores for ${name} shooters only`,
    editingNote: "Dashed = inherits the side default; click a score to override.",
    backToSide: "Back to side default", clearOverride: "Clear this override",
    clear: "Clear (back to nearest)",
  },
} as const;

/** 進階（依攻擊方）模式的強調色，與陣營預設的橘色區隔 */
const SHOOTER_ACCENT = "#38bdf8";

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
  const [advOpen, setAdvOpen] = useState(false);
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
    // 未設定時從「全部同分」起步 —— 直接點分數就能開始調整，不必先選範本
    const base = profile ?? { ...presetProfile("balanced"), presetId: undefined };
    if (shooterCat) {
      const cur = base.byShooter?.[shooterCat] ?? {};
      setProfile({ ...base, byShooter: { ...base.byShooter, [shooterCat]: { ...cur, [c]: w } } });
      return;
    }
    setProfile({ ...base, weights: { ...base.weights, [c]: w }, presetId: undefined });
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
  const overrideCount = Object.keys(profile?.byShooter ?? {}).length;
  const showAdv = !!profile && ownShooterCats.length > 0 && (advOpen || overrideCount > 0);
  const shooterCat = showAdv && shooter && ownShooterCats.includes(shooter) ? shooter : null;
  const effective = (c: TargetCategory, sc: TargetCategory | null): { w: number; inherited: boolean } => {
    const o = sc ? profile?.byShooter?.[sc]?.[c] : undefined;
    if (o !== undefined) return { w: o, inherited: false };
    return { w: profile?.weights[c] ?? DEFAULT_WEIGHT, inherited: sc !== null };
  };
  const hasSam = Object.values(state.units).some((u) => u.sideId === sideId && (u.kind === "sam_coastal" || u.kind === "sam_patriot"));
  const samBlocked = !!profile && hasSam
    && (effective("aircraft", "air_defense").w === 0 || effective("uav", "air_defense").w === 0);
  const catName = (c: TargetCategory) => (lang === "en" ? CAT_TEXT[c].en : CAT_TEXT[c].zh);
  const accent = shooterCat ? SHOOTER_ACCENT : "#f97316";

  // 攻擊順序摘要：依分數高到低分組（目前檢視的攻擊方視角）
  const tiers: { w: number; cats: TargetCategory[] }[] = [];
  for (let w = MAX_PRIORITY; w >= 1; w--) {
    const cats = TARGET_CATEGORIES.filter((c) => effective(c, shooterCat).w === w);
    if (cats.length > 0) tiers.push({ w, cats });
  }
  const skipped = TARGET_CATEGORIES.filter((c) => effective(c, shooterCat).w === 0);

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
        <span style={{ fontSize: 12, color: "#64748b", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.subtitle}
        </span>
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

      {/* 範本 */}
      {editable && (
        <PresetRow lang={lang} current={profile?.presetId} label={t.presets} customLabel={profile ? t.custom : undefined}
          onPick={(id) => setProfile(profile
            ? { ...presetProfile(id, profile.blend), byShooter: profile.byShooter }
            : presetProfile(id))} />
      )}
      {!profile ? (
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{t.unsetHint}</div>
      ) : profile.presetId && (
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>
          {lang === "en" ? TARGET_PRIORITY_PRESETS[profile.presetId].descEn : TARGET_PRIORITY_PRESETS[profile.presetId].descZh}
        </div>
      )}

      {/* 攻擊順序摘要 */}
      <div style={{
        padding: "6px 8px", borderRadius: 6, fontSize: 12, lineHeight: 1.7,
        background: "rgba(30,41,59,0.55)", border: `1px solid ${shooterCat ? "rgba(56,189,248,0.35)" : "rgba(148,163,184,0.2)"}`,
      }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 1 }}>
          {t.order}{shooterCat ? ` · ${catName(shooterCat)}` : ""}
        </div>
        {!profile ? (
          <span style={{ color: "#cbd5e1" }}>{t.orderUnset}</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 4px" }}>
            {tiers.map((tier, i) => (
              <span key={tier.w} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "#475569" }}>›</span>}
                <span style={{
                  ...tierBadge, background: `rgba(249,115,22,${0.12 + 0.12 * tier.w})`,
                  ...(shooterCat ? { background: `rgba(56,189,248,${0.08 + 0.1 * tier.w})` } : {}),
                }}>{tier.w}</span>
                <span style={{ color: tier.w >= 4 ? "#f8fafc" : "#cbd5e1", fontWeight: tier.w >= 4 ? 700 : 400 }}>
                  {tier.cats.map(catName).join(lang === "en" ? ", " : "、")}
                </span>
              </span>
            ))}
            {skipped.length > 0 && (
              <span style={{ color: "#64748b", marginLeft: 4 }}>
                · {t.skipList}{lang === "en" ? ": " : "："}<span style={{ textDecoration: "line-through" }}>{skipped.map(catName).join(lang === "en" ? ", " : "、")}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* 進階模式提示：正在編輯某類攻擊方 */}
      {shooterCat && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12, padding: "5px 8px", borderRadius: 4,
          background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.4)", color: "#bae6fd",
        }}>
          <span style={{ flex: 1, minWidth: 160 }}>
            <b>{t.editing(catName(shooterCat))}</b>
            <span style={{ color: "#7dd3fc" }}> —— {t.editingNote}</span>
          </span>
          <button className="wg-btn" style={{ ...chip, fontSize: 12, padding: "2px 8px" }} onClick={() => setShooter(null)}>
            {t.backToSide}
          </button>
        </div>
      )}

      {/* 分數表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, fontSize: 11, color: "#64748b" }}>
          <span style={{ flex: 1 }}>{t.category}</span>
          <span style={{ width: 26, textAlign: "center" }}>{t.scaleSkip}</span>
          <span style={{
            width: 26 * MAX_PRIORITY + 2 * (MAX_PRIORITY - 1), marginLeft: -4, display: "flex", justifyContent: "space-between",
            padding: "0 4px", boxSizing: "border-box",
            backgroundImage: `linear-gradient(90deg, transparent, ${accent}55)`, borderRadius: 3,
          }}>
            <span>{t.scaleLow}</span><span>→</span><span style={{ color: "#cbd5e1" }}>{t.scaleHigh}</span>
          </span>
        </div>
        {TARGET_CATEGORIES.map((c) => {
          const { w, inherited } = effective(c, shooterCat);
          const n = known[c] ?? 0;
          const hint = lang === "en" ? CAT_TEXT[c].hintEn : CAT_TEXT[c].hintZh;
          const showHint = hint !== catName(c);
          return (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }} title={hint}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: !profile ? "#cbd5e1" : w === 0 ? "#64748b" : "#e2e8f0",
                  textDecoration: profile && w === 0 ? "line-through" : undefined,
                }}>
                  {catName(c)}
                  {n > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: "#fca5a5" }}> · {t.known} {n}</span>}
                </div>
                {showHint && (
                  <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {hint}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 2 }}>
                {Array.from({ length: MAX_PRIORITY + 1 }, (_, v) => (
                  <button key={v} className="wg-btn" disabled={!editable} onClick={() => setWeight(c, v)}
                    title={t.scoreTitle[v]}
                    style={{
                      ...scoreBtn,
                      ...(w === v
                        ? !profile ? scoreUnset
                          : inherited ? { ...scoreInherited, borderColor: accent, color: "#bae6fd" }
                          : v === 0 ? scoreOnZero
                          : shooterCat ? scoreOnShooter : scoreOn
                        : {}),
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

      {profile && (<>
        {/* 距離 vs 優序 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#94a3b8", flexShrink: 0 }}>{t.blend}</span>
            <span style={{ flex: 1 }} />
            {BLEND_STOPS.map((b, i) => (
              <button key={b} className="wg-btn" disabled={!editable} onClick={() => setProfile({ ...profile, blend: b })}
                style={{ ...chip, fontSize: 12, padding: "2px 8px", ...(Math.abs(profile.blend - b) < 0.001 ? chipOn : {}) }}>
                {t.blendStops[i]}
              </button>
            ))}
          </div>
          <input type="range" min={0} max={1} step={0.05} value={profile.blend} disabled={!editable}
            onChange={(e) => setProfile({ ...profile, blend: Number(e.target.value) })}
            style={{ width: "100%", accentColor: "#f97316", margin: 0 }} />
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{t.blendNote(profile.blend)}</div>
        </div>

        {/* 進階：依攻擊方另設 */}
        {ownShooterCats.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 6, borderTop: "1px solid rgba(148,163,184,0.15)" }}>
            <button className="wg-btn" onClick={() => { if (showAdv && overrideCount === 0) setShooter(null); setAdvOpen(!showAdv); }}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: 0, background: "none", border: "none",
                color: "#cbd5e1", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                cursor: overrideCount > 0 ? "default" : "pointer", textAlign: "left",
              }}>
              {showAdv ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {t.adv}
              {overrideCount > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: SHOOTER_ACCENT }}>· {t.advCount(overrideCount)}</span>}
            </button>
            {showAdv && (<>
              <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{t.advNote}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {ownShooterCats.map((c) => {
                  const n = Object.keys(profile.byShooter?.[c] ?? {}).length;
                  const on = shooterCat === c;
                  return (
                    <button key={c} className="wg-btn" onClick={() => setShooter(on ? null : c)}
                      style={{ ...chip, ...(on ? { borderColor: SHOOTER_ACCENT, background: "rgba(56,189,248,0.2)", fontWeight: 700 } : {}) }}>
                      {catName(c)}{n > 0 && <span style={{ color: SHOOTER_ACCENT }}> ·{n}</span>}
                    </button>
                  );
                })}
              </div>
              {shooterCat && editable && Object.keys(profile.byShooter?.[shooterCat] ?? {}).length > 0 && (
                <button className="wg-btn" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => clearShooterOverride(shooterCat)}>
                  {t.clearOverride}
                </button>
              )}
            </>)}
          </div>
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
        <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{t.note}</div>
        {editable && (
          <button className="wg-btn" style={{ ...chip, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => { setProfile(null); setShooter(null); setAdvOpen(false); }}>
            <RotateCcw size={12} /> {t.clear}
          </button>
        )}
      </>)}
      </>)}
    </div>
  );
}

/** 「距離 vs 優序」三段捷徑：就近 / 兼顧（預設）/ 嚴守優序 */
const BLEND_STOPS = [0, DEFAULT_BLEND, 1] as const;

function PresetRow({ lang, current, onPick, label, customLabel }: {
  lang: "zh" | "en"; current: TargetPriorityPresetId | undefined;
  onPick: (id: TargetPriorityPresetId) => void; label: string; customLabel?: string;
}) {
  const ids = Object.keys(TARGET_PRIORITY_PRESETS) as TargetPriorityPresetId[];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "#94a3b8" }}>{label}</span>
      {ids.map((id) => (
        <button key={id} className="wg-btn" onClick={() => onPick(id)}
          title={lang === "en" ? TARGET_PRIORITY_PRESETS[id].descEn : TARGET_PRIORITY_PRESETS[id].descZh}
          style={{ ...chip, ...(current === id ? chipOn : {}) }}>
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
const scoreOnShooter: React.CSSProperties = { background: "rgba(56,189,248,0.3)", color: "#f0f9ff", borderColor: SHOOTER_ACCENT, fontWeight: 700 };
/** 未設定優序：顯示預設分數但不搶眼 */
const scoreUnset: React.CSSProperties = { background: "rgba(148,163,184,0.18)", color: "#cbd5e1", borderColor: "rgba(148,163,184,0.5)" };
const tierBadge: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 3,
  fontSize: 10, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#fff7ed",
};
const chipOn: React.CSSProperties = { borderColor: "#f97316", background: "rgba(249,115,22,0.2)", fontWeight: 700 };
/** 沿用陣營預設的分數：虛框 */
const scoreInherited: React.CSSProperties = { borderStyle: "dashed", borderColor: "#f97316", color: "#fdba74" };
const scoreOnZero: React.CSSProperties = { background: "rgba(100,116,139,0.35)", color: "#e2e8f0", borderColor: "#94a3b8", fontWeight: 700 };
const warn: React.CSSProperties = {
  fontSize: 12, color: "#fed7aa", padding: "5px 8px", borderRadius: 4,
  background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)",
};
