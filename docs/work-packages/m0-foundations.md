# M0 — Foundations

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2, 3 and 8 (M0).

## Scope

1. **pnpm workspace.** Root `package.json`, `pnpm-workspace.yaml`, `tsconfig` base, biome config, vitest config. Node 24 runs `.ts` directly: erasable TypeScript syntax only (no enums, no parameter properties, no namespaces) and `.ts` extensions in relative imports (`allowImportingTsExtensions`, `rewriteRelativeImportExtensions` or `noEmit` as fits). `pnpm check` runs typecheck, biome and vitest across the workspace.
2. **`packages/shared`.** zod schemas and inferred types for every contract in PLAN section 3: `Scene`, `Room`, `Wall`, `Item`, `Placement`, `ColorAdjust`, `AssetMeta`; commands (`item.add`, `item.update`, `item.duplicate`, `item.remove`, `room.update`, `surface.update`, `camera.set`); jobs (stage `queued | generating | ready | failed`, `progress`, item id); chat blocks (the 12 kinds in DESIGN section 8); WS messages (snapshot, event, `command.ack`); `config.json` (versioned). One pure reducer that applies a command to a scene, and a function that returns the inverse command (for undo).
   - Commands carry every new id (`item.add`, `item.duplicate`). The reducer uses no randomness and no clock: the UI and the daemon apply the same command separately and must get the same scene.
   - Unit tests for every command, its inverse, and rejection of invalid input. For every command, apply then inverse gives a deep-equal scene, including `room.update` with floor items present and `item.remove` of an item in the middle of the list. If one inverse command cannot restore the scene exactly, bring it back as a contract question.
   - Wall items keep `alongM`/`heightM` when the room is resized; floor items keep their distance from the nearest wall when a wall moves (PLAN 4).
3. **`packages/daemon`.** HTTP + WS server on `127.0.0.1:4820` (port from env for tests). Copy and rename `STUDIO_` → `PLANNER_` from `/path/to/studio/packages/daemon/src/`: `ws/server.ts`, `ws/auth.ts`, `ws/event-bus.ts`, `ws/snapshot.ts`, the `util/` helpers they need. Do not rewrite what you copy; adapt only names and types. Add the origin check from PLAN 2: WS and upload requests are accepted only from the web app's origin. Keep the per-boot token from `ws/auth.ts`. Studio's UI was served from the daemon's origin; here it is not, so ask the advisor how `apps/web` gets the token. Do not drop auth.
   - **Project store (new code; Studio's `db/` does not apply, there is no database).** Projects live in `PLANNER_PROJECTS/<projectId>/project.json` with the folder layout in PLAN 2 "State on disk". Create, list, load. Commands are validated with the shared schema, applied with the shared reducer, broadcast, and written with a debounced write. On SIGTERM and SIGINT the daemon flushes pending writes before it exits.
   - Do not copy the agent runtime, MCP server, hooks or preflight. Those are M2.
4. **`test/fake-cli/`.** Copy Studio's `test/fake-cli/` (`/path/to/studio/test/fake-cli/`) and rename. It is not wired to anything until M2; copy it now so the layout is fixed. Leave Studio-specific scenarios out.
5. **UI WS client.** Copy `packages/ui/src/ws/ws-client.ts`, `reconnect-delay.ts`, `apply-message.ts` and their tests from Studio into `apps/web/src/ws/`, adapted to the shared WS types.
6. **`apps/web` skeleton.** Next.js 16.4.x, React 19.3.x, App Router, one page that imports a schema from `packages/shared` and renders a value from it. Pin the versions in PLAN 2 for the packages you add. No design work; Track A does that in M1. This proves that Next.js can import the workspace `.ts` package (use `transpilePackages` if needed).
7. **Playwright.** Config at the root, one smoke test that starts `apps/web` and checks the page renders the shared value. `pnpm test:e2e` runs it; it is not part of `pnpm check`.

Out of scope: `python/`, `blender/`, `roles/`, `packages/mcp`. Other agents own `python/` and `blender/` now; do not create files there.

## Gate (a script checks it)

1. `pnpm check` passes.
2. `pnpm gate:m0` runs `scripts/gate-m0.ts`. With `PLANNER_HOME` and `PLANNER_PROJECTS` in a temp folder, it starts the daemon, creates a project, connects over WS, sends at least one of every command, sends SIGTERM, starts the daemon again, reads the project back, and asserts the scene equals the expected scene. Exit code 0 on pass.
3. `pnpm test:e2e` passes.

## Ask, don't guess

The schema is frozen when M0 lands; later changes need chief-engineer sign-off. Where PLAN section 3 is ambiguous (for example the exact shape of `item.update`, `ColorAdjust` defaults, the event and job message fields), ask the advisor first. If the answer changes what PLAN says, update PLAN section 3 in the same commit.
