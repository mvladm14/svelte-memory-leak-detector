// Real Svelte components, compiled with the marker injected (see vitest.config.ts),
// mounted and unmounted in jsdom.
import { flushSync, mount, unmount, type Component } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { clearLeaks, getLeaks, setLogging } from "svelte-memory-leak-detector";
import Clean from "./fixtures/Clean.svelte";
import Leaky from "./fixtures/Leaky.svelte";
import ModuleOnly from "./fixtures/ModuleOnly.svelte";
import TemplateOnly from "./fixtures/TemplateOnly.svelte";
import { collectFor } from "./helpers";

setLogging(false);
afterEach(() => clearLeaks());

async function mountAndUnmount(component: Component<any>): Promise<void> {
  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(component, { target });
  flushSync();
  await unmount(app);
  target.remove();
}

const reported = () => getLeaks().map((leak) => leak.component);

describe("components", () => {
  it("reports a component kept alive by a timer", async () => {
    await mountAndUnmount(Leaky);
    await collectFor(250);
    expect(reported()).toEqual(["Leaky"]);
    expect(getLeaks()[0]?.file).toBe("test/fixtures/Leaky.svelte");
  });

  it("does not report components that cleaned up", async () => {
    await mountAndUnmount(Clean);
    await mountAndUnmount(TemplateOnly);
    await mountAndUnmount(ModuleOnly);
    await collectFor(250);
    expect(reported()).toEqual([]);
  });

  it("reports one leak per leaked instance", async () => {
    await mountAndUnmount(Leaky);
    await mountAndUnmount(Leaky);
    await mountAndUnmount(Clean);
    await collectFor(250);
    expect(reported()).toEqual(["Leaky", "Leaky"]);
  });
});
