/**
 * UI 速查表 — 一頁列出所有介面元素 + 功能。
 * 比 walk-through 教學更詳盡，給已熟悉的人快速 reference。
 */
import { useEffect } from "react";
import { X, Keyboard, BookOpen } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Entry {
  area: string;
  items: { label: string; desc: string }[];
}

const ENTRIES: Entry[] = [
  {
    area: "頂部",
    items: [
      { label: "🛡 戰況統計（中央）", desc: "雙方存活 / 擊毀 / 戰役時長。數字變化會跳動提示。" },
      { label: "🗺 底圖切換", desc: "暗色 / 衛星 / 地形 / 街道等 7 種樣式。" },
      { label: "⚔ 場景選單", desc: "切換 5 個場景（含美軍戰鬥群 / 巴士海峽封鎖）。" },
      { label: "POV 切換", desc: "從藍 / 紅 / 中立 / 全局視角看戰場。切換後 FoW / 雷達 / LLM state 全跟著轉。" },
    ],
  },
  {
    area: "左上時鐘",
    items: [
      { label: "▶ / ⏸ 播放暫停", desc: "鍵盤 Space。" },
      { label: "1× / 5× / 30× / 60× 速率", desc: "鍵盤 1 / 2 / 3 / 4。60× 下 1 秒 wall = 1 分鐘 sim。" },
      { label: "FoW 開關（眼睛 icon）", desc: "ON：未偵測敵方完全隱身。OFF：淡化顯示（除錯用）。" },
    ],
  },
  {
    area: "左側",
    items: [
      { label: "📋 Plan Mode", desc: "展開後可選陣營 + 9 種單位 → 點地圖放單位。可匯出場景 JSON。" },
    ],
  },
  {
    area: "點地圖單位後 → 右側",
    items: [
      { label: "5 個屬性 slider", desc: "射程 / 速率 / 航程 / 偵測距離 / 耐損。即時調整、立刻反映到地圖（射程圈跟著縮放）。" },
      { label: "規劃航線", desc: "進規劃模式後點地圖加 waypoint。Backspace 移除上一點、Enter 套用、Esc 取消。橘色虛線預覽 + 違規地形紅色警示。" },
      { label: "清除航線", desc: "把目前 waypoint 清空、單位停下。" },
      { label: "🗑 刪除單位（Plan Mode 才出現）", desc: "從場景移除該單位。" },
    ],
  },
  {
    area: "選中單位視覺",
    items: [
      { label: "雙層脈動環（黃色）", desc: "標記當前選中。" },
      { label: "紅圈 / 黃圈", desc: "選中單位的武器射程 / 偵測距離。" },
      { label: "藍 / 橘虛線航線", desc: "藍 = 已套用航線、橘 = 規劃中（待 Enter 確認）。" },
    ],
  },
  {
    area: "戰鬥視覺",
    items: [
      { label: "▰▰▰▱▱ 血條（單位上方）", desc: "6 段，綠 > 70%、黃 30~70%、紅 < 30%。" },
      { label: "橘色亮點 + 白橘拖尾", desc: "飛彈飛行中。" },
      { label: "黃色擴散圓", desc: "命中爆炸（6 sec 漸消）；灰色 = 落空。" },
      { label: "✗ 殘骸", desc: "擊毀單位留下 30 秒 marker（依陣營色）。" },
      { label: "青色 / 紅色虛線大圓", desc: "雷達常駐偵測圈（按陣營著色）。" },
      { label: "黃色虛線", desc: "雷達 datalink → 已偵測敵方。" },
    ],
  },
  {
    area: "左下",
    items: [
      { label: "戰報", desc: "捲動式事件 log，最近 50 條。摺疊可點頂部箭頭。" },
      { label: "🖥 Demo Mode", desc: "進入後隱藏所有控制 UI，只留地圖 + 戰況 + Esc 退出鈕。對外 demo 用。" },
    ],
  },
  {
    area: "右下",
    items: [
      { label: "🎓 教學重啟", desc: "重新跑 8 步 walk-through。" },
      { label: "🤖 LLM 介接", desc: "4 分頁 modal：當前狀態 / 套用指令 / Schema / 🤖 自動駕駛（讓 LLM 控紅方）。" },
      { label: "● REC 錄製 / 📂 載入 replay", desc: "錄製場景每 10 sim sec snapshot；可下載 JSON 跨機分享。" },
    ],
  },
];

const SHORTCUTS = [
  { key: "Space", action: "暫停 / 繼續" },
  { key: "1 / 2 / 3 / 4", action: "切速率 1× / 5× / 30× / 60×" },
  { key: "Esc", action: "退出 Plan Mode / 規劃航線 / Demo / 教學" },
  { key: "Enter", action: "規劃航線時套用" },
  { key: "Backspace", action: "規劃航線時移除上一點" },
  { key: "→ / ←", action: "教學 / 規劃模式內 next / prev" },
];

export function UICheatSheet({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 145,
        background: "rgba(2, 6, 23, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        className="wg-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)",
          maxHeight: "88vh",
          background: "rgba(15, 23, 42, 0.98)",
          border: "1px solid rgba(148, 163, 184, 0.3)",
          borderRadius: 14,
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{
          padding: "18px 24px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BookOpen size={20} color="#60a5fa" />
            <span style={{ fontSize: 26, fontWeight: 700 }}>介面說明（速查表）</span>
          </div>
          <button onClick={onClose} className="wg-btn" style={{
            background: "transparent", border: "none", color: "#94a3b8",
            cursor: "pointer", padding: 4,
          }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
          {/* 鍵盤捷徑（先放最上面） */}
          <div style={{ marginBottom: 18 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 16, fontWeight: 600, color: "#60a5fa",
              letterSpacing: 1, marginBottom: 8,
            }}>
              <Keyboard size={14} /> 鍵盤捷徑
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "auto 1fr",
              gap: "6px 16px", fontSize: 17,
            }}>
              {SHORTCUTS.map(({ key, action }) => (
                <>
                  <kbd key={`k-${key}`} style={kbdStyle}>{key}</kbd>
                  <span style={{ color: "#cbd5e1" }}>{action}</span>
                </>
              ))}
            </div>
          </div>

          {/* UI 元素區塊 */}
          {ENTRIES.map((section) => (
            <div key={section.area} style={{ marginBottom: 18 }}>
              <div style={{
                fontSize: 16, fontWeight: 600, color: "#60a5fa",
                letterSpacing: 1, marginBottom: 8,
              }}>
                {section.area}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {section.items.map((item, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "180px 1fr",
                    gap: 12, fontSize: 17, lineHeight: 1.55,
                  }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{item.label}</span>
                    <span style={{ color: "#94a3b8" }}>{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: "12px 24px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          display: "flex", justifyContent: "flex-end",
        }}>
          <button onClick={onClose} className="wg-btn" style={{
            padding: "8px 18px",
            background: "#3b82f6", color: "#fff",
            border: "none", borderRadius: 6,
            fontSize: 17, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit",
          }}>
            知道了 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "rgba(30, 41, 59, 0.8)",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  borderBottom: "2px solid rgba(148, 163, 184, 0.5)",
  borderRadius: 4,
  fontSize: 15,
  fontFamily: "ui-monospace, monospace",
  color: "#cbd5e1",
  whiteSpace: "nowrap",
};
