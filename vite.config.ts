import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { readLocalConfig } from "./scripts/local-config.mjs";

const { webPort } = readLocalConfig();
let fallbackOutDir = "dist";

// 웹은 서버 코드 중 공유 contracts만 가져온다.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    tailwindcss(),
    {
      // GitHub Pages는 없는 경로에 404.html을 준다. 같은 앱을 내보내 상세 URL 직접 진입·새로고침을 처리한다.
      name: "pages-404-fallback",
      apply: "build",
      configResolved(config) {
        fallbackOutDir = resolve(config.root, config.build.outDir);
      },
      closeBundle() {
        copyFileSync(resolve(fallbackOutDir, "index.html"), resolve(fallbackOutDir, "404.html"));
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
