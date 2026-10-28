/**
 * 陣營專屬單位清單（Plan Mode 放置用）。
 *
 * 有設定的陣營只能放「有真實對應裝備」的 kind，並顯示該陣營的型號名稱；
 * 未設定的陣營（us / japan / neutral …）列出全部 kind、沿用 catalog 名稱。
 *
 * 型號依公開資料：
 *   - 解放軍：美國防部《中國軍力報告》、IISS Military Balance、CMSI。
 *     不列：愛國者（美製）、銳鳶 / 銳穫（中科院）、sowa / mowa（國軍攻擊無人機分類）。
 *   - 國軍：國防部《國防報告書》、美國 DSCA 對台軍售公告、IISS Military Balance。
 *     不列：轟炸機（國軍無此類裝備）。
 */
import type { SideId, UnitKind } from "../types";
import { UNIT_CATALOG } from "./units";

const SIDE_KIND_LABELS: Partial<Record<SideId, Partial<Record<UnitKind, string>>>> = {
  red: {
    missile_launcher: "東風-17 / 東風-26 / 鷹擊-62 岸艦",
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
    aew:              "空警-500 預警機",
    mpa:              "運-8Q 反潛機",
    bomber:           "轟-6K / 轟-6J",
    missile_boat:     "022 飛彈快艇",
    mlrs:             "PHL-16 / PCH-191 火箭砲",
  },
  blue: {
    missile_launcher: "雄風三型 / 魚叉岸置系統",
    drone:            "騰雲 / MQ-9B",
    ship_surface:     "基隆級 / 成功級 / 康定級",
    submarine:        "海鯤 / 海龍級潛艦",
    fighter:          "F-16V / 經國號",
    radar_station:    "樂山 / 固定雷達站",
    sam_coastal:      "天弓二型 / NASAMS",
    mobile_radar:     "機動雷達",
    sam_patriot:      "愛國者 PAC-3 / 天弓三型",
    supply_ship:      "磐石 / 武夷補給艦",
    airbase:          "空軍基地",
    asw_helo:         "S-70C / MH-60R",
    uav_ruiyuan:      "銳鳶 UAV",
    uav_ruihuo:       "銳穫 UAV",
    sowa:             "Switchblade 300",
    mowa:             "劍翔 / ALTIUS-700M",
    landing_ship:     "玉山艦 / 中和級",
    aew:              "E-2K 鷹眼預警機",
    mpa:              "P-3C 反潛機",
    missile_boat:     "沱江級 / 光華六號",
    mlrs:             "M142 HIMARS / 雷霆-2000",
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
