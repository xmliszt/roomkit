import { animate, hover, stagger, useAnimate } from "motion/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const reveal = { duration: 0.28, ease: [0.23, 1, 0.32, 1] };
const lift = { opacity: [0, 1], y: [6, 0] };
const chapterCues = {
  "capture-photos": [
    [".photo-strip img", lift, { ...reveal, delay: stagger(0.075) }],
  ],
  "reference-furniture": [
    [".reference-photo", lift, { ...reveal, at: 0 }],
    [".demo-prompt", lift, { ...reveal, at: 0.14 }],
    [".demo-response", lift, { ...reveal, at: 0.4 }],
  ],
};
const shotFade = [[".shot", { opacity: [0.8, 1] }, reveal]];
const globeTurn = { duration: 0.56, ease: [0.32, 0, 0.24, 1] };
const signalTravel = { duration: 2.45, ease: "linear" };
const signalVisibility = 0.45;
const iconTransition = { type: "spring", duration: 0.3, bounce: 0 };
const footerVisibility = 0.2;
const footerLetterStaggerSeconds = 0.06;
const footerLetterSpring = { type: "spring", stiffness: 190, damping: 22 };

function subscribeToMotionPreference(callback) {
  motionPreference.addEventListener("change", callback);
  return () => motionPreference.removeEventListener("change", callback);
}

function observeChapterMotion(animate) {
  const panels = document.querySelector("#chapter-panels");
  let playback;

  function finishChapter() {
    playback?.complete();
    playback = undefined;
  }

  function playChapter() {
    finishChapter();
    const chapter = panels.querySelector(".chapter[data-motion]");
    if (!chapter || chapter.id === "render-room") return;
    const cues = chapterCues[chapter.id] ?? shotFade;
    playback = animate(
      cues.map(([selector, keyframes, transition]) => [
        chapter.querySelectorAll(selector),
        keyframes,
        transition,
      ]),
    );
  }

  const observer = new MutationObserver(playChapter);
  observer.observe(panels, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  playChapter();
  return () => {
    observer.disconnect();
    finishChapter();
  };
}

function observeGlobeHover(spinCurrentHover) {
  const summary = document.querySelector(".language-switcher summary");
  const globe = summary.querySelector(".language-globe");
  const canHover = matchMedia("(hover: hover)");
  let playback;
  function spin() {
    if (!canHover.matches || playback?.state === "running") return;
    playback = animate(
      globe,
      { "--globe-turn": ["0deg", "360deg"] },
      globeTurn,
    );
  }

  const stopHover = hover(summary, spin);
  if (spinCurrentHover && summary.matches(":hover")) spin();
  return () => {
    stopHover();
    playback?.cancel();
    globe.style.removeProperty("--globe-turn");
  };
}

function observeRemoteSignal() {
  const diagram = document.querySelector(".device-diagram");
  const path = diagram.querySelector("svg path");
  let playback;
  function stopSignal() {
    playback?.cancel();
    playback = undefined;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      if (entry.intersectionRatio < signalVisibility) {
        stopSignal();
        return;
      }
      if (playback) return;
      playback = animate(
        path,
        { strokeDashoffset: [104, 0], opacity: [0, 1, 1, 0] },
        {
          ...signalTravel,
          opacity: { ...signalTravel, times: [0, 0.12, 0.76, 1] },
        },
      );
    },
    { threshold: signalVisibility },
  );
  observer.observe(diagram);
  return () => {
    observer.disconnect();
    stopSignal();
  };
}

function observeCopyFeedback() {
  const buttons = document.querySelectorAll(".copy-button");
  const playbacks = new Map();
  const observer = new MutationObserver((records) => {
    for (const button of new Set(records.map(({ target }) => target))) {
      const end = Number(button.hasAttribute("data-copied"));
      const current = button.style.getPropertyValue("--copy-progress");
      const start = current === "" ? 1 - end : Number(current);
      playbacks.get(button)?.stop();
      button.style.setProperty("--copy-progress", String(start));
      playbacks.set(
        button,
        animate(start, end, {
          ...iconTransition,
          onUpdate: (progress) => {
            button.style.setProperty("--copy-progress", String(progress));
          },
        }),
      );
    }
  });
  for (const button of buttons) {
    observer.observe(button, {
      attributes: true,
      attributeFilter: ["data-copied"],
    });
  }
  return () => {
    observer.disconnect();
    for (const [button, playback] of playbacks) {
      playback.stop();
      button.style.removeProperty("--copy-progress");
    }
  };
}

function observeFooterWordmark() {
  const wordmark = document.querySelector(".footer-wordmark");
  const letters = wordmark.querySelectorAll(".footer-wordmark-text > span");
  let playbacks = [];

  function resetReveal() {
    for (const playback of playbacks) playback.stop();
    playbacks = [];
    for (const letter of letters) {
      letter.style.removeProperty("--footer-letter-progress");
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1);
      if (!entry || motionPreference.matches) return;
      if (!entry.isIntersecting) {
        resetReveal();
        return;
      }
      if (playbacks.length || entry.intersectionRatio < footerVisibility)
        return;

      playbacks = Array.from(letters, (letter, index) =>
        animate(0, 1, {
          ...footerLetterSpring,
          delay: index * footerLetterStaggerSeconds,
          onUpdate(progress) {
            letter.style.setProperty(
              "--footer-letter-progress",
              String(progress),
            );
          },
        }),
      );
    },
    { threshold: [0, footerVisibility] },
  );
  wordmark.dataset.reveal = "";
  observer.observe(wordmark);

  return () => {
    observer.disconnect();
    resetReveal();
    delete wordmark.dataset.reveal;
  };
}

function LandingMotion() {
  const [scope, animateChapter] = useAnimate();
  const initialized = useRef(false);
  const reduced = useSyncExternalStore(
    subscribeToMotionPreference,
    () => motionPreference.matches,
  );

  useEffect(() => {
    const isFirstAttachment = !initialized.current;
    initialized.current = true;
    if (reduced) return;
    const stop = [
      observeChapterMotion(animateChapter),
      observeGlobeHover(isFirstAttachment),
      observeRemoteSignal(),
      observeCopyFeedback(),
      observeFooterWordmark(),
    ];
    return () => {
      for (const cleanup of stop) cleanup();
    };
  }, [animateChapter, reduced]);

  return <span ref={scope} />;
}

export function mountLandingMotion() {
  createRoot(document.getElementById("landing-motion")).render(
    <LandingMotion />,
  );
}
