import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import base from "../vite.config.ts";

// An isolated worktree can use the pinned dependency install through a symlink.
export default mergeConfig(base, {
  server: {
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url)), realpathSync(new URL("../node_modules", import.meta.url))],
    },
  },
});
