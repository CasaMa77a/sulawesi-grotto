import { fbmNoise, maskFromNoise, blurF32, buildLUT, renderRelief, crackField, applyDither } from './src/engine.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const crcTable = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[i] = c >>> 0; }
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const ch = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, cc]); };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
// ico container with embedded PNG
function ico(pngBuf, w) {
  const dir = Buffer.alloc(6); dir.writeUInt16LE(0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const e = Buffer.alloc(16);
  e[0] = w >= 256 ? 0 : w; e[1] = w >= 256 ? 0 : w; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngBuf.length, 8); e.writeUInt32LE(22, 12);
  return Buffer.concat([dir, e, pngBuf]);
}

const W = 800, H = 800;
// organic multi-blob sigil: several thresholded noise fields unioned + a few strokes
const n1 = fbmNoise(W, H, { cells: 4, octaves: 4, seed: 31 });
const n2 = fbmNoise(W, H, { cells: 7, octaves: 3, seed: 87 });
const alpha = new Float32Array(W * H);
for (let i = 0; i < alpha.length; i++) {
  const a = Math.min(1, Math.max(0, (n1[i] - 0.52) / 0.06));
  const b = Math.min(1, Math.max(0, (n2[i] - 0.58) / 0.05));
  alpha[i] = Math.max(a, b * 0.85);
}
// punched holes for the dark bio look
const holes = fbmNoise(W, H, { cells: 9, octaves: 2, seed: 140 });
for (let i = 0; i < alpha.length; i++) if (holes[i] > 0.62) alpha[i] *= 0.15;

const tex = {
  bump: fbmNoise(W, H, { cells: 100, octaves: 3, seed: 3 }),
  mottle: fbmNoise(W, H, { cells: 14, octaves: 3, seed: 11 }),
  grain: fbmNoise(W, H, { cells: Math.round(W / 3), octaves: 1, seed: 1010 }),
  crack: crackField(W, H, { cells: 24, seed: 66 }),
};
const lut = buildLUT([{ x: 0, y: 0 }, { x: 0.3, y: 1 }, { x: 0.6, y: 0.2 }, { x: 0.85, y: 0.95 }, { x: 1, y: 0 }]);
const out = renderRelief(alpha, W, H, {
  emb: { mode: 'pillow', depth: 3.6, size: 8, soften: 5, angle: 135, innerGain: 9, outerGain: 3, bumpAmt: 0.35, fuse: 0 },
  lev: { gamma: 1, gain: 1.5, threshold: 0, invert: false },
  surf: { erosion: 0.12, mottle: 0.3, grain: 0.22, cracks: 0.15 },
  lut, tex, col: null, img: null,
});
applyDither(out, W, H, 'bayer', 3);
const buf = png(W, H, Buffer.from(out.buffer, out.byteOffset, out.length));
fs.writeFileSync('public/splash.png', buf);
fs.writeFileSync('public/icon.png', buf);
fs.writeFileSync('public/icon.ico', ico(buf, 256));
console.log('splash.png + icon.png + icon.ico written');
