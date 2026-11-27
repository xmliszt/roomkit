import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCommand } from "@planner/shared/src/commands/apply-command.ts";
import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type { AppLocale } from "@planner/shared/src/i18n/app-locale.ts";
import { ProjectIdSchema } from "@planner/shared/src/project/project-id-schema.ts";
import type {
  Project,
  ProjectSummary,
} from "@planner/shared/src/project/project-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { copyCatalogAssets } from "../catalog/copy-catalog-assets.ts";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import type { Logger } from "../util/logger.ts";
import { writeJson as writeJsonFile } from "../util/write-json.ts";
import type { EventBus } from "../ws/event-bus.ts";
import { createSampleProject } from "./create-sample-project.ts";
import { ProjectNotFoundError } from "./project-not-found-error.ts";
import { restoreArchivedAssets } from "./restore-archived-assets.ts";

export const PROJECT_FOLDERS = [
  "photos",
  "recon",
  "assets",
  "snapshots",
  ".planner/sessions",
  ".planner/logs",
];

export function createProjectStore(options: {
  projectsRoot: string;
  catalogRoot: string;
  catalogAssetIds: ReadonlySet<string>;
  bus: EventBus;
  logger: Logger;
  writeDelayMs: number;
  writeJson?: typeof writeJsonFile;
}) {
  const writeJson = options.writeJson ?? writeJsonFile;
  const loaded: { [projectId: string]: Project } = Object.create(null);
  const writeTimers: {
    [projectId: string]: ReturnType<typeof setTimeout>;
  } = {};
  const unwrittenProjectIds = new Set<string>();
  mkdirSync(options.projectsRoot, { recursive: true });

  function projectPath(projectId: string) {
    return join(options.projectsRoot, ProjectIdSchema.parse(projectId));
  }

  function readProject(projectId: string) {
    const project = ProjectSchema.parse(
      JSON.parse(
        readFileSync(join(projectPath(projectId), "project.json"), "utf8"),
      ),
    );
    if (project.id !== projectId)
      throw new Error(`project.json holds the id ${project.id}`);
    return project;
  }

  function writeProject(projectId: string) {
    clearTimeout(writeTimers[projectId]);
    delete writeTimers[projectId];
    const project = loaded[projectId];
    if (project === undefined) return;
    writeJson({
      path: join(projectPath(projectId), "project.json"),
      value: project,
    });
    unwrittenProjectIds.delete(projectId);
  }

  function tryWriteProject(projectId: string) {
    try {
      writeProject(projectId);
      return true;
    } catch (error) {
      options.logger.error(
        `Could not write project ${projectId}: ${String(error)}`,
      );
      return false;
    }
  }

  function scheduleWrite(projectId: string) {
    unwrittenProjectIds.add(projectId);
    writeTimers[projectId] ??= setTimeout(
      () => tryWriteProject(projectId),
      options.writeDelayMs,
    );
  }

  function forgetProject(projectId: string) {
    clearTimeout(writeTimers[projectId]);
    delete writeTimers[projectId];
    delete loaded[projectId];
    unwrittenProjectIds.delete(projectId);
  }

  function createFolders(folder: string) {
    for (const name of PROJECT_FOLDERS)
      mkdirSync(join(folder, name), { recursive: true });
  }

  function loadProject(projectId: string) {
    const cached = loaded[projectId];
    if (cached !== undefined) return cached;
    try {
      const project = readProject(projectId);
      loaded[projectId] = project;
      return project;
    } catch (error) {
      if (isMissingPathError(error)) throw new ProjectNotFoundError(projectId);
      throw error;
    }
  }

  function summarize(project: Project): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      ...(project.sample ? { sample: project.sample } : {}),
    };
  }

  function listProjects(): ProjectSummary[] {
    return readdirSync(options.projectsRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && ProjectIdSchema.safeParse(entry.name).success,
      )
      .flatMap((entry) => {
        try {
          const project = loaded[entry.name] ?? readProject(entry.name);
          return [summarize(project)];
        } catch (error) {
          options.logger.warn(
            `Skipped project ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      })
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }

  function archiveProject(projectId: string) {
    loadProject(projectId);
    if (unwrittenProjectIds.has(projectId))
      try {
        writeProject(projectId);
      } catch (error) {
        scheduleWrite(projectId);
        throw error;
      }
    const trash = join(options.projectsRoot, ".trash");
    mkdirSync(trash, { recursive: true });
    renameSync(
      projectPath(projectId),
      join(trash, `${projectId}-${Date.now()}`),
    );
    forgetProject(projectId);
  }

  function saveNewProject(input: {
    project: Project;
    replaceProjectId?: string | undefined;
  }) {
    const { project, replaceProjectId } = input;
    const folder = projectPath(project.id);
    try {
      createFolders(folder);
      if (project.sample)
        cpSync(
          fileURLToPath(new URL("../../sample-room", import.meta.url)),
          join(folder, "assets"),
          { recursive: true },
        );
      loaded[project.id] = project;
      writeProject(project.id);
      if (replaceProjectId !== undefined) archiveProject(replaceProjectId);
    } catch (error) {
      forgetProject(project.id);
      try {
        rmSync(folder, { recursive: true, force: true });
      } catch (cleanupError) {
        options.logger.error(
          `Could not remove ${folder}: ${String(cleanupError)}`,
        );
      }
      throw error;
    }
    if (replaceProjectId !== undefined)
      options.bus.publish({
        kind: "project.removed",
        projectId: replaceProjectId,
      });
    options.bus.publish({
      kind: "project.created",
      project: summarize(project),
    });
    return project;
  }

  return {
    projectPath,
    loadProject,
    openProject(projectId: string) {
      const project = loadProject(projectId);
      copyCatalogAssets({
        catalogRoot: options.catalogRoot,
        catalogAssetIds: options.catalogAssetIds,
        projectFolder: projectPath(projectId),
        scene: project.scene,
        refresh: true,
      });
      return project;
    },
    listProjects,
    createProject(input: {
      name: string;
      room: { widthM: number; depthM: number; ceilingHeightM: number };
    }) {
      const project: Project = {
        id: randomUUID(),
        name: input.name,
        revision: 0,
        scene: createRectangularScene(input.room),
      };
      return saveNewProject({ project });
    },
    openSampleProject(
      input: {
        resetProjectId?: string | undefined;
        locale?: AppLocale | undefined;
      } = {},
    ) {
      const sample = listProjects().find((project) => project.sample);
      if (sample && sample.id !== input.resetProjectId)
        return loadProject(sample.id);
      return saveNewProject({
        project: createSampleProject(input.locale),
        replaceProjectId: sample?.id,
      });
    },
    renameProject(input: { projectId: string; name: string }) {
      const project = loadProject(input.projectId);
      const renamed = { ...project, name: input.name };
      loaded[project.id] = renamed;
      try {
        writeProject(project.id);
      } catch (error) {
        loaded[project.id] = project;
        if (unwrittenProjectIds.has(project.id)) scheduleWrite(project.id);
        throw error;
      }
      const summary = summarize(renamed);
      options.bus.publish({ kind: "project.renamed", project: summary });
      return summary;
    },
    removeProject(projectId: string) {
      archiveProject(projectId);
      options.bus.publish({ kind: "project.removed", projectId });
      return { projectId };
    },
    importProject(folder: string) {
      const imported = ProjectSchema.parse(
        JSON.parse(readFileSync(join(folder, "project.json"), "utf8")),
      );
      const project: Project = { ...imported, id: randomUUID() };
      delete project.sample;
      createFolders(folder);
      copyCatalogAssets({
        catalogRoot: options.catalogRoot,
        catalogAssetIds: options.catalogAssetIds,
        projectFolder: folder,
        scene: project.scene,
      });
      writeJson({ path: join(folder, "project.json"), value: project });
      renameSync(folder, projectPath(project.id));
      const summary = { id: project.id, name: project.name };
      options.bus.publish({ kind: "project.created", project: summary });
      return summary;
    },
    applyCommand(input: {
      projectId: string;
      command: Command;
      requestId: string | undefined;
      reconstruction?: Project["reconstruction"];
      inventory?: Project["inventory"];
    }) {
      const project = loadProject(input.projectId);
      const result = applyCommand({
        scene: project.scene,
        command: input.command,
      });
      if (result.kind === "rejected") throw new Error(result.reason);
      restoreArchivedAssets({
        folder: projectPath(project.id),
        project: { ...project, scene: result.scene },
      });
      copyCatalogAssets({
        catalogRoot: options.catalogRoot,
        catalogAssetIds: options.catalogAssetIds,
        projectFolder: projectPath(project.id),
        scene: result.scene,
      });
      const revision = project.revision + 1;
      loaded[project.id] = {
        ...project,
        revision,
        scene: result.scene,
        ...(input.reconstruction
          ? { reconstruction: input.reconstruction }
          : {}),
        ...(input.inventory ? { inventory: input.inventory } : {}),
      };
      if (input.reconstruction || input.inventory) {
        try {
          writeProject(project.id);
        } catch (error) {
          loaded[project.id] = project;
          if (unwrittenProjectIds.has(project.id)) scheduleWrite(project.id);
          throw error;
        }
      } else scheduleWrite(project.id);
      options.bus.publish({
        kind: "scene.changed",
        projectId: project.id,
        command: input.command,
        revision,
        ...(input.requestId === undefined
          ? {}
          : { requestId: input.requestId }),
      });
      return { revision };
    },
    flush() {
      const failedProjectIds = [...unwrittenProjectIds].filter(
        (projectId) => !tryWriteProject(projectId),
      );
      if (failedProjectIds.length > 0)
        throw new Error(
          `Could not write project ${failedProjectIds.join(", ")}`,
        );
    },
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
