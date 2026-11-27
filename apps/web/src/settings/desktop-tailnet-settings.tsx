"use client";

import { TailnetLoginSchema } from "@planner/shared/src/protocol/tailnet-login-schema.ts";
import {
  type DesktopTailnetStatus,
  DesktopTailnetStatusSchema,
} from "@planner/shared/src/protocol/tailnet-status-schema.ts";
import { type FormEvent, useId, useRef, useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";

type DesktopTailnetSettingsProps = {
  status: DesktopTailnetStatus;
  checking: boolean;
  connected: boolean;
  onCheck: () => void;
  onResult: (status: DesktopTailnetStatus) => void;
};

const labels = {
  "cli-missing": "tailnet.installTailscale",
  unavailable: "tailnet.tailscaleUnavailable",
  disconnected: "tailnet.tailscaleDisconnected",
  "needs-dns": "tailnet.enableMagicDnsHint",
  "needs-https": "tailnet.enableCertificatesHint",
  conflict: "tailnet.portConflict",
  "account-changed": "tailnet.identityChanged",
  disabled: "tailnet.accessOff",
  "cleanup-pending": "tailnet.leftoverRoutes",
  "routes-missing": "tailnet.routesMissing",
  ready: "tailnet.accessOn",
} satisfies { [state in DesktopTailnetStatus["state"]]: string };

export function DesktopTailnetSettings(props: DesktopTailnetSettingsProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const input = useRef<HTMLTextAreaElement>(null);
  const loginId = useId();
  const hintId = `${loginId}-hint`;
  const errorId = `${loginId}-error`;
  const [draft, setDraft] = useState<string>();
  const [pending, setPending] = useState<"enable" | "disable">();
  const [fieldError, setFieldError] = useState(false);
  const [actionError, setActionError] = useState<{ detail?: string }>();
  const [copyMessage, setCopyMessage] = useState<{
    url: string;
    copied: boolean;
  }>();
  const { state, url, logins } = props.status;
  const busy = props.checking || pending !== undefined || !props.connected;
  const canEnable = [
    "disabled",
    "cleanup-pending",
    "routes-missing",
    "ready",
  ].includes(state);
  const message = (() => {
    if (pending === "enable") return t("tailnet.updatingAccess");
    if (pending === "disable") return t("tailnet.disablingAccess");
    if (!props.connected) return t("tailnet.waitingForDaemon");
    if (props.checking) return t("tailnet.checking");
    return t(labels[state]);
  })();

  async function update(
    command:
      | { type: "tailnet.enable"; logins: string[] }
      | { type: "tailnet.disable" },
  ) {
    setPending(command.type === "tailnet.enable" ? "enable" : "disable");
    setActionError(undefined);
    setCopyMessage(undefined);
    try {
      const ack = await session.command(command, { timeoutMs: 40000 });
      if (!ack.ok) throw new Error(ack.error);
      props.onResult(DesktopTailnetStatusSchema.parse(ack.result));
      setDraft(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? { detail: error.message } : {});
      props.onCheck();
    } finally {
      setPending(undefined);
    }
  }

  function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = (draft ?? logins.join("\n"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      entries.length === 0 ||
      entries.length > 50 ||
      entries.some((entry) => !TailnetLoginSchema.safeParse(entry).success)
    ) {
      setFieldError(true);
      input.current?.focus();
      return;
    }
    setFieldError(false);
    void update({ type: "tailnet.enable", logins: entries });
  }

  function checkAgain() {
    setActionError(undefined);
    setCopyMessage(undefined);
    props.onCheck();
  }

  async function copyUrl(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage({ url: value, copied: true });
    } catch {
      setCopyMessage({
        url: value,
        copied: false,
      });
    }
  }

  return (
    <div className="flex flex-col gap-y-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <output>{message}</output>
        <RowButton disabled={busy} onClick={checkAgain}>
          {t("tailnet.checkAgain")}
        </RowButton>
      </div>
      {state === "cli-missing" && (
        <a
          className="self-start underline"
          href="https://tailscale.com/download"
        >
          {t("tailnet.downloadTailscale")}
        </a>
      )}
      {state === "needs-dns" && (
        <a
          className="self-start underline"
          href="https://tailscale.com/docs/features/magicdns"
        >
          {t("tailnet.turnOnMagicDns")}
        </a>
      )}
      {state === "needs-https" && (
        <a
          className="self-start underline"
          href="https://tailscale.com/docs/how-to/set-up-https-certificates"
        >
          {t("tailnet.enableCertificates")}
        </a>
      )}
      {canEnable && (
        <form className="flex flex-col gap-y-2" onSubmit={enable}>
          <label htmlFor={loginId}>{t("tailnet.allowedLogins")}</label>
          <p id={hintId} className="text-ink-dim">
            {t("tailnet.allowedLoginsHint")}
          </p>
          <textarea
            id={loginId}
            ref={input}
            rows={3}
            spellCheck={false}
            autoCapitalize="none"
            disabled={busy}
            placeholder={"you@example.com\nteammate@example.com"}
            value={draft ?? logins.join("\n")}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => {
              setDraft(event.target.value);
              setFieldError(false);
            }}
            className="w-full rounded-panel border border-line bg-paper px-2 py-1"
          />
          <p
            id={errorId}
            aria-live="polite"
            className={fieldError ? "text-danger" : "sr-only"}
          >
            {fieldError && t("tailnet.invalidLogins")}
          </p>
          <RowButton type="submit" disabled={busy}>
            {state === "ready"
              ? t("tailnet.saveLogins")
              : state === "routes-missing"
                ? t("tailnet.restoreAccess")
                : t("tailnet.enableAccess")}
          </RowButton>
        </form>
      )}
      {url && !busy && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <input
              aria-label={t("tailnet.httpsUrl")}
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-panel border border-line bg-paper px-2 py-1"
            />
            <RowButton onClick={() => void copyUrl(url)}>
              {t("tailnet.copyUrl")}
            </RowButton>
          </div>
          <p className="text-ink-dim">{t("tailnet.openUrlHint")}</p>
        </>
      )}
      <output
        className={
          copyMessage && copyMessage.url === url ? undefined : "sr-only"
        }
      >
        {copyMessage && copyMessage.url === url
          ? t(
              copyMessage.copied
                ? "tailnet.urlCopied"
                : "tailnet.copyUrlManually",
            )
          : undefined}
      </output>
      {props.status.canDisable && (
        <div>
          <RowButton
            danger
            disabled={busy}
            onClick={() => void update({ type: "tailnet.disable" })}
          >
            {state === "cleanup-pending"
              ? t("tailnet.removeRoutes")
              : t("tailnet.disableAccess")}
          </RowButton>
        </div>
      )}
      <output className={actionError ? "text-danger" : "sr-only"}>
        {actionError &&
          (actionError.detail === undefined
            ? t("tailnet.updateFailed")
            : t("tailnet.updateFailedWithDetail", {
                detail: actionError.detail,
              }))}
      </output>
    </div>
  );
}
