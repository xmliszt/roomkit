import { useEffect, useState } from "react";

const storageKey = "planner:object-labels";

export function useObjectLabels() {
  const [labelsShown, setLabelsShown] = useState<boolean>();

  useEffect(() => {
    try {
      setLabelsShown(window.localStorage.getItem(storageKey) === "true");
    } catch {
      setLabelsShown(false);
    }
  }, []);

  useEffect(() => {
    if (labelsShown === undefined) return;
    try {
      window.localStorage.setItem(storageKey, String(labelsShown));
    } catch {
      return;
    }
  }, [labelsShown]);

  return { labelsShown: labelsShown ?? false, setLabelsShown };
}
