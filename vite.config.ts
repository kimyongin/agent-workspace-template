import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { readLocalConfig } from "./scripts/local-config.mjs";

const { webPort } = readLocalConfig();

// 웹은 서버 코드 중 공유 contracts만 가져온다.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    {
      // GitHub Pages는 없는 경로에 404.html을 준다. 같은 앱을 내보내 상세 URL 직접 진입·새로고침을 처리한다.
      name: "pages-404-fallback",
      apply: "build",
      closeBundle() {
        copyFileSync("dist/index.html", "dist/404.html");
      },
    },
  ],
  resolve: {
    alias: {
      "@contracts": fileURLToPath(new URL("./supabase/functions/_shared/contracts", import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        samples: fileURLToPath(new URL("./design-samples/index.html", import.meta.url)),
      },
    },
  },
  server: { host: "127.0.0.1", port: webPort, strictPort: true },
  preview: { host: "127.0.0.1", port: webPort, strictPort: true },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
