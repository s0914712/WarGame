/**
 * 資產能力表覆寫（wargame-assets.xlsx → assetOverrides.generated.ts）。
 *
 *   kinds   → 開機時覆寫 UNIT_CATALOG（defaultCore / defaultLoadout），場景以 catalog 建單位時即生效
 *   weapons → 開機時覆寫 / 新增 WEAPONS
 *   units   → scenarioStore.loadScenario 時逐單位覆寫（core / 武器掛載）
 *
 * 流程：npm run assets:export → 改 Excel → npm run assets:import。
 */
import type { CoreAttributes, Unit, UnitCatalogEntry, UnitKind, WeaponSpec } from "../types";
import { ASSET_OVERRIDES } from "./assetOverrides.generated";

export interface LoadoutEntry { weaponId: string; ammoMax: number; rangeKm?: number }

export interface AssetOverrides {
  kinds: Partial<Record<UnitKind, { core?: Partial<CoreAttributes>; loadout?: LoadoutEntry[] }>>;
  weapons: Record<string, Partial<WeaponSpec>>;
  /** scenarioId → unitId → 覆寫 */
  units: Record<string, Record<string, { core?: Partial<CoreAttributes>; weapons?: LoadoutEntry[] }>>;
}

export function applyKindOverrides(catalog: Record<UnitKind, UnitCatalogEntry>): void {
  for (const [kind, o] of Object.entries(ASSET_OVERRIDES.kinds) as [UnitKind, AssetOverrides["kinds"][UnitKind]][]) {
    const entry = catalog[kind];
    if (!entry || !o) continue;
    if (o.core) entry.defaultCore = { ...entry.defaultCore, ...o.core };
    if (o.loadout) {
      entry.defaultLoadout = o.loadout.map((l) => ({ ...l }));
      entry.defaultAmmoMax = o.loadout.reduce((s, l) => s + l.ammoMax, 0);
    }
  }
}

export function applyWeaponOverrides(weapons: Record<string, WeaponSpec>): void {
  for (const [id, o] of Object.entries(ASSET_OVERRIDES.weapons)) {
    weapons[id] = { ...(weapons[id] ?? { id, name: id, rangeKm: "core", pKill: 0.5, targetDomains: [] }), ...o, id };
  }
}

/** 場景載入時套用單位覆寫；武器覆寫會設定 weapons → initUnitWeapons 不再套 catalog 掛載 */
export function applyUnitOverride(scenarioId: string, unit: Unit): Unit {
  const o = ASSET_OVERRIDES.units[scenarioId]?.[unit.id];
  if (!o) return unit;
  let u = unit;
  if (o.core) {
    const core = { ...u.core, ...o.core };
    const hpCurrent = u.core.hpMax > 0 ? Math.round((u.hpCurrent / u.core.hpMax) * core.hpMax) : core.hpMax;
    u = { ...u, core, hpCurrent };
  }
  if (o.weapons) {
    const weapons = o.weapons.map((w) => ({
      weaponId: w.weaponId, ammoMax: w.ammoMax, ammoCurrent: w.ammoMax,
      ...(w.rangeKm != null ? { rangeKm: w.rangeKm } : {}),
    }));
    const ammoMax = weapons.reduce((s, w) => s + w.ammoMax, 0);
    u = { ...u, weapons, ammoMax, ammoCurrent: ammoMax };
  }
  return u;
}
