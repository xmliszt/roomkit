import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import { RenderViewSchema } from "@planner/shared/src/render/render-view-schema.ts";
import { LightSchema } from "@planner/shared/src/scene/light-schema.ts";
import { PerspectiveCamera, Vector3 } from "three";
import { z } from "zod";
import { isCeilingVisible } from "../apps/web/src/editor/scene/is-ceiling-visible.ts";
import { getWallSegments } from "../apps/web/src/room/get-wall-segments.ts";
import { getWallVisibility } from "../apps/web/src/room/get-wall-visibility.ts";
import { exportRenderScene } from "../packages/daemon/src/render/export-render-scene.ts";
import { runPhotoRender } from "../packages/daemon/src/render/run-photo-render.ts";

const source = process.argv.at(2);
const sharp: typeof import("../packages/daemon/node_modules/sharp/lib/index.js") =
  createRequire(new URL("../packages/daemon/package.json", import.meta.url))(
    "sharp",
  );
if (!source)
  throw new Error(
    "Usage: node scripts/b21-render-evidence.ts <project folder> [walk|orbit|walk-lamp] [bulb report]",
  );
const label =
  process.argv.at(3) === "orbit"
    ? "orbit"
    : process.argv.at(3) === "walk-lamp"
      ? "walk-lamp"
      : "walk";
const mode = label === "orbit" ? "orbit" : "walk";
const bulbReport = process.argv.at(4);
if (label === "walk-lamp" && !bulbReport)
  throw new Error("Pass a local bulb report path after walk-lamp.");
const root = mkdtempSync(join(tmpdir(), "planner-b21-"));
const projectFolder = join(root, "project");
cpSync(resolve(source), projectFolder, {
  recursive: true,
  filter: (path) =>
    ![".planner", "renders", "photos", "recon"].includes(basename(path)),
});
const baseProject = ProjectSchema.parse(
  JSON.parse(readFileSync(join(projectFolder, "project.json"), "utf8")),
);
const bulbResults =
  label === "walk-lamp" && bulbReport
    ? Object.values(
        z
          .record(
            z.string(),
            z.object({ itemId: z.string(), after: LightSchema }),
          )
          .parse(JSON.parse(readFileSync(bulbReport, "utf8"))),
      )
    : [];
const project = {
  ...baseProject,
  scene: {
    ...baseProject.scene,
    items: baseProject.scene.items.map((item) => {
      const bulb = bulbResults.find((result) => result.itemId === item.id);
      return bulb ? { ...item, light: bulb.after } : item;
    }),
  },
};
if (
  bulbResults.some(
    (bulb) => !project.scene.items.some((item) => item.id === bulb.itemId),
  )
)
  throw new Error("The copied room is missing a lamp from the A22 bulb report");
writeFileSync(join(projectFolder, "project.json"), JSON.stringify(project));
const camera =
  mode === "orbit"
    ? project.scene.camera
    : {
        positionM: { x: 0.1, y: 1.6, z: -2.25 },
        targetM: { x: 0, y: 1.1, z: 1.2 },
      };
const segments = getWallSegments(project.scene.room);
const { drawn } = getWallVisibility({ segments, cameraM: camera.positionM });
const defaultView: RenderView = {
  ...camera,
  mode,
  fovDeg: mode === "orbit" ? 32 : 58.7,
  aspect: 16 / 9,
  hiddenSurfaceIds: [
    ...segments.flatMap((segment, index) =>
      mode === "orbit" && !drawn[index] ? [segment.wall.id] : [],
    ),
    ...(isCeilingVisible({
      room: project.scene.room,
      cameraM: camera.positionM,
    })
      ? []
      : ["ceiling"]),
  ],
};
const view = process.env.PLANNER_RENDER_VIEW
  ? RenderViewSchema.parse(
      z
        .object({ view: RenderViewSchema })
        .parse(
          JSON.parse(readFileSync(process.env.PLANNER_RENDER_VIEW, "utf8")),
        ).view,
    )
  : defaultView;
const folder = join(root, "job");
exportRenderScene({ project, projectFolder, folder, view });
const evidence = resolve("docs/work-packages/evidence");
mkdirSync(evidence, { recursive: true });
console.log(`B21 ${label}: temp copy ${root}`);
await runPhotoRender({
  blender:
    process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender",
  folder,
  env: {
    ...process.env,
    PLANNER_HOME: join(root, "home"),
    PLANNER_PROJECTS: join(root, "projects"),
  },
  signal: new AbortController().signal,
  onAcquired() {
    console.log("Machine lock acquired");
  },
  onSamples(progress) {
    console.log(`Samples: ${Math.round(progress * 100)}%`);
  },
  onLine(line) {
    if (/Error|Traceback|RESULT|machine-lock|Sample|Preparing/.test(line))
      console.log(line);
  },
});
const bytes = readFileSync(join(folder, "render.png"));
const stats = await sharp(bytes).stats();
const meanBrightness =
  stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) /
  (3 * 255);
const metrics = z
  .object({
    durationSeconds: z.number(),
    peakRssBytes: z.number(),
    projectedCorners: z.array(z.tuple([z.number(), z.number()])),
  })
  .passthrough()
  .parse(JSON.parse(readFileSync(join(folder, "metrics.json"), "utf8")));
const projection = new PerspectiveCamera(view.fovDeg, view.aspect, 0.01, 1000);
projection.position.set(view.positionM.x, view.positionM.y, view.positionM.z);
projection.lookAt(view.targetM.x, view.targetM.y, view.targetM.z);
projection.updateMatrixWorld(true);
const expectedCorners = project.scene.room.walls.flatMap((wall) =>
  [0, project.scene.room.ceilingHeightM].map((height) => {
    const projected = new Vector3(wall.startM.x, height, wall.startM.z).project(
      projection,
    );
    return [(projected.x + 1) / 2, (projected.y + 1) / 2];
  }),
);
const maximumFramingError = Math.max(
  ...metrics.projectedCorners.flatMap((corner, index) => {
    const expected = expectedCorners.at(index);
    return expected
      ? [
          Math.abs(corner[0] - (expected.at(0) ?? 0)),
          Math.abs(corner[1] - (expected.at(1) ?? 0)) / view.aspect,
        ]
      : [Infinity];
  }),
);
copyFileSync(join(folder, "render.png"), join(evidence, `b21-${label}.png`));
writeFileSync(
  join(evidence, `b21-${label}.json`),
  JSON.stringify(
    {
      metrics,
      meanBrightness,
      maximumFramingError,
      view,
      lights: project.scene.items.flatMap((item) =>
        item.light?.on
          ? [{ itemId: item.id, name: item.name, light: item.light }]
          : [],
      ),
      tempFolder: root,
    },
    null,
    2,
  ),
);
if (meanBrightness < 0.1 || meanBrightness > 0.95)
  throw new Error(`Render brightness gate failed: ${meanBrightness}`);
if (maximumFramingError > 0.01)
  throw new Error(
    `Camera framing differs by ${maximumFramingError * 100}% of image width`,
  );
console.log(
  `B21 ${label}: PASS ${JSON.stringify({ durationSeconds: metrics.durationSeconds, peakRssBytes: metrics.peakRssBytes, meanBrightness, maximumFramingError })}`,
);
