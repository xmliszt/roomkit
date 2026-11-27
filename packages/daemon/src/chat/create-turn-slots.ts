/** Return a counter that lets at most `size` holders run at once; `acquire` resolves to a release function, or `undefined` when `signal` aborts first. */
export function createTurnSlots(options: { size: number }) {
  let free = options.size;
  const waiting: (() => void)[] = [];

  function release() {
    const next = waiting.shift();
    if (next) next();
    else free += 1;
  }

  return {
    acquire(signal: AbortSignal): Promise<(() => void) | undefined> {
      if (signal.aborted) return Promise.resolve(undefined);
      if (free > 0) {
        free -= 1;
        return Promise.resolve(release);
      }
      return new Promise((resolve) => {
        function grant() {
          signal.removeEventListener("abort", cancel);
          resolve(release);
        }
        function cancel() {
          const index = waiting.indexOf(grant);
          if (index >= 0) waiting.splice(index, 1);
          resolve(undefined);
        }
        waiting.push(grant);
        signal.addEventListener("abort", cancel, { once: true });
      });
    },
  };
}
