// One-shot icon renderer. Reads dist/icons/icon.svg and emits PNG sizes.
// The SVG has a transparent background; the maskable PNG gets a solid Texas-red
// background here so Android's adaptive-icon mask has something to clip.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'dist', 'icons', 'icon.svg');
const OUT = path.join(__dirname, '..', 'dist', 'icons');
const svg = fs.readFileSync(SRC);

const targets = [
  { name: 'icon-192.png',          size: 192,  bg: null },
  { name: 'icon-512.png',          size: 512,  bg: null },
  { name: 'icon-512-maskable.png', size: 512,  bg: { r: 185, g: 28, b: 28, alpha: 1 }, padding: 0.10 },
  { name: 'apple-touch-icon.png',  size: 180,  bg: null },
  { name: 'favicon-32.png',        size: 32,   bg: null },
  { name: 'favicon-16.png',        size: 16,   bg: null }
];

(async () => {
  for (const t of targets) {
    const inner = t.padding ? Math.round(t.size * (1 - t.padding * 2)) : t.size;
    const inset = Math.round((t.size - inner) / 2);
    const innerBuf = await sharp(svg, { density: 384 })
      .resize(inner, inner)
      .png()
      .toBuffer();

    const bg = t.bg || { r: 0, g: 0, b: 0, alpha: 0 };
    const out = await sharp({
      create: { width: t.size, height: t.size, channels: 4, background: bg }
    })
      .composite([{ input: innerBuf, top: inset, left: inset }])
      .png()
      .toBuffer();

    fs.writeFileSync(path.join(OUT, t.name), out);
    console.log('wrote', t.name);
  }
})().catch(e => { console.error(e); process.exit(1); });
