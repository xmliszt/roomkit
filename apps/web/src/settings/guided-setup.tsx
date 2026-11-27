import type { InstallTarget } from "@planner/shared/src/jobs/install-target-schema.ts";
import type { InstallJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Preflight } from "@planner/shared/src/preflight/preflight-schema.ts";
import { useId, useState } from "react";
import { renderMessageParts } from "../i18n/render-message-parts.tsx";
import { useAppLanguage } from "../i18n/use-app-language.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import {
  getSetupPlan,
  type SetupChoice,
  setupChoices,
} from "./get-setup-plan.ts";

type GuidedSetupProps = {
  sectionId: string;
  preflight: Preflight | undefined;
  initialChoice: SetupChoice | undefined;
  disabled: boolean;
  jobs: InstallJob[];
  onInstallStarted: (targets: InstallTarget[]) => void;
  onCheckAgain: () => void;
};

export function GuidedSetup(props: GuidedSetupProps) {
  const { locale, t } = useAppLanguage();
  const decimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });
  const titleId = useId();
  const session = usePlannerSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [loginStarted, setLoginStarted] = useState<"claude" | "codex">();
  const preflight = props.preflight;
  const device = preflight?.device;
  const missing = preflight
    ? setupChoices
        .map((choice) => ({
          id: choice.id,
          label: "labelKey" in choice ? t(choice.labelKey) : choice.label,
          description: t(choice.description),
          plan: getSetupPlan({ preflight, choices: [choice.id] }),
          agent: preflight.agents.find((agent) => agent.cli === choice.id),
        }))
        .filter(({ id, plan, agent }) =>
          id !== props.initialChoice &&
          (plan.requiresAppleSilicon || plan.unlistedModels.length > 0)
            ? false
            : plan.targets.length > 0 ||
              plan.unlistedModels.length > 0 ||
              agent?.status === "sign-in",
        )
        .toSorted(
          (a, b) =>
            Number(b.id === props.initialChoice) -
            Number(a.id === props.initialChoice),
        )
    : [];
  const isRunning = props.jobs.some(
    (job) => job.stage === "queued" || job.stage === "running",
  );
  const setupFailure = props.jobs.find((job) => job.stage === "failed");
  const isBlocked = props.disabled || isSubmitting || isRunning;
  const isLocal =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  function gigabytes(bytes: number) {
    return t("setup.gb", { amount: decimal.format(bytes / 1e9) });
  }

  async function start(targets: InstallTarget[]) {
    setIsSubmitting(true);
    setError(undefined);
    setLoginStarted(undefined);
    try {
      const ack = await session.command({
        type: "install.batch.start",
        targets,
      });
      if (!ack.ok) throw new Error(ack.error);
      props.onInstallStarted(targets);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signIn(cli: "claude" | "codex") {
    setError(undefined);
    setLoginStarted(undefined);
    setIsSubmitting(true);
    try {
      const ack = await session.command(
        { type: "agent.login", cli },
        { timeoutMs: 15000 },
      );
      if (!ack.ok) throw new Error(ack.error);
      setLoginStarted(cli);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      id={props.sectionId}
      aria-labelledby={titleId}
      className="grid scroll-mt-4 gap-y-2 rounded-panel border border-line p-4"
    >
      <h2 id={titleId} className="type-panel-title">
        {t("setup.title")}
      </h2>
      {(props.initialChoice === "claude" ||
        props.initialChoice === "codex") && (
        <p className="text-ink-dim">
          {renderMessageParts({
            message: t("setup.alternateAgentHint"),
            parts: {
              choose: (
                <a href="#agents" className="underline underline-offset-2">
                  {t("setup.chooseDesignerAgent")}
                </a>
              ),
            },
          })}
        </p>
      )}
      {!preflight ? (
        <output className="text-ink-dim">{t("setup.connectToCheck")}</output>
      ) : missing.length === 0 ? (
        <output className="text-ink-dim">{t("setup.allSet")}</output>
      ) : (
        <>
          {device && (
            <p className="text-ink-dim">
              {t("setup.gbMemory", {
                memory: Math.round(device.memoryBytes / 1024 ** 3),
              })}
              {device.modelStorageBytes !== undefined &&
                ` · ${t("setup.modelDiskSpace", { size: gigabytes(device.modelStorageBytes) })}`}
            </p>
          )}
          {missing.some(({ plan }) => plan.needsHomebrew) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <a
                href="https://brew.sh/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {t("setup.installHomebrew")}
              </a>
              <RowButton disabled={props.disabled} onClick={props.onCheckAgain}>
                {t("setup.checkAgain")}
              </RowButton>
            </div>
          )}
          <ul aria-label={t("setup.missingTools")} className="grid">
            {missing.map(({ id, label, description, plan, agent }) => {
              const issue = plan.requiresAppleSilicon
                ? t("setup.needsAppleSilicon")
                : plan.unlistedModels.length > 0
                  ? t("setup.downloadsUnavailable")
                  : plan.needsHomebrew
                    ? t("setup.needsHomebrew")
                    : plan.storageShortfall > 0
                      ? t("setup.storageShortfall", {
                          size: gigabytes(plan.storageShortfall),
                        })
                      : undefined;
              const bytes = plan.downloadBytes + plan.toolBytes;
              const mayRunOutOfMemory =
                (id === "sam3d" || id === "trellis2") &&
                device &&
                device.memoryBytes < 16 * 1024 ** 3;
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-line border-t py-2"
                >
                  <div className="grid flex-1 gap-y-0.5">
                    <span>{label}</span>
                    {agent?.status === "sign-in" ? (
                      <span className="text-ink-dim">
                        {isLocal
                          ? loginStarted === agent.cli
                            ? t("setup.finishSignIn")
                            : t("setup.signInOnMac")
                          : renderMessageParts({
                              message: t("setup.runLoginOnMac"),
                              parts: {
                                command: (
                                  <code>
                                    {agent.cli === "claude"
                                      ? "claude auth login"
                                      : "codex login"}
                                  </code>
                                ),
                              },
                            })}
                      </span>
                    ) : (
                      <span className="text-ink-dim">
                        {description}
                        {bytes > 0 &&
                          ` · ${bytes < 1e8 ? t("setup.underMinimumSize") : t("setup.aboutSize", { size: gigabytes(bytes) })}`}
                      </span>
                    )}
                    {issue && <span className="text-danger">{issue}</span>}
                    {mayRunOutOfMemory && !issue && (
                      <span className="text-ink-dim">
                        {t("setup.memoryWarning")}
                      </span>
                    )}
                  </div>
                  {agent?.status === "sign-in" ? (
                    isLocal ? (
                      <RowButton
                        label={t("setup.signInTo", { tool: label })}
                        disabled={isBlocked}
                        onClick={() => void signIn(agent.cli)}
                      >
                        {t("setup.signIn")}
                      </RowButton>
                    ) : (
                      <RowButton
                        disabled={props.disabled}
                        onClick={props.onCheckAgain}
                      >
                        {t("setup.checkAgain")}
                      </RowButton>
                    )
                  ) : (
                    <RowButton
                      label={t("setup.setUpTool", { tool: label })}
                      disabled={
                        isBlocked || Boolean(issue) || plan.targets.length === 0
                      }
                      onClick={() => void start(plan.targets)}
                    >
                      {t("setup.setUp")}
                    </RowButton>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {isRunning && (
        <output className="text-ink-dim">{t("setup.installing")}</output>
      )}
      {setupFailure && !isRunning && (
        <p role="alert" className="text-danger">
          {setupFailure.error
            ? t("setup.installFailed", { detail: setupFailure.error })
            : t("setup.setupFailed")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {t("setup.installFailed", { detail: error })}
        </p>
      )}
    </section>
  );
}
