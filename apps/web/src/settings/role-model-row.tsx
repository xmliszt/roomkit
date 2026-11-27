"use client";

import {
  type Config,
  type Role,
  RoleModelSchema,
} from "@planner/shared/src/config/config-schema.ts";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";

type RoleModelRowProps = {
  role: Role;
  value: Config["roles"][Role];
  disabled: boolean;
};

const roleLabels = {
  surveyor: "settings.modelRoleSurveyor",
  modeler: "settings.modelRoleModeler",
  designer: "settings.modelRoleDesigner",
};

export function RoleModelRow(props: RoleModelRowProps) {
  const t = useMessages();
  const role = t(roleLabels[props.role]);
  const modelId = useId();
  const session = usePlannerSession();
  const [cli, setCli] = useState(props.value.cli);
  const [models, setModels] = useState(() => ({
    claude: createDefaultConfig("claude").roles[props.role].model,
    codex: createDefaultConfig("codex").roles[props.role].model,
    [props.value.cli]: props.value.model,
  }));
  const model = models[cli];
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  function changeProvider(event: React.ChangeEvent<HTMLSelectElement>) {
    const provider = event.currentTarget.value;
    if (provider !== "claude" && provider !== "codex") return;
    setCli(provider);
    setSaved(false);
  }

  function changeModel(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.currentTarget.value;
    setModels((current) => ({ ...current, [cli]: value }));
    setSaved(false);
  }

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const config = session.stores.snapshot.getState().config;
    if (!config) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const value = RoleModelSchema.parse({ cli, model: model.trim() });
      const ack = await session.command({
        type: "config.update",
        roles: { ...config.roles, [props.role]: value },
      });
      if (!ack.ok) throw new Error(ack.error);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-y-2 border-line border-b py-2"
    >
      <div className="role-model-row grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,7rem)_84px_minmax(10rem,1fr)_max-content]">
        <label htmlFor={modelId} className="min-w-0 break-words">
          {role}
        </label>
        <span className="relative">
          <select
            aria-label={t("settings.roleCli", { role })}
            value={cli}
            disabled={props.disabled || isSaving}
            onChange={changeProvider}
            className="peer h-7 w-full appearance-none border border-line bg-bg ps-1 pe-6 forced-colors:appearance-auto"
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
          </select>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.5}
            className="pointer-events-none absolute end-2 top-1/2 size-3 -translate-y-1/2 peer-disabled:opacity-50 forced-colors:hidden"
          />
        </span>
        <input
          id={modelId}
          required
          value={model}
          disabled={props.disabled || isSaving}
          onChange={changeModel}
          className="h-7 min-w-0 flex-1 border border-line bg-transparent px-2"
        />
        <RowButton
          type="submit"
          disabled={props.disabled || isSaving || !model.trim()}
          label={t("settings.saveRoleModel", { role })}
        >
          {isSaving
            ? t("settings.saving")
            : saved
              ? t("settings.saved")
              : t("settings.save")}
        </RowButton>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {t("settings.actionFailed", { detail: error })}
        </p>
      )}
    </form>
  );
}
