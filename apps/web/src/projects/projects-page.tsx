"use client";

import { useStore } from "zustand";
import { useMessages } from "../i18n/use-messages.ts";
import { PageColumn } from "../pages-ui/page-column.tsx";
import { RowSection } from "../pages-ui/row-section.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { NewProjectForm } from "./new-project-form.tsx";
import { ProjectRow } from "./project-row.tsx";
import { SampleRoom } from "./sample-room.tsx";

export function ProjectsPage() {
  const t = useMessages();
  const session = usePlannerSession();
  const summaries = useStore(
    session.stores.projects,
    (state) => state.summaries,
  );
  const connection = useStore(
    session.stores.snapshot,
    (state) => state.connection,
  );
  const hasSnapshot = useStore(
    session.stores.snapshot,
    (state) => state.at !== undefined,
  );

  const sample = summaries.find((project) => project.sample);
  const projects = summaries.filter((project) => !project.sample);

  return (
    <PageColumn title="Roomkit">
      <p className="text-ink-dim">{t("projects.tagline")}</p>
      <SampleRoom
        connected={connection === "open" && hasSnapshot}
        projectId={sample?.id}
      />
      {connection !== "open" && (
        <p className="text-ink-dim">
          {connection === "connecting"
            ? t("projects.connecting")
            : t("projects.daemonUnavailable", { command: "pnpm daemon" })}
        </p>
      )}
      {hasSnapshot && projects.length === 0 ? (
        <div className="flex flex-col gap-y-2">
          <p className="type-empty-headline">{t("projects.noProjects")}</p>
          <p className="text-ink-dim">{t("projects.emptyHint")}</p>
        </div>
      ) : (
        <RowSection title={t("projects.recent")}>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </RowSection>
      )}
      <RowSection title={t("projects.newProject")}>
        <NewProjectForm />
      </RowSection>
    </PageColumn>
  );
}
