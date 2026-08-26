/**
 * Copy Vite dist/ into backend/webapp so Express can serve /app.
 * `vite build --mode webapp` writes dist/ only; Docker mounts backend/webapp.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const webapp = path.join(root, 'backend', 'webapp');
const distIndex = path.join(dist, 'index.html');

if (!fs.existsSync(distIndex)) {
  console.error('copy-webapp: missing dist/index.html — run vite build --mode webapp first');
  process.exit(1);
}

fs.mkdirSync(webapp, { recursive: true });
const assetsDir = path.join(webapp, 'assets');
if (fs.existsSync(assetsDir)) {
  fs.rmSync(assetsDir, { recursive: true, force: true });
}
fs.cpSync(dist, webapp, { recursive: true });

let version = '';
try {
  version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '';
} catch {
  version = '';
}
fs.writeFileSync(
  path.join(webapp, 'version.json'),
  `${JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)}\n`,
);

const js = fs.readdirSync(path.join(webapp, 'assets')).filter((name) => /^index-.*\.js$/.test(name));
if (!js.length) {
  console.error('copy-webapp: no index-*.js under backend/webapp/assets');
  process.exit(1);
}
console.log(`copy-webapp: ${js[0]} -> backend/webapp`);
