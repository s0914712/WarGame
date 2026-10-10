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
    area: "頂部資訊列（左→右）",
    items: [
      { label: "▶ / ⏸ 播放暫停", desc: "鍵盤 Space。" },
      { label: "1× / 5× / 30× / 60× 速率", desc: "鍵盤 1 / 2 / 3 / 4。60× 下 1 秒 wall = 1 分鐘 sim。" },
      { label: "🛡 戰況統計", desc: "雙方存活 / 擊毀。數字變化會跳動提示。" },
      { label: "⚔ 場景選單", desc: "切換場景（多人對戰中隱藏）。" },
      { label: "● 視角（POV）", desc: "從藍 / 紅 / 中立 / 全局視角看戰場。切換後 FoW / 雷達 / LLM state 全跟著轉。" },
      { label: "⬡ 六角格", desc: "開啟兵棋六角格（每格 ≈ 100 km²）與勢力範圍工具：選陣營後左鍵拖曳塗格、擦除 / 清除；依場景存於本機。" },
      { label: "FoW", desc: "ON：未偵測敵方完全隱身。OFF：淡化顯示（除錯用）。" },
      { label: "中 / EN、LLM", desc: "語言切換；LLM 介接（當前狀態 / 套用指令 / Schema / AI 對手）。" },
      { label: "☰ 選單", desc: "底圖樣式、● 錄製 / 📂 載入回放、Plan Mode、場景簡報、教學、本說明、展示模式、返回主選單。" },
    ],
  },
  {
    area: "底部控制台 · 左：戰報",
    items: [
      { label: "戰報", desc: "偵測 / 開火 / 命中 / 擊毀依時間捲動，最近 50 條。可篩選 全部 / 交戰 / 偵測；點事件＝選取並跟隨該單位。" },
    ],
  },
  {
    area: "底部控制台 · 中：選中單位",
    items: [
      { label: "HP / 油料 / 彈藥", desc: "狀態條；航向羅盤、航速、座標、各武器彈量與裝填狀態、接戰目標。" },
      { label: "敵方接觸", desc: "偵測狀態、定位品質、估計損傷（僅目視識別）、最近己方距離 / 方位、可打擊的己方單位數。" },
      { label: "規劃航線模式", desc: "橘色提示列顯示航點數、距離、ETA、剩餘油料與違規警示。" },
      { label: "⚙ 屬性（單人）", desc: "彈出 5 個屬性 slider（射程 / 速率 / 航程 / 偵測 / 耐損），即時生效。" },
      { label: "🗑 刪除單位（Plan Mode）", desc: "從場景移除該單位；鍵盤 Delete，Ctrl+Z 可復原。" },
    ],
  },
  {
    area: "底部控制台 · 右：指令卡",
    items: [
      { label: "R 航線", desc: "進規劃模式後點地圖加航點；Backspace 移除上一點、Enter 套用、Esc 取消。" },
      { label: "C 清線 / H 停止", desc: "清空目前航線 / 原地停止並清線。" },
      { label: "F / T / D / G 交戰規則", desc: "自由接戰 / 限制接戰 / 僅防禦 / 停止接戰。亮框 = 目前 ROE。" },
      { label: "S 聲納 / Y 拖曳 / B 聲標", desc: "主動聲納開關、拖曳陣列收放、佈放聲標反潛屏幕（依單位能力啟用）。" },
      { label: "A 攻擊", desc: "按 A 後左鍵點敵方單位＝接戰；點空白或 Esc＝取消。也可直接右鍵點敵方。" },
      { label: "右鍵 移動", desc: "右鍵地圖＝立即前往；Shift＋右鍵＝排隊航點；右鍵敵方＝接戰。" },
    ],
  },
  {
    area: "任務目標與警示",
    items: [
      { label: "🚩 任務目標（左下）", desc: "己方目標進度 + 敵方目標（要阻止的）+ 剩餘時間；點有定位的目標＝鏡頭飛過去。" },
      { label: "虛線目標區", desc: "需控制的區域；標籤顯示控制進度，紅框＝敵方在區內爭奪。" },
      { label: "紅環 / 金環", desc: "紅＝我方要擊毀的目標；金＝我方要保護的單位。" },
      { label: "⚠ 來襲警示（頂部）", desc: "我方單位遭攻擊彈鎖定：紅色脈動環 + 警示列，點警示列依序選取受威脅單位。" },
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
      { label: "彈體亮點 + 彗星拖尾", desc: "橘＝飛彈、黃＝砲彈、藍綠＝魚雷、青＝攔截彈。" },
      { label: "浮動數字", desc: "−54＝命中傷害、擊毀、攔截、MISS。" },
      { label: "黃色擴散圓", desc: "命中爆炸（6 sec 漸消）；灰色 = 落空。" },
      { label: "✗ 殘骸", desc: "擊毀單位留下 30 秒 marker（依陣營色）。" },
      { label: "青色 / 紅色虛線大圓", desc: "雷達常駐偵測圈（按陣營著色）。" },
      { label: "黃色虛線", desc: "雷達 datalink → 已偵測敵方。" },
    ],
  },
];

const SHORTCUTS = [
  { key: "Space", action: "暫停 / 繼續" },
  { key: "Tab / Shift+Tab", action: "輪選己方單位" },
  { key: "1 / 2 / 3 / 4", action: "切速率 1× / 5× / 30× / 60×" },
  { key: "Esc", action: "退出 Plan Mode / 規劃航線 / 六角格塗色 / Demo / 教學" },
  { key: "Enter", action: "規劃航線時套用" },
  { key: "Backspace", action: "規劃航線時移除上一點" },
  { key: "R / C / H / A", action: "選中單位：規劃航線 / 清線 / 停止 / 攻擊（再點敵方）" },
  { key: "Delete / Backspace", action: "Plan Mode 刪除選中單位（放下的單位會自動選中）；規劃航線時移除上一點" },
  { key: "Ctrl+Z", action: "復原上一動（最多 1 次）：指令 / 刪除 / 放置單位" },
  { key: "Esc", action: "取消攻擊選標 / 取消選取單位" },
  { key: "?", action: "開啟本速查表" },
  { key: "F / T / D / G", action: "交戰規則：自由 / 限制 / 防禦 / 停火" },
  { key: "S / Y / B", action: "主動聲納 / 拖曳陣列 / 佈聲標" },
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
