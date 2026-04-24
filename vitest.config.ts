import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: "forks", // each test file gets its own Node process (fresh module graph + fresh SQLite)
    poolOptions: {
      forks: { singleFork: false },
    },
  },
});
