export function createLightFade() {
  let on = false;
  let from = 0;
  let startedAtMs = 0;

  function sample(nowMs: number) {
    const progress = Math.max(
      0,
      Math.min(1, (nowMs - startedAtMs) / (on ? 600 : 400)),
    );
    const eased = on
      ? 1 - (1 - progress) ** 3
      : progress < 0.5
        ? 4 * progress ** 3
        : 1 - (-2 * progress + 2) ** 3 / 2;
    return from + ((on ? 1 : 0) - from) * eased;
  }

  return {
    advance(options: { on: boolean; nowMs: number; reduced: boolean }) {
      if (options.on !== on) {
        from = sample(options.nowMs);
        on = options.on;
        startedAtMs = options.nowMs;
      }
      const value = options.reduced ? (on ? 1 : 0) : sample(options.nowMs);
      if (options.reduced) from = value;
      return { value, active: value !== (on ? 1 : 0) };
    },
  };
}
