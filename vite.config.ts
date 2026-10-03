import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 웹은 서버 코드 중 contracts만 가져온다(docs/tickets/template-02-t02-1-contracts.md "공유 schema 정본").
export default defineConfig({
  envDir: process.env.LOCAL_ENV_WEB_DIR ?? process.cwd(),
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
  server: { host: "127.0.0.1", port: 55480, strictPort: true },
  preview: { host: "127.0.0.1", port: 55480, strictPort: true },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
