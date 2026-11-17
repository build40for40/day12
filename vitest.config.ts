import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const cloudflareStub = resolve('src/cloudflare-stub.ts')

export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': cloudflareStub, 'cloudflare:workflows': cloudflareStub } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
