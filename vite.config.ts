import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  // 相对路径产物：放到任意子目录的静态托管都能直接用
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5180,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900
  }
})
