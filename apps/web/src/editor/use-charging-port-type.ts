import type { CatalogEntry } from "@planner/shared/src/catalog/catalog-entry.ts";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { useEffect, useState } from "react";

export function useChargingPortType(projectId: string) {
  const storageKey = `planner:charging-port-type:${projectId}`;
  const [choice, setChoice] = useState<{ projectId: string; typeId: string }>();

  useEffect(() => {
    try {
      const storage = window.localStorage;
      const typeId = storage.getItem(storageKey);
      if (typeId !== null) setChoice({ projectId, typeId });
      function handleStorage(event: StorageEvent) {
        if (
          event.storageArea !== storage ||
          (event.key !== storageKey && event.key !== null)
        )
          return;
        setChoice({
          projectId,
          typeId: event.newValue ?? CHARGING_PORT.typeId,
        });
      }
      window.addEventListener("storage", handleStorage);
      return () => window.removeEventListener("storage", handleStorage);
    } catch {
      return;
    }
  }, [projectId, storageKey]);

  function remember(entry: CatalogEntry) {
    setChoice({ projectId, typeId: entry.typeId });
    try {
      localStorage.setItem(storageKey, entry.typeId);
    } catch {
      return;
    }
  }

  const entry =
    CHARGING_PORT_TYPES.find(
      (type) =>
        choice?.projectId === projectId && type.typeId === choice.typeId,
    ) ?? CHARGING_PORT;
  return { entry, remember };
}
