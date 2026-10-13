//scripts/copy-exiftool-wasm.mjs
// Copies the ExifTool engine (a WebAssembly file) into /public so browsers load it
// from mediacrater.com itself, never from a third-party CDN.
// Runs automatically after every `npm install`, including on Vercel.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const source = require.resolve("@6over3/zeroperl-ts/zeroperl.wasm")
const target = join(process.cwd(), "public", "vendor", "zeroperl.wasm")

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`Copied ExifTool engine to ${target}`)
