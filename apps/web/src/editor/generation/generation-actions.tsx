import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { useId, useRef, useState } from "react";
import { AssetPreview } from "../../chat/asset-preview.tsx";
import { formatDecimal } from "../../i18n/format-decimal.ts";
import { useLocale } from "../../i18n/use-locale.ts";
import { useMessages } from "../../i18n/use-messages.ts";
import { RejectedModelThumbnail } from "../../jobs/rejected-model-thumbnail.tsx";
import type { GenerationAction } from "./generation-action.ts";

type GenerationActionsProps = {
  projectId: string;
  designerBusy: boolean;
  state: "held" | "running" | "failed" | "ready";
  alternatives: Extract<ChatBlock, { kind: "asset" }>[];
  alternativesRunning: boolean;
  errors: {
    jobId: string;
    text: string | undefined;
    hasRejectedModel: boolean;
  }[];
  onRequest: (action: GenerationAction) => Promise<void>;
};

const buttonClass =
  "press min-h-7 rounded-panel border border-line px-2.5 text-left hover:border-line-strong disabled:text-ink-dim";

function focusNotes(element: HTMLTextAreaElement | null) {
  element?.focus();
}

export function GenerationActions(props: GenerationActionsProps) {
  const t = useMessages();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<"closed" | "color" | "shape" | "regenerate">(
    "closed",
  );
  const [notes, setNotes] = useState("");
  const notesId = useId();
  const regenerateButton = useRef<HTMLButtonElement>(null);
  const [color, setColor] = useState("#9A7654");
  const [prompt, setPrompt] = useState("");
  async function request(action: GenerationAction) {
    setBusy(true);
    setError(undefined);
    try {
      await props.onRequest(action);
      if (action.kind === "regenerate") setNotes("");
      setForm("closed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }
  function submitVariant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form === "color") void request({ kind: "color-variant", color });
    else if (form === "shape" && prompt.trim())
      void request({ kind: "shape-variant", prompt: prompt.trim() });
  }
  function closeRegeneration() {
    setForm("closed");
    regenerateButton.current?.focus();
  }
  function submitRegeneration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void request({ kind: "regenerate", notes: notes.trim() });
  }
  function handleRegenerationKeyDown(
    event: React.KeyboardEvent<HTMLFormElement>,
  ) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeRegeneration();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap gap-x-2 gap-y-2">
        {props.state === "held" && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void request({ kind: "start" })}
          >
            {t("editor.generation-actions.model-this")}
          </button>
        )}
        {props.state === "failed" && (
          <button
            type="button"
            className={`${buttonClass} text-danger`}
            disabled={busy}
            onClick={() => void request({ kind: "retry" })}
          >
            {t("editor.generation-actions.retry")}
          </button>
        )}
        {props.state === "ready" && (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={busy || props.alternativesRunning}
              onClick={() => void request({ kind: "alternatives" })}
            >
              {t("editor.generation-actions.try-another-version")}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy || props.designerBusy}
              aria-expanded={form === "color" || form === "shape"}
              onClick={() =>
                setForm((current) =>
                  current === "color" || current === "shape"
                    ? "closed"
                    : "color",
                )
              }
            >
              {t("editor.generation-actions.variant")}
            </button>
          </>
        )}
        {(props.state === "ready" || props.state === "failed") && (
          <button
            ref={regenerateButton}
            type="button"
            className={buttonClass}
            disabled={busy}
            aria-expanded={form === "regenerate"}
            aria-controls={notesId}
            onClick={() =>
              setForm((current) =>
                current === "regenerate" ? "closed" : "regenerate",
              )
            }
          >
            {t("editor.generation-actions.regenerate")}
          </button>
        )}
      </div>
      {form === "regenerate" &&
        (props.state === "ready" || props.state === "failed") && (
          <form
            id={notesId}
            onSubmit={submitRegeneration}
            onKeyDown={handleRegenerationKeyDown}
            className="flex flex-col gap-y-2 border border-line p-2"
          >
            <label className="flex flex-col gap-y-1">
              {t("editor.generation-actions.what-should-change")}{" "}
              <textarea
                ref={focusNotes}
                value={notes}
                onChange={(event) => setNotes(event.currentTarget.value)}
                maxLength={1000}
                rows={3}
                disabled={busy}
                className="min-h-16 resize-y border border-line bg-bg p-1"
              />
            </label>
            <div className="flex gap-x-2">
              <button type="submit" disabled={busy} className={buttonClass}>
                {t("editor.generation-actions.regenerate")}
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonClass}
                onClick={closeRegeneration}
              >
                {t("editor.generation-actions.cancel")}
              </button>
            </div>
          </form>
        )}
      {(form === "color" || form === "shape") && (
        <form
          onSubmit={submitVariant}
          className="flex flex-col gap-y-2 border border-line p-2"
        >
          <label className="aligned-row">
            <span className="truncate">
              {t("editor.generation-actions.variant-2")}
            </span>
            <select
              aria-label={t("editor.generation-actions.variant-type")}
              value={form}
              onChange={(event) =>
                setForm(
                  event.currentTarget.value === "shape" ? "shape" : "color",
                )
              }
              className="border border-line bg-bg p-1"
              disabled={busy}
            >
              <option value="color">
                {t("editor.generation-actions.colour")}
              </option>
              <option value="shape">
                {t("editor.generation-actions.shape")}
              </option>
            </select>
          </label>
          {form === "color" ? (
            <label className="aligned-row">
              <span className="truncate">
                {t("editor.generation-actions.colour")}
              </span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.currentTarget.value)}
                disabled={busy}
                className="h-7 w-12 border border-line"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-y-1">
              {t("editor.generation-actions.describe-the-change")}{" "}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                required
                disabled={busy}
                className="min-h-16 resize-y border border-line bg-bg p-1"
              />
            </label>
          )}
          <div className="flex gap-x-2">
            <button
              type="submit"
              disabled={
                busy ||
                props.designerBusy ||
                (form === "shape" && !prompt.trim())
              }
              className={buttonClass}
            >
              {t("editor.generation-actions.create-variant")}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setForm("closed")}
            >
              {t("editor.generation-actions.cancel")}
            </button>
          </div>
        </form>
      )}
      {props.alternativesRunning && (
        <output className="text-ink-dim">
          {t("editor.generation-actions.creating-versions")}
        </output>
      )}
      {props.errors.map((error) => (
        <div key={error.jobId} className="flex min-w-0 items-center gap-x-2">
          {error.hasRejectedModel && (
            <RejectedModelThumbnail
              projectId={props.projectId}
              jobId={error.jobId}
            />
          )}
          <p role="alert" className="min-w-0 text-danger">
            {error.text ?? t("editor.generation-actions.version-failed")}
          </p>
        </div>
      ))}
      {props.alternatives.length > 0 && (
        <fieldset
          className="flex min-w-0 flex-col gap-y-2 border border-line p-2"
          disabled={busy}
        >
          <legend className="px-1 text-ink-dim">
            {t("editor.generation-actions.keep-a-version")}
          </legend>
          {props.alternatives.map((asset) => (
            <div
              key={asset.assetId}
              className="flex min-w-0 items-center gap-x-2"
            >
              <AssetPreview
                projectId={props.projectId}
                assetId={asset.assetId}
                sizeM={asset.sizeM}
              />
              <div className="flex min-w-0 flex-col gap-y-1">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() =>
                    void request({ kind: "keep", assetId: asset.assetId })
                  }
                >
                  {t("editor.generation-actions.keep")} {asset.name}
                </button>
                {(asset.sizeMismatches ?? []).map((mismatch) => (
                  <p key={mismatch.axis} className="text-ink-dim">
                    {t("editor.generation-actions.size-mismatch", {
                      axis: t(`editor.measurement.${mismatch.axis}`),
                      actual: formatDecimal({
                        value: mismatch.actualM,
                        locale,
                      }),
                      expected: formatDecimal({
                        value: mismatch.expectedM,
                        locale,
                      }),
                    })}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}
      {props.state === "running" && (
        <output className="text-ink-dim">
          {t("editor.generation-actions.generating")}
        </output>
      )}
      {busy && (
        <output className="text-ink-dim">
          {t("editor.generation-actions.starting")}
        </output>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
