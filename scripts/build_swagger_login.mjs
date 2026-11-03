// One source for portal and Swagger crypto/protocol; no environment/key files are read.
import { build } from '../frontend/node_modules/vite/dist/node/index.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'backend/static/swagger');
await build({
  configFile: false, root: path.join(root, 'frontend'), publicDir: false, logLevel: 'warn',
  build: { target: 'es2022', outDir: destination, emptyOutDir: false, copyPublicDir: false,
    minify: false, sourcemap: false,
    lib: { entry: path.join(root, 'frontend/docs/swagger.ts'), name: 'PortalSwagger', formats: ['iife'], fileName: () => 'swagger-init.js' },
  },
});
const sources = ['frontend/docs/swagger.ts', 'frontend/core/login-encryption.ts', 'frontend/core/ldap-readiness.ts', 'frontend/core/swagger-request.ts'];
const hash = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
writeFileSync(path.join(destination, 'bootstrap.json'), JSON.stringify({
  generated: 'Run npm --prefix frontend run build:swagger; do not edit swagger-init.js by hand.',
  sources: Object.fromEntries(sources.map(file => [file, hash(file)])),
  output_sha256: hash('backend/static/swagger/swagger-init.js'),
}, null, 2) + '\n');
