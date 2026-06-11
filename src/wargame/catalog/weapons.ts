/**
 * 武器目錄（B6 多武器掛載）。
 *
 * 一種武器可同時：
 *   - 攻擊單位（targetDomains 非空）—— 依目標域選用
 *   - 攔截來襲飛彈（interceptProfiles 非空）—— 防空（B8）
 * 例如艦載 SAM 既打飛機也攔反艦飛彈，共用同一彈艙。
 *
 * 射程 "core" 表示沿用 unit.core.rangeKm（讓場景的 rangeKm 調校仍生效）；
 * loadout entry 可用 rangeKm 覆寫成固定值（如 ASW 魚雷 18km）。
 */
import type { MissileProfile, Unit, WeaponMagazine, WeaponSpec } from "../types";

/** 各飛行剖面的飛彈速度（knots）；武器未指定 speedKnots 時的 fallback */
export const PROFILE_SPEED_KNOTS: Record<MissileProfile, number> = {
  sea_skim: 600,
  cruise: 700,
  pop_up: 700,
  ballistic: 3200,
};

export const WEAPONS: Record<string, WeaponSpec> = {
  // 空對空飛彈（戰機主武器）
  aam: {
    id: "aam", name: "空對空飛彈", rangeKm: "core", pKill: 0.75,
    targetDomains: ["air"], profile: "cruise", speedKnots: 1400,
  },
  // 反艦 / 對地巡弋飛彈（艦/潛/車/機）
  asm: {
    id: "asm", name: "反艦巡弋飛彈", rangeKm: "core", pKill: 0.6,
    targetDomains: ["sea", "land"], profile: "sea_skim", speedKnots: 600, damageFrac: 0.6,
  },
  // 反艦彈道飛彈（DF-26 類）
  asbm: {
    id: "asbm", name: "反艦彈道飛彈", rangeKm: "core", pKill: 0.5,
    targetDomains: ["sea", "land"], profile: "ballistic", speedKnots: 3200, damageFrac: 0.7,
  },
  // 魚雷（反艦 + 反潛）
  torpedo: {
    id: "torpedo", name: "重型魚雷", rangeKm: "core", pKill: 0.55,
    targetDomains: ["sea", "subsurface"], profile: "cruise", speedKnots: 60, damageFrac: 0.7,
  },
  // 艦載 SAM（打飛機 + 攔飛彈）
  sam_ship: {
    id: "sam_ship", name: "艦載 SAM", rangeKm: 45, pKill: 0.55,
    targetDomains: ["air"], interceptProfiles: ["cruise", "sea_skim", "pop_up"],
    cooldownSec: 6, speedKnots: 2400,
  },
  // 海岸 SAM
  sam_coast: {
    id: "sam_coast", name: "中程 SAM", rangeKm: "core", pKill: 0.5,
    targetDomains: ["air"], interceptProfiles: ["cruise", "sea_skim"],
    cooldownSec: 6, speedKnots: 2200,
  },
  // 愛國者長程 / 反彈道 SAM
  sam_patriot: {
    id: "sam_patriot", name: "愛國者 SAM", rangeKm: "core", pKill: 0.55,
    targetDomains: ["air"], interceptProfiles: ["cruise", "ballistic", "pop_up"],
    cooldownSec: 8, speedKnots: 4200,
  },
  // 近迫武器系統（純點防禦，不攻擊單位）
  ciws: {
    id: "ciws", name: "方陣近迫", rangeKm: 5, pKill: 0.5,
    targetDomains: [], interceptProfiles: ["sea_skim", "cruise", "pop_up"],
    cooldownSec: 3, speedKnots: 1500,
  },
};

export interface LoadedWeapon {
  spec: WeaponSpec;
  mag: WeaponMagazine;
  /** 已解析的有效射程（km） */
  rangeKm: number;
}

/** 解析武器有效射程：entry 覆寫 > spec.rangeKm（"core" → unit.core.rangeKm） */
export function resolveWeaponRange(spec: WeaponSpec, mag: WeaponMagazine, unit: Unit): number {
  if (mag.rangeKm != null) return mag.rangeKm;
  return spec.rangeKm === "core" ? unit.core.rangeKm : spec.rangeKm;
}

/** 取單位的有效掛載（join 彈艙 + 規格 + 解析射程）。未知 weaponId 略過。 */
export function loadoutOf(unit: Unit): LoadedWeapon[] {
  if (!unit.weapons) return [];
  const out: LoadedWeapon[] = [];
  for (const mag of unit.weapons) {
    const spec = specOf(mag.weaponId);
    if (!spec) continue;
    out.push({ spec, mag, rangeKm: resolveWeaponRange(spec, mag, unit) });
  }
  return out;
}

/**
 * 初始化單位武器彈艙：catalog.defaultLoadout → 彈艙；
 * 無 loadout → 合成單一主武器（射程 core、彈量 ammoMax、可打全域）＋
 * （若 catalog.defaultInterceptor）一具攔截武器，保留舊行為。
 */
export function initUnitWeapons(unit: Unit, catalogLoadout?: { weaponId: string; ammoMax: number; rangeKm?: number | "core" }[]): Unit {
  if (unit.weapons) return unit;   // 已初始化（例如 replay 載入）
  let mags: WeaponMagazine[];
  if (catalogLoadout && catalogLoadout.length > 0) {
    mags = catalogLoadout.map((e) => ({
      weaponId: e.weaponId,
      ammoCurrent: e.ammoMax,
      ammoMax: e.ammoMax,
      ...(typeof e.rangeKm === "number" ? { rangeKm: e.rangeKm } : {}),
    }));
  } else if (unit.ammoMax > 0) {
    // 合成主武器（保留舊行為：單一彈艙、core 射程、可打全域）
    mags = [{
      weaponId: "__primary__",
      ammoCurrent: unit.ammoCurrent,
      ammoMax: unit.ammoMax,
    }];
  } else {
    mags = [];   // 無武器（雷達 / 補給 / 基地）
  }
  const ammoMax = mags.reduce((s, m) => s + m.ammoMax, 0);
  const ammoCurrent = mags.reduce((s, m) => s + m.ammoCurrent, 0);
  return { ...unit, weapons: mags, ammoMax, ammoCurrent };
}

/** 合成主武器的 spec（fallback 用） */
export const PRIMARY_WEAPON_SPEC: WeaponSpec = {
  id: "__primary__", name: "主武器", rangeKm: "core", pKill: 0.6,
  targetDomains: ["air", "sea", "land", "subsurface"], damageFrac: 0.6,
};

/** 取得 weaponId 的 spec（含合成主武器） */
export function specOf(weaponId: string): WeaponSpec | undefined {
  return weaponId === "__primary__" ? PRIMARY_WEAPON_SPEC : WEAPONS[weaponId];
}

/**
 * 扣指定武器彈艙 1 發（同步 aggregate ammoCurrent + 記 lastFireSimSec）。
 * 找不到該武器或已無彈 → 原樣返回。
 */
export function consumeAmmo(unit: Unit, weaponId: string, simSec: number): Unit {
  if (!unit.weapons) return unit;
  let done = false;
  const weapons = unit.weapons.map((m) => {
    if (!done && m.weaponId === weaponId && m.ammoCurrent > 0) {
      done = true;
      return { ...m, ammoCurrent: Math.max(0, m.ammoCurrent - 1), lastFireSimSec: simSec };
    }
    return m;
  });
  if (!done) return unit;
  return { ...unit, weapons, ammoCurrent: Math.max(0, unit.ammoCurrent - 1) };
}
