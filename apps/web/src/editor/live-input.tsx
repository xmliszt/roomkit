import { type ComponentProps, useEffect, useRef } from "react";

type LiveInputProps = Omit<
  ComponentProps<"input">,
  "ref" | "onChange" | "onInput" | "value"
> & {
  value: string;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
};

export function LiveInput(props: LiveInputProps) {
  const { value, onLive, onCommit, ...rest } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    function handleChange() {
      if (input !== null) onCommitRef.current(input.value);
    }
    input.addEventListener("change", handleChange);
    return () => input.removeEventListener("change", handleChange);
  }, []);

  return (
    <input
      {...rest}
      ref={inputRef}
      value={value}
      onChange={(event) => onLive(event.currentTarget.value)}
    />
  );
}
