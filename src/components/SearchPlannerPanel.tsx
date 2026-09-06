/**
 * 搜索規劃器面板 — IAMSAR 搜索參數與六大圖形的解算介面。
 *
 * 三個問題（對應需求）：
 *   1. 給定搜索區 + 無人機數量 → 掃完全區時間
 *   2. 同上 → 發現機率 POD
 *   3. 給定時間 → 反解建議架數與搜索方式
 *
 * 解算全在 src/wargame/search/*（純函式）；此處只做輸入輸出與航線指派。
 */
import { useSyncExternalStore } from "react";
import { Radar, X, Crosshair, Wand2, Send, RotateCcw, Trash2 } from "lucide-react";
import {
  searchPlannerStore, solve, eligibleSearchUnits, assetProfileFromUnit,
} from "../wargame/search/searchPlannerStore";
import { SEARCH_PATTERNS, type SearchPatternId } from "../wargame/search/patterns";
import { podForDisplay, POD_DISPLAY_CAP } from "../wargame/search/pod";
import { TRACK_COLORS } from "../wargame/search/tracks";
import type { SearchTargetClass } from "../wargame/search/sweepWidth";
import { suggestWeatherFactor } from "../wargame/search/sweepWidth";
import { UNIT_CATALOG } from "../wargame/catalog/units";

function subscribe(cb: () => void) {
  const u1 = searchPlannerStore.subscribe(cb);
  return () => { u1(); };
}
const getVersion = () => searchPlannerStore.getInputs();

/** 文件七(四)5：C=1.0 不等於 POD 100% —— 一律封頂顯示，不出現 100% */
function fmtPod(p: number): string {
  const capped = podForDisplay(p);
  return capped >= POD_DISPLAY_CAP ? `>${(POD_DISPLAY_CAP * 100).toFixed(1)}%` : `${(capped * 100).toFixed(1)}%`;
}

function fmtHr(h: number): string {
  if (!Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} 分`;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh} 小時` : `${hh} 小時 ${mm} 分`;
}

export function SearchPlannerPanel() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const open = searchPlannerStore.isOpen();
  const picking = searchPlannerStore.isPicking();
  const inputs = searchPlannerStore.getInputs();
  const { a, b } = searchPlannerStore.getCorners();
  const tracks = searchPlannerStore.getTracks();
  const assigned = searchPlannerStore.getAssignedUnitIds();
  const sol = solve();
  const units = eligibleSearchUnits();

  if (!open) return null;

  // 框選中：面板收成頂部細列，讓出地圖
  if (picking) {
    return (
      <div style={pickBar}>
        <Crosshair size={16} color="#facc15" />
        <span style={{ color: "#fef9c3", fontWeight: 600 }}>
          {a ? "再點一次定對角" : "點地圖定搜索區第一角"}
        </span>
        <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.cancelPick()}>
          取消
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

  // 產生的航線實際里程 vs 五要素估算（A = T×N×P×S 不含迴轉與末條航段溢出）
  const actualTrackNm = tracks.reduce((s, t) => s + t.trackNm, 0);
  const estTrackNm = sol ? sol.area.areaNm2 / sol.trackSpacingNm : 0;
  const actualHr = actualTrackNm > 0 && sol
    ? actualTrackNm / Math.max(1, sol.droneCount) / Math.max(0.1, inputs.speedKn)
    : 0;

  return (
    <div style={root}>
      {/* 標題列 */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 20, color: "#fef9c3" }}>
          <Radar size={18} /> 搜索規劃器
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.reset()} title="還原預設參數">
            <RotateCcw size={12} /> 重設
          </button>
          <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.setOpen(false)}>
            <X size={12} /> 關閉
          </button>
        </div>
      </div>

      <div style={body}>
        {/* ── 1. 搜索區 ── */}
        <Section title="① 搜索區">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className="wg-btn" style={primaryBtn} onClick={() => searchPlannerStore.startPickArea()}>
              <Crosshair size={13} /> 在地圖上框選
            </button>
            {a && b && (
              <button className="wg-btn" style={smallBtn} onClick={() => searchPlannerStore.clearArea()}>
                <Trash2 size={12} /> 清除
              </button>
            )}
          </div>
          {sol ? (
            <div style={readout}>
              {sol.area.longSideNm.toFixed(1)} × {sol.area.shortSideNm.toFixed(1)} nm
              {"  ·  "}<b style={{ color: "#fef9c3" }}>{sol.area.areaNm2.toFixed(0)} nm²</b>
            </div>
          ) : (
            <div style={{ ...readout, color: "#94a3b8" }}>尚未框選搜索區</div>
          )}
        </Section>

        {/* ── 2. 解算方向 ── */}
        <Section title="② 要解算什麼">
          <div style={{ display: "flex", gap: 6 }}>
            <Toggle
              active={inputs.direction === "given_assets"}
              onClick={() => patch({ direction: "given_assets" })}
              label="給架數 → 求時間 / POD"
            />
            <Toggle
              active={inputs.direction === "given_time"}
              onClick={() => patch({ direction: "given_time" })}
              label="給時間 → 求架數 / 方式"
            />
          </div>
          {inputs.direction === "given_assets" ? (
            <NumField label="無人機數量" value={inputs.droneCount} min={1} max={24} step={1} unit="架"
              onChange={(v) => patch({ droneCount: v })} />
          ) : (
            <>
              <NumField label="可用時間" value={inputs.availableHr} min={0.5} max={48} step={0.5} unit="hr"
                onChange={(v) => patch({ availableHr: v })} />
              <NumField label="目標發現機率 POD" value={Math.round(inputs.targetPod * 100)} min={10} max={99} step={1} unit="%"
                onChange={(v) => patch({ targetPod: v / 100 })} />
            </>
          )}
        </Section>

        {/* ── 3. 目標與感測 ── */}
        <Section title="③ 目標與感測條件">
          <Row label="搜索目標">
            <select value={inputs.targetClass} style={select}
              onChange={(e) => patch({ targetClass: e.target.value as SearchTargetClass })}>
              <option value="ship_46_91m">船舶 46–91 m</option>
              <option value="ship_over_91m">船舶 &gt;91 m</option>
            </select>
          </Row>
          <Row label="飛行高度">
            <select value={inputs.altitudeFt} style={select}
              onChange={(e) => patch({ altitudeFt: Number(e.target.value) })}>
              {[500, 1000, 1500, 2000].map((ft) => <option key={ft} value={ft}>{ft.toLocaleString()} ft</option>)}
            </select>
          </Row>
          <NumField label="能見度" value={inputs.visibilityKm} min={0.5} max={40} step={0.5} unit="km"
            onChange={(v) => patch({ visibilityKm: v })} />
          <NumField label="風速" value={inputs.windKn} min={0} max={50} step={1} unit="kn"
            onChange={(v) => patch({ windKn: v })} />
          <NumField label="浪高" value={inputs.seaStateM} min={0} max={6} step={0.1} unit="m"
            onChange={(v) => patch({ seaStateM: v })} />
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <NumField label="天候修正 Fw" value={inputs.corrections.weather} min={0.1} max={1.5} step={0.05} unit=""
                onChange={(v) => patch({ corrections: { ...inputs.corrections, weather: v } })} />
            </div>
            <button className="wg-btn" style={{ ...smallBtn, marginBottom: 6 }}
              title="依風速與浪高套用建議值"
              onClick={() => patch({ corrections: { ...inputs.corrections, weather: +suggestWeatherFactor(inputs.windKn, inputs.seaStateM).toFixed(2) } })}>
              <Wand2 size={12} /> 建議
            </button>
          </div>
          <NumField label="速度修正 Fv" value={inputs.corrections.speed} min={0.1} max={2} step={0.05} unit=""
            onChange={(v) => patch({ corrections: { ...inputs.corrections, speed: v } })} />
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.corrections.fatigued}
              onChange={(e) => patch({ corrections: { ...inputs.corrections, fatigued: e.target.checked } })} />
            人員過度疲勞（掃掠寬 ×0.9）
          </label>
        </Section>

        {/* ── 4. 機隊性能 ── */}
        <Section title="④ 無人機性能">
          <NumField label="搜索速度" value={inputs.speedKn} min={20} max={300} step={5} unit="kn"
            onChange={(v) => patch({ speedKn: v })} />
          <NumField label="滯空時數" value={inputs.enduranceHr} min={0} max={48} step={0.5} unit="hr"
            onChange={(v) => patch({ enduranceHr: v })} />
          <NumField label="單程進場" value={inputs.transitHrOneWay} min={0} max={12} step={0.1} unit="hr"
            onChange={(v) => patch({ transitHrOneWay: v })} />
          {units.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              <span style={{ fontSize: 14, color: "#94a3b8", alignSelf: "center" }}>套用機型：</span>
              {Array.from(new Map(units.map((u) => [u.kind, u])).values()).map((u) => {
                const prof = assetProfileFromUnit(u);
                return (
                  <button key={u.kind} className="wg-btn" style={chip}
                    title={`帶入${UNIT_CATALOG[u.kind].displayName}的速度與滯空時數（如 ${u.displayName}）`}
                    onClick={() => patch(prof)}>
                    {UNIT_CATALOG[u.kind].displayName} {prof.speedKn}kn/{(prof.enduranceHr ?? 0).toFixed(0)}hr
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* ── 5. 進階：航跡間距與圖形覆寫 ── */}
        <Section title="⑤ 航跡間距與圖形">
          <Row label="航跡間距 S">
            <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
              <input
                type="number" step={0.1} min={0.1}
                value={inputs.trackSpacingOverrideNm ?? (sol?.trackSpacingNm.toFixed(2) ?? "")}
                placeholder="自動"
                style={{ ...numInput, flex: 1 }}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  patch({ trackSpacingOverrideNm: v === "" ? null : Number(v) });
                }}
              />
              <span style={{ fontSize: 14, color: "#94a3b8" }}>nm</span>
              {inputs.trackSpacingOverrideNm !== null && (
                <button className="wg-btn" style={smallBtn}
                  onClick={() => patch({ trackSpacingOverrideNm: null })}>自動</button>
              )}
            </div>
          </Row>
          <Row label="搜索圖形">
            <select value={inputs.patternOverride ?? ""} style={select}
              onChange={(e) => patch({ patternOverride: e.target.value === "" ? null : e.target.value as SearchPatternId })}>
              <option value="">自動建議{pattern ? `（${SEARCH_PATTERNS[pattern].name}）` : ""}</option>
              {Object.values(SEARCH_PATTERNS).map((p) => (
                <option key={p.id} value={p.id}>{p.id} · {p.name}</option>
              ))}
            </select>
          </Row>
          <Row label="POD 模型">
            <select value={inputs.podModel} style={select}
              onChange={(e) => patch({ podModel: e.target.value as "iamsar_chart" | "random_search" })}>
              <option value="iamsar_chart">IAMSAR POD 圖（表 4-2 擬合）</option>
              <option value="random_search">隨機搜索律 1−e⁻ᶜ（保守）</option>
            </select>
          </Row>
          <NumField label="基準點誤差半徑" value={inputs.datumUncertaintyNm} min={0} max={40} step={0.5} unit="nm"
            onChange={(v) => patch({ datumUncertaintyNm: v })} />
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.targetBiasedToOneEnd}
              onChange={(e) => patch({ targetBiasedToOneEnd: e.target.checked })} />
            目標較可能靠近搜索區某一端
          </label>
          <label style={checkRow}>
            <input type="checkbox" checked={inputs.hasKnownTrackLine}
              onChange={(e) => patch({ hasKnownTrackLine: e.target.checked })} />
            有已知的失蹤航路
          </label>
        </Section>

        {/* ── 解算結果 ── */}
        {sol && W && (
          <div style={resultBox}>
            <div style={resultTitle}>解算結果</div>

            <KV k="掃掠寬度 W" v={`${W.correctedNm.toFixed(2)} nm`}
              note={`Wu ${W.uncorrectedNm.toFixed(1)} × Fw ${W.corrections.weather} × Fv ${W.corrections.speed}${W.corrections.fatigued ? " × Ff 0.9" : ""}`} />
            <KV k="航跡間距 S" v={`${sol.trackSpacingNm.toFixed(2)} nm`} />
            <KV k="覆蓋因子 C = W/S"
              v={(fwd?.coverage ?? inv?.achievedCoverage ?? 0).toFixed(2)}
              note={(fwd?.coverageVerdict.note ?? "")} />

            {fwd && (
              <>
                <KV k="掃完全區時間" v={fmtHr(fwd.timeHr)} big
                  note={`${sol.droneCount} 架 × ${inputs.speedKn} kn × S ${sol.trackSpacingNm.toFixed(2)} nm（A = T×N×P×S）`} />
                <KV k="含往返 / 輪替歷時" v={fmtHr(fwd.elapsedHrWithSorties)}
                  note={fwd.sortiesPerDrone > 1 ? `每架 ${fwd.sortiesPerDrone} 架次（單架次可搜 ${fmtHr(fwd.onStationHr)}）` : `單架次可搜 ${fmtHr(fwd.onStationHr)}`} />
                <KV k="發現機率 POD" v={fmtPod(fwd.pod)} big highlight
                  note="文件七(四)5：覆蓋因子 1.0 亦不代表已檢查區內每一處位置，故不顯示 100%" />
                <KV k="重複搜索累積 POD"
                  v={[2, 3].map((n) => `${n}次 ${fmtPod(1 - Math.pow(1 - fwd.pod, n))}`).join(" · ")} />
                <KV k="全隊總航跡" v={`${fwd.totalTrackNm.toFixed(0)} nm`} note={`每架 ${fwd.trackPerDroneNm.toFixed(0)} nm`} />
              </>
            )}

            {inv && (
              <>
                <KV k="建議無人機數量" v={`${inv.recommendedDrones} 架`} big highlight
                  note={`理論值 ${inv.exactDrones.toFixed(2)} 架（無條件進位）`} />
                <KV k="建議搜索方式" v={`${SEARCH_PATTERNS[inv.pattern].id} · ${SEARCH_PATTERNS[inv.pattern].name}`} big />
                <KV k="採用理由" v={inv.patternReason} wrap />
                <KV k="達成 POD" v={fmtPod(inv.achievedPod)}
                  note={`目標 ${(inputs.targetPod * 100).toFixed(0)}%；所需 C = ${inv.requiredCoverage.toFixed(2)}`} />
                <KV k="實際掃區時間" v={fmtHr(inv.actualTimeHr)}
                  note={inv.sortiesPerDrone > 1 ? `每架 ${inv.sortiesPerDrone} 架次` : "單架次可完成"} />
                {inv.fallback && <div style={warnBox}>{inv.fallback.note}</div>}
              </>
            )}

            {/* 圖形說明卡 */}
            {info && (
              <div style={patternCard}>
                <div style={{ fontWeight: 700, color: "#fef9c3", marginBottom: 4 }}>
                  {info.id} · {info.name}（{info.nameEn}）
                </div>
                <PatRow k="適用" v={info.whenToUse} />
                <PatRow k="航段" v={info.legDirection} />
                <PatRow k="起始" v={info.startPoint} />
                <PatRow k="參數" v={info.keyParams} />
                <PatRow k="限制" v={info.limits} />
                <PatRow k="無人機" v={`${info.uavSuitable === "yes" ? "✔" : "△"} ${info.uavNotes}`} />
              </div>
            )}

            {(fwd?.warnings ?? inv?.warnings ?? []).map((w, i) => (
              <div key={i} style={warnBox}>⚠ {w}</div>
            ))}
          </div>
        )}

        {/* ── 產生航線 + 指派 ── */}
        {sol && (
          <Section title="⑥ 產生搜索航線">
            {!info?.autoRoutable ? (
              <div style={warnBox}>
                {info?.name}需要地形剖面，本規劃器不自動產生航線（文件第十節列為「△」）。
                請改選其他圖形，或人工規劃航線。
              </div>
            ) : (
              <>
                <button className="wg-btn" style={primaryBtn}
                  onClick={() => searchPlannerStore.generateTracks()}>
                  <Wand2 size={13} /> 產生 {sol.droneCount} 條搜索航線
                </button>

                {tracks.length > 0 && (
                  <>
                    <div style={readout}>
                      實際航線 <b style={{ color: "#fef9c3" }}>{actualTrackNm.toFixed(0)} nm</b>
                      {"  ·  "}每架約 {fmtHr(actualHr)}
                      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
                        比 A=T×N×P×S 估算的 {estTrackNm.toFixed(0)} nm 多 {((actualTrackNm / estTrackNm - 1) * 100).toFixed(0)}%
                        —— 迴轉航程與末條航段溢出，屬正常
                      </div>
                    </div>

                    <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 8, marginBottom: 4 }}>
                      指派給（依序對應航線顏色）：
                    </div>
                    {units.length === 0 && <div style={{ ...readout, color: "#94a3b8" }}>此陣營沒有空中載台</div>}
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
                                航線 #{(i % tracks.length) + 1}
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
                        if (n > 0) searchPlannerStore.setOpen(false);
                      }}>
                      <Send size={13} /> 套用航線到 {assigned.length} 架
                    </button>
                    {assigned.length > tracks.length && (
                      <div style={warnBox}>
                        指派 {assigned.length} 架但只有 {tracks.length} 條航線 —— 多出的會循環共用航線，
                        建議把數量調成一致。
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </Section>
        )}

        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, paddingTop: 4 }}>
          掃掠寬度表、天候／疲勞修正、覆蓋因子與 POD、六大圖形與擴展方形航段表，
          均依《搜索參數的選擇與機率》與《六大搜索圖形》實作。
          POD 曲線由文件表 4-2 反解而得，可完整重現該表數值。
        </div>
      </div>
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
      <span style={{ fontSize: 15, color: "#94a3b8", width: 110, flexShrink: 0 }}>{label}</span>
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
        style={{ flex: 1, accentColor: "#facc15" }} />
      <input type="number" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={numInput} />
      <span style={{ fontSize: 14, color: "#94a3b8", width: 24 }}>{props.unit}</span>
    </Row>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="wg-btn" style={{
      flex: 1, padding: "7px 8px", borderRadius: 4, fontSize: 15, cursor: "pointer",
      fontFamily: "inherit", fontWeight: active ? 700 : 400,
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
    <div style={{ display: "flex", flexDirection: wrap ? "column" : "row", gap: wrap ? 2 : 8, marginBottom: 6, alignItems: wrap ? "flex-start" : "baseline" }}>
      <span style={{ fontSize: 15, color: "#94a3b8", width: wrap ? "auto" : 130, flexShrink: 0 }}>{k}</span>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: big ? 21 : 17, fontWeight: big ? 700 : 500,
          color: highlight ? "#4ade80" : "#e2e8f0",
          fontFamily: wrap ? "inherit" : "ui-monospace, monospace",
          lineHeight: 1.4,
        }}>{v}</div>
        {note && <div style={{ fontSize: 13, color: "#64748b", marginTop: 1, lineHeight: 1.4 }}>{note}</div>}
      </div>
    </div>
  );
}

function PatRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 14, lineHeight: 1.5, marginTop: 2 }}>
      <span style={{ color: "#94a3b8", width: 44, flexShrink: 0 }}>{k}</span>
      <span style={{ color: "#cbd5e1", flex: 1 }}>{v}</span>
    </div>
  );
}

// ── 樣式 ──────────────────────────────────────────────────
const root: React.CSSProperties = {
  position: "absolute", top: 0, right: 0, bottom: 0, width: 460, zIndex: 40,
  background: "rgba(15, 23, 42, 0.97)",
  borderLeft: "1px solid rgba(250, 204, 21, 0.3)",
  display: "flex", flexDirection: "column",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.4)",
};
const header: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 14px", borderBottom: "1px solid rgba(250, 204, 21, 0.3)",
  background: "rgba(250, 204, 21, 0.12)",
};
const body: React.CSSProperties = { padding: 14, overflowY: "auto", flex: 1 };
const pickBar: React.CSSProperties = {
  position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 40,
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
  display: "flex", alignItems: "center", gap: 4,
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
  flex: 1, padding: "5px 8px", fontSize: 15, borderRadius: 4,
  background: "rgba(30,41,59,0.9)", color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,0.3)", fontFamily: "inherit", cursor: "pointer",
};
const numInput: React.CSSProperties = {
  width: 66, padding: "4px 6px", fontSize: 15, borderRadius: 4,
  background: "rgba(30,41,59,0.9)", color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,0.3)",
  fontFamily: "ui-monospace, monospace",
};
const readout: React.CSSProperties = {
  fontSize: 16, color: "#cbd5e1", padding: "6px 8px", marginTop: 4,
  background: "rgba(30,41,59,0.5)", borderRadius: 4,
  fontFamily: "ui-monospace, monospace",
};
const checkRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, fontSize: 15,
  color: "#cbd5e1", cursor: "pointer",
};
const resultBox: React.CSSProperties = {
  background: "rgba(250, 204, 21, 0.06)",
  border: "1px solid rgba(250, 204, 21, 0.25)",
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
