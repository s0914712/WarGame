/**
 * 陣營專屬單位清單（Plan Mode 放置用）。
 *
 * 有設定的陣營只能放「有真實對應裝備」的 kind，並顯示該陣營的型號名稱；
 * 未設定的陣營（blue / us / japan / iran …）列出全部 kind、沿用 catalog 名稱。
 *
 * 解放軍型號依公開資料：美國防部《中國軍力報告》、IISS Military Balance、CMSI。
 * 不列：愛國者（美製）、銳鳶 / 銳火（中科院）、sowa / mowa（國軍攻擊無人機分類）。
 */
import type { SideId, UnitKind } from "../types";
import { UNIT_CATALOG } from "./units";

const SIDE_KIND_LABELS: Partial<Record<SideId, Partial<Record<UnitKind, string>>>> = {
  red: {
    missile_launcher: "東風-17 / PHL-16 火箭砲",
    drone:            "翼龍-2 / 無偵-7",
    ship_surface:     "052D 驅逐艦",
    submarine:        "093 核潛艦",
    fighter:          "殲-16",
    radar_station:    "岸基雷達站",
    sam_coastal:      "紅旗-9B",
    mobile_radar:     "機動雷達",
    supply_ship:      "901 綜合補給艦",
    airbase:          "空軍基地",
    asw_helo:         "直-9D",
    landing_ship:     "075 / 071 兩棲艦",
  },
};

/** 該陣營可放置的 kind；null = 不限制 */
export function allowedKinds(sideId: SideId): UnitKind[] | null {
  const m = SIDE_KIND_LABELS[sideId];
  return m ? (Object.keys(m) as UnitKind[]) : null;
}

export function isKindAllowed(sideId: SideId, kind: UnitKind): boolean {
  const ks = allowedKinds(sideId);
  return !ks || ks.includes(kind);
}

export function kindLabel(sideId: SideId, kind: UnitKind): string {
  return SIDE_KIND_LABELS[sideId]?.[kind] ?? UNIT_CATALOG[kind].displayName;
}
