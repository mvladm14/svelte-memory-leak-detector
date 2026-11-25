import { afterEach, describe, expect, it, vi } from "vitest";
import { __track, __unmounted, clearLeaks, getLeaks, onLeak, setLogging } from "svelte-memory-leak-detector";
import { collectFor, wait } from "./helpers";

setLogging(false);
afterEach(() => clearLeaks());

describe("runtime", () => {
  it("names each marker class after its component, for heap snapshots", () => {
    const marker = __track("Counter", "src/Counter.svelte", 100);
    expect(marker?.constructor.name).toBe("Counter$LeakMarker");
  });

  it("reports a component still in memory after the delay", async () => {
    const held = __track("Held", "src/Held.svelte", 50);
    __unmounted(held);
    await wait(120);
    expect(getLeaks()).toEqual([
      expect.objectContaining({ component: "Held", file: "src/Held.svelte" }),
    ]);
    expect(held).not.toBeNull(); // keep it reachable until here
  });

  it("does not report a component that was collected", async () => {
    (() => __unmounted(__track("Gone", "src/Gone.svelte", 80)))();
    await collectFor(150);
    expect(getLeaks()).toEqual([]);
  });

  it("does not report before the delay is up", async () => {
    const held = __track("Early", "src/Early.svelte", 200);
    __unmounted(held);
    await wait(50);
    expect(getLeaks()).toEqual([]);
  });

  it("warns in the console and notifies listeners", async () => {
    setLogging(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const off = onLeak((leak) => seen.push(leak.component));
    const held = __track("Loud", "src/Loud.svelte", 20);
    __unmounted(held);
    await wait(60);
    off();
    setLogging(false);
    expect(seen).toEqual(["Loud"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("<Loud> (src/Loud.svelte) was unmounted");
    expect(warn.mock.calls[0]?.[0]).toContain('"Loud$LeakMarker"');
    warn.mockRestore();
  });
});
