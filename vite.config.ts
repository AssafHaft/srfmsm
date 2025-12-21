import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Setting base to './' allows the app to be served from any subpath,
  // which is critical for GitHub Pages (e.g. username.github.io/repo-name/)
  base: './',
})