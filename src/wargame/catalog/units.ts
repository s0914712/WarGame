import type { UnitCatalogEntry, UnitKind } from "../types";

/**
 * v1 三種單位的目錄定義。
 *
 * 規則：
 *   - 每種單位的 domain / iconShape / defaultAltitudeM 固定
 *   - defaultCore：場景未指定就用這套
 *   - uiRanges：UnitEditorPanel 的 slider min/max/step/unit 從這裡讀
 *
 * v1 鎖死 3 種；加新種類要動 UnitKind enum + 此檔 + UnitScene 的 geometry 對照表
 */
export const UNIT_CATALOG: Record<UnitKind, UnitCatalogEntry> = {
  missile_launcher: {
    kind: "missile_launcher",
    displayName: "飛彈發射車",
    domain: "land",
    defaultAltitudeM: 0,
    iconShape: "cone",
    // 雄三 ASM 射程 150–400 km / TEL 道路 50–80 km/h / 自有感測弱
    defaultCore: {
      rangeKm: 250,
      speedKnots: 60,
      movementRangeKm: 800,
      detectionRangeKm: 30,
      hpMax: 80,
    },
    uiRanges: {
      rangeKm:          { min: 50,  max: 800,  step: 10, unit: "km" },
      speedKnots:       { min: 0,   max: 80,   step: 1,  unit: "kn" },
      movementRangeKm:  { min: 100, max: 2000, step: 50, unit: "km" },
      detectionRangeKm: { min: 0,   max: 200,  step: 10, unit: "km" },
      hpMax:            { min: 30,  max: 300,  step: 10, unit: "點" },
    },
    constraints: {
      forbidDomains: ["sea"],
      defaultPlanTimeLimitSec: 3600,
    },
    defaultAmmoMax: 4,                // 雄三 TEL 4 發
  },

  drone: {
    kind: "drone",
    displayName: "無人機",
    domain: "air",
    defaultAltitudeM: 6000,
    iconShape: "triangle_inverted",
    // 翼龍 10 / 騰雲級巡航 ~370 km/h、滯空 20+ hr、小型 AESA
    defaultCore: {
      rangeKm: 100,
      speedKnots: 180,
      movementRangeKm: 2000,
      detectionRangeKm: 200,
      hpMax: 20,
    },
    uiRanges: {
      rangeKm:          { min: 0,   max: 400,   step: 10, unit: "km" },
      speedKnots:       { min: 50,  max: 350,   step: 5,  unit: "kn" },
      movementRangeKm:  { min: 200, max: 5000,  step: 50, unit: "km" },
      detectionRangeKm: { min: 50,  max: 400,   step: 10, unit: "km" },
      hpMax:            { min: 10,  max: 100,   step: 5,  unit: "點" },
    },
    constraints: {
      defaultPlanTimeLimitSec: 14400,  // 4 hr 任務（部分機型滯空遠超此值）
      requireRoundTrip: true,
    },
    defaultAmmoMax: 2,                // UAV 通常掛 1–2 彈
  },

  ship_surface: {
    kind: "ship_surface",
    displayName: "船艦",
    domain: "sea",
    defaultAltitudeM: 0,
    iconShape: "diamond",
    // 紀德級 DDG / 成功級 FFG：Harpoon/雄三 100–200 km、Speed 30 kn、AESA 250–400 km
    defaultCore: {
      rangeKm: 150,
      speedKnots: 30,
      movementRangeKm: 8000,
      detectionRangeKm: 250,
      hpMax: 300,
    },
    uiRanges: {
      rangeKm:          { min: 0,   max: 500,    step: 10,  unit: "km" },
      speedKnots:       { min: 0,   max: 40,     step: 1,   unit: "kn" },
      movementRangeKm:  { min: 500, max: 20000,  step: 100, unit: "km" },
      detectionRangeKm: { min: 50,  max: 500,    step: 10,  unit: "km" },
      hpMax:            { min: 100, max: 1500,   step: 25,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["land"],
      defaultPlanTimeLimitSec: 14400,
    },
    defaultAmmoMax: 16,               // Aegis VLS 取捷 / Harpoon 4 + ASROC + SAM
  },

  submarine: {
    kind: "submarine",
    displayName: "潛艦",
    domain: "subsurface",
    defaultAltitudeM: -100,            // 潛航深度（負值水下）
    iconShape: "diamond",
    // Mk-48 重型魚雷 38–50 km / 潛射 ASM Harpoon ~120 km；多數場景算 50 km
    // 劍龍級水下 22 kn / 元級 041 ~20 kn；柴電耐航 ~15000 km
    defaultCore: {
      rangeKm: 50,
      speedKnots: 20,
      movementRangeKm: 15000,
      detectionRangeKm: 60,            // 被動聲納
      hpMax: 200,
    },
    uiRanges: {
      rangeKm:          { min: 0,    max: 300,    step: 5,   unit: "km" },
      speedKnots:       { min: 0,    max: 35,     step: 1,   unit: "kn" },
      movementRangeKm:  { min: 2000, max: 40000,  step: 500, unit: "km" },
      detectionRangeKm: { min: 10,   max: 200,    step: 5,   unit: "km" },
      hpMax:            { min: 80,   max: 500,    step: 10,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["land"],
      defaultPlanTimeLimitSec: 43200,  // 12 hr 巡邏
    },
    defaultAmmoMax: 8,                // Mk-48 重型魚雷 8 + Harpoon
  },

  fighter: {
    kind: "fighter",
    displayName: "戰機",
    domain: "air",
    defaultAltitudeM: 10000,
    iconShape: "triangle_inverted",
    // AIM-120D BVR ~160 km / IDF-MICA ~80 km；取折中 100 km
    // F-16V/IDF 巡航 ~Mach 0.85 = 480 kn；高速攔截 Mach 1.6–2 = 900–1100 kn
    // F-16 作戰半徑 ~550 km，往返 1100 km；含外油可達 1500 km
    // APG-83 AESA 對戰機可達 250+ km
    defaultCore: {
      rangeKm: 100,
      speedKnots: 800,
      movementRangeKm: 1500,
      detectionRangeKm: 180,
      hpMax: 50,
    },
    uiRanges: {
      rangeKm:          { min: 0,   max: 300,    step: 10,  unit: "km" },
      speedKnots:       { min: 200, max: 1400,   step: 20,  unit: "kn" },
      movementRangeKm:  { min: 500, max: 4000,   step: 100, unit: "km" },
      detectionRangeKm: { min: 50,  max: 400,    step: 10,  unit: "km" },
      hpMax:            { min: 30,  max: 150,    step: 5,   unit: "點" },
    },
    constraints: {
      defaultPlanTimeLimitSec: 5400,   // 1.5 hr 任務窗
      requireRoundTrip: true,
    },
    defaultAmmoMax: 6,                // 4 AAM + 2 AGM 典型掛載
  },

  radar_station: {
    kind: "radar_station",
    displayName: "雷達站",
    domain: "land",
    defaultAltitudeM: 1500,            // 高山雷達（樂山 2620m / 大漢山 1688m）
    iconShape: "cone",
    // PAVE PAWS 對 ICBM 5000 km、對飛機 800–1200 km；視覺化用 800 km
    // 固定設施、無武器；高度硬化
    defaultCore: {
      rangeKm: 0,
      speedKnots: 0,
      movementRangeKm: 0,
      detectionRangeKm: 800,
      hpMax: 250,
    },
    uiRanges: {
      rangeKm:          { min: 0,   max: 50,     step: 5,   unit: "km" },
      speedKnots:       { min: 0,   max: 5,      step: 1,   unit: "kn" },
      movementRangeKm:  { min: 0,   max: 50,     step: 5,   unit: "km" },
      detectionRangeKm: { min: 200, max: 1500,   step: 50,  unit: "km" },
      hpMax:            { min: 100, max: 600,    step: 25,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["sea", "subsurface"],
      defaultPlanTimeLimitSec: 0,
    },
    defaultAmmoMax: 0,                // 無武器
  },

  sam_coastal: {
    kind: "sam_coastal",
    displayName: "海岸 SAM 車",
    domain: "land",
    defaultAltitudeM: 0,
    iconShape: "cone",
    // 天弓 II ~100 km / TC-2N ~70 km / 海弓 III ~90 km；機動 TEL；自帶火控雷達
    defaultCore: {
      rangeKm: 70,
      speedKnots: 60,
      movementRangeKm: 500,
      detectionRangeKm: 120,           // CS/MPQ-78 fire-control radar
      hpMax: 80,
    },
    uiRanges: {
      rangeKm:          { min: 20,  max: 200,    step: 5,   unit: "km" },
      speedKnots:       { min: 0,   max: 80,     step: 1,   unit: "kn" },
      movementRangeKm:  { min: 100, max: 1500,   step: 50,  unit: "km" },
      detectionRangeKm: { min: 30,  max: 250,    step: 10,  unit: "km" },
      hpMax:            { min: 50,  max: 300,    step: 10,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["sea", "subsurface"],
      defaultPlanTimeLimitSec: 7200,
    },
    defaultAmmoMax: 8,                // SAM 攔截彈
  },

  mobile_radar: {
    kind: "mobile_radar",
    displayName: "機動雷達車",
    domain: "land",
    defaultAltitudeM: 0,
    iconShape: "cone",
    // YLC-2 / 蜂眼 / TPS-77 機動版；可移動但偵測範圍比固定雷達站小
    defaultCore: {
      rangeKm: 0,
      speedKnots: 50,
      movementRangeKm: 600,
      detectionRangeKm: 350,
      hpMax: 100,
    },
    uiRanges: {
      rangeKm:          { min: 0,   max: 20,     step: 5,   unit: "km" },
      speedKnots:       { min: 0,   max: 80,     step: 1,   unit: "kn" },
      movementRangeKm:  { min: 100, max: 2000,   step: 50,  unit: "km" },
      detectionRangeKm: { min: 100, max: 600,    step: 20,  unit: "km" },
      hpMax:            { min: 50,  max: 300,    step: 10,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["sea", "subsurface"],
      defaultPlanTimeLimitSec: 7200,
    },
    defaultAmmoMax: 0,                // 無武器
  },

  sam_patriot: {
    kind: "sam_patriot",
    displayName: "愛國者 SAM 車",
    domain: "land",
    defaultAltitudeM: 0,
    iconShape: "cone",
    // PAC-3 MSE ~160 km / PAC-2 ~70 km / 天弓 III ~200 km
    // 重型 TEL、慢、deploy 時間長、BMD 能力
    defaultCore: {
      rangeKm: 160,
      speedKnots: 30,
      movementRangeKm: 200,            // 戰備半徑小（重型）
      detectionRangeKm: 150,           // MPQ-65 PESA
      hpMax: 150,
    },
    uiRanges: {
      rangeKm:          { min: 50,  max: 400,    step: 10,  unit: "km" },
      speedKnots:       { min: 0,   max: 50,     step: 1,   unit: "kn" },
      movementRangeKm:  { min: 50,  max: 1000,   step: 50,  unit: "km" },
      detectionRangeKm: { min: 50,  max: 350,    step: 10,  unit: "km" },
      hpMax:            { min: 80,  max: 400,    step: 10,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["sea", "subsurface"],
      defaultPlanTimeLimitSec: 10800,
    },
    defaultAmmoMax: 16,               // PAC-3 4 launcher × 4 missiles
  },

  supply_ship: {
    kind: "supply_ship",
    displayName: "補給艦",
    domain: "sea",
    defaultAltitudeM: 0,
    iconShape: "diamond",
    // 武進級 / Henry Kaiser AKE — 慢、無武器、大 HP、長航程
    defaultCore: {
      rangeKm: 0,                      // 無武器（rangeKm 在 supply 用不到）
      speedKnots: 16,
      movementRangeKm: 20000,          // 長航程運補
      detectionRangeKm: 60,            // 弱感測
      hpMax: 500,
    },
    uiRanges: {
      rangeKm:          { min: 0,    max: 50,     step: 5,   unit: "km" },
      speedKnots:       { min: 0,    max: 25,     step: 1,   unit: "kn" },
      movementRangeKm:  { min: 1000, max: 30000,  step: 500, unit: "km" },
      detectionRangeKm: { min: 0,    max: 200,    step: 10,  unit: "km" },
      hpMax:            { min: 100,  max: 1500,   step: 25,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["land"],
      defaultPlanTimeLimitSec: 28800,
    },
    defaultAmmoMax: 0,                // 自己無武器
    supplyRangeKm: 6,                 // RAS 並航 6 km 內可補
    supplyFuelKmPerSec: 8,            // 每秒回 8 km 燃料
    supplyAmmoPerSec: 0.15,           // 每秒回 0.15 發（~6.7 秒 / 發）
  },

  airbase: {
    kind: "airbase",
    displayName: "空軍基地",
    domain: "land",
    defaultAltitudeM: 0,
    iconShape: "cone",
    // 固定設施、無武器、巨大 HP（硬化跑道 + 機堡）
    // 戰機 RTB 目標：附近 30 km 內自動補油 + 補彈
    defaultCore: {
      rangeKm: 0,
      speedKnots: 0,
      movementRangeKm: 0,
      detectionRangeKm: 100,           // 場站雷達
      hpMax: 600,
    },
    uiRanges: {
      rangeKm:          { min: 0,   max: 50,     step: 5,   unit: "km" },
      speedKnots:       { min: 0,   max: 5,      step: 1,   unit: "kn" },
      movementRangeKm:  { min: 0,   max: 50,     step: 5,   unit: "km" },
      detectionRangeKm: { min: 50,  max: 300,    step: 10,  unit: "km" },
      hpMax:            { min: 200, max: 1500,   step: 50,  unit: "點" },
    },
    constraints: {
      forbidDomains: ["sea", "subsurface"],
      defaultPlanTimeLimitSec: 0,
    },
    defaultAmmoMax: 0,                // 無武器
    supplyRangeKm: 30,                // 場內 + 進場航線 30 km
    supplyFuelKmPerSec: 25,           // 地勤快速加油
    supplyAmmoPerSec: 0.5,            // 每 2 秒一發
  },
};

/** UI 顯示名稱對照 */
export const CORE_ATTRIBUTE_LABELS: Record<keyof UnitCatalogEntry["defaultCore"], string> = {
  rangeKm: "射程",
  speedKnots: "速率",
  movementRangeKm: "航程",
  detectionRangeKm: "偵測距離",
  hpMax: "耐損值",
};

/** 英文版 — 給 i18n.lang === "en" 用 */
export const CORE_ATTRIBUTE_LABELS_EN: Record<keyof UnitCatalogEntry["defaultCore"], string> = {
  rangeKm: "Range",
  speedKnots: "Speed",
  movementRangeKm: "Movement",
  detectionRangeKm: "Detection",
  hpMax: "HP",
};

/** 11 個 unit kind 的英文 displayName — 集中在這裡比加 displayNameEn 到每個 catalog entry 簡潔 */
export const UNIT_KIND_DISPLAY_EN: Record<UnitKind, string> = {
  missile_launcher: "Missile Launcher",
  drone: "Drone",
  ship_surface: "Surface Ship",
  submarine: "Submarine",
  fighter: "Fighter",
  radar_station: "Radar Station",
  sam_coastal: "Coastal SAM",
  mobile_radar: "Mobile Radar",
  sam_patriot: "Patriot SAM",
  supply_ship: "Supply Ship",
  airbase: "Airbase",
};
