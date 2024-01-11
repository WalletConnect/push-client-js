import { ParsedStack } from "vitest";
import { defineConfig } from "vitest/config";
import testEnv from "./testEnv.json";

export default defineConfig({
  test: {
    env: {
      ...testEnv,
    },
    testTimeout: 60_000,
    hookTimeout: 10_000,
  }, 
});
