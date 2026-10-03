import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 웹은 서버 코드 중 contracts만 가져온다(docs/tickets/template-02-t02-1-contracts.md "공유 schema 정본").
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@contracts": fileURLToPath(new URL("./supabase/functions/_shared/contracts", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", port: 55480, strictPort: true },
  preview: { host: "127.0.0.1", port: 55480, strictPort: true },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
