const stepRad = Math.PI / 12;

/** Return `startRad` turned by the pointer's sweep from `startAngleRad` to `angleRad`, in the range −π to π, snapped to 15° steps when `isSnapping`. */
export function getTurnedRotation(options: {
  startRad: number;
  startAngleRad: number;
  angleRad: number;
  isSnapping: boolean;
}) {
  const turned = options.startRad + options.angleRad - options.startAngleRad;
  const wrapped = Math.atan2(Math.sin(turned), Math.cos(turned));
  return options.isSnapping ? Math.round(wrapped / stepRad) * stepRad : wrapped;
}
