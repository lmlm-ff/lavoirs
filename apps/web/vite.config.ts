import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'apps/web',
    // mkcert creates and trusts a local CA for the LAN HTTPS dev server.
    // Avoid loading it during production builds.
    plugins: command === 'serve' ? [react(), mkcert()] : [react()],
    server: {
      host: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${process.env.API_PORT ?? env.API_PORT ?? '3002'}`,
          changeOrigin: false,
        },
      },
    },
    build: { outDir: '../../dist', emptyOutDir: true },
  };
});
