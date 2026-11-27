import type { ItemPatch } from "@planner/shared/src/commands/command-schema.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { useMessages } from "../../i18n/use-messages.ts";
import { CancelJobButton } from "../../jobs/cancel-job-button.tsx";
import { GenerationActions } from "./generation-actions.tsx";
import { getGenerationState } from "./get-generation-state.ts";
import { useGenerationActions } from "./use-generation-actions.ts";

type GenerationInspectorProps = {
  projectId: string;
  item: Item;
  job: Job | undefined;
  designerBusy: boolean;
  onSendDesignerRequest: (text: string) => Promise<boolean>;
  onUpdate: (patch: ItemPatch) => boolean;
};

export function GenerationInspector(props: GenerationInspectorProps) {
  const t = useMessages();
  const { jobs, alternatives, request } = useGenerationActions(props);
  const generationState = getGenerationState({
    item: props.item,
    job: props.job,
  });
  if (generationState === undefined) return null;
  return (
    <div className="flex flex-col gap-y-2">
      {Object.values(jobs)
        .filter(
          (job) =>
            (job.kind === "generation" ||
              job.kind === "generation-alternative") &&
            job.projectId === props.projectId &&
            job.itemId === props.item.id &&
            job.stage === "queued",
        )
        .map((job) => (
          <CancelJobButton key={job.id} job={job} />
        ))}
      {props.item.model.kind === "asset" &&
        props.job?.kind === "generation" &&
        (props.job.stage === "failed" || props.job.stage === "held") && (
          <output
            className={
              props.job.stage === "failed" ? "text-danger" : "text-ink-dim"
            }
          >
            {t("editor.generation-inspector.regeneration")}{" "}
            {t(`jobs.stage.${props.job.stage}`)}
            {props.job.error ? `: ${props.job.error}` : ""}
          </output>
        )}
      <GenerationActions
        key={props.item.id}
        projectId={props.projectId}
        designerBusy={props.designerBusy}
        state={generationState}
        alternatives={alternatives.assets.filter(
          (asset) =>
            props.item.model.kind !== "asset" ||
            asset.assetId !== props.item.model.assetId,
        )}
        alternativesRunning={alternatives.running}
        errors={alternatives.errors}
        onRequest={request}
      />
    </div>
  );
}
