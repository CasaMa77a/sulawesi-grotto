import { readFileSync, writeFileSync } from 'fs';
import * as font from './src/font.js';

const toAb = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const f = font.importTTF(toAb(readFileSync('C:/Users/liagi/OneDrive/Desktop/Helvetica.ttf')), 'helv');

// emulate renderGlyphCell exactly: fit bounds into 34px, trace quad paths
const CELL = (ch) => {
  const gl = font.glyphFor(f, ch);
  if (!gl) return `<!-- ${ch}: no glyph -->`;
  const b = font.glyphBounds(gl);
  const gw = Math.max(1, b[2] - b[0]), gh = Math.max(1, b[3] - b[1]);
  const sc = Math.min((34 * 0.72) / gw, (34 * 0.72) / gh);
  const ox = (34 - gw * sc) / 2 - b[0] * sc;
  const oy = (34 + (b[1] + b[3]) * sc) / 2;
  let out = `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)}) scale(${sc.toFixed(4)})">`;
  for (const p of gl.paths) {
    let d = `M ${p.pts[0].x} ${-p.pts[0].y}`;
    const n = p.pts.length + (p.closed ? 1 : 0);
    for (let i = 1; i < n; i++) {
      const a = p.pts[i - 1], bb = p.pts[i % p.pts.length];
      d += a.c ? ` Q ${a.c.x} ${-a.c.y} ${bb.x} ${-bb.y}` : ` L ${bb.x} ${-bb.y}`;
    }
    if (p.closed) d += ' Z';
    out += `<path d="${d}" fill="white" fill-rule="nonzero"/>`;
  }
  return out + '</g>';
};

const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');
let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 240" style="background:#111">';
cols.forEach((ch, i) => {
  const x = (i % 10) * 34, y = Math.floor(i / 10) * 34;
  svg += `<g transform="translate(${x},${y})"><rect width="34" height="34" fill="#0a0a0a" stroke="#333" stroke-width="0.5"/>${CELL(ch)}</g>`;
});
svg += '</svg>';
writeFileSync('C:/Users/liagi/Desktop/helv_cells.svg', svg);
console.log('written helv_cells.svg — grid of rendered cells');
