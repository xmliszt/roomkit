import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { createGenerationPoints } from "./create-generation-points.ts";

type GeneratingPointsProps = { item: Item; progress: number; accent: string };

export function GeneratingPoints(props: GeneratingPointsProps) {
  const points = useMemo(
    () =>
      createGenerationPoints({
        placementKind: props.item.placement.kind,
        sizeM: props.item.sizeM,
        accent: props.accent,
      }),
    [props.item.placement.kind, props.item.sizeM, props.accent],
  );
  useEffect(
    () => () => {
      points.geometry.dispose();
      points.material.dispose();
    },
    [points],
  );
  useFrame((state) => {
    const uniforms = points.material.uniforms;
    if (uniforms.uProg) uniforms.uProg.value = 0.02 + 1.25 * props.progress;
    if (uniforms.uTime) uniforms.uTime.value = state.clock.elapsedTime;
    if (uniforms.uDpr) uniforms.uDpr.value = state.gl.getPixelRatio();
    state.invalidate();
  });
  return <primitive object={points} />;
}
