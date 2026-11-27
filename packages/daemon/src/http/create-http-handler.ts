import { randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  linkSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { open } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  PhotoOriginSchema,
  PhotoSchema,
} from "@planner/shared/src/photos/photo-schema.ts";
import { ProjectIdSchema } from "@planner/shared/src/project/project-id-schema.ts";
import type { PhotoUploadResult } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import type { SnapshotSaveResult } from "@planner/shared/src/protocol/snapshot-save-result-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { z } from "zod";
import { buildProjectArchive } from "../archive/build-project-archive.ts";
import { extractProjectArchive } from "../archive/extract-project-archive.ts";
import { jobFilePath } from "../generation/job-file-path.ts";
import { createPhotoCopies } from "../photos/create-photo-copies.ts";
import { PhotoDecodeError } from "../photos/photo-decode-error.ts";
import { readPhotos } from "../photos/read-photos.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { ProjectNotFoundError } from "../project/project-not-found-error.ts";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import type { Logger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import type { AuthService } from "../ws/auth.ts";
import { HttpError } from "./http-error.ts";
import { readItemSourceImage } from "./read-item-source-image.ts";
import { readPhotoCrop } from "./read-photo-crop.ts";
import { readProjectMedia } from "./read-project-media.ts";
import { readReconstructionPoints } from "./read-reconstruction-points.ts";
import { receiveBody } from "./receive-body.ts";
import { serveCatalogThumbnail } from "./serve-catalog-thumbnail.ts";

const MB = 1024 ** 2;
const PHOTO_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
]);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ASSET_FILES: { [fileName: string]: string } = {
  "baseColor.png": "image/png",
  "normal.png": "image/png",
  "roughness.png": "image/png",
  "model.glb": "model/gltf-binary",
  "colorMask.png": "image/png",
  "points.bin": "application/octet-stream",
  "lines.bin": "application/octet-stream",
  "thumb.png": "image/png",
  "meta.json": "application/json; charset=utf-8",
};

export function createHttpHandler(options: {
  auth: AuthService;
  webOrigins: string[];
  store: ProjectStore;
  projectsRoot: string;
  logger: Logger;
  health: () => unknown;
}) {
  function sendJson(input: {
    response: ServerResponse;
    status: number;
    body: unknown;
  }) {
    input.response.writeHead(input.status, {
      "content-type": "application/json; charset=utf-8",
    });
    input.response.end(`${JSON.stringify(input.body)}\n`);
  }

  function projectFolder(projectId: string) {
    if (!ProjectIdSchema.safeParse(projectId).success)
      throw new HttpError({ status: 404, message: "Not found" });
    try {
      options.store.loadProject(projectId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError)
        throw new HttpError({ status: 404, message: error.message });
      throw error;
    }
    return options.store.projectPath(projectId);
  }

  async function uploadPhoto(input: {
    request: IncomingMessage;
    projectId: string;
    url: URL;
  }) {
    const folder = projectFolder(input.projectId);
    const extension = /\.([^.]+)$/
      .exec(input.url.searchParams.get("fileName") ?? "")?.[1]
      ?.toLowerCase();
    if (extension === undefined || !PHOTO_EXTENSIONS.has(extension))
      throw new HttpError({
        status: 415,
        message:
          "Send fileName ending in .jpg, .jpeg, .png, .webp, .heic or .heif",
      });
    const origin = PhotoOriginSchema.safeParse(
      input.url.searchParams.get("origin"),
    );
    if (!origin.success)
      throw new HttpError({
        status: 400,
        message: "Send origin=capture or origin=chat",
      });
    const photoId = randomUUID();
    const fileName = `${photoId}.${extension}`;
    const temporary = join(folder, "photos", `.${fileName}.tmp`);
    await receiveBody({
      request: input.request,
      path: temporary,
      maxBytes: 100 * MB,
    });
    const sourcePath = join(folder, "photos", fileName);
    try {
      const copies = await createPhotoCopies({
        sourcePath: temporary,
        folder: join(folder, "photos"),
        photoId,
        heic: extension === "heic" || extension === "heif",
      });
      projectFolder(input.projectId);
      renameSync(temporary, sourcePath);
      const record = PhotoSchema.parse({
        ...copies,
        photoId,
        origin: origin.data,
        sourceFileName: fileName,
      });
      writeJson({
        path: join(folder, "photos", "photos.json"),
        value: { version: 1, photos: [...readPhotos(folder), record] },
      });
      return { photoId, fileName } satisfies PhotoUploadResult;
    } catch (error) {
      for (const path of [
        temporary,
        sourcePath,
        ...["upright", "vision", "thumb"].map((part) =>
          join(folder, "photos", part, `${photoId}.jpg`),
        ),
      ])
        rmSync(path, { force: true });
      if (error instanceof PhotoDecodeError)
        throw new HttpError({
          status: 415,
          message: "The photo could not be decoded",
        });
      throw error;
    }
  }

  async function saveSnapshot(input: {
    request: IncomingMessage;
    projectId: string;
  }) {
    const folder = projectFolder(input.projectId);
    const temporary = join(folder, "snapshots", `.${randomUUID()}.tmp`);
    await receiveBody({
      request: input.request,
      path: temporary,
      maxBytes: 50 * MB,
    });
    try {
      const head = Buffer.alloc(PNG_SIGNATURE.length);
      const file = await open(temporary);
      try {
        await file.read(head, 0, head.length, 0);
      } finally {
        await file.close();
      }
      if (!head.equals(PNG_SIGNATURE))
        throw new HttpError({ status: 415, message: "The body is not a PNG" });
      const stamp = new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replace(".", "-");
      for (let attempt = 0; attempt < 10; attempt++) {
        const fileName = `${attempt === 0 ? stamp : `${stamp}-${attempt}`}.png`;
        try {
          linkSync(temporary, join(folder, "snapshots", fileName));
          return { fileName } satisfies SnapshotSaveResult;
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "EEXIST"
            )
          )
            throw error;
        }
      }
      throw new HttpError({ status: 409, message: "Snapshot name taken" });
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  async function exportProject(input: {
    response: ServerResponse;
    projectId: string;
  }) {
    const folder = projectFolder(input.projectId);
    const project = options.store.loadProject(input.projectId);
    const fileName = `${project.name.replace(/[^\w .-]+/g, "_")}.iplan`;
    input.response.writeHead(200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeRfc5987(`${project.name}.iplan`)}`,
    });
    await pipeline(buildProjectArchive({ folder, project }), input.response);
  }

  async function importProject(request: IncomingMessage) {
    const work = join(options.projectsRoot, `.import-${randomUUID()}`);
    const archivePath = `${work}.iplan`;
    try {
      await receiveBody({ request, path: archivePath, maxBytes: 2048 * MB });
      await extractProjectArchive({ archivePath, target: work });
      try {
        return options.store.importProject(work);
      } catch (error) {
        if (isMissingPathError(error))
          throw new HttpError({
            status: 400,
            message: "The archive has no project.json",
          });
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          throw new HttpError({
            status: 400,
            message: `The archive has an invalid project.json: ${error.message}`,
          });
        throw error;
      }
    } finally {
      rmSync(archivePath, { force: true });
      rmSync(work, { recursive: true, force: true });
    }
  }

  async function readAsset(input: {
    response: ServerResponse;
    projectId: string;
    id: string;
    fileName: string;
    location: "assets" | "archive" | "rejected";
  }) {
    const contentType = Object.hasOwn(ASSET_FILES, input.fileName)
      ? ASSET_FILES[input.fileName]
      : undefined;
    if (
      contentType === undefined ||
      !ProjectIdSchema.safeParse(input.projectId).success ||
      !IdSchema.safeParse(input.id).success ||
      (input.location === "archive" && input.fileName !== "thumb.png") ||
      (input.location === "rejected" &&
        !["thumb.png", "model.glb"].includes(input.fileName))
    )
      throw new HttpError({ status: 404, message: "Not found" });
    const folder = projectFolder(input.projectId);
    const relativePath = (() => {
      switch (input.location) {
        case "assets":
          return join("assets", input.id, input.fileName);
        case "archive":
          return join(".planner/archive", input.id, input.fileName);
        case "rejected":
          return join(
            ".planner/generation",
            input.id,
            "normalized",
            input.fileName,
          );
        default: {
          const unreachable: never = input.location;
          throw new Error(String(unreachable));
        }
      }
    })();
    const path = (() => {
      try {
        return jobFilePath({ folder, path: relativePath });
      } catch {
        throw new HttpError({ status: 404, message: "Not found" });
      }
    })();
    if (!existsSync(path))
      throw new HttpError({ status: 404, message: "Not found" });
    input.response.writeHead(200, {
      "content-type": contentType,
      "content-length": statSync(path).size,
    });
    await pipeline(createReadStream(path), input.response);
  }

  async function route(input: {
    request: IncomingMessage;
    response: ServerResponse;
    url: URL;
  }) {
    const { request, response, url } = input;
    if (await serveCatalogThumbnail(input)) return;
    const parts = url.pathname.split("/").filter((part) => part.length > 0);
    const method = request.method;
    if (
      method === "GET" &&
      parts.length === 6 &&
      parts.at(0) === "projects" &&
      parts.at(2) === "items" &&
      parts.at(4) === "sources"
    ) {
      const projectId = parts.at(1);
      const itemId = parts.at(3);
      const index = parts.at(5);
      if (
        projectId === undefined ||
        itemId === undefined ||
        index === undefined
      )
        throw new HttpError({ status: 404, message: "Not found" });
      await readItemSourceImage({
        folder: projectFolder(projectId),
        project: options.store.loadProject(projectId),
        itemId,
        index,
        response,
      });
      return;
    }
    if (method === "POST" && url.pathname === "/projects/import") {
      sendJson({ response, status: 201, body: await importProject(request) });
      return;
    }
    const [first, projectId, action, assetId, fileName, ...rest] = parts;
    if (first !== "projects" || projectId === undefined || rest.length > 0)
      throw new HttpError({ status: 404, message: "Not found" });
    if (
      method === "GET" &&
      action === "reconstruction" &&
      assetId !== undefined &&
      fileName === "points.bin"
    ) {
      await readReconstructionPoints({
        folder: projectFolder(projectId),
        jobId: assetId,
        response,
      });
      return;
    }
    if (
      method === "GET" &&
      action === "renders" &&
      assetId !== undefined &&
      fileName === undefined
    ) {
      const jobId = assetId.endsWith(".png") ? assetId.slice(0, -4) : "";
      if (!IdSchema.safeParse(jobId).success)
        throw new HttpError({ status: 404, message: "Not found" });
      const path = (() => {
        try {
          return jobFilePath({
            folder: projectFolder(projectId),
            path: join("renders", `${jobId}.png`),
          });
        } catch {
          throw new HttpError({ status: 404, message: "Render file missing" });
        }
      })();
      if (!existsSync(path))
        throw new HttpError({ status: 404, message: "Render file missing" });
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": statSync(path).size,
        ...(url.searchParams.get("download") === "1"
          ? { "content-disposition": `attachment; filename="${jobId}.png"` }
          : {}),
      });
      await pipeline(createReadStream(path), response);
      return;
    }
    if (
      method === "GET" &&
      action === "photos" &&
      assetId !== undefined &&
      fileName === "crop"
    ) {
      await readPhotoCrop({
        folder: projectFolder(projectId),
        photoId: assetId,
        url,
        response,
      });
      return;
    }
    if (
      method === "GET" &&
      (action === "photos" || action === "links") &&
      assetId !== undefined &&
      fileName === undefined
    ) {
      await readProjectMedia({
        folder: projectFolder(projectId),
        kind: action,
        id: assetId,
        thumbnail: url.searchParams.get("size") === "thumb",
        response,
      });
      return;
    }
    if (method === "POST" && action === "photos" && assetId === undefined) {
      sendJson({
        response,
        status: 201,
        body: await uploadPhoto({ request, projectId, url }),
      });
      return;
    }
    if (method === "POST" && action === "snapshots" && assetId === undefined) {
      sendJson({
        response,
        status: 201,
        body: await saveSnapshot({ request, projectId }),
      });
      return;
    }
    if (method === "GET" && action === "export" && assetId === undefined) {
      await exportProject({ response, projectId });
      return;
    }
    if (
      method === "GET" &&
      (action === "assets" || action === "rejected") &&
      assetId !== undefined &&
      fileName !== undefined
    ) {
      await readAsset({
        response,
        projectId,
        id: assetId,
        fileName,
        location:
          action === "rejected"
            ? "rejected"
            : url.searchParams.get("archived") === "1"
              ? "archive"
              : "assets",
      });
      return;
    }
    throw new HttpError({ status: 404, message: "Not found" });
  }

  return async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    function text(status: number, body: string) {
      response.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(`${body}\n`);
    }
    const origin = request.headers.origin;
    if (
      !options.auth.allowsHost({
        headers: request.headers,
        port: request.socket.localPort ?? 0,
      }) ||
      !options.auth.allowsOrigin({
        headers: request.headers,
        webOrigins: options.webOrigins,
      })
    ) {
      text(403, "Forbidden");
      return;
    }
    if (origin !== undefined) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader(
        "access-control-expose-headers",
        "content-disposition",
      );
      response.setHeader("vary", "origin");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }
    try {
      const rawPath = (() => {
        try {
          return decodeURIComponent(
            (request.url ?? "/").split("?").at(0) ?? "/",
          );
        } catch {
          throw new HttpError({ status: 404, message: "Not found" });
        }
      })();
      if (rawPath.split("/").some((part) => part === ".." || part === "."))
        throw new HttpError({ status: 404, message: "Not found" });
      if (!URL.canParse(request.url ?? "/", "http://127.0.0.1"))
        throw new HttpError({ status: 404, message: "Not found" });
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson({ response, status: 200, body: options.health() });
        return;
      }
      if (
        origin === undefined &&
        !options.auth.allowsTailnet({
          headers: request.headers,
          webOrigins: options.webOrigins,
        }) &&
        !options.auth.allowsBearer(request.headers.authorization)
      )
        throw new HttpError({
          status: 401,
          message: "Send the internal token as a Bearer token",
        });
      await route({ request, response, url });
    } catch (error) {
      if (response.headersSent) {
        options.logger.error(String(error));
        response.destroy();
        return;
      }
      if (!request.complete) response.setHeader("connection", "close");
      if (error instanceof HttpError) text(error.status, error.message);
      else {
        options.logger.error(
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
        text(500, "Internal error");
      }
    }
  };
}

function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
