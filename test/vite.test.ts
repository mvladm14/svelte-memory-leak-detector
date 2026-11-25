import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import svelteLeakDetector, { componentName, injectedCode, instrumentComponent } from "../src/vite";

const FILE = "src/lib/Counter.svelte";
const INJECTED = injectedCode("Counter", FILE, 5000);
const instrument = (code: string, file = FILE) => instrumentComponent(code, file)?.code ?? null;

// The instrumented source must still compile.
function compiles(code: string) {
  expect(() => compile(code, { filename: "Counter.svelte", generate: "client", dev: true })).not.toThrow();
}

describe("instrumentComponent", () => {
  it("adds the marker right after the instance script tag, on the same line", () => {
    const src = `<script>\n  let count = $state(0);\n</script>\n\n<button onclick={() => count++}>{count}</button>\n`;
    const out = instrument(src)!;
    expect(out).toBe(src.replace("<script>", `<script>${INJECTED}`));
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    compiles(out);
  });

  it("keeps the script's attributes", () => {
    const src = `<script lang="ts" generics="T extends string">\n  let { value }: { value: T } = $props();\n</script>\n<p>{value}</p>\n`;
    const out = instrument(src)!;
    expect(out).toContain(`<script lang="ts" generics="T extends string">${INJECTED}`);
    compiles(out);
  });

  it("skips module scripts, in both syntaxes", () => {
    for (const moduleTag of ["<script module>", `<script context="module">`, "<script context='module' lang=\"ts\">"]) {
      const src = `${moduleTag}\n  export const x = 1;\n</script>\n<script>\n  let y = 2;\n</script>\n<p>{x}{y}</p>\n`;
      const out = instrument(src)!;
      expect(out).toContain(`${moduleTag}\n  export const x = 1;`);
      expect(out).toContain(`<script>${INJECTED}\n  let y = 2;`);
    }
  });

  it("adds an instance script to a component that has none", () => {
    const src = `<h1>Hello</h1>\n`;
    const out = instrument(src)!;
    expect(out).toBe(`${src}\n<script>${INJECTED}</script>\n`);
    compiles(out);
  });

  it("adds an instance script next to a module-only script, in the same language", () => {
    const src = `<script module lang="ts">\n  export const n: number = 1;\n</script>\n<p>{n}</p>\n`;
    const out = instrument(src)!;
    expect(out.endsWith(`\n<script lang="ts">${INJECTED}</script>\n`)).toBe(true);
    compiles(out);
  });

  it("ignores script tags inside comments and inside a script's body", () => {
    const src = `<!-- <script>nope</script> -->\n<script>\n  const html = "<script" + ">";\n</script>\n<p>{html}</p>\n`;
    const out = instrument(src)!;
    expect(out.indexOf(INJECTED)).toBe(src.indexOf("<script>\n") + "<script>".length);
    expect(out.split(INJECTED)).toHaveLength(2);
  });

  it("leaves already instrumented and self-closing scripts alone", () => {
    expect(instrumentComponent(instrument(`<p>x</p>`)!, FILE)).toBeNull();
    expect(instrumentComponent(`<script src="./x.js" />\n<p>x</p>`, FILE)).toBeNull();
  });

  it("uses the configured delay", () => {
    expect(instrumentComponent(`<p>x</p>`, FILE, 1234)!.code).toContain(`"${FILE}", 1234)`);
  });
});

describe("componentName", () => {
  it("is the file name, or route/+file for SvelteKit routes", () => {
    expect(componentName("src/lib/Counter.svelte")).toBe("Counter");
    expect(componentName("src/routes/about/+page.svelte")).toBe("about/+page");
    expect(componentName("+layout.svelte")).toBe("+layout");
  });
});

describe("plugin", () => {
  type Transform = (code: string, id: string, opts?: { ssr?: boolean }) => { code: string } | null;
  const plugin = svelteLeakDetector({ delay: 2000 });
  (plugin.configResolved as (c: { root: string }) => void)({ root: "/app" });
  const transform = plugin.transform as Transform;

  it("instruments client .svelte files with a path relative to the root", () => {
    const out = transform.call({}, `<p>x</p>`, "/app/src/App.svelte")!;
    expect(out.code).toContain(`__leak_track("App", "src/App.svelte", 2000)`);
  });

  it("skips SSR, queries, node_modules and other files", () => {
    expect(transform.call({}, `<p>x</p>`, "/app/src/App.svelte", { ssr: true })).toBeNull();
    expect(transform.call({}, `p{}`, "/app/src/App.svelte?svelte&type=style&lang.css")).toBeNull();
    expect(transform.call({}, `<p>x</p>`, "/app/node_modules/lib/Button.svelte")).toBeNull();
    expect(transform.call({}, `export {}`, "/app/src/main.ts")).toBeNull();
  });

  it("runs on the dev server only", () => {
    const apply = plugin.apply as (c: object, env: { command: string }) => boolean;
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(apply({}, { command: "serve" })).toBe(true);
      expect(apply({}, { command: "build" })).toBe(false);
    } finally {
      process.env.VITEST = vitest;
    }
  });
});
