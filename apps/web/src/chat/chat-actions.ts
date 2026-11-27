import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";

export type ChatActions = {
  projectId: string;
  scene: Scene;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
  onSelect: (itemId: string) => void;
  onHover: (itemId: string | undefined) => void;
  onFocus: (itemId: string) => void;
  onAttach: () => void;
  onApply: (command: Command) => boolean;
};
