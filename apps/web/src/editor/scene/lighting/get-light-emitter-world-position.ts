import { type Matrix4, Vector3 } from "three";
import { getLightEmitterLocalPosition } from "./get-light-emitter-local-position.ts";

export function getLightEmitterWorldPosition(
  options: Parameters<typeof getLightEmitterLocalPosition>[0] & {
    matrixWorld: Matrix4;
  },
) {
  const local = getLightEmitterLocalPosition(options);
  return new Vector3(local.x, local.y, local.z).applyMatrix4(
    options.matrixWorld,
  );
}
