/**
 * 多人對戰登入：Email magic link + Google OAuth。
 */
import { useState } from "react";
import { Mail, LogIn } from "lucide-react";
import { authStore } from "../wargame/net/authStore";

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  padding: "10px 12px", borderRadius: 6,
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(2, 6, 23, 0.6)", color: "#e2e8f0",
  fontSize: 16, fontFamily: "inherit",
};

export const btnStyle = (accent: string, disabled = false): React.CSSProperties => ({
  padding: "10px 16px", borderRadius: 6,
  border: `1px solid ${accent}`,
  background: disabled ? "rgba(30, 41, 59, 0.4)" : `${accent}33`,
  color: disabled ? "#64748b" : "#e2e8f0",
  fontSize: 15, fontWeight: 600, fontFamily: "inherit",
  cursor: disabled ? "not-allowed" : "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
});

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sendLink = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setMsg({ ok: false, text: "請輸入有效 Email" });
      return;
    }
    setBusy(true);
    const err = await authStore.signInWithEmail(email.trim());
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `登入連結已寄到 ${email}，請到信箱點擊連結。` });
  };

  const google = async () => {
    setBusy(true);
    const err = await authStore.signInWithGoogle();
    // 成功會整頁跳轉；只有失敗才會回到這裡
    setBusy(false);
    if (err) setMsg({ ok: false, text: err });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
      <div style={{ fontSize: 15, color: "#94a3b8" }}>
        多人對戰需要登入，以便辨識玩家與保存戰績。
      </div>
      <button onClick={google} disabled={busy} className="wg-btn" style={btnStyle("#60a5fa", busy)}>
        <LogIn size={16} /> 使用 Google 登入
      </button>
      <div style={{ fontSize: 13, color: "#64748b", textAlign: "center" }}>或</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void sendLink(); }}
          style={inputStyle}
        />
        <button onClick={sendLink} disabled={busy} className="wg-btn" style={btnStyle("#a78bfa", busy)}>
          <Mail size={16} /> 寄送登入連結
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: 14, color: msg.ok ? "#86efac" : "#fca5a5" }}>{msg.text}</div>
      )}
    </div>
  );
}

export { inputStyle };
