import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    // `npm run dev` forwards API calls to `npm run dev:worker` (wrangler dev, port 8787)
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
})
