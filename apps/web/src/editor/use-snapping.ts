import { useEffect, useState } from "react";

const storageKey = "planner:snapping";

export function useSnapping() {
  const [snapping, setSnapping] = useState<boolean>();

  useEffect(() => {
    try {
      setSnapping(window.localStorage.getItem(storageKey) !== "false");
    } catch {
      setSnapping(true);
    }
  }, []);

  useEffect(() => {
    if (snapping === undefined) return;
    try {
      window.localStorage.setItem(storageKey, String(snapping));
    } catch {
      return;
    }
  }, [snapping]);

  return { snapping: snapping ?? true, setSnapping };
}
