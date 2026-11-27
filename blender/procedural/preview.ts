import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

declare global {
  interface Window {
    previewReady?: boolean
    renderPreview: (options: PreviewOptions) => Promise<void>
  }
}

type PreviewOptions = {
  url: string
  mount: string
  environment: boolean
  azimuthDeg: number
  elevationDeg: number
  zoomOut: number
  widthPx: number
  heightPx: number
}

const USAGE =
  'usage: preview.ts --glb <model.glb> --out <shot.png> [--azimuth 30] [--elevation 20] [--zoom-out 1.05] [--size 900x900] [--mount floor|wall|ceiling] [--environment]'
const CONTENT_TYPES: { [extension: string]: string } = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.glb': 'model/gltf-binary',
}

const args = process.argv.slice(2).reduce<string[]>((joined, arg) => {
  const previous = joined.at(-1)
  if (previous?.startsWith('--') && !previous.includes('=') && /^-\d/.test(arg)) return [...joined.slice(0, -1), `${previous}=${arg}`]
  return [...joined, arg]
}, [])

const { values } = parseArgs({
  args,
  options: {
    glb: { type: 'string' },
    out: { type: 'string' },
    azimuth: { type: 'string', default: '30' },
    elevation: { type: 'string', default: '20' },
    'zoom-out': { type: 'string', default: '1.05' },
    size: { type: 'string', default: '900x900' },
    mount: { type: 'string', default: 'floor' },
    environment: { type: 'boolean', default: false },
  },
})
if (!values.glb || !values.out) {
  console.error(USAGE)
  process.exit(2)
}
const glbPath = resolve(values.glb)
const [widthPx, heightPx] = values.size.split('x').map(Number)
const numbers = [values.azimuth, values.elevation, values['zoom-out']].map(Number)
if (!widthPx || !heightPx || numbers.some((value) => !Number.isFinite(value))) {
  console.error(USAGE)
  process.exit(2)
}

const here = import.meta.dirname
const roots: { [prefix: string]: string } = {
  here,
  three: join(here, 'node_modules', 'three'),
  model: dirname(glbPath),
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
if (!address || typeof address === 'string') throw new Error('the preview server has no port')
const origin = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] })
try {
  const page = await browser.newPage({ viewport: { width: widthPx, height: heightPx } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/here/preview.html`)
  await page.waitForFunction(() => window.previewReady === true)
  const options: PreviewOptions = {
    url: `${origin}/model/${basename(glbPath)}`,
    mount: values.mount,
    environment: values.environment,
    azimuthDeg: numbers[0] ?? 30,
    elevationDeg: numbers[1] ?? 20,
    zoomOut: numbers[2] ?? 1.05,
    widthPx,
    heightPx,
  }
  await page.evaluate((previewOptions) => window.renderPreview(previewOptions), options)
  if (errors.length > 0) throw new Error(errors.join('; '))
  await page.locator('canvas').screenshot({ path: resolve(values.out) })
  console.log(`wrote ${resolve(values.out)}`)
} finally {
  await browser.close()
  server.close()
}
