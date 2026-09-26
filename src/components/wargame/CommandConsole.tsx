/**
 * 桌面底部控制台（星海式）：左 戰報 | 中 選中單位 | 右 指令卡。
 * 高度固定 CONSOLE_HEIGHT，地圖的 Mapbox 控制項 / 鏡頭 padding 以此對齊。
 */
import { ScrollText } from "lucide-react";
import { EngagementLog } from "../EngagementLog";
import { ConsoleUnitInfo } from "./ConsoleUnitInfo";
import { CommandCard } from "./CommandCard";

export const CONSOLE_HEIGHT = 196;

export function CommandConsole() {
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, bottom: 0, height: CONSOLE_HEIGHT, zIndex: 26,
      display: "grid", gridTemplateColumns: "minmax(300px, 26%) 1fr 360px",
      background: "linear-gradient(to bottom, rgba(15, 23, 42, 0.96), rgba(8, 13, 26, 0.98))",
      borderTop: "1px solid rgba(96, 165, 250, 0.35)",
      boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.45)",
      color: "#e2e8f0",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      <Section title="戰報" icon={<ScrollText size={13} />} padded={false}>
        <EngagementLog fill />
      </Section>
      <Section divider>
        <ConsoleUnitInfo />
      </Section>
      <Section divider title="指令">
        <CommandCard />
      </Section>
    </div>
  );
}

function Section({ title, icon, divider = false, padded = true, children }: {
  title?: string; icon?: React.ReactNode; divider?: boolean; padded?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{
      minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column",
      borderLeft: divider ? "1px solid rgba(148, 163, 184, 0.18)" : undefined,
    }}>
      {title && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 12px 4px", fontSize: 12, letterSpacing: 2, fontWeight: 700, color: "#60a5fa",
        }}>
          {icon}{title}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: padded ? (title ? "0 12px 10px" : "10px 14px") : 0 }}>
        {children}
      </div>
    </div>
  );
}
