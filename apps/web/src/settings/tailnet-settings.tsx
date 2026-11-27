"use client";

import {
  type TailnetStatus,
  TailnetStatusSchema,
} from "@planner/shared/src/protocol/tailnet-status-schema.ts";
import { useEffect, useState } from "react";
import { renderMessageParts } from "../i18n/render-message-parts.tsx";
import { useMessages } from "../i18n/use-messages.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { RowSection } from "../pages-ui/row-section.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import { DesktopTailnetSettings } from "./desktop-tailnet-settings.tsx";

type TailnetSettingsProps = { connected: boolean };
type SourceTailnetStatus = Exclude<
  TailnetStatus,
  { kind: "desktop" | "desktop-remote" }
>;

const labels = {
  "cli-missing": "tailnet.cliUnavailable",
  unavailable: "tailnet.statusUnreadable",
  disconnected: "tailnet.disconnected",
  "needs-dns": "tailnet.needsDns",
  "serve-not-configured": "tailnet.needsServe",
  "roomkit-not-configured": "tailnet.needsRoomkit",
  public: "tailnet.publicFunnel",
  ready: "tailnet.serveReady",
} satisfies { [kind in SourceTailnetStatus["kind"]]: string };

export function TailnetSettings(props: TailnetSettingsProps) {
  const t = useMessages();
  const session = usePlannerSession();
  const [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<{
    attempt: number;
    result: TailnetStatus;
  }>();
  const result = check?.result;
  const status =
    check?.attempt === attempt &&
    result?.kind !== "desktop" &&
    result?.kind !== "desktop-remote"
      ? result
      : undefined;
  const [copied, setCopied] = useState<boolean>();
  const host =
    status && "host" in status
      ? status.host
      : "roomkit-host.example-tailnet.ts.net:8443";
  const url =
    props.connected && status?.kind === "ready" ? `https://${host}` : undefined;
  const message = props.connected
    ? status
      ? t(labels[status.kind])
      : t("tailnet.checking")
    : t("tailnet.waitingForDaemon");

  useEffect(() => {
    setCopied(undefined);
    if (!props.connected) return;
    let active = true;
    async function check() {
      try {
        const ack = await session.command(
          { type: "tailnet.status" },
          { timeoutMs: 6500 },
        );
        if (!ack.ok) throw new Error(ack.error);
        if (active)
          setCheck({ attempt, result: TailnetStatusSchema.parse(ack.result) });
      } catch {
        if (active)
          setCheck((previous) => ({
            attempt,
            result:
              previous?.result.kind === "desktop"
                ? { ...previous.result, state: "unavailable", url: undefined }
                : { kind: "unavailable" },
          }));
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, [session, props.connected, attempt]);

  async function copyUrl(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function checkAgain() {
    setAttempt((current) => current + 1);
  }

  if (
    result?.kind === "desktop" ||
    result?.kind === "desktop-remote" ||
    process.env.NEXT_PUBLIC_ROOMKIT_DESKTOP === "1"
  )
    return (
      <RowSection sectionId="tailscale" title={t("tailnet.title")}>
        {result?.kind === "desktop" ? (
          <DesktopTailnetSettings
            status={result}
            checking={check?.attempt !== attempt}
            connected={props.connected}
            onCheck={checkAgain}
            onResult={(status) => setCheck({ attempt, result: status })}
          />
        ) : result?.kind === "desktop-remote" ? (
          <p className="py-3">{t("tailnet.manageOnMac")}</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <output>{message}</output>
            <RowButton
              disabled={!props.connected || !status}
              onClick={checkAgain}
            >
              {t("tailnet.checkAgain")}
            </RowButton>
          </div>
        )}
      </RowSection>
    );

  return (
    <RowSection sectionId="tailscale" title={t("tailnet.title")}>
      <div className="flex flex-col gap-y-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <output>{message}</output>
          <RowButton
            disabled={!props.connected || !status}
            onClick={checkAgain}
          >
            {t("tailnet.checkAgain")}
          </RowButton>
        </div>
        {url && (
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
        )}
        <output className={copied === undefined ? "sr-only" : undefined}>
          {copied === undefined
            ? undefined
            : t(copied ? "tailnet.urlCopied" : "tailnet.copyUrlManually")}
        </output>
        <details className="border-line border-t pt-3">
          <summary className="cursor-pointer">
            {t("tailnet.otherDeviceSetup")}
          </summary>
          <ol className="flex list-decimal flex-col gap-y-3 ps-6 pt-3 text-ink-dim">
            <li>
              {renderMessageParts({
                message: t("tailnet.installCommandHint"),
                parts: {
                  tailscale: (
                    <a
                      className="underline"
                      href="https://tailscale.com/download"
                    >
                      Tailscale
                    </a>
                  ),
                  command: <code>tailscale</code>,
                },
              })}
            </li>
            <li>
              {renderMessageParts({
                message: t("tailnet.dnsSetup"),
                parts: {
                  magicDns: (
                    <a
                      className="underline"
                      href="https://tailscale.com/docs/features/magicdns"
                    >
                      MagicDNS
                    </a>
                  ),
                  httpsCertificates: (
                    <a
                      className="underline"
                      href="https://tailscale.com/docs/how-to/set-up-https-certificates"
                    >
                      {t("tailnet.dnsCertificateLabel")}
                    </a>
                  ),
                },
              })}
            </li>
            <li>
              {renderMessageParts({
                message: t(
                  status && "host" in status
                    ? "tailnet.stopToConfigure"
                    : "tailnet.stopToConfigureWithHost",
                ),
                parts: {
                  shortcut: "Ctrl+C",
                  login: <code>you@example.com</code>,
                },
              })}{" "}
              {t("tailnet.restartDaemon")}
              <pre className="overflow-x-auto whitespace-pre-wrap break-all border border-line p-2">{`PLANNER_WEB_ORIGIN='http://localhost:3210,http://127.0.0.1:3210,https://${host}' \\\nPLANNER_ALLOWED_HOSTS='${host}' \\\nPLANNER_TAILNET_LOGINS='you@example.com' pnpm daemon`}</pre>
            </li>
            <li>
              {t("tailnet.restartWebApp")}
              <pre className="overflow-x-auto whitespace-pre-wrap break-all border border-line p-2">{`PLANNER_ALLOWED_HOSTS='${host}' pnpm web`}</pre>
            </li>
            <li>
              {t("tailnet.startServe")}
              <pre className="overflow-x-auto whitespace-pre-wrap break-all border border-line p-2">
                sh scripts/tailnet-serve.sh
              </pre>
            </li>
            <li>
              {renderMessageParts({
                message: t("tailnet.connectFromAnotherDevice"),
                parts: {
                  checkAgain: <strong>{t("tailnet.checkAgain")}</strong>,
                },
              })}
            </li>
          </ol>
          <p className="pt-3 text-ink-dim">
            {renderMessageParts({
              message: t("tailnet.stopRemoteAccess"),
              parts: { command: <code>sh scripts/tailnet-serve.sh off</code> },
            })}
          </p>
        </details>
      </div>
    </RowSection>
  );
}
