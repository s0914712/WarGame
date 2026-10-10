/**
 * AI 戰場研判 + 指令（含理由 / 套用結果）—— LLM 面板與地圖上的「AI 指揮中」小卡共用。
 */
import type { AdversaryAssessment, AiOrderView } from "../../wargame/llm/adversary";

export function AssessmentView({ assessment, orders, planned = false, footer, compact = false, maxOrders }: {
  assessment: AdversaryAssessment | null;
  orders: AiOrderView[];
  /** true = 擬定但未執行（測試研判） */
  planned?: boolean;
  footer?: string;
  /** 精簡版（地圖小卡）：字小、不加外框 */
  compact?: boolean;
  /** 最多顯示幾條指令（其餘以「另 N 條」帶過） */
  maxOrders?: number;
}) {
  const fs = compact ? 13 : 15;
  const h: React.CSSProperties = { fontSize: fs - 1, fontWeight: 700, color: "#93c5fd", margin: compact ? "6px 0 1px" : "8px 0 2px" };
  const li: React.CSSProperties = { margin: "1px 0", lineHeight: 1.5 };
  const shown = maxOrders !== undefined ? orders.slice(0, maxOrders) : orders;
  const hidden = orders.length - shown.length;
  return (
    <div data-testid="ai-assessment" style={compact
      ? { fontSize: fs, color: "#e2e8f0" }
      : {
        padding: 12, borderRadius: 6, fontSize: fs, color: "#e2e8f0",
        background: "rgba(59, 130, 246, 0.07)", border: "1px solid rgba(59, 130, 246, 0.35)",
      }}>
      {!compact && <div style={{ fontSize: 16, fontWeight: 700, color: "#bfdbfe" }}>🧭 AI 戰場研判</div>}
      {assessment ? (
        <>
          {assessment.situation && <div style={{ lineHeight: 1.6, marginTop: compact ? 0 : 4 }}>{assessment.situation}</div>}
          {assessment.intent && (<>
            <div style={h}>作戰意圖</div>
            <div style={{ lineHeight: 1.5, color: "#fde68a" }}>{assessment.intent}</div>
          </>)}
          {!compact && assessment.threats.length > 0 && (<>
            <div style={h}>威脅</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{assessment.threats.map((x, i) => <li key={i} style={li}>{x}</li>)}</ul>
          </>)}
          {!compact && assessment.opportunities.length > 0 && (<>
            <div style={h}>機會</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{assessment.opportunities.map((x, i) => <li key={i} style={li}>{x}</li>)}</ul>
          </>)}
        </>
      ) : (
        <div style={{ color: "#94a3b8", marginTop: 4 }}>（模型沒有回傳研判）</div>
      )}
      {orders.length > 0 && (<>
        <div style={h}>{planned ? "建議指令（未執行）" : "下達指令"}（{orders.length}）</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: fs - 1 }}>
          {shown.map((o, i) => (
            <div key={i} style={{ lineHeight: 1.45 }}>
              <span style={{ color: planned ? "#94a3b8" : o.status === "applied" ? "#4ade80" : "#f87171", marginRight: 4 }}>
                {planned ? "•" : o.status === "applied" ? "✓" : "✗"}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{o.text}</span>
              {o.reason && <span style={{ color: "#94a3b8" }}> — {o.reason}</span>}
              {o.note && !compact && (
                <div style={{ color: o.status === "rejected" ? "#fca5a5" : "#fcd34d", fontSize: fs - 2, paddingLeft: 16 }}>{o.note}</div>
              )}
            </div>
          ))}
          {hidden > 0 && <div style={{ color: "#64748b" }}>…另 {hidden} 條</div>}
        </div>
      </>)}
      {footer && <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>{footer}</div>}
    </div>
  );
}
