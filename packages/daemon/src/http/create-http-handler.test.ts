import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { SnapshotSaveResultSchema } from "@planner/shared/src/protocol/snapshot-save-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import sharp from "sharp";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildTestZip } from "../archive/build-test-zip.ts";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";

const catalogFolder = fileURLToPath(
  new URL(`../../catalog/${CHARGING_PORT.assetId}`, import.meta.url),
);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest of the image"),
]);
const port: Item = {
  id: "port",
  name: CHARGING_PORT.name,
  model: { kind: "asset", assetId: CHARGING_PORT.assetId },
  placement: {
    kind: "wall",
    wallId: "wall-2",
    alongM: 1.2,
    heightM: CHARGING_PORT.defaultHeightM,
    rotationRad: 0,
  },
  sizeM: CHARGING_PORT.sizeM,
  locked: false,
};

let fixture: Awaited<ReturnType<typeof createTestFixture>>;
beforeEach(async () => {
  fixture = await createTestFixture();
});
afterEach(async () => {
  await fixture.close();
});

function request(
  path: string,
  init: RequestInit & { headers?: { [name: string]: string } } = {},
) {
  return fetch(`http://127.0.0.1:${fixture.address.port}${path}`, {
    ...init,
    headers: { origin: TEST_WEB_ORIGIN, ...init.headers },
  });
}

function postRaw(options: {
  path: string;
  headers: { [name: string]: string };
  chunks: Buffer[];
}) {
  return new Promise<number | undefined>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: fixture.address.port,
        method: "POST",
        path: options.path,
        headers: { origin: TEST_WEB_ORIGIN, ...options.headers },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    outgoing.once("error", reject);
    for (const chunk of options.chunks) outgoing.write(chunk);
    outgoing.end();
  });
}

function createProject() {
  return fixture.daemon.store.createProject({
    name: "Living room",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
}

test("answers a CORS preflight from the web app without a token", async () => {
  const response = await request("/projects/import", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe(
    TEST_WEB_ORIGIN,
  );
  expect(response.headers.get("access-control-allow-methods")).toContain(
    "POST",
  );
  expect(response.headers.get("access-control-allow-headers")).toBe(
    "content-type",
  );
});

test("a request with no Origin needs the token as a Bearer token; another origin gets 403", async () => {
  const project = createProject();
  const url = `http://127.0.0.1:${fixture.address.port}/projects/${project.id}/export`;
  expect((await fetch(url)).status).toBe(401);
  expect(
    (await fetch(url, { headers: { authorization: "Bearer wrong" } })).status,
  ).toBe(401);
  expect(
    (
      await fetch(url, {
        headers: {
          authorization: `Bearer ${fixture.daemon.auth.internalToken}`,
        },
      })
    ).status,
  ).toBe(200);
  expect(
    (await fetch(url, { headers: { origin: "https://evil.example.test" } }))
      .status,
  ).toBe(403);
});

test("stores an uploaded photo as received, HEIC included", async () => {
  const project = createProject();
  const bytes = readFileSync(
    new URL("../../test/fixtures/oriented.heic", import.meta.url),
  );
  const response = await request(
    `/projects/${project.id}/photos?origin=capture&fileName=sample-room.HEIC`,
    { method: "POST", body: bytes },
  );
  expect(response.status).toBe(201);
  const result = PhotoUploadResultSchema.parse(await response.json());
  expect(result.fileName).toBe(`${result.photoId}.heic`);
  expect(
    readFileSync(
      join(
        fixture.daemon.store.projectPath(project.id),
        "photos",
        result.fileName,
      ),
    ),
  ).toStrictEqual(bytes);
  expect(
    (
      await request(
        `/projects/${project.id}/photos?origin=capture&fileName=notes.txt`,
        {
          method: "POST",
          body: bytes,
        },
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await request(
        "/projects/00000000-0000-4000-8000-000000000000/photos?origin=capture&fileName=a.jpg",
        { method: "POST", body: bytes },
      )
    ).status,
  ).toBe(404);
});

test("accepts a WebP photo upload", async () => {
  const project = createProject();
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#c08040" },
  })
    .webp()
    .toBuffer();
  const response = await request(
    `/projects/${project.id}/photos?origin=chat&fileName=product.webp`,
    { method: "POST", body: bytes },
  );
  expect(response.status).toBe(201);
  const result = PhotoUploadResultSchema.parse(await response.json());
  expect(result.fileName).toBe(`${result.photoId}.webp`);
});

test("saves a PNG snapshot under a timestamp and refuses other bytes", async () => {
  const project = createProject();
  const first = await request(`/projects/${project.id}/snapshots`, {
    method: "POST",
    body: PNG,
  });
  expect(first.status).toBe(201);
  const { fileName } = SnapshotSaveResultSchema.parse(await first.json());
  expect(fileName).toMatch(
    /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z(-\d+)?\.png$/,
  );
  const second = SnapshotSaveResultSchema.parse(
    await (
      await request(`/projects/${project.id}/snapshots`, {
        method: "POST",
        body: PNG,
      })
    ).json(),
  );
  expect(second.fileName).not.toBe(fileName);
  const folder = join(
    fixture.daemon.store.projectPath(project.id),
    "snapshots",
  );
  expect(readFileSync(join(folder, fileName))).toStrictEqual(PNG);
  expect(
    (
      await request(`/projects/${project.id}/snapshots`, {
        method: "POST",
        body: Buffer.from("GIF89a"),
      })
    ).status,
  ).toBe(415);
  expect(readdirSync(folder).toSorted()).toStrictEqual(
    [fileName, second.fileName].toSorted(),
  );
});

test("serves the files of a project asset and nothing else", async () => {
  const project = createProject();
  fixture.daemon.store.applyCommand({
    projectId: project.id,
    command: { type: "item.add", item: port },
    requestId: undefined,
  });
  const base = `/projects/${project.id}/assets/${CHARGING_PORT.assetId}`;
  const model = await request(`${base}/model.glb`);
  expect(model.status).toBe(200);
  expect(model.headers.get("content-type")).toBe("model/gltf-binary");
  expect(Buffer.from(await model.arrayBuffer())).toStrictEqual(
    readFileSync(join(catalogFolder, "model.glb")),
  );
  expect((await request(`${base}/thumb.png`)).headers.get("content-type")).toBe(
    "image/png",
  );
  expect(await (await request(`${base}/meta.json`)).json()).toMatchObject({
    id: CHARGING_PORT.assetId,
  });
  for (const path of [
    `${base}/project.json`,
    `${base}/../../project.json`,
    `/projects/${project.id}/assets/missing/model.glb`,
    `/projects/${project.id}/assets/..%2F..%2Fproject.json/model.glb`,
  ])
    expect((await request(path)).status, path).toBe(404);
});

test("serves the thumbnail and model a failed alternative kept, and nothing else", async () => {
  const project = createProject();
  const jobId = crypto.randomUUID();
  const kept = join(
    fixture.daemon.store.projectPath(project.id),
    ".planner/generation",
    jobId,
    "normalized",
  );
  mkdirSync(kept, { recursive: true });
  writeFileSync(join(kept, "thumb.png"), PNG);
  writeFileSync(join(kept, "model.glb"), "glTF");
  writeFileSync(join(kept, "points.bin"), "points");
  const base = `/projects/${project.id}/rejected/${jobId}`;
  const thumb = await request(`${base}/thumb.png`);
  expect(thumb.status).toBe(200);
  expect(thumb.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await thumb.arrayBuffer())).toStrictEqual(PNG);
  expect((await request(`${base}/model.glb`)).status).toBe(200);
  for (const path of [
    `${base}/points.bin`,
    `/projects/${project.id}/rejected/${crypto.randomUUID()}/thumb.png`,
    `/projects/${project.id}/rejected/..%2F..%2Fphotos/thumb.png`,
  ])
    expect((await request(path)).status, path).toBe(404);
});

test("export then import gives a new project with the same scene and files", async () => {
  const project = createProject();
  fixture.daemon.store.applyCommand({
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        ...port,
        light: {
          on: true,
          emitter: { x: 0.5, y: 0.6, z: 0.6 },
          beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
          shade: "translucent",
          lumens: 400,
          temperatureK: 2700,
        },
      },
    },
    requestId: undefined,
  });
  await request(
    `/projects/${project.id}/photos?origin=capture&fileName=a.jpg`,
    {
      method: "POST",
      body: readFileSync(join(catalogFolder, "thumb.png")),
    },
  );
  const exported = await request(`/projects/${project.id}/export`);
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toBe("application/zip");
  expect(exported.headers.get("content-disposition")).toContain(
    'filename="Living room.iplan"',
  );
  expect(exported.headers.get("access-control-expose-headers")).toBe(
    "content-disposition",
  );
  const archive = Buffer.from(await exported.arrayBuffer());
  const imported = await request("/projects/import", {
    method: "POST",
    body: archive,
  });
  expect(imported.status).toBe(201);
  const summary = await imported.json();
  expect(summary.name).toBe("Living room");
  expect(summary.id).not.toBe(project.id);
  const copy = ProjectSchema.parse(
    JSON.parse(
      readFileSync(
        join(fixture.daemon.store.projectPath(summary.id), "project.json"),
        "utf8",
      ),
    ),
  );
  expect(copy).toStrictEqual({
    ...fixture.daemon.store.loadProject(project.id),
    id: summary.id,
  });
  const listFiles = (projectId: string) =>
    readdirSync(fixture.daemon.store.projectPath(projectId), {
      recursive: true,
    })
      .map(String)
      .filter((path) => !path.startsWith(".planner"))
      .toSorted();
  expect(listFiles(summary.id)).toStrictEqual(listFiles(project.id));
  expect(
    existsSync(
      join(fixture.daemon.store.projectPath(summary.id), ".planner", "logs"),
    ),
  ).toBe(true);
  expect(
    readdirSync(fixture.env.PLANNER_PROJECTS).filter((name) =>
      name.startsWith(".import-"),
    ),
  ).toStrictEqual([]);
});

test("import refuses paths outside the folder, links, and archives without a valid project.json", async () => {
  const project = createProject();
  const projectJson = Buffer.from(JSON.stringify(project));
  const archives = {
    "a path outside the folder": buildTestZip([
      { name: "project.json", data: projectJson },
      { name: "../escaped.txt", data: Buffer.from("x") },
    ]),
    "an absolute path": buildTestZip([
      { name: "project.json", data: projectJson },
      { name: "/tmp/escaped.txt", data: Buffer.from("x") },
    ]),
    "a symlink": buildTestZip([
      { name: "project.json", data: projectJson },
      {
        name: "photos/link",
        data: Buffer.from("/etc/hosts"),
        unixMode: 0o120777,
      },
    ]),
    "no project.json": buildTestZip([
      { name: "photos/a.jpg", data: Buffer.from("x") },
    ]),
    "an invalid project.json": buildTestZip([
      { name: "project.json", data: Buffer.from('{"id":"x"}') },
    ]),
    "bytes that are not a zip": Buffer.from("not a zip"),
  };
  for (const [name, body] of Object.entries(archives)) {
    const response = await request("/projects/import", {
      method: "POST",
      body,
    });
    expect(response.status, name).toBe(400);
  }
  expect(fixture.daemon.store.listProjects()).toHaveLength(1);
  expect(existsSync(join(fixture.env.PLANNER_PROJECTS, "escaped.txt"))).toBe(
    false,
  );
  expect(
    readdirSync(fixture.env.PLANNER_PROJECTS).filter((name) =>
      name.startsWith(".import-"),
    ),
  ).toStrictEqual([]);
});

test("refuses a body over the limit, chunked or declared, and an empty body", async () => {
  const project = createProject();
  const path = `/projects/${project.id}/snapshots`;
  expect(
    await postRaw({
      path,
      headers: { "content-length": String(60 * 1024 ** 2) },
      chunks: [PNG],
    }),
  ).toBe(413);
  expect(
    await postRaw({
      path,
      headers: {},
      chunks: Array.from({ length: 51 }, () => Buffer.alloc(1024 ** 2)),
    }),
  ).toBe(413);
  expect(
    (
      await request(`/projects/${project.id}/snapshots`, {
        method: "POST",
        body: Buffer.alloc(0),
      })
    ).status,
  ).toBe(400);
  expect(
    readdirSync(
      join(fixture.daemon.store.projectPath(project.id), "snapshots"),
    ),
  ).toStrictEqual([]);
});

test("a photo name needs an extension", async () => {
  const project = createProject();
  expect(
    (
      await request(
        `/projects/${project.id}/photos?origin=capture&fileName=jpg`,
        {
          method: "POST",
          body: Buffer.from("x"),
        },
      )
    ).status,
  ).toBe(415);
});

test("import copies a catalog asset the archive does not hold", async () => {
  const project = createProject();
  fixture.daemon.store.applyCommand({
    projectId: project.id,
    command: { type: "item.add", item: port },
    requestId: undefined,
  });
  const body = buildTestZip([
    {
      name: "project.json",
      data: Buffer.from(
        JSON.stringify(fixture.daemon.store.loadProject(project.id)),
      ),
    },
  ]);
  const response = await request("/projects/import", { method: "POST", body });
  expect(response.status).toBe(201);
  const { id } = await response.json();
  expect(
    readFileSync(
      join(
        fixture.daemon.store.projectPath(id),
        "assets",
        CHARGING_PORT.assetId,
        "model.glb",
      ),
    ),
  ).toStrictEqual(readFileSync(join(catalogFolder, "model.glb")));
});

test("the export file name is escaped for any project name", async () => {
  const project = fixture.daemon.store.createProject({
    name: "Kid's room (2)",
    room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
  });
  const response = await request(`/projects/${project.id}/export`);
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="Kid_s room _2_.iplan"; filename*=UTF-8''Kid%27s%20room%20%282%29.iplan`,
  );
  await response.arrayBuffer();
});

test("export leaves out leftover temporary files", async () => {
  const project = createProject();
  const folder = fixture.daemon.store.projectPath(project.id);
  writeFileSync(join(folder, "photos", ".a.jpg.tmp"), "partial");
  mkdirSync(join(folder, "assets", ".plug.1.tmp"));
  const archive = Buffer.from(
    await (await request(`/projects/${project.id}/export`)).arrayBuffer(),
  );
  const { id } = await (
    await request("/projects/import", { method: "POST", body: archive })
  ).json();
  const copy = fixture.daemon.store.projectPath(id);
  expect(existsSync(join(copy, "photos", ".a.jpg.tmp"))).toBe(false);
  expect(existsSync(join(copy, "assets", ".plug.1.tmp"))).toBe(false);
});

test("a request path that is not a valid URL gets 404 and the daemon keeps answering", async () => {
  const status = await new Promise<number | undefined>((resolve, reject) =>
    httpRequest(
      {
        host: "127.0.0.1",
        port: fixture.address.port,
        path: "//",
        headers: { origin: TEST_WEB_ORIGIN },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    )
      .once("error", reject)
      .end(),
  );
  expect(status).toBe(404);
  expect((await request("/health")).status).toBe(200);
});

test("reports a manifest write failure as a server error and removes the failed upload", async () => {
  const project = createProject();
  const folder = join(fixture.daemon.store.projectPath(project.id), "photos");
  mkdirSync(join(folder, "photos.json"));
  const response = await request(
    `/projects/${project.id}/photos?origin=chat&fileName=photo.png`,
    { method: "POST", body: readFileSync(join(catalogFolder, "thumb.png")) },
  );
  expect(response.status).toBe(500);
  expect(await response.text()).toBe("Internal error\n");
  expect(readdirSync(folder).toSorted()).toEqual([
    "photos.json",
    "thumb",
    "upright",
    "vision",
  ]);
  for (const part of ["thumb", "upright", "vision"])
    expect(readdirSync(join(folder, part))).toEqual([]);
});

test("refuses undecodable photos without adding a manifest or leaving files", async () => {
  const project = createProject();
  const folder = join(fixture.daemon.store.projectPath(project.id), "photos");
  for (const extension of ["jpg", "heic"]) {
    const response = await request(
      `/projects/${project.id}/photos?origin=chat&fileName=photo.${extension}`,
      { method: "POST", body: Buffer.from("not an image") },
    );
    expect(response.status).toBe(415);
    expect(await response.text()).toBe("The photo could not be decoded\n");
    expect(readdirSync(folder)).toEqual([]);
  }
});
