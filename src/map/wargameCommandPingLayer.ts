/**
 * 指令回饋標記層（RTS 式「收到命令」）：
 *   - 收縮環：從外往內縮到標記上，然後淡出
 *   - 圖示：攻擊準星 / 移動標記 / 航點 / 停止 / ROE / 感測 / 聲標，出現時彈一下
 *   - 文字：指令名稱（攻擊 / 移動 / 停止 …）
 * 資料來源：src/wargame/editor/commandPings.ts（commandBus 送出指令時推入）。牆鐘動畫，任何倍速都一樣。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { commandPings, type PingIcon } from "../wargame/editor/commandPings";

const SRC = "wg-cmd-ping-src";
const LAYER_RING = "wg-cmd-ping-ring";
const LAYER_ICON = "wg-cmd-ping-icon";

const DPR = 2;
const SIZE = 44;   // CSS px

type Draw = (c: CanvasRenderingContext2D, s: number) => void;

/** 每個圖示：顏色 + 畫法（座標以 s = 邊長 css px 為基準，中心 s/2） */
const ICONS: Record<PingIcon, { color: string; draw: Draw }> = {
  // 攻擊準星：外圈 + 四向刻線 + 中心點
  attack: {
    color: "#ef4444",
    draw: (c, s) => {
      const m = s / 2;
      c.beginPath(); c.arc(m, m, s * 0.3, 0, Math.PI * 2); c.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        c.beginPath();
        c.moveTo(m + dx * s * 0.46, m + dy * s * 0.46);
        c.lineTo(m + dx * s * 0.16, m + dy * s * 0.16);
        c.stroke();
      }
      c.beginPath(); c.arc(m, m, s * 0.05, 0, Math.PI * 2); c.fill();
    },
  },
  // 移動：四個指向中心的箭頭
  move: {
    color: "#4ade80",
    draw: (c, s) => {
      const m = s / 2;
      for (let i = 0; i < 4; i++) {
        c.save();
        c.translate(m, m);
        c.rotate((i * Math.PI) / 2);
        c.beginPath();
        c.moveTo(0, -s * 0.12);
        c.lineTo(-s * 0.12, -s * 0.4);
        c.lineTo(s * 0.12, -s * 0.4);
        c.closePath();
        c.fill();
        c.restore();
      }
    },
  },
  // 航點：菱形 + 中心點
  route: {
    color: "#60a5fa",
    draw: (c, s) => {
      const m = s / 2, r = s * 0.34;
      c.beginPath();
      c.moveTo(m, m - r); c.lineTo(m + r, m); c.lineTo(m, m + r); c.lineTo(m - r, m);
      c.closePath(); c.stroke();
      c.beginPath(); c.arc(m, m, s * 0.07, 0, Math.PI * 2); c.fill();
    },
  },
  // 停止：八角形外框 + 橫槓
  hold: {
    color: "#facc15",
    draw: (c, s) => {
      const m = s / 2, r = s * 0.36;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        const x = m + r * Math.cos(a), y = m + r * Math.sin(a);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); c.stroke();
      c.fillRect(m - s * 0.18, m - s * 0.05, s * 0.36, s * 0.1);
    },
  },
  // 清除航線：✕
  clear: {
    color: "#94a3b8",
    draw: (c, s) => {
      const a = s * 0.28, b = s * 0.72;
      c.beginPath(); c.moveTo(a, a); c.lineTo(b, b); c.moveTo(b, a); c.lineTo(a, b); c.stroke();
    },
  },
  // ROE：盾牌外框（顏色由環 / 文字表達目前 ROE）
  roe: {
    color: "#e2e8f0",
    draw: (c, s) => {
      const m = s / 2;
      c.beginPath();
      c.moveTo(m, s * 0.16);
      c.lineTo(s * 0.78, s * 0.28);
      c.quadraticCurveTo(s * 0.78, s * 0.66, m, s * 0.86);
      c.quadraticCurveTo(s * 0.22, s * 0.66, s * 0.22, s * 0.28);
      c.closePath(); c.stroke();
    },
  },
  // 感測：中心點 + 兩道弧（聲波）
  sensor: {
    color: "#38bdf8",
    draw: (c, s) => {
      const m = s / 2;
      c.beginPath(); c.arc(m, m, s * 0.07, 0, Math.PI * 2); c.fill();
      for (const r of [0.2, 0.34]) {
        for (const base of [0, Math.PI]) {
          c.beginPath(); c.arc(m, m, s * r, base - 0.7, base + 0.7); c.stroke();
        }
      }
    },
  },
  // 聲標：3×3 點陣
  buoy: {
    color: "#38bdf8",
    draw: (c, s) => {
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        c.beginPath(); c.arc(s / 2 + i * s * 0.22, s / 2 + j * s * 0.22, s * 0.06, 0, Math.PI * 2); c.fill();
      }
    },
  },
};

const iconName = (icon: PingIcon) => `wg-cmd-ping-${icon}`;

function registerIcons(map: MapboxMap): void {
  for (const [icon, { color, draw }] of Object.entries(ICONS) as [PingIcon, typeof ICONS[PingIcon]][]) {
    const name = iconName(icon);
    if (map.hasImage(name)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE * DPR;
    const c = canvas.getContext("2d");
    if (!c) continue;
    c.scale(DPR, DPR);
    c.lineCap = "round";
    c.lineJoin = "round";
    // 深色描邊打底，任何底圖都看得清楚
    c.strokeStyle = c.fillStyle = "rgba(2, 6, 23, 0.9)";
    c.lineWidth = 6;
    c.shadowColor = "rgba(2, 6, 23, 0.9)";
    c.shadowBlur = 2;
    draw(c, SIZE);
    c.shadowBlur = 0;
    c.strokeStyle = c.fillStyle = color;
    c.lineWidth = 3;
    draw(c, SIZE);
    map.addImage(name, c.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: DPR });
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export function attachWargameCommandPingLayer(map: MapboxMap): () => void {
  for (const id of [LAYER_ICON, LAYER_RING]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
  registerIcons(map);
  map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  map.addLayer({
    id: LAYER_RING, type: "circle", source: SRC,
    paint: {
      "circle-radius": ["get", "r"],
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-stroke-opacity": ["get", "ringA"],
      "circle-pitch-alignment": "map",
    },
  });
  map.addLayer({
    id: LAYER_ICON, type: "symbol", source: SRC,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["get", "scale"],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "label"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 12,
      "text-offset": [0, 2.1],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "icon-opacity": ["get", "a"],
      "text-opacity": ["get", "a"],
      "text-color": ["get", "color"],
      "text-halo-color": "rgba(2, 6, 23, 0.95)",
      "text-halo-width": 1.6,
    },
  });

  let lastScenarioId = scenarioStore.getState().scenario.id;
  let hadPings = false;

  const render = () => {
    const state = scenarioStore.getState();
    if (state.scenario.id !== lastScenarioId) {   // 換場景：舊提示作廢
      lastScenarioId = state.scenario.id;
      commandPings.clear();
    }
    const now = performance.now();
    const active = commandPings.getActive(now);
    if (active.length === 0 && !hadPings) return;   // 閒置時不 setData
    hadPings = active.length > 0;

    const features: GeoJSON.Feature[] = [];
    for (const p of active) {
      let pos = p.at;
      if (p.followUnitId) {
        const u = state.units[p.followUnitId];
        if (u) pos = [u.position.lng, u.position.lat];
      }
      if (!pos) continue;
      const t = (now - p.born) / p.lifeMs;
      const shrink = easeOut(Math.min(1, t / 0.45));
      features.push({
        type: "Feature",
        properties: {
          icon: iconName(p.icon),
          label: p.label,
          color: p.color,
          r: 12 + 28 * (1 - shrink),
          ringA: t < 0.45 ? 0.95 : Math.max(0, 0.95 - (t - 0.45) / 0.3),
          scale: t < 0.15 ? 1.35 - (t / 0.15) * 0.35 : 1,
          a: t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35),
        },
        geometry: { type: "Point", coordinates: pos },
      });
    }
    (map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  };

  let raf = 0;
  const loop = () => { render(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    for (const id of [LAYER_ICON, LAYER_RING]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
}
