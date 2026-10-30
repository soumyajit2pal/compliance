import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const publicDir = path.join(frontend, 'public');

rmSync(publicDir, { recursive: true, force: true });
for (const folder of ['assets', 'assets/fonts', 'guides', 'styles']) {
  mkdirSync(path.join(publicDir, folder), { recursive: true });
}

cpSync(path.join(frontend, 'styles.css'), path.join(publicDir, 'styles.css'));
cpSync(path.join(frontend, 'styles'), path.join(publicDir, 'styles'), { recursive: true });
cpSync(path.join(frontend, 'assets/fonts'), path.join(publicDir, 'assets/fonts'), { recursive: true });
cpSync(
  path.join(frontend, 'assets/bank-of-maharashtra-wordmark.png'),
  path.join(publicDir, 'assets/bank-of-maharashtra-wordmark.png'),
);
cpSync(path.join(frontend, 'guides/guide.css'), path.join(publicDir, 'guides/guide.css'));
cpSync(
  path.join(frontend, 'guides/week-1-3-navigation.html'),
  path.join(publicDir, 'guides/week-1-3-navigation.html'),
);
