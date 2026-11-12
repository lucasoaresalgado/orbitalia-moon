import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    testTimeout: 15_000,
    // integration tests share one TEST_DATABASE_URL: run files one at a time
    fileParallelism: false,
  },
});
