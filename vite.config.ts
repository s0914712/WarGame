import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 部署到 GitHub Pages：
 *   - VITE_BASE_PATH 環境變數設成 "/<your-repo-name>/"（GitHub Actions 會帶）
 *   - 沒設就用 "./"（相對路徑，自動跟隨 host）
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // dev 才用 proxy（production 沒有後端） — 改 provider 只要動 .env 的 VITE_LLM_PROXY_TARGET
  const llmTarget = env.VITE_LLM_PROXY_TARGET || "https://api.apertis.ai";
  // GitHub Pages 部署在 /repo-name/ 子路徑；本機 dev 走根目錄
  const base = env.VITE_BASE_PATH || (mode === "production" ? "./" : "/");

  return {
    base,
    plugins: [react()],
    assetsInclude: ["**/*.vert", "**/*.frag"],
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/llm-proxy": {
          target: llmTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              const auth = req.headers["authorization"];
              if (auth) proxyReq.setHeader("Authorization", auth);
            });
          },
        },
        // TDX（交通部運輸資料）：dev 代理避免瀏覽器 CORS；TDX 即時公車/軌道來源。
        // TDX 閘道會擋瀏覽器特徵（headless UA / Origin / Sec-Fetch-*）→ 把外送標頭
        // 正規化成乾淨的伺服器請求（與 curl 等價，可通過）。
        "/tdx": {
          target: "https://tdx.transportdata.tw",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tdx/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("User-Agent", "curl/8.0");
              for (const h of [
                "origin", "referer", "cookie",
                "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
                "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
              ]) {
                proxyReq.removeHeader(h);
              }
            });
          },
        },
      },
    },
  };
});
