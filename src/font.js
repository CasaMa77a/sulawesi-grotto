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
