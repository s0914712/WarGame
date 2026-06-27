import type { Map as MapboxMap } from "mapbox-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { Tile3DLayer } from "@deck.gl/geo-layers";
import { loadingRegistry } from "../lib/loadingRegistry";

/**
 * Google Photorealistic 3D Tiles 底圖（實景城市）。
 *
 * 用 deck.gl 的 Tile3DLayer + MapboxOverlay(interleaved) 疊在 Mapbox 上，
 * 讓既有的 RailScene / BusScene 等即時車輛光點跑在實景城市之上。
 *
 * 需要 `VITE_GOOGLE_3DTILES_KEY`（Google Cloud「Map Tiles API」金鑰，與 Blosm 用的同一支）。
 * Tile3DLayer 偵測到 googleapis 的 tileset 會自動套 Tiles3DLoader 並處理 session token。
 */
const GOOGLE_TILESET_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
const LOADING_ID = "photoreal3d";
const LOADING_LABEL = "實景 3D Photoreal";

export interface Photoreal3DHandle {
  setVisible(visible: boolean): void;
  remove(): void;
}

export function createPhotoreal3DTiles(map: MapboxMap): Photoreal3DHandle | null {
  const key = import.meta.env.VITE_GOOGLE_3DTILES_KEY as string | undefined;
  if (!key) {
    console.warn(
      "[photoreal3d] VITE_GOOGLE_3DTILES_KEY 未設定，略過實景 3D Tiles。" +
        "請在 .env 填入 Google Cloud「Map Tiles API」金鑰。",
    );
    return null;
  }

  let visible = true;
  // loadingRegistry：tileset 首次載入完成前維持 loading（符合「資料載入必須有 Loading UI」規則）
  let loadingActive = false;
  const endLoading = () => {
    if (loadingActive) {
      loadingRegistry.end(LOADING_ID);
      loadingActive = false;
    }
  };

  const buildLayer = () =>
    new Tile3DLayer({
      id: "google-photoreal-3dtiles",
      // 瀏覽器端：key 放 query param（避免自訂 header 觸發 CORS preflight → 403）。
      // deck.gl Tiles3DLoader 會把 key 與 session token 傳遞給子 tile 請求。
      data: `${GOOGLE_TILESET_URL}?key=${key}`,
      visible,
      // tileset 載入完成 → 結束 loading；附帶把 Google 版權字串顯示為 attribution
      onTilesetLoad: (tileset) => {
        endLoading();
        const copyright = tileset?.credits?.attributions ?? "";
        if (copyright) {
          map.getContainer().setAttribute("data-photoreal3d-credit", String(copyright));
        }
      },
    });

  const overlay = new MapboxOverlay({
    interleaved: true,
    layers: [buildLayer()],
  });

  loadingRegistry.start(LOADING_ID, LOADING_LABEL);
  loadingActive = true;
  map.addControl(overlay);

  return {
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      overlay.setProps({ layers: [buildLayer()] });
    },
    remove() {
      endLoading();
      map.removeControl(overlay);
    },
  };
}
