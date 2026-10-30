import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Agent } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const root = resolve(directory, '..');
  // Reuse the Python profile/TLS loader. Only public paths/addresses reach this
  // Node config; no profile secret or private key is included in a browser build.
  const local = command === 'serve' ? JSON.parse(execFileSync(
    resolve(root, '.venv/bin/python'), ['-m', 'backend.app.local_https', 'config'],
    { cwd: root, encoding: 'utf8' },
  )) : null;
  const certificate = local ? readFileSync(local.cert_file) : undefined;
  const https = local ? { cert: certificate, key: readFileSync(local.key_file) } : undefined;
  const target = local?.origin || 'https://127.0.0.1:8010';
  const proxy = {
    '/api': {
      target,
      changeOrigin: false,
      // Trust this configured local certificate, without disabling TLS checks.
      agent: local ? new Agent({ ca: certificate, rejectUnauthorized: true }) : undefined,
      configure(proxy) {
        proxy.on('proxyReq', (proxyRequest, request) => {
          if (request.headers.origin) proxyRequest.setHeader('origin', target);
        });
      },
    },
  };
  return {
    base: command === 'serve' ? '/' : '/assets/',
    plugins: [react()],
    publicDir: 'public',
    server: {
      https, host: local?.host || '127.0.0.1', port: 5173, strictPort: true, proxy,
      fs: { allow: [directory], deny: ['.env', '.env.*', '**/*.{pem,key,crt}', '**/.git/**', '**/var/**', '**/.secrets/**'] },
    },
    preview: { https, host: local?.host || '127.0.0.1', port: 5173, strictPort: true, proxy },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  };
});
