/**
 * 兵棋多人對戰專用 Supabase client。
 *
 * 與民用 src/lib/supabase.ts 分開：那個連 gis-platform（時序資料），
 * 這個連兵棋 project（auth + 房間 + Realtime）。兩者不同 project、不同 key。
 *
 * env 缺值 → wgSupabase = null，多人入口 disabled；單人模式完全不受影響。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_WG_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_WG_SUPABASE_ANON_KEY as string | undefined;

export const wgSupabaseConfigured = Boolean(URL && ANON_KEY);

export const wgSupabase: SupabaseClient | null = wgSupabaseConfigured
  ? createClient(URL!, ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // 與民用 client 的 session key 分開，避免互蓋
        storageKey: "wg-auth",
      },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;
