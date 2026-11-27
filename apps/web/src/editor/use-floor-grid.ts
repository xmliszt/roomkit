import { useEffect, useState } from "react";

const storageKey = "planner:floor-grid";

export function useFloorGrid() {
  const [gridShown, setGridShown] = useState<boolean>();

  useEffect(() => {
    try {
      setGridShown(window.localStorage.getItem(storageKey) !== "false");
    } catch {
      setGridShown(true);
    }
  }, []);

  useEffect(() => {
    if (gridShown === undefined) return;
    try {
      window.localStorage.setItem(storageKey, String(gridShown));
    } catch {
      return;
    }
  }, [gridShown]);

  return { gridShown: gridShown ?? true, setGridShown };
}
