/**
 * 場景登錄表 — 集中管理所有可選場景，給 ScenarioPicker 用。
 *
 * 加新場景：建 .ts 檔匯出 Scenario，在這裡 push 一筆。
 */
import type { Scenario } from "../types";
import { STRAIT_2030 } from "./strait_2030";
import { KINMEN_2027 } from "./kinmen_2027";
import { PRATAS_AIR_RAID } from "./pratas_air_raid";
import { CSG_DEFENSE_2032 } from "./csg_defense_2032";
import { BASHI_BLOCKADE_2030 } from "./bashi_blockade_2030";
import { AMMO_TEST_2030 } from "./ammo_test_2030";
import { INVASION_H_HOUR_2030 } from "./invasion_h_hour_2030";

export interface ScenarioEntry {
  scenario: Scenario;
  /** 一句話描述（show 在 picker dropdown 下方） */
  shortDescription: string;
  /** 標籤（含哪些陣營 / 特色） */
  tags?: string[];
}

export const SCENARIO_REGISTRY: ScenarioEntry[] = [
  {
    scenario: STRAIT_2030,
    shortDescription: "全台海峽對峙 · ~35 單位 · 60 分鐘",
    tags: ["ROC", "PLA"],
  },
  {
    scenario: KINMEN_2027,
    shortDescription: "金門近距防衛 · ~15 單位 · 30 分鐘",
    tags: ["ROC", "PLA", "近距"],
  },
  {
    scenario: PRATAS_AIR_RAID,
    shortDescription: "東沙空襲 · 純空戰 · 30 分鐘",
    tags: ["ROC", "PLA", "空戰"],
  },
  {
    scenario: CSG_DEFENSE_2032,
    shortDescription: "美軍航母戰鬥群護台 · 含 DF-26 ASBM 威脅 · 60 分鐘",
    tags: ["ROC", "USN", "PLA", "聯合"],
  },
  {
    scenario: BASHI_BLOCKADE_2030,
    shortDescription: "巴士海峽封鎖 · 水下對抗 · 40 分鐘",
    tags: ["ROC", "USN", "PLA", "潛艦"],
  },
  {
    scenario: AMMO_TEST_2030,
    shortDescription: "彈藥消耗 + RAS 補給示範 · 3 波 12 來襲 · 30 分鐘",
    tags: ["測試", "Patriot", "F-16V", "RAS"],
  },
  {
    scenario: INVASION_H_HOUR_2030,
    shortDescription: "三線兩棲登陸 + 彈道飛彈壓制 · ~70 單位 · 90 分鐘",
    tags: ["高難度", "登島", "ROC", "USN", "PLA", "全要素"],
  },
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIO_REGISTRY.find((e) => e.scenario.id === id)?.scenario;
}
