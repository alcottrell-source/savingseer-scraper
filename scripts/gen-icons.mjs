// Generate PWA / home-screen icons from the existing favicon.
//
//   node scripts/gen-icons.mjs
//
// Source is favicon.png (256x256). 192 and 180 are clean downscales; the 512 is
// a 2x upscale (lanczos3) and will be mildly soft until a higher-res master
// exists. The maskable icon centres the mark in an ~80% safe zone on a solid
// cream fill so Android's shape masks never clip it. Requires `sharp`
// (devDependency): npm install
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'favicon.png');
const OUT = join(root, 'icons');
const CREAM = { r: 250, g: 247, b: 242, alpha: 1 }; // --cream #FAF7F2

await mkdir(OUT, { recursive: true });

// 192 — downscale, keep transparency.
await sharp(SRC).resize(192, 192, { kernel: 'lanczos3' }).png()
  .toFile(join(OUT, 'icon-192.png'));

// 512 — 2x upscale (quality caveat: soft until a hi-res master replaces favicon.png).
await sharp(SRC).resize(512, 512, { kernel: 'lanczos3' }).png()
  .toFile(join(OUT, 'icon-512.png'));

// apple-touch 180 — flatten onto cream (iOS ignores alpha and would show black).
await sharp(SRC).resize(180, 180, { kernel: 'lanczos3' })
  .flatten({ background: CREAM }).png()
  .toFile(join(OUT, 'apple-touch-icon.png'));

// maskable 512 — mark at ~80% safe zone, centred on a solid cream canvas.
const inner = await sharp(SRC).resize(410, 410, { kernel: 'lanczos3' }).toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: CREAM } })
  .composite([{ input: inner, gravity: 'center' }])
  .png().toFile(join(OUT, 'maskable-512.png'));

console.log('Icons written to', OUT);
