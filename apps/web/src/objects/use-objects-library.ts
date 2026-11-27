import {
  type ObjectsLibraryResult,
  ObjectsLibraryResultSchema,
} from "@planner/shared/src/protocol/objects-library-result-schema.ts";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { usePlannerSession } from "../planner/use-planner-session.ts";

export function useObjectsLibrary(options: { projectId: string }) {
  const session = usePlannerSession();
  const connection = useStore(
    session.stores.snapshot,
    (state) => state.connection,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<
    | { kind: "loading" }
    | {
        kind: "ready";
        objects: ObjectsLibraryResult["objects"];
        archived: ObjectsLibraryResult["objects"];
      }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  useEffect(() => {
    if (connection !== "open") return;
    let cancelled = false;
    let latestRead = 0;
    let readKey: string | undefined;
    async function read() {
      const readId = ++latestRead;
      function isCurrent() {
        return !cancelled && readId === latestRead;
      }
      try {
        const replies = await Promise.all([
          session.command({
            type: "objects.library",
            projectId: options.projectId,
          }),
          session.command({
            type: "objects.archived",
            projectId: options.projectId,
          }),
        ]);
        const lists = replies.map((reply) => {
          if (!reply.ok) throw new Error(reply.error);
          return ObjectsLibraryResultSchema.parse(reply.result).objects;
        });
        if (isCurrent())
          setResult({
            kind: "ready",
            objects: lists.at(0) ?? [],
            archived: lists.at(1) ?? [],
          });
      } catch (error) {
        if (isCurrent())
          setResult({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      }
    }
    function readWhenChanged() {
      const assetIds = new Set(
        session.stores.projects
          .getState()
          .opened[options.projectId]?.project.scene.items.flatMap((item) =>
            item.model.kind === "asset" ? [item.model.assetId] : [],
          ),
      );
      const readyJobs = Object.values(session.stores.jobs.getState().jobs)
        .filter(
          (job) =>
            job.kind !== "install" &&
            job.projectId === options.projectId &&
            job.stage === "ready",
        )
        .map((job) => `${job.id}:${job.updatedAt}`);
      const key = JSON.stringify([
        revision,
        [...assetIds].toSorted(),
        readyJobs.toSorted(),
      ]);
      if (key === readKey) return;
      readKey = key;
      void read();
    }
    readWhenChanged();
    const unsubscribes = [
      session.stores.projects.subscribe(readWhenChanged),
      session.stores.jobs.subscribe(readWhenChanged),
    ];
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [session, options.projectId, connection, revision]);
  function refresh() {
    setRevision((value) => value + 1);
  }
  async function setArchived(input: { assetId: string; archived: boolean }) {
    const reply = await session.command({
      type: input.archived ? "objects.archive" : "objects.restore",
      projectId: options.projectId,
      assetId: input.assetId,
    });
    if (!reply.ok) throw new Error(reply.error);
    setResult((current) => {
      if (current.kind !== "ready") return current;
      const from = input.archived ? current.objects : current.archived;
      const moved = from.find((object) => object.assetId === input.assetId);
      if (!moved) return current;
      const objects = current.objects.filter(
        (object) => object.assetId !== input.assetId,
      );
      const archived = current.archived.filter(
        (object) => object.assetId !== input.assetId,
      );
      return input.archived
        ? { kind: "ready", objects, archived: [...archived, moved] }
        : { kind: "ready", objects: [...objects, moved], archived };
    });
    refresh();
  }
  return { result, refresh, setArchived };
}
