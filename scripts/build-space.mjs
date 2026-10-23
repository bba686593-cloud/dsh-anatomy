// Rebuild the pinned, offline Three.js browser runtime.
// npm install --no-save --package-lock=false three@0.186.1 esbuild@0.28.2
// node scripts/build-space.mjs [path/to/node_modules]
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = resolve(process.argv[2] || root, process.argv[2] ? '' : 'node_modules')
const require = createRequire(resolve(dependencyRoot, '_space-build.cjs'))
const { build, version: esbuildVersion } = require('esbuild')
if (esbuildVersion !== '0.28.2') throw Error('Expected esbuild@0.28.2, got ' + esbuildVersion)
const threePackage = JSON.parse(await readFile(resolve(dependencyRoot, 'three/package.json'), 'utf8'))
if (threePackage.version !== '0.186.1') throw Error('Expected three@0.186.1, got ' + threePackage.version)
const exports = ['WebGLRenderer', 'Scene', 'Group', 'Color', 'PerspectiveCamera', 'Box3', 'Raycaster', 'Vector2', 'Vector3', 'BufferGeometry', 'BufferAttribute', 'MeshBasicMaterial', 'LineDashedMaterial', 'LineBasicMaterial', 'Line', 'LineSegments', 'Curve', 'TubeGeometry', 'Mesh', 'Shape', 'ShapeGeometry', 'ExtrudeGeometry', 'PlaneGeometry', 'ConeGeometry', 'CylinderGeometry', 'SphereGeometry', 'TorusGeometry', 'Sprite', 'SpriteMaterial', 'Plane', 'CanvasTexture', 'DataTexture', 'FloatType', 'NearestFilter', 'DoubleSide', 'AdditiveBlending', 'SRGBColorSpace']
const source = `import { ${exports.join(',')} } from 'three'; globalThis.AnatomyThree={${exports.join(',')}};`
await mkdir(resolve(root, 'lib/vendor'), { recursive: true })
await build({ stdin: { contents: source, resolveDir: dirname(dependencyRoot), sourcefile: 'three-space-entry.js' }, bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2020'], outfile: resolve(root, 'lib/vendor/three-space.js'), legalComments: 'none', banner: { js: '/* Three.js 0.186.1 | MIT | see THREE-LICENSE | rebuild: node scripts/build-space.mjs */' } })
await writeFile(resolve(root, 'lib/vendor/THREE-LICENSE'), await readFile(resolve(dependencyRoot, 'three/LICENSE')))
console.log('Built lib/vendor/three-space.js with Three.js ' + threePackage.version)
