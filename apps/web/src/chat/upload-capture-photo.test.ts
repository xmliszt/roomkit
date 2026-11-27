import { afterEach, expect, test, vi } from "vitest";
import { uploadCapturePhoto } from "./upload-capture-photo.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("uploads a requested photo as capture rather than a chat attachment", async () => {
  vi.stubEnv("NEXT_PUBLIC_PLANNER_PORT", "49101");
  const fetchPhoto = vi
    .fn()
    .mockResolvedValue(
      Response.json({ photoId: "photo-1", fileName: "photo-1.heic" }),
    );
  vi.stubGlobal("fetch", fetchPhoto);
  const file = new File(["fixture"], "Room & wall.heic");
  await expect(
    uploadCapturePhoto({ projectId: "project-1", file }),
  ).resolves.toEqual({ photoId: "photo-1", fileName: "photo-1.heic" });
  expect(fetchPhoto).toHaveBeenCalledExactlyOnceWith(
    "http://127.0.0.1:49101/projects/project-1/photos?fileName=Room+%26+wall.heic&origin=capture",
    { method: "POST", body: file },
  );
});

test("reports a rejected upload without treating it as an added capture photo", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("Invalid image", { status: 415 })),
  );
  await expect(
    uploadCapturePhoto({
      projectId: "project-1",
      file: new File(["fixture"], "room.png"),
    }),
  ).rejects.toThrow("Invalid image");
});

test("refuses a successful response without a usable photo ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ fileName: "room.png" })),
  );
  await expect(
    uploadCapturePhoto({
      projectId: "project-1",
      file: new File(["fixture"], "room.png"),
    }),
  ).rejects.toThrow();
});
