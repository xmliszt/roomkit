import { expect, test } from "vitest";
import { createTurnSlots } from "./create-turn-slots.ts";

test("lets two holders run, queues the third, and skips a waiter that aborted", async () => {
  const slots = createTurnSlots({ size: 2 });
  const first = await slots.acquire(new AbortController().signal);
  const second = await slots.acquire(new AbortController().signal);
  const abandoned = new AbortController();
  const waitingAbandoned = slots.acquire(abandoned.signal);
  let third: (() => void) | undefined;
  const waitingThird = slots
    .acquire(new AbortController().signal)
    .then((release) => {
      third = release;
    });
  await Promise.resolve();
  expect(third).toBeUndefined();
  abandoned.abort();
  expect(await waitingAbandoned).toBeUndefined();
  first?.();
  await waitingThird;
  expect(third).toBeTypeOf("function");
  second?.();
});
