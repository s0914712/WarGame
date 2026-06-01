/**
 * Replay 控制面板（右下角，LLM 按鈕旁邊）。
 *
 * 三種狀態：
 *   1. 待機：[● REC] 開始錄影
 *   2. 錄影中：[⏹ STOP & SAVE]（會自動下載 JSON）
 *   3. 載入 replay：scrub bar + ▶ 上一張/下一張 + 退出
 *
 * 不影響原本玩法 — REC 是 opt-in，replay 不啟動就跟沒這功能一樣。
 */
import { useRef, useSyncExternalStore } from "react";
import { Circle, Square, FolderOpen, ChevronLeft, ChevronRight, X, Film } from "lucide-react";
import { recorderStore } from "../wargame/replay/recorder";
import { replayPlayer, loadRecordingFromFile } from "../wargame/replay/player";
import { formatTPlus } from "../wargame/clock";

interface Snapshot {
  isRecording: boolean;
  snapshotCount: number;
  durationSec: number;
  replayActive: boolean;
  replayIndex: number;
  replayTotal: number;
}

let cached: Snapshot = build();

function build(): Snapshot {
  return {
    isRecording: recorderStore.isRecording(),
    snapshotCount: recorderStore.getSnapshotCount(),
    durationSec: recorderStore.getDurationSec(),
    replayActive: replayPlayer.isActive(),
    replayIndex: replayPlayer.getCurrentIndex(),
    replayTotal: replayPlayer.getSnapshotCount(),
  };
}

function getSnapshot(): Snapshot {
  const next = build();
  // 注意 durationSec 會隨時間累計；只在 isRecording 變化或計數變化時更新 cache
  if (
    next.isRecording !== cached.isRecording ||
    next.snapshotCount !== cached.snapshotCount ||
    next.replayActive !== cached.replayActive ||
    next.replayIndex !== cached.replayIndex ||
    next.replayTotal !== cached.replayTotal
  ) {
    cached = next;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  const u1 = recorderStore.subscribe(cb);
  const u2 = replayPlayer.subscribe(cb);
  // recorder 的 durationSec 變化不會 notify；用 interval 補一個
  const t = window.setInterval(cb, 1000);
  return () => { u1(); u2(); window.clearInterval(t); };
}

export function ReplayPanel({ embedded = false }: { embedded?: boolean } = {}) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const s = getSnapshot();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const rec = await loadRecordingFromFile(file);
    if (rec) replayPlayer.load(rec);
    else alert("無法載入：檔案不是有效的 wargame-replay-v1");
    e.target.value = "";
  };

  return (
    <div
      style={embedded ? {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        fontSize: 16,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        width: "100%",
      } : {
        position: "absolute",
        bottom: 16,
        right: 156,                 // LLM 按鈕左側
        zIndex: 25,
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
        fontSize: 16,
      }}
    >
      {/* Replay 模式：scrub bar + 控制 */}
      {s.replayActive && (
        <>
          <span style={{ color: "#fbbf24", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
            <Film size={14} /> REPLAY
          </span>
          <button onClick={() => replayPlayer.prev()} style={btnSmall} className="wg-btn" title="上一張">
            <ChevronLeft size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, s.replayTotal - 1)}
            value={s.replayIndex}
            onChange={(e) => replayPlayer.seekToIndex(Number(e.target.value))}
            style={{ width: 140, accentColor: "#fbbf24" }}
          />
          <button onClick={() => replayPlayer.next()} style={btnSmall} className="wg-btn" title="下一張">
            <ChevronRight size={14} />
          </button>
          <span style={{ color: "#94a3b8", fontFamily: "ui-monospace, monospace", fontSize: 15 }}>
            {s.replayIndex + 1}/{s.replayTotal}
          </span>
          <button onClick={() => replayPlayer.exit()} style={btnSecondary} className="wg-btn" title="退出 replay 回到場景">
            <X size={12} /> 退出
          </button>
        </>
      )}

      {/* 錄影 / 載入控制（非 replay 模式時） */}
      {!s.replayActive && (
        <>
          {s.isRecording ? (
            <>
              <span className="wg-blink" style={{ color: "#ef4444", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                <Circle size={10} fill="#ef4444" /> REC
              </span>
              <span style={{ color: "#cbd5e1", fontFamily: "ui-monospace, monospace", fontSize: 15 }}>
                {s.snapshotCount} 張 · {formatTPlus(s.durationSec)}
              </span>
              <button onClick={() => recorderStore.downloadCurrent()} style={btnPrimary} className="wg-btn">
                <Square size={11} fill="currentColor" /> 結束並下載
              </button>
            </>
          ) : (
            <>
              <button onClick={() => recorderStore.start()} style={btnPrimary} className="wg-btn" title="開始錄製當前場景">
                <Circle size={11} fill="currentColor" /> 錄製
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={btnSecondary} className="wg-btn" title="載入 .json replay 檔">
                <FolderOpen size={12} /> 載入
              </button>
            </>
          )}
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={handleLoadFile}
      />

      <style>{`@keyframes blink { 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}

const btnSmall: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 4,
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "rgba(30, 41, 59, 0.6)", color: "#cbd5e1",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 12px",
  background: "#3b82f6", color: "#fff",
  border: "none", borderRadius: 4,
  fontSize: 16, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", gap: 5,
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px",
  background: "rgba(148, 163, 184, 0.15)", color: "#cbd5e1",
  border: "1px solid rgba(148, 163, 184, 0.3)", borderRadius: 4,
  fontSize: 16, cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", gap: 5,
};
