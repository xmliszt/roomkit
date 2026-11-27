export const sampleTourSteps = [
  {
    kind: "orbit",
    title: "editor.tour.orbit.title",
    description: "editor.tour.orbit.description",
    placement: "right",
  },
  {
    kind: "select",
    title: "editor.tour.select.title",
    description: "editor.tour.select.description",
    placement: "right",
  },
  {
    kind: "wall",
    title: "editor.tour.wall.title",
    description: "editor.tour.wall.description",
    placement: "below",
  },
  {
    kind: "lamp",
    title: "editor.tour.lamp.title",
    description: "editor.tour.lamp.description",
    placement: "right",
  },
  {
    kind: "add",
    title: "editor.tour.add.title",
    description: "editor.tour.add.description",
    placement: "below",
  },
  {
    kind: "chat",
    title: "editor.tour.chat.title",
    description: "editor.tour.chat.description",
    chairExercise: "editor.tour.chat.chair-exercise",
    roomExercise: "editor.tour.chat.room-exercise",
    placement: "left",
    tab: "chat",
  },
  {
    kind: "objects",
    title: "editor.tour.objects.title",
    description: "editor.tour.objects.description",
    placement: "left",
    tab: "objects",
  },
  {
    kind: "jobs",
    title: "editor.tour.jobs.title",
    description: "editor.tour.jobs.description",
    placement: "left",
    tab: "jobs",
  },
  {
    kind: "log",
    title: "editor.tour.log.title",
    description: "editor.tour.log.description",
    placement: "left",
    tab: "log",
  },
  {
    kind: "shortcuts",
    title: "editor.tour.shortcuts.title",
    description: "editor.tour.shortcuts.description",
    placement: "below",
  },
  {
    kind: "settings",
    title: "editor.tour.settings.title",
    description: "editor.tour.settings.description",
    placement: "below",
  },
] as const;

export type SampleTourStep = (typeof sampleTourSteps)[number];

export type SampleTourTarget =
  | Exclude<SampleTourStep["kind"], "orbit" | "lamp">
  | "tools"
  | "chat-toggle";
