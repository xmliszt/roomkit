import type { ReactNode } from "react";

type RowButtonProps = {
  children: ReactNode;
  type?: "button" | "submit";
  danger?: boolean;
  disabled?: boolean;
  label?: string;
  onClick?: () => void;
};

export function RowButton(props: RowButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      aria-label={props.label}
      onClick={props.onClick}
      className={`press h-7 flex-none whitespace-nowrap rounded-panel border px-2.5 disabled:opacity-50 ${
        props.danger
          ? "border-danger text-danger"
          : "border-line hover:border-line-strong"
      }`}
    >
      {props.children}
    </button>
  );
}
