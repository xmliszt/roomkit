import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { renderMessageParts } from "../i18n/render-message-parts.tsx";
import { useMessages } from "../i18n/use-messages.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { FloatingPopover } from "../ui/floating-popover.tsx";
import type { SampleTourStep, SampleTourTarget } from "./sample-tour-steps.ts";

type SampleCoachmarkProps = {
  step: SampleTourStep;
  target: SampleTourTarget;
  stepNumber: number;
  stepCount: number;
  lamp: { on: boolean; onToggle: () => void } | undefined;
  chat:
    | { exerciseKey: string; setupHref: string; onFocusMessage: () => void }
    | undefined;
  onContinue: () => void;
  onDismiss: () => void;
};

export function SampleCoachmark(props: SampleCoachmarkProps) {
  const t = useMessages();
  const id = useId();
  const descriptionId = `${id}-description`;
  const section = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement>();
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-room-tour-target="${props.target}"]`,
    );
    setAnchor(target?.closest("aside") ?? target ?? undefined);
    if (!target || props.target === "tools") return;
    target.dataset.roomTourHighlight = "";
    return () => {
      delete target.dataset.roomTourHighlight;
    };
  }, [props.target]);
  useEffect(() => {
    if (anchor) section.current?.focus({ preventScroll: true });
  }, [anchor]);
  if (!anchor) return null;
  return (
    <FloatingPopover
      target={anchor}
      placement={
        props.target === "chat-toggle" ? "below" : props.step.placement
      }
      width={264}
    >
      <section
        ref={section}
        tabIndex={-1}
        aria-labelledby={id}
        aria-describedby={descriptionId}
        className="grid gap-y-2 rounded-panel border border-line bg-bg p-3 text-ink"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onDismiss();
          }
        }}
      >
        <div className="grid gap-y-1">
          <p className="text-ink-dim">
            {t("editor.tour.step-count", {
              step: props.stepNumber,
              count: props.stepCount,
            })}
          </p>
          <h2 id={id} className="type-panel-title">
            {t(props.step.title)}
          </h2>
          <div id={descriptionId} className="grid gap-y-1">
            <p>{t(props.step.description)}</p>
            {props.chat && <p>{t(props.chat.exerciseKey)}</p>}
          </div>
        </div>
        {props.lamp && (
          <div>
            <RowButton onClick={props.lamp.onToggle}>
              {props.lamp.on
                ? t("editor.sample-coachmark.turn-lamp-off")
                : t("editor.sample-coachmark.turn-lamp-on")}
            </RowButton>
          </div>
        )}
        {props.chat && (
          <div className="grid justify-items-start gap-y-2">
            <RowButton onClick={props.chat.onFocusMessage}>
              {t("editor.tour.chat.write-message")}
            </RowButton>
            <p className="text-ink-dim">
              {renderMessageParts({
                message: t("editor.tour.chat.setup-hint"),
                parts: {
                  setup: (
                    <Link
                      href={props.chat.setupHref}
                      className="underline underline-offset-2"
                    >
                      {t("editor.tour.chat.set-up-agent")}
                    </Link>
                  ),
                },
              })}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-x-2 gap-y-2">
          <RowButton onClick={props.onContinue}>
            {props.stepNumber < props.stepCount
              ? t("editor.sample-coachmark.next")
              : t("editor.sample-coachmark.done")}
          </RowButton>
          <RowButton onClick={props.onDismiss}>
            {t("editor.sample-coachmark.close-tour")}
          </RowButton>
        </div>
      </section>
    </FloatingPopover>
  );
}
