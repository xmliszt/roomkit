import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const FIELD_OF_VIEW_DEG = 35
const KEY_DIRECTION = new THREE.Vector3(-0.45, 1, 0.6).normalize()

/** Return a scene lit as DESIGN section 5 (one soft key and an ambient term) on the #F4F1EA background, with a
 * shadow-catching floor, plus functions to switch a neutral environment map on and to frame an object. */
export function createStage(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#F4F1EA')
  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture

  const key = new THREE.DirectionalLight('#ffffff', 2.8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.radius = 6
  key.shadow.bias = -0.0005
  scene.add(key, key.target)
  const ambient = new THREE.AmbientLight('#ffffff', 2.2)
  scene.add(ambient)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 }))
  floor.receiveShadow = true
  scene.add(floor)

  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW_DEG, 1, 0.01, 100)
  let current

  function setEnvironment(isOn) {
    scene.environment = isOn ? environment : null
    scene.environmentIntensity = 0.6
    key.intensity = isOn ? 1.0 : 2.8
    ambient.intensity = isOn ? 0 : 2.2
  }

  function show(object, mount) {
    if (current) scene.remove(current)
    current = object
    object.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    scene.add(object)
    floor.visible = mount !== 'ceiling'
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const radius = size.length() / 2
    floor.position.y = box.min.y
    key.position.copy(centre).addScaledVector(KEY_DIRECTION, radius * 6)
    key.target.position.copy(centre)
    const shadowCamera = key.shadow.camera
    shadowCamera.left = shadowCamera.bottom = -radius * 2
    shadowCamera.right = shadowCamera.top = radius * 2
    shadowCamera.near = radius
    shadowCamera.far = radius * 12
    shadowCamera.updateProjectionMatrix()
    return { centre, radius, box }
  }

  function frame(options) {
    const azimuth = THREE.MathUtils.degToRad(options.azimuthDeg)
    const elevation = THREE.MathUtils.degToRad(options.elevationDeg)
    const direction = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    )
    const corners = options.box
      ? [0, 1, 2, 3, 4, 5, 6, 7].map(
          (index) =>
            new THREE.Vector3(
              index & 1 ? options.box.max.x : options.box.min.x,
              index & 2 ? options.box.max.y : options.box.min.y,
              index & 4 ? options.box.max.z : options.box.min.z,
            ),
        )
      : []
    let distance = (options.radius / Math.sin(THREE.MathUtils.degToRad(FIELD_OF_VIEW_DEG) / 2)) * (options.zoomOut ?? 1.05)
    for (let pass = 0; pass < 4 && corners.length > 0; pass += 1) {
      camera.position.copy(options.centre).addScaledVector(direction, distance)
      camera.lookAt(options.centre)
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()
      const extent = Math.max(...corners.map((corner) => {
        const projected = corner.clone().project(camera)
        return Math.max(Math.abs(projected.x), Math.abs(projected.y))
      }))
      distance *= extent / (0.92 / (options.zoomOut ?? 1.05))
    }
    camera.position.copy(options.centre).addScaledVector(direction, distance)
    camera.near = distance / 100
    camera.far = distance * 20
    camera.lookAt(options.centre)
    camera.updateProjectionMatrix()
  }

  return { scene, camera, setEnvironment, show, frame }
}
