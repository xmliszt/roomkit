import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import validator from 'gltf-validator'

declare global {
  interface Window {
    ready?: boolean
    inspectGlb: (url: string) => Promise<Inspection>
    shoot: (options: ShotOptions) => Promise<void>
    lines: (options: { url: string; linesUrl: string; mode: string; azimuthDeg: number; elevationDeg: number; widthPx: number; heightPx: number }) => Promise<{ elapsedMs: number; dpr: number }>
  }
}

type Inspection = { size: number[]; min: number[]; triangles: number; textures: { key: string; width: number; height: number }[]; points: number[][] }
type ShotOptions = { url: string; mount: string; environment: boolean; azimuthDeg: number; elevationDeg: number; yawDeg: number; widthPx: number; heightPx: number }
type Jobs = {
  inspect?: { id: string; glb: string }[]
  shots?: { glb: string; out: string; mount?: string; environment: boolean; azimuthDeg: number; elevationDeg: number; yawDeg?: number; widthPx?: number; heightPx?: number }[]
  lines?: { glb: string; lines?: string; out: string; mode: 'edges-geometry' | 'proxy' | 'screen'; azimuthDeg: number; elevationDeg: number }[]
}

const [jobsPath, resultPath] = process.argv.slice(2)
if (!jobsPath || !resultPath) {
  console.error('usage: glb-tool.ts <jobs.json> <result.json>')
  process.exit(2)
}
const jobs: Jobs = JSON.parse(await readFile(jobsPath, 'utf8'))
const filesRoot = join(homedir(), '.cache', 'interior-planner-spikes')
const here = import.meta.dirname
const roots: { [prefix: string]: string } = { here, three: join(here, 'node_modules', 'three'), files: filesRoot }
const contentTypes: { [extension: string]: string } = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' }

function fileUrl(origin: string, path: string) {
  const absolute = resolve(path)
  if (!absolute.startsWith(filesRoot + sep)) throw new Error(`${absolute} is outside ${filesRoot}`)
  return `${origin}/files/${absolute.slice(filesRoot.length + 1).split(sep).map(encodeURIComponent).join('/')}`
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
    response.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('no port')
const origin = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] })
const result: { inspect: { [id: string]: unknown }; shots: string[] } = { inspect: {}, shots: [] }
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/here/page.html`)
  await page.waitForFunction(() => window.ready === true)
  for (const job of jobs.inspect ?? []) {
    const bytes = await readFile(job.glb)
    const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50 })
    try {
      const inspection = await page.evaluate((url) => window.inspectGlb(url), fileUrl(origin, job.glb))
      result.inspect[job.id] = { loaded: true, bytes: bytes.length, validatorErrors: report.issues.numErrors, validatorWarnings: report.issues.numWarnings, ...inspection }
    } catch (error) {
      result.inspect[job.id] = { loaded: false, error: String(error), bytes: bytes.length, validatorErrors: report.issues.numErrors }
    }
  }
  for (const shot of jobs.shots ?? []) {
    const widthPx = shot.widthPx ?? 600
    const heightPx = shot.heightPx ?? 600
    await page.setViewportSize({ width: widthPx, height: heightPx })
    const options: ShotOptions = {
      url: fileUrl(origin, shot.glb),
      mount: shot.mount ?? 'floor',
      environment: shot.environment,
      azimuthDeg: shot.azimuthDeg,
      elevationDeg: shot.elevationDeg,
      yawDeg: shot.yawDeg ?? 0,
      widthPx,
      heightPx,
    }
    await page.evaluate((shotOptions) => window.shoot(shotOptions), options)
    await page.locator('canvas').screenshot({ path: resolve(shot.out) })
    result.shots.push(resolve(shot.out))
  }
  if ((jobs.lines ?? []).length > 0) {
    const retina = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 2 })
    retina.on('pageerror', (error) => errors.push(error.message))
    await retina.goto(`${origin}/here/page.html`)
    await retina.waitForFunction(() => window.ready === true)
    for (const job of jobs.lines ?? []) {
      const timing = await retina.evaluate((options) => window.lines(options), {
        url: fileUrl(origin, job.glb),
        linesUrl: job.lines ? fileUrl(origin, job.lines) : '',
        mode: job.mode,
        azimuthDeg: job.azimuthDeg,
        elevationDeg: job.elevationDeg,
        widthPx: 600,
        heightPx: 600,
      })
      await retina.locator('canvas').screenshot({ path: resolve(job.out) })
      result.shots.push(`${resolve(job.out)} ${job.mode} ${timing.elapsedMs.toFixed(1)} ms dpr ${timing.dpr}`)
    }
  }
  if (errors.length > 0) throw new Error(errors.join('; '))
} finally {
  await browser.close()
  server.close()
}
await writeFile(resultPath, JSON.stringify(result))
