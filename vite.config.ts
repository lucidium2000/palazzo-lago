import basicSsl from '@vitejs/plugin-basic-ssl';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// The version shown in the corner: the number of commits (goes up with every change) and the commit.
const git = (cmd: string, fallback: string) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
};
const VERSION = `v${git('git rev-list --count HEAD', '0')}`;
const COMMIT = git('git rev-parse --short HEAD', 'dev');

// `npm run dev:quest` serves over HTTPS on your network: the Quest browser
// only allows WebXR on secure origins.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(VERSION), __APP_COMMIT__: JSON.stringify(COMMIT) },
  plugins: mode === 'quest' ? [basicSsl()] : [],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
}) as never);
