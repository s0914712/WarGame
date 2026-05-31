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
      },
    },
  };
});
