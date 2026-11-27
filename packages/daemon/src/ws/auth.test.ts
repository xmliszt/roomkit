import { expect, test } from "vitest";
import { AuthService } from "./auth.ts";

test("accepts only this boot's internal token", () => {
  const auth = new AuthService();
  expect(auth.validateInternal(auth.internalToken)).toBe(true);
  expect(auth.validateInternal("invalid")).toBe(false);
  expect(auth.validateInternal("x".repeat(auth.internalToken.length))).toBe(
    false,
  );
  expect(new AuthService().validateInternal(auth.internalToken)).toBe(false);
});

test("allows a request with no origin or with a listed web origin only", () => {
  const auth = new AuthService();
  const webOrigins = ["http://localhost:3210", "http://127.0.0.1:3210"];
  expect(auth.allowsOrigin({ headers: {}, webOrigins })).toBe(true);
  for (const origin of webOrigins)
    expect(auth.allowsOrigin({ headers: { origin }, webOrigins })).toBe(true);
  for (const origin of [
    "https://untrusted.example.test",
    "null",
    "file://localhost",
    "http://localhost:3210/",
    "http://localhost:3211",
    "https://localhost:3210",
    "http://localhost:3210@untrusted.example.test",
  ])
    expect(auth.allowsOrigin({ headers: { origin }, webOrigins })).toBe(false);
});
