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
import { useState, useSyncExternalStore } from "react";
import { Radar, X, Crosshair, Wand2, Send, RotateCcw, Trash2, Play } from "lucide-react";
import {
  searchPlannerStore, solve, eligibleSearchUnits, assetProfileFromUnit, midSearchElapsedHr,
} from "../wargame/search/searchPlannerStore";
import { SEARCH_PATTERNS, type SearchPatternId } from "../wargame/search/patterns";
import { podForDisplay, POD_DISPLAY_CAP, podFromCoverage } from "../wargame/search/pod";
import { TRACK_COLORS } from "../wargame/search/tracks";
import { suggestWeatherFactor, type SearchTargetClass } from "../wargame/search/sweepWidth";
import { UNIT_CATALOG } from "../wargame/catalog/units";
import { useLang } from "../wargame/i18n/lang";
import {
  searchStrings, formatNotice, coverageNote, patternReason, patternLabel,
} from "../wargame/search/i18n";

function subscribe(cb: () => void) { return searchPlannerStore.subscribe(cb); }
/** snapshot 必須是每次變動都改變的值 —— 見 searchPlannerStore.getVersion 的說明 */
const getVersion = () => searchPlannerStore.getVersion();

export function SearchPlannerPanel({ standalone = false }: { standalone?: boolean } = {}) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const langRaw = useLang();
  const lang: "zh" | "en" = langRaw === "en" ? "en" : "zh";
  const t = searchStrings(lang);
  const [mcBusy, setMcBusy] = useState(false);

  const open = searchPlannerStore.isOpen();
  const picking = searchPlannerStore.isPicking();
  const inputs = searchPlannerStore.getInputs();
  const { a, b } = searchPlannerStore.getCorners();
  const tracks = searchPlannerStore.getTracks();
  const assigned = searchPlannerStore.getAssignedUnitIds();
  const mc = searchPlannerStore.getMonteCarlo();
  const scenarios = searchPlannerStore.getScenarios();
  const sortiePos = searchPlannerStore.getSortiePos();
  const eff = searchPlannerStore.getSearchEffectiveness();
  const sol = solve();
  const units = eligibleSearchUnits();

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

  if (!open && !standalone) return null;

  if (picking) {
    return (
      <div style={pickBar}>
        <Crosshair size={16} color="#facc15" />
        <span style={{ color: "#fef9c3", fontWeight: 600 }}>
          {a ? t.pickSecondCorner : t.pickFirstCorner}
        </span>
        <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.cancelPick()}>
          {t.cancel}
        </button>
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
    <div style={standalone ? rootStandalone : root}>
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

      <div style={body}>
        {/* ① 搜索區 */}
        <Section title={t.secArea}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className="wg-btn" style={primaryBtn} onClick={() => searchPlannerStore.startPickArea()}>
              <Crosshair size={13} /> {t.pickOnMap}
            </button>
            {a && b && (
              <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.clearArea()}>
                <Trash2 size={12} /> {t.clear}
              </button>
            )}
          </div>
          {sol ? (
            <div style={readout}>
              {sol.area.longSideNm.toFixed(1)} × {sol.area.shortSideNm.toFixed(1)} nm
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
          <Row label={t.altitude}>
            <select value={inputs.altitudeFt} style={select}
              onChange={(e) => patch({ altitudeFt: Number(e.target.value) })}>
              {[500, 1000, 1500, 2000].map((ft) => <option key={ft} value={ft}>{ft.toLocaleString()} ft</option>)}
            </select>
          </Row>
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
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.sensorTested}
              onChange={(e) => patch({ sensorTested: e.target.checked })} />
            {t.sensorTested}
          </label>
          {!inputs.sensorTested && (
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
              note={`Wu ${W.uncorrectedNm.toFixed(1)} × Fw ${W.corrections.weather} × Fv ${W.corrections.speed}${W.corrections.fatigued ? " × Ff 0.9" : ""}`} />
            <KV k={t.trackSpacing} v={`${sol.trackSpacingNm.toFixed(2)} nm`} />
            <KV k={t.coverage} v={(fwd?.coverage ?? inv?.achievedCoverage ?? 0).toFixed(2)}
              note={level ? coverageNote(level, lang) : undefined} />

            {fwd && (
              <>
                <KV k={t.sweepTime} v={fmtHr(fwd.timeHr)} big
                  note={`${sol.droneCount} × ${inputs.speedKn} kn × S ${sol.trackSpacingNm.toFixed(2)} nm  (A = T×N×P×S)`} />
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
                    onChange={(e) => patch({ mcDistributionKind: e.target.value as "uniform" | "gaussian" })}>
                    <option value="uniform">{t.mcUniform}</option>
                    <option value="gaussian">{t.mcGaussian}</option>
                  </select>
                </Row>
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
              <NumField label={t.elapsedHr} value={inputs.elapsedHr} min={0} max={72} step={0.5} unit="hr"
                onChange={(v) => patch({ elapsedHr: v })} />
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                {t.midSearchNote} → T+{midSearchElapsedHr().toFixed(1)} hr
              </div>
              <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 4 }}>{t.scenarios}</div>
              {scenarios.map((sc) => (
                <div key={sc.id} style={{
                  padding: 8, borderRadius: 4, marginTop: 4,
                  background: "rgba(30,41,59,0.5)", border: "1px solid rgba(148,163,184,0.2)",
                }}>
                  <div style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 600, marginBottom: 4 }}>
                    {lang === "en" ? (sc.labelEn ?? sc.label) : sc.label}
                  </div>
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

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="wg-btn" style={{
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
const header: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
  padding: "10px 14px", borderBottom: "1px solid rgba(250, 204, 21, 0.3)",
  background: "rgba(250, 204, 21, 0.12)", flexShrink: 0,
};
const body: React.CSSProperties = { padding: 14, overflowY: "auto", flex: 1 };
const pickBar: React.CSSProperties = {
  position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 60,
  display: "flex", alignItems: "center", gap: 10,
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
