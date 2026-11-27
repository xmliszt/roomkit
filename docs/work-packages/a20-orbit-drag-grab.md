# A20 — An orbit drag never grabs an object (Claude agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (viewport navigation, selection), A18's `apps/web/src/editor/scene/camera-navigation.tsx`, `apps/web/src/editor/scene/items-layer.tsx` (`handleItemPointerDown`, `follow`), `scene-item.tsx`, the hover tags (A9). Consult the advisor before committing to an approach and before calling it done.

## The bug (user report)

"Dragging with the left mouse button to orbit: if my cursor runs past an object, it selects that object and starts moving it, even though I never released the mouse and pressed again."

Rule: a gesture belongs to whatever was under the pointer at pointerdown. A left drag that starts on empty floor, a wall or outside the room orbits until pointerup; passing over objects, rugs, hover tags or other HTML overlays never selects or moves anything, and never stops the orbit.

## What the orchestrator tried

A throwaway Playwright test (`zz-orbit-drag.spec.ts`, content below) pressed on empty floor, dragged across a 0.6 m pending box and across a rug, and released: nothing was selected or moved in either case. But in the pending-box run the camera did not move at all, so the orbit itself was interrupted when the cursor reached the box (likely its hover tag or another overlay taking the pointer). Reproduce with what the user has: real GLB asset items (use an e2e asset fixture), labels off and on, a trackpad-like slow drag, crossing the hover tag, and a pointerup or pointercancel that happens over an HTML overlay. Find the path by which a move starts without a fresh pointerdown on the object (for example camera-controls losing the gesture and r3f then treating the still-pressed pointer as a new press, `lostpointercapture`, or an overlay re-dispatching).

## Scope

1. Fix the root cause so the rule above holds; the orbit continues smoothly across objects and overlays.
2. Make sure a pointerdown on an object still selects and moves it as before, and a click on empty floor still clears the selection.
3. Browser tests: orbit across a pending item, a real asset item and a rug, with labels on and off: camera moves, nothing selected, placements unchanged. Plus the existing drag-to-move tests still pass.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` (outside ports 3210 and 4820).

## Orchestrator's throwaway test

```ts
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CameraSchema } from "@planner/shared/src/scene/camera-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

async function readCamera(page: Page) {
  return CameraSchema.parse(JSON.parse((await page.getByTestId("scene").getAttribute("data-camera")) ?? "null"));
}

for (const kind of ["pending", "rug"] as const)
test(`orbit drag across ${kind} does not grab it`, async ({ page }) => {
  const project = await createProject({ name: "Orbit", widthM: 5, depthM: 5, ceilingHeightM: 2.6 });
  await sendDaemonCommand({ type: "scene.apply", projectId: project.id, command: { type: "camera.set", camera: { positionM: { x: 0, y: 4, z: 6 }, targetM: { x: 0, y: 0, z: 0 } } } });
  await sendDaemonCommand({ type: "scene.apply", projectId: project.id, command: { type: "item.add", item: { id: "box", name: "Box", model: { kind: "pending", jobId: "j" }, placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 }, sizeM: kind === "rug" ? { width: 1.6, height: 0.01, depth: 1.2 } : { width: 0.6, height: 0.6, depth: 0.6 }, locked: false } } });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("item-tag")).toBeAttached();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const camera = await readCamera(page);
  const left = projectToScreen({ camera, pointM: { x: -2, y: 0, z: 0 }, viewport });
  const mid = projectToScreen({ camera, pointM: { x: 0, y: 0.3, z: 0 }, viewport });
  const right = projectToScreen({ camera, pointM: { x: 2, y: 0, z: 0 }, viewport });
  await page.mouse.move(left.x, left.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(left.x + ((mid.x - left.x) * i) / 20, left.y + ((mid.y - left.y) * i) / 20);
  for (let i = 1; i <= 20; i++) await page.mouse.move(mid.x + ((right.x - mid.x) * i) / 20, mid.y + ((right.y - mid.y) * i) / 20);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const placement = ProjectSchema.parse(await sendDaemonCommand({ type: "project.open", projectId: project.id })).scene.items.at(0)?.placement;
  console.log(kind, "placement", JSON.stringify(placement), "camera moved", JSON.stringify((await readCamera(page)).positionM));
  console.log(kind, "inspector", await page.getByRole("complementary", { name: "Inspector" }).count());
});
```
