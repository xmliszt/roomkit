import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Config,
  ConfigSchema,
} from "@planner/shared/src/config/config-schema.ts";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { isMissingPathError } from "../util/is-missing-path-error.ts";
import { writeJson } from "../util/write-json.ts";

export function createConfigStore(options: { plannerHome: string }) {
  const path = join(options.plannerHome, "config.json");
  mkdirSync(options.plannerHome, { recursive: true });
  function read() {
    try {
      return ConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const config = createDefaultConfig();
      writeJson({ path, value: config });
      return config;
    }
  }
  let config = read();
  return {
    get: () => config,
    update(roles: Config["roles"]) {
      const next = ConfigSchema.parse({ ...config, roles });
      writeJson({ path, value: next });
      config = next;
      return next;
    },
    setBlenderPath(blenderPath: string | undefined) {
      const next = ConfigSchema.parse({ ...config, blenderPath });
      writeJson({ path, value: next });
      config = next;
      return next;
    },
  };
}
