// Runtime half of the detector. The Vite plugin (`svelte-memory-leak-detector/vite`)
// adds two calls to every component's instance script:
//
//     const __leakMarker = __track("Counter", "src/lib/Counter.svelte", 5000);
//     onDestroy(() => __unmounted(__leakMarker));
//
// The marker is a tiny object that lives in the component's scope. Any
// closure created in that scope (a timer callback, an event listener, a store
// subscription) keeps the scope alive, and with it the marker. So once the
// component is destroyed, the marker staying in memory means something still
// holds on to the component.
//
// The check is deliberately simple: the detector keeps only a WeakRef to the
// marker and looks again `delayMs` later. Still there → reported. It does not
// wait for, or force, a garbage collection, so a component the browser simply
// hasn't collected yet is reported too.

export type LeakReport = {
  /** Component name, taken from its file name. */
  component: string;
  /** Component file, relative to the Vite root. */
  file: string;
  /** When the component was created (`Date.now()`). */
  mountedAt: number;
  /** When Svelte destroyed it. */
  unmountedAt: number;
  /** When the detector found it still in memory. */
  reportedAt: number;
};

export type LeakListener = (leak: LeakReport) => void;

type Marker = {
  readonly component: string;
  readonly file: string;
  readonly delayMs: number;
  readonly mountedAt: number;
};

type MarkerClass = new (component: string, file: string, delayMs: number) => Marker;

const PREFIX = "[svelte-memory-leak-detector]";
const leaks: LeakReport[] = [];
const listeners = new Set<LeakListener>();
const markerClasses = new Map<string, MarkerClass>();
let logging = true;

/**
 * One marker class per component, named `<Component>$LeakMarker`, so a leaked
 * component is easy to find in a DevTools heap snapshot.
 */
function markerClassFor(component: string): MarkerClass {
  let cls = markerClasses.get(component);
  if (!cls) {
    const name = `${component}$LeakMarker`;
    // A class defined as a computed property takes the property's name.
    cls = {
      [name]: class implements Marker {
        readonly mountedAt = Date.now();
        constructor(
          readonly component: string,
          readonly file: string,
          readonly delayMs: number,
        ) {}
      },
    }[name]!;
    markerClasses.set(component, cls);
  }
  return cls;
}

/** @internal Called by the code the Vite plugin injects, once per component instance. */
export function __track(component: string, file: string, delayMs: number): Marker | null {
  if (typeof window === "undefined" || typeof WeakRef === "undefined") return null;
  return new (markerClassFor(component))(component, file, delayMs);
}

/** @internal Called from the component's `onDestroy`. */
export function __unmounted(marker: Marker | null): void {
  if (!marker) return;
  const { component, file, mountedAt, delayMs } = marker;
  check(new WeakRef(marker), { component, file, mountedAt, unmountedAt: Date.now() }, delayMs);
}

// Kept apart from `__unmounted` so the timer's closure can't capture the
// marker itself, only the WeakRef.
function check(ref: WeakRef<Marker>, info: Omit<LeakReport, "reportedAt">, delayMs: number): void {
  setTimeout(() => {
    if (ref.deref() !== undefined) report({ ...info, reportedAt: Date.now() });
  }, delayMs);
}

function report(leak: LeakReport): void {
  leaks.push(leak);
  if (logging) {
    const seconds = Math.round((leak.reportedAt - leak.unmountedAt) / 100) / 10;
    console.warn(
      `${PREFIX} <${leak.component}> (${leak.file}) was unmounted ${seconds}s ago and is still in memory. ` +
        `Something (a timer, an event listener, a subscription, a global) may still reference it. ` +
        `To see what holds it, take a heap snapshot in DevTools → Memory and search for "${leak.component}$LeakMarker". ` +
        `(The browser may also just not have collected garbage yet.)`,
    );
  }
  for (const listener of listeners) {
    try {
      listener(leak);
    } catch (error) {
      console.error(`${PREFIX} a leak listener threw`, error);
    }
  }
}

/** Call `listener` for every leak reported from now on. Returns an unsubscribe function. */
export function onLeak(listener: LeakListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every leak reported so far, oldest first. */
export function getLeaks(): LeakReport[] {
  return leaks.slice();
}

/** Forget the leaks reported so far. */
export function clearLeaks(): void {
  leaks.length = 0;
}

/** Turn the console warning off (listeners and `getLeaks()` still work) or back on. */
export function setLogging(enabled: boolean): void {
  logging = enabled;
}
