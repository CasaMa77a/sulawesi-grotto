import { readFileSync, writeFileSync } from 'fs';
import * as font from './src/font.js';

const toAb = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const f = font.importTTF(toAb(readFileSync('C:/Windows/Fonts/arialbd.ttf')), 'a');
const sc = 100 / 700;
let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 140">';
let ox = 8;
for (const ch of ['A', 'o', 'g', 'S']) {
  const gl = f.glyphs[ch];
  if (!gl) { console.log('missing', ch); continue; }
  for (const p of gl.paths) {
    let d = `M ${(ox + p.pts[0].x * sc).toFixed(1)} ${(110 - p.pts[0].y * sc).toFixed(1)}`;
    const n = p.pts.length + (p.closed ? 1 : 0);
    for (let i = 1; i < n; i++) {
      const a = p.pts[i - 1], b = p.pts[i % p.pts.length];
      d += a.c
        ? ` Q ${(ox + a.c.x * sc).toFixed(1)} ${(110 - a.c.y * sc).toFixed(1)} ${(ox + b.x * sc).toFixed(1)} ${(110 - b.y * sc).toFixed(1)}`
        : ` L ${(ox + b.x * sc).toFixed(1)} ${(110 - b.y * sc).toFixed(1)}`;
    }
    if (p.closed) d += ' Z';
    svg += `<path d="${d}" fill="black" fill-rule="evenodd"/>`;
  }
  ox += (gl.w || f.glyphW) * sc + 10;
}
svg += '</svg>';
writeFileSync('C:/Users/liagi/Desktop/glyph_test.svg', svg);
console.log('svg written — open it to see A o g S');

// destroy sanity: after ops the glyph must still have same path count, pts finite
const rng = font.seedRng(5);
const gA = font.distortGlyph(f.glyphs['A'], { noise: 15, melt: 0.2, spike: 0.3, push: 0.1, rotate: 8, skew: 0.2, slices: 3, sliceOff: 40, snap: 0, chop: 1 }, f, rng);
const bad = gA.paths.flatMap((p) => p.pts).filter((q) => !isFinite(q.x) || !isFinite(q.y) || (q.c && (!isFinite(q.c.x) || !isFinite(q.c.y))));
console.log('A after destroy: paths', gA.paths.length, 'bad pts:', bad.length);

// real-time sanity: same glyph, same seed → same result (no flicker)
const d1 = font.distortGlyph(f.glyphs['S'], { noise: 30, melt: 0, spike: 0, push: 0, rotate: 0, skew: 0, slices: 0, sliceOff: 0, snap: 0, chop: 0 }, f, font.seedRng(83));
const d2 = font.distortGlyph(f.glyphs['S'], { noise: 30, melt: 0, spike: 0, push: 0, rotate: 0, skew: 0, slices: 0, sliceOff: 0, snap: 0, chop: 0 }, f, font.seedRng(83));
console.log('deterministic:', d1.paths[0].pts[0].x === d2.paths[0].pts[0].x);
