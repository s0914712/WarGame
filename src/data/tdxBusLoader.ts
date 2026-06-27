/**
 * TDX（交通部運輸資料流通服務）即時公車位置 — Supabase 未設定時的 live 來源。
 *
 * OAuth2 client_credentials 取 token（存活 86400s，含快取），再打 A1 動態定時 API
 * `/v2/Bus/RealTimeByFrequency/City/{City}`，回傳含 GPS 經緯度的即時公車。
 * 輸出對齊 busLoader 的 BusPosition[]，讓既有 busLive 圖層直接渲染。
 *
 * dev 透過 Vite proxy `/tdx` → https://tdx.transportdata.tw（避免瀏覽器 CORS）。
 * 需要 .env：VITE_TDX_CLIENT_ID / VITE_TDX_CLIENT_SECRET。
 */
import type { BusPosition, BusCity } from "../types";

const CLIENT_ID = import.meta.env.VITE_TDX_CLIENT_ID as string | undefined;
const CLIENT_SECRET = import.meta.env.VITE_TDX_CLIENT_SECRET as string | undefined;
const TDX_BASE = "/tdx"; // Vite dev proxy → https://tdx.transportdata.tw
const TOKEN_PATH = "/auth/realms/TDXConnect/protocol/openid-connect/token";

// 即時 API 計費 + 速率限制：一次最多查幾個縣市，避免全島輪詢爆量
const MAX_CITIES_PER_POLL = 3;
const TOP_PER_CITY = 600;

export const tdxConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  if (!tdxConfigured) return null;
  const now = Date.now() / 1000;
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
  });
  try {
    const res = await fetch(TDX_BASE + TOKEN_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      console.warn("[TDX] token request failed:", res.status);
      return null;
    }
    const j = await res.json();
    tokenCache = { token: j.access_token, exp: now + (j.expires_in ?? 86400) };
    return tokenCache.token;
  } catch (e) {
    console.warn("[TDX] token error:", e);
    return null;
  }
}

interface TdxBus {
  PlateNumb: string;
  RouteUID?: string;
  RouteID?: string;
  RouteName?: { Zh_tw?: string };
  Direction?: number;
  BusPosition?: { PositionLon?: number; PositionLat?: number };
  Speed?: number;
  GPSTime?: string;
}

/** 拉取指定縣市的即時公車位置（A1），對齊 BusPosition[] */
export async function fetchTdxBusCurrent(cities: BusCity[]): Promise<BusPosition[]> {
  if (!tdxConfigured || cities.length === 0) return [];
  const token = await getToken();
  if (!token) return [];

  const targets = cities.slice(0, MAX_CITIES_PER_POLL);
  const out: BusPosition[] = [];

  await Promise.all(
    targets.map(async (city) => {
      try {
        const url =
          `${TDX_BASE}/api/basic/v2/Bus/RealTimeByFrequency/City/${city}` +
          `?$top=${TOP_PER_CITY}&$format=JSON`;
        const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) {
          console.warn(`[TDX] bus ${city}: ${res.status}`);
          return;
        }
        const rows = (await res.json()) as TdxBus[];
        for (const b of rows) {
          const lon = b.BusPosition?.PositionLon;
          const lat = b.BusPosition?.PositionLat;
          if (lon == null || lat == null || (lon === 0 && lat === 0)) continue;
          out.push({
            plateNumb: b.PlateNumb,
            routeUid: b.RouteUID ?? b.RouteID ?? "",
            routeName: b.RouteName?.Zh_tw ?? "",
            direction: b.Direction ?? 0,
            lat,
            lng: lon,
            speed: b.Speed ?? 0,
            collectedAt: b.GPSTime ? new Date(b.GPSTime).getTime() / 1000 : Date.now() / 1000,
            city,
          });
        }
      } catch (e) {
        console.warn(`[TDX] bus ${city} error:`, e);
      }
    }),
  );

  console.log(`[TDX] live buses: ${out.length} (${targets.join("+")})`);
  return out;
}
