import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `npm run dev:quest` serves over HTTPS on your network: the Quest browser
// only allows WebXR on secure origins.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'quest' ? [basicSsl()] : [],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
}) as never);
