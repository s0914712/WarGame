/**
 * UnitScene — 兵棋單位 3D 渲染。
 *
 * 三個獨立 InstancedMesh 分對應域：
 *   - landMesh：ConeGeometry — 飛彈發射車（陸基）
 *   - airMesh：OctahedronGeometry — 無人機（空中）
 *   - seaMesh：IcosahedronGeometry — 船艦（水面）
 *
 * 每幀直接讀 scenarioStore.getState().units，依 sideId → 顏色。
 * 選中單位 → 放大 1.6×。
 *
 * pickUnit：跨 3 個 mesh 用 screen-distance 比對。
 *
 * 與 BusScene 共用既有 toMercator + AdditiveBlending + LightOrb 風格。
 */

import * as THREE from "three";
import type { Domain, Side, SideId, Unit, UnitId } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";
import { toMercator } from "../utils/coordinates";

const MAX_PER_DOMAIN = 200;

interface DomainSlot {
  mesh: THREE.InstancedMesh;
  indexToUnitId: Map<number, UnitId>;
}

export class UnitScene {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer!: THREE.WebGLRenderer;

  private slots: Partial<Record<Domain, DomainSlot | null>> = {
    land: null,
    air: null,
    sea: null,
    subsurface: null,
  };

  private orbScale = 0.000022;       // 比 bus 大很多，戰場單位要看得到
  private highlightScale = 1.6;
  private isDarkTheme = true;

  private colorBySide = new Map<SideId, THREE.Color>();
  private lastMatrix: THREE.Matrix4 | null = null;
  private _dummy = new THREE.Matrix4();

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
  }

  init(gl: WebGLRenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl as unknown as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;

    this.slots.land = this.makeSlot(new THREE.ConeGeometry(1, 2.2, 6));
    this.slots.air = this.makeSlot(new THREE.OctahedronGeometry(1, 0));
    this.slots.sea = this.makeSlot(new THREE.IcosahedronGeometry(1, 0));
  }

  private makeSlot(geo: THREE.BufferGeometry): DomainSlot {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_PER_DOMAIN);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PER_DOMAIN * 3),
      3,
    );
    this.scene.add(mesh);
    return { mesh, indexToUnitId: new Map() };
  }

  setTheme(isDark: boolean) {
    if (this.isDarkTheme === isDark) return;
    this.isDarkTheme = isDark;
    this.colorBySide.clear();
  }

  setOrbScale(scale: number) {
    this.orbScale = scale;
  }

  private getSideColor(sides: Side[], sideId: SideId): THREE.Color {
    let c = this.colorBySide.get(sideId);
    if (c) return c;
    const side = sides.find((s) => s.id === sideId);
    const hex = side?.colorPrimary ?? "#888";
    c = new THREE.Color(hex);
    if (this.isDarkTheme) c.multiplyScalar(1.4);
    this.colorBySide.set(sideId, c);
    return c;
  }

  /** 每幀呼叫。直接從 scenarioStore 拉資料，外部不傳。 */
  update() {
    const state = scenarioStore.getState();
    const selectedId = scenarioStore.getSelectedUnitId();
    const sides = state.scenario.sides;

    // 重置 slot 計數
    const counters: Record<Domain, number> = { land: 0, air: 0, sea: 0, subsurface: 0 };
    for (const slot of Object.values(this.slots)) {
      if (slot) slot.indexToUnitId.clear();
    }

    const dummy = this._dummy;

    for (const unit of Object.values(state.units)) {
      const domain = domainOf(unit.kind);
      const slot = this.slots[domain];
      if (!slot) continue;
      const idx = counters[domain];
      if (idx >= MAX_PER_DOMAIN) continue;

      const merc = toMercator(unit.position.lat, unit.position.lng, unit.position.altMeters);
      const isSelected = unit.id === selectedId;
      const s = this.orbScale * (isSelected ? this.highlightScale : 1);

      dummy.makeScale(s, s, s);
      dummy.setPosition(merc.x, merc.y, merc.z);
      slot.mesh.setMatrixAt(idx, dummy);

      const color = this.getSideColor(sides, unit.sideId);
      slot.mesh.instanceColor!.setXYZ(idx, color.r, color.g, color.b);

      slot.indexToUnitId.set(idx, unit.id);
      counters[domain] = idx + 1;
    }

    for (const [domainKey, slot] of Object.entries(this.slots)) {
      if (!slot) continue;
      const domain = domainKey as Domain;
      slot.mesh.count = counters[domain];
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (slot.mesh.instanceColor) {
        (slot.mesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    }
  }

  render(matrix: number[]) {
    const gl = this.renderer.getContext();
    const blendEnabled = gl.isEnabled(gl.BLEND);
    const blendSrc = gl.getParameter(gl.BLEND_SRC_RGB);
    const blendDst = gl.getParameter(gl.BLEND_DST_RGB);
    const blendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA);
    const blendDstA = gl.getParameter(gl.BLEND_DST_ALPHA);

    if (!this.lastMatrix) this.lastMatrix = new THREE.Matrix4();
    this.lastMatrix.fromArray(matrix);
    this.camera.projectionMatrix.copy(this.lastMatrix);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();

    if (blendEnabled) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    gl.blendFuncSeparate(blendSrc, blendDst, blendSrcA, blendDstA);
  }

  /** screen-space distance pick — 跨 3 個 slot 找最近的 unit */
  pickUnit(screenX: number, screenY: number, viewWidth: number, viewHeight: number): Unit | null {
    if (!this.lastMatrix) return null;
    const state = scenarioStore.getState();
    const threshold = 30;
    let closest: { unit: Unit; dist: number } | null = null;
    const mat = new THREE.Matrix4();

    for (const slot of Object.values(this.slots)) {
      if (!slot) continue;
      for (const [idx, unitId] of slot.indexToUnitId) {
        const unit = state.units[unitId];
        if (!unit) continue;
        slot.mesh.getMatrixAt(idx, mat);
        const v = new THREE.Vector4(
          mat.elements[12], mat.elements[13], mat.elements[14], 1.0,
        );
        v.applyMatrix4(this.lastMatrix);
        if (v.w <= 0) continue;
        const sx = ((v.x / v.w) * 0.5 + 0.5) * viewWidth;
        const sy = ((-v.y / v.w) * 0.5 + 0.5) * viewHeight;
        const dist = Math.hypot(sx - screenX, sy - screenY);
        if (dist < threshold && (!closest || dist < closest.dist)) {
          closest = { unit, dist };
        }
      }
    }

    return closest?.unit ?? null;
  }

  dispose() {
    for (const slot of Object.values(this.slots)) {
      if (!slot) continue;
      this.scene.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      (slot.mesh.material as THREE.Material).dispose();
    }
    this.slots = { land: null, air: null, sea: null, subsurface: null };
    this.renderer?.dispose();
    this.colorBySide.clear();
  }
}

function domainOf(kind: Unit["kind"]): Domain {
  switch (kind) {
    case "missile_launcher": return "land";
    case "drone": return "air";
    case "fighter": return "air";
    case "ship_surface": return "sea";
    case "submarine": return "subsurface";
    case "radar_station": return "land";
    case "sam_coastal": return "land";
    case "mobile_radar": return "land";
    case "sam_patriot": return "land";
    case "supply_ship": return "sea";
    case "airbase": return "land";
  }
}
