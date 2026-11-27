import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import validator from 'gltf-validator'
import { chromium } from 'playwright'

type Vec3 = [number, number, number]

type Mount = 'floor' | 'wall' | 'ceiling'

type ObjectSpec = {
  name: string
  label: string
  set: string
  mount: Mount
  sizeM: { width: number; depth: number; height: number }
}

type GlbReport = {
  min: Vec3
  max: Vec3
  signedVolumeM3: number
  triangleCount: number
  transformedMeshCount: number
}

type ViewerEntry = {
  name: string
  label: string
  set: string
  mount: Mount
  file: string
  sizeCm: string
  triangleCount: number
  sizeKb: number
}

declare global {
  interface Window {
    inspectReady?: boolean
    inspectGlb: (url: string) => Promise<GlbReport>
    viewerShown?: string
  }
}

const SIZE_TOLERANCE_M = 0.001
const MAX_GLB_BYTES = 25 * 1024 * 1024
const MAX_TRIANGLES = 150_000
const MAX_TEXTURE_PX = 2048
const GLB_JSON_OFFSET = 20
const CDN_PREFIX = 'https://cdn.jsdelivr.net/npm/three@0.187.0/'
const CONTENT_TYPES: { [extension: string]: string } = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
}

const here = import.meta.dirname
const resultsDir = resolve(process.argv.at(2) ?? '')
const viewerDir = join(resultsDir, 'viewer')
const threeDir = join(here, 'node_modules', 'three')
const roots: { [prefix: string]: string } = {
  spike: resolve(here, '..', 'spikes'),
  three: threeDir,
  results: resultsDir,
}
const only = process.argv.slice(3)
const allObjects: ObjectSpec[] = JSON.parse(await readFile(join(here, 'objects.json'), 'utf8')).objects
const objects = allObjects.filter((spec) => only.length === 0 || only.includes(spec.name))
const failures: string[] = []

function expect(options: { ok: boolean; message: string }) {
  if (!options.ok) failures.push(options.message)
}

function format(vector: number[]) {
  return vector.map((value) => value.toFixed(4)).join(' ')
}

function anchorOf(options: { mount: Mount; report: GlbReport }): Vec3 {
  const { min, max } = options.report
  const mid: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  switch (options.mount) {
    case 'floor':
      return [mid[0], min[1], mid[2]]
    case 'wall':
      return [mid[0], mid[1], min[2]]
    case 'ceiling':
      return [mid[0], max[1], mid[2]]
    default: {
      const unknown: never = options.mount
      throw new Error(`unknown mount ${unknown}`)
    }
  }
}

function imageSizePx(bytes: Buffer): [number, number] {
  if (bytes.readUInt32BE(0) === 0x89504e47) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  let offset = 2
  while (offset < bytes.length) {
    const marker = bytes[offset + 1] ?? 0
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xc3) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)]
    offset += 2 + length
  }
  throw new Error('image is neither PNG nor a JPEG with a frame header')
}

async function textureSizesPx(path: string) {
  const bytes = await readFile(path)
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(GLB_JSON_OFFSET, GLB_JSON_OFFSET + jsonLength).toString('utf8'))
  const binStart = GLB_JSON_OFFSET + jsonLength + 8
  const views: { byteOffset?: number; byteLength: number }[] = json.bufferViews ?? []
  const images: { bufferView?: number }[] = json.images ?? []
  return images.map((image) => {
    const view = views[image.bufferView ?? -1]
    if (!view) throw new Error(`${path}: an image is not embedded`)
    const start = binStart + (view.byteOffset ?? 0)
    return imageSizePx(bytes.subarray(start, start + view.byteLength))
  })
}

async function validate(path: string) {
  const report = await validator.validateBytes(new Uint8Array(await readFile(path)))
  const errors = report.issues.messages.filter((message: { severity: number }) => message.severity === 0)
  return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, first: errors.slice(0, 3) }
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
if (!address || typeof address === 'string') throw new Error('the check server has no port')
const origin = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => failures.push(`inspect page error: ${error.message}`))
  await page.goto(`${origin}/spike/s4-inspect.html`)
  await page.waitForFunction(() => window.inspectReady === true)

  await mkdir(viewerDir, { recursive: true })
  const entries: ViewerEntry[] = []
  console.log('object          W x D x H (m)              expected                   tris    bytes      textures px          validator')
  for (const spec of objects) {
    const path = join(resultsDir, 'models', spec.name, 'model.glb')
    const report = await page.evaluate((url) => window.inspectGlb(url), `${origin}/results/models/${spec.name}/model.glb`)
    const sizeM: Vec3 = [report.max[0] - report.min[0], report.max[2] - report.min[2], report.max[1] - report.min[1]]
    const expected: Vec3 = [spec.sizeM.width, spec.sizeM.depth, spec.sizeM.height]
    const anchor = anchorOf({ mount: spec.mount, report })
    const bytes = (await stat(path)).size
    const validation = await validate(path)
    const textures = await textureSizesPx(path)

    expect({
      ok: sizeM.every((value, axis) => Math.abs(value - expected[axis]) <= SIZE_TOLERANCE_M),
      message: `${spec.name}: size W D H ${format(sizeM)}, expected ${format(expected)}`,
    })
    expect({
      ok: anchor.every((value) => Math.abs(value) <= SIZE_TOLERANCE_M),
      message: `${spec.name}: ${spec.mount} anchor at ${format(anchor)}, expected the origin`,
    })
    expect({
      ok: report.transformedMeshCount === 0,
      message: `${spec.name}: ${report.transformedMeshCount} meshes have a node transform`,
    })
    expect({
      ok: report.signedVolumeM3 > 0,
      message: `${spec.name}: signed volume ${report.signedVolumeM3} (inside out)`,
    })
    expect({ ok: bytes <= MAX_GLB_BYTES, message: `${spec.name}: ${bytes} bytes, limit ${MAX_GLB_BYTES}` })
    expect({
      ok: report.triangleCount <= MAX_TRIANGLES,
      message: `${spec.name}: ${report.triangleCount} triangles, limit ${MAX_TRIANGLES}`,
    })
    expect({
      ok: textures.length > 0,
      message: `${spec.name}: no image textures, so the model renders in flat colour`,
    })
    expect({
      ok: textures.every((sizePx) => Math.max(...sizePx) <= MAX_TEXTURE_PX),
      message: `${spec.name}: texture sizes ${JSON.stringify(textures)}, limit ${MAX_TEXTURE_PX} px`,
    })
    expect({
      ok: validation.errors === 0,
      message: `${spec.name}: validator errors ${JSON.stringify(validation.first)}`,
    })
    console.log(
      `${spec.name.padEnd(15)} ${format(sizeM).padEnd(26)} ${format(expected).padEnd(26)} ${String(report.triangleCount).padStart(6)} ${String(bytes).padStart(9)}  ${textures.map((sizePx) => sizePx.join('x')).join(',').padEnd(20)} ${validation.errors} errors, ${validation.warnings} warnings`,
    )

    await copyFile(path, join(viewerDir, `${spec.name}.glb`))
    entries.push({
      name: spec.name,
      label: spec.label,
      set: spec.set,
      mount: spec.mount,
      file: `${spec.name}.glb`,
      sizeCm: expected.map((value) => Math.round(value * 1000) / 10).join(' × '),
      triangleCount: report.triangleCount,
      sizeKb: Math.round(bytes / 1024),
    })
  }

  if (only.length > 0) {
    console.log(`viewer: not rewritten for a partial check (${only.join(', ')})`)
  } else {
    await copyFile(join(here, 'viewer.html'), join(viewerDir, 'index.html'))
    await copyFile(join(here, 'stage.js'), join(viewerDir, 'stage.js'))
    await writeFile(join(viewerDir, 'objects.json'), `${JSON.stringify(entries, null, 2)}\n`)

    const viewer = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    viewer.on('pageerror', (error) => failures.push(`viewer page error: ${error.message}`))
    viewer.on('console', (message) => {
      if (message.type() === 'error') failures.push(`viewer console error: ${message.text()}`)
    })
    await viewer.route(`${CDN_PREFIX}**`, async (route) => {
      const path = join(threeDir, route.request().url().slice(CDN_PREFIX.length))
      await route.fulfill({ body: await readFile(path), contentType: 'text/javascript' })
    })
    await viewer.goto(`${origin}/results/viewer/index.html`)
    for (const [index, entry] of entries.entries()) {
      await viewer.locator('#objects button').nth(index).click()
      await viewer.waitForFunction((name) => window.viewerShown === name, entry.name, { timeout: 15_000 })
    }
    await viewer.locator('#objects button').nth(0).click()
    await viewer.waitForFunction((name) => window.viewerShown === name, entries[0]?.name)
    await viewer.waitForTimeout(500)
    await viewer.screenshot({ path: join(resultsDir, 'viewer-check.png') })
    console.log(`viewer: ${entries.length} objects switched in three.js r187, screenshot ${join(resultsDir, 'viewer-check.png')}`)
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
console.log(`\nPASS${only.length > 0 ? ` (${only.join(', ')} only)` : ''}: every final GLB loads in three.js r187 at its expected size, with 0 validator errors and within the M3 budgets`)
