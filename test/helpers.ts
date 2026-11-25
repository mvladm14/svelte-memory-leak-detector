declare const gc: () => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait `ms`, collecting garbage every few milliseconds along the way. */
export async function collectFor(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    gc();
    await sleep(5);
  }
}

/** Wait `ms` without any forced collection. */
export const wait = sleep;
