import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type FloatingPopoverProps = {
  children: ReactNode;
  placement: "below" | "right" | "above" | "left";
  target?: HTMLElement;
  width?: number;
};

export function FloatingPopover(props: FloatingPopoverProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number | undefined;
    visibility: "visible" | "hidden";
  }>();
  useLayoutEffect(() => {
    const parent = props.target ?? anchor.current?.parentElement;
    if (!parent) return;
    function update() {
      if (!parent) return;
      const bounds = parent.getBoundingClientRect();
      const width = Math.min(
        props.width ?? bounds.width,
        window.innerWidth - 8,
      );
      const placement = (() => {
        if (props.placement === "left" && bounds.left < width + 12)
          return "above";
        if (
          props.target &&
          props.placement === "right" &&
          bounds.right + width + 12 > window.innerWidth
        )
          return "below";
        return props.placement;
      })();
      const maxHeight =
        props.placement === "left" && placement === "above"
          ? Math.max(1, bounds.top - 10)
          : undefined;
      const height = Math.min(
        surface.current?.getBoundingClientRect().height ?? 0,
        maxHeight ?? Infinity,
      );
      const preferredTop =
        placement === "above"
          ? bounds.top - height - 6
          : placement === "right" || placement === "left"
            ? bounds.top
            : bounds.bottom + 4;
      const preferredLeft =
        placement === "right"
          ? bounds.right + 8
          : placement === "left"
            ? bounds.left - width - 8
            : bounds.left;
      const next = {
        left: Math.max(
          4,
          Math.min(preferredLeft, window.innerWidth - width - 4),
        ),
        top: Math.max(
          4,
          Math.min(preferredTop, window.innerHeight - height - 4),
        ),
        width,
        maxHeight,
        visibility:
          getComputedStyle(parent).visibility === "visible"
            ? "visible"
            : "hidden",
      } satisfies NonNullable<typeof position>;
      setPosition((current) =>
        current?.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight &&
        current.visibility === next.visibility
          ? current
          : next,
      );
      frameId = requestAnimationFrame(update);
    }
    let frameId = 0;
    update();
    return () => cancelAnimationFrame(frameId);
  }, [props.placement, props.target, props.width]);
  return (
    <>
      <span ref={anchor} data-floating-source={id} className="hidden" />
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={surface}
            data-floating-owner={id}
            className="fixed z-popover max-h-[calc(100dvh-8px)] overflow-y-auto"
            style={position}
          >
            {props.children}
          </div>,
          document.body,
        )}
    </>
  );
}
