/**
 * 底圖樣式切換器（右上角，PovSwitcher 上方）。
 * 切換時觸發 props.onChange，由 WargameApp 處理 setStyle + 重掛 layer。
 */
import { Map as MapIcon } from "lucide-react";
import { WARGAME_MAP_STYLES } from "../wargame/mapStyles";

interface Props {
  selectedId: string;
  onChange: (id: string) => void;
  embedded?: boolean;
}

export function MapStyleSwitcher({ selectedId, onChange, embedded = false }: Props) {
  return (
    <div
      style={embedded ? {
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        width: "100%",
      } : {
        position: "absolute",
        top: 16,
        right: 220,           // 不擋場景名稱
        zIndex: 22,
        padding: "8px 12px",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 8,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <MapIcon size={14} color="#94a3b8" />
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="wg-btn"
        style={{
          padding: embedded ? "8px 10px" : "4px 8px",
          borderRadius: 4,
          border: "1px solid rgba(148, 163, 184, 0.3)",
          background: "rgba(30, 41, 59, 0.4)",
          color: "#e2e8f0",
          fontSize: 17,
          fontFamily: "inherit",
          cursor: "pointer",
          outline: "none",
          flex: embedded ? 1 : undefined,
        }}
      >
        {WARGAME_MAP_STYLES.map((s) => (
          <option key={s.id} value={s.id} style={{ background: "#0f172a", color: "#e2e8f0" }}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
