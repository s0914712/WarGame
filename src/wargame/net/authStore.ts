/**
 * 兵棋登入狀態 external store（Email magic link + Google OAuth）。
 *
 * snapshot 為穩定參考：只有 session / profile 真的變才換新物件
 * （useSyncExternalStore 規則，否則無限 re-render）。
 */
import type { Session } from "@supabase/supabase-js";
import { wgSupabase } from "./wgSupabase";

export interface AuthSnapshot {
  ready: boolean;
  userId: string | null;
  email: string | null;
  displayName: string | null;
}

type Listener = () => void;

let snap: AuthSnapshot = { ready: !wgSupabase, userId: null, email: null, displayName: null };
const listeners = new Set<Listener>();

function set(next: AuthSnapshot) {
  if (
    next.ready === snap.ready && next.userId === snap.userId &&
    next.email === snap.email && next.displayName === snap.displayName
  ) return;
  snap = next;
  for (const cb of listeners) cb();
}

async function applySession(session: Session | null) {
  if (!session) {
    set({ ready: true, userId: null, email: null, displayName: null });
    return;
  }
  const u = session.user;
  const meta = u.user_metadata as Record<string, string | undefined>;
  let displayName = meta.full_name ?? meta.name ?? u.email?.split("@")[0] ?? "player";
  // 先以 metadata 名稱更新，再讀 wg_profiles（使用者可能改過）
  set({ ready: true, userId: u.id, email: u.email ?? null, displayName });
  const { data } = await wgSupabase!
    .from("wg_profiles").select("display_name").eq("user_id", u.id).maybeSingle();
  if (data?.display_name) {
    displayName = data.display_name as string;
    set({ ...snap, displayName });
  }
}

if (wgSupabase) {
  wgSupabase.auth.getSession().then(({ data }) => applySession(data.session));
  wgSupabase.auth.onAuthStateChange((_evt, session) => {
    // callback 內不可 await supabase 呼叫（會 deadlock），丟到下一輪
    setTimeout(() => applySession(session), 0);
  });
}

/** 登入完成後回到兵棋模式（GitHub Pages 需帶 base path） */
function redirectUrl(): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  base.searchParams.set("mode", "wargame");
  return base.toString();
}

export const authStore = {
  get(): AuthSnapshot { return snap; },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  async signInWithEmail(email: string): Promise<string | null> {
    if (!wgSupabase) return "Supabase 未設定";
    const { error } = await wgSupabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl() },
    });
    return error?.message ?? null;
  },

  async signInWithGoogle(): Promise<string | null> {
    if (!wgSupabase) return "Supabase 未設定";
    const { error } = await wgSupabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectUrl() },
    });
    return error?.message ?? null;
  },

  async signOut(): Promise<void> {
    await wgSupabase?.auth.signOut();
  },

  async setDisplayName(name: string): Promise<string | null> {
    if (!wgSupabase || !snap.userId) return "未登入";
    const trimmed = name.trim().slice(0, 32);
    if (!trimmed) return "名稱不可空白";
    const { error } = await wgSupabase
      .from("wg_profiles").update({ display_name: trimmed }).eq("user_id", snap.userId);
    if (!error) set({ ...snap, displayName: trimmed });
    return error?.message ?? null;
  },
};
