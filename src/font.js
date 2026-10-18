// ---------- custom font engine ----------
// glyph space: y-up in font units (upm), baseline = 0, cap = font.cap, descender = -font.desc
// path: { closed:bool, pts:[{x,y,c:{x,y}|null}] }  — c = quadratic control towards NEXT point
// render: closed paths fill (fill mode) or stroke; open paths always stroke (weight)

export const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?.,-\'/\\:;';

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
    ctx.fill('evenodd');
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

// ---------- font forge: recipe-based glyph generator ----------
// recipe: path = array of [x,y] or [x,y,cx,cy] (cx,cy = quad control to next), 'z' = closed
const R = {
  A: [[[0.05, 0], [0.5, 1], [0.5, 0.7, 0.5, 0.85], [0.95, 0]], [[0.26, 0.34], [0.74, 0.34]]],
  B: [[[0.18, 0], [0.18, 1]],
      [[0.18, 1], [0.62, 0.95, 0.88, 1], [0.88, 0.78, 0.88, 0.95], [0.18, 0.52, 0.85, 0.55]],
      [[0.18, 0.52], [0.66, 0.48, 0.92, 0.5], [0.9, 0.24, 0.92, 0.4], [0.18, 0.02, 0.88, 0.05]]],
  C: [[[0.9, 0.85], [0.2, 0.75, 0.55, 1], [0.08, 0.28, 0.1, 0.62], [0.62, 0.02, 0.16, 0.04], [0.88, 0.18]]],
  D: [[[0.18, 0], [0.18, 1]], [[0.18, 1], [0.75, 0.9, 0.8, 1], [0.9, 0.2, 0.9, 0.6], [0.18, 0.02, 0.75, 0.06]]],
  E: [[[0.8, 1], [0.15, 1], [0.15, 0]], [[0.15, 0.5], [0.62, 0.5]], [[0.15, 0], [0.85, 0]]],
  F: [[[0.15, 0], [0.15, 1], [0.85, 1]], [[0.15, 0.5], [0.62, 0.5]]],
  G: [[[0.9, 0.85], [0.2, 0.75, 0.55, 1], [0.08, 0.28, 0.1, 0.62], [0.62, 0.04, 0.16, 0.04], [0.88, 0.16], [0.88, 0.38], [0.58, 0.38]]],
  H: [[[0.15, 0], [0.15, 1]], [[0.85, 0], [0.85, 1]], [[0.15, 0.5], [0.85, 0.5]]],
  I: [[[0.5, 0], [0.5, 1]], [[0.2, 1], [0.8, 1]], [[0.2, 0], [0.8, 0]]],
  J: [[[0.8, 1], [0.8, 0.1, 0.8, 0.28], [0.3, -0.02, 0.68, -0.04], [0.15, 0.12]]],
  K: [[[0.15, 0], [0.15, 1]], [[0.85, 1], [0.18, 0.42]], [[0.4, 0.55], [0.88, 0]]],
  L: [[[0.18, 1], [0.18, 0], [0.85, 0]]],
  M: [[[0.08, 0], [0.08, 1], [0.5, 0.25], [0.92, 1], [0.92, 0]]],
  N: [[[0.15, 0], [0.15, 1], [0.85, 0], [0.85, 1]]],
  O: [[[0.5, 1], [0.92, 0.5, 0.92, 1], [0.5, 0, 0.92, 0.02], [0.08, 0.5, 0.08, 0.02], [0.5, 1, 0.08, 1], 'z']],
  P: [[[0.18, 0], [0.18, 1]], [[0.18, 1], [0.68, 0.92, 0.9, 1], [0.88, 0.62, 0.9, 0.8], [0.18, 0.5, 0.8, 0.52]]],
  Q: [[[0.5, 1], [0.92, 0.5, 0.92, 1], [0.5, 0, 0.92, 0.02], [0.08, 0.5, 0.08, 0.02], [0.5, 1, 0.08, 1], 'z'],
      [[0.6, 0.22], [0.92, -0.08]]],
  R: [[[0.18, 0], [0.18, 1]], [[0.18, 1], [0.68, 0.92, 0.9, 1], [0.88, 0.62, 0.9, 0.8], [0.18, 0.5, 0.8, 0.52]],
      [[0.55, 0.5], [0.9, 0]]],
  S: [[[0.82, 0.88], [0.28, 0.7, 0.5, 1], [0.18, 0.58, 0.14, 0.66], [0.72, 0.3, 0.25, 0.48], [0.3, 0.02, 0.85, 0.3], [0.16, 0.14]]],
  T: [[[0.05, 1], [0.95, 1]], [[0.5, 1], [0.5, 0]]],
  U: [[[0.12, 1], [0.12, 0.12, 0.12, 0.25], [0.5, 0.02, 0.28, 0], [0.88, 0.2, 0.8, 0.02], [0.88, 1]]],
  V: [[[0.05, 1], [0.5, 0], [0.95, 1]]],
  W: [[[0.05, 1], [0.28, 0], [0.5, 0.6], [0.72, 0], [0.95, 1]]],
  X: [[[0.1, 0], [0.9, 1]], [[0.1, 1], [0.9, 0]]],
  Y: [[[0.08, 1], [0.5, 0.45]], [[0.92, 1], [0.5, 0.45], [0.5, 0]]],
  Z: [[[0.1, 1], [0.9, 1], [0.12, 0], [0.9, 0]]],
  0: [[[0.5, 1], [0.92, 0.5, 0.92, 1], [0.5, 0, 0.92, 0.02], [0.08, 0.5, 0.08, 0.02], [0.5, 1, 0.08, 1], 'z'],
      [[0.78, 0.86], [0.25, 0.15]]],
  1: [[[0.3, 0.8], [0.55, 1], [0.55, 0]], [[0.25, 0], [0.85, 0]]],
  2: [[[0.15, 0.85], [0.7, 0.9, 0.4, 1], [0.85, 0.55, 0.85, 0.78], [0.12, 0.03, 0.6, 0.3], [0.9, 0]]],
  3: [[[0.2, 0.88], [0.65, 0.92, 0.45, 1], [0.85, 0.62, 0.85, 0.8], [0.45, 0.5, 0.75, 0.5], [0.85, 0.22, 0.88, 0.35], [0.45, 0.02, 0.85, 0.08], [0.18, 0.14]]],
  4: [[[0.65, 0], [0.65, 1]], [[0.65, 1], [0.1, 0.32], [0.9, 0.32]]],
  5: [[[0.8, 1], [0.2, 1], [0.18, 0.55]], [[0.18, 0.55], [0.68, 0.48, 0.75, 0.55], [0.85, 0.22, 0.88, 0.38], [0.4, 0.03, 0.85, 0.05], [0.15, 0.15]]],
  6: [[[0.75, 0.9], [0.28, 0.6, 0.45, 1], [0.15, 0.2, 0.16, 0.4], [0.62, 0.02, 0.3, 0.02], [0.85, 0.3, 0.85, 0.2], [0.6, 0.48, 0.82, 0.42], [0.32, 0.35, 0.5, 0.48]]],
  7: [[[0.1, 1], [0.9, 1], [0.45, 0]]],
  8: [[[0.5, 0.5], [0.78, 0.62, 0.85, 0.58], [0.72, 0.9, 0.85, 0.78], [0.28, 0.9, 0.4, 1], [0.15, 0.62, 0.15, 0.8], [0.5, 0.5, 0.22, 0.56], 'z'],
      [[0.5, 0.5], [0.8, 0.38, 0.82, 0.44], [0.78, 0.08, 0.82, 0.2], [0.5, 0, 0.75, 0.02], [0.2, 0.08, 0.22, 0.02], [0.2, 0.4, 0.18, 0.22], [0.5, 0.5, 0.2, 0.44], 'z']],
  9: [[[0.25, 0.1], [0.7, 0.4, 0.55, 0], [0.85, 0.8, 0.84, 0.6], [0.38, 0.98, 0.7, 0.98], [0.15, 0.7, 0.15, 0.8], [0.4, 0.52, 0.18, 0.58], [0.68, 0.65, 0.5, 0.52]]],
  '.': [[[0.45, 0.04], [0.6, 0.04, 0.55, 0.1], [0.45, 0.04, 0.55, -0.02], 'z']],
  ',': [[[0.55, 0.05], [0.5, -0.12, 0.55, -0.02]]],
  '!': [[[0.5, 1], [0.5, 0.25]], [[0.5, 0.05], [0.52, 0.05]]],
  '?': [[[0.2, 0.8], [0.6, 0.9, 0.4, 1], [0.75, 0.62, 0.82, 0.78], [0.5, 0.45, 0.68, 0.55], [0.5, 0.3]], [[0.5, 0.05], [0.52, 0.05]]],
  '-': [[[0.2, 0.5], [0.8, 0.5]]],
  "'": [[[0.5, 1], [0.5, 0.75]]],
  '/': [[[0.1, 0], [0.85, 1]]],
  '\\': [[[0.15, 1], [0.9, 0]]],
  ':': [[[0.5, 0.08], [0.52, 0.08]], [[0.5, 0.6], [0.52, 0.6]]],
  ';': [[[0.5, 0.6], [0.52, 0.6]], [[0.55, 0.05], [0.5, -0.12, 0.55, -0.02]]],
};

// style presets — shared params warping every glyph the same way (font harmony)
export const FORGE_STYLES = {
  gothic: { weight: 96, w: 430, slant: -0.04, curve: 0, serif: 1, fang: 0.5, rough: 0.04, dots: 0, knobs: 0, facet: 0.2 },
  bio:    { weight: 56, w: 560, slant: 0.05, curve: 0.55, serif: 0, fang: 0.1, rough: 0.14, dots: 0.1, knobs: 0, facet: 0, branch: 0.35, drip: 0.25 },
  sigil:  { weight: 30, w: 470, slant: 0, curve: 0.3, serif: 0, fang: 0.15, rough: 0.06, dots: 0.45, knobs: 0, facet: 0.1, chev: 0.5 },
  bone:   { weight: 86, w: 540, slant: 0, curve: 0.45, serif: 0, fang: 0.05, rough: 0.16, dots: 0, knobs: 1, facet: 0 },
  carved: { weight: 64, w: 510, slant: 0, curve: 0.08, serif: 0.5, fang: 0.2, rough: 0.28, dots: 0, knobs: 0, facet: 0.5 },
};

// build one glyph from its recipe in a style — deterministic per (ch, seed)
export function forgeGlyph(font, ch, st, rng, chaos = 0.3) {
  const W = font.glyphW, H = font.cap;
  const rec = R[ch] || R[ch.toUpperCase()];
  const paths = [];
  const j = (a) => (rng() - 0.5) * chaos * a;

  if (rec) {
    for (const spec of rec) {
      const closed = spec[spec.length - 1] === 'z';
      const n = spec.length - (closed ? 1 : 0);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const [nx, ny, ncx, ncy] = spec[i];
        const pt = { x: nx * W + j(W * 0.06), y: ny * H + j(H * 0.06), c: null };
        // style curve: turn straight segments into arcs
        if (ncx !== undefined) pt.c = { x: ncx * W + j(W * 0.06), y: ncy * H + j(H * 0.05) };
        else if (st.curve > 0 && rng() < st.curve)
          pt.c = { x: ((nx + (spec[(i + 1) % n]?.[0] ?? nx)) / 2) * W + j(W * 0.2), y: ny * H + j(H * 0.25) };
        pts.push(pt);
      }
      paths.push({ closed, pts });
    }
    // slant
    if (st.slant) for (const p of paths) for (const q of p.pts) {
      q.x += st.slant * q.y; if (q.c) q.c.x += st.slant * q.c.y;
    }
    // serifs: horizontal ticks at open-path endpoints
    if (st.serif) for (const p of paths.slice()) {
      if (p.closed || !p.pts.length) continue;
      for (const e of [p.pts[0], p.pts[p.pts.length - 1]]) {
        if (e.y > H * 0.85 || e.y < H * 0.15) {
          const sw = W * (0.12 + rng() * 0.1);
          paths.push({ closed: false, pts: [
            { x: e.x - sw, y: e.y, c: null }, { x: e.x + sw, y: e.y + j(H * 0.03), c: null }] });
        }
      }
    }
    // fangs: lowest points drip down
    if (st.fang) for (const p of paths) for (const q of p.pts) {
      if (q.y < H * 0.12 && rng() < st.fang)
        q.y -= H * (0.1 + rng() * 0.3) * (0.4 + chaos);
    }
    // bone knobs at open endpoints
    if (st.knobs) for (const p of paths.slice()) {
      if (p.closed || !p.pts.length) continue;
      for (const e of [p.pts[0], p.pts[p.pts.length - 1]]) {
        const r = W * 0.09;
        paths.push({ closed: true, pts: [
          { x: e.x - r, y: e.y, c: { x: e.x - r, y: e.y + r } },
          { x: e.x + r, y: e.y, c: { x: e.x + r, y: e.y - r } }] });
      }
    }
    // sigil accents: dots + chevrons
    if (st.dots && rng() < st.dots) {
      const r = W * 0.07, dx = W * (0.2 + rng() * 0.6), dy = H * (0.2 + rng() * 0.7);
      paths.push({ closed: true, pts: [
        { x: dx - r, y: dy, c: { x: dx - r, y: dy + r } },
        { x: dx + r, y: dy, c: { x: dx + r, y: dy - r } }] });
    }
    if (st.chev && rng() < st.chev) {
      const y = H * (1.02 + rng() * 0.15), sp = W * 0.18, cx0 = W / 2;
      paths.push({ closed: false, pts: [
        { x: cx0 - sp, y: y - H * 0.12, c: null },
        { x: cx0, y, c: null },
        { x: cx0 + sp, y: y - H * 0.12, c: null }] });
    }
    // organic branches off endpoints
    if (st.branch) for (const p of paths.slice()) {
      if (p.closed || !p.pts.length) continue;
      const e = p.pts[rng() < 0.5 ? 0 : p.pts.length - 1];
      if (rng() < st.branch) {
        const a = rng() * Math.PI * 2, l = W * (0.15 + rng() * 0.2);
        paths.push({ closed: false, pts: [
          { x: e.x, y: e.y, c: null },
          { x: e.x + Math.cos(a) * l, y: e.y + Math.abs(Math.sin(a)) * l * 0.6, c: null }] });
      }
    }
  } else {
    const g = makeRune(font, rng);  // no recipe → rune
    return g;
  }
  return { paths };
}

export function forgeFont(font, styleKey, chaos, seed) {
  const st = FORGE_STYLES[styleKey] || FORGE_STYLES.gothic;
  font.weight = st.weight; font.glyphW = st.w;
  font.mode = st.weight > 60 ? 'fill' : 'stroke';
  font.styleKey = styleKey;
  font.forgeSeed = seed;
  const chars = [...CHARSET];
  chars.forEach((ch, i) => {
    const rng = seedRng(seed + ch.charCodeAt(0) * 7919 + i * 131);
    font.glyphs[ch] = forgeGlyph(font, ch, st, rng, chaos);
  });
}

// ---------- vector glyph fx (apply on top, destructive) ----------
// fx = { inflate, rough, spikes, drip, branch, vein }
export function fxGlyph(font, gl, fx, rng) {
  const W = font.glyphW, H = font.cap;
  const paths = gl.paths.map((p) => ({ closed: p.closed, pts: p.pts.map((q) => ({ ...q, c: q.c ? { ...q.c } : null })) }));

  // bombatura — horizontal bulge, sin profile along cap height
  if (fx.inflate) for (const p of paths) for (const q of p.pts) {
    const k = fx.inflate * W * 0.28 * Math.sin(Math.PI * Math.max(0, Math.min(1, q.y / H)));
    const d = Math.sign(q.x - W / 2) || (rng() < 0.5 ? -1 : 1);
    q.x += k * d;
    if (q.c) q.c.x += k * Math.sign(q.c.x - W / 2 || d);
  }
  // rough — corrode outline
  if (fx.rough) for (const p of paths) for (const q of p.pts) {
    q.x += (rng() - 0.5) * fx.rough * W * 0.2;
    q.y += (rng() - 0.5) * fx.rough * H * 0.12;
  }
  // spikes — push segment midpoints outward (closed paths)
  if (fx.spikes) for (const p of paths) {
    if (!p.closed || p.pts.length < 2) continue;
    const cx0 = p.pts.reduce((a, q) => a + q.x, 0) / p.pts.length;
    const cy0 = p.pts.reduce((a, q) => a + q.y, 0) / p.pts.length;
    const n = p.pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = p.pts[i], b = p.pts[(i + 1) % n];
      out.push(a);
      if (rng() < fx.spikes) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = mx - cx0, dy = my - cy0, l = Math.hypot(dx, dy) || 1;
        const s = W * (0.06 + rng() * 0.12);
        out.push({ x: mx + dx / l * s, y: my + dy / l * s, c: null });
      }
    }
    p.pts = out;
  }
  // drip — melt bottom points down
  if (fx.drip) for (const p of paths) for (const q of p.pts) {
    if (q.y < H * 0.2 && rng() < fx.drip)
      q.y -= H * fx.drip * (0.15 + rng() * 0.4);
  }
  // branch — sprout child paths off ends / midpoints
  if (fx.branch) {
    const seeds = [];
    for (const p of paths) {
      if (p.closed) continue;
      for (const e of [p.pts[0], p.pts[p.pts.length - 1]]) seeds.push(e);
    }
    for (const e of seeds) if (rng() < fx.branch) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.4;
      const l = W * (0.12 + rng() * 0.25);
      const bp = { closed: false, pts: [
        { x: e.x, y: e.y, c: null },
        { x: e.x + Math.cos(a) * l, y: e.y - Math.abs(Math.sin(a)) * l, c: rng() < 0.5
          ? { x: e.x + Math.cos(a) * l * 0.5, y: e.y - l * 0.6 } : null }] };
      paths.push(bp);
      if (rng() < fx.branch)   // second level
        paths.push({ closed: false, pts: [
          bp.pts[1],
          { x: bp.pts[1].x + (rng() - 0.5) * l, y: bp.pts[1].y + l * 0.4, c: null }] });
    }
  }
  // vein — thin wandering lines over the glyph box
  if (fx.vein) {
    const n = Math.round(1 + fx.vein * 4);
    for (let i = 0; i < n; i++) {
      let vx = W * rng(), vy = H * rng();
      const pts = [{ x: vx, y: vy, c: null }];
      const segs = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < segs; k++) {
        vx += (rng() - 0.35) * W * 0.25; vy += (rng() - 0.5) * H * 0.3;
        pts.push({ x: vx, y: vy, c: rng() < 0.4 ? { x: vx - W * 0.1, y: vy + H * 0.1 } : null });
      }
      paths.push({ closed: false, pts });
    }
  }
  return { ...gl, paths };
}
