/**
 * electron-builder expects build/icon.ico (Windows) and build/icon.png (Linux).
 * Repo ships without binaries; generate simple branded placeholders before packaging.
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const buildDir = join(root, 'build');
const icoPath = join(buildDir, 'icon.ico');
const pngPath = join(buildDir, 'icon.png');

/** Single 32bpp BMP-in-ICO image (solid color), bottom-up BGRA + empty AND mask. */
function solidColorIco(width, height, r, g, b, a = 255) {
  if (width > 256 || height > 256) throw new Error('max 256');
  const biSize = 40;
  const xorSize = width * height * 4;
  const andStride = Math.ceil(width / 32) * 4;
  const andSize = andStride * height;
  const imageOffset = 6 + 16;
  const bytesInRes = biSize + xorSize + andSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width === 256 ? 0 : width, 0);
  entry.writeUInt8(height === 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(bytesInRes, 8);
  entry.writeUInt32LE(imageOffset, 12);

  const bmp = Buffer.alloc(biSize);
  bmp.writeUInt32LE(40, 0);
  bmp.writeInt32LE(width, 4);
  bmp.writeInt32LE(height * 2, 8);
  bmp.writeUInt16LE(1, 12);
  bmp.writeUInt16LE(32, 14);
  bmp.writeUInt32LE(0, 16);
  bmp.writeUInt32LE(xorSize, 20);
  bmp.writeInt32LE(0, 24);
  bmp.writeInt32LE(0, 28);
  bmp.writeUInt32LE(0, 32);
  bmp.writeUInt32LE(0, 36);

  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const row = height - 1 - y;
      const i = (row * width + x) * 4;
      xor[i] = b;
      xor[i + 1] = g;
      xor[i + 2] = r;
      xor[i + 3] = a;
    }
  }
  const andMask = Buffer.alloc(andSize, 0);
  return Buffer.concat([header, entry, bmp, xor, andMask]);
}

const force = process.argv.includes('--force');
if (!force && existsSync(icoPath) && existsSync(pngPath)) {
  console.log('[ensure-build-icon] icons exist:', icoPath);
  process.exit(0);
}

mkdirSync(buildDir, { recursive: true });
// NEXOR-ish teal #0f7664
const R = 15;
const G = 118;
const B = 100;
writeFileSync(icoPath, solidColorIco(256, 256, R, G, B));
const img = new Jimp({ width: 512, height: 512, color: '#0f7664ff' });
await img.write(pngPath);
console.log('[ensure-build-icon] wrote', icoPath, 'and', pngPath);
