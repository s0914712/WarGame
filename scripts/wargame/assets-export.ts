/**
 * 匯出資產能力表：目前生效的數值（程式內建 + 已套用的覆寫）→ wargame-assets.xlsx
 *   npm run assets:export
 */
import ExcelJS from "exceljs";
import { UNIT_CATALOG } from "../../src/wargame/catalog/units";
import { WEAPONS, PRIMARY_WEAPON_SPEC } from "../../src/wargame/catalog/weapons";
import { applyUnitOverride } from "../../src/wargame/catalog/assetOverrides";
import { SCENARIO_REGISTRY } from "../../src/wargame/scenarios/registry";
import type { UnitKind } from "../../src/wargame/types";
import {
  CORE_COLS, DOMAINS, PROFILES, SHEET, XLSX_PATH,
  effectiveLoadout, formatLoadout, kindLoadout,
} from "./assetsShared";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
const RO_HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
const RO_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const EDIT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };

interface Col { header: string; key: string; width: number; readonly?: boolean; note?: string }

function addSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.readonly ? `${c.header}（唯讀）` : c.header, key: c.key, width: c.width }));
  for (const r of rows) ws.addRow(r);
  const header = ws.getRow(1);
  header.height = 30;
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = c.readonly ? RO_HEADER_FILL : HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    if (c.note) cell.note = c.note;
    for (let r = 2; r <= ws.rowCount; r++) {
      const body = ws.getRow(r).getCell(i + 1);
      body.fill = c.readonly ? RO_FILL : EDIT_FILL;
      body.border = { bottom: { style: "hair", color: { argb: "FFCBD5E1" } } };
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

function listValidation(ws: ExcelJS.Worksheet, colKey: string, values: string[], rows = 400): void {
  const col = ws.getColumn(colKey);
  // Excel 清單驗證字串上限 255 字元
  const formula = `"${values.join(",")}"`;
  if (formula.length > 255) return;
  for (let r = 2; r <= Math.max(rows, ws.rowCount); r++) {
    ws.getCell(r, col.number).dataValidation = {
      type: "list", allowBlank: true, formulae: [formula], showErrorMessage: true,
      errorTitle: "代碼不存在", error: `請從清單選擇：${values.join(", ")}`,
    };
  }
}

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "WarGame of Taiwan";
  wb.created = new Date();

  const kinds = Object.keys(UNIT_CATALOG) as UnitKind[];
  const weaponIds = Object.keys(WEAPONS);
  const weaponName = (id: string) => (id === "__primary__" ? PRIMARY_WEAPON_SPEC.name : WEAPONS[id]?.name ?? "（未知武器）");

  // ── 說明 ──
  const readme = wb.addWorksheet(SHEET.readme);
  readme.getColumn(1).width = 110;
  const lines: [string, boolean?][] = [
    ["WarGame of Taiwan — 資產能力表", true],
    [""],
    ["使用方式", true],
    ["1. 修改淡橘色欄位（灰色 = 唯讀，僅供參考，改了不會生效）。"],
    ["2. 存檔後在專案根目錄執行：npm run assets:import"],
    ["   → 寫入 src/wargame/catalog/assetOverrides.generated.ts（只記錄與內建值不同的欄位），開發伺服器會自動重載。"],
    ["3. 要重新產生最新表格：npm run assets:export（會覆蓋本檔，請先關閉 Excel）。"],
    [""],
    ["各分頁", true],
    [`「${SHEET.kinds}」— 各兵種的預設能力。場景中沒特別設定的單位會跟著這裡變。`],
    [`「${SHEET.loadout}」— 各兵種預設武器與彈數。一列一種武器；射程留空 = 使用該單位的「打擊距離」。`],
    [`「${SHEET.weapons}」— 武器性能（命中率 / 傷害 / 速度 / 可打目標）。射程填 core = 使用單位的打擊距離。`],
    [`「${SHEET.units}」— 每個場景中的每個單位（最終生效值）。改這裡只影響該場景的該單位（例：騰雲偵察無人機）。`],
    [""],
    ["欄位說明", true],
    ["偵蒐距離 (km)：雷達 / 感測器可發現敵方的距離。"],
    ["打擊距離 (km)：主武器射程；武器射程為 core 的武器都用這個值。0 = 無法攻擊。"],
    ["最大速度 (kn)：節（1 kn ≈ 1.852 km/h）。航程 (km)：可移動的總距離（油料）。耐損 HP：被命中時扣的生命值上限。"],
    ["武器掛載（場景單位分頁）：格式 武器代碼×彈數，多個用逗號分隔，可加 @射程km 覆寫射程。"],
    ["   例：asm×2, torpedo×2@15　　無武器請填：無"],
    [`武器代碼：${weaponIds.join(", ")}（__primary__ = 舊式合成主武器）`],
    [`目標域：${DOMAINS.join(", ")}　飛行剖面：${PROFILES.join(", ")}`],
    ["命中率 / 傷害比例為 0–1 的小數（傷害比例 = 命中時扣目標最大 HP 的比例）。"],
    ["一次性攻擊 = 是：自殺無人機（SOWA / MOWA）。發現目標且在打擊距離內就撲擊，載台本身即彈體、發射後從戰場消失；飛行速度用單位的最大速度，可被近迫武器 / SAM 攔截。"],
    ["登陸艦（landing_ship）：H 時登島作戰中，登陸區必須有登陸艦在區內並守住 20 分鐘，紅方才算登陸成功。"],
  ];
  lines.forEach(([text, bold], i) => {
    const c = readme.getCell(i + 1, 1);
    c.value = text;
    if (bold) c.font = { bold: true, size: i === 0 ? 16 : 12, color: { argb: "FFE97132" } };
  });

  // ── 單位類型 ──
  addSheet(wb, SHEET.kinds, [
    { header: "類型代碼", key: "kind", width: 18, readonly: true },
    { header: "名稱", key: "name", width: 12, readonly: true },
    { header: "領域", key: "domain", width: 11, readonly: true },
    ...CORE_COLS.map(([k, h]) => ({ header: h, key: k, width: 13 })),
    { header: "預設武器掛載", key: "loadout", width: 40, readonly: true, note: `請到「${SHEET.loadout}」分頁修改` },
  ], kinds.map((k) => {
    const e = UNIT_CATALOG[k];
    return {
      kind: k, name: e.displayName, domain: e.domain,
      ...Object.fromEntries(CORE_COLS.map(([f]) => [f, e.defaultCore[f]])),
      loadout: formatLoadout(kindLoadout(e)),
    };
  }));

  // ── 類型武器掛載 ──
  const loadoutRows = kinds.flatMap((k) => kindLoadout(UNIT_CATALOG[k]).map((l) => ({
    kind: k, kindName: UNIT_CATALOG[k].displayName, weaponId: l.weaponId, weaponName: weaponName(l.weaponId),
    ammo: l.ammoMax, range: l.rangeKm ?? null,
  })));
  const lws = addSheet(wb, SHEET.loadout, [
    { header: "類型代碼", key: "kind", width: 18 },
    { header: "類型名稱", key: "kindName", width: 12, readonly: true },
    { header: "武器代碼", key: "weaponId", width: 14 },
    { header: "武器名稱", key: "weaponName", width: 16, readonly: true },
    { header: "彈數", key: "ammo", width: 9 },
    { header: "射程覆寫 (km)", key: "range", width: 14, note: "留空 = 使用單位打擊距離（或武器分頁的固定射程）" },
  ], loadoutRows);
  listValidation(lws, "kind", kinds);
  listValidation(lws, "weaponId", [...weaponIds, "__primary__"]);

  // ── 武器 ──
  addSheet(wb, SHEET.weapons, [
    { header: "武器代碼", key: "id", width: 13, readonly: true },
    { header: "名稱", key: "name", width: 16 },
    { header: "射程 (km / core)", key: "range", width: 14, note: "core = 使用發射單位的打擊距離" },
    { header: "命中率 (0–1)", key: "pKill", width: 12 },
    { header: "傷害比例 (0–1)", key: "damage", width: 13, note: "命中時扣目標最大 HP 的比例；空白 = 0.6" },
    { header: "飛行速度 (kn)", key: "speed", width: 13 },
    { header: "攻擊目標域", key: "domains", width: 22, note: `逗號分隔：${DOMAINS.join(", ")}；空白 = 不能攻擊單位（純攔截）` },
    { header: "可攔截剖面", key: "intercept", width: 26, note: `逗號分隔：${PROFILES.join(", ")}；空白 = 不能攔截` },
    { header: "飛行剖面", key: "profile", width: 12, note: PROFILES.join(", ") },
    { header: "冷卻 (秒)", key: "cooldown", width: 10 },
    { header: "一次性攻擊", key: "oneWay", width: 11, note: "是 = 自殺無人機：發射時載台本身撲向目標並從戰場移除，飛行速度 = 單位最大速度" },
  ], weaponIds.map((id) => {
    const w = WEAPONS[id]!;
    return {
      id, name: w.name, range: w.rangeKm, pKill: w.pKill, damage: w.damageFrac ?? null,
      speed: w.speedKnots ?? null, domains: w.targetDomains.join(", "),
      intercept: (w.interceptProfiles ?? []).join(", "), profile: w.profile ?? null, cooldown: w.cooldownSec ?? null,
      oneWay: w.oneWay ? "是" : "否",
    };
  }));

  // ── 場景單位 ──
  const unitRows: Record<string, unknown>[] = [];
  for (const { scenario } of SCENARIO_REGISTRY) {
    const sideName = (id: string) => scenario.sides.find((s) => s.id === id)?.displayName.split(/[（(]/)[0]?.trim() ?? id;
    for (const raw of scenario.units) {
      const u = applyUnitOverride(scenario.id, raw);
      unitRows.push({
        scenario: scenario.id, scenarioName: scenario.displayName, unitId: u.id, callsign: u.callsign,
        name: u.displayName, side: sideName(u.sideId), kind: u.kind,
        ...Object.fromEntries(CORE_COLS.map(([f]) => [f, u.core[f]])),
        weapons: formatLoadout(effectiveLoadout(u)),
      });
    }
  }
  addSheet(wb, SHEET.units, [
    { header: "場景代碼", key: "scenario", width: 20, readonly: true },
    { header: "場景", key: "scenarioName", width: 24, readonly: true },
    { header: "單位代碼", key: "unitId", width: 16, readonly: true },
    { header: "呼號", key: "callsign", width: 12, readonly: true },
    { header: "名稱", key: "name", width: 22, readonly: true },
    { header: "陣營", key: "side", width: 12, readonly: true },
    { header: "類型", key: "kind", width: 15, readonly: true },
    ...CORE_COLS.map(([k, h]) => ({ header: h, key: k, width: 12 })),
    { header: "武器掛載", key: "weapons", width: 34, note: "格式：asm×2, torpedo×2@15；無武器填「無」" },
  ], unitRows);

  await wb.xlsx.writeFile(XLSX_PATH);
  console.log(`✓ 已匯出 ${XLSX_PATH}`);
  console.log(`  單位類型 ${kinds.length} · 類型掛載 ${loadoutRows.length} · 武器 ${weaponIds.length} · 場景單位 ${unitRows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
