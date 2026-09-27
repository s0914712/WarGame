/**
 * 匯入資產能力表：wargame-assets.xlsx → src/wargame/catalog/assetOverrides.generated.ts
 *   npm run assets:import
 *
 * 只記錄與「程式內建值」不同的欄位：
 *   - 單位類型 / 類型武器掛載 / 武器 → 與內建 catalog（UNIT_CATALOG_BASE / WEAPONS_BASE）比
 *   - 場景單位 → 與場景程式中的單位比（沒改的列會跟著類型預設走）
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { UNIT_CATALOG_BASE } from "../../src/wargame/catalog/units";
import { WEAPONS_BASE } from "../../src/wargame/catalog/weapons";
import type { AssetOverrides, LoadoutEntry } from "../../src/wargame/catalog/assetOverrides";
import { SCENARIO_REGISTRY } from "../../src/wargame/scenarios/registry";
import type { CoreAttributes, Domain, MissileProfile, UnitKind, WeaponSpec } from "../../src/wargame/types";
import {
  CORE_COLS, DOMAINS, GENERATED_PATH, PROFILES, SHEET, XLSX_PATH,
  effectiveLoadout, formatLoadout, kindLoadout, parseLoadout, sameLoadout,
} from "./assetsShared";

const errors: string[] = [];
const changes: string[] = [];

function cellValue(c: ExcelJS.Cell): unknown {
  const v = c.value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  if (v && typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  return v;
}

function str(v: unknown): string { return v == null ? "" : String(v).trim(); }

/** 讀分頁成 {表頭: 值} 陣列（表頭去掉「（唯讀）」） */
function readSheet(wb: ExcelJS.Workbook, name: string): { row: number; get: (h: string) => unknown }[] {
  const ws = wb.getWorksheet(name);
  if (!ws) { errors.push(`找不到分頁「${name}」`); return []; }
  const heads = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => heads.set(str(cellValue(c)).replace(/（唯讀）$/, ""), col));
  const out: { row: number; get: (h: string) => unknown }[] = [];
  ws.eachRow((r, rowNum) => {
    if (rowNum === 1) return;
    const get = (h: string) => {
      const col = heads.get(h);
      if (col == null) { errors.push(`「${name}」缺少欄位「${h}」`); return null; }
      return cellValue(r.getCell(col));
    };
    const anyValue = [...heads.values()].some((col) => str(cellValue(r.getCell(col))) !== "");
    if (anyValue) out.push({ row: rowNum, get });
  });
  return out;
}

function num(v: unknown, where: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | undefined {
  if (str(v) === "") {
    if (!opts.optional) errors.push(`${where}：不可空白`);
    return undefined;
  }
  const n = typeof v === "number" ? v : Number(str(v));
  if (!Number.isFinite(n)) { errors.push(`${where}：「${str(v)}」不是數字`); return undefined; }
  if (opts.min != null && n < opts.min) { errors.push(`${where}：${n} 小於 ${opts.min}`); return undefined; }
  if (opts.max != null && n > opts.max) { errors.push(`${where}：${n} 大於 ${opts.max}`); return undefined; }
  return n;
}

function list<T extends string>(v: unknown, allowed: readonly T[], where: string): T[] {
  const items = str(v).split(/[,，\s]+/).filter(Boolean);
  const bad = items.filter((i) => !allowed.includes(i as T));
  if (bad.length) errors.push(`${where}：不認得「${bad.join(", ")}」（可用：${allowed.join(", ")}）`);
  return items.filter((i) => allowed.includes(i as T)) as T[];
}

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const out: AssetOverrides = { kinds: {}, weapons: {}, units: {} };
  const kinds = Object.keys(UNIT_CATALOG_BASE) as UnitKind[];

  // ── 武器 ──
  const weaponIds = new Set(Object.keys(WEAPONS_BASE));
  for (const { row, get } of readSheet(wb, SHEET.weapons)) {
    const id = str(get("武器代碼"));
    const at = `${SHEET.weapons} 第 ${row} 列（${id || "?"}）`;
    if (!/^[A-Za-z_]\w*$/.test(id)) { errors.push(`${at}：武器代碼只能用英數與底線`); continue; }
    weaponIds.add(id);
    const rangeRaw = str(get("射程 (km / core)"));
    const spec: Partial<WeaponSpec> = {
      name: str(get("名稱")) || id,
      rangeKm: rangeRaw.toLowerCase() === "core" ? "core" : num(rangeRaw, `${at} 射程`, { min: 0 }) ?? "core",
      pKill: num(get("命中率 (0–1)"), `${at} 命中率`, { min: 0, max: 1 }),
      damageFrac: num(get("傷害比例 (0–1)"), `${at} 傷害比例`, { min: 0, max: 1, optional: true }),
      speedKnots: num(get("飛行速度 (kn)"), `${at} 飛行速度`, { min: 1, optional: true }),
      targetDomains: list<Domain>(get("攻擊目標域"), DOMAINS, `${at} 攻擊目標域`),
      interceptProfiles: list<MissileProfile>(get("可攔截剖面"), PROFILES, `${at} 可攔截剖面`),
      profile: (str(get("飛行剖面")) || undefined) as MissileProfile | undefined,
      cooldownSec: num(get("冷卻 (秒)"), `${at} 冷卻`, { min: 0, optional: true }),
    };
    if (spec.profile && !PROFILES.includes(spec.profile)) errors.push(`${at}：飛行剖面「${spec.profile}」不存在`);
    const base = WEAPONS_BASE[id];
    const diff: Partial<WeaponSpec> = {};
    for (const [k, v] of Object.entries(spec) as [keyof WeaponSpec, unknown][]) {
      const b = base?.[k];
      const norm = (x: unknown) => JSON.stringify(Array.isArray(x) ? x : x ?? null);
      // 內建沒有的陣列欄位視為空陣列
      const bn = (k === "interceptProfiles" && b == null) ? "[]" : norm(b);
      if (v === undefined && b === undefined) continue;
      if (norm(v) !== bn) (diff as Record<string, unknown>)[k] = v ?? null;
    }
    if (Object.keys(diff).length) {
      out.weapons[id] = base ? diff : spec;
      changes.push(`武器 ${id}${base ? "" : "（新增）"}：${Object.entries(diff).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`);
    }
  }

  // ── 單位類型 ──
  for (const { row, get } of readSheet(wb, SHEET.kinds)) {
    const kind = str(get("類型代碼")) as UnitKind;
    const at = `${SHEET.kinds} 第 ${row} 列（${kind}）`;
    const base = UNIT_CATALOG_BASE[kind];
    if (!base) { errors.push(`${at}：類型代碼不存在`); continue; }
    const core: Partial<CoreAttributes> = {};
    for (const [f, h] of CORE_COLS) {
      const v = num(get(h), `${at} ${h}`, { min: 0 });
      if (v != null && v !== base.defaultCore[f]) core[f] = v;
    }
    if (Object.keys(core).length) {
      (out.kinds[kind] ??= {}).core = core;
      changes.push(`類型 ${kind}：${Object.entries(core).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    }
  }

  // ── 類型武器掛載 ──
  const loadouts = new Map<UnitKind, LoadoutEntry[]>(kinds.map((k) => [k, []]));
  for (const { row, get } of readSheet(wb, SHEET.loadout)) {
    const kind = str(get("類型代碼")) as UnitKind;
    const weaponId = str(get("武器代碼"));
    const at = `${SHEET.loadout} 第 ${row} 列（${kind} / ${weaponId}）`;
    if (!loadouts.has(kind)) { errors.push(`${at}：類型代碼不存在`); continue; }
    if (!weaponIds.has(weaponId) && weaponId !== "__primary__") { errors.push(`${at}：武器代碼不存在`); continue; }
    const ammo = num(get("彈數"), `${at} 彈數`, { min: 0 });
    const range = num(get("射程覆寫 (km)"), `${at} 射程`, { min: 0, optional: true });
    if (ammo == null) continue;
    loadouts.get(kind)!.push({ weaponId, ammoMax: ammo, ...(range != null ? { rangeKm: range } : {}) });
  }
  for (const [kind, lo] of loadouts) {
    if (!sameLoadout(lo, kindLoadout(UNIT_CATALOG_BASE[kind]))) {
      (out.kinds[kind] ??= {}).loadout = lo;
      changes.push(`類型 ${kind} 掛載：${formatLoadout(lo)}`);
    }
  }

  // ── 場景單位 ──
  const scenarioUnits = new Map(SCENARIO_REGISTRY.flatMap(({ scenario }) =>
    scenario.units.map((u) => [`${scenario.id}/${u.id}`, u] as const)));
  for (const { row, get } of readSheet(wb, SHEET.units)) {
    const sid = str(get("場景代碼")), uid = str(get("單位代碼"));
    const at = `${SHEET.units} 第 ${row} 列（${sid} / ${uid}）`;
    const base = scenarioUnits.get(`${sid}/${uid}`);
    if (!base) { errors.push(`${at}：找不到這個場景單位（場景代碼 / 單位代碼請勿修改）`); continue; }
    const o: AssetOverrides["units"][string][string] = {};
    const core: Partial<CoreAttributes> = {};
    for (const [f, h] of CORE_COLS) {
      const v = num(get(h), `${at} ${h}`, { min: 0 });
      if (v != null && v !== base.core[f]) core[f] = v;
    }
    if (Object.keys(core).length) o.core = core;
    try {
      const lo = parseLoadout(str(get("武器掛載")));
      const unknown = lo.filter((l) => !weaponIds.has(l.weaponId) && l.weaponId !== "__primary__");
      if (unknown.length) errors.push(`${at}：武器代碼不存在「${unknown.map((l) => l.weaponId).join(", ")}」`);
      else if (!sameLoadout(lo, effectiveLoadout(base))) o.weapons = lo;
    } catch (e) {
      errors.push(`${at}：${(e as Error).message}`);
    }
    if (o.core || o.weapons) {
      (out.units[sid] ??= {})[uid] = o;
      changes.push(`單位 ${sid}/${uid}（${base.callsign}）：${[
        ...Object.entries(o.core ?? {}).map(([k, v]) => `${k}=${v}`),
        ...(o.weapons ? [`武器=${formatLoadout(o.weapons)}`] : []),
      ].join(" ")}`);
    }
  }

  if (errors.length) {
    console.error(`✗ 資產表有 ${errors.length} 個問題，未寫入：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  writeFileSync(GENERATED_PATH, `/**
 * 由 \`npm run assets:import\` 從 wargame-assets.xlsx 產生 — 請勿手動修改。
 * 只記錄與程式內建數值「不同」的欄位。
 */
import type { AssetOverrides } from "./assetOverrides";

export const ASSET_OVERRIDES: AssetOverrides = ${JSON.stringify(out, null, 2)};
`, "utf8");
  console.log(`✓ 已寫入 ${GENERATED_PATH}`);
  console.log(changes.length ? `  與內建值不同的項目（${changes.length}）：\n${changes.map((c) => `  · ${c}`).join("\n")}` : "  （與內建值完全相同，無覆寫）");
}

main().catch((e) => { console.error(e); process.exit(1); });
