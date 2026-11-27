import { expect, test } from "vitest";
import { reconnectDelay } from "./reconnect-delay.ts";

test("backs off from 500 ms and caps daemon restart retries at ten seconds", () => {
  expect(
    Array.from({ length: 9 }, (_, attempt) => reconnectDelay(attempt)),
  ).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000]);
  expect(reconnectDelay(-1)).toBe(500);
  expect(reconnectDelay(1000)).toBe(10000);
});
