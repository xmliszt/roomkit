"use client";

import type { Role } from "@planner/shared/src/config/config-schema.ts";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import type { InstallTarget } from "@planner/shared/src/jobs/install-target-schema.ts";
import { PreflightSchema } from "@planner/shared/src/preflight/preflight-schema.ts";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import { SettingsLanguage } from "../i18n/settings-language.tsx";
import { useAppLanguage } from "../i18n/use-app-language.ts";
import { JobRow } from "../jobs/job-row.tsx";
import { HairlineRow } from "../pages-ui/hairline-row.tsx";
import { PageColumn } from "../pages-ui/page-column.tsx";
import { RowButton } from "../pages-ui/row-button.tsx";
import { RowSection } from "../pages-ui/row-section.tsx";
import { UsageRow } from "../pages-ui/usage-row.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { formatBytes } from "../ui/format-bytes.ts";
import { formatUsageWindow } from "./format-usage-window.ts";
import type { SetupChoice } from "./get-setup-plan.ts";
import { GuidedSetup } from "./guided-setup.tsx";
import { RoleModelRow } from "./role-model-row.tsx";
import { SettingsFigure } from "./settings-figure.tsx";
import { TailnetSettings } from "./tailnet-settings.tsx";
import { translateAgentDiagnostic } from "./translate-agent-diagnostic.ts";
import { translateToolDiagnostic } from "./translate-tool-diagnostic.ts";
import { translateUsageDiagnostic } from "./translate-usage-diagnostic.ts";

type SettingsPageProps = {
  fromProjectId: string | undefined;
  initialChoice?: SetupChoice | undefined;
  fromCapture?: boolean;
};

const toolStateLabels = {
  present: "settings.statePresent",
  missing: "settings.stateMissing",
  error: "settings.stateError",
  partial: "settings.statePartial",
};

const agentStatusLabels = {
  ready: "settings.signedIn",
  "sign-in": "settings.signInRequired",
  "not-installed": "settings.agentNotInstalled",
  error: "settings.stateError",
};

type SettingsError =
  | { kind: "clipboard" }
  | {
      kind: "command";
      key: "settings.actionFailed" | "settings.checkFailed";
      detail: string;
    };

type SignInLocation = {
  cli: "claude" | "codex";
  section: "setup" | "agents";
};

type SignInResult = SignInLocation &
  ({ kind: "started" } | { kind: "failed"; detail: string });

export function SettingsPage(props: SettingsPageProps) {
  const { locale, t } = useAppLanguage();
  const pathId = useId();
  const session = usePlannerSession();
  const preflight = useStore(
    session.stores.activity,
    (state) => state.preflight,
  );
  const config = useStore(session.stores.snapshot, (state) => state.config);
  const connection = useStore(
    session.stores.snapshot,
    (state) => state.connection,
  );
  const snapshotAt = useStore(session.stores.snapshot, (state) => state.at);
  const jobs = useStore(session.stores.jobs, (state) => state.jobs);
  const [copiedCommand, setCopiedCommand] = useState<string>();
  const [error, setError] = useState<SettingsError>();
  const [signInResult, setSignInResult] = useState<SignInResult>();
  const [isChecking, setIsChecking] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [isPickingPath, setIsPickingPath] = useState(false);
  const pathRef = useRef<HTMLInputElement>(null);
  const [manualTargetKey, setManualTargetKey] = useState<string>();
  const [guideTargetKeys, setGuideTargetKeys] = useState<string[]>([]);
  const [expandedInstalls, setExpandedInstalls] = useState<{
    [id: string]: boolean;
  }>({});
  const latestInstalls = Object.entries(
    Object.fromEntries(
      Object.values(jobs)
        .filter((job) => job.kind === "install")
        .toSorted((first, second) =>
          first.createdAt.localeCompare(second.createdAt),
        )
        .map((job) => [JSON.stringify(job.target), job]),
    ),
  );
  const guidedJobs = latestInstalls
    .filter(([key]) => guideTargetKeys.includes(key))
    .map(([, job]) => job);
  const roles: Role[] = ["surveyor", "modeler", "designer"];
  const disabled = connection !== "open" || isActing;
  const loginStarted =
    signInResult?.kind === "started" ? signInResult.cli : undefined;
  const isLocal =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const isAgentSetup =
    props.initialChoice === "claude" || props.initialChoice === "codex";
  useEffect(() => {
    if (connection !== "open" || snapshotAt === undefined) return;
    let active = true;
    setIsChecking(true);
    setError(undefined);
    session
      .command(
        { type: "preflight.check", force: isAgentSetup || checkAttempt > 0 },
        { timeoutMs: 60000 },
      )
      .then((ack) => {
        if (!active) return;
        if (!ack.ok) throw new Error(ack.error);
        const checked = PreflightSchema.parse(ack.result);
        session.stores.activity.setState({ preflight: checked });
        setSignInResult((current) =>
          checked.agents.some(
            (agent) => agent.cli === current?.cli && agent.status === "ready",
          )
            ? undefined
            : current,
        );
      })
      .catch((caught: unknown) => {
        if (active)
          setError({
            kind: "command",
            key: "settings.checkFailed",
            detail: caught instanceof Error ? caught.message : String(caught),
          });
      })
      .finally(() => {
        if (active) setIsChecking(false);
      });
    return () => {
      active = false;
    };
  }, [session, connection, snapshotAt, isAgentSetup, checkAttempt]);

  async function copyLogin(command: string) {
    setCopiedCommand(undefined);
    setError(undefined);
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
    } catch {
      setError({ kind: "clipboard" });
    }
  }

  async function signIn(location: SignInLocation) {
    setIsActing(true);
    setSignInResult(undefined);
    try {
      const ack = await session.command(
        { type: "agent.login", cli: location.cli },
        { timeoutMs: 15000 },
      );
      if (!ack.ok) throw new Error(ack.error);
      setSignInResult({ ...location, kind: "started" });
    } catch (caught) {
      setSignInResult({
        ...location,
        kind: "failed",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsActing(false);
    }
  }

  function renderSignIn(options: SignInLocation & { disabled: boolean }) {
    const failure =
      signInResult?.kind === "failed" &&
      signInResult.cli === options.cli &&
      signInResult.section === options.section
        ? signInResult.detail
        : undefined;
    return (
      <div className="min-w-0">
        <RowButton
          label={t("setup.signInTo", {
            tool: options.cli === "claude" ? "Claude Code" : "Codex",
          })}
          disabled={options.disabled}
          onClick={() =>
            void signIn({ cli: options.cli, section: options.section })
          }
        >
          {t("setup.signIn")}
        </RowButton>
        {failure !== undefined && (
          <p role="alert" className="break-words text-danger">
            {t("settings.actionFailed", { detail: failure })}
          </p>
        )}
      </div>
    );
  }

  async function install(target: InstallTarget) {
    setIsActing(true);
    setError(undefined);
    try {
      const ack = await session.command({ type: "install.start", target });
      if (!ack.ok) throw new Error(ack.error);
      setManualTargetKey(JSON.stringify(target));
    } catch (caught) {
      setError({
        kind: "command",
        key: "settings.actionFailed",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsActing(false);
    }
  }

  async function assignAgent(cli: "claude" | "codex") {
    setIsActing(true);
    setError(undefined);
    const roles = createDefaultConfig(cli).roles;
    try {
      const ack = await session.command({ type: "config.update", roles });
      if (!ack.ok) throw new Error(ack.error);
    } catch (caught) {
      setError({
        kind: "command",
        key: "settings.actionFailed",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsActing(false);
    }
  }

  function installRows(section: "agents" | "blender" | "python") {
    return latestInstalls.map(([key, job]) => {
      const targetSection =
        job.target.kind === "agent"
          ? "agents"
          : job.target.kind === "blender"
            ? "blender"
            : "python";
      if (
        targetSection !== section ||
        (job.stage === "done" &&
          key !== manualTargetKey &&
          !guideTargetKeys.includes(key))
      )
        return null;
      const expanded = expandedInstalls[job.id] ?? key === manualTargetKey;
      return (
        <JobRow
          key={job.id}
          job={job}
          expanded={expanded}
          onToggle={() =>
            setExpandedInstalls((current) => ({
              ...current,
              [job.id]: !expanded,
            }))
          }
        />
      );
    });
  }

  async function setPath(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsActing(true);
    setError(undefined);
    try {
      const ack = await session.command(
        {
          type: "blender.path.set",
          path: pathRef.current?.value.trim() || undefined,
        },
        { timeoutMs: 60000 },
      );
      if (!ack.ok) throw new Error(ack.error);
      session.stores.activity.setState({
        preflight: PreflightSchema.parse(ack.result),
      });
      setIsPickingPath(false);
    } catch (caught) {
      setError({
        kind: "command",
        key: "settings.actionFailed",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsActing(false);
    }
  }

  function modelBusy(modelId: string) {
    return Object.values(jobs).some(
      (job) =>
        job.kind === "install" &&
        "modelId" in job.target &&
        job.target.modelId === modelId &&
        (job.stage === "queued" || job.stage === "running"),
    );
  }

  return (
    <PageColumn title={t("settings.title")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={
            props.fromProjectId === undefined
              ? "/"
              : `/projects/${props.fromProjectId}${props.fromCapture ? "/capture" : ""}`
          }
          className="me-auto underline underline-offset-2"
        >
          {props.fromProjectId === undefined
            ? t("settings.projects")
            : props.fromCapture
              ? t("settings.backToCapture")
              : t("settings.backToRoom")}
        </Link>
        <output className="text-ink-dim">
          {connection !== "open"
            ? t("settings.daemonDisconnected")
            : isChecking
              ? t("settings.checking")
              : t("settings.connected")}
        </output>
        <RowButton
          disabled={connection !== "open" || isChecking}
          onClick={() => setCheckAttempt((value) => value + 1)}
        >
          {t("settings.checkAgain")}
        </RowButton>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error.kind === "clipboard"
            ? t("settings.copyLoginFailed")
            : t(error.key, { detail: error.detail })}
        </p>
      )}
      <output className="sr-only">
        {loginStarted && t("setup.finishSignIn")}
      </output>
      <SettingsLanguage />
      <GuidedSetup
        sectionId="setup"
        key={props.initialChoice}
        preflight={preflight}
        initialChoice={props.initialChoice}
        disabled={disabled || isChecking}
        jobs={guidedJobs}
        local={isLocal}
        loginStarted={loginStarted}
        renderSignIn={renderSignIn}
        onInstallStarted={(targets) =>
          setGuideTargetKeys(targets.map((target) => JSON.stringify(target)))
        }
        onCheckAgain={() => setCheckAttempt((value) => value + 1)}
      />
      <div>
        <RowSection sectionId="agents" title={t("settings.agents")}>
          {["claude", "codex"].map((cli) => {
            const agent = preflight?.agents.find((entry) => entry.cli === cli);
            return (
              <div key={cli} className="border-line border-b pb-3">
                <div className="grid grid-cols-[108px_minmax(0,1fr)] items-center gap-x-4">
                  <SettingsFigure
                    kind={cli === "claude" ? "claude" : "codex"}
                    live={agent?.status === "ready"}
                    label={t("settings.agentTerminal", {
                      agent: cli,
                      status:
                        agent?.status === "ready"
                          ? t("settings.signedIn")
                          : t("settings.notSignedIn"),
                    })}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-y-1 py-3">
                    <div className="aligned-row agent-status">
                      <span>{cli}</span>
                      <span
                        className={
                          agent?.status === "ready"
                            ? "text-accent"
                            : "text-ink-dim"
                        }
                      >
                        {t(
                          agent
                            ? agentStatusLabels[agent.status]
                            : "settings.notChecked",
                        )}
                      </span>
                    </div>
                    <p className="truncate text-ink-dim" title={agent?.path}>
                      {agent?.path ??
                        (agent
                          ? t("settings.pathNotFound")
                          : t("settings.checkingPath"))}
                    </p>
                    <p className="truncate text-ink-dim">
                      {agent?.version ?? t("settings.versionUnavailable")} ·{" "}
                      {agent?.usage?.plan ?? t("settings.planUnavailable")}
                    </p>
                    {agent?.status === "sign-in" &&
                      isLocal &&
                      renderSignIn({
                        cli: agent.cli,
                        disabled: disabled || isChecking,
                        section: "agents",
                      })}
                    {agent?.status === "sign-in" &&
                      !isLocal &&
                      (() => {
                        const command =
                          cli === "claude"
                            ? "claude auth login"
                            : "codex login";
                        return (
                          <div className="aligned-row">
                            <code>{command}</code>
                            <RowButton
                              label={t("settings.copyCommand", { command })}
                              onClick={() => void copyLogin(command)}
                            >
                              {copiedCommand === command
                                ? t("settings.copied")
                                : t("settings.copy")}
                            </RowButton>
                          </div>
                        );
                      })()}
                    {agent?.status === "ready" &&
                      config &&
                      Object.values(config.roles).some(
                        (role) => role.cli !== agent.cli,
                      ) && (
                        <div>
                          <RowButton
                            disabled={disabled}
                            onClick={() => void assignAgent(agent.cli)}
                            label={t("settings.useAgentForAllRoles", {
                              agent:
                                agent.cli === "claude"
                                  ? "Claude Code"
                                  : "Codex",
                            })}
                          >
                            {t("settings.useForAllRoles")}
                          </RowButton>
                        </div>
                      )}
                    {agent && agent.status !== "ready" && (
                      <p className="text-ink-dim">
                        {agent.status === "sign-in" &&
                        loginStarted === agent.cli
                          ? t("setup.finishSignIn")
                          : translateAgentDiagnostic({ agent, t })}
                      </p>
                    )}
                  </div>
                </div>
                {agent?.usage?.windows.map((window, index) => (
                  <UsageRow
                    key={`${index}:${window.label}`}
                    title={t("settings.usageTitle", {
                      agent: cli,
                      window: formatUsageWindow({
                        label: window.label,
                        locale,
                        t,
                      }),
                    })}
                    percent={window.usedPercent}
                    resetsAt={
                      window.resetsAt
                        ? new Date(window.resetsAt).toLocaleString(locale)
                        : t("settings.unavailable")
                    }
                  />
                ))}
                {agent?.usage?.error && (
                  <p className="pt-2 text-ink-dim">
                    {translateUsageDiagnostic({
                      cli: agent.cli,
                      error: agent.usage.error,
                      t,
                    })}
                  </p>
                )}
              </div>
            );
          })}
          {installRows("agents")}
          {config &&
            roles.map((role) => (
              <RoleModelRow
                key={`${role}:${config.roles[role].cli}:${config.roles[role].model}`}
                role={role}
                value={config.roles[role]}
                disabled={disabled}
              />
            ))}
        </RowSection>
      </div>
      <div>
        <RowSection sectionId="blender" title="Blender">
          <div className="grid grid-cols-[108px_minmax(0,1fr)] items-center gap-x-4">
            <SettingsFigure
              kind="blender"
              live={preflight?.blender.state === "present"}
              label={`Blender · ${t(preflight ? toolStateLabels[preflight.blender.state] : "settings.notChecked")}`}
            />
            <div className="min-w-0 flex-1">
              <HairlineRow
                title={preflight?.blender.version ?? "Blender"}
                status={translateToolDiagnostic({
                  check: preflight?.blender,
                  tool: "Blender",
                  t,
                })}
                action={
                  preflight?.blender.state === "present" ? (
                    <RowButton
                      disabled={disabled}
                      onClick={() => setIsPickingPath((current) => !current)}
                    >
                      {t("settings.pickPath")}
                    </RowButton>
                  ) : (
                    <RowButton
                      label={t("settings.installBlender")}
                      disabled={disabled || !preflight}
                      onClick={() => void install({ kind: "blender" })}
                    >
                      {t("settings.install")}
                    </RowButton>
                  )
                }
              />
              <p className="break-all py-2 text-ink-dim">
                {preflight?.blender.path ??
                  (preflight
                    ? t("settings.pathNotFound")
                    : t("settings.checkingPath"))}
              </p>
              {preflight?.blender.state !== "present" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setIsPickingPath((current) => !current)}
                  className="pb-2 underline"
                >
                  {t("settings.pickPath")}
                </button>
              )}
            </div>
          </div>
          {installRows("blender")}
          {isPickingPath && (
            <form
              onSubmit={setPath}
              className="flex flex-col gap-y-2 border-line border-t py-3"
            >
              <label htmlFor={pathId}>{t("settings.blenderPath")}</label>
              <div className="flex gap-x-2">
                <input
                  id={pathId}
                  ref={pathRef}
                  defaultValue={config?.blenderPath ?? ""}
                  placeholder="/Applications/Blender.app"
                  className="h-7 min-w-0 flex-1 border border-line px-2"
                />
                <RowButton type="submit" disabled={disabled}>
                  {t("settings.savePath")}
                </RowButton>
              </div>
              <p className="text-ink-dim">{t("settings.detectedPathHint")}</p>
            </form>
          )}
        </RowSection>
      </div>
      <div>
        <RowSection sectionId="python" title={t("settings.pythonRuntime")}>
          <div className="grid grid-cols-[108px_minmax(0,1fr)] items-center gap-x-4">
            <SettingsFigure
              kind="rack"
              drawers={
                preflight?.models.map((model) => ({
                  id: model.id,
                  present: model.state === "present",
                })) ?? []
              }
              label={t("settings.modelRack")}
            />
            <div className="min-w-0 flex-1">
              <HairlineRow
                title={`uv · ${preflight?.uv.version ?? t(preflight ? toolStateLabels[preflight.uv.state] : "settings.notChecked")}`}
                status={
                  preflight
                    ? translateToolDiagnostic({
                        check: preflight.uv,
                        tool: "uv",
                        t,
                      })
                    : undefined
                }
                action={
                  preflight?.uv.state !== "present" && (
                    <RowButton
                      disabled={disabled || !preflight}
                      onClick={() => void install({ kind: "uv" })}
                    >
                      {t("settings.installUv")}
                    </RowButton>
                  )
                }
              />
              <HairlineRow
                title={t("settings.pythonEnv")}
                status={
                  <span title={preflight?.pythonEnv.message}>
                    {translateToolDiagnostic({
                      check: preflight?.pythonEnv,
                      tool: "Python",
                      t,
                    })}
                  </span>
                }
                action={
                  <RowButton
                    disabled={
                      disabled ||
                      preflight?.uv.state !== "present" ||
                      preflight?.pythonEnv.state === "present"
                    }
                    onClick={() => void install({ kind: "python-env" })}
                  >
                    {preflight?.pythonEnv.state === "present"
                      ? t("settings.ready")
                      : t("settings.setUp")}
                  </RowButton>
                }
              />
            </div>
          </div>
          <p className="break-all border-line border-b py-2 text-ink-dim">
            {preflight?.pythonEnv.path}
          </p>
          {preflight?.models.map((model) => (
            <HairlineRow
              key={model.id}
              title={model.name}
              status={`${t(toolStateLabels[model.state])} · ${formatBytes({ bytes: model.sizeBytes, locale })} / ${formatBytes({ bytes: model.expectedSizeBytes, locale })}`}
              action={
                <div className="flex gap-x-2">
                  {model.state !== "present" && (
                    <RowButton
                      label={t("settings.downloadModel", { model: model.name })}
                      disabled={disabled || modelBusy(model.id)}
                      onClick={() =>
                        void install({
                          kind: "weights-download",
                          modelId: model.id,
                        })
                      }
                    >
                      {model.state === "partial"
                        ? t("settings.resume")
                        : t("settings.download")}
                    </RowButton>
                  )}
                  {model.state !== "missing" && (
                    <RowButton
                      danger
                      label={t("settings.deleteModel", { model: model.name })}
                      disabled={disabled || modelBusy(model.id)}
                      onClick={() =>
                        void install({
                          kind: "weights-delete",
                          modelId: model.id,
                        })
                      }
                    >
                      {t("settings.delete")}
                    </RowButton>
                  )}
                </div>
              }
            />
          ))}
          {installRows("python")}
          {preflight?.models.length === 0 && (
            <p className="py-3 text-ink-dim">{t("settings.noModels")}</p>
          )}
        </RowSection>
      </div>
      <TailnetSettings
        connected={connection === "open" && snapshotAt !== undefined}
      />
    </PageColumn>
  );
}
