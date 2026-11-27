import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";

let fixture: Awaited<ReturnType<typeof createTestFixture>>;
beforeEach(async () => {
  fixture = await createTestFixture();
});
afterEach(async () => {
  await fixture.close();
});

function request(options: {
  path: string;
  method?: string;
  headers?: { [key: string]: string };
}) {
  return fetch(`http://127.0.0.1:${fixture.address.port}${options.path}`, {
    method: options.method ?? "GET",
    headers: options.headers ?? { origin: TEST_WEB_ORIGIN },
  });
}

test("serves all catalog thumbnails without a project and keeps the Host, Origin and token checks", async () => {
  for (const entry of CHARGING_PORT_TYPES) {
    const response = await request({
      path: `/catalog/${entry.assetId}/thumb.png`,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      TEST_WEB_ORIGIN,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      readFileSync(
        new URL(`../../catalog/${entry.assetId}/thumb.png`, import.meta.url),
      ),
    );
  }
  const path = "/catalog/charging-port/thumb.png";
  expect((await request({ path, headers: {} })).status).toBe(401);
  expect(
    (await request({ path, headers: { authorization: "Bearer wrong" } }))
      .status,
  ).toBe(401);
  const authenticated = await request({
    path,
    headers: { authorization: `Bearer ${fixture.daemon.auth.internalToken}` },
  });
  expect(authenticated.status).toBe(200);
  await authenticated.arrayBuffer();
  expect(
    (await request({ path, headers: { origin: "https://untrusted.example" } }))
      .status,
  ).toBe(403);
  const wrongHostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: "127.0.0.1",
          port: fixture.address.port,
          path,
          headers: {
            origin: TEST_WEB_ORIGIN,
            host: `untrusted.example:${fixture.address.port}`,
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      outgoing.once("error", reject);
      outgoing.end();
    },
  );
  expect(wrongHostStatus).toBe(403);
});

test("rejects non-catalog ids, other files, nested paths and writes", async () => {
  for (const path of [
    "/catalog/unknown/thumb.png",
    "/catalog/__proto__/thumb.png",
    "/catalog/charging-port/model.glb",
    "/catalog/charging-port/meta.json",
    "/catalog/charging-port/thumb.png/extra",
    "/catalog/%2e%2e%2fcharging-port/thumb.png",
  ]) {
    expect((await request({ path })).status, path).toBe(404);
  }
  expect(
    (
      await request({
        path: "/catalog/charging-port/thumb.png",
        method: "POST",
      })
    ).status,
  ).toBe(404);
});
