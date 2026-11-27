import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useAppLanguage } from "../i18n/use-app-language.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";

type SampleRoomProps = {
  projectId: string | undefined;
  connected: boolean;
};

export function SampleRoom(props: SampleRoomProps) {
  const { locale, t } = useAppLanguage();
  const titleId = useId();
  const router = useRouter();
  const session = usePlannerSession();
  const [isOpening, setIsOpening] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string>();

  async function open(resetProjectId?: string) {
    setIsOpening(true);
    setError(undefined);
    try {
      const ack = await session.command({
        type: "project.sample.open",
        resetProjectId,
        locale,
      });
      if (!ack.ok) throw new Error(ack.error);
      router.push(`/projects/${ProjectSchema.parse(ack.result).id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsOpening(false);
      setIsConfirming(false);
    }
  }

  return (
    <section
      className="grid gap-y-3 rounded-panel border border-line p-4"
      aria-labelledby={titleId}
    >
      <div className="grid gap-y-1">
        <h2 id={titleId} className="type-panel-title">
          {t("projects.sampleHeading")}
        </h2>
        <p className="text-ink-dim">{t("projects.sampleDescription")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RowButton
          disabled={!props.connected || isOpening}
          onClick={() => void open()}
        >
          {isOpening ? t("projects.openingSample") : t("projects.openSample")}
        </RowButton>
        <Link href="/settings#setup" className="underline underline-offset-2">
          {t("setup.title")}
        </Link>
        {props.projectId && !isConfirming && (
          <RowButton
            disabled={!props.connected || isOpening}
            onClick={() => setIsConfirming(true)}
          >
            {t("projects.resetSample")}
          </RowButton>
        )}
      </div>
      {props.projectId && isConfirming && (
        <div className="grid gap-y-2">
          <p>{t("projects.resetSampleConfirmation")}</p>
          <div className="flex gap-x-2">
            <RowButton
              danger
              disabled={!props.connected || isOpening}
              onClick={() => void open(props.projectId)}
            >
              {t("projects.resetSample")}
            </RowButton>
            <RowButton
              disabled={isOpening}
              onClick={() => setIsConfirming(false)}
            >
              {t("projects.cancelSampleReset")}
            </RowButton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {t("projects.openSampleFailed", { detail: error })}
        </p>
      )}
    </section>
  );
}
