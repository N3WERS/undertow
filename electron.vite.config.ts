import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { conditions: ['node', 'import', 'module', 'default'] },
    build: {
      rollupOptions: {
        external: ['youtubei.js'],
        output: { entryFileNames: '[name].mjs', format: 'es' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { entryFileNames: '[name].cjs', format: 'cjs' } }
    }
  },
  renderer: {
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react')) return 'react'
            if (id.includes('node_modules/hls.js')) return 'hls'
            return undefined
          }
        }
      }
    }
  }
})
