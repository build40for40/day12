// Wrangler bundles .wasm files as compiled modules and .woff fonts as raw bytes (see "rules" in wrangler.jsonc).
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
declare module '*.woff' {
  const bytes: ArrayBuffer
  export default bytes
}
