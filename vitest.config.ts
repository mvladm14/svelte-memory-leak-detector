import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { instrumentComponent } from "./src/vite.ts";

const runtime = path.resolve("src/index.ts");

export default defineConfig({
  // The real plugin switches itself off under Vitest; the component tests
  // instrument their fixtures directly, with a short delay.
  plugins: [
    {
      name: "instrument-fixtures",
      enforce: "pre",
      transform(code, id) {
        if (!id.includes("/test/fixtures/") || !id.endsWith(".svelte")) return null;
        return instrumentComponent(code, path.relative(process.cwd(), id), 100);
      },
    },
    svelte({ compilerOptions: { dev: true } }),
  ],
  resolve: {
    conditions: ["browser"],
    alias: { "svelte-memory-leak-detector": runtime },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "jsdom",
    pool: "forks",
    // The tests force garbage collections to tell a held component from a collected one.
    execArgv: ["--expose-gc"],
  },
});
