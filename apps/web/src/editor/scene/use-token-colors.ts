import { useState } from "react";

/** Return the `--bg`, `--ink`, `--accent` and `--danger` token values read once from the document's CSS variables. */
export function useTokenColors() {
  const [colors] = useState(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue("--bg").trim(),
      ink: style.getPropertyValue("--ink").trim(),
      accent: style.getPropertyValue("--accent").trim(),
      danger: style.getPropertyValue("--danger").trim(),
    };
  });
  return colors;
}
