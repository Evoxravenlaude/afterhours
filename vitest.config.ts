import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests always run against source, never a stale dist/ build.
export default defineConfig({
  resolve: {
    alias: {
      "@afterhours/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@afterhours/sources": fileURLToPath(new URL("./packages/sources/src/index.ts", import.meta.url)),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"] },
});
