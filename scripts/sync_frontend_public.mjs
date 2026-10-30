import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const publicDir = path.join(frontend, 'public');

rmSync(publicDir, { recursive: true, force: true });
for (const folder of ['assets', 'assets/fonts', 'guides']) {
  mkdirSync(path.join(publicDir, folder), { recursive: true });
}

// CSS is imported by the application and bundled by Vite. A public styles.css
// shadows that module in dev and makes browsers try to execute raw CSS as JS.
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
