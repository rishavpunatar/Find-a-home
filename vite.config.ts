import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isPagesBuild = process.env.GITHUB_PAGES === 'true'

const copyIndexTo404 = () => ({
  name: 'copy-index-to-404',
  apply: 'build' as const,
  async closeBundle() {
    const distDir = resolve(process.cwd(), 'dist')
    await copyFile(resolve(distDir, 'index.html'), resolve(distDir, '404.html'))
  },
})

export default defineConfig({
  base: isPagesBuild && repoName ? `/${repoName}/` : '/',
  plugins: [react(), copyIndexTo404()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts', 'src/context/**/*.ts'],
    },
  },
})
