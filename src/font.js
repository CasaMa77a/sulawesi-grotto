import * as opentype from 'opentype.js';

// ---------- custom font engine ----------
// glyph space: y-up in font units (upm), baseline = 0, cap = font.cap, descender = -font.desc
// path: { closed:bool, pts:[{x,y,c:{x,y}|null}] }  — c = quadratic control towards NEXT point
// render: closed paths fill (fill mode) or stroke; open paths always stroke (weight)

export const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,-\'/\\:;()@#&';

export function newFont(name = 'new font') {
  return {
    id: 'f' + Date.now().toString(36) + Math.floor(Math.random() * 999),
    name,
    upm: 700, cap: 640, xH: 420, base: 0, desc: 160,
    glyphW: 520, weight: 52, track: 40,
    mode: 'fill',          // 'fill' | 'stroke'
    glyphs: {},            // ch -> { w?, paths:[...] }
  };
}

export function glyphFor(font, ch) {
  return font.glyphs[ch] || font.glyphs[ch.toUpperCase()] || font.glyphs['?'] || null;
}

export function glyphAdvance(font, ch) {
  const g = glyphFor(font, ch);
  return (g && g.w) || font.glyphW;
}

// trace one glyph into ctx at scale sc, origin = baseline-left (screen y-down)
export function traceGlyph(ctx, paths, ox, oy, sc) {
  for (const p of paths) {
    if (!p.pts.length) continue;
    ctx.beginPath();
    ctx.moveTo(ox + p.pts[0].x * sc, oy - p.pts[0].y * sc);
    const n = p.pts.length + (p.closed ? 1 : 0);
    for (let i = 1; i < n; i++) {
      const a = p.pts[i - 1], b = p.pts[i % p.pts.length];
      if (a.c) ctx.quadraticCurveTo(ox + a.c.x * sc, oy - a.c.y * sc, ox + b.x * sc, oy - b.y * sc);
      else ctx.lineTo(ox + b.x * sc, oy - b.y * sc);
    }
    if (p.closed) ctx.closePath();
  }
}

// ---------- winding: fonts need nonzero fill; normalize so nested paths are counters ----------
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function pathBBox(p) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of p.pts) {
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
  }
  return [x0, y0, x1, y1];
}

// reverse a closed path's direction (controls ride along to the previous anchor)
function reversePath(p) {
  const n = p.pts.length, pts = [];
  for (let k = 0; k < n; k++) {
    const src = p.pts[(n - k) % n];
    const ctrl = p.pts[(n - k - 1 + n) % n].c;
    pts.push({ x: src.x, y: src.y, c: ctrl ? { x: ctrl.x, y: ctrl.y } : null });
  }
  return { closed: p.closed, pts };
}

// order winding so that a contour inside another always has the opposite direction
export function normalizeWind(paths) {
  const closed = paths.filter((p) => p.closed).map((p) => ({ p, area: signedArea(p.pts), b: pathBBox(p), depth: 0, sign: 0 }));
  const open = paths.filter((p) => !p.closed);
  closed.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const done = [];
  for (const it of closed) {
    const cxm = (it.b[0] + it.b[2]) / 2, cym = (it.b[1] + it.b[3]) / 2;
    let parent = null;
    for (const o of done) {
      if (o.b[0] <= cxm && cxm <= o.b[2] && o.b[1] <= cym && cym <= o.b[3]) {
        if (!parent || Math.abs(o.area) < Math.abs(parent.area)) parent = o;
      }
    }
    it.depth = parent ? parent.depth + 1 : 0;
    const rootSign = parent ? parent.sign : Math.sign(it.area) || 1;
    it.sign = rootSign * (it.depth % 2 ? -1 : 1);
    done.push(it);
  }
  const out = done.map((it) => (Math.sign(it.area) !== it.sign && it.area !== 0 ? reversePath(it.p) : it.p));
  return [...out, ...open];
}

export function glyphBounds(gl) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of gl.paths) for (const q of p.pts) {
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
    if (q.c) { if (q.c.x < x0) x0 = q.c.x; if (q.c.x > x1) x1 = q.c.x;
               if (q.c.y < y0) y0 = q.c.y; if (q.c.y > y1) y1 = q.c.y; }
  }
  return x1 > -1e9 ? [x0, y0, x1, y1] : null;
}

function paintGlyph(ctx, font, gl, ox, oy, sc) {
  const closed = { paths: gl.paths.filter((p) => p.closed) };
  const open = { paths: gl.paths.filter((p) => !p.closed) };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = font.weight * sc;
  if (font.mode === 'fill' && closed.paths.length) {
    traceGlyph(ctx, closed.paths, ox, oy, sc);
    ctx.fillStyle = '#fff';
    ctx.fill('nonzero');
  }
  if (font.mode === 'stroke' && closed.paths.length) {
    traceGlyph(ctx, closed.paths, ox, oy, sc);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  if (open.paths.length) {
    traceGlyph(ctx, open.paths, ox, oy, sc);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}

// render single glyph cell preview → canvas (white on transparent)
export function renderGlyphCell(font, ch, size = 40) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const gl = glyphFor(font, ch);
  if (!gl) return c;
  const b = glyphBounds(gl);
  if (!b) return c;
  const gw = Math.max(1, b[2] - b[0]), gh = Math.max(1, b[3] - b[1]);
  const sc = Math.min((size * 0.72) / gw, (size * 0.72) / gh);
  paintGlyph(x, font, gl, (size - gw * sc) / 2 - b[0] * sc, (size + (b[1] + b[3]) * sc) / 2, sc);
  return c;
}

// render a text line → { c: grayscale canvas (black bg, white glyphs, opaque), w, h }
// warp: -1..1 parabolic arc; tracking: extra units between glyphs
export function renderText(font, str, px, opts = {}) {
  const tracking = opts.tracking ?? font.track;
  const warp = opts.warp ?? 0;
  const sys = opts.sysFont || null;
  const pad = Math.round(px * 0.2) + 4;

  const c = document.createElement('canvas');
  const x = c.getContext('2d');

  if (sys) {
    x.font = `${px}px "${sys}"`;
    const w = Math.ceil(x.measureText(str).width) + pad * 2;
    const h = Math.round(px * 1.35) + pad * 2;
    c.width = Math.max(4, w); c.height = Math.max(4, h);
    const x2 = c.getContext('2d');
    x2.fillStyle = '#000'; x2.fillRect(0, 0, w, h);
    x2.fillStyle = '#fff'; x2.font = `${px}px "${sys}"`;
    x2.textBaseline = 'middle';
    x2.fillText(str, pad, h / 2);
    return { c, w, h };
  }

  const sc = px / font.upm;
  const chars = [...str];
  const advs = chars.map((ch) => (ch === ' ' ? font.glyphW * 0.5 : glyphAdvance(font, ch)) * sc + tracking * sc);
  const total = advs.reduce((a, b) => a + b, 0) - tracking * sc;
  const w = Math.max(4, Math.ceil(total) + pad * 2);
  const h = Math.max(4, Math.ceil((font.cap + font.desc) * sc) + pad * 2);
  c.width = w; c.height = h;
  const x2 = c.getContext('2d');
  x2.fillStyle = '#000'; x2.fillRect(0, 0, w, h);
  const baseY = pad + font.cap * sc;
  let pen = pad;
  chars.forEach((ch, i) => {
    const adv = advs[i];
    if (ch !== ' ') {
      const gl = glyphFor(font, ch);
      if (gl) {
        const cx = pen + adv / 2 - tracking * sc / 2;
        const u = (cx - w / 2) / Math.max(1, total);   // -0.5..0.5 along line
        const dy = warp * 3 * h * u * u;               // parabolic arch/sag
        const rot = -warp * u * 0.9;                   // tangent tilt
        x2.save();
        x2.translate(cx, baseY + dy);
        x2.rotate(rot);
        x2.translate(-cx, -(baseY + dy));
        paintGlyph(x2, font, gl, pen, baseY + dy, sc);
        x2.restore();
      }
    }
    pen += adv;
  });
  return { c, w, h };
}

// ---------- rune / sigil generator ----------
// cyber-sigil glyph: spine + branches/hooks/dots in glyph space
export function makeRune(font, rng) {
  const paths = [];
  const W = font.glyphW, H = font.cap;
  const cx = W * (0.3 + rng() * 0.4);
  const stem = { closed: false, pts: [] };
  const yTop = H * (0.85 + rng() * 0.15), yBot = -H * (rng() * 0.2);
  const bend = (rng() - 0.5) * W * 0.25;
  stem.pts.push({ x: cx, y: yTop, c: null });
  if (rng() < 0.5) stem.pts[0].c = { x: cx + bend, y: (yTop + yBot) / 2 };
  stem.pts.push({ x: cx + bend * 0.6, y: yBot, c: null });
  paths.push(stem);

  const nArm = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < nArm; i++) {
    const y = H * (0.15 + rng() * 0.7);
    const dir = rng() < 0.5 ? -1 : 1;
    const len = W * (0.2 + rng() * 0.35);
    const up = (rng() - 0.3) * H * 0.3;
    const arm = { closed: false, pts: [
      { x: cx, y, c: rng() < 0.4 ? { x: cx + dir * len * 0.5, y: y + up * 0.3 } : null },
      { x: cx + dir * len, y: y + up, c: null },
    ] };
    if (rng() < 0.5) arm.pts.push({ x: cx + dir * len * 0.85, y: y + up + (rng() < 0.5 ? -1 : 1) * H * 0.15, c: null });
    paths.push(arm);
  }
  if (rng() < 0.45) {   // dot / eye
    const r = W * (0.05 + rng() * 0.08), dx = cx + (rng() - 0.5) * W * 0.5, dyy = H * (0.3 + rng() * 0.5);
    paths.push({ closed: true, pts: [
      { x: dx - r, y: dyy, c: { x: dx - r, y: dyy + r } },
      { x: dx + r, y: dyy, c: { x: dx + r, y: dyy - r } },
    ] });
  }
  if (rng() < 0.35) {   // chevron crown
    const y = H * (0.9 + rng() * 0.2), sp = W * (0.15 + rng() * 0.15);
    paths.push({ closed: false, pts: [
      { x: cx - sp, y: y - H * 0.12, c: null },
      { x: cx, y, c: null },
      { x: cx + sp, y: y - H * 0.12, c: null },
    ] });
  }
  return { paths, w: W };
}

export function seedRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------- TTF/OTF import (opentype.js → our quad model) ----------
// cubic → 2 quads: de Casteljau split at t=0.5, each half gets quad control
function cubicToQuads(p0, c1, c2, p3) {
  const A = (p0.x + c1.x) / 2, Ay = (p0.y + c1.y) / 2;
  const B = (c1.x + c2.x) / 2, By = (c1.y + c2.y) / 2;
  const C = (c2.x + p3.x) / 2, Cy = (c2.y + p3.y) / 2;
  const D = (A + B) / 2, Dy = (Ay + By) / 2;
  const E = (B + C) / 2, Ey = (By + Cy) / 2;
  const M = (D + E) / 2, My = (Dy + Ey) / 2;
  return [
    { c: { x: (3 * A - p0.x + 3 * D - M.x) / 4, y: (3 * Ay - p0.y + 3 * Dy - My) / 4 },
      p: { x: M.x, y: M.y } },
    { c: { x: (3 * E - M.x + 3 * C - p3.x) / 4, y: (3 * Ey - M.y + 3 * Cy - p3.y) / 4 },
      p: p3 },
  ];
}

export function importTTF(buf, name) {
  const ot = opentype.parse(buf);
  const sc = 700 / (ot.unitsPerEm || 1000);   // normalize to our upm
  const f = newFont(name || 'imported');
  f.upm = 700;
  f.cap = Math.max(200, Math.round((ot.ascender || 700) * sc));
  f.xH = Math.round(f.cap * 0.65);
  f.desc = Math.max(80, Math.round(-(ot.descender || -200) * sc));
  f.mode = 'fill';
  let advSum = 0, advN = 0;
  for (const ch of [...CHARSET]) {
    const gi = ot.charToGlyphIndex(ch);
    if (!gi) continue;                     // missing char → skip .notdef box
    const g = ot.glyphs.get(gi);
    if (!g || !g.path || !g.path.commands.length) continue;
    const paths = [];
    let cur = null;
    for (const cmd of g.path.commands) {
      const X = cmd.x * sc, Y = cmd.y * sc;
      if (cmd.type === 'M') { cur = { closed: false, pts: [{ x: X, y: Y, c: null }] }; paths.push(cur); }
      else if (cmd.type === 'L' && cur) cur.pts.push({ x: X, y: Y, c: null });
      else if (cmd.type === 'Q' && cur) { cur.pts[cur.pts.length - 1].c = { x: cmd.x1 * sc, y: cmd.y1 * sc }; cur.pts.push({ x: X, y: Y, c: null }); }
      else if (cmd.type === 'C' && cur) {
        const p0 = cur.pts[cur.pts.length - 1];
        const quads = cubicToQuads(p0, { x: cmd.x1 * sc, y: cmd.y1 * sc }, { x: cmd.x2 * sc, y: cmd.y2 * sc }, { x: X, y: Y });
        p0.c = quads[0].c;
        cur.pts.push({ x: quads[0].p.x, y: quads[0].p.y, c: quads[1].c });
        cur.pts.push({ x: quads[1].p.x, y: quads[1].p.y, c: null });
      }
      else if (cmd.type === 'Z' && cur) cur.closed = true;
    }
    // CFF/OTF contours auto-close without emitting Z → detect & close
    for (const p of paths) {
      if (p.pts.length < 3) continue;
      const a = p.pts[0], b = p.pts[p.pts.length - 1];
      if (Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6) { p.pts.pop(); p.closed = true; }
      else p.closed = true;   // font contours are always closed shapes
    }
    const adv = Math.round((g.advanceWidth || ot.unitsPerEm * 0.6) * sc);
    if (paths.some((p) => p.pts.length > 1)) {
      f.glyphs[ch] = { paths, w: adv };
      advSum += adv; advN++;
    }
  }
  if (advN) f.glyphW = Math.round(advSum / advN);
  return f;
}

// ---------- export real .ttf ----------
// open (stroke) paths are expanded into quad strips so TTF sees closed outlines
export function exportTTF(font) {
  const K = 1000 / font.upm;                  // scale up to classic upm 1000
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: font.glyphW * K, path: new opentype.Path() })];
  glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: font.glyphW * 0.55 * K, path: new opentype.Path() }));
  const strip = (a, b, w) => {                // segment → thin quad strip
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * w, ny = (dx / L) * w;
    const p = new opentype.Path();
    p.moveTo((a.x + nx) * K, (a.y + ny) * K);
    p.lineTo((b.x + nx) * K, (b.y + ny) * K);
    p.lineTo((b.x - nx) * K, (b.y - ny) * K);
    p.lineTo((a.x - nx) * K, (a.y - ny) * K);
    p.close();
    return p;
  };
  for (const ch of [...CHARSET]) {
    const gl = glyphFor(font, ch);
    if (!gl || !gl.paths.length) continue;
    const path = new opentype.Path();
    const hw = font.weight / 2;
    for (const p of gl.paths) {
      if (p.pts.length < 2) continue;
      if (p.closed) {
        path.moveTo(p.pts[0].x * K, p.pts[0].y * K);
        for (let i = 1; i < p.pts.length + 1; i++) {
          const a = p.pts[i - 1], b = p.pts[i % p.pts.length];
          if (a.c) path.quadraticCurveTo(a.c.x * K, a.c.y * K, b.x * K, b.y * K);
          else path.lineTo(b.x * K, b.y * K);
        }
        path.close();
      } else {
        // stroke-expand each segment
        for (let i = 1; i < p.pts.length; i++) {
          const a = p.pts[i - 1], b = p.pts[i];
          const mid = a.c ? { x: (a.x + 2 * a.c.x + b.x) / 4, y: (a.y + 2 * a.c.y + b.y) / 4 } : null;
          const s = mid
            ? [strip(a, mid, hw), strip(mid, b, hw)]
            : [strip(a, b, hw)];
          for (const q of s.commands) path.commands.push(q);
        }
      }
    }
    if (!path.commands.length) continue;
    glyphs.push(new opentype.Glyph({
      name: ch, unicode: ch.codePointAt(0),
      advanceWidth: (gl.w || font.glyphW) * K,
      path,
    }));
  }
  const otf = new opentype.Font({
    familyName: font.name || 'grotto font',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: font.cap * K,
    descender: -font.desc * K,
    glyphs,
  });
  return otf.toArrayBuffer();
}

// ---------- DESTRUCTIVE ops (typoclast-style) ----------
// ops: {noise, melt, spike, push, rotate, skew, slices, sliceOff, snap, chop}
// returns a NEW glyph — apply destructively
export function distortGlyph(gl, ops, font, rng = Math.random) {
  const paths = gl.paths.map((p) => ({
    closed: p.closed,
    pts: p.pts.map((q) => ({ x: q.x, y: q.y, c: q.c ? { x: q.c.x, y: q.c.y } : null })),
  }));
  const adv = gl.w || font.glyphW;
  const each = (fn) => { for (const p of paths) for (const q of p.pts) { fn(q); if (q.c) fn(q.c); } };
  const b = glyphBounds(gl);
  const cx = b ? (b[0] + b[2]) / 2 : adv / 2, cy = b ? (b[1] + b[3]) / 2 : font.cap / 2;

  // chop: subdivide segments → more nodes to destroy, curves preserved
  if (ops.chop > 0.5) {
    const n = Math.round(ops.chop);
    for (const p of paths) {
      const out = [];
      for (let i = 0; i < p.pts.length; i++) {
        const a = p.pts[i];
        const bq = p.closed ? p.pts[(i + 1) % p.pts.length] : p.pts[i + 1];
        if (!bq || !a.c) { out.push({ ...a }); if (!bq) break; }
        else {
          // subdivide quad into n+1 sub-arcs: anchors at B(t), controls on tangent
          const L = n + 1;
          for (let k = 0; k <= n; k++) {
            const t = k / L;
            const px = (1 - t) ** 2 * a.x + 2 * t * (1 - t) * a.c.x + t ** 2 * bq.x;
            const py = (1 - t) ** 2 * a.y + 2 * t * (1 - t) * a.c.y + t ** 2 * bq.y;
            out.push({
              x: px, y: py,
              c: {
                x: px + ((1 - t) * (a.c.x - a.x) + t * (bq.x - a.c.x)) / L,
                y: py + ((1 - t) * (a.c.y - a.y) + t * (bq.y - a.c.y)) / L,
              },
            });
          }
        }
        for (let k = 1; k <= n && !a.c; k++) {
          const t = k / (n + 1);
          out.push({ x: a.x + (bq.x - a.x) * t, y: a.y + (bq.y - a.y) * t, c: null });
        }
      }
      p.pts = out;
    }
  }
  if (ops.rotate) {
    const r = (ops.rotate * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    each((q) => {
      const dx = q.x - cx, dy = q.y - cy;
      q.x = cx + dx * cs - dy * sn; q.y = cy + dx * sn + dy * cs;
    });
  }
  if (ops.skew) each((q) => { q.x += (q.y - cy) * ops.skew; });
  if (ops.push) {
    const f2 = 1 + ops.push * 0.9;
    each((q) => { q.x = cx + (q.x - cx) * f2; q.y = cy + (q.y - cy) * f2; });
  }
  if (ops.noise) each((q) => {
    q.x += (rng() - 0.5) * 2 * ops.noise;
    q.y += (rng() - 0.5) * 2 * ops.noise;
  });
  if (ops.spike) {
    let k = 0;
    for (const p of paths) for (const q of p.pts) {
      const s = (k++ % 2 ? 1 : -1) * ops.spike;
      const dx = q.x - cx, dy = q.y - cy, L = Math.hypot(dx, dy) || 1;
      q.x += (dx / L) * s * adv * 0.3; q.y += (dy / L) * s * adv * 0.3;
    }
  }
  if (ops.slices >= 1 && ops.sliceOff) {
    const top = b ? b[3] : font.cap, band = font.cap / Math.max(1, Math.round(ops.slices));
    each((q) => {
      const band_i = Math.floor((top - q.y) / band);
      if (band_i % 2) q.x += ops.sliceOff;
    });
  }
  if (ops.melt) {
    each((q) => {
      const depth = Math.max(0, (cy - q.y) / Math.max(1, font.cap));
      q.y -= depth * ops.melt * font.cap * (0.4 + rng() * 0.8);
    });
  }
  if (ops.snap) each((q) => {
    q.x = Math.round(q.x / ops.snap) * ops.snap;
    q.y = Math.round(q.y / ops.snap) * ops.snap;
  });
  return { ...gl, paths };
}

export const DESTROY_PRESETS = {
  sigil:   { noise: 12, spike: 0.4, slices: 0, sliceOff: 0, snap: 40, chop: 0, melt: 0, push: 0, rotate: 0, skew: 0 },
  fossil:  { noise: 26, spike: 0, slices: 0, sliceOff: 0, snap: 0, chop: 1, melt: 0.15, push: 0.1, rotate: 0, skew: 0 },
  glitch:  { noise: 8, spike: 0, slices: 6, sliceOff: 60, snap: 0, chop: 0, melt: 0, push: 0, rotate: 0, skew: 0.1 },
  melt:    { noise: 4, spike: 0, slices: 0, sliceOff: 0, snap: 0, chop: 0, melt: 0.7, push: -0.05, rotate: 0, skew: 0 },
  spike:   { noise: 6, spike: 1, slices: 0, sliceOff: 0, snap: 0, chop: 0, melt: 0, push: -0.15, rotate: 0, skew: 0 },
};
