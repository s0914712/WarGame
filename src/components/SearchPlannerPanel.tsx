/**
 * 搜索規劃器面板 — IAMSAR 搜索參數與六大圖形的解算介面（中／英雙語）。
 *
 * 四件事：
 *   1. 給定搜索區 + 無人機數量 → 掃完全區時間
 *   2. 同上 → 發現機率 POD
 *   3. 給定時間 → 反解建議架數與搜索方式
 *   4. 蒙地卡羅模擬 → 把漂流 / 導航誤差 / 感測器可用率算進去的經驗 POD
 *
 * 解算全在 src/wargame/search/*（純函式、語言中立）；文字由 search/i18n.ts 產生。
 * 面板同時服務兵推模式與 standalone 搜索規劃 app。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Radar, X, Crosshair, Wand2, Send, RotateCcw, Trash2, Play, MapPin, Hexagon, Plus, ClipboardPaste,
  ChevronUp, ChevronDown, Upload, Download, ArrowDownUp, LifeBuoy, Pause, Check, Ship,
} from "lucide-react";
import { LEEWAY_OBJECTS } from "../wargame/search/drift/leeway";
import { SeaVectorControls } from "./wargame/SeaVectorControls";
import {
  searchPlannerStore, solve, eligibleSearchUnits, assetProfileFromUnit, midSearchElapsedHr,
  currentRangeLimits, lkpProjection, transitProjection, transitShip, type LkpPickTarget,
} from "../wargame/search/searchPlannerStore";
import { SEARCH_PATTERNS, type SearchPatternId } from "../wargame/search/patterns";
import { podForDisplay, POD_DISPLAY_CAP, podFromCoverage } from "../wargame/search/pod";
import { MAX_POLYGON_VERTICES, TRACK_COLORS } from "../wargame/search/tracks";
import type { LngLat } from "../wargame/types";
import type { SearchStrings } from "../wargame/search/i18n";
import {
  decimalToDms, dmsToDecimal, formatDms, parseLngLatLine, validateDms, DMS_SEC_DECIMALS,
  type CoordAxis, type CoordOrder,
} from "../wargame/search/dms";
import {
  EXPORT_MIME, exportPolygon, importPolygon, isAngleSorted, sortVerticesByAngle, type ExportFormat,
} from "../wargame/search/polygonIO";
import { altitudeLookupKind, suggestWeatherFactor, type SearchTargetClass } from "../wargame/search/sweepWidth";
import { UNIT_CATALOG } from "../wargame/catalog/units";
import { useLang } from "../wargame/i18n/lang";
import {
  searchStrings, formatNotice, coverageNote, patternReason, patternLabel,
} from "../wargame/search/i18n";

function subscribe(cb: () => void) { return searchPlannerStore.subscribe(cb); }
/** snapshot 必須是每次變動都改變的值 —— 見 searchPlannerStore.getVersion 的說明 */
const getVersion = () => searchPlannerStore.getVersion();

/**
 * @param standalone  獨立 app 模式（自己佔滿容器、面板恆開、不顯示關閉鈕）
 * @param embedded    嵌在行動版 dock 分頁裡（無外框、無標題列、由 dock 提供捲動）
 */
export function SearchPlannerPanel(
  { standalone = false, embedded = false, insetTop = 0, insetBottom = 0 }: {
    standalone?: boolean; embedded?: boolean;
    /** 桌面頂部列 / 底部控制台高度：側欄與框選提示列避開 */
    insetTop?: number; insetBottom?: number;
  } = {},
) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const langRaw = useLang();
  const lang: "zh" | "en" = langRaw === "en" ? "en" : "zh";
  const t = searchStrings(lang);
  const [mcBusy, setMcBusy] = useState(false);

  const open = searchPlannerStore.isOpen();
  const picking = searchPlannerStore.isPicking();
  const inputs = searchPlannerStore.getInputs();
  const { a, b } = searchPlannerStore.getCorners();
  const polygon = searchPlannerStore.getPolygon();
  const [polyOpen, setPolyOpen] = useState(false);
  const tracks = searchPlannerStore.getTracks();
  const assigned = searchPlannerStore.getAssignedUnitIds();
  const mc = searchPlannerStore.getMonteCarlo();
  const scenarios = searchPlannerStore.getScenarios();
  const sortiePos = searchPlannerStore.getSortiePos();
  const eff = searchPlannerStore.getSearchEffectiveness();
  const sol = solve();
  const units = eligibleSearchUnits();
  // 搜索對象：落水人員（Leeway 漂流）或船舶 / 船團（航向航速）
  const isMob = inputs.driftModel === "leeway";
  // 落水 Leeway 漂流已算好 → 蒙地卡羅可選「落水漂流粒子」
  const driftReady = inputs.bayesEnabled && inputs.priorFromLkp && inputs.driftModel === "leeway"
    && !!searchPlannerStore.getDrift().result && searchPlannerStore.isDriftCurrent();

  const fmtHr = (h: number): string => {
    if (!Number.isFinite(h)) return "—";
    if (h < 1) return `${Math.round(h * 60)} ${t.minutes}`;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return mm === 0 ? `${hh} ${t.hours}` : `${hh} ${t.hours} ${mm} ${t.minutes}`;
  };
  /** 文件七(四)5：不顯示 100% */
  const fmtPod = (p: number): string => {
    const c = podForDisplay(p);
    return c >= POD_DISPLAY_CAP ? `>${(POD_DISPLAY_CAP * 100).toFixed(1)}%` : `${(c * 100).toFixed(1)}%`;
  };

  // standalone / embedded 皆視為恆開（沒有收合入口）
  if (!open && !standalone && !embedded) return null;

  if (picking) {
    const draft = searchPlannerStore.getDraftPoints();
    const issue = searchPlannerStore.getDraftIssue();
    return (
      <div style={embedded ? pickBarInline : { ...pickBar, top: pickBar.top as number + insetTop }}>
        <Crosshair size={16} color="#facc15" />
        <span style={{ color: "#fef9c3", fontWeight: 600 }}>
          {t.drawHint.replace("{n}", String(draft.length))}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="wg-btn" style={{ ...smallBtn, opacity: draft.length < 3 ? 0.45 : 1 }} disabled={draft.length < 3}
            onClick={() => searchPlannerStore.finishDraft()}>
            <Hexagon size={12} /> {t.drawFinish}
          </button>
          <button className="wg-btn" style={{ ...smallBtn, opacity: draft.length === 0 ? 0.45 : 1 }} disabled={draft.length === 0}
            onClick={() => searchPlannerStore.undoDraftPoint()}>
            <RotateCcw size={12} /> {t.drawUndo}
          </button>
          <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.cancelPick()}>
            {t.cancel}
          </button>
        </div>
        {issue && (
          <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
            <span style={{ color: "#fca5a5" }}>{t.polyIssue[issue]}</span>
            {issue === "self_intersecting" && (
              <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.finishDraft(true)}>
                <ArrowDownUp size={12} /> {t.drawSortFinish}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const patch = searchPlannerStore.patch.bind(searchPlannerStore);
  const fwd = sol?.forward;
  const inv = sol?.inverse;
  const W = fwd?.sweepWidth ?? inv?.sweepWidth;
  const pattern: SearchPatternId | null = sol?.pattern ?? null;
  const info = pattern ? SEARCH_PATTERNS[pattern] : null;
  const ptext = pattern ? SEARCH_PATTERNS[pattern][lang] : null;
  const level = fwd?.coverageLevel ?? inv?.coverageLevel;
  const notices = fwd?.notices ?? inv?.notices ?? [];

  const actualTrackNm = tracks.reduce((s, x) => s + x.trackNm, 0);
  const estTrackNm = sol ? sol.area.areaNm2 / sol.trackSpacingNm : 0;
  const actualHr = actualTrackNm > 0 && sol
    ? actualTrackNm / Math.max(1, sol.droneCount) / Math.max(0.1, inputs.speedKn)
    : 0;
  const contactLoad = fwd?.contacts ?? inv?.contacts ?? null;
  const loggedContacts = searchPlannerStore.getLoggedContacts();
  const logging = searchPlannerStore.isLoggingContact();
  const rankedContacts = inputs.falseTargetsEnabled ? searchPlannerStore.rankLoggedContacts(4) : [];
  const limits = currentRangeLimits();
  const useExperience = inputs.sweepSource === "experience";
  // 查表：engine 已夾到上限，看 capped 旗標；經驗值：不夾，只比較是否超過
  const sweepExceedsPhysics = useExperience
    ? (W?.uncorrectedNm ?? 0) > limits.sweepWidthCapNm + 1e-9
    : W?.capped === true;
  const analyticPod = sol
    ? (fwd?.pod ?? inv?.achievedPod ?? podFromCoverage(sol.trackSpacingNm > 0 ? (W?.correctedNm ?? 0) / sol.trackSpacingNm : 0, inputs.podModel))
    : 0;

  const runMc = () => {
    setMcBusy(true);
    // 讓 busy 狀態先畫出來再跑（同步運算會阻塞）
    setTimeout(() => {
      searchPlannerStore.runMonteCarlo();
      setMcBusy(false);
    }, 20);
  };

  return (
    <div style={embedded ? rootEmbedded : standalone ? rootStandalone : { ...root, top: insetTop, bottom: insetBottom }}>
      {!embedded && (
      <div style={header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 20, color: "#fef9c3" }}>
            <Radar size={18} /> {t.title}
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>{t.subtitle}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.reset()}>
            <RotateCcw size={12} /> {t.reset}
          </button>
          {!standalone && (
            <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.setOpen(false)}>
              <X size={12} /> {t.close}
            </button>
          )}
        </div>
      </div>
      )}

      {embedded && (
        <button className="wg-btn" style={{ ...smallBtn, alignSelf: "flex-end", marginBottom: 6 }}
          onClick={() => searchPlannerStore.reset()}>
          <RotateCcw size={12} /> {t.reset}
        </button>
      )}

      <div style={embedded ? bodyEmbedded : body}>
        <TargetTypeSection lang={lang} />
        {isMob
          ? <MobDriftSection t={t} lang={lang} fmtHr={fmtHr} />
          : <VesselSection t={t} lang={lang} fmtHr={fmtHr} />}

        {/* ① 搜索區 */}
        <Section title={t.secArea}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button className="wg-btn" style={primaryBtn} onClick={() => searchPlannerStore.startPickArea()}>
              <Crosshair size={13} /> {t.pickOnMap}
            </button>
            <button className="wg-btn" style={{ ...smallBtn, ...(polyOpen ? { borderColor: "#facc15", color: "#fef9c3" } : {}) }}
              onClick={() => setPolyOpen((v) => !v)}>
              <Hexagon size={12} /> {t.polyInput}
            </button>
            {a && b && (
              <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.clearArea()}>
                <Trash2 size={12} /> {t.clear}
              </button>
            )}
          </div>
          {polyOpen && <PolygonEditor t={t} polygon={polygon} corners={a && b ? [a, b] : null} />}
          {sol ? (
            <div style={readout}>
              {polygon
                ? <>{t.polyArea} {polygon.length} {t.polyVertices}</>
                : <>{sol.area.longSideNm.toFixed(1)} × {sol.area.shortSideNm.toFixed(1)} nm</>}
              {"  ·  "}<b style={{ color: "#fef9c3" }}>{sol.area.areaNm2.toFixed(0)} nm²</b>
            </div>
          ) : (
            <div style={{ ...readout, color: "#94a3b8" }}>{t.noArea}</div>
          )}
        </Section>

        {/* ② 解算方向 */}
        <Section title={t.secSolve}>
          <div style={{ display: "flex", gap: 6 }}>
            <Toggle active={inputs.direction === "given_assets"}
              onClick={() => patch({ direction: "given_assets" })} label={t.dirGivenAssets} />
            <Toggle active={inputs.direction === "given_time"}
              onClick={() => patch({ direction: "given_time" })} label={t.dirGivenTime} />
          </div>
          {inputs.direction === "given_assets" ? (
            <NumField label={t.droneCount} value={inputs.droneCount} min={1} max={24} step={1} unit=""
              onChange={(v) => patch({ droneCount: v })} />
          ) : (
            <>
              <NumField label={t.availableTime} value={inputs.availableHr} min={0.5} max={48} step={0.5} unit="hr"
                onChange={(v) => patch({ availableHr: v })} />
              <NumField label={t.targetPod} value={Math.round(inputs.targetPod * 100)} min={10} max={99} step={1} unit="%"
                onChange={(v) => patch({ targetPod: v / 100 })} />
            </>
          )}
        </Section>

        {/* ③ 目標與感測 */}
        <Section title={t.secSensor}>
          <Row label={t.searchTarget}>
            <select value={inputs.targetClass} style={select}
              onChange={(e) => patch({ targetClass: e.target.value as SearchTargetClass })}>
              <option value="ship_46_91m">{t.targetSmall}</option>
              <option value="ship_over_91m">{t.targetLarge}</option>
            </select>
          </Row>
          <Row label={t.sweepSource}>
            <div style={{ display: "flex", gap: 6, flex: 1 }}>
              <Toggle active={!useExperience} label={t.sweepSourceTable}
                onClick={() => patch({ sweepSource: "table" })} />
              <Toggle active={useExperience} label={t.sweepSourceExperience}
                onClick={() => patch({ sweepSource: "experience" })} />
            </div>
          </Row>
          {useExperience ? (
            <div style={{
              padding: "7px 9px", borderRadius: 4, display: "flex", flexDirection: "column", gap: 4,
              background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.3)",
            }}>
              <Row label={t.expPlatform}>
                <input value={inputs.experiencePlatform} placeholder={t.expPlatformPlaceholder}
                  onChange={(e) => patch({ experiencePlatform: e.target.value })}
                  style={{ ...numInput, flex: 1, width: "auto", fontFamily: "inherit" }} />
              </Row>
              <NumField label={t.altitude} value={inputs.altitudeFt} min={100} max={20000} step={100} unit="ft"
                onChange={(v) => patch({ altitudeFt: v })} />
              <NumField label={t.expRange} value={inputs.experienceRangeNm} min={0.5} max={40} step={0.5} unit="nm"
                onChange={(v) => patch({ experienceRangeNm: v })} />
              <NumField label={t.expRefVisibility} value={inputs.experienceRefVisibilityKm} min={2} max={40} step={1} unit="km"
                onChange={(v) => patch({ experienceRefVisibilityKm: v })} />
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{t.expNote}</div>
            </div>
          ) : (
            <>
              <NumField label={t.altitude} value={inputs.altitudeFt} min={100} max={20000} step={100} unit="ft"
                onChange={(v) => patch({ altitudeFt: v })} />
              {altitudeLookupKind(inputs.altitudeFt) !== "tabulated" && (
                <div style={{
                  fontSize: 13, lineHeight: 1.5, paddingLeft: 2,
                  color: altitudeLookupKind(inputs.altitudeFt) === "interpolated" ? "#94a3b8" : "#fed7aa",
                }}>
                  {t.altLookup[altitudeLookupKind(inputs.altitudeFt) as "interpolated" | "extrapolated_low" | "extrapolated_high"]}
                </div>
              )}
            </>
          )}
          <div style={{
            padding: "7px 9px", borderRadius: 4, marginTop: 2,
            background: "rgba(30,41,59,0.5)", fontSize: 13, lineHeight: 1.6, color: "#94a3b8",
          }}>
            <div style={{ color: "#cbd5e1", fontWeight: 600, marginBottom: 2 }}>{t.rangeLimits}</div>
            <div>{t.horizonRange}: <b style={{ color: "#e2e8f0" }}>{limits.horizonNm.toFixed(1)} nm</b></div>
            <div>{t.resolutionRange}: <b style={{ color: "#e2e8f0" }}>
              {limits.gsdLateralNm > 999 ? ">999" : limits.gsdLateralNm.toFixed(1)} nm</b></div>
            <div style={{ color: "#cbd5e1" }}>
              {t.maxLateral}: <b>{limits.maxLateralNm.toFixed(1)} nm</b>
              {" "}({limits.limitedBy === "horizon" ? t.limitedByHorizon : t.limitedByResolution})
              {" · "}{t.gsdAtMax} {limits.gsdAtMaxM.toFixed(2)} m/px
            </div>
            {sweepExceedsPhysics && (
              <div style={{ color: "#fed7aa", marginTop: 3 }}>{useExperience ? t.expExceedsPhysics : t.sweepCapped}</div>
            )}
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{t.rangeNote}</div>
          </div>
          <NumField label={t.eoirHfov} value={inputs.eoir.hfovDeg} min={0.5} max={30} step={0.5} unit="°"
            onChange={(v) => patch({ eoir: { ...inputs.eoir, hfovDeg: v } })} />
          <NumField label={t.eoirPixelsOnTarget} value={inputs.eoir.pixelsOnTarget} min={1} max={12} step={1} unit="px"
            onChange={(v) => patch({ eoir: { ...inputs.eoir, pixelsOnTarget: v } })} />
          <NumField label={t.visibility} value={inputs.visibilityKm} min={0.5} max={40} step={0.5} unit="km"
            onChange={(v) => patch({ visibilityKm: v })} />
          <NumField label={t.wind} value={inputs.windKn} min={0} max={50} step={1} unit="kn"
            onChange={(v) => patch({ windKn: v })} />
          <NumField label={t.seaState} value={inputs.seaStateM} min={0} max={6} step={0.1} unit="m"
            onChange={(v) => patch({ seaStateM: v })} />
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <NumField label={t.weatherFactor} value={inputs.corrections.weather} min={0.1} max={1.5} step={0.05} unit=""
                onChange={(v) => patch({ corrections: { ...inputs.corrections, weather: v } })} />
            </div>
            <button className="wg-btn" style={{ ...smallBtn, marginBottom: 6 }}
              onClick={() => patch({ corrections: { ...inputs.corrections, weather: +suggestWeatherFactor(inputs.windKn, inputs.seaStateM).toFixed(2) } })}>
              <Wand2 size={12} /> {t.suggest}
            </button>
          </div>
          <NumField label={t.speedFactor} value={inputs.corrections.speed} min={0.1} max={2} step={0.05} unit=""
            onChange={(v) => patch({ corrections: { ...inputs.corrections, speed: v } })} />
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.corrections.fatigued}
              onChange={(e) => patch({ corrections: { ...inputs.corrections, fatigued: e.target.checked } })} />
            {t.fatigued}
          </label>
          {useExperience ? (
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{t.expNoDiscount}</div>
          ) : (
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.sensorTested}
              onChange={(e) => patch({ sensorTested: e.target.checked })} />
            {t.sensorTested}
          </label>
          )}
          {!useExperience && !inputs.sensorTested && (
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, paddingLeft: 22 }}>
              {t.sensorTestedNote}
            </div>
          )}
        </Section>

        {/* ④ 機隊性能 */}
        <Section title={t.secAsset}>
          <NumField label={t.speed} value={inputs.speedKn} min={20} max={300} step={5} unit="kn"
            onChange={(v) => patch({ speedKn: v })} />
          <NumField label={t.endurance} value={inputs.enduranceHr} min={0} max={48} step={0.5} unit="hr"
            onChange={(v) => patch({ enduranceHr: v })} />
          <NumField label={t.transit} value={inputs.transitHrOneWay} min={0} max={12} step={0.1} unit="hr"
            onChange={(v) => patch({ transitHrOneWay: v })} />
          {units.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              <span style={{ fontSize: 14, color: "#94a3b8", alignSelf: "center" }}>{t.applyAirframe}</span>
              {Array.from(new Map(units.map((u) => [u.kind, u])).values()).map((u) => {
                const prof = assetProfileFromUnit(u);
                const name = lang === "en" ? u.kind : UNIT_CATALOG[u.kind].displayName;
                return (
                  <button key={u.kind} className="wg-btn" style={chip} onClick={() => patch(prof)}>
                    {name} {prof.speedKn}kn/{(prof.enduranceHr ?? 0).toFixed(0)}hr
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* ⑤ 航跡間距與圖形 */}
        <Section title={t.secSpacing}>
          <Row label={t.coverageChoice}>
            <div style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap" }}>
              {([[null, t.coverageAuto], [0.75, t.coverageSparse], [1.0, t.coverageIdeal], [1.3, t.coverageDense]] as [number | null, string][])
                .map(([v, label]) => {
                  const active = inputs.coverageOverride === v;
                  return (
                    <button key={label} className="wg-btn"
                      onClick={() => patch({ coverageOverride: v, trackSpacingOverrideNm: null })}
                      style={{
                        flex: 1, minWidth: 62, padding: "5px 6px", borderRadius: 4, fontSize: 14,
                        cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 700 : 400,
                        border: `1px solid ${active ? "#facc15" : "rgba(148,163,184,0.25)"}`,
                        background: active ? "rgba(250,204,21,0.2)" : "rgba(30,41,59,0.4)",
                        color: active ? "#fef9c3" : "#cbd5e1",
                      }}>{label}</button>
                  );
                })}
            </div>
          </Row>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{t.coverageNote}</div>
          <Row label={t.trackSpacing}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
              <input type="number" step={0.1} min={0.1}
                value={inputs.trackSpacingOverrideNm ?? (sol?.trackSpacingNm.toFixed(2) ?? "")}
                placeholder={t.auto} style={{ ...numInput, flex: 1 }}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  patch({ trackSpacingOverrideNm: v === "" ? null : Number(v) });
                }} />
              <span style={{ fontSize: 14, color: "#94a3b8" }}>nm</span>
              {inputs.trackSpacingOverrideNm !== null && (
                <button className="wg-btn" style={smallBtn}
                  onClick={() => patch({ trackSpacingOverrideNm: null })}>{t.auto}</button>
              )}
            </div>
          </Row>
          <Row label={t.pattern}>
            <select value={inputs.patternOverride ?? ""} style={select}
              onChange={(e) => patch({ patternOverride: e.target.value === "" ? null : e.target.value as SearchPatternId })}>
              <option value="">
                {t.autoPattern}{pattern ? (lang === "en" ? ` (${SEARCH_PATTERNS[pattern].en.name})` : `（${SEARCH_PATTERNS[pattern].zh.name}）`) : ""}
              </option>
              {Object.values(SEARCH_PATTERNS).map((p) => (
                <option key={p.id} value={p.id}>{patternLabel(p.id, lang)}</option>
              ))}
            </select>
          </Row>
          <Row label={t.podModel}>
            <select value={inputs.podModel} style={select}
              onChange={(e) => patch({ podModel: e.target.value as "iamsar_chart" | "random_search" })}>
              <option value="iamsar_chart">{t.podModelChart}</option>
              <option value="random_search">{t.podModelRandom}</option>
            </select>
          </Row>
          <NumField label={t.navError} value={inputs.navErrorSigmaNm} min={0} max={5} step={0.05} unit="nm"
            onChange={(v) => patch({ navErrorSigmaNm: v })} />
          <NumField label={t.sweepSpread} value={Math.round(inputs.sweepWidthSpread * 100)} min={0} max={80} step={5} unit="%"
            onChange={(v) => patch({ sweepWidthSpread: v / 100 })} />
          <NumField label={t.datumUncertainty} value={inputs.datumUncertaintyNm} min={0} max={40} step={0.5} unit="nm"
            onChange={(v) => patch({ datumUncertaintyNm: v })} />
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.targetBiasedToOneEnd}
              onChange={(e) => patch({ targetBiasedToOneEnd: e.target.checked })} />
            {t.biasedToOneEnd}
          </label>
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.hasKnownTrackLine}
              onChange={(e) => patch({ hasKnownTrackLine: e.target.checked })} />
            {t.knownTrackLine}
          </label>
        </Section>

        {/* 解算結果 */}
        {sol && W && (
          <div style={resultBox}>
            <div style={resultTitle}>{t.results}</div>
            <KV k={t.sweepWidth} v={`${W.correctedNm.toFixed(2)} nm`}
              note={(W.source === "experience"
                ? `${inputs.experiencePlatform ? `${inputs.experiencePlatform} · ` : ""}Wu = 2 × ${W.experienceRangeNm ?? 0} nm`
                  + ((W.visibilityFactor ?? 1) < 1 ? ` × ${(W.visibilityFactor ?? 1).toFixed(2)}` : "")
                  + ` = ${W.uncorrectedNm.toFixed(1)}`
                : W.capped
                  ? `Wu ${(W.tableNm ?? 0).toFixed(1)} → ${W.uncorrectedNm.toFixed(1)} (${t.sweepCap})`
                  : `Wu ${W.uncorrectedNm.toFixed(1)}`)
                + ` × Fw ${W.corrections.weather} × Fv ${W.corrections.speed}${W.corrections.fatigued ? " × Ff 0.9" : ""}`
                + ((W.corrections.operational ?? 1) < 1 ? ` × Fo ${W.corrections.operational}` : "")
                + ((W.visibilityFactor ?? 1) < 1 ? ` · ${t.expVisReduced}` : "")} />
            <KV k={t.trackSpacing} v={`${sol.trackSpacingNm.toFixed(2)} nm`} />
            <KV k={t.coverage} v={(fwd?.coverage ?? inv?.achievedCoverage ?? 0).toFixed(2)}
              note={level ? coverageNote(level, lang) : undefined} />

            {fwd && (
              <>
                <KV k={t.sweepTime} v={fmtHr(fwd.timeHr)} big
                  note={`${sol.droneCount} × ${inputs.speedKn} kn × S ${sol.trackSpacingNm.toFixed(2)} nm  (A = T×N×P×S)`} />
                {inputs.falseTargetsEnabled && fwd.contacts.expectedContacts > 0 && (
                  <KV k={t.timeWithContacts} v={fmtHr(fwd.timeWithContactsHr)}
                    note={`${t.investigationHours} ${fwd.contacts.investigationHours.toFixed(1)} hr (${(fwd.contacts.timeShare * 100).toFixed(0)}%)`} />
                )}
                <KV k={t.elapsedTime} v={fmtHr(fwd.elapsedHrWithSorties)}
                  note={fwd.sortiesPerDrone > 1
                    ? `${fwd.sortiesPerDrone} ${t.sorties} ${t.perAircraft} · ${t.onStationPerSortie} ${fmtHr(fwd.onStationHr)}`
                    : `${t.onStationPerSortie} ${fmtHr(fwd.onStationHr)}`} />
                <KV k={t.pod} v={fmtPod(fwd.pod)} big highlight note={t.podCapNote} />
                <BoundsRow t={t} b={fwd.bounds} fmtPod={fmtPod} />
                <KV k={t.cumulativePod}
                  v={[2, 3].map((x) => `${x}× ${fmtPod(1 - Math.pow(1 - fwd.pod, x))}`).join("  ·  ")} />
                <KV k={t.totalTrack} v={`${fwd.totalTrackNm.toFixed(0)} nm`}
                  note={`${t.perAircraft} ${fwd.trackPerDroneNm.toFixed(0)} nm`} />
              </>
            )}

            {inv && (
              <>
                <KV k={t.recommendedDrones} v={`${inv.recommendedDrones}`} big highlight
                  note={`${t.theoretical} ${inv.exactDrones.toFixed(2)}`} />
                <KV k={t.recommendedPattern} v={patternLabel(inv.pattern, lang)} big />
                <KV k={t.reason} v={patternReason(inv.patternReasonCode, inv.patternMultiAssetNote, lang)} wrap />
                <KV k={t.achievedPod} v={fmtPod(inv.achievedPod)}
                  note={`${t.ofTarget} ${(inputs.targetPod * 100).toFixed(0)}% · ${t.requiredCoverage} ${inv.requiredCoverage.toFixed(2)}`} />
                <BoundsRow t={t} b={inv.bounds} fmtPod={fmtPod} />
                <KV k={t.actualTime} v={fmtHr(inv.actualTimeHr)}
                  note={inv.sortiesPerDrone > 1 ? `${inv.sortiesPerDrone} ${t.sorties} ${t.perAircraft}` : undefined} />
                {inv.fallback && (
                  <div style={warnBox}>
                    {lang === "en"
                      ? `Condition ceilings cap a single search at ${(inv.fallback.bestPod * 100).toFixed(1)}% POD. Per §7(3), repeating the same coverage ${inv.fallback.repeatsForTarget}× reaches a cumulative ${fmtPod(inv.fallback.cumulativePod)}.`
                      : `單次搜索受條件上限限制只能達到 ${(inv.fallback.bestPod * 100).toFixed(1)}% POD；依文件七(三)以相同覆蓋重複搜索 ${inv.fallback.repeatsForTarget} 次，累積 POD 可達 ${fmtPod(inv.fallback.cumulativePod)}。`}
                  </div>
                )}
              </>
            )}

            {sol.rectangle && sol.stats && (
              <div style={{ ...patternCard, borderColor: "rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.06)" }}>
                <div style={{ fontWeight: 700, color: "#bbf7d0", marginBottom: 6 }}>{t.optimalRect}</div>
                <PatRow k={t.priorStats}
                  v={`σ ${sol.stats.sigmaEastNm.toFixed(1)} × ${sol.stats.sigmaNorthNm.toFixed(1)} nm · ${t.majorAxis} ${sol.stats.majorAxisBearingDeg.toFixed(0)}°`} />
                <PatRow k={t.optimalRectSize}
                  v={`${sol.rectangle.best.length1Nm.toFixed(1)} × ${sol.rectangle.best.length2Nm.toFixed(1)} nm (K*=${sol.rectangle.best.K.toFixed(2)}) → P_D ${fmtPod(sol.rectangle.best.pod)}`} />
                <PatRow k=""
                  v={`${t.containment} ${(sol.rectangle.best.containment * 100).toFixed(0)}% × ${t.conditionalDetect} ${(sol.rectangle.best.conditionalDetection * 100).toFixed(0)}%`} />
                {sol.rectangle.userPlan && (
                  <>
                    <PatRow k={t.yourBox}
                      v={`${sol.area.longSideNm.toFixed(1)} × ${sol.area.shortSideNm.toFixed(1)} nm → P_D ${fmtPod(sol.rectangle.userPlan.pod)}`} />
                    <div style={{
                      marginTop: 6, padding: "6px 8px", borderRadius: 4, fontSize: 14,
                      background: sol.rectangle.userPlan.lossFraction > 0.1 ? "rgba(251,146,60,0.14)" : "rgba(74,222,128,0.12)",
                      color: sol.rectangle.userPlan.lossFraction > 0.1 ? "#fed7aa" : "#bbf7d0",
                    }}>
                      {t.rectLoss}: <b>{(sol.rectangle.userPlan.lossFraction * 100).toFixed(1)}%</b>
                      {sol.rectangle.userPlan.lossFraction <= 0.05 && ` — ${t.rectLossNone}`}
                    </div>
                    <button className="wg-btn" style={{ ...smallBtn, marginTop: 6 }}
                      onClick={() => searchPlannerStore.applyOptimalRectangle()}>
                      {t.applyOptimalRect}
                    </button>
                  </>
                )}
              </div>
            )}

            {ptext && info && (
              <div style={patternCard}>
                <div style={{ fontWeight: 700, color: "#fef9c3", marginBottom: 4 }}>
                  {info.id} · {ptext.name}{lang === "zh" ? `（${info.nameEn}）` : ""}
                </div>
                <PatRow k={t.patternWhenToUse} v={ptext.whenToUse} />
                <PatRow k={t.patternLegs} v={ptext.legDirection} />
                <PatRow k={t.patternStart} v={ptext.startPoint} />
                <PatRow k={t.patternParams} v={ptext.keyParams} />
                <PatRow k={t.patternLimits} v={ptext.limits} />
                <PatRow k={t.patternUav} v={`${info.uavSuitable === "yes" ? "✔" : "△"} ${ptext.uavNotes}`} />
              </div>
            )}

            {notices.map((x, i) => (
              <div key={i} style={warnBox}>⚠ {formatNotice(x, lang)}</div>
            ))}
          </div>
        )}

        {/* ⑦ 產生航線 */}
        {sol && (
          <Section title={t.secTracks}>
            {!info?.autoRoutable ? (
              <div style={warnBox}>{t.contourNotRoutable}</div>
            ) : (
              <>
                <button className="wg-btn" style={primaryBtn} onClick={() => searchPlannerStore.generateTracks()}>
                  <Wand2 size={13} /> {t.generateTracks} ({sol.droneCount})
                </button>
                {tracks.length > 0 && (
                  <>
                    <div style={readout}>
                      {t.actualTrack} <b style={{ color: "#fef9c3" }}>{actualTrackNm.toFixed(0)} nm</b>
                      {"  ·  "}{t.perAircraft} {fmtHr(actualHr)}
                      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
                        {t.vsEstimate} {estTrackNm.toFixed(0)} nm: +{((actualTrackNm / estTrackNm - 1) * 100).toFixed(0)}%
                      </div>
                    </div>
                    {units.length > 0 && (
                      <>
                        <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 8, marginBottom: 4 }}>{t.assignTo}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {units.map((u) => {
                            const i = assigned.indexOf(u.id);
                            return (
                              <label key={u.id} style={{
                                ...checkRow,
                                border: `1px solid ${i >= 0 ? TRACK_COLORS[i % TRACK_COLORS.length] : "rgba(148,163,184,0.2)"}`,
                                borderRadius: 4, padding: "5px 8px",
                              }}>
                                <input type="checkbox" checked={i >= 0}
                                  onChange={() => searchPlannerStore.toggleAssignedUnit(u.id)} />
                                <span style={{ flex: 1 }}>{u.callsign} · {u.displayName}</span>
                                {i >= 0 && (
                                  <span style={{ fontSize: 13, color: TRACK_COLORS[i % TRACK_COLORS.length], fontWeight: 700 }}>
                                    {t.trackLabel} #{(i % tracks.length) + 1}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        <button className="wg-btn"
                          style={{ ...primaryBtn, marginTop: 8, opacity: assigned.length === 0 ? 0.45 : 1 }}
                          disabled={assigned.length === 0}
                          onClick={() => {
                            const n = searchPlannerStore.applyTracksToUnits();
                            if (n > 0 && !standalone) searchPlannerStore.setOpen(false);
                          }}>
                          <Send size={13} /> {t.applyToUnits} {assigned.length}
                        </button>
                        {assigned.length > tracks.length && (
                          <div style={warnBox}>{t.moreAssignedThanTracks}</div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </Section>
        )}

        {/* ⑥ 蒙地卡羅 */}
        {sol && (
          <Section title={t.secMonteCarlo}>
            <label style={checkRow}>
              <input type="checkbox" checked={inputs.mcEnabled}
                onChange={(e) => patch({ mcEnabled: e.target.checked })} />
              {t.mcEnable}
            </label>
            {inputs.mcEnabled && (
              <>
                <NumField label={t.mcTrials} value={inputs.mcTrials} min={200} max={20000} step={200} unit=""
                  onChange={(v) => patch({ mcTrials: v })} />
                <NumField label={t.mcDrift} value={inputs.mcDriftKn} min={0} max={8} step={0.1} unit="kn"
                  onChange={(v) => patch({ mcDriftKn: v })} />
                <label style={checkRow}>
                  <input type="checkbox" checked={inputs.mcDriftBearingDeg === null}
                    onChange={(e) => patch({ mcDriftBearingDeg: e.target.checked ? null : 90 })} />
                  {t.mcRandomBearing}
                </label>
                {inputs.mcDriftBearingDeg !== null && (
                  <NumField label={t.mcDriftBearing} value={inputs.mcDriftBearingDeg} min={0} max={359} step={5} unit="°"
                    onChange={(v) => patch({ mcDriftBearingDeg: v })} />
                )}
                <NumField label={t.mcNavError} value={inputs.mcNavErrorSigmaNm} min={0} max={3} step={0.05} unit="nm"
                  onChange={(v) => patch({ mcNavErrorSigmaNm: v })} />
                <NumField label={t.mcSensorAvail} value={Math.round(inputs.mcSensorAvailability * 100)} min={10} max={100} step={5} unit="%"
                  onChange={(v) => patch({ mcSensorAvailability: v / 100 })} />
                <Row label={t.mcDistribution}>
                  <select value={inputs.mcDistributionKind} style={select}
                    onChange={(e) => {
                      const kind = e.target.value as "uniform" | "gaussian" | "lkp" | "drift";
                      // 首次切到 LKP 且尚未輸入 → 以搜索區中心起頭
                      if (kind === "lkp" && !inputs.mcLkp && a && b) {
                        patch({ mcDistributionKind: kind, mcLkp: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
                      } else {
                        patch({ mcDistributionKind: kind });
                      }
                    }}>
                    <option value="uniform">{t.mcUniform}</option>
                    <option value="gaussian">{t.mcGaussian}</option>
                    {(!isMob || inputs.mcDistributionKind === "lkp") && <option value="lkp">{t.mcLkp}</option>}
                    {(isMob || inputs.mcDistributionKind === "drift") && (
                      <option value="drift">{lang === "en" ? "MOB drift particles (Leeway)" : "落水漂流粒子（Leeway）"}</option>
                    )}
                  </select>
                </Row>
                {inputs.mcDistributionKind === "lkp" && (
                  <LkpEditor t={t} fmtHr={fmtHr} />
                )}
                {inputs.mcDistributionKind === "drift" && (
                  <div style={{ fontSize: 13, color: driftReady ? "#fca5a5" : "#fdba74", lineHeight: 1.5 }}>
                    {driftReady
                      ? (lang === "en"
                        ? "Each trial draws one drift particle at search start and moves it with its own current + wind velocity (section ⓪)."
                        : "每次試驗抽一顆漂流粒子（搜索開始時刻），以它自己的海流＋風壓速度移動（見 ⓪）。")
                      : (lang === "en"
                        ? "No current MOB drift result; falling back to LKP + course / speed."
                        : "目前沒有可用的落水漂流結果，改用最後已知位置 + 航向航速。")}
                  </div>
                )}
                {inputs.mcDistributionKind === "gaussian" && (
                  <NumField label={t.mcSigma} value={inputs.mcSigmaNm} min={0.5} max={40} step={0.5} unit="nm"
                    onChange={(v) => patch({ mcSigmaNm: v })} />
                )}

                {tracks.length === 0 ? (
                  <div style={warnBox}>{t.mcNeedTracks}</div>
                ) : (
                  <button className="wg-btn" style={{ ...primaryBtn, marginTop: 4 }} disabled={mcBusy} onClick={runMc}>
                    <Play size={13} /> {mcBusy ? t.mcRunning : t.mcRun}
                  </button>
                )}

                {mc && (
                  <div style={{ ...resultBox, marginTop: 10, background: "rgba(34,211,238,0.06)", borderColor: "rgba(34,211,238,0.3)" }}>
                    <KV k={t.mcEmpiricalPod} v={fmtPod(mc.pod)} big highlight
                      note={`${t.mcCi} [${(mc.podCi95[0] * 100).toFixed(1)}%, ${(mc.podCi95[1] * 100).toFixed(1)}%] · ${mc.trials.toLocaleString()} ${lang === "en" ? "trials" : "次試驗"}`} />
                    <KV k={t.mcVsAnalytic}
                      v={`${(mc.pod - analyticPod) * 100 >= 0 ? "+" : ""}${((mc.pod - analyticPod) * 100).toFixed(1)} pt`}
                      note={`${lang === "en" ? "analytic" : "解析式"} ${fmtPod(analyticPod)}`} />
                    <KV k={t.mcMedianDetection}
                      v={mc.medianDetectionHr !== null ? fmtHr(mc.medianDetectionHr) : t.mcNotFound} />
                    <KV k={t.mcP90Detection}
                      v={mc.p90DetectionHr !== null ? fmtHr(mc.p90DetectionHr) : t.mcNotFound} />
                    <PodCurve data={mc.podOverTime} title={t.mcCurveTitle} hoursLabel={t.hours} />
                  </div>
                )}
              </>
            )}
          </Section>
        )}

        {/* ⑧ 目標機率分布（Stone §2） */}
        <Section title={t.secPrior}>
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.bayesEnabled}
              onChange={(e) => patch({ bayesEnabled: e.target.checked })} />
            {t.bayesEnable}
          </label>
          {inputs.bayesEnabled && (
            <>
              <NumField label={t.particleCount} value={inputs.particleCount} min={500} max={20000} step={500} unit=""
                onChange={(v) => patch({ particleCount: v })} />
              <div style={{ display: "flex", gap: 6 }}>
                <Toggle active={inputs.priorFromLkp} onClick={() => patch({ priorFromLkp: true })} label={t.priorModeLkp} />
                <Toggle active={!inputs.priorFromLkp} onClick={() => patch({ priorFromLkp: false })} label={t.priorModeScenarios} testId="prior-mode-scenarios" />
              </div>
              {inputs.priorFromLkp ? (
                <>
                  <LkpEditor t={t} fmtHr={fmtHr} shared />
                  <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                    {t.midSearchNote} → T+{midSearchElapsedHr().toFixed(1)} hr
                  </div>
                </>
              ) : (
              <>
              <NumField label={t.elapsedHr} value={inputs.elapsedHr} min={0} max={72} step={0.5} unit="hr"
                onChange={(v) => patch({ elapsedHr: v })} />
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                {t.midSearchNote} → T+{midSearchElapsedHr().toFixed(1)} hr
              </div>
              <PriorLkp t={t} />
              <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 4 }}>{t.scenarios}</div>
              {scenarios.map((sc) => (
                <div key={sc.id} style={{
                  padding: 8, borderRadius: 4, marginTop: 4,
                  background: "rgba(30,41,59,0.5)", border: "1px solid rgba(148,163,184,0.2)",
                }}>
                  <div style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 600, marginBottom: 4 }}>
                    {lang === "en" ? (sc.labelEn ?? sc.label) : sc.label}
                  </div>
                  <ScenarioLkp t={t} id={sc.id} datum={sc.datum} />
                  <MiniField label={t.scenarioWeight} value={sc.weight} min={0} max={1} step={0.05} unit=""
                    onChange={(v) => searchPlannerStore.updateScenario(sc.id, { weight: v })} />
                  <MiniField label={t.scenarioSigma} value={sc.positionSigmaNm} min={0.5} max={40} step={0.5} unit="nm"
                    onChange={(v) => searchPlannerStore.updateScenario(sc.id, { positionSigmaNm: v })} />
                  <MiniField label={t.scenarioDrift} value={sc.driftSpeedKn} min={0} max={6} step={0.1} unit="kn"
                    onChange={(v) => searchPlannerStore.updateScenario(sc.id, { driftSpeedKn: v })} />
                  <MiniField label={t.scenarioCourse} value={sc.driftCourseDeg} min={0} max={359} step={5} unit="°"
                    onChange={(v) => searchPlannerStore.updateScenario(sc.id, { driftCourseDeg: v })} />
                </div>
              ))}
              </>
              )}
              <button className="wg-btn" style={{ ...smallBtn, marginTop: 6 }}
                onClick={() => searchPlannerStore.rebuildDistribution()}>
                <RotateCcw size={12} /> {t.rebuildPrior}
              </button>
            </>
          )}
        </Section>

        {/* ⑨ 搜索歷程與停止準則（Stone §6/§7） */}
        {inputs.bayesEnabled && (
          <Section title={t.secSorties}>
            {tracks.length === 0 ? (
              <div style={warnBox}>{t.needTracksForSortie}</div>
            ) : (
              <button className="wg-btn" style={primaryBtn}
                onClick={() => searchPlannerStore.recordUnsuccessfulSortie()}>
                <Play size={13} /> {t.recordFailure}
              </button>
            )}
            {eff.sorties > 0 && (
              <>
                <div style={{ ...resultBox, marginTop: 8, marginBottom: 0 }}>
                  <KV k={t.sortieN} v={`${eff.sorties}`} />
                  <KV k={t.posThisSortie}
                    v={sortiePos.map((p) => `${(p * 100).toFixed(0)}%`).join(" → ")} />
                  <KV k={t.cumulativePos} v={fmtPod(eff.cumulativePos)} big highlight />
                  <div style={{
                    padding: "7px 9px", borderRadius: 4, fontSize: 15, lineHeight: 1.5,
                    background: eff.advice === "exhausted" ? "rgba(74,222,128,0.14)"
                      : eff.advice === "consider_stopping" ? "rgba(251,146,60,0.12)" : "rgba(30,41,59,0.6)",
                    color: eff.advice === "exhausted" ? "#bbf7d0"
                      : eff.advice === "consider_stopping" ? "#fed7aa" : "#cbd5e1",
                  }}>
                    <b>{eff.advice === "exhausted" ? t.adviceExhausted
                      : eff.advice === "consider_stopping" ? t.adviceConsider : t.adviceContinue}</b>
                    {eff.advice === "exhausted" && (
                      <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>{t.adviceExhaustedNote}</div>
                    )}
                  </div>
                </div>
                <NumField label={t.stopThreshold} value={Math.round(inputs.stopThreshold * 100)} min={50} max={99} step={1} unit="%"
                  onChange={(v) => patch({ stopThreshold: v / 100 })} />
                <button className="wg-btn" style={smallBtn}
                  onClick={() => searchPlannerStore.resetSearchHistory()}>
                  <Trash2 size={12} /> {t.resetHistory}
                </button>
              </>
            )}
          </Section>
        )}

        {/* ⑪ 突穿機率（已知船舶航經搜索區、未被發現） */}
        <Section title={t.secTransit}>
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.transitEnabled} data-testid="transit-enable"
              onChange={(e) => patch({ transitEnabled: e.target.checked })} />
            {t.transitEnable}
          </label>
          {inputs.transitEnabled && <TransitEditor t={t} fmtHr={fmtHr} />}
        </Section>

        {/* ⑩ 假目標與接觸查證（Stone §6） */}
        <Section title={t.secFalseTargets}>
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.falseTargetsEnabled}
              onChange={(e) => patch({ falseTargetsEnabled: e.target.checked })} />
            {t.falseEnable}
          </label>
          {inputs.falseTargetsEnabled && (
            <>
              <NumField label={t.falseCount} value={inputs.expectedFalseTargetsInArea} min={0} max={200} step={1} unit=""
                onChange={(v) => patch({ expectedFalseTargetsInArea: v })} />
              <NumField label={t.investigationTime} value={inputs.investigationHr} min={0} max={2} step={0.05} unit="hr"
                onChange={(v) => patch({ investigationHr: v })} />
              {contactLoad && (
                <div style={{ ...resultBox, marginTop: 8, marginBottom: 0, background: "rgba(251,146,60,0.06)", borderColor: "rgba(251,146,60,0.28)" }}>
                  <KV k={t.expectedContacts} v={contactLoad.expectedContacts.toFixed(1)} big
                    note={`${t.contactsCi} ${contactLoad.contacts95[0]}–${contactLoad.contacts95[1]}`} />
                  <KV k={t.investigationHours} v={`${contactLoad.investigationHours.toFixed(1)} hr`}
                    note={`${(contactLoad.timeShare * 100).toFixed(0)}% · ${t.worstCase} ${contactLoad.worstCaseInvestigationHours.toFixed(1)} hr`} />
                </div>
              )}
              <label style={{ ...checkRow, marginTop: 6 }}>
                <input type="checkbox" checked={inputs.densityBandsEnabled}
                  onChange={(e) => patch({ densityBandsEnabled: e.target.checked })} />
                {t.densityBands}
              </label>
              {inputs.densityBandsEnabled && (
                <>
                  <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, paddingLeft: 22 }}>
                    {t.densityBandsNote}
                  </div>
                  <div style={{ ...readout, fontSize: 15 }}>
                    {t.integratedCount}: <b style={{ color: "#fef9c3" }}>
                      {searchPlannerStore.integratedFalseTargets().toFixed(1)}
                    </b>
                  </div>
                </>
              )}

              {/* 接觸記錄 + Stone 式(5) 排序 */}
              <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 10 }}>{t.contactLog}</div>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{t.contactHint}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                <button className="wg-btn"
                  style={{ ...primaryBtn, flex: 1, borderColor: logging ? "#4ade80" : undefined,
                           background: logging ? "rgba(74,222,128,0.2)" : primaryBtn.background,
                           color: logging ? "#bbf7d0" : primaryBtn.color }}
                  onClick={() => searchPlannerStore.setLoggingContact(!logging)}>
                  <MapPin size={13} /> {logging ? t.logContactActive : t.logContact}
                </button>
                {loggedContacts.length > 0 && (
                  <button className="wg-btn" style={smallBtn}
                    onClick={() => searchPlannerStore.clearContacts()}>
                    <Trash2 size={12} /> {t.clearContacts}
                  </button>
                )}
              </div>

              {rankedContacts.length === 0 ? (
                <div style={{ ...readout, color: "#94a3b8", fontSize: 15 }}>{t.noContacts}</div>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: "#bbf7d0", fontWeight: 700, marginTop: 6 }}>
                    {t.checkFirst}
                  </div>
                  {rankedContacts.map((c) => (
                    <div key={c.id} style={{
                      display: "flex", alignItems: "center", gap: 8, marginTop: 4,
                      padding: "6px 8px", borderRadius: 4,
                      background: c.rank === 1 ? "rgba(74,222,128,0.12)" : "rgba(30,41,59,0.5)",
                      border: `1px solid ${c.rank === 1 ? "rgba(74,222,128,0.4)" : "rgba(148,163,184,0.2)"}`,
                    }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: 11, flexShrink: 0,
                        background: c.rank === 1 ? "#4ade80" : "rgba(148,163,184,0.35)",
                        color: c.rank === 1 ? "#052e16" : "#e2e8f0",
                        fontSize: 13, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{c.rank}</span>
                      <div style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#cbd5e1" }}>
                        <div>{c.lat.toFixed(3)}°N {c.lng.toFixed(3)}°E</div>
                        <div style={{ color: "#64748b" }}>
                          {t.contactP} {c.p.toExponential(1)} · {t.contactDelta} {c.delta.toFixed(3)} · p/δ {c.ratio.toFixed(4)}
                        </div>
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: c.rank === 1 ? "#4ade80" : "#e2e8f0" }}>
                        {(c.gamma * 100).toFixed(1)}%
                      </span>
                      <button className="wg-btn" style={{ ...smallBtn, padding: "2px 5px" }}
                        onClick={() => searchPlannerStore.removeContact(c.id)}>×</button>
                    </div>
                  ))}
                  <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, marginTop: 6 }}>
                    {t.rankingNote}
                  </div>
                </>
              )}

              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.55, marginTop: 6 }}>
                {t.falseTargetsNote}
              </div>
            </>
          )}
        </Section>

        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, paddingTop: 4 }}>{t.footer}</div>
      </div>
    </div>
  );
}

/** Stone §4：POD 以區間呈現（定距上界 / 標稱 / 指數下界）+ σ/W */
function BoundsRow({ t, b, fmtPod }: {
  t: ReturnType<typeof searchStrings>;
  b: { upper: number; nominal: number; lower: number; sigmaOverW: number; sweepWidthUncertain: boolean };
  fmtPod: (p: number) => string;
}) {
  return (
    <div style={{
      marginTop: -2, marginBottom: 8, padding: "7px 9px", borderRadius: 4,
      background: "rgba(30,41,59,0.5)", fontSize: 14, lineHeight: 1.6,
    }}>
      <div style={{ color: "#94a3b8" }}>{t.podRange}</div>
      <div style={{ fontFamily: "ui-monospace, monospace", color: "#e2e8f0" }}>
        {fmtPod(b.lower)} <span style={{ color: "#64748b" }}>({t.podLower})</span>
        {"  …  "}
        {fmtPod(b.upper)} <span style={{ color: "#64748b" }}>({t.podUpper})</span>
      </div>
      <div style={{ color: "#94a3b8", marginTop: 3 }}>
        {t.sigmaOverW} = {b.sigmaOverW.toFixed(2)} → {t.podNominal} <b style={{ color: "#e2e8f0" }}>{fmtPod(b.nominal)}</b>
      </div>
      <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>{t.sigmaOverWNote}</div>
      <div style={{ color: "#64748b", fontSize: 13 }}>{t.eInvFloor}</div>
      {b.sweepWidthUncertain && (
        <div style={{ color: "#64748b", fontSize: 13 }}>{t.sweepUncertainOn}</div>
      )}
    </div>
  );
}

// ── POD 隨時間累積曲線（inline SVG，不引外部圖表庫）─────────
function PodCurve({ data, title, hoursLabel }: {
  data: [number, number][]; title: string; hoursLabel: string;
}) {
  if (data.length < 2) return null;
  const w = 380, h = 110, padL = 34, padB = 20, padT = 8, padR = 8;
  const maxHr = data[data.length - 1]?.[0] ?? 1;
  const x = (hr: number) => padL + (hr / maxHr) * (w - padL - padR);
  const y = (p: number) => padT + (1 - p) * (h - padT - padB);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d[0]).toFixed(1)},${y(d[1]).toFixed(1)}`).join(" ");
  const area = `${path} L${x(maxHr).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 4 }}>{title}</div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }} role="img" aria-label={title}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={padL} y1={y(p)} x2={w - padR} y2={y(p)} stroke="rgba(148,163,184,0.18)" strokeWidth={1} />
            <text x={padL - 5} y={y(p) + 3.5} textAnchor="end" fontSize={9} fill="#64748b">{p * 100}%</text>
          </g>
        ))}
        <path d={area} fill="rgba(34,211,238,0.15)" />
        <path d={path} fill="none" stroke="#22d3ee" strokeWidth={1.8} />
        <text x={padL} y={h - 5} fontSize={9} fill="#64748b">0</text>
        <text x={w - padR} y={h - 5} textAnchor="end" fontSize={9} fill="#64748b">
          {maxHr.toFixed(1)} {hoursLabel}
        </text>
      </svg>
    </div>
  );
}

// ── 小元件 ────────────────────────────────────────────────
/** 一個座標分量的輸入欄（度 / 分 / 秒以字串保存，允許輸入中途的不完整值） */
interface DmsText { d: string; m: string; s: string; neg: boolean }
interface VertexText { lng: DmsText; lat: DmsText }

const EMPTY_DMS: DmsText = { d: "", m: "", s: "", neg: false };
const emptyVertex = (): VertexText => ({ lng: { ...EMPTY_DMS }, lat: { ...EMPTY_DMS } });

function dmsTextFrom(value: number): DmsText {
  const x = decimalToDms(value);
  return { d: String(x.deg), m: String(x.min), s: x.sec.toFixed(DMS_SEC_DECIMALS), neg: x.neg };
}
const vertexFrom = ([lng, lat]: LngLat): VertexText => ({ lng: dmsTextFrom(lng), lat: dmsTextFrom(lat) });

const isBlank = (x: DmsText) => x.d.trim() === "" && x.m.trim() === "" && x.s.trim() === "";

/** 欄位 → 十進位度；分、秒空白視為 0。不合法回 null */
function dmsTextToDecimal(x: DmsText, axis: CoordAxis): number | null {
  if (x.d.trim() === "") return null;
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const dms = { deg: num(x.d), min: num(x.m), sec: num(x.s), neg: x.neg };
  return validateDms(dms, axis) ? null : dmsToDecimal(dms);
}

/**
 * 手動輸入多邊形頂點（3–10 點）建立搜索區 —— 以度分秒（60 進位）輸入。
 * 欄位以字串保存，允許輸入過程中出現暫時不合法的值；
 * 按「建立搜索區」時才解析並交給 store 驗證（自相交、面積 0 等）。
 */
const ORDER_KEY = "wg-search-coord-order";
function loadOrder(): CoordOrder {
  try { return localStorage.getItem(ORDER_KEY) === "latlng" ? "latlng" : "lnglat"; } catch { return "lnglat"; }
}

/**
 * 座標書寫順序（經度在前 / 緯度在前）—— 多邊形頂點與所有 LKP 欄位共用，
 * 在任一處切換，其他輸入列同步改排列。
 */
let coordOrder: CoordOrder = loadOrder();
const orderListeners = new Set<() => void>();
const coordOrderStore = {
  get: () => coordOrder,
  set(o: CoordOrder): void {
    if (coordOrder === o) return;
    coordOrder = o;
    try { localStorage.setItem(ORDER_KEY, o); } catch { /* 只是不記住 */ }
    for (const cb of orderListeners) cb();
  },
  subscribe(cb: () => void): () => void {
    orderListeners.add(cb);
    return () => { orderListeners.delete(cb); };
  },
};
function useCoordOrder(): CoordOrder {
  return useSyncExternalStore(coordOrderStore.subscribe, coordOrderStore.get, coordOrderStore.get);
}

/** 觸發瀏覽器下載文字檔 */
function downloadText(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PolygonEditor({ t, polygon, corners }: {
  t: SearchStrings; polygon: LngLat[] | null; corners: [LngLat, LngLat] | null;
}) {
  const initial = (): VertexText[] => {
    if (polygon) return polygon.map(vertexFrom);
    if (corners) {
      // 以目前框的四角起頭，方便在其上修改
      const [[x1, y1], [x2, y2]] = corners;
      const w = Math.min(x1, x2), e = Math.max(x1, x2), s = Math.min(y1, y2), n = Math.max(y1, y2);
      return ([[w, s], [e, s], [e, n], [w, n]] as LngLat[]).map(vertexFrom);
    }
    return [emptyVertex(), emptyVertex(), emptyVertex()];
  };
  const [rows, setRows] = useState<VertexText[]>(initial);
  const [error, setError] = useState<string | null>(null);
  /** 成功訊息（排序 / 匯入結果） */
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  /** 座標書寫順序：決定輸入列排列、貼上 / 匯入純數字的解讀、CSV 匯出欄位順序 */
  const order = useCoordOrder();
  const fileRef = useRef<HTMLInputElement>(null);

  const setOrder = (o: CoordOrder) => coordOrderStore.set(o);
  const say = (err: string | null, ok: string | null = null) => { setError(err); setNotice(ok); };

  const setPart = (i: number, axis: CoordAxis, p: Partial<DmsText>) => {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, [axis]: { ...r[axis], ...p } } : r)));
    say(null);
  };
  const removeRow = (i: number) => { setRows((rs) => rs.filter((_, k) => k !== i)); say(null); };
  /** 與相鄰頂點互換位置（dir = -1 上移、+1 下移） */
  const moveRow = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    setRows((rs) => {
      const next = [...rs];
      const a = next[i], b = next[j];
      if (!a || !b) return rs;
      next[i] = b; next[j] = a;
      return next;
    });
    say(null);
  };
  const addRow = () => {
    if (rows.length >= MAX_POLYGON_VERTICES) return;
    setRows((rs) => [...rs, emptyVertex()]);
  };

  /** 目前欄位 → 頂點（全空列略過）；有不合法欄位回 null 並顯示錯誤 */
  const readPoints = (): LngLat[] | null => {
    const filled = rows.filter((r) => !isBlank(r.lng) || !isBlank(r.lat));
    const pts: LngLat[] = [];
    for (const r of filled) {
      const lng = dmsTextToDecimal(r.lng, "lng");
      const lat = dmsTextToDecimal(r.lat, "lat");
      if (lng === null || lat === null) { say(t.polyIssue.invalid_coord); return null; }
      pts.push([lng, lat]);
    }
    return pts;
  };

  const draw = (pts: LngLat[], ok: string | null = null) => {
    const issue = searchPlannerStore.setPolygon(pts);
    say(issue ? t.polyIssue[issue] : null, issue ? null : ok);
  };

  const apply = () => {
    const pts = readPoints();
    if (pts) draw(pts);
  };

  /** 依繞中心的方位重新排序（修正邊線交叉）並直接繪製 */
  const autoSort = () => {
    const pts = readPoints();
    if (!pts) return;
    if (pts.length < 3) { say(t.polyIssue.too_few); return; }
    const already = isAngleSorted(pts);
    const sorted = already ? pts : sortVerticesByAngle(pts);
    if (!already) setRows(sorted.map(vertexFrom));
    draw(sorted, already ? t.polyAlreadySorted : t.polySorted);
  };

  /** 解析貼上的文字：每行一點，度分秒或十進位度皆可（見 parseLngLatLine） */
  const loadPaste = () => {
    const parsed: VertexText[] = [];
    for (const line of pasteText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const pt = parseLngLatLine(line, order);
      if (!pt) { say(t.polyIssue.parse_failed); return; }
      parsed.push(vertexFrom(pt));
    }
    if (parsed.length > MAX_POLYGON_VERTICES) { say(t.polyIssue.too_many); return; }
    if (parsed.length === 0) { say(t.polyIssue.parse_failed); return; }
    setRows(parsed);
    setPasteOpen(false);
    say(null);
  };

  /** 匯入檔案（CSV / TXT / GeoJSON / KML）→ 填入欄位並繪製 */
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importPolygon(String(reader.result ?? ""), order);
      if (typeof r === "string") { say(t.polyIssue[r]); return; }
      setRows(r.points.map(vertexFrom));
      draw(r.points, t.polyImported
        .replace("{n}", String(r.points.length))
        .replace("{fmt}", r.format === "text" ? "TXT" : r.format === "geojson" ? "GeoJSON" : r.format.toUpperCase()));
    };
    reader.onerror = () => say(t.polyIssue.parse_failed);
    reader.readAsText(file);
  };

  const doExport = (format: ExportFormat) => {
    const pts = readPoints();
    if (!pts) return;
    if (pts.length < 3) { say(t.polyIssue.too_few); return; }
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    downloadText(`search-area-${stamp}.${format}`, EXPORT_MIME[format], exportPolygon(pts, format, order));
    setExportOpen(false);
    say(null);
  };

  const dmsLine = (i: number, axis: CoordAxis, x: DmsText) => (
    <DmsFields t={t} axis={axis} value={x} onChange={(p) => setPart(i, axis, p)} />
  );
  const axes: CoordAxis[] = order === "lnglat" ? ["lng", "lat"] : ["lat", "lng"];
  const arrowBtn: React.CSSProperties = { ...smallBtn, padding: "1px 4px", fontSize: 11, lineHeight: 1 };
  const orderBtn = (o: CoordOrder, label: string) => (
    <button className="wg-btn" onClick={() => setOrder(o)} style={{
      ...smallBtn, flex: 1, justifyContent: "center",
      ...(order === o ? { borderColor: "#facc15", color: "#fef9c3", background: "rgba(250,204,21,0.15)", fontWeight: 700 } : {}),
    }}>{label}</button>
  );

  return (
    <div style={{
      marginTop: 6, padding: "8px 9px", borderRadius: 4,
      background: "rgba(30,41,59,0.5)", border: "1px solid rgba(148,163,184,0.2)",
    }}>
      <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 6 }}>{t.polyHint}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {orderBtn("lnglat", t.polyOrderLngLat)}
        {orderBtn("latlng", t.polyOrderLatLng)}
      </div>
      <div style={{ display: "flex", gap: 5, fontSize: 12, color: "#64748b", marginBottom: 3, paddingLeft: 61, paddingRight: 88 }}>
        <span style={{ flex: 1 }}>{t.polyDeg}</span>
        <span style={{ flex: 1 }}>{t.polyMin}</span>
        <span style={{ flex: 1 }}>{t.polySec}</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: "flex", gap: 6, alignItems: "center", marginBottom: 5, paddingBottom: 5,
          borderBottom: i < rows.length - 1 ? "1px dashed rgba(148,163,184,0.15)" : "none",
        }}>
          <span style={{ width: 16, fontSize: 13, color: "#94a3b8", textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            {axes.map((ax) => <div key={ax}>{dmsLine(i, ax, r[ax])}</div>)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <button className="wg-btn" style={{ ...arrowBtn, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0}
              onClick={() => moveRow(i, -1)} title={t.polyMoveUp} aria-label={t.polyMoveUp}><ChevronUp size={12} /></button>
            <button className="wg-btn" style={{ ...arrowBtn, opacity: i === rows.length - 1 ? 0.3 : 1 }} disabled={i === rows.length - 1}
              onClick={() => moveRow(i, 1)} title={t.polyMoveDown} aria-label={t.polyMoveDown}><ChevronDown size={12} /></button>
          </div>
          <button className="wg-btn" style={{ ...smallBtn, padding: "4px 6px" }}
            onClick={() => removeRow(i)} disabled={rows.length <= 1} aria-label="remove">
            <X size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <button className="wg-btn" style={{ ...smallBtn, opacity: rows.length >= MAX_POLYGON_VERTICES ? 0.4 : 1 }}
          onClick={addRow} disabled={rows.length >= MAX_POLYGON_VERTICES}>
          <Plus size={12} /> {t.polyAddPoint} ({rows.length}/{MAX_POLYGON_VERTICES})
        </button>
        <button className="wg-btn" style={smallBtn} onClick={() => setPasteOpen((v) => !v)}>
          <ClipboardPaste size={12} /> {t.polyPaste}
        </button>
        <button className="wg-btn" style={smallBtn} onClick={() => fileRef.current?.click()}>
          <Upload size={12} /> {t.polyImport}
        </button>
        <button className="wg-btn" style={{ ...smallBtn, ...(exportOpen ? { borderColor: "#facc15", color: "#fef9c3" } : {}) }}
          onClick={() => setExportOpen((v) => !v)}>
          <Download size={12} /> {t.polyExport}
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt,.json,.geojson,.kml,text/csv,text/plain,application/json,application/geo+json,application/vnd.google-earth.kml+xml"
          style={{ display: "none" }}
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {exportOpen && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {(["csv", "geojson", "kml"] as ExportFormat[]).map((f) => (
            <button key={f} className="wg-btn" style={{ ...smallBtn, flex: 1, justifyContent: "center" }} onClick={() => doExport(f)}>
              {f === "geojson" ? "GeoJSON" : f.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {pasteOpen && (
        <div style={{ marginTop: 6 }}>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            placeholder={t.polyPastePlaceholder} rows={5}
            style={{ ...numInput, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
          <button className="wg-btn" style={{ ...smallBtn, marginTop: 4 }} onClick={loadPaste}>{t.polyParse}</button>
        </div>
      )}
      {error && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 6 }}>{error}</div>}
      {notice && <div style={{ color: "#86efac", fontSize: 13, marginTop: 6 }}>{notice}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="wg-btn" style={{ ...primaryBtn, flex: 1 }} onClick={apply}>
          <Hexagon size={13} /> {t.polyApply}
        </button>
        <button className="wg-btn" style={{ ...smallBtn, justifyContent: "center", padding: "6px 10px", fontSize: 14 }} onClick={autoSort}>
          <ArrowDownUp size={13} /> {t.polyAutoSort}
        </button>
      </div>
    </div>
  );
}

/** 一個座標分量的 度 / 分 / 秒 + 半球 輸入列（多邊形頂點與 LKP 共用） */
function DmsFields({ t, axis, value: x, onChange }: {
  t: SearchStrings; axis: CoordAxis; value: DmsText; onChange: (p: Partial<DmsText>) => void;
}) {
  const cellInput: React.CSSProperties = { ...numInput, flex: 1, width: "auto", minWidth: 0, padding: "4px 5px" };
  const unit: React.CSSProperties = { fontSize: 14, color: "#94a3b8", marginLeft: -3 };
  const hemi = axis === "lng" ? (x.neg ? "W" : "E") : (x.neg ? "S" : "N");
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <span style={{ width: 34, fontSize: 13, color: "#94a3b8", flexShrink: 0 }}>
        {axis === "lng" ? t.polyLng : t.polyLat}
      </span>
      <input style={cellInput} inputMode="numeric" value={x.d} placeholder={axis === "lng" ? "119" : "23"}
        aria-label={`${axis} ${t.polyDeg}`} onChange={(e) => onChange({ d: e.target.value })} />
      <span style={unit}>°</span>
      <input style={cellInput} inputMode="numeric" value={x.m} placeholder="0"
        aria-label={`${axis} ${t.polyMin}`} onChange={(e) => onChange({ m: e.target.value })} />
      <span style={unit}>′</span>
      <input style={cellInput} inputMode="decimal" value={x.s} placeholder="0"
        aria-label={`${axis} ${t.polySec}`} onChange={(e) => onChange({ s: e.target.value })} />
      <span style={unit}>″</span>
      <button className="wg-btn" title={t.polyHemiToggle}
        style={{ ...smallBtn, padding: "3px 0", width: 26, justifyContent: "center", fontFamily: "ui-monospace, monospace" }}
        onClick={() => onChange({ neg: !x.neg })}>{hemi}</button>
    </div>
  );
}

/**
 * 一組 LKP 輸入：度分秒（依共用的經緯順序排列）+ 設定 / 地圖點選 / 搜索區中心 + 額外按鈕。
 * 由父層以目前值當 key —— 值從外部改變（地圖點選、帶入）時重掛，欄位跟著同步。
 */
function LkpInput({ t, title, value, onApply, pickTarget, extra, accent = "#38bdf8", unsetText }: {
  t: SearchStrings;
  title?: string;
  /** value 為 null 時顯示的文字；預設「尚未設定」 */
  unsetText?: string;
  value: LngLat | null;
  onApply: (p: LngLat) => void;
  pickTarget: LkpPickTarget;
  /** 額外按鈕（例：帶入另一處的 LKP） */
  extra?: React.ReactNode;
  accent?: string;
}) {
  const order = useCoordOrder();
  const pick = searchPlannerStore.getLkpPickTarget();
  const picking = pick !== null && JSON.stringify(pick) === JSON.stringify(pickTarget);
  const [lng, setLng] = useState<DmsText>(() => (value ? dmsTextFrom(value[0]) : { ...EMPTY_DMS }));
  const [lat, setLat] = useState<DmsText>(() => (value ? dmsTextFrom(value[1]) : { ...EMPTY_DMS }));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const x = dmsTextToDecimal(lng, "lng"), y = dmsTextToDecimal(lat, "lat");
    if (x === null || y === null) { setError(t.polyIssue.invalid_coord); return; }
    setError(null);
    onApply([x, y]);
  };
  const useCentre = () => {
    const { a, b } = searchPlannerStore.getCorners();
    if (!a || !b) return;
    onApply([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  };
  const field = (axis: CoordAxis) => axis === "lng"
    ? <DmsFields key="lng" t={t} axis="lng" value={lng} onChange={(p) => { setLng((v) => ({ ...v, ...p })); setError(null); }} />
    : <DmsFields key="lat" t={t} axis="lat" value={lat} onChange={(p) => { setLat((v) => ({ ...v, ...p })); setError(null); }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {title && <div style={{ fontSize: 14, fontWeight: 600, color: accent }}>{title}</div>}
      {(order === "lnglat" ? ["lng", "lat"] as const : ["lat", "lng"] as const).map(field)}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="wg-btn" style={smallBtn} onClick={apply}><MapPin size={12} /> {t.lkpApply}</button>
        <button className="wg-btn" style={{ ...smallBtn, ...(picking ? { borderColor: accent, color: "#e0f2fe" } : {}) }}
          onClick={() => searchPlannerStore.setPickingLkp(picking ? null : pickTarget)}>
          <Crosshair size={12} /> {picking ? t.lkpPicking : t.lkpPickOnMap}
        </button>
        <button className="wg-btn" style={smallBtn} onClick={useCentre}>{t.lkpUseCentre}</button>
        {extra}
      </div>
      {error && <div style={{ color: "#fca5a5", fontSize: 13 }}>{error}</div>}
      <div style={{ fontSize: 13, color: value ? "#e2e8f0" : "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
        LKP: {value ? fmtLngLat(value, order) : (unsetText ?? t.lkpUnset)}
      </div>
    </div>
  );
}

/** 事前分布：所有情境共用的 LKP（套用後各情境的基準點都改成這一點） */
function PriorLkp({ t }: { t: SearchStrings }) {
  const inputs = searchPlannerStore.getInputs();
  const scenarios = searchPlannerStore.getScenarios();
  // 所有情境基準點相同時顯示該點，否則顯示「各情境不同」
  const first = scenarios[0]?.datum ?? null;
  const shared = first && scenarios.every((x) => x.datum[0] === first[0] && x.datum[1] === first[1]) ? first : null;
  const mcLkp = inputs.mcLkp;
  return (
    <div style={{
      padding: "7px 9px", borderRadius: 4, marginTop: 4,
      background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.3)",
    }}>
      <LkpInput key={JSON.stringify(shared)} t={t} title={t.priorLkpTitle} accent="#fdba74"
        value={shared} unsetText={t.priorLkpDiffer}
        onApply={(p) => searchPlannerStore.setAllScenarioDatums(p)} pickTarget={{ kind: "priorAll" }}
        extra={mcLkp && (
          <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.setAllScenarioDatums(mcLkp)}>
            {t.lkpFromMc}
          </button>
        )} />
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, marginTop: 3 }}>{t.priorLkpNote}</div>
    </div>
  );
}

/** 單一情境的 LKP：平常只顯示一行，按「修改」展開完整輸入 */
function ScenarioLkp({ t, id, datum }: { t: SearchStrings; id: string; datum: LngLat }) {
  const order = useCoordOrder();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <span style={{ color: "#94a3b8", width: 36, flexShrink: 0 }}>LKP</span>
        <span style={{ flex: 1, minWidth: 0, color: "#fdba74", fontFamily: "ui-monospace, monospace" }}>
          {fmtLngLat(datum, order)}
        </span>
        <button className="wg-btn" style={{ ...smallBtn, padding: "2px 7px", fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
          {open ? t.close : t.lkpEdit}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 4 }}>
          <LkpInput key={JSON.stringify(datum)} t={t} accent="#fdba74"
            value={datum} onApply={(p) => searchPlannerStore.updateScenario(id, { datum: p })}
            pickTarget={{ kind: "scenario", id }} />
        </div>
      )}
    </div>
  );
}

/** 突穿機率：船舶回報位置 / 航向航速 + 執行與結果 */
function TransitEditor({ t, fmtHr }: { t: SearchStrings; fmtHr: (h: number) => string }) {
  const inputs = searchPlannerStore.getInputs();
  const patch = searchPlannerStore.patch.bind(searchPlannerStore);
  const tracks = searchPlannerStore.getTracks();
  const r = searchPlannerStore.getTransitResult();
  const proj = transitProjection();
  const ship = transitShip();
  const linked = inputs.transitLinkLkp;
  const order = useCoordOrder();
  const lang = useLang() === "en" ? "en" : "zh";
  const [busy, setBusy] = useState(false);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const ci = (c: [number, number]) => `95% CI [${(c[0] * 100).toFixed(1)}%, ${(c[1] * 100).toFixed(1)}%]`;
  const run = () => {
    setBusy(true);
    setTimeout(() => { searchPlannerStore.runTransit(); setBusy(false); }, 20);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={checkRow}>
        <input type="checkbox" checked={linked} data-testid="transit-link"
          onChange={(e) => patch({ transitLinkLkp: e.target.checked })} />
        {lang === "en" ? "Use the LKP and course / speed from section ⓪" : "沿用 ⓪ 的最後已知位置與航向航速"}
      </label>
      {linked ? (
        <div data-testid="transit-linked-summary" style={{
          padding: "7px 9px", borderRadius: 4, fontSize: 13, lineHeight: 1.6, color: "#cbd5e1",
          background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.3)",
        }}>
          {ship ? (
            <>
              <div style={{ fontFamily: "ui-monospace, monospace", color: "#fca5a5" }}>LKP: {fmtLngLat(ship.position, order)} ± {ship.sigmaNm} nm</div>
              <div>{t.targetCourse} {ship.courseDeg}° ± {ship.courseSigmaDeg}° · {t.targetSpeed} {ship.speedKn} ± {ship.speedSigmaKn} kn</div>
              <div>{t.transitReportToStart} {fmtHr(ship.reportToStartHr)}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {lang === "en"
                  ? "Edit these in section ⓪; untick to enter a different ship (starts from these values)."
                  : "在 ⓪ 修改；取消勾選可另外輸入別艘船（以這組值起頭）。"}
              </div>
            </>
          ) : (
            <span style={{ color: "#fed7aa" }}>
              {lang === "en" ? "No LKP yet: mark it in section ⓪ first." : "尚未設定最後已知位置：先在 ⓪ 標定。"}
            </span>
          )}
        </div>
      ) : (
        <>
          <div style={{
            padding: "7px 9px", borderRadius: 4,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.3)",
          }}>
            <LkpInput key={JSON.stringify(inputs.transitPos)} t={t} title={t.transitShipPos} accent="#fca5a5"
              value={inputs.transitPos} onApply={(p) => patch({ transitPos: p })} pickTarget={{ kind: "transit" }} />
          </div>
          <NumField label={t.transitReportToStart} value={inputs.transitReportToStartHr} min={0} max={48} step={0.25} unit="hr"
            onChange={(v) => patch({ transitReportToStartHr: v })} />
          <NumField label={t.lkpSigma} value={inputs.transitSigmaNm} min={0} max={20} step={0.5} unit="nm"
            onChange={(v) => patch({ transitSigmaNm: v })} />
          <NumField label={t.targetCourse} value={inputs.transitCourseDeg} min={0} max={359} step={1} unit="°"
            onChange={(v) => patch({ transitCourseDeg: v })} />
          <NumField label={t.targetCourseSigma} value={inputs.transitCourseSigmaDeg} min={0} max={90} step={1} unit="°"
            onChange={(v) => patch({ transitCourseSigmaDeg: v })} />
          <NumField label={t.targetSpeed} value={inputs.transitSpeedKn} min={0} max={40} step={0.5} unit="kn"
            onChange={(v) => patch({ transitSpeedKn: v })} />
          <NumField label={t.targetSpeedSigma} value={inputs.transitSpeedSigmaKn} min={0} max={10} step={0.1} unit="kn"
            onChange={(v) => patch({ transitSpeedSigmaKn: v })} />
        </>
      )}

      {proj && (
        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.55 }}>
          {proj.entryHr !== null
            ? <>{t.transitNominalEntry} {fmtSignedHr(proj.entryHr, fmtHr, t)}
              {proj.exitHr !== null && <> · {t.transitNominalExit} {fmtSignedHr(proj.exitHr, fmtHr, t)}</>}</>
            : <span style={{ color: "#fed7aa" }}>{t.transitNominalMiss}</span>}
        </div>
      )}

      {tracks.length === 0 ? (
        <div style={warnBox}>{t.mcNeedTracks}</div>
      ) : !ship ? (
        <div style={warnBox}>{t.transitNeedPos}</div>
      ) : (
        <button className="wg-btn" style={{ ...primaryBtn, marginTop: 4 }} disabled={busy} onClick={run}>
          <Play size={13} /> {busy ? t.mcRunning : t.transitRun}
        </button>
      )}

      {r && (
        <div style={{ ...resultBox, marginTop: 6, marginBottom: 0, background: "rgba(248,113,113,0.06)", borderColor: "rgba(248,113,113,0.3)" }}>
          <KV k={t.transitPen} v={pct(r.pPenetrated)} big note={ci(r.pPenetratedCi95)} />
          <KV k={t.transitPenGivenEnter} v={pct(r.pPenetratedGivenEnter)} note={`${ci(r.pPenetratedGivenEnterCi95)} · ${t.transitPenGivenEnterNote}`} />
          <KV k={t.transitDetected} v={pct(r.pDetected)} highlight />
          <KV k={t.transitEnter} v={pct(r.pEnter)}
            note={r.medianEntryHr !== null ? `${t.transitMedianEntry} ${fmtSignedHr(r.medianEntryHr, fmtHr, t)}` : undefined} />
          {r.pMissed > 0 && <KV k={t.transitMissed} v={pct(r.pMissed)} />}
          {r.pLoiter > 0 && <KV k={t.transitLoiter} v={pct(r.pLoiter)} />}
          {r.pPenetrated > 0 && (
            <KV k={t.transitTiming} wrap
              v={`${t.transitBefore} ${pct(r.penetratedBeforeSearch)} · ${t.transitDuring} ${pct(r.penetratedDuringSearch)} · ${t.transitAfter} ${pct(r.penetratedAfterSearch)}`}
              note={`${t.transitSearchDuration} ${fmtHr(r.searchDurationHr)}`} />
          )}
          {r.penetratedAfterSearch + r.penetratedBeforeSearch > 0.5 * r.pPenetrated && r.pPenetrated > 0.05 && (
            <div style={{ ...warnBox, marginTop: 4 }}>{t.transitTimingWarn}</div>
          )}
        </div>
      )}
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{t.transitNote}</div>
    </div>
  );
}

/** 相對搜索開始的時刻：負值顯示「搜索前 x」 */
function fmtSignedHr(h: number, fmtHr: (h: number) => string, t: SearchStrings): string {
  return h < 0 ? `${t.transitBeforeStart} ${fmtHr(-h)}` : `T+${fmtHr(h)}`;
}

/** 依共用經緯順序顯示一點的度分秒 */
function fmtLngLat(p: LngLat, order: CoordOrder): string {
  const lng = formatDms(p[0], "lng"), lat = formatDms(p[1], "lat");
  return order === "lnglat" ? `${lng} ${lat}` : `${lat} ${lng}`;
}

/**
 * 蒙地卡羅「最後已知位置」輸入：LKP（度分秒 / 點地圖 / 搜索區中心 / 帶入事前分布）+ 目標航向航速。
 */
/**
 * @param shared 顯示「與事前分布 / 蒙地卡羅共用」提示（依 LKP 建事前分布時，兩處編輯同一組參數）
 */
function LkpEditor({ t, fmtHr, shared = false }: { t: SearchStrings; fmtHr: (h: number) => string; shared?: boolean }) {
  const inputs = searchPlannerStore.getInputs();
  const patch = searchPlannerStore.patch.bind(searchPlannerStore);
  const order = useCoordOrder();
  const proj = lkpProjection();
  // 事前分布用多情境時才需要「帶入」；依 LKP 時兩邊本來就是同一組參數
  const priorDatum = inputs.bayesEnabled && !inputs.priorFromLkp ? searchPlannerStore.primaryScenarioDatum() : null;
  const linked = shared || (inputs.bayesEnabled && inputs.priorFromLkp);
  // 搜索對象為落水人員 → 目標隨海流＋風漂流，不用航向航速（參數在 ⓪）
  const leeway = inputs.driftModel === "leeway";
  const lang = useLang() === "en" ? "en" : "zh";

  return (
    <div style={{
      padding: "7px 9px", borderRadius: 4, display: "flex", flexDirection: "column", gap: 4,
      background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.3)",
    }}>
      <LkpInput key={JSON.stringify(inputs.mcLkp)} t={t} title={t.lkpTitle}
        value={inputs.mcLkp} onApply={(p) => patch({ mcLkp: p })} pickTarget={{ kind: "mc" }}
        extra={priorDatum && (
          <button className="wg-btn" style={smallBtn} title={t.lkpFromPriorNote}
            onClick={() => patch({ mcLkp: [priorDatum[0], priorDatum[1]] })}>{t.lkpFromPrior}</button>
        )} />
      {linked && <div style={{ fontSize: 12, color: "#7dd3fc", lineHeight: 1.5 }}>{t.lkpSharedNote}</div>}

      <NumField label={t.lkpSigma} value={inputs.mcSigmaNm} min={0} max={40} step={0.5} unit="nm"
        onChange={(v) => patch({ mcSigmaNm: v })} />
      <NumField label={t.lkpElapsed} value={inputs.mcLkpElapsedHr} min={0} max={72} step={0.25} unit="hr"
        onChange={(v) => patch({ mcLkpElapsedHr: v })} />
      {leeway ? (
        <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.5 }}>
          {lang === "en"
            ? "Using MOB Leeway drift (section ⓪): the target moves with forecast current + wind, not a course / speed."
            : "目前使用落水 Leeway 漂流（見 ⓪）：目標隨海流＋風場移動，不用航向 / 航速。"}
          <button className="wg-btn" data-testid="lkp-use-course"
            style={{ ...smallBtn, marginTop: 6, color: "#e2e8f0" }}
            onClick={() => searchPlannerStore.setTargetType("vessel")}>
            {lang === "en" ? "Switch search object to vessel / fleet" : "搜索對象改為船舶 / 船團"}
          </button>
        </div>
      ) : (
      <>
        <NumField label={t.targetCourse} value={inputs.mcTargetCourseDeg} min={0} max={359} step={1} unit="°"
          onChange={(v) => patch({ mcTargetCourseDeg: v })} />
        <NumField label={t.targetCourseSigma} value={inputs.mcTargetCourseSigmaDeg} min={0} max={180} step={1} unit="°"
          onChange={(v) => patch({ mcTargetCourseSigmaDeg: v })} />
        <NumField label={t.targetSpeed} value={inputs.mcTargetSpeedKn} min={0} max={40} step={0.5} unit="kn"
          onChange={(v) => patch({ mcTargetSpeedKn: v })} />
        <NumField label={t.targetSpeedSigma} value={inputs.mcTargetSpeedSigmaKn} min={0} max={10} step={0.1} unit="kn"
          onChange={(v) => patch({ mcTargetSpeedSigmaKn: v })} />

        {proj && (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "#cbd5e1", marginTop: 2 }}>
            <div>
              {t.lkpAtStart}（+{fmtHr(inputs.mcLkpElapsedHr)}）:{" "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {fmtLngLat(proj.atStart, order)}
              </span>
              {" · "}{(inputs.mcTargetSpeedKn * inputs.mcLkpElapsedHr).toFixed(1)} nm
            </div>
            {proj.atEnd && (
              <div>
                {t.lkpAtEnd}:{" "}
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {fmtLngLat(proj.atEnd, order)}
                </span>
              </div>
            )}
            {proj.insideAtStart === false && <div style={{ ...warnBox, marginTop: 4 }}>{t.lkpOutside}</div>}
          </div>
        )}
      </>
      )}
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{t.lkpNote}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: "1px solid rgba(148,163,184,0.15)", paddingBottom: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 15, color: "#94a3b8", width: 132, flexShrink: 0, lineHeight: 1.3 }}>{label}</span>
      {children}
    </div>
  );
}

function NumField(props: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={props.label}>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#facc15", minWidth: 0 }} />
      <input type="number" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} style={numInput} />
      <span style={{ fontSize: 14, color: "#94a3b8", width: 24 }}>{props.unit}</span>
    </Row>
  );
}

/** 情境參數用的緊湊數字列 */
function MiniField(props: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
      <span style={{ fontSize: 13, color: "#94a3b8", width: 84, flexShrink: 0 }}>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#4ade80", minWidth: 0 }} />
      <span style={{
        fontSize: 13, color: "#e2e8f0", width: 52, textAlign: "right",
        fontFamily: "ui-monospace, monospace",
      }}>{props.value}{props.unit}</span>
    </div>
  );
}

function Toggle({ active, onClick, label, testId }: { active: boolean; onClick: () => void; label: string; testId?: string }) {
  return (
    <button onClick={onClick} className="wg-btn" data-testid={testId} style={{
      flex: 1, padding: "7px 8px", borderRadius: 4, fontSize: 15, cursor: "pointer",
      fontFamily: "inherit", fontWeight: active ? 700 : 400, lineHeight: 1.3,
      border: `1px solid ${active ? "#facc15" : "rgba(148,163,184,0.25)"}`,
      background: active ? "rgba(250,204,21,0.18)" : "rgba(30,41,59,0.4)",
      color: active ? "#fef9c3" : "#cbd5e1",
    }}>{label}</button>
  );
}

function KV({ k, v, note, big, highlight, wrap }: {
  k: string; v: string; note?: string; big?: boolean; highlight?: boolean; wrap?: boolean;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: wrap ? "column" : "row", gap: wrap ? 2 : 8,
      marginBottom: 6, alignItems: wrap ? "flex-start" : "baseline",
    }}>
      <span style={{ fontSize: 15, color: "#94a3b8", width: wrap ? "auto" : 138, flexShrink: 0, lineHeight: 1.3 }}>{k}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: big ? 21 : 17, fontWeight: big ? 700 : 500,
          color: highlight ? "#4ade80" : "#e2e8f0",
          fontFamily: wrap ? "inherit" : "ui-monospace, monospace",
          lineHeight: 1.4,
        }}>{v}</div>
        {note && <div style={{ fontSize: 13, color: "#64748b", marginTop: 1, lineHeight: 1.45 }}>{note}</div>}
      </div>
    </div>
  );
}

function PatRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 14, lineHeight: 1.5, marginTop: 2 }}>
      <span style={{ color: "#94a3b8", width: 62, flexShrink: 0 }}>{k}</span>
      <span style={{ color: "#cbd5e1", flex: 1 }}>{v}</span>
    </div>
  );
}

// ── 樣式 ──────────────────────────────────────────────────
const panelBase: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.97)",
  display: "flex", flexDirection: "column",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const root: React.CSSProperties = {
  ...panelBase,
  position: "absolute", top: 0, right: 0, bottom: 0, width: 470, zIndex: 40,
  borderLeft: "1px solid rgba(250, 204, 21, 0.3)",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
};
const rootStandalone: React.CSSProperties = {
  ...panelBase, width: "100%", height: "100%",
  borderRight: "1px solid rgba(250, 204, 21, 0.25)",
};
/** 嵌在行動版 dock 分頁：不搶版面、捲動交給 dock */
const rootEmbedded: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  background: "transparent",
};
const bodyEmbedded: React.CSSProperties = { padding: 0 };
/** 框選提示的內嵌版（dock 內用，不做 fixed 定位） */
const pickBarInline: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  padding: "10px 12px", borderRadius: 8,
  background: "rgba(15, 23, 42, 0.95)", border: "1px solid rgba(250, 204, 21, 0.5)",
  fontSize: 16, fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const header: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
  padding: "10px 14px", borderBottom: "1px solid rgba(250, 204, 21, 0.3)",
  background: "rgba(250, 204, 21, 0.12)", flexShrink: 0,
};
const body: React.CSSProperties = { padding: 14, overflowY: "auto", flex: 1 };
const pickBar: React.CSSProperties = {
  position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 60,
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", maxWidth: "min(640px, calc(100vw - 32px))",
  padding: "8px 14px", borderRadius: 8,
  background: "rgba(15, 23, 42, 0.95)", border: "1px solid rgba(250, 204, 21, 0.5)",
  fontSize: 16, fontFamily: "ui-sans-serif, system-ui, sans-serif",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
};
const smallBtn: React.CSSProperties = {
  padding: "4px 8px", fontSize: 14, borderRadius: 4, cursor: "pointer",
  background: "rgba(30,41,59,0.8)", color: "#cbd5e1",
  border: "1px solid rgba(148,163,184,0.3)", fontFamily: "inherit",
  display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 12px", fontSize: 16, fontWeight: 600, borderRadius: 5, cursor: "pointer",
  background: "rgba(250, 204, 21, 0.2)", color: "#fef9c3",
  border: "1px solid rgba(250, 204, 21, 0.5)", fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
};
const chip: React.CSSProperties = {
  padding: "3px 8px", fontSize: 13, borderRadius: 10, cursor: "pointer",
  background: "rgba(30,41,59,0.8)", color: "#cbd5e1",
  border: "1px solid rgba(148,163,184,0.3)", fontFamily: "inherit",
};
const select: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 15, borderRadius: 4,
  background: "rgba(30,41,59,0.9)", color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,0.3)", fontFamily: "inherit", cursor: "pointer",
};
const numInput: React.CSSProperties = {
  width: 66, padding: "4px 6px", fontSize: 15, borderRadius: 4,
  background: "rgba(30,41,59,0.9)", color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,0.3)", fontFamily: "ui-monospace, monospace",
};
const readout: React.CSSProperties = {
  fontSize: 16, color: "#cbd5e1", padding: "6px 8px", marginTop: 4,
  background: "rgba(30,41,59,0.5)", borderRadius: 4, fontFamily: "ui-monospace, monospace",
};
const checkRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, fontSize: 15,
  color: "#cbd5e1", cursor: "pointer", lineHeight: 1.35,
};
const resultBox: React.CSSProperties = {
  background: "rgba(250, 204, 21, 0.06)", border: "1px solid rgba(250, 204, 21, 0.25)",
  borderRadius: 6, padding: 12, marginBottom: 10,
};
const resultTitle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "#fef9c3", marginBottom: 10,
  paddingBottom: 6, borderBottom: "1px solid rgba(250,204,21,0.2)",
};
const patternCard: React.CSSProperties = {
  marginTop: 8, padding: 10, borderRadius: 5,
  background: "rgba(15,23,42,0.6)", border: "1px solid rgba(148,163,184,0.2)",
};
const warnBox: React.CSSProperties = {
  marginTop: 8, padding: "7px 9px", borderRadius: 4, fontSize: 14, lineHeight: 1.5,
  background: "rgba(251, 146, 60, 0.12)", border: "1px solid rgba(251, 146, 60, 0.35)",
  color: "#fed7aa",
};

// ── 落水（MOB）· Leeway 漂流 ──────────────────────────────────
const MOB_TEXT = {
  zh: {
    title: "⓪ 落水（MOB）· 漂流推算",
    intro: "點地圖標落水點，以 seacurrent 海流＋風場預報推算漂流，再一路排到派機。",
    pick: "點地圖標落水位置", picking: "點地圖上的落水位置…", cancel: "取消",
    model: "漂流模型", linear: "直線（航向航速）", leeway: "Leeway（海流＋風）",
    lkp: "落水位置", object: "落水物", time: "落水時刻（台北）", now: "現在",
    sigma: "位置誤差 1σ", onScene: "落水 → 開始搜索",
    loading: "下載海流 / 風場預報…", running: "計算漂流…", stale: "參數已變更，重算中…",
    error: "漂流計算失敗", retry: "重新計算",
    extrapolated: "落水時刻＋推算時數超出 seacurrent 預報範圍，超出部分沿用端點的場（海流 / 風不再變化），結果僅供參考。",
    forecast: "預報發布", viewHour: "地圖顯示", midSearch: "搜索期中點", play: "播放", pause: "暫停",
    drift: "質心漂移", stranded: "擱淺（觸岸）", spread: "散布 1σ（東 / 北）",
    strandedNote: "觸岸粒子（橘）代表可能已漂上岸，需另派岸際搜索。",
    windMissing: "部分粒子漂出風場範圍，該段只算海流",
    next: "下一步",
    step1: "以 95% 粒子設搜索區", step2: "套用最佳搜索矩形（依可用架數）", step3: "產生搜索航線",
    step4: "到下方「航線」區勾選無人機並下達",
    needArea: "先完成上一步",
  },
  en: {
    title: "⓪ Man overboard · drift",
    intro: "Mark the MOB point; drift is computed from seacurrent's current + wind forecast, then carried through to tasking assets.",
    pick: "Mark MOB position on map", picking: "Click the MOB position on the map…", cancel: "Cancel",
    model: "Drift model", linear: "Linear (course/speed)", leeway: "Leeway (current + wind)",
    lkp: "MOB position", object: "Object", time: "MOB time (Taipei)", now: "Now",
    sigma: "Position error 1σ", onScene: "MOB → search start",
    loading: "Downloading current / wind forecast…", running: "Computing drift…", stale: "Parameters changed, recomputing…",
    error: "Drift failed", retry: "Recompute",
    extrapolated: "MOB time + drift hours run past the seacurrent forecast; the end-point field is held constant beyond it, so treat results as indicative.",
    forecast: "Forecast issued", viewHour: "Map shows", midSearch: "mid-search", play: "Play", pause: "Pause",
    drift: "Centroid drift", stranded: "Stranded (ashore)", spread: "Spread 1σ (E / N)",
    strandedNote: "Stranded particles (orange) may have washed ashore; consider a shoreline search.",
    windMissing: "Some particles left the wind grid; current only there",
    next: "Next steps",
    step1: "Set area to 95% of particles", step2: "Apply optimal rectangle (for available assets)", step3: "Generate search tracks",
    step4: "Pick drones and task them in the Tracks section below",
    needArea: "Finish the previous step first",
  },
} as const;

/** datetime-local 用的 YYYY-MM-DDTHH:mm（台北時間） */
function fmtTaipei(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 16);
}
function parseTaipei(v: string): number | null {
  const ms = Date.parse(`${v}:00+08:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** 第 h 小時粒子雲相對落水點的質心漂移、散布、擱淺比例 */
function driftStats(res: NonNullable<ReturnType<typeof searchPlannerStore.getDrift>["result"]>, h: number, lkp: LngLat) {
  const pos = res.hourly[h]!;
  const st = res.strandedHourly[h]!;
  const [lng0, lat0] = lkp;
  const kx = 60 * Math.cos((lat0 * Math.PI) / 180);
  let sx = 0, sy = 0, sxx = 0, syy = 0, ns = 0;
  for (let i = 0; i < res.count; i++) {
    const x = (pos[i * 2]! - lng0) * kx, y = (pos[i * 2 + 1]! - lat0) * 60;
    sx += x; sy += y; sxx += x * x; syy += y * y; ns += st[i]!;
  }
  const mx = sx / res.count, my = sy / res.count;
  return {
    distNm: Math.hypot(mx, my),
    brg: ((Math.atan2(mx, my) * 180) / Math.PI + 360) % 360,
    sdE: Math.sqrt(Math.max(0, sxx / res.count - mx * mx)),
    sdN: Math.sqrt(Math.max(0, syy / res.count - my * my)),
    strandedPct: (ns / res.count) * 100,
  };
}

function MobDriftSection({ t, lang, fmtHr }: { t: SearchStrings; lang: "zh" | "en"; fmtHr: (h: number) => string }) {
  const m = MOB_TEXT[lang];
  const inputs = searchPlannerStore.getInputs();
  const drift = searchPlannerStore.getDrift();
  const pickingMob = searchPlannerStore.getLkpPickTarget()?.kind === "mob";
  const leeway = inputs.bayesEnabled && inputs.priorFromLkp && inputs.driftModel === "leeway";
  const patch = searchPlannerStore.patch.bind(searchPlannerStore);
  const res = drift.result;
  const viewHour = searchPlannerStore.getDriftViewHour();
  const mid = midSearchElapsedHr();
  const current = searchPlannerStore.isDriftCurrent();
  const busy = drift.status === "loading" || drift.status === "running";
  const ready = !!res && current && !busy;
  const [playing, setPlaying] = useState(false);

  // 播放：每 0.4 秒前進一小時，到尾自動停
  useEffect(() => {
    if (!playing || !ready || !res) return;
    const id = window.setInterval(() => {
      const h = searchPlannerStore.getDriftViewHour();
      if (h >= res.hours) { setPlaying(false); return; }
      searchPlannerStore.setDriftViewHour(h + 1);
    }, 400);
    return () => clearInterval(id);
  }, [playing, ready, res]);

  const stats = ready && inputs.mcLkp ? driftStats(res!, Math.min(viewHour, res!.hours), inputs.mcLkp) : null;
  const { a, b } = searchPlannerStore.getCorners();
  const hasArea = !!(a && b);
  const sol = ready ? solve() : null;
  const hasTracks = searchPlannerStore.getTracks().length > 0;

  return (
    <Section title={m.title}>
      <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{m.intro}</div>
      {pickingMob ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "#fca5a5", fontWeight: 600, flex: 1 }}>{m.picking}</span>
          <button className="wg-btn" style={smallBtn} data-testid="mob-pick-cancel" onClick={() => searchPlannerStore.setPickingLkp(null)}>{m.cancel}</button>
        </div>
      ) : (
        <button className="wg-btn" data-testid="mob-pick"
          style={{ ...primaryBtn, background: "rgba(239,68,68,0.22)", borderColor: "rgba(239,68,68,0.6)", color: "#fee2e2" }}
          onClick={() => searchPlannerStore.setPickingLkp({ kind: "mob" })}>
          <LifeBuoy size={15} /> {m.pick}
        </button>
      )}

      {leeway && (
        <>
          {/* 地圖上同時看海流 / 風場箭頭（跟著下方時間軸） */}
          <SeaVectorControls compact />
          {/* 落水位置：度分秒輸入 / 重新點地圖（只移動位置，不重設時刻與誤差） */}
          <LkpInput key={JSON.stringify(inputs.mcLkp)} t={t} title={m.lkp} accent="#f87171"
            value={inputs.mcLkp} onApply={(p) => patch({ mcLkp: p })} pickTarget={{ kind: "mc" }} />
          <Row label={m.object}>
            <select style={select} value={inputs.leewayObjectId}
              onChange={(e) => patch({ leewayObjectId: Number(e.target.value) })}>
              {LEEWAY_OBJECTS.map((o) => (
                <option key={o.id} value={o.id}>{o.key} · {lang === "en" ? o.en : o.zh}</option>
              ))}
            </select>
          </Row>
          <Row label={m.time}>
            <input type="datetime-local" style={{ ...select, cursor: "text" }}
              value={fmtTaipei(inputs.lkpTimeMs ?? Date.now())}
              onChange={(e) => { const ms = parseTaipei(e.target.value); if (ms !== null) patch({ lkpTimeMs: ms }); }} />
            <button className="wg-btn" style={smallBtn}
              onClick={() => patch({ lkpTimeMs: Math.floor(Date.now() / 60_000) * 60_000 })}>{m.now}</button>
          </Row>
          <NumField label={m.sigma} value={inputs.mcSigmaNm} min={0.1} max={10} step={0.1} unit="nm"
            onChange={(v) => patch({ mcSigmaNm: v })} />
          <NumField label={m.onScene} value={inputs.mcLkpElapsedHr} min={0} max={48} step={0.5} unit="hr"
            onChange={(v) => patch({ mcLkpElapsedHr: v })} />

          {(busy || (!current && drift.status !== "error")) && (
            <div style={{ fontSize: 14, color: "#facc15", display: "flex", alignItems: "center", gap: 6 }}>
              <RotateCcw size={13} />
              {drift.status === "loading" ? `${m.loading} ${drift.framesLoaded}`
                : drift.status === "running" ? m.running : m.stale}
            </div>
          )}
          {drift.status === "error" && (
            <div style={warnBox}>
              {m.error}：{drift.error}
              <button className="wg-btn" style={{ ...smallBtn, marginTop: 6 }} onClick={() => searchPlannerStore.recomputeDrift()}>
                <RotateCcw size={12} /> {m.retry}
              </button>
            </div>
          )}

          {ready && res && (
            <>
              <Row label={m.viewHour}>
                <button className="wg-btn" style={{ ...smallBtn, padding: "4px 6px" }} title={playing ? m.pause : m.play} data-testid="mob-play"
                  onClick={() => {
                    if (!playing && viewHour >= res.hours) searchPlannerStore.setDriftViewHour(0);
                    setPlaying((p) => !p);
                  }}>
                  {playing ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <input type="range" min={0} max={res.hours} step={1} value={viewHour} data-testid="mob-hour"
                  onChange={(e) => { setPlaying(false); searchPlannerStore.setDriftViewHour(Number(e.target.value)); }}
                  style={{ flex: 1, accentColor: "#ef4444", minWidth: 0 }} />
                <span style={{ fontSize: 14, color: "#e2e8f0", width: 52, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                  T+{viewHour}h
                </span>
              </Row>
              <div style={{ fontSize: 13, color: "#64748b", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span>{fmtTaipei(res.startMs + viewHour * 3_600_000).replace("T", " ")}</span>
                <button className="wg-btn" style={{ ...chip, padding: "1px 7px", fontSize: 12 }}
                  onClick={() => { setPlaying(false); searchPlannerStore.setDriftViewHour(Math.round(mid)); }}>
                  {m.midSearch} T+{mid.toFixed(1)}h{lang === "en" ? ` (${fmtHr(mid)})` : `（${fmtHr(mid)}）`}
                </button>
              </div>
              {stats && (
                <div style={{ ...resultBox, marginBottom: 0, padding: 10 }} data-testid="mob-stats">
                  <KV k={m.drift} v={`${stats.distNm.toFixed(1)} nm @ ${stats.brg.toFixed(0)}°`} />
                  <KV k={m.spread} v={`${stats.sdE.toFixed(1)} / ${stats.sdN.toFixed(1)} nm`} />
                  <KV k={m.stranded} v={`${stats.strandedPct.toFixed(1)}%`} highlight={stats.strandedPct >= 5} />
                  <KV k={m.forecast} v={drift.baseTime ? `${drift.baseTime.slice(0, 16).replace("T", " ")} UTC` : "—"} />
                  {stats.strandedPct >= 5 && <div style={{ fontSize: 12, color: "#fdba74", marginTop: 4 }}>{m.strandedNote}</div>}
                </div>
              )}
              {drift.coverage && (drift.coverage.currentExtrapolated || drift.coverage.windExtrapolated) && (
                <div style={warnBox}>{m.extrapolated}</div>
              )}
              {res.windMissingSteps > 0 && <div style={{ fontSize: 13, color: "#fdba74" }}>{m.windMissing}</div>}

              {/* 下一步：落水 → 搜索區 → 最佳矩形 → 航線 → 派機 */}
              <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{m.next}</div>
              <MobStep n={1} done={hasArea} label={m.step1}
                onClick={() => searchPlannerStore.setAreaFromDrift(0.95)} />
              <MobStep n={2} done={false} label={m.step2} disabled={!sol?.rectangle} hint={!hasArea ? m.needArea : undefined}
                onClick={() => searchPlannerStore.applyOptimalRectangle()} />
              <MobStep n={3} done={hasTracks} label={m.step3} disabled={!sol} hint={!hasArea ? m.needArea : undefined}
                onClick={() => searchPlannerStore.generateTracks()} />
              <MobStep n={4} done={searchPlannerStore.getAssignedUnitIds().length > 0} label={m.step4} disabled />
            </>
          )}
        </>
      )}
    </Section>
  );
}

function MobStep({ n, label, done, disabled = false, hint, onClick, idPrefix = "mob" }: {
  n: number; label: string; done: boolean; disabled?: boolean; hint?: string; onClick?: () => void; idPrefix?: string;
}) {
  const clickable = !!onClick && !disabled;
  return (
    <button className={clickable ? "wg-btn" : undefined} disabled={!clickable} onClick={onClick} title={hint}
      data-testid={`${idPrefix}-step-${n}`} data-done={done ? "1" : "0"}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        padding: "6px 8px", borderRadius: 5, fontSize: 14, fontFamily: "inherit",
        cursor: clickable ? "pointer" : "default",
        background: done ? "rgba(74,222,128,0.12)" : clickable ? "rgba(250,204,21,0.12)" : "rgba(30,41,59,0.5)",
        border: `1px solid ${done ? "rgba(74,222,128,0.45)" : clickable ? "rgba(250,204,21,0.45)" : "rgba(148,163,184,0.2)"}`,
        color: done ? "#bbf7d0" : clickable ? "#fef9c3" : "#94a3b8",
      }}>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700,
        background: done ? "#16a34a" : "rgba(148,163,184,0.25)", color: done ? "#fff" : "#e2e8f0",
      }}>
        {done ? <Check size={12} /> : n}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

// ── 搜索對象：船舶 / 船團 ↔ 落水人員 ──────────────────────────
const TYPE_TEXT = {
  zh: {
    title: "搜索對象",
    vessel: "船舶 / 船團", vesselSub: "依航向 / 航速推算",
    mob: "落水人員 / 漂浮物", mobSub: "依海流＋風（Leeway）漂流",
  },
  en: {
    title: "Search object",
    vessel: "Vessel / fleet", vesselSub: "Course / speed dead reckoning",
    mob: "Person / object in water", mobSub: "Current + wind (Leeway) drift",
  },
} as const;

function TargetTypeSection({ lang }: { lang: "zh" | "en" }) {
  const x = TYPE_TEXT[lang];
  const mob = searchPlannerStore.getInputs().driftModel === "leeway";
  const card = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left",
    padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
    background: active ? `${color}33` : "rgba(30,41,59,0.6)",
    border: `1px solid ${active ? color : "rgba(148,163,184,0.25)"}`,
    color: active ? "#f8fafc" : "#94a3b8",
  });
  return (
    <Section title={x.title}>
      <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label={x.title}>
        <button className="wg-btn" role="radio" aria-checked={!mob} data-testid="target-type-vessel"
          style={card(!mob, "#38bdf8")} onClick={() => searchPlannerStore.setTargetType("vessel")}>
          <Ship size={18} color={!mob ? "#7dd3fc" : "#64748b"} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{x.vessel}</span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>{x.vesselSub}</span>
          </span>
        </button>
        <button className="wg-btn" role="radio" aria-checked={mob} data-testid="target-type-mob"
          style={card(mob, "#ef4444")} onClick={() => searchPlannerStore.setTargetType("mob")}>
          <LifeBuoy size={18} color={mob ? "#fca5a5" : "#64748b"} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{x.mob}</span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>{x.mobSub}</span>
          </span>
        </button>
      </div>
    </Section>
  );
}

const VESSEL_TEXT = {
  zh: {
    title: "⓪ 船舶 / 船團 · 航向航速推算",
    intro: "點地圖標最後已知位置（LKP），輸入估計航向 / 航速，推算目標機率分布，再一路排到派機。",
    pick: "點地圖標最後已知位置", picking: "點地圖上的最後已知位置…", cancel: "取消",
    next: "下一步",
    step1: "以 95% 機率分布設搜索區", step2: "套用最佳搜索矩形（依可用架數）", step3: "產生搜索航線",
    step4: "到下方「航線」區勾選無人機並下達",
    needArea: "先完成上一步",
  },
  en: {
    title: "⓪ Vessel / fleet · course & speed",
    intro: "Mark the last known position (LKP) and enter the estimated course / speed to project the target distribution, then carry it through to tasking assets.",
    pick: "Mark LKP on map", picking: "Click the last known position on the map…", cancel: "Cancel",
    next: "Next steps",
    step1: "Set area to 95% of the distribution", step2: "Apply optimal rectangle (for available assets)", step3: "Generate search tracks",
    step4: "Pick drones and task them in the Tracks section below",
    needArea: "Finish the previous step first",
  },
} as const;

function VesselSection({ t, lang, fmtHr }: { t: SearchStrings; lang: "zh" | "en"; fmtHr: (h: number) => string }) {
  const x = VESSEL_TEXT[lang];
  const inputs = searchPlannerStore.getInputs();
  const picking = searchPlannerStore.getLkpPickTarget()?.kind === "vessel";
  const active = inputs.bayesEnabled && inputs.priorFromLkp && !!inputs.mcLkp;
  const { a, b } = searchPlannerStore.getCorners();
  const hasArea = !!(a && b);
  const sol = active ? solve() : null;
  const hasTracks = searchPlannerStore.getTracks().length > 0;

  return (
    <Section title={x.title}>
      <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{x.intro}</div>
      {picking ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "#7dd3fc", fontWeight: 600, flex: 1 }}>{x.picking}</span>
          <button className="wg-btn" style={smallBtn} data-testid="vessel-pick-cancel" onClick={() => searchPlannerStore.setPickingLkp(null)}>{x.cancel}</button>
        </div>
      ) : (
        <button className="wg-btn" data-testid="vessel-pick"
          style={{ ...primaryBtn, background: "rgba(56,189,248,0.18)", borderColor: "rgba(56,189,248,0.55)", color: "#e0f2fe" }}
          onClick={() => searchPlannerStore.setPickingLkp({ kind: "vessel" })}>
          <Ship size={15} /> {x.pick}
        </button>
      )}

      {active && (
        <>
          <LkpEditor t={t} fmtHr={fmtHr} shared />
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{x.next}</div>
          <MobStep idPrefix="vessel" n={1} done={hasArea} label={x.step1}
            onClick={() => searchPlannerStore.setAreaFromPrior(0.95)} />
          <MobStep idPrefix="vessel" n={2} done={false} label={x.step2} disabled={!sol?.rectangle} hint={!hasArea ? x.needArea : undefined}
            onClick={() => searchPlannerStore.applyOptimalRectangle()} />
          <MobStep idPrefix="vessel" n={3} done={hasTracks} label={x.step3} disabled={!sol} hint={!hasArea ? x.needArea : undefined}
            onClick={() => searchPlannerStore.generateTracks()} />
          <MobStep idPrefix="vessel" n={4} done={searchPlannerStore.getAssignedUnitIds().length > 0} label={x.step4} disabled />
        </>
      )}
    </Section>
  );
}
