import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { formatDecimal } from "../i18n/format-decimal.ts";
import type { MessageTranslator } from "../i18n/message-translator.ts";

type SceneChange = Extract<ChatBlock, { kind: "diff" }>["changes"][number];

const fieldLabels: { [field: string]: string } = {
  alongM: "editor.inspector-body.along",
  ceilingHeightM: "projects.ceilingHeight",
  cutsOpening: "editor.inspector-body.cut-opening-in-wall",
  depth: "editor.measurement.depth",
  elevationM: "editor.inspector-body.elevation",
  height: "editor.measurement.height",
  heightM: "editor.inspector-body.above-floor",
  locked: "editor.inspector-body.locked",
  mirrored: "editor.inspector-body.mirror-2",
  name: "projects.name",
  rotationRad: "editor.inspector-body.rotation",
  width: "editor.measurement.width",
  "colorAdjust color": "editor.color-controls.colour",
  "colorAdjust hueShiftDeg": "editor.color-controls.hue",
  "colorAdjust lightness": "editor.color-controls.lightness",
  "colorAdjust saturation": "editor.color-controls.saturation",
  "colorAdjust strength": "editor.color-controls.strength",
  "light beam angleDeg": "editor.light-controls.beam-angle",
  "light lumens": "editor.light-controls.brightness",
  "light on": "editor.light-controls.on",
  "light shade": "editor.light-controls.shade",
  "light temperatureK": "editor.light-controls.warmth",
};

const booleanFields = new Set([
  "cutsOpening",
  "locked",
  "mirrored",
  "light on",
]);
const surfaceFields: { [field: string]: string } = {
  color: "editor.color-controls.colour",
  "material baseColor": "editor.color-controls.colour",
  "material color": "editor.surface-controls.paint-colour",
  "material finish": "editor.surface-controls.finish",
  "material groutColor": "editor.surface-controls.grout-colour",
  "material kind": "editor.surface-controls.material",
  "material roughness": "editor.surface-controls.roughness",
};
const surfaceValues: { [value: string]: string } = {
  eggshell: "editor.surface-controls.eggshell",
  matte: "editor.surface-controls.matte",
  paint: "editor.surface-controls.paint",
  planks: "editor.surface-controls.planks",
  satin: "editor.surface-controls.satin",
  texture: "editor.surface-controls.wallpaper-texture",
  tiles: "editor.surface-controls.tiles",
};

export function formatSceneChange(options: {
  change: SceneChange;
  locale: string;
  t: MessageTranslator;
}) {
  const { change, locale, t } = options;
  const separator = change.label.lastIndexOf(" · ");
  if (separator < 0) return change;
  const owner = change.label.slice(0, separator);
  const field = change.label.slice(separator + 3);
  const surface = owner === "room" ? /^surfaces (\S+) (.+)$/.exec(field) : null;
  const surfaceId = surface?.[1];
  const surfaceField = surface?.[2];
  const fieldKey =
    surfaceField && Object.hasOwn(surfaceFields, surfaceField)
      ? surfaceFields[surfaceField]
      : Object.hasOwn(fieldLabels, field)
        ? fieldLabels[field]
        : undefined;
  const cameraAxis =
    owner === "camera" ? /^(positionM|targetM) ([xyz])$/.exec(field) : null;
  if (!fieldKey && !cameraAxis && field !== "xM" && field !== "zM")
    return change;

  const labelOwner = (() => {
    if (owner === "room" && field === "ceilingHeightM")
      return t("editor.room-panel.room");
    if (cameraAxis) return t("chat.diff-block.camera");
    if (surfaceId === "ceiling" || surfaceId === "floor")
      return t(`editor.room-panel.${surfaceId}`);
    const wallIndex = /^wall-(\d+)$/.exec(surfaceId ?? "")?.[1];
    if (wallIndex)
      return t("editor.room-panel.wall-number-title", {
        number: Number(wallIndex),
      });
    if (surfaceId) return surfaceId;
    return owner;
  })();
  const labelField = cameraAxis
    ? t(
        cameraAxis[1] === "positionM"
          ? "chat.diff-block.camera-position"
          : "chat.diff-block.camera-target",
        { axis: cameraAxis[2]?.toUpperCase() ?? "" },
      )
    : fieldKey
      ? t(fieldKey)
      : field.slice(0, 1).toUpperCase();

  function formatValue(value: string) {
    if (field === "name") return value;
    if (booleanFields.has(field)) {
      if (value === "true") return t("chat.diff-block.yes");
      if (value === "false") return t("chat.diff-block.no");
    }
    if (
      (surfaceField === "material kind" ||
        surfaceField === "material finish") &&
      Object.hasOwn(surfaceValues, value) &&
      surfaceValues[value]
    )
      return t(surfaceValues[value]);
    if (
      field === "light shade" &&
      (value === "opaque" || value === "translucent")
    )
      return t(`editor.light-controls.${value}`);
    const number = /^(-?\d+)(\.\d{1,3})?( m|°)?$/.exec(value);
    if (!number) return value;
    return (
      formatDecimal({
        value: Number(`${number[1]}${number[2] ?? ""}`),
        locale,
        digits: (number[2]?.length ?? 1) - 1,
      }) + (number[3] ?? "")
    );
  }

  return {
    label: `\u2068${labelOwner}\u2069 · ${labelField}`,
    before: formatValue(change.before),
    after: formatValue(change.after),
  };
}
