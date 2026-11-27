import { Color } from "three";

const whiteBalanceShare = 0.5;

function toByteShare(value: number) {
  return Math.min(255, Math.max(0, value)) / 255;
}

/** Return the colour of a black body at `temperatureK` (Tanner Helland's fit), mixed halfway to white. */
export function getLightColor(temperatureK: number) {
  const t = temperatureK / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue =
    t >= 66
      ? 255
      : t <= 19
        ? 0
        : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new Color(1, 1, 1).lerp(
    new Color().setRGB(
      toByteShare(red),
      toByteShare(green),
      toByteShare(blue),
      "srgb",
    ),
    whiteBalanceShare,
  );
}
