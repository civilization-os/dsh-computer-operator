import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const require = createRequire(import.meta.url)
let esbuild
try {
  esbuild = require('esbuild')
} catch {
  // 借用邻近插件中的 esbuild
  const fallbackPath = join(dirname(fileURLToPath(import.meta.url)), '../../dsh-playwright/node_modules/esbuild')
  esbuild = require(fallbackPath)
}

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const result = await esbuild.build({
  entryPoints: [join(pluginRoot, 'src/client/index.jsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'text' },
})

const libDir = join(pluginRoot, 'lib')
await mkdir(libDir, { recursive: true })
await writeFile(
  join(libDir, 'client.js'),
  'window.__ModuleLoader__.load({id:"@civilization/dsh-computer-operator",factory:(require)=>{\nvar module={exports:{}};var exports=module.exports;\n'
  + result.outputFiles[0].text + '\nreturn module.exports;}});\n'
)
console.log('Build successful: lib/client.js created')
