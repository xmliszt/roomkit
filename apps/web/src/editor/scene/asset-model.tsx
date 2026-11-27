import {
  type AssetMeta,
  AssetMetaSchema,
} from "@planner/shared/src/scene/asset-meta-schema.ts";
import type { ColorAdjust } from "@planner/shared/src/scene/color-adjust-schema.ts";
import type { Light } from "@planner/shared/src/scene/light-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { useGLTF } from "@react-three/drei";
import { useLoader, useThree } from "@react-three/fiber";
import { useContext, useLayoutEffect, useMemo } from "react";
import {
  Color,
  EdgesGeometry,
  FileLoader,
  type Material,
  Mesh,
  type Object3D,
  Vector3,
} from "three";
import { getAssetUrl } from "../../items/get-asset-url.ts";
import { getItemBox } from "../../items/get-item-box.ts";
import { ColorMaskLoader } from "./color-mask-loader.ts";
import { createColorAdjustUniforms } from "./create-color-adjust-uniforms.ts";
import { getLightEmitterLocalPosition } from "./lighting/get-light-emitter-local-position.ts";
import { getShadeGlow } from "./lighting/get-shade-glow.ts";
import { getShadeTint } from "./lighting/get-shade-tint.ts";
import { patchShadeGlow } from "./lighting/patch-shade-glow.ts";
import { ShadeGlowRegistryContext } from "./lighting/shade-glow-registry-context.ts";
import { shadeRadiusShare } from "./lighting/shade-radius-share.ts";
import { ShadowCastersContext } from "./lighting/shadow-casters-context.ts";
import { patchColorAdjust } from "./patch-color-adjust.ts";
import { setColorAdjustUniforms } from "./set-color-adjust-uniforms.ts";

const creaseAngleDeg = 30;

type AssetModelProps = {
  projectId: string;
  assetId: string;
  sizeM: Size;
  colorAdjust: ColorAdjust | undefined;
  floorCovering?: boolean;
  castShadow?: boolean;
  shade?:
    | { itemId: string; light: Light; placementKind: Placement["kind"] }
    | undefined;
  onReady?: (resource: {
    meta: AssetMeta;
    model: Object3D;
    creases: number[];
  }) => void;
};

export function AssetModel(props: AssetModelProps) {
  const metaJson = useLoader(
    FileLoader,
    getAssetUrl({
      projectId: props.projectId,
      assetId: props.assetId,
      fileName: "meta.json",
    }),
    (loader) => loader.setResponseType("json"),
  );
  const meta = useMemo(() => AssetMetaSchema.parse(metaJson), [metaJson]);
  const nativeSizeM = meta.nativeSizeM;
  const colorMask = useLoader(
    ColorMaskLoader,
    meta.hasColorMask
      ? [
          getAssetUrl({
            projectId: props.projectId,
            assetId: props.assetId,
            fileName: "colorMask.png",
          }),
        ]
      : [],
  ).at(0);
  const invalidate = useThree((state) => state.invalidate);
  const colorUniforms = useMemo(() => createColorAdjustUniforms(), []);
  const gltf = useGLTF(
    getAssetUrl({
      projectId: props.projectId,
      assetId: props.assetId,
      fileName: "model.glb",
    }),
    false,
  );
  const shadeGlows = useContext(ShadeGlowRegistryContext);
  if (props.shade && shadeGlows === undefined)
    throw new Error("AssetModel needs a ShadeGlowRegistryContext for a shade");
  const shadeItemId = props.shade?.itemId;
  const shadeGlow = useMemo(
    () =>
      shadeItemId === undefined
        ? undefined
        : shadeGlows &&
          getShadeGlow({ registry: shadeGlows, itemId: shadeItemId }),
    [shadeGlows, shadeItemId],
  );
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.updateMatrixWorld(true);
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      const patched = materials.map((material) => {
        const colorAdjusted = patchColorAdjust({
          material: material.clone(),
          uniforms: colorUniforms,
          colorMask,
        });
        const patchedMaterial = shadeGlow
          ? patchShadeGlow({ material: colorAdjusted, glow: shadeGlow })
          : colorAdjusted;
        if (props.floorCovering) {
          patchedMaterial.polygonOffset = true;
          patchedMaterial.polygonOffsetFactor = -1;
          patchedMaterial.polygonOffsetUnits = -1;
        }
        return patchedMaterial;
      });
      object.material = Array.isArray(object.material)
        ? patched
        : (patched.at(0) ?? object.material);
    });
    return clone;
  }, [gltf.scene, colorUniforms, colorMask, props.floorCovering, shadeGlow]);
  const shadeLight = props.shade?.light;
  const isTranslucent = shadeLight?.shade === "translucent";
  const shadePlacementKind = props.shade?.placementKind;
  const emitterX = shadeLight?.emitter.x ?? 0;
  const emitterY = shadeLight?.emitter.y ?? 0;
  const emitterZ = shadeLight?.emitter.z ?? 0;
  const beamX = shadeLight?.beam?.direction.x ?? 0;
  const beamY = shadeLight?.beam?.direction.y ?? 0;
  const beamZ = shadeLight?.beam?.direction.z ?? 0;
  useLayoutEffect(() => {
    if (
      shadeGlow === undefined ||
      !isTranslucent ||
      shadePlacementKind === undefined
    )
      return;
    const centre = getLightEmitterLocalPosition({
      emitter: { x: emitterX, y: emitterY, z: emitterZ },
      box: getItemBox({
        placementKind: shadePlacementKind,
        sizeM: nativeSizeM,
      }),
      mirrored: false,
    });
    const tint = getShadeTint({
      model,
      centreM: new Vector3(centre.x, centre.y, centre.z),
      direction: new Vector3(beamX, beamY, beamZ),
      radiusM:
        shadeRadiusShare * Math.max(nativeSizeM.width, nativeSizeM.depth),
    });
    shadeGlow.tint.copy(tint ?? new Color(1, 1, 1));
    invalidate();
  }, [
    shadeGlow,
    isTranslucent,
    emitterX,
    emitterY,
    emitterZ,
    beamX,
    beamY,
    beamZ,
    shadePlacementKind,
    model,
    nativeSizeM,
    invalidate,
  ]);
  const meshes = useMemo(() => {
    const found: Mesh[] = [];
    model.traverse((object) => {
      if (object instanceof Mesh) found.push(object);
    });
    return found;
  }, [model]);
  const needsCreases = meta.kind === "catalog" && props.onReady !== undefined;
  const creases = useMemo(() => {
    if (!needsCreases) return [];
    const point = new Vector3();
    return meshes.flatMap((mesh) => {
      const edges = new EdgesGeometry(mesh.geometry, creaseAngleDeg);
      const positions = edges.getAttribute("position");
      const points = Array.from({ length: positions.count }).flatMap(
        (_, index) => {
          point
            .fromBufferAttribute(positions, index)
            .applyMatrix4(mesh.matrixWorld);
          return [point.x, point.y, point.z];
        },
      );
      edges.dispose();
      return points;
    });
  }, [meshes, needsCreases]);
  useLayoutEffect(() => {
    props.onReady?.({ meta, model: gltf.scene, creases });
  }, [props.onReady, meta, gltf.scene, creases]);
  useLayoutEffect(
    () => () => {
      for (const mesh of meshes) {
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) material.dispose();
      }
    },
    [meshes],
  );

  const castShadow = props.castShadow ?? true;
  const shadowCasters = useContext(ShadowCastersContext);
  useLayoutEffect(() => {
    for (const mesh of meshes) {
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
    }
    shadowCasters.isStale = true;
    invalidate();
    return () => {
      shadowCasters.isStale = true;
    };
  }, [meshes, castShadow, shadowCasters, invalidate]);

  useLayoutEffect(() => {
    setColorAdjustUniforms({
      uniforms: colorUniforms,
      colorAdjust: props.colorAdjust,
      referenceLuma: meta.referenceLuma,
    });
    invalidate();
  }, [colorUniforms, props.colorAdjust, meta.referenceLuma, invalidate]);

  return (
    <group
      scale={[
        props.sizeM.width / nativeSizeM.width,
        props.sizeM.height / nativeSizeM.height,
        props.sizeM.depth / nativeSizeM.depth,
      ]}
    >
      <primitive object={model} />
    </group>
  );
}
