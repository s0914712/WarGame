import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BusVehicle, BusColorMode } from "../types";
import { toMercator } from "../utils/coordinates";

/**
 * 小巴士外形：車體長箱 + 車頂駝峰。長軸沿 +X，渲染時依行進方向繞 Z 轉向。
 * 尺寸為單位比例（實際大小由 instance scale 決定）。
 */
function makeBusGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1.9, 0.8, 0.55);
  const roof = new THREE.BoxGeometry(1.1, 0.72, 0.4);
  roof.translate(-0.1, 0, 0.4); // 車頂往後上方一點，像巴士車廂
  const merged = mergeGeometries([body, roof], false);
  return merged ?? body;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ── 速度漸層：紅(停)→橙(慢)→黃(正常)→綠(快) ──
const SPEED_STOPS = [
  { speed: 0,  color: new THREE.Color("#b71c1c") },  // 暗紅 — 停靠
  { speed: 3,  color: new THREE.Color("#e53935") },  // 紅
  { speed: 15, color: new THREE.Color("#ff9800") },  // 橙
  { speed: 30, color: new THREE.Color("#fdd835") },  // 黃
  { speed: 50, color: new THREE.Color("#66bb6a") },  // 綠
];

// ── 密度漸層：暗藍(冷門)→青→黃→紅(幹線) ──
const DENSITY_STOPS = [
  { count: 1,  color: new THREE.Color("#1a237e") },  // 暗藍
  { count: 3,  color: new THREE.Color("#0097a7") },  // 青
  { count: 8,  color: new THREE.Color("#fdd835") },  // 黃
  { count: 15, color: new THREE.Color("#ff5722") },  // 紅橙
];

function lerpStops(stops: { speed?: number; count?: number; color: THREE.Color }[], value: number, key: "speed" | "count"): THREE.Color {
  const result = new THREE.Color();
  if (value <= (stops[0] as any)[key]) return result.copy(stops[0]!.color);
  for (let i = 1; i < stops.length; i++) {
    const lo = (stops[i - 1] as any)[key] as number;
    const hi = (stops[i] as any)[key] as number;
    if (value <= hi) {
      const t = (value - lo) / (hi - lo);
      return result.copy(stops[i - 1]!.color).lerp(stops[i]!.color, t);
    }
  }
  return result.copy(stops[stops.length - 1]!.color);
}

/**
 * 公車場景 — InstancedMesh 光球（無 trail、無靜態路線）
 * 精簡版 RailScene，專為 GPS-based 公車設計
 */
export class BusScene {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer!: THREE.WebGLRenderer;

  private instancedMesh: THREE.InstancedMesh | null = null;
  private alphaAttribute: THREE.InstancedBufferAttribute | null = null;
  private maxInstances: number;
  private isDarkTheme = true;
  private orbScale = 0.000004;
  private altOffset = 0;

  private colorCache = new Map<string, THREE.Color>();
  private busPositions = new Map<number, BusVehicle>(); // instanceIndex → bus
  /** 視覺平滑：記住每輛車的上一幀 Mercator 座標 */
  private prevMercator = new Map<string, { x: number; y: number; z: number }>();
  private smoothFactor = 0.15; // 0=不動, 1=無平滑
  /** 每輛車的行進朝向（弧度，繞 Z），由位移推算，停車時沿用上一個值 */
  private heading = new Map<string, number>();

  private lastMatrix: THREE.Matrix4 | null = null;
  private _dummy = new THREE.Matrix4();
  private _quat = new THREE.Quaternion();
  private _pos = new THREE.Vector3();
  private _scl = new THREE.Vector3();

  constructor(maxInstances = 5000) {
    this.maxInstances = maxInstances;
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

    // 小巴士外形（取代原本的光球）— 實體車，不發光
    const geo = makeBusGeometry();
    const mat = new THREE.MeshLambertMaterial({
      transparent: true,            // 保留 per-instance 淡入淡出
      opacity: 1,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,             // 永遠畫在地圖之上，不被地形/建物遮擋
    });

    // Per-instance alpha attribute (for fade in/out) — 注入 shader
    this.alphaAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxInstances).fill(1),
      1,
    );
    this.alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aAlpha", this.alphaAttribute);

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float aAlpha;\nvarying float vAlpha;\n" +
        shader.vertexShader.replace(
          /void\s+main\s*\(\s*\)\s*\{/,
          "void main() {\n  vAlpha = aAlpha;",
        );
      shader.fragmentShader =
        "varying float vAlpha;\n" +
        shader.fragmentShader.replace(
          /\}\s*$/,
          "  gl_FragColor.a *= vAlpha;\n}",
        );
    };

    this.instancedMesh = new THREE.InstancedMesh(geo, mat, this.maxInstances);
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.count = 0;
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxInstances * 3),
      3,
    );
    this.scene.add(this.instancedMesh);

    // 燈光：讓實體巴士有立體明暗（車頂亮、車側暗）
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    const dir = new THREE.DirectionalLight(0xffffff, 0.95);
    dir.position.set(0.4, -0.5, 1).normalize();
    this.scene.add(ambient, dir);
  }

  setTheme(isDark: boolean) {
    if (this.isDarkTheme === isDark) return;
    this.isDarkTheme = isDark;
    this.colorCache.clear();
    if (this.instancedMesh) {
      const mat = this.instancedMesh.material as THREE.MeshLambertMaterial;
      mat.opacity = isDark ? 1 : 0.95;
    }
  }

  setOrbScale(scale: number) {
    this.orbScale = scale;
  }

  setAltitudeOffset(offset: number) {
    this.altOffset = offset;
  }

  private getColor(hex: string): THREE.Color {
    let c = this.colorCache.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      // 實體車由燈光提供明暗，不再為了發光加亮 → 用真實路線色
      this.colorCache.set(hex, c);
    }
    return c;
  }

  update(buses: BusVehicle[], colorMode: BusColorMode = "route") {
    if (!this.instancedMesh) return;
    // density 模式：直接讀 bus.density（preprocess 算好的班次/小時，固定值）
    // 不再每 frame 統計，負擔更低；顏色對同一班車永遠相同

    const dummy = this._dummy;
    const baseScale = this.orbScale * 0.5;
    const darkBoost = 1.0; // 實體車：燈光提供明暗，不額外加亮
    let count = 0;

    this.busPositions.clear();

    for (const bus of buses) {
      if (count >= this.maxInstances) break;

      const [lng, lat] = bus.position;
      if (lng === 0 && lat === 0) continue;

      const target = toMercator(lat, lng, this.altOffset);

      // 視覺平滑：route-snapped 的車不 lerp（位置已沿路線，lerp 會切角）
      // 無路線配對的車用 lerp 避免 GPS 跳躍
      const prev = this.prevMercator.get(bus.plateNumb);
      let fx: number, fy: number, fz: number;
      if (bus.progress > 0 || !prev) {
        // route-snapped 或首次出現：直接到位
        fx = target.x; fy = target.y; fz = target.z;
      } else {
        // 無路線：lerp 平滑
        const s = this.smoothFactor;
        fx = prev.x + (target.x - prev.x) * s;
        fy = prev.y + (target.y - prev.y) * s;
        fz = prev.z + (target.z - prev.z) * s;
      }

      // 行進朝向：由位移推算（繞 Z），停車時沿用上一個值，避免車頭亂轉
      if (prev) {
        const dx = fx - prev.x;
        const dy = fy - prev.y;
        if (dx !== 0 || dy !== 0) {
          this.heading.set(bus.plateNumb, Math.atan2(dy, dx));
        }
      }
      const ang = this.heading.get(bus.plateNumb) ?? 0;

      this.prevMercator.set(bus.plateNumb, { x: fx, y: fy, z: fz });

      this._quat.setFromAxisAngle(Z_AXIS, ang);
      this._pos.set(fx, fy, fz);
      this._scl.set(baseScale, baseScale, baseScale);
      dummy.compose(this._pos, this._quat, this._scl);
      this.instancedMesh.setMatrixAt(count, dummy);

      let color: THREE.Color;
      if (colorMode === "speed") {
        color = lerpStops(SPEED_STOPS, bus.speed, "speed");
        if (this.isDarkTheme) color.multiplyScalar(darkBoost);
      } else if (colorMode === "density") {
        // frequency（班次/小時）直接上色：高頻 → 暖色、低頻 → 冷色
        const freq = bus.density ?? 0.5;
        color = lerpStops(DENSITY_STOPS, freq, "count");
        if (this.isDarkTheme) color.multiplyScalar(darkBoost);
      } else {
        color = this.getColor(bus.color);
      }
      this.instancedMesh.instanceColor!.setXYZ(count, color.r, color.g, color.b);

      // Per-instance alpha（淡入淡出）
      if (this.alphaAttribute) {
        const a = bus.fadeAlpha ?? 1;
        this.alphaAttribute.setX(count, a);
      }

      this.busPositions.set(count, bus);
      count++;
    }

    this.instancedMesh.count = count;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      (this.instancedMesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    if (this.alphaAttribute) {
      this.alphaAttribute.needsUpdate = true;
    }

    // 清理不再活躍的平滑快取（每 60 幀一次）
    if (this.prevMercator.size > count * 2) {
      const activeKeys = new Set(buses.map((b) => b.plateNumb));
      for (const key of this.prevMercator.keys()) {
        if (!activeKeys.has(key)) {
          this.prevMercator.delete(key);
          this.heading.delete(key);
        }
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

  pickBus(screenX: number, screenY: number, viewWidth: number, viewHeight: number): BusVehicle | null {
    if (!this.lastMatrix || !this.instancedMesh) return null;

    const threshold = 25;
    let closest: { bus: BusVehicle; dist: number } | null = null;
    const mat = new THREE.Matrix4();

    for (const [idx, bus] of this.busPositions) {
      this.instancedMesh.getMatrixAt(idx, mat);
      const v = new THREE.Vector4(
        mat.elements[12], mat.elements[13], mat.elements[14], 1.0,
      );
      v.applyMatrix4(this.lastMatrix);
      if (v.w <= 0) continue;

      const sx = ((v.x / v.w) * 0.5 + 0.5) * viewWidth;
      const sy = ((-v.y / v.w) * 0.5 + 0.5) * viewHeight;
      const dist = Math.hypot(sx - screenX, sy - screenY);

      if (dist < threshold && (!closest || dist < closest.dist)) {
        closest = { bus, dist };
      }
    }

    return closest?.bus ?? null;
  }

  getVisibleCount(): number {
    return this.instancedMesh?.count ?? 0;
  }

  dispose() {
    if (this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh = null;
    }
    this.renderer?.dispose();
    this.colorCache.clear();
    this.busPositions.clear();
    this.prevMercator.clear();
    this.heading.clear();
  }
}
