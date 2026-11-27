import {
  ClampToEdgeWrapping,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  RepeatWrapping,
  Texture,
} from "three";
import { expect, test } from "vitest";
import { createColorAdjustUniforms } from "./create-color-adjust-uniforms.ts";
import { patchColorAdjust } from "./patch-color-adjust.ts";

class TrackedTexture extends Texture {
  clones: Texture[] = [];

  clone() {
    const texture = super.clone();
    this.clones = [...this.clones, texture];
    return texture;
  }
}

test("each material keeps its mask wrapping and releases its clone after every reuse", () => {
  const sourceMask = new TrackedTexture();
  const firstMap = new Texture();
  firstMap.wrapS = RepeatWrapping;
  firstMap.wrapT = MirroredRepeatWrapping;
  const secondMap = new Texture();
  secondMap.wrapS = MirroredRepeatWrapping;
  secondMap.wrapT = RepeatWrapping;
  const firstMaterial = patchColorAdjust({
    material: new MeshStandardMaterial({ map: firstMap }),
    uniforms: createColorAdjustUniforms(),
    colorMask: sourceMask,
  });
  const secondMaterial = patchColorAdjust({
    material: new MeshStandardMaterial({ map: secondMap }),
    uniforms: createColorAdjustUniforms(),
    colorMask: sourceMask,
  });
  const firstMask = sourceMask.clones.at(0);
  const secondMask = sourceMask.clones.at(1);
  if (!firstMask || !secondMask) throw new Error("Missing material masks");
  expect(firstMask).not.toBe(secondMask);
  expect([firstMask.wrapS, firstMask.wrapT, firstMask.flipY]).toEqual([
    RepeatWrapping,
    MirroredRepeatWrapping,
    false,
  ]);
  expect([secondMask.wrapS, secondMask.wrapT, secondMask.flipY]).toEqual([
    MirroredRepeatWrapping,
    RepeatWrapping,
    false,
  ]);
  const disposals = { first: 0, second: 0, source: 0 };
  firstMask.addEventListener("dispose", () => disposals.first++);
  secondMask.addEventListener("dispose", () => disposals.second++);
  sourceMask.addEventListener("dispose", () => disposals.source++);
  firstMaterial.dispose();
  expect(disposals).toEqual({ first: 1, second: 0, source: 0 });
  secondMaterial.dispose();
  firstMaterial.dispose();
  secondMaterial.dispose();
  expect(disposals).toEqual({ first: 2, second: 2, source: 0 });
  expect([sourceMask.wrapS, sourceMask.wrapT, sourceMask.flipY]).toEqual([
    ClampToEdgeWrapping,
    ClampToEdgeWrapping,
    true,
  ]);
});
