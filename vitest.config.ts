import { defineConfig } from "vitest/config";
import testEnv from "./testEnv.json";

export default defineConfig({
  test: {
    env: {
      ...testEnv,
    },
    testTimeout: 45_000,
    hookTimeout: 10_000,
  }, 
  
});
