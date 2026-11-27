import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import { expect, test, vi } from "vitest";
import type { ToolContext } from "../tool-context.ts";
import { inventorySubmit } from "./inventory-submit.ts";

function buildContext(options: { result?: unknown; error?: string }) {
  const request = vi.fn(async (_command: ClientCommand) => ({
    ok: options.error === undefined,
    result: options.result,
    ...(options.error !== undefined ? { error: options.error } : {}),
  }));
  const context = {
    projectId: "00000000-0000-4000-8000-000000000001",
    turnId: "00000000-0000-4000-8000-000000000002",
    link: { request, readJob: () => undefined, close() {} },
  } satisfies ToolContext;
  return { context, request };
}

test("sends the inventory with the server-supplied project and turn", async () => {
  const { context, request } = buildContext({ result: { submitted: 0 } });
  expect(await inventorySubmit.call({ objects: [] }, context)).toEqual({
    submitted: 0,
  });
  expect(request).toHaveBeenCalledWith({
    type: "agent.inventory.submit",
    projectId: context.projectId,
    turnId: context.turnId,
    objects: [],
  });
});

test("refuses an agent override of the active turn before calling the daemon", async () => {
  const { context, request } = buildContext({ result: { submitted: 0 } });
  await expect(
    inventorySubmit.call({ objects: [], turnId: "other-turn" }, context),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

test("returns daemon refusal and rejects an invalid acknowledgement", async () => {
  const refused = buildContext({ error: "Inventory already submitted" });
  await expect(
    inventorySubmit.call({ objects: [] }, refused.context),
  ).rejects.toThrow("Inventory already submitted");
  const invalid = buildContext({ result: { submitted: -1 } });
  await expect(
    inventorySubmit.call({ objects: [] }, invalid.context),
  ).rejects.toThrow();
});

test("advertises and forwards wall openings and refuses other mounts", async () => {
  const object = {
    objectId: "door",
    name: "Sliding door",
    mount: "wall",
    cutsOpening: true,
    bestPhotoId: "photo-1",
    views: [
      {
        photoId: "photo-1",
        box: [0, 0, 200, 300],
        visibility: "mostly-visible",
      },
    ],
  };
  const { context, request } = buildContext({ result: { submitted: 1 } });
  expect(inventorySubmit.inputSchema).toMatchObject({
    properties: {
      objects: { items: { properties: { cutsOpening: { type: "boolean" } } } },
    },
  });
  expect(await inventorySubmit.call({ objects: [object] }, context)).toEqual({
    submitted: 1,
  });
  expect(request).toHaveBeenLastCalledWith({
    type: "agent.inventory.submit",
    projectId: context.projectId,
    turnId: context.turnId,
    objects: [object],
  });
  request.mockClear();
  for (const mount of ["floor", "ceiling"])
    await expect(
      inventorySubmit.call({ objects: [{ ...object, mount }] }, context),
    ).rejects.toThrow("Only wall objects");
  expect(request).not.toHaveBeenCalled();
  for (const mount of ["wall", "floor", "ceiling"]) {
    await inventorySubmit.call(
      { objects: [{ ...object, mount, cutsOpening: false }] },
      context,
    );
    const { cutsOpening, ...withoutOpening } = object;
    expect(cutsOpening).toBe(true);
    expect(request).toHaveBeenLastCalledWith({
      type: "agent.inventory.submit",
      projectId: context.projectId,
      turnId: context.turnId,
      objects: [{ ...withoutOpening, mount }],
    });
  }
});
