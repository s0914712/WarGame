/**
 * 攻擊優序 —— 使用者對「每一類目標」率定攻擊優先程度，取代自動交戰的「打最近」。
 *
 * 每個陣營一張表（Side.targetPriority）：
 *   - weights：9 類目標各 0–5 分；0 = 不主動攻擊（仍可用明確 engage 命令打）
 *   - blend  ：0–1，自動選目標時「優序」與「距離」的權衡
 *              0 = 只看距離（等同未設定優序的原行為，但仍排除 0 分類別）
 *              1 = 只看優序，同分才比距離
 *
 * 評分：score = blend · (w / 5) − (1 − blend) · (d / R)
 *   w = 類別分數、d = 距離、R = 攻擊方射程（候選目標已在武器射程內，d/R ∈ [0, 1]）。
 *   預設 blend 0.7：差 1 分（0.14）要距離差超過約 47% 射程才會被距離蓋過。
 *
 * 未設定 targetPriority 的陣營完全維持原本「最近目標」行為 —— 舊場景結果不變。
 * 純函式、零 browser 依賴（engine / MCP server 共用）。
 */
import type { UnitKind } from "../types";

export type TargetCategory =
  | "amphibious"        // 登陸 / 兩棲
  | "air_defense"       // 防空
  | "sensor"            // 雷達 / 感測
  | "base_logistics"    // 基地 / 後勤
  | "surface_combatant" // 水面作戰艦
  | "submarine"         // 潛艦
  | "aircraft"          // 戰機 / 直升機
  | "uav"               // 無人機
  | "missile_launcher"; // 飛彈車

export const TARGET_CATEGORIES: TargetCategory[] = [
  "amphibious", "air_defense", "sensor", "base_logistics",
  "surface_combatant", "submarine", "aircraft", "uav", "missile_launcher",
];

export const CATEGORY_OF: Record<UnitKind, TargetCategory> = {
  landing_ship: "amphibious",
  sam_coastal: "air_defense",
  sam_patriot: "air_defense",
  radar_station: "sensor",
  mobile_radar: "sensor",
  airbase: "base_logistics",
  supply_ship: "base_logistics",
  ship_surface: "surface_combatant",
  submarine: "submarine",
  fighter: "aircraft",
  asw_helo: "aircraft",
  drone: "uav",
  uav_ruiyuan: "uav",
  uav_ruihuo: "uav",
  sowa: "uav",
  mowa: "uav",
  missile_launcher: "missile_launcher",
};

/** 各類別包含的單位種類（UI 說明用） */
export function kindsOf(cat: TargetCategory): UnitKind[] {
  return (Object.keys(CATEGORY_OF) as UnitKind[]).filter((k) => CATEGORY_OF[k] === cat);
}

export const MAX_PRIORITY = 5;
export const DEFAULT_WEIGHT = 3;
export const DEFAULT_BLEND = 0.7;

export interface TargetPriorityProfile {
  /** 0–5；省略的類別視為 DEFAULT_WEIGHT */
  weights: Partial<Record<TargetCategory, number>>;
  /**
   * 依攻擊方覆寫（攻擊方類別 → 目標類別 → 0–5）。沒寫的格沿用 weights。
   * 例：防空（SAM）對戰機 / 無人機設 5，即使全陣營把無人機設 0 —— 只有打擊載具不打無人機。
   */
  byShooter?: Partial<Record<TargetCategory, Partial<Record<TargetCategory, number>>>>;
  /** 0–1：0 = 只看距離、1 = 只看優序 */
  blend: number;
  /** 套用的範本 id（UI 標示用；手動改過任一類別後清掉） */
  presetId?: TargetPriorityPresetId;
}

export type TargetPriorityPresetId = "balanced" | "anti_landing" | "air_superiority" | "sea_control";

export const TARGET_PRIORITY_PRESETS: Record<TargetPriorityPresetId, {
  zh: string; en: string; descZh: string; descEn: string; weights: Record<TargetCategory, number>;
}> = {
  balanced: {
    zh: "均衡", en: "Balanced",
    descZh: "所有類別同分 —— 實際上就是打最近的目標",
    descEn: "All categories equal — effectively engages the nearest target",
    weights: {
      amphibious: 3, air_defense: 3, sensor: 3, base_logistics: 3, surface_combatant: 3,
      submarine: 3, aircraft: 3, uav: 3, missile_launcher: 3,
    },
  },
  anti_landing: {
    zh: "反登陸", en: "Anti-landing",
    descZh: "登陸艦最優先，其次護航水面艦與補給；無人機不浪費彈藥",
    descEn: "Landing ships first, then escorts and logistics; don't waste rounds on UAVs",
    weights: {
      amphibious: 5, air_defense: 2, sensor: 2, base_logistics: 4, surface_combatant: 4,
      submarine: 2, aircraft: 2, uav: 1, missile_launcher: 3,
    },
  },
  air_superiority: {
    zh: "奪取制空（SEAD）", en: "Air superiority (SEAD)",
    descZh: "先壓制防空與雷達，再打機場與戰機",
    descEn: "Suppress air defences and radars first, then airbases and fighters",
    weights: {
      amphibious: 2, air_defense: 5, sensor: 5, base_logistics: 4, surface_combatant: 2,
      submarine: 1, aircraft: 4, uav: 2, missile_launcher: 3,
    },
  },
  sea_control: {
    zh: "制海", en: "Sea control",
    descZh: "水面作戰艦與潛艦優先，其次登陸艦與補給",
    descEn: "Surface combatants and submarines first, then amphibious ships and logistics",
    weights: {
      amphibious: 4, air_defense: 2, sensor: 2, base_logistics: 3, surface_combatant: 5,
      submarine: 5, aircraft: 2, uav: 1, missile_launcher: 2,
    },
  },
};

export function presetProfile(id: TargetPriorityPresetId, blend = DEFAULT_BLEND): TargetPriorityProfile {
  return { weights: { ...TARGET_PRIORITY_PRESETS[id].weights }, blend, presetId: id };
}

/**
 * 陣營優序的文字摘要（給 LLM / MCP 狀態匯出）：高到低排列，0 分類別列為不攻擊。
 */
export function describeProfile(profile: TargetPriorityProfile): {
  ranked: { category: TargetCategory; weight: number }[];
  doNotEngage: TargetCategory[];
  blend: number;
  presetId?: TargetPriorityPresetId;
  byShooter?: TargetPriorityProfile["byShooter"];
} {
  const all = TARGET_CATEGORIES.map((c) => ({ category: c, weight: clampWeight(profile.weights[c] ?? DEFAULT_WEIGHT) }));
  return {
    ranked: all.filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight),
    doNotEngage: all.filter((x) => x.weight === 0).map((x) => x.category),
    blend: profile.blend,
    presetId: profile.presetId,
    byShooter: profile.byShooter && Object.keys(profile.byShooter).length > 0 ? profile.byShooter : undefined,
  };
}

/**
 * 目標類別分數。給了 shooterKind 時先查該攻擊方類別的覆寫，沒有再用陣營預設。
 */
export function weightOf(profile: TargetPriorityProfile, kind: UnitKind, shooterKind?: UnitKind): number {
  const cat = CATEGORY_OF[kind];
  const override = shooterKind ? profile.byShooter?.[CATEGORY_OF[shooterKind]]?.[cat] : undefined;
  const w = override ?? profile.weights[cat];
  return clampWeight(w ?? DEFAULT_WEIGHT);
}

function clampWeight(w: number): number {
  return Math.max(0, Math.min(MAX_PRIORITY, Number.isFinite(w) ? w : DEFAULT_WEIGHT));
}

/**
 * 候選目標的分數（越高越優先）；null = 此陣營設定不主動攻擊這類目標。
 * @param distKm   攻擊方到目標距離
 * @param rangeKm  攻擊方射程（正規化距離用；≤0 時以 distKm 本身代替）
 */
export function targetScore(
  profile: TargetPriorityProfile, targetKind: UnitKind, distKm: number, rangeKm: number,
  shooterKind?: UnitKind,
): number | null {
  const w = weightOf(profile, targetKind, shooterKind);
  if (w <= 0) return null;
  const b = Math.max(0, Math.min(1, profile.blend));
  const dNorm = rangeKm > 0 ? distKm / rangeKm : distKm;
  // b = 1 時距離權重為 0 —— 保留極小的距離項當同分決勝
  return b * (w / MAX_PRIORITY) - Math.max(1 - b, 1e-6) * dNorm;
}
