/**
 * NATO MIL-STD-2525C / APP-6 SIDC 對照表。
 *
 * 使用 15 字元 2525C 格式（milsymbol 兼容）。比 APP-6E 20 字元簡單。
 *
 * 欄位語意：
 *   位 1：scheme (S = war fighting)
 *   位 2：affiliation (F=Friend, H=Hostile, N=Neutral)
 *   位 3：battle dimension (G=Ground, A=Air, S=Sea Surface)
 *   位 4：status (P=Present)
 *   位 5-10：function id（看下方各 unit type）
 *   位 11-15：符號修飾與國別（保留 -）
 */
import type { SideId, UnitKind } from "../types";

const AFFIL_CHAR: Record<SideId, string> = {
  blue:    "F",   // Friend
  red:     "H",   // Hostile
  neutral: "N",   // Neutral
  us:      "F",   // 美軍同 Friend 框，靠 colorMode override 區分顏色
  japan:   "F",
};

interface SidcTemplate {
  dimension: string;     // 位 3
  functionId: string;    // 位 5-10
}

const TEMPLATES: Record<UnitKind, SidcTemplate> = {
  // 飛彈發射車 — Ground Equipment, Weapon, Missile/Rocket Launcher
  missile_launcher: { dimension: "G", functionId: "EWMSL-" },

  // 無人機 — Air, Military, Fixed-wing, Reconnaissance (UAV)
  drone: { dimension: "A", functionId: "MFQ---" },

  // 船艦 — Sea Surface, Combatant Line
  ship_surface: { dimension: "S", functionId: "CL----" },

  // 潛艦 — Subsurface, Submarine
  submarine: { dimension: "U", functionId: "SU----" },

  // 戰機 — Air, Military, Fixed-wing, Fighter
  fighter: { dimension: "A", functionId: "MFF---" },

  // 雷達站 — Ground Equipment, Sensor, Radar
  radar_station: { dimension: "G", functionId: "ESR---" },

  // 海岸 SAM 車 — Ground Equipment, Weapon, Air Defense Medium SAM
  sam_coastal: { dimension: "G", functionId: "EWAM--" },

  // 機動雷達車 — Ground Equipment, Sensor, Surveillance
  mobile_radar: { dimension: "G", functionId: "ESS---" },

  // 愛國者 SAM — Ground Equipment, Weapon, Air Defense Heavy SAM
  sam_patriot: { dimension: "G", functionId: "EWAH--" },

  // 補給艦 — Sea Surface, Combatant Auxiliary, Combat Support (CS / AKE / AOE)
  supply_ship: { dimension: "S", functionId: "NSU---" },

  // 空軍基地 — Ground Installation, Airfield Base
  airbase: { dimension: "G", functionId: "IBA---" },
};

export function buildSidc(kind: UnitKind, side: SideId): string {
  const t = TEMPLATES[kind];
  const affil = AFFIL_CHAR[side];
  // S + F/H/N + dim + P + funcId(6) + ----- = 15 chars
  return `S${affil}${t.dimension}P${t.functionId}-----`;
}

/** 全部 (kind × side) 組合。啟動時一次性生成。 */
const ALL_KINDS: UnitKind[] = [
  "missile_launcher", "drone", "ship_surface",
  "submarine", "fighter", "radar_station",
  "sam_coastal", "mobile_radar", "sam_patriot",
  "supply_ship", "airbase",
];

const ALL_SIDES: SideId[] = ["blue", "red", "neutral", "us", "japan"];

export const ALL_SIDC_VARIANTS: { kind: UnitKind; side: SideId; sidc: string; iconName: string }[] =
  ALL_KINDS.flatMap((kind) =>
    ALL_SIDES.map((side) => ({
      kind,
      side,
      sidc: buildSidc(kind, side),
      iconName: `wg-${kind}-${side}`,
    })),
  );

/** UnitKind + SideId → Mapbox image registry 中的 icon name */
export function iconNameOf(kind: UnitKind, side: SideId): string {
  return `wg-${kind}-${side}`;
}
