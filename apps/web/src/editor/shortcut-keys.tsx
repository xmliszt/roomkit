import {
  ArrowBigUp,
  Command,
  CornerDownLeft,
  Delete,
  type LucideIcon,
  Option,
} from "lucide-react";

type ModifierKey = "command" | "shift" | "option" | "enter" | "delete";

type ShortcutKeysProps = {
  keys: readonly (ModifierKey | { letter: string })[];
  className?: string;
};

const icons = {
  command: Command,
  shift: ArrowBigUp,
  option: Option,
  enter: CornerDownLeft,
  delete: Delete,
} satisfies { [key in ModifierKey]: LucideIcon };

export function ShortcutKeys(props: ShortcutKeysProps) {
  return (
    <kbd
      className={`inline-flex items-center font-mono text-ink-dim ${props.className ?? ""}`}
    >
      {props.keys.map((key) => {
        if (typeof key !== "string") {
          return <span key={key.letter}>{key.letter}</span>;
        }
        const Icon = icons[key];
        return (
          <Icon key={key} aria-hidden="true" size={12} strokeWidth={1.5} />
        );
      })}
    </kbd>
  );
}
