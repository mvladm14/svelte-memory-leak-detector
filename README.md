# svelte-memory-leak-detector

A small, development-only memory-leak detector for **Svelte 5** components.

Add one Vite plugin. When a component is unmounted and is **still in memory 5 seconds later**, the detector reports it in the browser console:

```
[svelte-memory-leak-detector] <LeakyTimer> (src/lib/LeakyTimer.svelte) was unmounted 5s ago and is still in memory. …
```

It tracks components only, and is deliberately simple. It doesn't force or wait for a garbage collection, so a component the browser just hasn't collected yet gets reported too. Expect some false alarms. A component that is reported again and again is the one to look at.

## Install

```bash
npm install --save-dev svelte-memory-leak-detector
```

## Set up

Add the plugin to `vite.config.ts`, next to Svelte's plugin (SvelteKit's `sveltekit()` works the same way):

```ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import svelteLeakDetector from "svelte-memory-leak-detector/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelteLeakDetector(), svelte()],
});
```

That's it. The plugin only runs on the Vite dev server. Production builds, SSR, and Vitest don't run it.

### Options

```ts
svelteLeakDetector({
  delay: 5000,                      // ms after unmount before the check (default 5000)
  include: /\.svelte$/,             // files to instrument
  exclude: /[\\/]node_modules[\\/]/, // files to leave alone
});
```

## Reading reports in code

```ts
import { onLeak, getLeaks, clearLeaks, setLogging } from "svelte-memory-leak-detector";

const stop = onLeak((leak) => {
  // { component, file, mountedAt, unmountedAt, reportedAt }
  console.log("leaked:", leak.component);
});

getLeaks();        // every leak reported so far
clearLeaks();      // forget them
setLogging(false); // silence the console warning; listeners still fire
```

## How it works

The plugin adds one line to each component's instance `<script>`. It's added on the same line as the opening tag, so line numbers don't change. Components without a script get a new one.

```svelte
<script>const __leakMarker = __leak_track("Counter", "src/lib/Counter.svelte", 5000);__leak_onDestroy(() => __leak_unmounted(__leakMarker));
  let count = $state(0);
  setInterval(() => count++, 1000); // never cleared
</script>
```

`__leakMarker` is a tiny object that lives in the component's scope. Any closure created in that scope keeps the scope alive, and the marker with it. That includes a timer callback, an event listener, or a subscription. When Svelte destroys the component, the detector keeps only a `WeakRef` to the marker and checks it again after `delay` ms. If the marker is still there, it reports the component.

## Finding what holds a leaked component

Each marker is an instance of a class named `<Component>$LeakMarker`. In Chrome DevTools, open **Memory** and take a heap snapshot. Search for `LeakyTimer$LeakMarker` and open **Retainers**: it shows the chain that keeps the component alive, such as a `setInterval` callback or a `window` listener.

To tell a real leak from a false alarm, click **Collect garbage** (the bin icon in the Memory panel) and unmount the component again. A component that is reported every time is still referenced.

## Requirements

- Svelte 5
- Vite 5 or later, with `@sveltejs/vite-plugin-svelte` (or SvelteKit)
- A browser with `WeakRef` (all current browsers)

## License

MIT
