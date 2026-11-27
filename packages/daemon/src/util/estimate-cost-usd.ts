import { getModelFamily } from "../agent/get-model-family.ts";
import type { AgentUsage } from "../agent/stream-json.ts";

type Rate = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const RATES: { [pattern: string]: Rate } = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  fable: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
const FALLBACK: Rate = RATES.sonnet ?? {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

function rateFor(model: string): Rate {
  const key = getModelFamily({ model });
  return key ? (RATES[key] ?? FALLBACK) : FALLBACK;
}

export function estimateCostUsd(options: {
  usage: AgentUsage;
  model: string;
  rates?: { input: number; output: number } | undefined;
}): number {
  const defaults = rateFor(options.model);
  const rate = options.rates
    ? {
        ...options.rates,
        cacheRead: options.rates.input * 0.1,
        cacheWrite: options.rates.input * 1.25,
      }
    : defaults;
  const u = options.usage;
  return (
    ((u.inputTokens ?? 0) * rate.input +
      (u.outputTokens ?? 0) * rate.output +
      (u.cacheRead ?? 0) * rate.cacheRead +
      (u.cacheWrite ?? 0) * rate.cacheWrite) /
    1_000_000
  );
}
