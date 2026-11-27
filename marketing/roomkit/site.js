if (document.querySelector("[data-release-version][hidden]")) {
  fetch("/release.json")
    .then((response) => (response.ok ? response.json() : undefined))
    .then((release) => {
      if (
        typeof release?.version !== "string" ||
        !/^\d+\.\d+\.\d+$/.test(release.version) ||
        typeof release.dmg !== "string" ||
        typeof release.checksum !== "string"
      )
        return;
      for (const download of document.querySelectorAll(".mac-download")) {
        download.href = release.dmg;
        const version = download.querySelector("[data-release-version]");
        version.textContent = release.version;
        version.hidden = false;
      }
      document.querySelector("[data-release-checksum]").href = release.checksum;
    })
    .catch(() => {});
}

const panels = document.querySelector("#chapter-panels");
const chapterLinks = Array.from(document.querySelectorAll("#chapter-list a"));
const chapters = Array.from(panels.querySelectorAll(".chapter"));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const languageSwitcher = document.querySelector(".language-switcher");
const languageLinks = languageSwitcher.querySelectorAll("a");
const siteHeader = document.querySelector(".site-header");
new ResizeObserver(() => {
  document.documentElement.style.setProperty(
    "--site-header-height",
    `${siteHeader.offsetHeight}px`,
  );
}).observe(siteHeader);

const demoStartupMs = 9000;
const durationsMs = [4100, 5800, 4700, 5100, 13200, 6700];

let current = 0;
let isVisible = false;
let isPinned = false;
let timer;
let demo;

function linkedId() {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return "";
  }
}

function updateLanguageLinks() {
  const hash = document.getElementById(linkedId()) ? location.hash : "";
  for (const link of languageLinks) {
    link.hash = hash;
  }
}

updateLanguageLinks();
window.addEventListener("hashchange", updateLanguageLinks);
languageSwitcher.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !languageSwitcher.open) return;
  event.preventDefault();
  languageSwitcher.open = false;
  languageSwitcher.querySelector("summary").focus();
});
document.addEventListener("click", (event) => {
  if (!languageSwitcher.contains(event.target)) languageSwitcher.open = false;
});

function stopChapter() {
  window.clearTimeout(timer);
  demo?.abort();
  demo = undefined;
  delete chapters[current].dataset.motion;
}

function startChapter() {
  if (!isVisible || document.hidden) return;
  const chapter = chapters[current];
  const viewport = chapter.querySelector("[data-room-demo]");
  const controller = new AbortController();
  demo = controller;
  if (!reducedMotion.matches) {
    requestAnimationFrame(() => {
      if (!controller.signal.aborted) chapter.dataset.motion = "";
    });
  }

  function scheduleAdvance() {
    if (controller.signal.aborted || reducedMotion.matches || isPinned) return;
    timer = window.setTimeout(
      () => showChapter((current + 1) % chapters.length),
      durationsMs[current],
    );
  }

  if (!viewport) {
    scheduleAdvance();
    return;
  }

  const startup = new AbortController();
  const deadline = window.setTimeout(() => {
    startup.abort();
    scheduleAdvance();
  }, demoStartupMs);
  controller.signal.addEventListener(
    "abort",
    () => {
      window.clearTimeout(deadline);
      startup.abort();
    },
    { once: true },
  );
  import("./room-workflow.js")
    .then(({ showRoomDemo }) =>
      showRoomDemo(viewport, chapter.id, reducedMotion.matches, startup.signal),
    )
    .catch(() => {})
    .finally(() => {
      window.clearTimeout(deadline);
      if (!startup.signal.aborted) scheduleAdvance();
    });
}

function showChapter(index) {
  stopChapter();
  current = index;
  chapters.forEach((chapter, chapterIndex) => {
    chapter.hidden = chapterIndex !== index;
    chapterLinks[chapterIndex].setAttribute(
      "aria-current",
      chapterIndex === index ? "step" : "false",
    );
  });
  startChapter();
}

chapterLinks.forEach((link, index) => {
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    isPinned = true;
    showChapter(index);
    history.replaceState(history.state, "", link.hash);
    updateLanguageLinks();
  });
});

function showLinkedChapter() {
  const id = linkedId();
  const index = chapters.findIndex((chapter) => chapter.id === id);
  if (index === -1) return false;
  isPinned = true;
  showChapter(index);
  return true;
}

window.addEventListener("hashchange", showLinkedChapter);
if (!showLinkedChapter()) showChapter(0);

const observer = new IntersectionObserver(
  ([entry]) => {
    const wasVisible = isVisible;
    isVisible = entry.intersectionRatio >= 0.22;
    if (isVisible && !wasVisible) startChapter();
    if (!isVisible && wasVisible) stopChapter();
  },
  { threshold: 0.22 },
);
observer.observe(panels);

const installFigure = document.querySelector(".install-dmg");
const installWindow = installFigure?.querySelector(".install-window");
if (installWindow) {
  const threshold = 0.95;
  const installObserver = new IntersectionObserver(
    (entries) => {
      installFigure.toggleAttribute(
        "data-playing",
        entries.at(-1).intersectionRatio >= threshold,
      );
    },
    { threshold },
  );
  installObserver.observe(installWindow);
}

function restartChapter() {
  stopChapter();
  startChapter();
}

document.addEventListener("visibilitychange", restartChapter);
reducedMotion.addEventListener("change", restartChapter);

const compare = document.querySelector(".compare-range");
const compareShot = compare.closest(".render-shot");
compare.closest(".compare-ui").hidden = false;
compareShot.dataset.compare = "";

function pinCompare() {
  isPinned = true;
  window.clearTimeout(timer);
}

compare.addEventListener("pointerdown", pinCompare);
compare.addEventListener("focus", pinCompare);
function updateCompare() {
  compareShot.style.setProperty("--split", `${compare.value}%`);
  compare.setAttribute(
    "aria-valuetext",
    compare.dataset.valueText
      .replace("{snapshot}", compare.value)
      .replace("{render}", String(100 - Number(compare.value))),
  );
}
updateCompare();
compare.addEventListener("input", updateCompare);

const otherAppsLink = document.querySelector("#open-other-apps");
const otherAppsDialog = document.querySelector("#other-apps");
otherAppsLink.addEventListener("click", (event) => {
  event.preventDefault();
  otherAppsLink.focus({ preventScroll: true });
  otherAppsDialog.showModal();
});
function isOnOtherAppsBackdrop(event) {
  if (event.target !== otherAppsDialog) return false;
  const { left, right, top, bottom } = otherAppsDialog.getBoundingClientRect();
  return (
    event.clientX < left ||
    event.clientX >= right ||
    event.clientY < top ||
    event.clientY >= bottom
  );
}

let isBackdropPress = false;
otherAppsDialog.addEventListener("pointerdown", (event) => {
  isBackdropPress = isOnOtherAppsBackdrop(event);
});
otherAppsDialog.addEventListener("click", (event) => {
  if (isBackdropPress && isOnOtherAppsBackdrop(event)) otherAppsDialog.close();
  isBackdropPress = false;
});

const copyFeedbackMs = 1600;
if (navigator.clipboard) {
  for (const code of document.querySelectorAll(".step-list pre code")) {
    const pre = code.parentElement;
    const copy = pre.closest(".step-list").dataset;
    const block = document.createElement("div");
    block.className = "command-block";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button copy-button";
    button.innerHTML = `<svg class="copy-icon" viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="9" height="9" rx="1"/><path d="M3 11V3h8"/></svg><svg class="copy-check" viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 9 3.5 3.5 7.5-7.5"/></svg>`;
    button.setAttribute(
      "aria-label",
      copy.copyLabel.replace(
        "{command}",
        () => code.textContent.split("\n")[0],
      ),
    );
    const status = document.createElement("output");
    status.className = "visually-hidden";
    let reset;
    let copyAttempt = 0;
    button.addEventListener("click", async () => {
      copyAttempt += 1;
      const attempt = copyAttempt;
      window.clearTimeout(reset);
      try {
        await navigator.clipboard.writeText(code.textContent);
        if (copyAttempt !== attempt) return;
        status.className = "visually-hidden";
        status.textContent = copy.copySuccess;
        if (!button.hasAttribute("data-copied")) button.dataset.copied = "";
        reset = window.setTimeout(() => {
          status.textContent = "";
          delete button.dataset.copied;
        }, copyFeedbackMs);
      } catch {
        if (copyAttempt !== attempt) return;
        delete button.dataset.copied;
        status.className = "copy-error";
        status.textContent = copy.copyFailure;
      }
    });
    pre.before(block);
    block.append(pre, button, status);
  }
}

import("./landing-motion.js")
  .then(({ mountLandingMotion }) => mountLandingMotion())
  .catch(() => {});

import("./room-preview.js")
  .then(({ mountRoomPreview }) =>
    mountRoomPreview(document.querySelector("#room-preview"), reducedMotion),
  )
  .catch(() => {});
