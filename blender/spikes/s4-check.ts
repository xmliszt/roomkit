import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import validator from 'gltf-validator'
import { chromium } from 'playwright'

type Vec3 = [number, number, number]

type Mount = 'floor' | 'wall' | 'ceiling'

type SpikeCase = {
  name: string
  source: string
  mount: Mount
  expectedSizeM: number
  sourceUp: string
  sourceFront: string
}

type GlbReport = {
  min: Vec3
  max: Vec3
  centroid: Vec3
  signedVolumeM3: number
  triangleCount: number
  transformedMeshCount: number
  parts: { [name: string]: Vec3 }
  textureLumaSpreads: number[]
  textureColors: Vec3[]
  textureSizesPx: [number, number][]
}

type PngReport = { widthPx: number; heightPx: number; opaqueShare: number; opaqueColorCount: number }

declare global {
  interface Window {
    inspectReady?: boolean
    inspectGlb: (url: string) => Promise<GlbReport>
    inspectPng: (url: string) => Promise<PngReport>
  }
}

const SIZE_TOLERANCE_M = 0.001
const TEXTURE_COPY_TOLERANCE = 2 / 255
const VOLUME_TOLERANCE = 0.001
const MIN_BLUE_SHIFT = 0.1
const THUMBNAIL_SIZE_PX = 512
const CHAIR_SIZE_M: Vec3 = [0.6, 0.9, 0.5]
const CHAIR_SOURCES = ['chair-wrong-axes.glb', 'chair-jpeg-texture.glb']
const DUCK_CENTROID_OFFSET_M: Vec3 = [0.0011, -0.0216, 0.0057]
const GLB_JSON_OFFSET = 20
const TARGET_BLUE: Vec3 = [30 / 255, 80 / 255, 230 / 255]
const AXES: { [name: string]: Vec3 } = {
  '+X': [1, 0, 0],
  '-X': [-1, 0, 0],
  '+Y': [0, 1, 0],
  '-Y': [0, -1, 0],
  '+Z': [0, 0, 1],
  '-Z': [0, 0, -1],
}
const CONTENT_TYPES: { [extension: string]: string } = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
}

const spikeDir = import.meta.dirname
const outDir = resolve(process.argv.at(2) ?? join(spikeDir, 'out'))
const caseNames = process.argv.slice(3)
const roots: { [prefix: string]: string } = {
  spike: spikeDir,
  three: join(spikeDir, 'node_modules', 'three'),
  fixtures: resolve(spikeDir, '..', 'fixtures'),
  out: outDir,
}

const failures: string[] = []

function expect(options: { ok: boolean; message: string }) {
  if (!options.ok) failures.push(options.message)
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

function centre(report: GlbReport) {
  return scale([report.min[0] + report.max[0], report.min[1] + report.max[1], report.min[2] + report.max[2]], 0.5)
}

function near(options: { actual: Vec3; expected: Vec3; tolerance: number }) {
  return options.actual.every((value, axis) => Math.abs(value - options.expected[axis]) <= options.tolerance)
}

function format(vector: number[]) {
  return vector.map((value) => value.toFixed(4)).join(' ')
}

function axis(name: string): Vec3 {
  const vector = AXES[name]
  if (!vector) throw new Error(`unknown axis ${name}`)
  return vector
}

function expectedFromSource(options: { source: GlbReport; spikeCase: SpikeCase }) {
  const up = axis(options.spikeCase.sourceUp)
  const front = axis(options.spikeCase.sourceFront)
  const right = cross(up, front)
  const extent = sub(options.source.max, options.source.min)
  const offset = sub(options.source.centroid, centre(options.source))
  const size: Vec3 = [Math.abs(dot(extent, right)), Math.abs(dot(extent, up)), Math.abs(dot(extent, front))]
  const factor = options.spikeCase.expectedSizeM / Math.max(...size)
  return {
    sizeM: scale(size, factor),
    centroidOffsetM: scale([dot(offset, right), dot(offset, up), dot(offset, front)], factor),
    signedVolumeM3: options.source.signedVolumeM3 * factor ** 3,
  }
}

function expectedAnchor(options: { mount: Mount; report: GlbReport }): Vec3 {
  const mid = centre(options.report)
  switch (options.mount) {
    case 'floor':
      return [mid[0], options.report.min[1], mid[2]]
    case 'wall':
      return [mid[0], mid[1], options.report.min[2]]
    case 'ceiling':
      return [mid[0], options.report.max[1], mid[2]]
    default: {
      const unknown: never = options.mount
      throw new Error(`unknown mount ${unknown}`)
    }
  }
}

async function imageMimeTypes(path: string) {
  const bytes = await readFile(path)
  const json = JSON.parse(bytes.subarray(GLB_JSON_OFFSET, GLB_JSON_OFFSET + bytes.readUInt32LE(12)).toString('utf8'))
  const images: { mimeType?: string }[] = json.images ?? []
  return images.map((image) => image.mimeType).join()
}

async function validate(options: { label: string; path: string }) {
  const report = await validator.validateBytes(new Uint8Array(await readFile(options.path)))
  const errors = report.issues.messages.filter((message: { severity: number }) => message.severity === 0)
  expect({
    ok: report.issues.numErrors === 0,
    message: `${options.label}: validator errors: ${JSON.stringify(errors.slice(0, 5))}`,
  })
  return `${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`
}

const server = createServer(async (request, response) => {
  const [, prefix, ...rest] = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).split('/')
  const root = roots[prefix ?? '']
  const path = root ? normalize(join(root, ...rest)) : undefined
  if (!root || !path || !path.startsWith(root + sep)) {
    response.writeHead(404).end()
    return
  }
  try {
    const body = await readFile(path)
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('the inspection server has no port')
const origin = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  await page.goto(`${origin}/spike/s4-inspect.html`)
  await page.waitForFunction(() => window.inspectReady === true)

  if (caseNames.length === 0) throw new Error('usage: node s4-check.ts <out dir> <case name>...')

  for (const caseName of caseNames) {
    const caseDir = join(outDir, caseName)
    const spikeCase: SpikeCase = JSON.parse(await readFile(join(caseDir, 'case.json'), 'utf8'))
    const inspectGlb = (url: string) => page.evaluate((glbUrl) => window.inspectGlb(glbUrl), url)

    const source = await inspectGlb(`${origin}/${spikeCase.source.startsWith("out/") ? spikeCase.source : `fixtures/${spikeCase.source}`}`)
    const model = await inspectGlb(`${origin}/out/${caseName}/model.glb`)
    const recolored = await inspectGlb(`${origin}/out/${caseName}/recolored.glb`)
    const thumb = await page.evaluate(
      (pngUrl) => window.inspectPng(pngUrl),
      `${origin}/out/${caseName}/thumb.png`,
    )

    const expected = expectedFromSource({ source, spikeCase })
    const sizeM = sub(model.max, model.min)
    const anchor = expectedAnchor({ mount: spikeCase.mount, report: model })
    const centroidOffsetM = sub(model.centroid, centre(model))

    expect({
      ok: near({ actual: sizeM, expected: expected.sizeM, tolerance: SIZE_TOLERANCE_M }),
      message: `${caseName}: size ${format(sizeM)}, expected ${format(expected.sizeM)}`,
    })
    expect({
      ok: Math.abs(Math.max(...sizeM) - spikeCase.expectedSizeM) <= SIZE_TOLERANCE_M,
      message: `${caseName}: largest dimension ${Math.max(...sizeM)}, expected ${spikeCase.expectedSizeM}`,
    })
    expect({
      ok: near({ actual: anchor, expected: [0, 0, 0], tolerance: SIZE_TOLERANCE_M }),
      message: `${caseName}: ${spikeCase.mount} anchor at ${format(anchor)}, expected the origin`,
    })
    expect({
      ok: near({ actual: centroidOffsetM, expected: expected.centroidOffsetM, tolerance: SIZE_TOLERANCE_M }),
      message: `${caseName}: centroid offset ${format(centroidOffsetM)}, expected ${format(expected.centroidOffsetM)} (wrong axes or mirrored)`,
    })
    expect({
      ok:
        model.signedVolumeM3 > 0 &&
        Math.abs(model.signedVolumeM3 - expected.signedVolumeM3) <= VOLUME_TOLERANCE * expected.signedVolumeM3,
      message: `${caseName}: signed volume ${model.signedVolumeM3}, expected ${expected.signedVolumeM3} (inside out or rescaled)`,
    })
    const sourceColor = source.textureColors.at(0)
    const modelColor = model.textureColors.at(0)
    expect({
      ok:
        sourceColor !== undefined &&
        modelColor !== undefined &&
        near({ actual: modelColor, expected: sourceColor, tolerance: TEXTURE_COPY_TOLERANCE }) &&
        model.textureSizesPx.at(0)?.join() === source.textureSizesPx.at(0)?.join(),
      message: `${caseName}: normalize changed the base colour texture`,
    })
    expect({
      ok: model.transformedMeshCount === 0,
      message: `${caseName}: ${model.transformedMeshCount} meshes have a node transform`,
    })
    expect({
      ok: model.triangleCount === source.triangleCount,
      message: `${caseName}: ${model.triangleCount} triangles, source has ${source.triangleCount}`,
    })

    if (spikeCase.source === 'duck.glb') {
      expect({
        ok: near({ actual: centroidOffsetM, expected: DUCK_CENTROID_OFFSET_M, tolerance: SIZE_TOLERANCE_M }),
        message: `${caseName}: centroid offset ${format(centroidOffsetM)}, the duck's is ${format(DUCK_CENTROID_OFFSET_M)}`,
      })
    }

    const sourceMimeTypes = await imageMimeTypes(spikeCase.source.startsWith('out/') ? join(spikeDir, spikeCase.source) : join(roots.fixtures ?? '', spikeCase.source))
    const modelMimeTypes = await imageMimeTypes(join(caseDir, 'model.glb'))
    const recoloredMimeTypes = await imageMimeTypes(join(caseDir, 'recolored.glb'))
    expect({
      ok: sourceMimeTypes !== '' && modelMimeTypes === sourceMimeTypes && recoloredMimeTypes === sourceMimeTypes,
      message: `${caseName}: image types ${sourceMimeTypes} -> ${modelMimeTypes} -> ${recoloredMimeTypes} changed`,
    })

    if (CHAIR_SOURCES.includes(spikeCase.source)) {
      const { seat, back, arm } = model.parts
      const legs = ['leg_1', 'leg_2', 'leg_3', 'leg_4'].map((name) => model.parts[name])
      expect({
        ok: near({ actual: sizeM, expected: CHAIR_SIZE_M, tolerance: SIZE_TOLERANCE_M }),
        message: `${caseName}: size ${format(sizeM)}, the chair is ${format(CHAIR_SIZE_M)}`,
      })
      expect({
        ok: Boolean(seat && back && arm) && legs.every(Boolean),
        message: `${caseName}: missing a named part, found ${Object.keys(model.parts).join(', ')}`,
      })
      if (seat && back && arm) {
        expect({ ok: back[2] < seat[2], message: `${caseName}: back is not behind the seat (-Z)` })
        expect({ ok: back[1] > seat[1], message: `${caseName}: back is not above the seat (+Y)` })
        expect({
          ok: legs.every((leg) => leg !== undefined && leg[1] < seat[1]),
          message: `${caseName}: a leg is not below the seat`,
        })
        expect({ ok: arm[0] > seat[0], message: `${caseName}: arm is not on the +X side` })
      }
    }

    expect({
      ok:
        recolored.triangleCount === model.triangleCount &&
        near({ actual: recolored.min, expected: model.min, tolerance: 1e-5 }) &&
        near({ actual: recolored.max, expected: model.max, tolerance: 1e-5 }) &&
        near({ actual: recolored.centroid, expected: model.centroid, tolerance: 1e-5 }),
      message: `${caseName}: recolor changed the geometry`,
    })
    const before = model.textureColors.at(0)
    const after = recolored.textureColors.at(0)
    expect({ ok: Boolean(before && after), message: `${caseName}: no base colour texture decoded` })
    if (before && after) {
      const blueShift = after[2] - after[0] - (before[2] - before[0])
      expect({
        ok: after[2] > after[0] && blueShift > MIN_BLUE_SHIFT,
        message: `${caseName}: texture mean ${format(before)} -> ${format(after)} did not move to blue`,
      })
      if (['white-floor', 'black-floor'].includes(caseName)) {
        expect({
          ok: near({ actual: after, expected: TARGET_BLUE, tolerance: 0.05 }),
          message: `${caseName}: mean ${format(after)} is not near target ${format(TARGET_BLUE)}`,
        })
        expect({
          ok: (recolored.textureLumaSpreads.at(0) ?? 0) > 0.01,
          message: `${caseName}: recolor lost the luma spread`,
        })
      }
    }

    expect({
      ok: thumb.widthPx === THUMBNAIL_SIZE_PX && thumb.heightPx === THUMBNAIL_SIZE_PX,
      message: `${caseName}: thumbnail is ${thumb.widthPx} x ${thumb.heightPx}`,
    })
    expect({
      ok: thumb.opaqueShare > 0.05 && thumb.opaqueShare < 0.95 && thumb.opaqueColorCount > 50,
      message: `${caseName}: thumbnail looks blank (${thumb.opaqueShare.toFixed(2)} opaque, ${thumb.opaqueColorCount} colours)`,
    })

    const modelValidation = await validate({ label: `${caseName}/model.glb`, path: join(caseDir, 'model.glb') })
    const recoloredValidation = await validate({
      label: `${caseName}/recolored.glb`,
      path: join(caseDir, 'recolored.glb'),
    })
    const bytes = await Promise.all(
      ['model.glb', 'recolored.glb', 'thumb.png'].map(async (file) => (await stat(join(caseDir, file))).size),
    )

    console.log(`${caseName}  (${spikeCase.source}, up ${spikeCase.sourceUp}, front ${spikeCase.sourceFront})`)
    console.log(`  size W H D   ${format(sizeM)} m   expected ${format(expected.sizeM)}`)
    console.log(`  ${spikeCase.mount} anchor  ${format(anchor)}`)
    console.log(`  centroid     ${format(centroidOffsetM)}   expected ${format(expected.centroidOffsetM)}`)
    console.log(
      `  triangles    ${model.triangleCount}   texture ${model.textureSizesPx.at(0)?.join(' x ')} px, ${recoloredMimeTypes}`,
    )
    console.log(`  texture mean ${before ? format(before) : 'none'} -> ${after ? format(after) : 'none'}`)
    console.log(`  validator    model: ${modelValidation}; recolored: ${recoloredValidation}`)
    console.log(`  bytes        model ${bytes[0]}  recolored ${bytes[1]}  thumb ${bytes[2]}`)
  }
} finally {
  await browser.close()
  server.close()
}

if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length})`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log('\nPASS: three.js r187 loads every output with the expected size, axes and anchor')
