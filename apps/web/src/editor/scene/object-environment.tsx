import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { createSurfaceEnvironment } from "./create-surface-environment.ts";

type ObjectEnvironmentProps = { intensity: number };

/** Set the scene's environment map at `intensity`, which models without their own `envMap` reflect, and restore the previous map and intensity on unmount. */
export function ObjectEnvironment(props: ObjectEnvironmentProps) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const environment = createSurfaceEnvironment();
    const previous = scene.environment;
    scene.environment = environment;
    invalidate();
    return () => {
      scene.environment = previous;
      environment.dispose();
      invalidate();
    };
  }, [scene, invalidate]);
  useEffect(() => {
    const previous = scene.environmentIntensity;
    scene.environmentIntensity = props.intensity;
    invalidate();
    return () => {
      scene.environmentIntensity = previous;
      invalidate();
    };
  }, [scene, invalidate, props.intensity]);
  return null;
}
