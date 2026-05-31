import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { LighthouseScene } from "../three/LighthouseScene";

export interface LighthouseLayerOptions {
  getPositions: () => [number, number][];
  getIsDarkTheme: () => boolean;
  getIsPlaying: () => boolean;
  getIsVisible: () => boolean;
  getBeamVisible: () => boolean;
  getBeamDistance: () => number;
  getBeamOpacity: () => number;
}

export function createLighthouseLayer(opts: LighthouseLayerOptions): CustomLayerInterface {
  const scene = new LighthouseScene();
  let map: MapboxMap | null = null;
  let initialized = false;

  return {
    id: "lighthouse-3d",
    type: "custom" as const,
    renderingMode: "3d" as const,

    onAdd(mapInstance: MapboxMap, gl: WebGLRenderingContext) {
      map = mapInstance;
      scene.init(gl);
    },

    render(_gl: WebGLRenderingContext, matrix: number[]) {
      if (!initialized) {
        const positions = opts.getPositions();
        if (positions.length > 0) {
          scene.setPositions(positions);
          initialized = true;
        }
      }

      scene.playing = opts.getIsPlaying();
      scene.setBeamVisible(opts.getBeamVisible());
      scene.setBeamDistance(opts.getBeamDistance());
      scene.setBeamOpacity(opts.getBeamOpacity());

      if (!opts.getIsVisible()) return;

      scene.render(matrix);
      map?.triggerRepaint();
    },

    onRemove() {
      scene.dispose();
    },
  };
}
