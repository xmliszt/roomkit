import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstallTarget } from "@planner/shared/src/jobs/install-target-schema.ts";
import type { ProjectSummary } from "@planner/shared/src/project/project-schema.ts";
import type { AgentChatPostResult } from "@planner/shared/src/protocol/agent-chat-post-result-schema.ts";
import type { AgentsCheckResult } from "@planner/shared/src/protocol/agents-check-result-schema.ts";
import type { BulbFindResult } from "@planner/shared/src/protocol/bulb-find-result-schema.ts";
import type { ChatHistoryResult } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import type { ChatSendResult } from "@planner/shared/src/protocol/chat-send-result-schema.ts";
import type { ChatStopResult } from "@planner/shared/src/protocol/chat-stop-result-schema.ts";
import type { ClientCommand } from "@planner/shared/src/protocol/client-command-schema.ts";
import type { InstallLogResult } from "@planner/shared/src/protocol/install-log-result-schema.ts";
import type { InstallStartResult } from "@planner/shared/src/protocol/install-start-result-schema.ts";
import type { ProjectRemoveResult } from "@planner/shared/src/protocol/project-remove-result-schema.ts";
import type { SceneApplyResult } from "@planner/shared/src/protocol/scene-apply-result-schema.ts";
import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import { createAgentRuntime } from "./agent/create-agent-runtime.ts";
import { createCodingAgentChecker } from "./agent/create-coding-agent-checker.ts";
import { openAgentLogin } from "./agent/open-agent-login.ts";
import { stopOrphanAgents } from "./agent/stop-orphan-agents.ts";
import { createBulbQueue } from "./bulb/create-bulb-queue.ts";
import { createBulbViewRenderer } from "./bulb/create-bulb-view-renderer.ts";
import { listCatalogAssetIds } from "./catalog/list-catalog-asset-ids.ts";
import { createChatStore } from "./chat/create-chat-store.ts";
import { createDesignerChat } from "./chat/create-designer-chat.ts";
import { createTurnSlots } from "./chat/create-turn-slots.ts";
import { createConfigStore } from "./config/create-config-store.ts";
import { createDesktopTailnet } from "./config/create-desktop-tailnet.ts";
import { createLanguageStore } from "./config/create-language-store.ts";
import { readTailnetStatus } from "./config/read-tailnet-status.ts";
import { resolveEnvironment } from "./config/resolve-environment.ts";
import { createGenerationQueue } from "./generation/create-generation-queue.ts";
import { createHttpHandler } from "./http/create-http-handler.ts";
import { createInstallQueue } from "./install/create-install-queue.ts";
import { createInventoryQueue } from "./inventory/create-inventory-queue.ts";
import { readProjectWorkerLog } from "./jobs/read-project-worker-log.ts";
import { moveLibraryAsset } from "./objects/move-library-asset.ts";
import { readItemSources } from "./objects/read-item-sources.ts";
import { readObjectsLibrary } from "./objects/read-objects-library.ts";
import { readPhotos } from "./photos/read-photos.ts";
import { checkBlender } from "./preflight/check-blender.ts";
import { readModelRegistry } from "./preflight/read-model-registry.ts";
import { resolveBlenderBinary } from "./preflight/resolve-blender-binary.ts";
import { resolveToolPaths } from "./preflight/resolve-tool-paths.ts";
import { runPreflight } from "./preflight/run-preflight.ts";
import { createProjectStore } from "./project/create-project-store.ts";
import { stopOrphanWorker } from "./python/stop-orphan-worker.ts";
import { createReconstructionQueue } from "./reconstruction/create-reconstruction-queue.ts";
import { readReconstructionScale } from "./reconstruction/read-reconstruction-scale.ts";
import { createRenderQueue } from "./render/create-render-queue.ts";
import { createSurfaceQueue } from "./surfaces/create-surface-queue.ts";
import { readSurfaceAssets } from "./surfaces/read-surface-assets.ts";
import { isMissingPathError } from "./util/is-missing-path-error.ts";
import { createLogger } from "./util/logger.ts";
import { writeJson } from "./util/write-json.ts";
import { AuthService } from "./ws/auth.ts";
import { EventBus } from "./ws/event-bus.ts";
import { DashboardServer } from "./ws/server.ts";
import { buildSnapshot } from "./ws/snapshot.ts";

export function createDaemon(options: {
  env: { [name: string]: string | undefined };
  writeDelayMs?: number;
  desktopTailnet?: { webPort: number; servePort: number; executable?: string };
}) {
  const environment = resolveEnvironment(options.env);
  const logger = createLogger();
  const language = createLanguageStore({
    plannerHome: environment.plannerHome,
    onReadError: (error) =>
      logger.warn(`Could not read app language: ${String(error)}`),
  });
  const config = createConfigStore(environment);
  const bus = new EventBus();
  function disconnectTailnetBrowsers(): void {
    dashboard.disconnectTailnetBrowsers();
  }
  const desktopTailnet =
    options.desktopTailnet &&
    createDesktopTailnet({
      env: options.env,
      environment,
      ...options.desktopTailnet,
      onAccessChange: disconnectTailnetBrowsers,
    });
  const auth = new AuthService({
    allowedHosts: environment.allowedHosts,
    tailnetLogins: environment.tailnetLogins,
    ...(desktopTailnet && { desktopTailnet: desktopTailnet.access }),
  });
  const catalogRoot = fileURLToPath(new URL("../catalog", import.meta.url));
  const store = createProjectStore({
    projectsRoot: environment.projectsRoot,
    catalogRoot,
    catalogAssetIds: listCatalogAssetIds(catalogRoot),
    bus,
    logger,
    writeDelayMs: options.writeDelayMs ?? environment.writeDelayMs,
  });
  const daemonFilePath = join(environment.plannerHome, "daemon.json");
  const chat = createChatStore({ bus, projectPath: store.projectPath });
  const runtime = createAgentRuntime({ env: options.env });
  const agentChecker = createCodingAgentChecker({ env: options.env });
  const registry = readModelRegistry(environment.modelRegistryPath);
  function toolPaths() {
    return resolveToolPaths({
      env: options.env,
      config: config.get(),
      plannerHome: environment.plannerHome,
    });
  }
  const pythonProjectDir = fileURLToPath(
    new URL("../../../python", import.meta.url),
  );
  function checkPreflight(input: { force: boolean }) {
    return runPreflight({
      paths: toolPaths(),
      registry,
      env: options.env,
      pythonProjectDir,
      agents: agentChecker.check({ force: input.force }),
    });
  }
  async function publishPreflight(target: InstallTarget) {
    bus.publish({
      kind: "preflight.updated",
      preflight: await checkPreflight({ force: target.kind === "agent" }),
    });
  }
  const installs = createInstallQueue({
    bus,
    logger,
    env: options.env,
    paths: toolPaths,
    registry,
    weightsBaseUrl: environment.weightsBaseUrl ?? registry.baseUrl,
    pythonProjectDir,
    onJobEnd: publishPreflight,
  });
  const workerSlots = createTurnSlots({ size: 1 });
  const renders = createRenderQueue({
    store,
    chat,
    bus,
    env: options.env,
    blenderPaths: () => toolPaths().blender,
  });
  const views: { connection: object; projectId: string; view: RenderView }[] =
    [];
  const modelerSlots = createTurnSlots({ size: 2 });
  const agentSlots = createTurnSlots({ size: 1 });
  let listeningPort = 0;
  const generation = createGenerationQueue({
    store,
    chat,
    bus,
    logger,
    runtime,
    env: options.env,
    plannerHome: environment.plannerHome,
    allowedHosts: environment.linkAllowedHosts,
    agentSlots: modelerSlots,
    workerSlots,
    config: config.get,
    link: () => ({
      wsUrl: `ws://127.0.0.1:${listeningPort}/ws`,
      token: auth.internalToken,
    }),
  });
  const surfaces = createSurfaceQueue({
    store,
    chat,
    bus,
    logger,
    runtime,
    env: options.env,
    plannerHome: environment.plannerHome,
    agentSlots: modelerSlots,
    workerSlots,
    config: config.get,
    link: () => ({
      wsUrl: `ws://127.0.0.1:${listeningPort}/ws`,
      token: auth.internalToken,
    }),
  });
  const bulbs = createBulbQueue({
    store,
    chat,
    bus,
    logger,
    runtime,
    config: config.get,
    env: options.env,
    agentSlots,
    renderViews: createBulbViewRenderer({
      env: options.env,
      config: config.get,
      plannerHome: environment.plannerHome,
      processPath: join(environment.plannerHome, "bulb-worker.json"),
    }),
  });
  const inventory = createInventoryQueue({
    onCompleted: generation.adopt,
    generationOwns: (jobId) =>
      generation.list().some((job) => job.id === jobId),
    store,
    chat,
    bus,
    logger,
    runtime,
    plannerHome: environment.plannerHome,
    pythonProjectDir,
    registry,
    env: options.env,
    workerSlots,
    agentSlots,
    config: config.get,
    link: () => ({
      wsUrl: `ws://127.0.0.1:${listeningPort}/ws`,
      token: auth.internalToken,
    }),
    rolePromptPath: fileURLToPath(
      new URL("../../../roles/surveyor.md", import.meta.url),
    ),
    linkAllowedHosts: environment.linkAllowedHosts,
  });
  const reconstruction = createReconstructionQueue({
    store,
    chat,
    bus,
    logger,
    plannerHome: environment.plannerHome,
    pythonProjectDir,
    registry,
    env: options.env,
    workerSlots,
    onCompleted(projectId) {
      inventory.autoStart(projectId);
      surfaces.autoStart(projectId);
    },
  });
  const designer = createDesignerChat({
    store,
    chat,
    runtime,
    config: config.get,
    link: () => ({
      wsUrl: `ws://127.0.0.1:${listeningPort}/ws`,
      token: auth.internalToken,
    }),
    rolePromptPath: fileURLToPath(
      new URL("../../../roles/designer.md", import.meta.url),
    ),
    logger,
    maxConcurrentTurns: 1,
    slots: agentSlots,
    env: options.env,
    linkAllowedHosts: environment.linkAllowedHosts,
  });
  bus.subscribe((event) => {
    if (event.kind === "scene.changed") {
      generation.itemChanged(event.projectId);
      bulbs.sceneChanged(event);
    }
    if (event.kind === "scene.changed" && event.command.type === "item.remove")
      inventory.itemRemoved(event.projectId);
    if (event.kind !== "project.removed") return;
    generation.remove(event.projectId);
    renders.remove(event.projectId);
    surfaces.remove(event.projectId);
    bulbs.remove(event.projectId);
    inventory.remove(event.projectId);
    reconstruction.remove(event.projectId);
    designer.stop(event.projectId);
    chat.forgetRemoved(event.projectId);
  });
  const server = createServer(
    createHttpHandler({
      auth,
      webOrigins: environment.webOrigins,
      store,
      projectsRoot: environment.projectsRoot,
      logger,
      health: () => ({ ok: true }),
    }),
  );

  function removeOwnDaemonFile() {
    try {
      const file: unknown = JSON.parse(readFileSync(daemonFilePath, "utf8"));
      if (
        typeof file === "object" &&
        file !== null &&
        "token" in file &&
        file.token === auth.internalToken
      )
        rmSync(daemonFilePath, { force: true });
    } catch (error) {
      if (!isMissingPathError(error)) logger.warn(String(error));
    }
  }

  function requireAgent(context: { isAgent: boolean }) {
    if (!context.isAgent)
      throw new Error("Only an agent connection may send this command");
  }

  async function onCommand(
    command: ClientCommand,
    context: { isAgent: boolean; isLocalBrowser: boolean; connection?: object },
  ) {
    switch (command.type) {
      case "view.report": {
        if (context.isAgent || !context.connection)
          throw new Error("Only the editor may report its view");
        const scene = store.loadProject(command.projectId).scene;
        if (
          command.view.hiddenSurfaceIds.some(
            (id) =>
              id !== "ceiling" &&
              !scene.room.walls.some((wall) => wall.id === id),
          )
        )
          throw new Error("Unknown surface in render view");
        const index = views.findIndex(
          (entry) => entry.connection === context.connection,
        );
        if (index >= 0) views.splice(index, 1);
        views.push({
          connection: context.connection,
          projectId: command.projectId,
          view: command.view,
        });
        return { accepted: true };
      }
      case "render.start":
        if (context.isAgent) throw new Error("Use the designer render command");
        return renders.start(command);
      case "agent.render.start": {
        requireAgent(context);
        designer.requireTurn(command);
        const reported = views.findLast(
          (entry) => entry.projectId === command.projectId,
        );
        if (!reported)
          throw new Error(
            "Open the project in the editor before rendering a photo.",
          );
        return renders.start({
          projectId: command.projectId,
          view: reported.view,
        });
      }
      case "job.cancel": {
        store.loadProject(command.projectId);
        const job = [
          ...renders.list(),
          ...generation.list(),
          ...inventory.list(),
          ...reconstruction.list(),
          ...surfaces.list(),
          ...bulbs.list(),
        ].find(
          (job) =>
            job.id === command.jobId && job.projectId === command.projectId,
        );
        if (!job) throw new Error("Unknown job in this project");
        switch (job.kind) {
          case "render":
            return renders.cancel(command);
          case "generation":
          case "generation-alternative":
            return generation.cancel(command);
          case "inventory":
            return inventory.cancel(command);
          case "reconstruction":
            return reconstruction.cancel(command);
          case "surface":
            return surfaces.cancel(command);
          case "bulb":
            return bulbs.cancel(command);
          default: {
            const unreachable: never = job;
            return unreachable;
          }
        }
      }
      case "generation.regenerate":
        return generation.regenerate(command);
      case "agent.asset.regenerate":
        requireAgent(context);
        designer.requireTurn(command);
        return generation.regenerate(command);
      case "generation.start":
        return generation.start(command);
      case "generation.alternatives":
        return generation.alternatives(command);
      case "agent.surface.set":
        requireAgent(context);
        designer.requireTurn(command);
        return surfaces.start(command);
      case "agent.modeler":
        requireAgent(context);
        if (surfaces.ownsTurn(command)) return surfaces.modeler(command);
        return generation.modeler(command);
      case "agent.asset.generate":
        requireAgent(context);
        designer.requireTurn(command);
        return generation.generate(command);
      case "agent.asset.variant":
        requireAgent(context);
        designer.requireTurn(command);
        return generation.variant(command);
      case "inventory.start":
        return inventory.start(command.projectId);
      case "agent.inventory.submit":
        requireAgent(context);
        return inventory.submit(command);
      case "surface.assets": {
        const project = store.loadProject(command.projectId);
        return readSurfaceAssets({
          projectFolder: store.projectPath(command.projectId),
          room: project.scene.room,
        });
      }
      case "photos.list":
        store.loadProject(command.projectId);
        return { photos: readPhotos(store.projectPath(command.projectId)) };
      case "item.sources":
        return readItemSources({
          folder: store.projectPath(command.projectId),
          project: store.loadProject(command.projectId),
          ...(command.itemId === undefined ? {} : { itemId: command.itemId }),
        });
      case "objects.library":
      case "objects.archived":
        return readObjectsLibrary({
          folder: store.projectPath(command.projectId),
          project: store.loadProject(command.projectId),
          isArchived: command.type === "objects.archived",
        });
      case "objects.archive":
      case "objects.restore":
        return moveLibraryAsset({
          folder: store.projectPath(command.projectId),
          project: store.loadProject(command.projectId),
          assetId: command.assetId,
          kind: command.type === "objects.archive" ? "archive" : "restore",
        });
      case "reconstruction.scale.get":
        store.loadProject(command.projectId);
        return readReconstructionScale(store.projectPath(command.projectId));
      case "reconstruction.start":
        return reconstruction.start(command.projectId);
      case "reconstruction.scale.set":
        return reconstruction.setScale({
          projectId: command.projectId,
          sources: command.sources,
        });
      case "project.create":
        return store.createProject({ name: command.name, room: command.room });
      case "project.sample.open": {
        const preference = language.get();
        return store.openSampleProject({
          resetProjectId: command.resetProjectId,
          locale:
            command.locale ??
            (preference.kind === "selected" ? preference.locale : undefined),
        });
      }
      case "project.open":
        return store.openProject(command.projectId);
      case "project.rename":
        return store.renameProject({
          projectId: command.projectId,
          name: command.name,
        }) satisfies ProjectSummary;
      case "project.remove":
        return store.removeProject(
          command.projectId,
        ) satisfies ProjectRemoveResult;
      case "scene.apply":
        return store.applyCommand({
          projectId: command.projectId,
          command: command.command,
          requestId: command.requestId,
        }) satisfies SceneApplyResult;
      case "chat.send":
        return designer.send({
          projectId: command.projectId,
          text: command.text,
          photoIds: command.photoIds,
          itemIds: command.itemIds,
        }) satisfies ChatSendResult;
      case "chat.history":
        store.loadProject(command.projectId);
        return {
          messages: chat.list(command.projectId),
        } satisfies ChatHistoryResult;
      case "chat.stop":
        return designer.stop(command.projectId) satisfies ChatStopResult;
      case "agents.check":
        return {
          agents: await agentChecker.check({ force: command.force === true }),
        } satisfies AgentsCheckResult;
      case "config.update": {
        const updated = config.update(command.roles);
        dashboard.sync();
        return updated;
      }
      case "agent.login":
        if (!context.isLocalBrowser)
          throw new Error(
            "Open Roomkit on the Mac running it to sign in, or run the sign-in command there.",
          );
        await openAgentLogin({ cli: command.cli, env: options.env });
        return {};
      case "preflight.check":
        return checkPreflight({ force: command.force === true });
      case "tailnet.status":
        if (!desktopTailnet)
          return readTailnetStatus({ env: options.env, environment });
        return context.isLocalBrowser
          ? desktopTailnet.status()
          : { kind: "desktop-remote" };
      case "tailnet.enable":
      case "tailnet.disable":
        if (!desktopTailnet || !context.isLocalBrowser)
          throw new Error(
            "Open the Roomkit app on the Mac running it to change remote access.",
          );
        return command.type === "tailnet.enable"
          ? desktopTailnet.enable(command.logins)
          : desktopTailnet.disable();
      case "language.get":
      case "language.set": {
        if (!context.isLocalBrowser)
          throw new Error("Only a local browser may access the app language");
        if (command.type === "language.get") return language.get();
        if (command.firstLaunch) {
          const current = language.get();
          if (current.kind === "selected") return current;
        }
        const preference = language.set(command.locale);
        dashboard.announceLanguageChange(preference.locale);
        return preference;
      }
      case "install.batch.start":
        return installs.startBatch(command.targets);
      case "install.start":
        return installs.start(command.target) satisfies InstallStartResult;
      case "job.log": {
        const job = [
          ...renders.list(),
          ...generation.list(),
          ...surfaces.list(),
          ...inventory.list(),
          ...reconstruction.list(),
          ...bulbs.list(),
        ].find((job) => job.id === command.jobId);
        if (!job)
          return installs.readLog(command.jobId) satisfies InstallLogResult;
        return (await readProjectWorkerLog({
          projectFolder: store.projectPath(job.projectId),
          job,
        })) satisfies InstallLogResult;
      }
      case "install.log":
        return installs.readLog(command.jobId) satisfies InstallLogResult;
      case "blender.path.set": {
        const blenderPath =
          command.path === undefined
            ? undefined
            : resolveBlenderBinary(command.path);
        if (blenderPath !== undefined) {
          const check = await checkBlender({
            candidates: [blenderPath],
            env: options.env,
          });
          if (check.state !== "present") throw new Error(check.message);
        }
        config.setBlenderPath(blenderPath);
        dashboard.sync();
        const preflight = await checkPreflight({ force: false });
        bus.publish({ kind: "preflight.updated", preflight });
        return preflight;
      }
      case "agent.scene.apply": {
        requireAgent(context);
        const sceneCommand = command.command;
        const hadLight =
          sceneCommand.type === "item.update" &&
          store
            .loadProject(command.projectId)
            .scene.items.find((item) => item.id === sceneCommand.itemId)
            ?.light !== undefined;
        const result = designer.applySceneCommand({
          projectId: command.projectId,
          turnId: command.turnId,
          command: sceneCommand,
        }) satisfies SceneApplyResult;
        if (
          sceneCommand.type === "item.update" &&
          !hadLight &&
          sceneCommand.patch.light
        )
          bulbs.lightAdded({
            projectId: command.projectId,
            itemId: sceneCommand.itemId,
          });
        return result;
      }
      case "bulb.find":
        store.loadProject(command.projectId);
        return bulbs.find(command) satisfies BulbFindResult;
      case "agent.chat.post":
        requireAgent(context);
        if (inventory.ownsTurn(command)) return inventory.postBlocks(command);
        return designer.postBlocks({
          projectId: command.projectId,
          turnId: command.turnId,
          blocks: command.blocks,
        }) satisfies AgentChatPostResult;
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  }

  const dashboard = new DashboardServer({
    server,
    bus,
    auth,
    logger,
    webOrigins: environment.webOrigins,
    snapshot: () =>
      buildSnapshot({
        config: config.get(),
        store,
        jobs: [
          ...renders.list(),
          ...installs.list(),
          ...reconstruction.list(),
          ...inventory
            .list()
            .filter(
              (job) => !generation.list().some((owned) => owned.id === job.id),
            ),
          ...generation.list(),
          ...surfaces.list(),
          ...bulbs.list(),
        ],
      }),
    onCommand,
    onDisconnect(connection) {
      for (let index = views.length - 1; index >= 0; index -= 1)
        if (views[index]?.connection === connection) views.splice(index, 1);
    },
  });

  return {
    bus,
    store,
    auth,
    environment,
    chat,
    async listen() {
      await stopOrphanWorker(
        join(environment.plannerHome, "python-worker.json"),
      );
      await stopOrphanAgents({ store });
      dashboard.start();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(environment.port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Daemon is not listening");
      listeningPort = address.port;
      await surfaces.resume();
      await renders.resume();
      await generation.resume();
      inventory.resume();
      await reconstruction.resume();
      await stopOrphanWorker(join(environment.plannerHome, "bulb-worker.json"));
      await bulbs.resume();
      writeJson({
        path: daemonFilePath,
        value: {
          port: address.port,
          token: auth.internalToken,
          pid: process.pid,
        },
      });
      logger.info(`listening on 127.0.0.1:${address.port}`);
      return address;
    },
    async close() {
      await Promise.all([
        renders.stopAll(),
        generation.stopAll(),
        surfaces.stopAll(),
        bulbs.stopAll(),
        reconstruction.stopAll(),
        inventory.stopAll(),
      ]);
      designer.stopAll();
      installs.stopAll();
      runtime.killAll();
      try {
        store.flush();
      } finally {
        dashboard.stop();
        removeOwnDaemonFile();
        if (server.listening)
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          });
      }
    },
  };
}
