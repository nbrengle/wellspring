import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Build version string
const getBuildVersion = () => {
  const baseVer = pkg.version || '0.1.0';
  if (process.env.GITHUB_RUN_NUMBER) {
    return `${baseVer}+build.${process.env.GITHUB_RUN_NUMBER}`;
  }
  // Local build - format date as YYYYMMDDHHMM
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${baseVer}+local.${dateStr}`;
};

// Set it on process.env so Vite loads it automatically into import.meta.env!
process.env.VITE_APP_VERSION = getBuildVersion();

export default defineConfig({
  plugins: [react()],
  base: '/wellspring/',
})
