/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the app works from any subpath, e.g. GitHub Pages
  // (username.github.io/repo-name/)
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
