import type { SurfaceMaterial } from "@planner/shared/src/scene/surface-material-schema.ts";
import { useThree } from "@react-three/fiber";
import { useContext, useEffect, useMemo } from "react";
import { Color, type Side, type Texture } from "three";
import { createSurfaceMaterial } from "./create-surface-material.ts";
import type { createSurfaceTextureCache } from "./create-surface-texture-cache.ts";
import { SceneLitContext } from "./lighting/scene-lit-context.ts";
import { useSurfaceTextures } from "./use-surface-textures.ts";

type SurfaceFillProps = {
  projectId: string;
  textureCache: ReturnType<typeof createSurfaceTextureCache>;
  uDirection: 1 | -1;
  color: string;
  material: SurfaceMaterial | undefined;
  environment: Texture;
  side: Side;
};

export function SurfaceFill(props: SurfaceFillProps) {
  const isLit = useContext(SceneLitContext);
  const material = useMemo(
    (): SurfaceMaterial | undefined =>
      props.material ??
      (isLit
        ? { kind: "paint", color: props.color, finish: "matte" }
        : undefined),
    [props.material, isLit, props.color],
  );
  return material ? (
    <TexturedFill
      key={`${props.projectId}/${material.kind === "paint" ? "" : (material.textureAssetId ?? "")}`}
      {...props}
      material={material}
    />
  ) : (
    <meshBasicMaterial
      color={props.color}
      side={props.side}
      polygonOffset
      polygonOffsetFactor={1}
      polygonOffsetUnits={1}
    />
  );
}

function TexturedFill(props: SurfaceFillProps & { material: SurfaceMaterial }) {
  const invalidate = useThree((state) => state.invalidate);
  const created = useMemo(
    () =>
      createSurfaceMaterial({
        material: props.material,
        color: props.color,
        environment: props.environment,
      }),
    [props.material, props.color, props.environment],
  );
  const textureAssetId =
    props.material.kind === "paint" ? undefined : props.material.textureAssetId;
  const textures = useSurfaceTextures({
    cache: props.textureCache,
    projectId: props.projectId,
    assetId: textureAssetId,
  });
  useEffect(() => () => created.material.dispose(), [created]);
  useEffect(() => {
    const material = created.material;
    material.side = props.side;
    material.map = textures?.map ?? null;
    material.normalMap = textures?.normalMap ?? null;
    material.roughnessMap = textures?.roughnessMap ?? null;
    for (const texture of Object.values(textures ?? {}))
      texture?.repeat.set(
        props.uDirection / created.repeat.u,
        1 / created.repeat.v,
      );
    if (textureAssetId)
      material.color = new Color(textures?.map ? "#ffffff" : props.color);
    material.needsUpdate = true;
    invalidate();
  }, [
    created,
    textures,
    textureAssetId,
    props.side,
    props.color,
    props.uDirection,
    invalidate,
  ]);
  return <primitive object={created.material} attach="material" />;
}
