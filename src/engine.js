// Relief / emboss engine — all buffers are Float32Array w*h (0..1) unless noted

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// fBm value noise, normalized 0..1
export function fbmNoise(w, h, { cells = 8, octaves = 4, persistence = 0.55, seed = 1 } = {}) {
  const out = new Float32Array(w * h);
  let amp = 1, freq = cells, total = 0;
  for (let o = 0; o < octaves; o++) {
    const rnd = mulberry32((seed * 7919 + o * 1013) >>> 0);
    const gw = Math.max(2, Math.round(freq)) + 2;
    const grid = new Float32Array(gw * gw);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const sx = (gw - 2) / w, sy = (gw - 2) / h;
    for (let y = 0; y < h; y++) {
      const gy = y * sy;
      const y0 = Math.floor(gy), fy = gy - y0;
      const yy = fy * fy * (3 - 2 * fy);
      const r0 = y0 * gw, r1 = (y0 + 1) * gw;
      for (let x = 0; x < w; x++) {
        const gx = x * sx;
        const x0 = Math.floor(gx), fx = gx - x0;
        const xx = fx * fx * (3 - 2 * fx);
        const v = (grid[r0 + x0] * (1 - xx) + grid[r0 + x0 + 1] * xx) * (1 - yy)
                + (grid[r1 + x0] * (1 - xx) + grid[r1 + x0 + 1] * xx) * yy;
        out[y * w + x] += v * amp;
      }
    }
    total += amp; amp *= persistence; freq *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// separable box blur, n passes ≈ gaussian. Returns new buffer.
export function blurF32(src, w, h, radius, passes = 2) {
  const r = Math.round(radius);
  if (r < 1) return Float32Array.from(src);
  let a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  const norm = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * norm;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// soft threshold: noise -> mask 0..1
export function maskFromNoise(noise, thr, soft) {
  const out = new Float32Array(noise.length);
  const lo = thr - soft, hi = thr + soft;
  const inv = 1 / Math.max(1e-5, hi - lo);
  for (let i = 0; i < noise.length; i++) out[i] = clamp01((noise[i] - lo) * inv);
  return out;
}

// 1px contour of a binary-ish mask (the "wand outline")
export function edgeMask(mask, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] > 0.5 &&
          (x === 0 || mask[i - 1] <= 0.5 || x === w - 1 || mask[i + 1] <= 0.5 ||
           y === 0 || mask[i - w] <= 0.5 || y === h - 1 || mask[i + w] <= 0.5)) {
        out[i] = 1;
      }
    }
  }
  return out;
}

// Catmull-Rom sample through sorted points [{x,y}] in 0..1 space
export function sampleCurve(pts, t) {
  const n = pts.length;
  if (n === 0) return t;
  if (n === 1) return pts[0].y;
  if (t <= pts[0].x) return pts[0].y;
  if (t >= pts[n - 1].x) return pts[n - 1].y;
  let i = 0;
  while (i < n - 2 && t > pts[i + 1].x) i++;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
  const u = clamp01((t - p1.x) / Math.max(1e-6, p2.x - p1.x));
  const u2 = u * u, u3 = u2 * u;
  return clamp01(0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3));
}

export function buildLUT(points) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = sampleCurve(pts, i / 255);
  return lut;
}

// ridged-noise crack field: thin webby lines, 0..1
export function crackField(w, h, { cells = 24, seed = 1 } = {}) {
  const n = fbmNoise(w, h, { cells, octaves: 3, seed });
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const c = 1 - Math.abs(2 * n[i] - 1);
    out[i] = clamp01((c - 0.93) / 0.05);
  }
  return out;
}

// Dithering on RGBA buffer.
// modes: bayer2/bayer/bayer8 (ordered), halftone (cluster dot), lines (scanline),
// noise (white noise), fs (floyd-steinberg), atkinson — plus pixel>1 = blocky low-res
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const BAYER2 = [[0, 2], [3, 1]];
const BAYER8 = (() => {
  const m = Array.from({ length: 8 }, () => new Array(8));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
    m[y][x] = 4 * BAYER4[y % 4][x % 4] + BAYER2[(y / 4) | 0][(x / 4) | 0];
  return m;
})();
// 4x4 clustered-dot screen (halftone): order by distance from cell center
const CLUS4 = (() => {
  const m = Array.from({ length: 4 }, () => new Array(4));
  const cells = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
    cells.push([Math.hypot(x - 1.5, y - 1.5), x, y]);
  cells.sort((a, b) => a[0] - b[0]);
  cells.forEach(([, x, y], i) => { m[y][x] = i; });
  return m;
})();

export function applyDither(out, w, h, mode, levels, pixel = 1) {
  const L = Math.max(1, levels - 1);
  const step = 255 / L;
  const q = (v) => Math.max(0, Math.min(255, Math.round(v / step) * step));

  // low-res mode: downsample to blocks, dither, upscale nearest
  if (pixel > 1) {
    const rw = Math.ceil(w / pixel), rh = Math.ceil(h / pixel);
    const small = new Uint8ClampedArray(rw * rh * 4);
    for (let by = 0; by < rh; by++) {
      for (let bx = 0; bx < rw; bx++) {
        let r = 0, g = 0, b = 0, n = 0;
        const y0 = by * pixel, y1 = Math.min(h, y0 + pixel);
        const x0 = bx * pixel, x1 = Math.min(w, x0 + pixel);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const o = (y * w + x) * 4; r += out[o]; g += out[o + 1]; b += out[o + 2]; n++;
        }
        const o = (by * rw + bx) * 4;
        small[o] = r / n; small[o + 1] = g / n; small[o + 2] = b / n; small[o + 3] = 255;
      }
    }
    if (mode !== 'off') applyDither(small, rw, rh, mode, levels, 1);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(rh - 1, (y / pixel) | 0);
      for (let x = 0; x < w; x++) {
        const si = (sy * rw + Math.min(rw - 1, (x / pixel) | 0)) * 4;
        const o = (y * w + x) * 4;
        out[o] = small[si]; out[o + 1] = small[si + 1]; out[o + 2] = small[si + 2];
      }
    }
    return;
  }

  if (mode === 'bayer' || mode === 'bayer2' || mode === 'bayer8' || mode === 'halftone' || mode === 'lines' || mode === 'noise') {
    const M = mode === 'bayer2' ? BAYER2 : mode === 'bayer8' ? BAYER8 : mode === 'halftone' ? CLUS4 : BAYER4;
    const dim = M.length, maxv = dim * dim - 0.5;
    const thr = (x, y) => {
      if (mode === 'lines') return (BAYER4[y & 3][0] / 15.5 - 0.5) * step;
      if (mode === 'noise') return (Math.random() - 0.5) * step;
      return (M[y % dim][x % dim] / maxv - 0.5) * step;
    };
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const o = (row + x) * 4, t = thr(x, y);
        out[o] = q(out[o] + t); out[o + 1] = q(out[o + 1] + t); out[o + 2] = q(out[o + 2] + t);
      }
    }
  } else {
    // error diffusion needs float buffer
    const f = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      f[i * 3] = out[o]; f[i * 3 + 1] = out[o + 1]; f[i * 3 + 2] = out[o + 2];
    }
    const fs = mode === 'fs';
    const push = (i, c, e, k) => { const n = i * 3 + c; if (n >= 0 && n < f.length) f[n] += e * k; };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        for (let c = 0; c < 3; c++) {
          const v = f[i * 3 + c], qv = q(v), e = v - qv;
          f[i * 3 + c] = qv;
          if (fs) {
            push(i + 1, c, e, 7 / 16); push(i + w - 1, c, e, 3 / 16);
            push(i + w, c, e, 5 / 16); push(i + w + 1, c, e, 1 / 16);
          } else {
            push(i + 1, c, e, 1 / 8); push(i + 2, c, e, 1 / 8);
            push(i + w - 1, c, e, 1 / 8); push(i + w, c, e, 1 / 8);
            push(i + w + 1, c, e, 1 / 8); push(i + 2 * w, c, e, 1 / 8);
          }
        }
      }
    }
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      out[o] = f[i * 3]; out[o + 1] = f[i * 3 + 1]; out[o + 2] = f[i * 3 + 2];
    }
  }
}

// branching random-walk root/vein field, 0..1 — roots creep inward from edges
export function rootsField(w, h, { count = 16, seed = 1, width = 0.012, len = 1 } = {}) {
  const f = new Float32Array(w * h);
  let s = seed >>> 0;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const R = Math.max(1.5, w * width);
  const plot = (x, y, r, v) => {
    const x0 = Math.max(0, (x - r) | 0), x1 = Math.min(w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, (y - r) | 0), y1 = Math.min(h - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++)
      for (let xx = x0; xx <= x1; xx++) {
        const dd = Math.hypot(xx - x, yy - y) / r;
        if (dd < 1) {
          const i = yy * w + xx, vv = v * (1 - dd * dd);
          if (vv > f[i]) f[i] = vv;
        }
      }
  };
  const walk = (x, y, ang, steps, r, depth) => {
    let px = x, py = y;
    for (let i = 0; i < steps; i++) {
      ang += (rng() - 0.5) * 0.55;
      px += Math.cos(ang) * 1.4; py += Math.sin(ang) * 1.4;
      const t = i / steps;
      plot(px, py, r * (1 - t * 0.8), 0.9 - t * 0.5);
      if (depth < 3 && rng() < 0.012)
        walk(px, py, ang + (rng() - 0.5) * 1.7, (steps * 0.55) | 0, r * 0.6, depth + 1);
      if (px < 0 || px >= w || py < 0 || py >= h) break;
    }
  };
  for (let k = 0; k < count; k++) {
    const fromEdge = k % 2 === 0;
    const x = fromEdge ? (rng() < 0.5 ? rng() * w : (rng() < 0.5 ? 2 : w - 3)) : w * (0.25 + rng() * 0.5);
    const y = fromEdge ? (rng() < 0.5 ? rng() * h : (rng() < 0.5 ? 2 : h - 3)) : h * (0.25 + rng() * 0.5);
    const ang = Math.atan2(h / 2 - y, w / 2 - x) + (rng() - 0.5) * 1.3;
    walk(x, y, ang, (w * len * (0.4 + rng() * 0.8)) | 0, R * (0.6 + rng() * 0.9), 0);
  }
  return f;
}

// magic wand: 4-conn flood fill where |field - base| <= tol. Returns mask + bbox.
export function floodSelect(field, w, h, x, y, tol) {
  const i0 = y * w + x;
  const base = field[i0];
  const mask = new Uint8Array(w * h);
  const stack = [i0];
  mask[i0] = 1;
  let minx = w, maxx = 0, miny = h, maxy = 0, count = 0;
  while (stack.length) {
    const i = stack.pop();
    count++;
    const px = i % w, py = (i / w) | 0;
    if (px < minx) minx = px; if (px > maxx) maxx = px;
    if (py < miny) miny = py; if (py > maxy) maxy = py;
    for (const n of [i - 1, i + 1, i - w, i + w]) {
      if (n < 0 || n >= w * h || mask[n]) continue;
      const nx = n % w, ny = (n / w) | 0;
      if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
      if (Math.abs(field[n] - base) <= tol) { mask[n] = 1; stack.push(n); }
    }
  }
  return { mask, bbox: [minx, miny, maxx, maxy], count };
}

// non-contiguous variant: selects ALL pixels within tolerance of the base value
export function globalSelect(field, w, h, x, y, tol) {
  const base = field[y * w + x];
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++)
    if (Math.abs(field[i] - base) <= tol) { mask[i] = 1; count++; }
  return { mask, count };
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// Main bevel&emboss render. Returns Uint8ClampedArray RGBA.
// o = {emb, lev, surf, lut, tex, col, img}
//   emb: {mode, depth, size, soften, angle, innerGain, outerGain, bumpAmt, fuse}
//   lev: {gamma, gain, threshold, invert}
//   surf: {erosion, mottle, grain, cracks}
//   tex: {bump, mottle, grain, crack} noise fields
//   col: {enabled, bg, lo, hi, pig, pigAmt} colors as [r,g,b] 0..1
//   img: {mode, amount, rgb: F32 w*h*3, lum: F32 w*h} | null
export function renderRelief(alpha, w, h, o) {
  const { emb, lev, surf, lut, tex, col, img } = o;
  let src = alpha;
  const own = () => { if (src === alpha) src = Float32Array.from(alpha); };

  // metaball fuse: smooth threshold merges overlapping fields into gooey unions
  if (emb.fuse > 0.001) {
    own();
    const t = 0.5 - emb.fuse * 0.35, s = 0.3 * (1 - emb.fuse) + 0.015;
    for (let i = 0; i < src.length; i++) src[i] = clamp01((src[i] - t) / s);
  }
  // erosion: chip material away in patches before the bevel sees it
  if (surf && surf.erosion > 0.001 && tex && tex.mottle) {
    own();
    const cut = surf.erosion * 0.85;
    for (let i = 0; i < src.length; i++)
      src[i] *= clamp01((tex.mottle[i] - (cut - 0.1)) / 0.2);
  }
  // carve: image luminance pushes into the heightfield (photo ghosted in relief)
  if (img && img.lum && img.mode === 'carve' && img.amount > 0.001) {
    own();
    const a = img.amount * 2;
    for (let i = 0; i < src.length; i++)
      src[i] = clamp01(src[i] + (img.lum[i] - 0.5) * a);
  }
  // web: thin membranes stretched between nearby forms (connective tissue)
  if (emb.web > 0.001) {
    own();
    const bl = blurF32(src, w, h, Math.max(4, Math.round(w * 0.018)));
    const amt = emb.web;
    for (let i = 0; i < src.length; i++) {
      const thin = clamp01((bl[i] - 0.08) * 6) * clamp01((0.55 - bl[i]) * 5);
      const m = thin * amt * (1 - src[i]) * 0.85;
      if (m > src[i]) src[i] = m;
    }
  }

  const hf = blurF32(src, w, h, emb.soften, 2);
  // chisel: quantize heightfield → flat facets, carved-stone look
  const hfS = emb.mode === 'chisel'
    ? (() => { const st = Math.max(2, emb.facet || 6), q = new Float32Array(hf.length);
        for (let i = 0; i < hf.length; i++) q[i] = Math.round(hf[i] * st) / st; return q; })()
    : hf;
  const bumpNoise = tex && tex.bump;
  if (emb.bumpAmt > 0.001 && bumpNoise) {
    for (let i = 0; i < hf.length; i++)
      hf[i] = clamp01(hf[i] + (bumpNoise[i] - 0.5) * emb.bumpAmt * hf[i]);
  }
  const rad = (emb.angle * Math.PI) / 180;
  const d = Math.max(1, Math.round(emb.size));
  const dx = Math.round(Math.cos(rad) * d), dy = Math.round(Math.sin(rad) * d);
  const outer = blurF32(src, w, h, emb.soften + d * 1.5, 1);
  const out = new Uint8ClampedArray(w * h * 4);
  const pillow = emb.mode === 'pillow';
  const incise = emb.mode === 'incise';
  const round = emb.mode === 'round';
  const invGamma = 1 / Math.max(0.01, lev.gamma);
  const mo = surf && tex && tex.mottle ? surf.mottle : 0;
  const gr = surf && tex && tex.grain ? surf.grain : 0;
  const cr = surf && tex && tex.crack ? surf.cracks : 0;
  const sc = surf && tex && tex.honey ? surf.scales || 0 : 0;
  const corr = surf && tex && tex.corro ? surf.corro || 0 : 0;
  const chrome = surf ? surf.chrome || 0 : 0;
  const vign = surf ? surf.vign || 0 : 0;
  const ao = surf ? surf.ao || 0 : 0;
  const aoF = ao > 0.001 ? blurF32(hf, w, h, Math.max(3, Math.round(w * 0.012))) : null;
  const mx = w / 2, my = h / 2, md = Math.hypot(mx, my);
  const colOn = col && col.enabled;
  const bgC = colOn ? col.bg : null, loC = colOn ? col.lo : null,
        hiC = colOn ? col.hi : null, pigC = colOn ? col.pig : null;
  const pigAmt = colOn ? col.pigAmt : 0;
  const imgRgb = img && img.rgb && img.mode !== 'off' && img.mode !== 'carve' ? img.rgb : null;
  const imgMode = imgRgb ? img.mode : null, imgAmt = imgRgb ? img.amount : 0;
  for (let y = 0; y < h; y++) {
    const yp = Math.min(h - 1, y + dy) * w, ym = Math.max(0, y - dy) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const s = (hfS[yp + Math.min(w - 1, x + dx)] - hfS[ym + Math.max(0, x - dx)]) * emb.depth;
      let sh;
      if (pillow) sh = lut[Math.min(255, (Math.abs(s) * 255) | 0)];
      else if (round) sh = lut[Math.min(255, (Math.sqrt(clamp01(s * 0.5 + 0.5)) * 255) | 0)];
      else sh = lut[Math.min(255, Math.max(0, ((s * 0.5 + 0.5) * 255) | 0))];
      if (incise) sh = 1 - sh;
      const m = Math.min(1, hf[i] * emb.innerGain + outer[i] * emb.outerGain);
      let v = sh * m;
      // artifact surface: patina blotches, crack cuts, stone grain
      if (mo) v *= 1 - mo * (1 - tex.mottle[i]);
      if (cr) v *= 1 - cr * tex.crack[i];
      const gd = gr ? gr * (tex.grain[i] - 0.5) : 0;
      v = clamp01(v + gd);
      // scales: honeycomb ridge walls on raised forms (exoskeleton)
      if (sc) v = clamp01(v + sc * (tex.honey[i] - 0.25) * m * 0.9);
      // corrosion: crusty rust bumps + pits, concentrated on patina zones
      if (corr) v = clamp01(v + corr * (tex.corro[i] - 0.45) * (0.3 + tex.mottle[i]) * (0.3 + m));
      // chrome: compressed mids + hot specular streaks (airbrush metal)
      if (chrome) v = clamp01(v * (1 - 0.45 * chrome) + sh * sh * sh * chrome * 1.5);
      // AO: ambient occlusion — crevices (lower than neighborhood) go dark
      if (ao) v *= 1 - ao * clamp01((aoF[i] - hf[i]) * 5);
      let r, g, b;
      if (colOn) {
        // relief color from shading, faded to bg by mask
        r = bgC[0] + (loC[0] + (hiC[0] - loC[0]) * sh - bgC[0]) * m;
        g = bgC[1] + (loC[1] + (hiC[1] - loC[1]) * sh - bgC[1]) * m;
        b = bgC[2] + (loC[2] + (hiC[2] - loC[2]) * sh - bgC[2]) * m;
        // pigment settles in crevices (low height, inside shape), gated by patina
        const crev = clamp01((0.55 - hf[i]) * 2.5) * m * (tex.mottle ? tex.mottle[i] : 0.5) * pigAmt;
        r += (pigC[0] - r) * crev; g += (pigC[1] - g) * crev; b += (pigC[2] - b) * crev;
        // surface blotches/grain shift color too
        if (mo) { const f = 1 - mo * 0.5 * (1 - tex.mottle[i]); r *= f; g *= f; b *= f; }
        r = clamp01(r + gd); g = clamp01(g + gd); b = clamp01(b + gd);
      } else {
        r = g = b = v;
      }
      // image blending (weird modes)
      if (imgRgb) {
        const io = i * 3, ia = imgAmt;
        if (imgMode === 'underlay') {          // photo seeps through where no relief
          const t = ia * (1 - m);
          r += (imgRgb[io] - r) * t; g += (imgRgb[io + 1] - g) * t; b += (imgRgb[io + 2] - b) * t;
        } else if (imgMode === 'inlay') {      // photo inlaid inside raised forms
          const t = ia * m, f = 0.35 + 0.85 * v;
          r += (imgRgb[io] * f - r) * t; g += (imgRgb[io + 1] * f - g) * t; b += (imgRgb[io + 2] * f - b) * t;
        } else if (imgMode === 'ghost') {      // difference bleed — strange
          r += (Math.abs(imgRgb[io] - r) - r) * ia;
          g += (Math.abs(imgRgb[io + 1] - g) - g) * ia;
          b += (Math.abs(imgRgb[io + 2] - b) - b) * ia;
        }
      }
      // vignette: dark atmospheric falloff from center
      if (vign) {
        const vd = Math.hypot(x - mx, y - my) / md;
        const f = 1 - vign * Math.pow(clamp01((vd - 0.4) / 0.6), 1.5);
        r *= f; g *= f; b *= f;
      }
      // levels
      if (lev.threshold > 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = lum >= lev.threshold ? 1 : 0;
      } else {
        r = Math.pow(clamp01(r * lev.gain), invGamma);
        g = Math.pow(clamp01(g * lev.gain), invGamma);
        b = Math.pow(clamp01(b * lev.gain), invGamma);
      }
      if (lev.invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
      const o = i * 4;
      out[o] = (clamp01(r) * 255) | 0; out[o + 1] = (clamp01(g) * 255) | 0;
      out[o + 2] = (clamp01(b) * 255) | 0; out[o + 3] = 255;
    }
  }
  return out;
}
