// Vite plugin: adds the leak marker to every Svelte component. Dev server
// only (`apply: "serve"`), client code only (SSR transforms are left alone).
//
// It runs before `@sveltejs/vite-plugin-svelte` compiles the component, and
// adds one line of code right after the instance `<script>` opening tag, on
// the same line, so line numbers in the component don't move:
//
//     <script lang="ts">import { onDestroy as … } from "svelte"; … const __leakMarker = …;
//
// A component without an instance script gets one appended at the end of the
// file. Svelte 5 only.

import path from "node:path";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export type SvelteLeakDetectorOptions = {
  /** How long after unmount a component still in memory is reported, in ms. Default: 5000. */
  delay?: number;
  /** Files to instrument. Default: `.svelte` files. */
  include?: RegExp;
  /** Files to leave alone. Default: anything in `node_modules`. */
  exclude?: RegExp;
};

export const DEFAULT_DELAY_MS = 5000;
const RUNTIME = "svelte-memory-leak-detector";
const MARKER = "__leakMarker";

// A comment, or a `<script …>` / `<script … />` opening tag (attributes may be
// quoted and contain `>`). Same idea as Svelte's own preprocessor.
const TAG_RE =
  /<!--[\s\S]*?-->|<script((?:\s+[^\s=>'"/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const CLOSE_RE = /<\/script\s*>/g;

type ScriptTag = {
  attrs: string;
  /** Offset right after the opening tag's `>`. */
  contentStart: number;
  selfClosing: boolean;
  isModule: boolean;
};

function findScripts(code: string): ScriptTag[] {
  const scripts: ScriptTag[] = [];
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(code))) {
    if (match[0].startsWith("<!--")) continue;
    const attrs = match[1] ?? "";
    const selfClosing = match[2] === "/";
    const contentStart = match.index + match[0].length;
    scripts.push({ attrs, contentStart, selfClosing, isModule: isModuleScript(attrs) });
    if (!selfClosing) {
      // Skip the script's body so a "<script" inside it isn't taken for a tag.
      CLOSE_RE.lastIndex = contentStart;
      const close = CLOSE_RE.exec(code);
      TAG_RE.lastIndex = close ? close.index + close[0].length : code.length;
    }
  }
  return scripts;
}

// `<script module>`, or its deprecated spelling `<script context="module">`.
function isModuleScript(attrs: string): boolean {
  return /(?:^|\s)context\s*=\s*["']?module["']?(?=\s|$)/.test(attrs) || /(?:^|\s)module(?=\s|=|$)/.test(attrs);
}

/** Component name for the report: the file name, or `route/+page` for SvelteKit route files. */
export function componentName(file: string): string {
  const base = path.basename(file).replace(/\.svelte$/, "");
  if (!base.startsWith("+")) return base;
  const parent = path.basename(path.dirname(file));
  return parent && parent !== "." ? `${parent}/${base}` : base;
}

export function injectedCode(component: string, file: string, delayMs: number): string {
  return (
    `import { onDestroy as __leak_onDestroy } from "svelte";` +
    `import { __track as __leak_track, __unmounted as __leak_unmounted } from "${RUNTIME}";` +
    `const ${MARKER} = __leak_track(${JSON.stringify(component)}, ${JSON.stringify(file)}, ${delayMs});` +
    `__leak_onDestroy(() => __leak_unmounted(${MARKER}));`
  );
}

/**
 * Add the leak marker to a component's source. `file` is the path shown in
 * reports. Returns `null` when the file can't or needn't be instrumented.
 */
export function instrumentComponent(
  code: string,
  file: string,
  delayMs: number = DEFAULT_DELAY_MS,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
  if (code.includes(MARKER)) return null;

  const scripts = findScripts(code);
  const instance = scripts.find((s) => !s.isModule);
  const injection = injectedCode(componentName(file), file, delayMs);
  const s = new MagicString(code);

  if (instance) {
    // `<script src="…" />` and friends: nowhere to put the code.
    if (instance.selfClosing) return null;
    s.appendLeft(instance.contentStart, injection);
  } else {
    // Keep the module script's language, if any, so the component stays consistent.
    const lang = scripts[0]?.attrs.match(/\slang\s*=\s*(["']?)([\w-]+)\1/)?.[2];
    s.append(`\n<script${lang ? ` lang="${lang}"` : ""}>${injection}</script>\n`);
  }

  return {
    code: s.toString(),
    map: s.generateMap({ source: file, includeContent: true, hires: "boundary" }),
  };
}

export default function svelteLeakDetector(options: SvelteLeakDetectorOptions = {}): Plugin {
  const delayMs = options.delay ?? DEFAULT_DELAY_MS;
  const include = options.include ?? /\.svelte$/;
  const exclude = options.exclude ?? /[\\/]node_modules[\\/]/;
  let root = process.cwd();

  return {
    name: "svelte-memory-leak-detector",
    enforce: "pre",
    // Dev server only; never in production builds or under Vitest.
    apply: (_config, env) => env.command === "serve" && !process.env.VITEST,

    configResolved(config) {
      root = config.root;
    },

    transform(code, id, transformOptions) {
      // Svelte's virtual CSS modules and other requests carry a `?query`.
      if (id.includes("?") || !include.test(id) || exclude.test(id)) return null;
      const ssr =
        transformOptions?.ssr ??
        (this as { environment?: { config: { consumer: string } } }).environment?.config.consumer === "server";
      if (ssr) return null;
      const file = path.relative(root, id).split(path.sep).join("/");
      return instrumentComponent(code, file, delayMs);
    },
  };
}

export { svelteLeakDetector };
