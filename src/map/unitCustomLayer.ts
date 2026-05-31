import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { UnitScene } from "../three/UnitScene";

export interface UnitLayerOptions {
  id?: string;
  getIsDarkTheme: () => boolean;
  getIsVisible: () => boolean;
  getOrbScale?: () => number;
  onSceneReady?: (scene: UnitScene) => void;
}

export function createUnitLayer(opts: UnitLayerOptions): CustomLayerInterface {
  const unitScene = new UnitScene();
  let map: MapboxMap | null = null;
  let lastDarkTheme = true;

  return {
    id: opts.id ?? "wargame-units-3d",
    type: "custom" as const,
    renderingMode: "3d" as const,

    onAdd(mapInstance: MapboxMap, gl: WebGLRenderingContext) {
      map = mapInstance;
      unitScene.init(gl);
      opts.onSceneReady?.(unitScene);
    },

    render(_gl: WebGLRenderingContext, matrix: number[]) {
      if (!opts.getIsVisible()) return;

      const isDark = opts.getIsDarkTheme();
      if (isDark !== lastDarkTheme) {
        lastDarkTheme = isDark;
        unitScene.setTheme(isDark);
      }
      if (opts.getOrbScale) unitScene.setOrbScale(opts.getOrbScale());

      unitScene.update();
      unitScene.render(matrix);

      map?.triggerRepaint();
    },

    onRemove() {
      unitScene.dispose();
    },
  };
}
