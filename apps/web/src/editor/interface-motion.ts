import type { Transition } from "motion/react";

const easeOutQuint = [0.23, 1, 0.32, 1] as const;

export const composerTransition = {
  type: "spring",
  duration: 0.3,
  bounce: 0,
} satisfies Transition;

export const panelEnter = {
  duration: 0.2,
  ease: easeOutQuint,
} satisfies Transition;

export const panelExit = {
  duration: 0.12,
  ease: easeOutQuint,
} satisfies Transition;
