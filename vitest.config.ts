import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests only: they must run with no network, no database and no AI calls.
// Anything that calls a real model belongs in scripts/eval/ instead.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
