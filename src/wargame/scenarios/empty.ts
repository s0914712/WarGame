import type { Scenario, Side } from "../types";

const SIDES: Side[] = [
  {
    id: "blue",
    displayName: "中華民國國軍",
    colorPrimary: "#3B82F6",
    colorSecondary: "#93C5FD",
    isPlayer: true,
    ownership: "human",
    isHostileTo: ["red"],
  },
  {
    id: "red",
    displayName: "解放軍",
    colorPrimary: "#EF4444",
    colorSecondary: "#FCA5A5",
    isPlayer: false,
    ownership: "scripted",
    isHostileTo: ["blue"],
  },
  {
    id: "neutral",
    displayName: "民用",
    colorPrimary: "#9CA3AF",
    colorSecondary: "#D1D5DB",
    isPlayer: false,
    ownership: "scripted",
    isHostileTo: [],
  },
];

/** Phase 1 預設空場景。相機落在台海中線，後續 phase 會替換為實際場景。 */
export const EMPTY_SCENARIO: Scenario = {
  id: "empty",
  displayName: "空白戰場（Phase 1 預設）",
  briefing: "尚未載入場景。Phase 2 起會有單位可放置。",
  startSimTimeSec: 0,
  durationSec: 3600,
  sides: SIDES,
  units: [],
  pendingCommands: [],
  camera: {
    center: [120.5, 24.0],
    zoom: 6.2,
    pitch: 30,
    bearing: 0,
  },
  victoryConditions: [],
};
