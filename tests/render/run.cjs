// Compositing needs a canvas, so the render cases are bundled, loaded into an offscreen
// Electron window, and their sampled pixels read back here.
const { build } = require('esbuild')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const work = path.join(root, 'out', 'render-test')
const result = path.join(work, 'result.json')

const ENTRY = [
  "import { run } from '@tests/render/cases'",
  "import { runBundle } from '@tests/render/bundle'",
  'const page = window as unknown as { report: (text: string) => void }',
  'void Promise.all([run(), runBundle()])',
  '  .then((groups) => groups.flat())',
  '  .then((cases) => page.report(JSON.stringify(cases)))',
  '  .catch((err: Error) =>',
  '    page.report(',
  "      JSON.stringify([{ name: 'the cases threw', got: String(err.message), want: 'no error' }])",
  '    )',
  '  )'
].join('\n')

const page = (out) =>
  '<!doctype html><meta charset="utf-8"><body><script>' +
  'const fs = require("fs"), ipc = require("electron").ipcRenderer;' +
  'window.report = (text) => { fs.writeFileSync(' +
  JSON.stringify(out) +
  ', text); ipc.send("done") };' +
  '</script><script src="bundle.js"></script>'

async function main() {
  fs.mkdirSync(work, { recursive: true })
  fs.rmSync(result, { force: true })
  fs.writeFileSync(path.join(work, 'entry.ts'), ENTRY)
  fs.writeFileSync(path.join(work, 'page.html'), page(result))

  await build({
    entryPoints: [path.join(work, 'entry.ts')],
    outfile: path.join(work, 'bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    logLevel: 'warning',
    alias: {
      '@shared': path.join(root, 'src', 'shared'),
      '@renderer': path.join(root, 'src', 'renderer'),
      '@tests': path.join(root, 'tests')
    },
    loader: { '.module.css': 'local-css', '.ttf': 'dataurl' }
  })

  const env = { ...process.env }
  // A shell that exports this starts electron.exe as plain node instead.
  delete env.ELECTRON_RUN_AS_NODE
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const run = spawnSync(electron, [path.join(__dirname, 'main.cjs'), '--work', work], {
    env,
    stdio: ['ignore', 'ignore', 'inherit']
  })

  if (!fs.existsSync(result)) {
    console.error('no results were written (electron exited ' + run.status + ')')
    process.exit(1)
  }

  const cases = JSON.parse(fs.readFileSync(result, 'utf-8'))
  let failed = 0
  for (const c of cases) {
    const ok = c.got === c.want
    if (!ok) failed++
    console.log((ok ? 'ok   ' : 'FAIL ') + c.name + (ok ? '' : '  got ' + c.got + ', wanted ' + c.want))
  }
  console.log('\n' + (cases.length - failed) + '/' + cases.length + ' render cases passed')
  process.exit(failed ? 1 : 0)
}

void main()
