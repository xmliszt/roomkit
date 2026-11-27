import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const IDENTITY_TOLERANCE = 1e-6

function textureStats(image) {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, image.width, image.height)
  const sum = [0, 0, 0]
  let lowLuma = 1
  let highLuma = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const luma = (0.3 * data[offset] + 0.59 * data[offset + 1] + 0.11 * data[offset + 2]) / 255
    lowLuma = Math.min(lowLuma, luma)
    highLuma = Math.max(highLuma, luma)
    sum[0] += data[offset]
    sum[1] += data[offset + 1]
    sum[2] += data[offset + 2]
  }
  const pixelCount = data.length / 4
  return { mean: sum.map((channel) => channel / pixelCount / 255), spread: highLuma - lowLuma }
}

window.inspectGlb = async function inspectGlb(url) {
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(gltf.scene, true)
  const weightedCentroid = new THREE.Vector3()
  const identity = new THREE.Matrix4()
  const textures = []
  const parts = {}
  const triangle = new THREE.Triangle()
  const midpoint = new THREE.Vector3()
  let totalArea = 0
  let signedVolume = 0
  let triangleCount = 0
  let transformedMeshCount = 0

  gltf.scene.traverse((node) => {
    if (!node.isMesh) return
    const isIdentity = node.matrixWorld.elements.every(
      (value, index) => Math.abs(value - identity.elements[index]) < IDENTITY_TOLERANCE,
    )
    if (!isIdentity) transformedMeshCount += 1
    parts[node.name] = new THREE.Box3().setFromObject(node, true).getCenter(new THREE.Vector3()).toArray()

    const position = node.geometry.getAttribute('position')
    const index = node.geometry.getIndex()
    const cornerCount = index ? index.count : position.count
    for (let corner = 0; corner < cornerCount; corner += 3) {
      const [a, b, c] = [0, 1, 2].map((step) => (index ? index.getX(corner + step) : corner + step))
      triangle.a.fromBufferAttribute(position, a).applyMatrix4(node.matrixWorld)
      triangle.b.fromBufferAttribute(position, b).applyMatrix4(node.matrixWorld)
      triangle.c.fromBufferAttribute(position, c).applyMatrix4(node.matrixWorld)
      const area = triangle.getArea()
      weightedCentroid.addScaledVector(triangle.getMidpoint(midpoint), area)
      totalArea += area
      signedVolume += triangle.a.dot(midpoint.crossVectors(triangle.b, triangle.c)) / 6
      triangleCount += 1
    }

    const map = node.material.map
    if (map && !textures.some((texture) => texture.uuid === map.uuid)) textures.push(map)
  })

  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    centroid: weightedCentroid.divideScalar(totalArea).toArray(),
    signedVolumeM3: signedVolume,
    triangleCount,
    transformedMeshCount,
    parts,
    textureColors: textures.map((texture) => textureStats(texture.image).mean),
    textureLumaSpreads: textures.map((texture) => textureStats(texture.image).spread),
    textureSizesPx: textures.map((texture) => [texture.image.width, texture.image.height]),
  }
}

window.inspectPng = async function inspectPng(url) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  const colors = new Set()
  let opaqueCount = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 128) continue
    opaqueCount += 1
    colors.add((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2])
  }
  return {
    widthPx: bitmap.width,
    heightPx: bitmap.height,
    opaqueShare: opaqueCount / (data.length / 4),
    opaqueColorCount: colors.size,
  }
}

window.inspectReady = true
