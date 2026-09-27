/**
 * 資產能力表共用定義（assets-export / assets-import）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoreAttributes, Unit } from "../../src/wargame/types";
import type { LoadoutEntry } from "../../src/wargame/catalog/assetOverrides";
import { initUnitWeapons } from "../../src/wargame/catalog/weapons";
import { UNIT_CATALOG } from "../../src/wargame/catalog/units";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const XLSX_PATH = path.join(ROOT, "wargame-assets.xlsx");
export const GENERATED_PATH = path.join(ROOT, "src/wargame/catalog/assetOverrides.generated.ts");

export const SHEET = {
  readme: "說明",
  kinds: "單位類型",
  loadout: "類型武器掛載",
  weapons: "武器",
  units: "場景單位",
} as const;

/** 可編輯的 core 欄位：[欄位, 表頭] */
export const CORE_COLS: [keyof CoreAttributes, string][] = [
  ["detectionRangeKm", "偵蒐距離 (km)"],
  ["rangeKm", "打擊距離 (km)"],
  ["speedKnots", "最大速度 (kn)"],
  ["movementRangeKm", "航程 (km)"],
  ["hpMax", "耐損 HP"],
];

export const DOMAINS = ["air", "sea", "land", "subsurface"] as const;
export const PROFILES = ["sea_skim", "cruise", "pop_up", "ballistic"] as const;

/** 武器掛載文字：「asm×2, torpedo×2@15」；無武器 = 「無」 */
export function formatLoadout(list: LoadoutEntry[]): string {
  if (list.length === 0) return "無";
  return list.map((l) => `${l.weaponId}×${l.ammoMax}${l.rangeKm != null ? `@${l.rangeKm}` : ""}`).join(", ");
}

export function parseLoadout(text: string): LoadoutEntry[] {
  const t = text.trim();
  if (t === "" || t === "無" || t.toLowerCase() === "none") return [];
  return t.split(/[,，;；]/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^([A-Za-z_][\w]*)\s*[×xX*]\s*(\d+)\s*(?:@\s*(\d+(?:\.\d+)?)\s*(?:km)?)?$/);
    if (!m) throw new Error(`武器掛載格式錯誤：「${part}」（應為 武器代碼×彈數 或 武器代碼×彈數@射程km）`);
    return { weaponId: m[1]!, ammoMax: Number(m[2]), ...(m[3] != null ? { rangeKm: Number(m[3]) } : {}) };
  });
}

/** 單位目前的有效掛載（與 scenarioStore.loadScenario 相同的初始化路徑） */
export function effectiveLoadout(u: Unit): LoadoutEntry[] {
  const w = initUnitWeapons(u, UNIT_CATALOG[u.kind].defaultLoadout).weapons ?? [];
  return w.map((m) => ({ weaponId: m.weaponId, ammoMax: m.ammoMax, ...(m.rangeKm != null ? { rangeKm: m.rangeKm } : {}) }));
}

/** catalog 掛載 → LoadoutEntry（"core" 射程 = 省略）；無 loadout 但有彈 = 合成主武器 */
export function kindLoadout(entry: { defaultLoadout?: { weaponId: string; ammoMax: number; rangeKm?: number | "core" }[]; defaultAmmoMax: number }): LoadoutEntry[] {
  if (entry.defaultLoadout && entry.defaultLoadout.length > 0) {
    return entry.defaultLoadout.map((l) => ({
      weaponId: l.weaponId, ammoMax: l.ammoMax, ...(typeof l.rangeKm === "number" ? { rangeKm: l.rangeKm } : {}),
    }));
  }
  return entry.defaultAmmoMax > 0 ? [{ weaponId: "__primary__", ammoMax: entry.defaultAmmoMax }] : [];
}

export function sameLoadout(a: LoadoutEntry[], b: LoadoutEntry[]): boolean {
  return formatLoadout(a) === formatLoadout(b);
}
