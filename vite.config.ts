import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isPagesBuild = process.env.GITHUB_PAGES === 'true'

export default defineConfig({
  base: isPagesBuild && repoName ? `/${repoName}/` : '/',
  plugins: [react()],
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
