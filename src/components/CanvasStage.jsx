import { useEffect, useRef, useState } from 'react';
import { fbmNoise, maskFromNoise, edgeMask, blurF32, buildLUT, renderRelief, crackField, hexToRgb, applyDither, floodSelect, globalSelect, rootsField } from '../engine.js';

let layerId = 0;
const mkLayer = (w, h, name) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  return { id: ++layerId, name, on: true, c, ctx, t: { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1 }, bbox: null, blend: 'lighter', opacity: 1 };
};

export default function CanvasStage({ params, apiRef, previewRef, onLayersChange, posRef, onToolChange, onParam, onProject }) {
  const displayRef = useRef(null);
  const [view, setView] = useState({ z: 1, ox: 0, oy: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const st = useRef({
    layers: [], activeIdx: 0,
    comp: null, compCtx: null,
    dirty: true, drawing: false, last: null, eraseHold: false,
    undo: [], bump: null, bumpKey: '', tex: null, texKey: '', img: null, imgSrc: null,
    float: null, stamp: null, wandDrag: false, wandLast: null, lastAlpha: null,
    sel: null, selBBox: null, ants: null, antsPhase: 0, wandDown: false, downPos: null, wandBase: null, selMask: null,
    tmode: null, tinfo: null,
    brushStamp: null, brushKey: '', lcount: 0,
  });
  const pref = useRef(params);
  pref.current = params;
  const W = params.resW || params.res || 1024, H = params.resH || params.res || 1024;
  const emit = () => onLayersChange?.(
    st.current.layers.map((l) => ({ id: l.id, name: l.name, on: l.on, blend: l.blend, opacity: l.opacity, isImage: !!l.isImage, fx: !!l.style })),
    st.current.activeIdx,
    st.current.undo.map((u) => u.tag || '?'),
    st.current.layers[st.current.activeIdx]?.style || null
  );
  const emitRef = useRef(emit);
  emitRef.current = emit;

  // (re)allocate on resolution change — preserve layers by resampling.
  // called from the effect AND checked inside render/onDown so mismatched
  // buffers can never survive a resize
  function ensureSize() {
    const s = st.current;
    // display attrs must always match the doc size — cheap, idempotent
    if (displayRef.current &&
        (displayRef.current.width !== W || displayRef.current.height !== H)) {
      displayRef.current.width = W; displayRef.current.height = H;
      s.dirty = true;
    }
    if (s.comp && s.comp.width === W && s.comp.height === H &&
        (!s.layers.length || (s.layers[0].c.width === W && s.layers[0].c.height === H)))
      return;
    const old = s.layers;
    s.layers = old.length
      ? old.map((l) => {
          const nl = mkLayer(W, H, l.name);
          nl.on = l.on;
          nl.isImage = l.isImage;
          nl.blend = l.blend; nl.opacity = l.opacity;
          nl.t = { ...l.t };
          nl.ctx.drawImage(l.c, 0, 0, W, H);
          return nl;
        })
      : [mkLayer(W, H, 'layer 1')];
    s.lcount = s.layers.length;
    s.activeIdx = Math.min(s.activeIdx, s.layers.length - 1);
    s.comp = document.createElement('canvas');
    s.comp.width = W; s.comp.height = H;
    s.compCtx = s.comp.getContext('2d', { willReadFrequently: true });
    s.wandBase = document.createElement('canvas');
    s.wandBase.width = W; s.wandBase.height = H;
    s.undo = []; s.bump = null; s.tex = null; s.texH = null; s.texKey = ''; s.texHKey = ''; s.bumpKey = '';
    s.float = null; s.smudge = null; s.alphaC = null; s.imgX = null; s.selMask = null;
    s.prevOut = null; s.stamp = null; s.sel = null; s.ants = null;
    if (s.imgSrc) resampleImage();
    s.dirty = true;
    emitRef.current();
  }

  useEffect(() => { ensureSize(); }, [W, H]);

  useEffect(() => {
    if (st.current.stamp) redrawFloat();
    st.current.dirty = true;
  }); // any param change → re-render

  // render loop — via ref so it always runs the LATEST closures
  // (a stale render() would rebuild buffers at the mount-time W×H)
  const frameRef = useRef(null);
  frameRef.current = () => {
    const s = st.current;
    if (s.dirty) { render(); s.dirty = false; }
    // wand mode (selecting): dimmed source + marching ants every frame
    if (pref.current.tool === 'wand' && s.wandBase && !s.stamp) {
      const dctx = displayRef.current.getContext('2d');
      dctx.drawImage(s.wandBase, 0, 0);
      if (s.selMask) dctx.drawImage(s.selMask, 0, 0);
      drawAnts(dctx);
    }
  };
  useEffect(() => {
    let raf;
    const loop = () => { frameRef.current(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ctx = () => st.current.layers[st.current.activeIdx]?.ctx;

  function getBBox(l) {
    if (l.bbox) return l.bbox;
    const d = l.ctx.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (d[(y * W + x) * 4] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    l.bbox = x1 < 0 ? null : [x0, y0, x1, y1];
    return l.bbox;
  }

  // bake a layer transform into its pixels (like PS "apply transform") —
  // without this, strokes on a moved/scaled layer land away from the cursor
  function bakeTransform(l) {
    const t = l.t;
    if (!t || (!t.ox && !t.oy && !t.rot && t.sx === 1 && t.sy === 1)) return;
    const b = getBBox(l) || [W / 2, H / 2, W / 2, H / 2];
    const px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
    const nc = document.createElement('canvas');
    nc.width = W; nc.height = H;
    const nx = nc.getContext('2d');
    nx.translate(px + t.ox, py + t.oy);
    nx.rotate((t.rot * Math.PI) / 180);
    nx.scale(t.sx, t.sy);
    nx.drawImage(l.c, -px, -py);
    l.ctx.clearRect(0, 0, W, H);
    l.ctx.drawImage(nc, 0, 0);
    l.t = { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1 };
    l.bbox = null;
  }

  function pushTransformUndo(l, idx) {
    st.current.undo.push({ idx, img: l.ctx.getImageData(0, 0, W, H), t: { ...l.t }, tag: 'transform' });
    if (st.current.undo.length > 15) st.current.undo.shift();
  }

  function render() {
    ensureSize();
    const s = st.current, p = pref.current;
    if (!s.compCtx || !s.layers.length) return;
    // composite visible layers additively (+ floating stamp if any)
    s.compCtx.globalCompositeOperation = 'source-over';
    s.compCtx.fillStyle = '#000'; s.compCtx.fillRect(0, 0, W, H);
    s.compCtx.globalCompositeOperation = 'lighter';
    for (const l of s.layers) {
      if (!l.on || l.style) continue; // styled layers render separately below
      const t = l.t;
      s.compCtx.globalCompositeOperation = l.blend || 'lighter';
      s.compCtx.globalAlpha = l.opacity ?? 1;
      if (!t.ox && !t.oy && !t.rot && t.sx === 1 && t.sy === 1) {
        s.compCtx.drawImage(l.c, 0, 0);
        continue;
      }
      const b = getBBox(l) || [W / 2, H / 2, W / 2, H / 2];
      const px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
      const offs = p.seamless ? [[0, 0], [W, 0], [-W, 0], [0, H], [0, -H], [W, H], [-W, -H], [W, -H], [-W, H]] : [[0, 0]];
      for (const [ox, oy] of offs) {
        s.compCtx.save();
        s.compCtx.translate(px + t.ox + ox, py + t.oy + oy);
        s.compCtx.rotate((t.rot * Math.PI) / 180);
        s.compCtx.scale(t.sx, t.sy);
        s.compCtx.drawImage(l.c, -px, -py);
        s.compCtx.restore();
      }
    }
    s.compCtx.globalCompositeOperation = 'lighter';
    s.compCtx.globalAlpha = 1;
    if (s.float) s.compCtx.drawImage(s.float, 0, 0);
    const img = s.compCtx.getImageData(0, 0, W, H);
    const alpha = new Float32Array(W * H);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4] / 255;
    s.lastAlpha = alpha;
    rebuildImgX();
    // fast path: half-res preview while drawing/transforming
    const fast = (s.drawing || s.tmode || s.wandDrag) && W >= 1024;
    if (fast) return renderFast(alpha);
    // wand selecting → show source; wand dragging stamp → full relief render (stamp in context)
    if (p.tool === 'wand' && !s.stamp) { renderWandView(); return; }
    const bKey = `${p.emb.bumpScale}|${p.emb.bumpSeed}|${W}|${H}`;
    if (bKey !== s.bumpKey || !s.bump) {
      s.bump = fbmNoise(W, H, { cells: p.emb.bumpScale, octaves: 3, seed: p.emb.bumpSeed });
      s.bumpKey = bKey;
    }
    const tKey = `${p.surf.seed}|${W}|${H}`;
    if (tKey !== s.texKey || !s.tex) {
      s.tex = {
        mottle: fbmNoise(W, H, { cells: 14, octaves: 3, seed: p.surf.seed }),
        grain: fbmNoise(W, H, { cells: Math.round(W / 3), octaves: 1, seed: p.surf.seed + 999 }),
        crack: crackField(W, H, { cells: 24, seed: p.surf.seed + 55 }),
        honey: crackField(W, H, { cells: 42, seed: p.surf.seed + 77 }),
        corro: ridged(W, H, { cells: 60, octaves: 2, seed: p.surf.seed + 33 }),
      };
      s.texKey = tKey;
    }
    s.tex.bump = s.bump;
    const lut = buildLUT(p.curve);
    const out = renderRelief(alpha, W, H, {
      emb: p.emb, lev: p.lev, surf: p.surf, lut, tex: s.tex,
      col: p.col.enabled ? {
        enabled: true, pigAmt: p.col.pigAmt,
        bg: hexToRgb(p.col.bg), lo: hexToRgb(p.col.lo),
        hi: hexToRgb(p.col.hi), pig: hexToRgb(p.col.pig),
      } : null,
      img: (s.imgX || s.img) ? { mode: p.img.mode, amount: p.img.amount, rgb: (s.imgX || s.img).rgb, lum: (s.imgX || s.img).lum } : null,
    });
    if (p.dith.mode !== 'off' || p.dith.pixel > 1) applyDither(out, W, H, p.dith.mode, p.dith.levels, p.dith.pixel);
    displayRef.current.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    // styled layers: own relief pipeline (snapshot params), composited on top
    const dctx = displayRef.current.getContext('2d');
    for (const l of s.layers) {
      if (!l.on || !l.style) continue;
      if (!s.fxTmp || s.fxTmp.width !== W || s.fxTmp.height !== H) {
        s.fxTmp = document.createElement('canvas');
        s.fxTmp.width = W; s.fxTmp.height = H;
      }
      const fxCtx = s.fxTmp.getContext('2d', { willReadFrequently: true });
      const st2 = l.style;
      const img2 = l.ctx.getImageData(0, 0, W, H);
      const a2 = new Float32Array(W * H);
      for (let k = 0; k < a2.length; k++) a2[k] = img2.data[k * 4] / 255;
      const o2 = renderRelief(a2, W, H, {
        emb: st2.emb, lev: st2.lev, surf: st2.surf, lut: buildLUT(st2.curve), tex: s.tex,
        col: st2.col?.enabled ? {
          enabled: true, pigAmt: st2.col.pigAmt,
          bg: hexToRgb(st2.col.bg), lo: hexToRgb(st2.col.lo),
          hi: hexToRgb(st2.col.hi), pig: hexToRgb(st2.col.pig),
        } : null,
        img: null,
      });
      if (p.dith.mode !== 'off' || p.dith.pixel > 1) applyDither(o2, W, H, p.dith.mode, p.dith.levels, p.dith.pixel);
      for (let k = 0; k < a2.length; k++) o2[k * 4 + 3] = Math.round(a2[k] * 255); // transparent outside strokes
      fxCtx.putImageData(new ImageData(o2, W, H), 0, 0);
      dctx.save();
      dctx.globalCompositeOperation = l.blend || 'lighter';
      dctx.globalAlpha = l.opacity ?? 1;
      dctx.drawImage(s.fxTmp, 0, 0);
      dctx.restore();
    }
    if (p.tool === 'wand' && s.stamp) drawStampUI();
    if (p.tool === 'move') drawMoveUI();
    s.version = (s.version || 0) + 1;
    updateTilePreview();
  }

  function updateTilePreview() {
    const pv = previewRef?.current;
    if (!pv || !displayRef.current) return;
    const c = pv.getContext('2d');
    const n = 3, s = pv.width / n;
    c.fillStyle = '#000'; c.fillRect(0, 0, pv.width, pv.height);
    c.imageSmoothingEnabled = true;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        c.drawImage(displayRef.current, x * s, y * s, s, s);
  }

  // half-res pipeline for fluid drawing — final quality restored on pointerup
  function renderFast(alphaF) {
    const s = st.current, p = pref.current;
    const rw = W >> 1, rh = H >> 1;
    const alpha = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++)
        alpha[y * rw + x] = alphaF[y * 2 * W + x * 2];
    const key = `${p.emb.bumpScale}|${p.emb.bumpSeed}|${p.surf.seed}|${rw}|${rh}`;
    if (s.texHKey !== key || !s.texH) {
      s.texH = {
        bump: fbmNoise(rw, rh, { cells: p.emb.bumpScale, octaves: 3, seed: p.emb.bumpSeed }),
        mottle: fbmNoise(rw, rh, { cells: 14, octaves: 3, seed: p.surf.seed }),
        grain: fbmNoise(rw, rh, { cells: Math.round(rw / 3), octaves: 1, seed: p.surf.seed + 999 }),
        crack: crackField(rw, rh, { cells: 24, seed: p.surf.seed + 55 }),
        honey: crackField(rw, rh, { cells: 42, seed: p.surf.seed + 77 }),
        corro: ridged(rw, rh, { cells: 60, octaves: 2, seed: p.surf.seed + 33 }),
      };
      s.texHKey = key;
    }
    const lut = buildLUT(p.curve);
    // scale px-space params to half-res so the preview matches final width
    const k = rw / W;
    const embH = { ...p.emb, size: p.emb.size * k, soften: p.emb.soften * k };
    const out = renderRelief(alpha, rw, rh, {
      emb: embH, lev: p.lev, surf: p.surf, lut, tex: s.texH,
      col: p.col.enabled ? {
        enabled: true, pigAmt: p.col.pigAmt,
        bg: hexToRgb(p.col.bg), lo: hexToRgb(p.col.lo),
        hi: hexToRgb(p.col.hi), pig: hexToRgb(p.col.pig),
      } : null,
      img: null,
    });
    if (!s.prevOut || s.prevOut.width !== rw || s.prevOut.height !== rh) {
      s.prevOut = document.createElement('canvas');
      s.prevOut.width = rw; s.prevOut.height = rh;
    }
    s.prevOut.getContext('2d').putImageData(new ImageData(out, rw, rh), 0, 0);
    const dctx = displayRef.current.getContext('2d');
    dctx.imageSmoothingEnabled = true;
    dctx.drawImage(s.prevOut, 0, 0, W, H);
    // styled layers: half-res relief pass each — same material look while drawing
    for (const l of s.layers) {
      if (!l.on || !l.style) continue;
      if (!s.fxSrc || s.fxSrc.width !== rw || s.fxSrc.height !== rh) {
        s.fxSrc = document.createElement('canvas');
        s.fxSrc.width = rw; s.fxSrc.height = rh;
      }
      const fs = s.fxSrc.getContext('2d', { willReadFrequently: true });
      fs.drawImage(l.c, 0, 0, rw, rh);
      const d2 = fs.getImageData(0, 0, rw, rh).data;
      const a2 = new Float32Array(rw * rh);
      for (let k = 0; k < a2.length; k++) a2[k] = d2[k * 4] / 255;
      const st2 = l.style;
      const embH2 = { ...st2.emb, size: st2.emb.size * k, soften: st2.emb.soften * k };
      const o2 = renderRelief(a2, rw, rh, {
        emb: embH2, lev: st2.lev, surf: st2.surf, lut: buildLUT(st2.curve), tex: s.texH,
        col: st2.col?.enabled ? {
          enabled: true, pigAmt: st2.col.pigAmt,
          bg: hexToRgb(st2.col.bg), lo: hexToRgb(st2.col.lo),
          hi: hexToRgb(st2.col.hi), pig: hexToRgb(st2.col.pig),
        } : null,
        img: null,
      });
      for (let k = 0; k < a2.length; k++) o2[k * 4 + 3] = Math.round(a2[k] * 255);
      if (!s.fxTmpH || s.fxTmpH.width !== rw || s.fxTmpH.height !== rh) {
        s.fxTmpH = document.createElement('canvas');
        s.fxTmpH.width = rw; s.fxTmpH.height = rh;
      }
      s.fxTmpH.getContext('2d').putImageData(new ImageData(o2, rw, rh), 0, 0);
      dctx.save();
      dctx.globalCompositeOperation = l.blend || 'lighter';
      dctx.globalAlpha = l.opacity ?? 1;
      dctx.drawImage(s.fxTmpH, 0, 0, W, H);
      dctx.restore();
    }
    if (p.tool === 'wand' && s.stamp) drawStampUI();
    if (p.tool === 'move') drawMoveUI();
    s.version = (s.version || 0) + 1;
  }

  // wand base: source image (or composite alpha) rendered into s.wandBase canvas
  function renderWandView() {
    const s = st.current;
    const dctx = s.wandBase.getContext('2d');
    const out = new Uint8ClampedArray(W * H * 4);
    const src = s.imgX || s.img;
    if (src) {
      for (let i = 0; i < W * H; i++) {
        const o = i * 4, io = i * 3;
        out[o] = src.rgb[io] * 255; out[o + 1] = src.rgb[io + 1] * 255;
        out[o + 2] = src.rgb[io + 2] * 255; out[o + 3] = 255;
      }
    } else if (s.lastAlpha) {
      for (let i = 0; i < W * H; i++) {
        const o = i * 4, g = s.lastAlpha[i] * 255;
        out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
      }
    }
    dctx.putImageData(new ImageData(out, W, H), 0, 0);
  }

  // marching ants: animated dashed outline along selection edges
  function rebuildAnts() {
    const s = st.current;
    s.ants = [];
    const m = s.sel;
    if (!m) return;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (m[i] && (x === 0 || !m[i - 1] || x === W - 1 || !m[i + 1] ||
                     y === 0 || !m[i - W] || y === H - 1 || !m[i + W])) {
          s.ants.push((y << 16) | x);
        }
      }
    }
  }

  // dim overlay: everything NOT selected goes dark (quick-mask style)
  function rebuildSelMask() {
    const s = st.current;
    if (!s.sel) { s.selMask = null; return; }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cc = c.getContext('2d');
    const id = cc.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      if (!s.sel[i]) { const o = i * 4; id.data[o + 3] = 200; }
    }
    cc.putImageData(id, 0, 0);
    s.selMask = c;
  }

  function drawAnts(dctx) {
    const s = st.current;
    if (!s.ants || !s.ants.length) return;
    const ph = ((s.antsPhase += 0.3) | 0) % 8;
    const prev = dctx.fillStyle;
    for (const pk of s.ants) {
      const x = pk & 0xffff, y = pk >> 16;
      dctx.fillStyle = (((x + y - ph) & 7) < 4) ? '#fff' : '#000';
      dctx.fillRect(x, y, 1, 1);
    }
    dctx.fillStyle = prev;
  }

  function selBBox(m) {
    let minx = W, maxx = 0, miny = H, maxy = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (m[y * W + x]) {
        n++;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
    return n ? [minx, miny, maxx, maxy] : null;
  }

  function ensureFloat() {
    const s = st.current;
    if (!s.float) {
      s.float = document.createElement('canvas');
      s.float.width = W; s.float.height = H;
    }
    return s.float;
  }

  function redrawFloat() {
    const s = st.current;
    const f = ensureFloat(), fc = f.getContext('2d');
    fc.clearRect(0, 0, W, H);
    if (!s.stamp) return;
    const t = pref.current.stamp;
    fc.save();
    fc.translate(s.stamp.pos[0] + s.stamp.w / 2, s.stamp.pos[1] + s.stamp.h / 2);
    fc.rotate((t.rot * Math.PI) / 180);
    fc.scale(t.sx, t.sy);
    fc.globalAlpha = t.gain;
    fc.drawImage(t.invert ? s.stamp.ci : s.stamp.c, -s.stamp.w / 2, -s.stamp.h / 2);
    fc.restore();
    s.dirty = true;
  }

  function wandDown(e) {
    const s = st.current, p2 = pref.current;
    const p = pos(e);
    const src = (s.imgX || s.img)?.lum || s.lastAlpha;
    if (!src) return;
    const bl = p2.wand.blur > 0.5 ? blurF32(src, W, H, p2.wand.blur, 1) : src;
    const cx = Math.max(0, Math.min(W - 1, Math.round(p[0])));
    const cy = Math.max(0, Math.min(H - 1, Math.round(p[1])));
    const res = p2.wand.contig
      ? floodSelect(bl, W, H, cx, cy, p2.wand.tol)
      : globalSelect(bl, W, H, cx, cy, p2.wand.tol);
    let m = res.mask;
    if (!res.count && !(e.shiftKey || e.altKey)) {
      s.sel = null; s.selBBox = null; s.ants = []; s.selMask = null; s.dirty = true; return;
    }
    if (e.shiftKey && s.sel) {
      const u = new Uint8Array(W * H);
      for (let i = 0; i < u.length; i++) u[i] = s.sel[i] | m[i];
      m = u;
    } else if (e.altKey && s.sel) {
      const u = new Uint8Array(W * H);
      for (let i = 0; i < u.length; i++) u[i] = s.sel[i] & (m[i] ? 0 : 1);
      m = u;
    }
    s.sel = m; s.selBBox = selBBox(m);
    s.wandDown = true; s.downPos = p;
    rebuildAnts();
    rebuildSelMask();
    s.dirty = true;
  }

  // ridged noise (sharp creases) for corrosion crust
  function ridged(w, h, o) {
    const n = fbmNoise(w, h, o);
    for (let i = 0; i < n.length; i++) n[i] = 1 - Math.abs(2 * n[i] - 1);
    return n;
  }

  // image blend source = the image layer WITH its transform applied
  // (moving/scaling the image layer moves the blend + wand picks the transformed photo)
  function rebuildImgX() {
    const s = st.current;
    const il = s.layers.find((l) => l.isImage);
    if (!il) { s.imgX = null; return; }
    if (!s.imgX || s.imgX.w !== W) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      s.imgX = { c, rgb: new Float32Array(W * H * 3), lum: new Float32Array(W * H), w: W };
    }
    const ic = s.imgX.c.getContext('2d');
    ic.fillStyle = '#000'; ic.fillRect(0, 0, W, H);
    const t = il.t, b = getBBox(il) || [0, 0, W, H];
    const px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
    ic.save();
    ic.translate(px + t.ox, py + t.oy);
    ic.rotate((t.rot * Math.PI) / 180);
    ic.scale(t.sx, t.sy);
    ic.drawImage(il.c, -px, -py);
    ic.restore();
    const d = ic.getImageData(0, 0, W, H).data;
    const { rgb, lum } = s.imgX;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      rgb[i * 3] = d[o] / 255; rgb[i * 3 + 1] = d[o + 1] / 255; rgb[i * 3 + 2] = d[o + 2] / 255;
      lum[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
    }
  }

  // ---------- free transform (stamp) ----------
  function stampXform() {
    const s = st.current, t = pref.current.stamp;
    return {
      cx: s.stamp.pos[0] + s.stamp.w / 2, cy: s.stamp.pos[1] + s.stamp.h / 2,
      rot: (t.rot * Math.PI) / 180, sx: t.sx, sy: t.sy,
    };
  }

  function stampPts() {
    const s = st.current, { cx, cy, rot, sx, sy } = stampXform();
    const hw = s.stamp.w / 2, hh = s.stamp.h / 2;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const T = (x, y) => [cx + x * sx * ca - y * sy * sa, cy + x * sx * sa + y * sy * ca];
    return {
      corners: [T(-hw, -hh), T(hw, -hh), T(hw, hh), T(-hw, hh)],
      topMid: T(0, -hh), rotH: T(0, -hh - 30),
    };
  }

  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  function stampHitTest(p) {
    const { corners, rotH } = stampPts();
    const R = 12;
    for (let i = 0; i < 4; i++) if (dist2(p, corners[i]) < R) return 'scale';
    if (dist2(p, rotH) < R + 4) return 'rot';
    if (pointInPoly(p, corners)) return 'move';
    return null;
  }

  function drawStampUI() {
    const s = st.current;
    if (!s.stamp) return;
    const { corners, topMid, rotH } = stampPts();
    drawBoxUI(displayRef.current.getContext('2d'), corners, topMid, rotH);
  }

  function drawBoxUI(dctx, corners, topMid, rotH) {
    dctx.save();
    dctx.strokeStyle = '#fff';
    dctx.setLineDash([5, 4]);
    dctx.lineDashOffset = -st.current.antsPhase;
    dctx.lineWidth = 1;
    dctx.beginPath();
    corners.forEach((c, i) => (i ? dctx.lineTo(c[0], c[1]) : dctx.moveTo(c[0], c[1])));
    dctx.closePath();
    dctx.stroke();
    dctx.setLineDash([]);
    dctx.beginPath(); dctx.moveTo(topMid[0], topMid[1]); dctx.lineTo(rotH[0], rotH[1]);
    dctx.strokeStyle = 'rgba(255,255,255,.5)'; dctx.stroke();
    for (const c of corners) {
      dctx.fillStyle = '#fff'; dctx.fillRect(c[0] - 4, c[1] - 4, 8, 8);
      dctx.strokeStyle = '#000'; dctx.strokeRect(c[0] - 4, c[1] - 4, 8, 8);
    }
    dctx.beginPath(); dctx.arc(rotH[0], rotH[1], 5, 0, 7);
    dctx.fillStyle = '#fff'; dctx.fill();
    dctx.strokeStyle = '#000'; dctx.stroke();
    dctx.restore();
  }

  // layer geometry under its transform (pivot = content bbox center)
  function layerPts(l) {
    const b = getBBox(l);
    if (!b) return null;
    const px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
    const hw = (b[2] - b[0]) / 2, hh = (b[3] - b[1]) / 2, t = l.t;
    const rot = (t.rot * Math.PI) / 180, ca = Math.cos(rot), sa = Math.sin(rot);
    const T = (x, y) => [px + t.ox + x * t.sx * ca - y * t.sy * sa,
                         py + t.oy + x * t.sx * sa + y * t.sy * ca];
    return {
      corners: [T(-hw, -hh), T(hw, -hh), T(hw, hh), T(-hw, hh)],
      topMid: T(0, -hh), rotH: T(0, -hh - 30), px, py,
    };
  }

  function layerHitTest(p) {
    const s = st.current;
    for (let i = s.layers.length - 1; i >= 0; i--) {
      const l = s.layers[i];
      if (!l.on) continue;
      const t = l.t, b = getBBox(l);
      if (!b) continue;
      const px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
      // inverse-transform point into layer space
      const dx = p[0] - px - t.ox, dy = p[1] - py - t.oy;
      const rot = (-t.rot * Math.PI) / 180, ca = Math.cos(rot), sa = Math.sin(rot);
      const lx = (dx * ca - dy * sa) / (t.sx || 1e-6), ly = (dx * sa + dy * ca) / (t.sy || 1e-6);
      const gx = Math.round(px + lx), gy = Math.round(py + ly);
      if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
      // wrap-aware check: also test wrapped coords
      let hit = l.ctx.getImageData(gx, gy, 1, 1).data[0] > 10;
      if (!hit && pref.current.seamless) {
        for (const [ox, oy] of [[W, 0], [-W, 0], [0, H], [0, -H]]) {
          const wx = gx + ox, wy = gy + oy;
          if (wx >= 0 && wx < W && wy >= 0 && wy < H &&
              l.ctx.getImageData(wx, wy, 1, 1).data[0] > 10) { hit = true; break; }
        }
      }
      if (hit) return i;
    }
    return -1;
  }

  function drawMoveUI() {
    const s = st.current;
    const l = s.layers[s.activeIdx];
    if (!l) return;
    const pts = layerPts(l);
    if (pts) drawBoxUI(displayRef.current.getContext('2d'), pts.corners, pts.topMid, pts.rotH);
  }

  // build floating stamp from current selection (like PS dragging a selection)
  function buildStampFromSel() {
    const s = st.current;
    if (!s.sel || !s.selBBox) return;
    const [x0, y0, x1, y1] = s.selBBox, sw = x1 - x0 + 1, sh = y1 - y0 + 1;
    const srcv = (s.imgX || s.img)?.lum || s.lastAlpha;
    const c = document.createElement('canvas'), ci = document.createElement('canvas');
    c.width = ci.width = sw; c.height = ci.height = sh;
    const id = c.getContext('2d').createImageData(sw, sh);
    const idi = ci.getContext('2d').createImageData(sw, sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const gi = (y0 + y) * W + x0 + x, o = (y * sw + x) * 4;
        const v = s.sel[gi] ? (srcv[gi] * 255) | 0 : 0;
        id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
        idi.data[o] = idi.data[o + 1] = idi.data[o + 2] = 255 - v; idi.data[o + 3] = 255;
      }
    }
    c.getContext('2d').putImageData(id, 0, 0);
    ci.getContext('2d').putImageData(idi, 0, 0);
    s.stamp = { c, ci, w: sw, h: sh, pos: [x0, y0] };
    redrawFloat();
  }

  function commitStamp() {
    const s = st.current;
    if (!s.stamp || !s.float) return;
    // stamp onto a NEW layer above the active one (like PS paste)
    const nl = mkLayer(W, H, `stamp ${++s.lcount}`);
    nl.ctx.globalCompositeOperation = 'lighter';
    nl.ctx.drawImage(s.float, 0, 0);
    nl.ctx.globalCompositeOperation = 'source-over';
    const ni = s.activeIdx + 1;
    s.layers.splice(ni, 0, nl);
    s.undo.push({ delLayer: ni, tag: 'stamp ↓' });
    if (s.undo.length > 15) s.undo.shift();
    s.activeIdx = ni;
    s.stamp = null; s.sel = null; s.selBBox = null; s.ants = []; s.selMask = null;
    s.float.getContext('2d').clearRect(0, 0, W, H);
    s.dirty = true;
    emitRef.current();
  }

  function discardStamp() {
    const s = st.current;
    s.stamp = null; s.sel = null; s.selBBox = null; s.ants = []; s.selMask = null;
    if (s.float) s.float.getContext('2d').clearRect(0, 0, W, H);
    s.dirty = true;
  }

  // ---------- drawing ----------
  function getBrushStamp() {
    const s = st.current, p = pref.current.brush;
    const key = `${p.size}|${p.soft}|${p.type}`;
    if (key !== s.brushKey) {
      const r = p.size, d = r * 2 + 4;
      const c = document.createElement('canvas');
      c.width = c.height = d;
      const x = c.getContext('2d');
      x.translate(d / 2, d / 2);
      if (p.type.startsWith('cb:')) {
        // custom brush — image/layer capture: luminance → alpha stamp
        const entry = (pref.current.brushLib || []).find((b) => `cb:${b.id}` === p.type);
        s.brushImgs = s.brushImgs || {};
        let img = entry && s.brushImgs[entry.url];
        if (entry && !img) { img = new Image(); img.src = entry.url; s.brushImgs[entry.url] = img; }
        if (img && img.complete && img.naturalWidth) {
          const sc = Math.min(d / img.naturalWidth, d / img.naturalHeight);
          x.drawImage(img, -img.naturalWidth * sc / 2, -img.naturalHeight * sc / 2, img.naturalWidth * sc, img.naturalHeight * sc);
          const id2 = x.getImageData(0, 0, d, d);
          for (let i = 0; i < id2.data.length; i += 4) {
            const l = id2.data[i] * 0.5 + id2.data[i + 1] * 0.35 + id2.data[i + 2] * 0.15;
            id2.data[i] = id2.data[i + 1] = id2.data[i + 2] = 255;
            id2.data[i + 3] = Math.min(255, l * (id2.data[i + 3] / 255) * 1.5);
          }
          x.putImageData(id2, 0, 0);
          if (p.soft > 0.01) { // feather edge
            const g2 = x.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
            g2.addColorStop(Math.max(0.01, 1 - p.soft), 'rgba(0,0,0,1)');
            g2.addColorStop(1, 'rgba(0,0,0,0)');
            x.globalCompositeOperation = 'destination-in';
            x.fillStyle = g2; x.fillRect(-d / 2, -d / 2, d, d);
            x.globalCompositeOperation = 'source-over';
          }
        } else { // still decoding → soft placeholder
          const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
          g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(-d, -d, d * 2, d * 2);
        }
      } else if (p.type === 'shard' || p.type === 'rune') {
        // pointed diamond — spiky sigil strokes
        const g = x.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(0, -r); x.lineTo(r * 0.22, 0); x.lineTo(0, r); x.lineTo(-r * 0.22, 0);
        x.closePath(); x.fill();
      } else if (p.type === 'spine') {
        // vertebra: central disc + dorsal spikes — chains into a bone column
        x.fillStyle = 'rgba(255,255,255,.95)';
        x.beginPath(); x.ellipse(0, 0, r * 0.32, r * 0.42, 0, 0, 7); x.fill();
        x.beginPath(); x.ellipse(0, -r * 0.45, r * 0.11, r * 0.22, 0, 0, 7); x.fill();
        x.beginPath(); x.ellipse(0, r * 0.45, r * 0.11, r * 0.22, 0, 0, 7); x.fill();
        x.beginPath(); x.ellipse(-r * 0.3, 0, r * 0.14, r * 0.18, 0, 0, 7); x.fill();
        x.beginPath(); x.ellipse(r * 0.3, 0, r * 0.14, r * 0.18, 0, 0, 7); x.fill();
      } else if (p.type === 'ribs') {
        // curved ribcage tines perpendicular to travel
        x.strokeStyle = 'rgba(255,255,255,.9)';
        x.lineWidth = Math.max(1.5, r * 0.1);
        x.lineCap = 'round';
        const step = Math.max(3, r * 0.3);
        for (let yy = -r; yy <= r; yy += step) {
          x.beginPath();
          x.moveTo(0, yy);
          x.quadraticCurveTo(r * 0.5, yy + step * 0.35, r * 0.32, yy + step * 0.95);
          x.stroke();
        }
      } else if (p.type === 'teeth') {
        // ribbed comb — biomech ridges perpendicular to travel
        x.fillStyle = 'rgba(255,255,255,.95)';
        const tw = r * 0.28, step = Math.max(2, r * 0.22);
        for (let yy = -r; yy < r; yy += step) {
          x.beginPath();
          x.moveTo(0, yy); x.lineTo(tw, yy + step / 2); x.lineTo(0, yy + step);
          x.closePath(); x.fill();
        }
      } else {
        // soft round / chisel (ellipse squashed) / hair (ultra thin)
        const sq = p.type === 'chisel' ? 0.3 : p.type === 'hair' ? 0.08 : p.type === 'vein' ? 0.15 : 1;
        x.scale(1, sq);
        const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
        const inner = Math.max(0.01, 1 - p.soft);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(inner, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(-d, -d, d * 2, d * 2);
      }
      s.brushStamp = c; s.brushKey = key;
      // don't cache a placeholder for a custom brush still decoding
      if (p.type.startsWith('cb:')) {
        const e2 = (pref.current.brushLib || []).find((b) => `cb:${b.id}` === p.type);
        const im = e2 && s.brushImgs?.[e2.url];
        if (!im || !im.complete || !im.naturalWidth) s.brushKey = '';
      }
    }
    return s.brushStamp;
  }

  function symPoints(x, y) {
    const mode = pref.current.symmetry, cx = W / 2, cy = H / 2;
    switch (mode) {
      case 'x': return [[x, y], [W - x, y]];
      case 'y': return [[x, y], [x, H - y]];
      case 'quad': return [[x, y], [W - x, y], [x, H - y], [W - x, H - y]];
      case 'k8': {
        const pts = [];
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4, ca = Math.cos(a), sa = Math.sin(a);
          let dx = x - cx, dy = y - cy;
          if (k % 2 === 1) dx = -dx;
          pts.push([cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]);
        }
        return pts;
      }
      default: {
        if (mode.startsWith('r')) {
          const n = Math.max(3, +mode.slice(1));
          const pts = [];
          const dx = x - cx, dy = y - cy;
          for (let k = 0; k < n; k++) {
            const a = (k * 2 * Math.PI) / n, ca = Math.cos(a), sa = Math.sin(a);
            pts.push([cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]);
          }
          return pts;
        }
        return [[x, y]];
      }
    }
  }

  function offsetsFor(x, y, r) {
    if (!pref.current.seamless) return [[0, 0]];
    const xs = [0], ys = [0];
    if (x - r < 0) xs.push(W);
    if (x + r > W) xs.push(-W);
    if (y - r < 0) ys.push(H);
    if (y + r > H) ys.push(-H);
    const out = [];
    for (const ox of xs) for (const oy of ys) out.push([ox, oy]);
    return out;
  }

  function stamp(x, y, erase, ang = 0, scl = 1) {
    const s = st.current, p = pref.current;
    const bmp = getBrushStamp(), d = bmp.width;
    const c = ctx();
    if (!c) return;
    const b = p.brush;
    c.globalCompositeOperation = erase ? 'destination-out' : 'lighter';
    if (b.type === 'spore') {
      // scatter of tiny specks — decay/mould organic texture
      c.fillStyle = '#fff';
      for (const [px, py] of symPoints(x, y)) {
        for (const [ox, oy] of offsetsFor(px, py, b.size * scl)) {
          const n = 5 + Math.floor(b.size * (0.3 + b.jitter) / 3);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * b.size * scl;
            const sz = 1 + Math.random() * 2.5;
            c.globalAlpha = b.gain * (0.35 + Math.random() * 0.65);
            c.fillRect(px + ox + Math.cos(a) * rr - sz / 2, py + oy + Math.sin(a) * rr - sz / 2, sz, sz);
          }
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      const al0 = st.current.layers[st.current.activeIdx];
      if (al0) al0.bbox = null;
      return;
    }
    let rot = b.follow ? ang : (b.angle * Math.PI) / 180;
    if (b.type === 'rune') rot += (Math.random() - 0.5) * 2.4;
    c.globalAlpha = b.gain;
    for (const [px, py] of symPoints(x, y)) {
      for (const [ox, oy] of offsetsFor(px, py, b.size * scl)) {
        let sc = scl, jx = px + ox, jy = py + oy;
        if (b.type === 'drip') {
          sc *= 0.6 + Math.random() * 0.9 * (0.4 + b.jitter);
          jx += (Math.random() - 0.5) * b.size * b.jitter;
          jy += (Math.random() - 0.5) * b.size * b.jitter;
        }
        if (b.type === 'rune') {
          jx += (Math.random() - 0.5) * b.size * 0.6;
          jy += (Math.random() - 0.5) * b.size * 0.6;
          sc *= 0.7 + Math.random() * 0.6;
        }
        c.save();
        c.translate(jx, jy);
        c.rotate(rot);
        c.scale(sc, sc);
        c.drawImage(bmp, -d / 2, -d / 2);
        c.restore();
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    const al = st.current.layers[st.current.activeIdx];
    if (al) al.bbox = null;
  }

  function line(a, b, erase) {
    const s = st.current, bp = pref.current.brush;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, bp.size * 0.25);
    const n = Math.max(1, Math.ceil(dist / step));
    const ang = Math.atan2(dy, dx);
    // taper brush: ramp-in by stroke length + thinner when moving fast (ink feel)
    let scl = 1;
    s.strokeDist = (s.strokeDist || 0) + dist;
    if (bp.type === 'taper') {
      const now = performance.now();
      const dt = Math.max(1, now - (s.lastT || now));
      s.lastT = now;
      const ramp = Math.min(1, s.strokeDist / 70);
      const vel = Math.max(0.2, Math.min(1.3, 1.5 / (1 + (dist / dt) * 1.4)));
      scl = vel * (0.3 + 0.7 * ramp);
    }
    // vein brush: perpendicular sine wobble — sinuous capillary strokes
    let wx = 0, wy = 0;
    if (bp.type === 'vein') {
      const w = Math.sin(s.strokeDist * 0.07) * bp.size * (0.2 + bp.jitter) * 0.9;
      wx = -Math.sin(ang) * w; wy = Math.cos(ang) * w;
    }
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      stamp(a[0] + dx * t + wx, a[1] + dy * t + wy, erase, ang, scl);
    }
  }

  // ---------- smudge ----------
  // wet pickup buffer dragged along the stroke — smears relief like clay
  function smudgeInit(p) {
    const s = st.current, c = ctx();
    const d = pref.current.brush.size * 2 + 4;
    if (!s.smudge) s.smudge = document.createElement('canvas');
    s.smudge.width = s.smudge.height = d;
    if (c) s.smudge.getContext('2d').drawImage(c.canvas, p[0] - d / 2, p[1] - d / 2, d, d, 0, 0, d, d);
  }

  function smudgeLine(a, b) {
    const s = st.current, c = ctx(), bp = pref.current.brush;
    if (!c || !s.smudge) return;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(dist / Math.max(1, bp.size * 0.3)));
    const d = s.smudge.width, sctx = s.smudge.getContext('2d');
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      c.globalAlpha = Math.min(1, bp.gain * 1.2 + 0.3);
      for (const [ox, oy] of offsetsFor(x, y, d / 2))
        c.drawImage(s.smudge, x + ox - d / 2, y + oy - d / 2);
      c.globalAlpha = 1;
      // pick up paint under the cursor → the smear trails
      sctx.globalAlpha = 0.3;
      sctx.drawImage(c.canvas, x - d / 2, y - d / 2, d, d, 0, 0, d, d);
      sctx.globalAlpha = 1;
    }
    const al = s.layers[s.activeIdx];
    if (al) al.bbox = null;
  }

  // ---------- liquify ----------
  // forward-warp: each step clips a circle and redraws the layer displaced +
  // stretched along the drag direction → forms taper into spikes/drips
  function liquifyLine(a, b) {
    const s = st.current, c = ctx(), bp = pref.current.brush;
    if (!c) return;
    const r = Math.max(8, bp.size * 1.5);
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(dist / Math.max(2, bp.size * 0.35)));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const dx = ((b[0] - a[0]) / n) * bp.gain * 1.6;
      const dy = ((b[1] - a[1]) / n) * bp.gain * 1.6;
      const ang = Math.atan2(dy, dx);
      const str = 1 + Math.min(0.9, Math.hypot(dx, dy) * 0.12); // stretch along drag
      for (const [px, py] of symPoints(x, y))
        for (const [ox, oy] of offsetsFor(px, py, r)) {
          c.save();
          c.beginPath();
          c.arc(px + ox, py + oy, r, 0, 6.284);
          c.clip();
          c.globalCompositeOperation = 'copy';
          c.translate(px + ox + dx, py + oy + dy);
          c.rotate(ang); c.scale(str, 1 / str); c.rotate(-ang);
          c.translate(-px - ox, -py - oy);
          c.drawImage(c.canvas, 0, 0);
          c.restore();
        }
    }
    const al = s.layers[s.activeIdx];
    if (al) al.bbox = null;
  }

  function pushUndo(tag = 'stroke') {
    const s = st.current, c = ctx();
    if (!c) return;
    s.undo.push({ idx: s.activeIdx, img: c.getImageData(0, 0, W, H), t: { ...s.layers[s.activeIdx].t }, tag });
    if (s.undo.length > 15) s.undo.shift();
    emitRef.current();
  }

  function pos(e) {
    const r = displayRef.current.getBoundingClientRect();
    const p = [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    if (posRef?.current) posRef.current.textContent = `${p[0] | 0} , ${p[1] | 0}`;
    return p;
  }

  function onDown(e) {
    e.preventDefault();
    ensureSize();
    // space+drag = pan the view
    if (st.current.spaceHeld) {
      st.current.panning = true;
      st.current.panLast = [e.clientX, e.clientY];
      return;
    }
    displayRef.current.setPointerCapture(e.pointerId);
    if (pref.current.tool === 'wand') {
      const s = st.current;
      const p = pos(e);
      if (s.stamp) {
        const hit = stampHitTest(p);
        if (hit) {
          s.tmode = hit;
          const { cx, cy, rot } = stampXform();
          s.tinfo = {
            cx, cy,
            d0: Math.max(1, dist2(p, [cx, cy])),
            a0: Math.atan2(p[1] - cy, p[0] - cx),
            sx0: pref.current.stamp.sx, sy0: pref.current.stamp.sy, rot0: rot,
            last: p,
          };
          if (hit === 'move') { s.wandDrag = true; s.wandLast = p; }
          return;
        }
        commitStamp(); // click outside → commit, then select
      }
      wandDown(e);
      return;
    }
    if (pref.current.tool === 'move') {
      const s = st.current;
      const p = pos(e);
      const l = s.layers[s.activeIdx];
      if (l) {
        const pts = layerPts(l);
        if (pts) {
          const R = 12;
          for (const c of pts.corners) {
            if (dist2(p, c) < R) {
              pushTransformUndo(l, s.activeIdx);
              s.tmode = 'mScale';
              s.tinfo = { l, cx: pts.px, cy: pts.py, d0: Math.max(1, dist2(p, [pts.px, pts.py])), sx0: l.t.sx, sy0: l.t.sy };
              return;
            }
          }
          if (dist2(p, pts.rotH) < R + 4) {
            pushTransformUndo(l, s.activeIdx);
            s.tmode = 'mRot';
            s.tinfo = { l, cx: pts.px, cy: pts.py, a0: Math.atan2(p[1] - pts.py, p[0] - pts.px), rot0: l.t.rot };
            return;
          }
        }
      }
      const i = layerHitTest(p);
      // ps behavior: no pixel hit → still drag the ACTIVE layer
      const i2 = i >= 0 ? i : (s.layers[s.activeIdx] ? s.activeIdx : -1);
      if (i2 >= 0) {
        s.activeIdx = i2;
        const l2 = s.layers[i2];
        s.undo.push({ idx: i2, img: l2.ctx.getImageData(0, 0, W, H), t: { ...l2.t }, tag: 'transform' });
        if (s.undo.length > 15) s.undo.shift();
        s.tmode = 'mMove';
        s.tinfo = { l: l2, last: p };
        emitRef.current();
        s.dirty = true;
      }
      return;
    }
    if (st.current.stamp) commitStamp(); // leftover floating stamp → commit on first brush click
    if (pref.current.tool === 'smudge') {
      pushUndo('smudge');
      st.current.drawing = true;
      const p = pos(e);
      st.current.last = p;
      smudgeInit(p);
      st.current.dirty = true;
      return;
    }
    if (pref.current.tool === 'liquify') {
      pushUndo('liquify');
      st.current.drawing = true;
      st.current.last = pos(e);
      st.current.dirty = true;
      return;
    }
    pushUndo(pref.current.tool === 'eraser' ? 'erase' : 'stroke');
    st.current.drawing = true;
    st.current.strokeDist = 0;
    st.current.lastT = performance.now();
    const p = pos(e);
    st.current.last = p;
    stamp(p[0], p[1], isErase());
    st.current.dirty = true;
  }
  function onMove(e) {
    const s = st.current;
    if (s.panning) {
      const v = viewRef.current;
      setView({ ...v, ox: v.ox + e.clientX - s.panLast[0], oy: v.oy + e.clientY - s.panLast[1] });
      s.panLast = [e.clientX, e.clientY];
      return;
    }
    const p = pos(e);
    // interactive light: bevel light follows the cursor (hover, no drag)
    if (pref.current.emb.lightFollow && !s.drawing && !s.tmode && !s.wandDrag) {
      onParam?.('emb', 'angle',
        Math.round((Math.atan2(p[1] - H / 2, p[0] - W / 2) * 180) / Math.PI));
    }
    if (s.tmode === 'mMove') {
      const l = s.tinfo.l;
      l.t.ox += p[0] - s.tinfo.last[0];
      l.t.oy += p[1] - s.tinfo.last[1];
      s.tinfo.last = p;
      s.dirty = true;
      return;
    }
    if (s.tmode === 'mScale' || s.tmode === 'mRot') {
      const l = s.tinfo.l, ti = s.tinfo;
      if (s.tmode === 'mScale') {
        const r = dist2(p, [ti.cx, ti.cy]) / ti.d0;
        l.t.sx = Math.max(0.05, Math.min(10, ti.sx0 * r));
        l.t.sy = Math.max(0.05, Math.min(10, ti.sy0 * r));
      } else {
        const a = Math.atan2(p[1] - ti.cy, p[0] - ti.cx);
        l.t.rot = Math.round(ti.rot0 + (a - ti.a0) * 180 / Math.PI);
      }
      s.dirty = true;
      return;
    }
    if (s.tmode === 'scale' || s.tmode === 'rot') {
      const ti = s.tinfo;
      if (s.tmode === 'scale') {
        const r = dist2(p, [ti.cx, ti.cy]) / ti.d0;
        onParam?.('stamp', 'sx', Math.max(0.05, Math.min(10, ti.sx0 * r)));
        onParam?.('stamp', 'sy', Math.max(0.05, Math.min(10, ti.sy0 * r)));
      } else {
        const a = Math.atan2(p[1] - ti.cy, p[0] - ti.cx);
        onParam?.('stamp', 'rot', Math.round(ti.rot0 + (a - ti.a0) * 180 / Math.PI));
      }
      return;
    }
    if (s.wandDown && !s.stamp && s.downPos &&
        Math.hypot(p[0] - s.downPos[0], p[1] - s.downPos[1]) > 4) {
      buildStampFromSel();           // drag on selection = move content, PS-style
      s.wandDrag = true; s.wandLast = p;
    }
    if (s.wandDrag && s.stamp) {
      s.stamp.pos[0] += p[0] - s.wandLast[0];
      s.stamp.pos[1] += p[1] - s.wandLast[1];
      s.wandLast = p;
      redrawFloat();
      return;
    }
    if (!s.drawing) return;
    if (pref.current.tool === 'smudge') smudgeLine(s.last, p);
    else if (pref.current.tool === 'liquify') liquifyLine(s.last, p);
    else line(s.last, p, isErase());
    s.last = p;
    s.dirty = true;
  }
  function onUp() {
    const s = st.current;
    // finishing a layer transform → bake it into the pixels so brush strokes
    // keep landing under the cursor
    if (s.tmode && s.tmode.startsWith('m') && s.tinfo?.l) bakeTransform(s.tinfo.l);
    s.panning = false;
    s.drawing = false;
    s.wandDrag = false;
    s.wandDown = false;
    s.tmode = null;
    s.last = null;
    s.dirty = true;
  }
  const isErase = () =>
    (pref.current.tool === 'eraser' || pref.current.brush.erase) !== st.current.eraseHold; // hold E to invert

  const actionRef = useRef({});
  actionRef.current = { commitStamp, discardStamp, undo };

  useEffect(() => {
    const dn = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === ' ') { st.current.spaceHeld = true; e.preventDefault(); }
      if (e.key === 'e' || e.key === 'E') st.current.eraseHold = true;
      if (e.key === 'b' || e.key === 'B') onToolChange?.('brush');
      if (e.key === 'w' || e.key === 'W') onToolChange?.('wand');
      if (e.key === 'v' || e.key === 'V') onToolChange?.('move');
      if (e.key === 's' || e.key === 'S') onToolChange?.('smudge');
      if (e.key === 'l' || e.key === 'L') onToolChange?.('liquify');
      if (e.key === 'Enter') actionRef.current.commitStamp();
      if (e.key === 'Escape') actionRef.current.discardStamp();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); actionRef.current.undo(); }
    };
    const up = (e) => {
      if (e.key === ' ') st.current.spaceHeld = false;
      if (e.key === 'e' || e.key === 'E') st.current.eraseHold = false;
    };
    // ctrl+wheel = zoom to cursor (cap 4× — stays fluid, no re-render cost)
    const cv = displayRef.current;
    const wh = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const v = viewRef.current;
      const rect = cv.getBoundingClientRect();
      const z = Math.max(1, Math.min(4, v.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      const r = z / v.z;
      const ox = e.clientX - (rect.left - v.ox) - (e.clientX - rect.left) * r;
      const oy = e.clientY - (rect.top - v.oy) - (e.clientY - rect.top) * r;
      setView(z <= 1 ? { z: 1, ox: 0, oy: 0 } : { z, ox, oy });
    };
    cv.addEventListener('wheel', wh, { passive: false });
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
      cv.removeEventListener('wheel', wh);
    };
  }, []);

  // ---------- api ----------
  function undo() {
    const s = st.current;
    const u = s.undo.pop();
    if (!u) return;
    if (u.delLayer !== undefined) {
      s.layers.splice(u.delLayer, 1);
      if (s.activeIdx >= s.layers.length) s.activeIdx = s.layers.length - 1;
      s.dirty = true;
      emitRef.current();
    } else if (s.layers[u.idx]) {
      if (u.img) { s.layers[u.idx].ctx.putImageData(u.img, 0, 0); s.layers[u.idx].bbox = null; }
      if (u.t) s.layers[u.idx].t = u.t;
      s.dirty = true;
    }
    emitRef.current();
  }

  function historyTo(i) {
    const s = st.current;
    while (s.undo.length > i) undo();
  }

  function clear() {
    const s = st.current, c = ctx();
    if (!c) return;
    pushUndo('clear');
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    s.layers[s.activeIdx].bbox = null;
    s.dirty = true;
  }

  function generate(add) {
    const s = st.current, c = ctx(), g = pref.current.gen;
    if (!c) return;
    pushUndo('generate');
    const n = fbmNoise(W, H, { cells: g.cells, octaves: g.octaves, seed: g.seed });
    const mask = maskFromNoise(n, g.threshold, g.soft);
    let layer;
    if (g.mode === 'roots') layer = rootsField(W, H, { count: g.roots, seed: g.seed });
    else if (g.mode === 'fill') layer = mask;
    else {
      const edge = edgeMask(mask, W, H);
      layer = g.lineBlur > 0.5 ? blurF32(edge, W, H, g.lineBlur, 1) : edge;
      for (let i = 0; i < layer.length; i++) layer[i] = Math.min(1, layer[i] * 2);
      if (g.mode === 'both')
        for (let i = 0; i < layer.length; i++) layer[i] = Math.max(layer[i], mask[i]);
    }
    const img = c.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < layer.length; i++) {
      const v = (layer[i] * 255) | 0, o = i * 4;
      const nv = add ? Math.max(d[o], v) : v;
      d[o] = d[o + 1] = d[o + 2] = nv;
    }
    c.putImageData(img, 0, 0);
    s.layers[s.activeIdx].bbox = null;
    s.dirty = true;
  }

  function resampleImage() {
    const im = st.current.imgSrc;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cc = c.getContext('2d');
    const sc = Math.max(W / im.width, H / im.height);
    const iw = im.width * sc, ih = im.height * sc;
    cc.drawImage(im, (W - iw) / 2, (H - ih) / 2, iw, ih);
    const d = cc.getImageData(0, 0, W, H).data;
    const rgb = new Float32Array(W * H * 3), lum = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      rgb[i * 3] = d[o] / 255; rgb[i * 3 + 1] = d[o + 1] / 255; rgb[i * 3 + 2] = d[o + 2] / 255;
      lum[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
    }
    st.current.img = { rgb, lum };
    // image becomes a real layer — move/scale/rotate with the move tool (V)
    const s = st.current;
    let il = s.layers.find((l) => l.isImage);
    if (!il) {
      il = mkLayer(W, H, `image ${++s.lcount}`);
      il.isImage = true;
      s.layers.push(il);
      s.activeIdx = s.layers.length - 1;
      emitRef.current();
    }
    il.ctx.globalCompositeOperation = 'source-over';
    il.ctx.fillStyle = '#000'; il.ctx.fillRect(0, 0, W, H);
    il.ctx.drawImage(c, 0, 0);
    il.bbox = null;
  }

  function loadImage(file) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      st.current.imgSrc = im;
      resampleImage();
      URL.revokeObjectURL(url);
      st.current.dirty = true;
    };
    im.src = url;
  }

  function clearImage() {
    const s = st.current;
    s.img = null; s.imgSrc = null; s.imgX = null;
    const i = s.layers.findIndex((l) => l.isImage);
    if (i >= 0) { s.layers.splice(i, 1); s.activeIdx = Math.max(0, Math.min(s.activeIdx, s.layers.length - 1)); emitRef.current(); }
    s.dirty = true;
  }

  // ---------- layers api ----------
  function addLayer() {
    const s = st.current;
    s.layers.push(mkLayer(W, H, `layer ${++s.lcount}`));
    s.activeIdx = s.layers.length - 1;
    s.dirty = true;
    emitRef.current();
  }
  function removeLayer() {
    const s = st.current;
    if (s.layers.length <= 1) { clear(); return; }
    s.undo = s.undo.filter((u) => u.idx !== s.activeIdx);
    s.layers.splice(s.activeIdx, 1);
    s.undo.forEach((u) => { if (u.idx > s.activeIdx) u.idx--; });
    s.activeIdx = Math.max(0, s.activeIdx - 1);
    s.dirty = true;
    emitRef.current();
  }
  function mergeDown() {
    const s = st.current;
    if (s.activeIdx === 0) return;
    const top = s.layers[s.activeIdx], below = s.layers[s.activeIdx - 1];
    pushUndo('merge');
    below.ctx.globalCompositeOperation = 'lighter';
    below.ctx.drawImage(top.c, 0, 0);
    below.ctx.globalCompositeOperation = 'source-over';
    below.bbox = null;
    s.layers.splice(s.activeIdx, 1);
    s.activeIdx--;
    s.dirty = true;
    emitRef.current();
  }
  function selectLayer(i) { st.current.activeIdx = i; emitRef.current(); }
  function toggleLayer(i) { st.current.layers[i].on = !st.current.layers[i].on; st.current.dirty = true; emitRef.current(); }
  function setLayerBlend(i, v) { st.current.layers[i].blend = v; st.current.dirty = true; emitRef.current(); }
  function setLayerOpacity(i, v) { st.current.layers[i].opacity = v; st.current.dirty = true; emitRef.current(); }

  const download = (canvas, name) => canvas.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function compAlpha() {
    const s = st.current;
    const d = s.compCtx.getImageData(0, 0, W, H).data;
    const a = new Float32Array(W * H);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4] / 255;
    return a;
  }

  function exportHeight() {
    const a = compAlpha();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const id = c.getContext('2d').createImageData(W, H);
    for (let i = 0; i < a.length; i++) {
      const o = i * 4, v = (a[i] * 255) | 0;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    c.getContext('2d').putImageData(id, 0, 0);
    download(c, `grotto_height_${Date.now()}.png`);
  }

  function exportNormal() {
    const p = pref.current;
    const hf = blurF32(compAlpha(), W, H, Math.max(1, Math.round(p.emb.soften)));
    const k = p.emb.depth * 14;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const id = c.getContext('2d').createImageData(W, H);
    const dd = id.data;
    for (let y = 0; y < H; y++) {
      const yp = Math.min(H - 1, y + 1) * W, ym = Math.max(0, y - 1) * W, row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const gx = (hf[row + Math.min(W - 1, x + 1)] - hf[row + Math.max(0, x - 1)]) * k;
        const gy = (hf[yp + x] - hf[ym + x]) * k;
        const il = 1 / Math.hypot(gx, gy, 1);
        const o = i * 4;
        dd[o] = ((-gx * il) * 0.5 + 0.5) * 255;
        dd[o + 1] = ((-gy * il) * 0.5 + 0.5) * 255;
        dd[o + 2] = (il * 0.5 + 0.5) * 255;
        dd[o + 3] = 255;
      }
    }
    c.getContext('2d').putImageData(id, 0, 0);
    download(c, `grotto_normal_${Date.now()}.png`);
  }

  function saveProject() {
    const s = st.current;
    const data = {
      app: 'sulawesi-grotto', v: 1, res: W,
      params: pref.current,
      layers: s.layers.map((l) => ({
        name: l.name, on: l.on, blend: l.blend, opacity: l.opacity,
        isImage: !!l.isImage, t: l.t, style: l.style || null, png: l.c.toDataURL('image/png'),
      })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `grotto_${Date.now()}.grotto`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadProject(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (data.app !== 'sulawesi-grotto' || !data.layers) throw new Error('not a grotto file');
        onProject?.(data.params);
        Promise.all(data.layers.map((l) => new Promise((res) => {
          const im = new Image();
          im.onload = () => res({ l, im });
          im.onerror = () => res(null);
          im.src = l.png;
        }))).then((loaded) => {
          const s = st.current;
          s.layers = loaded.filter(Boolean).map(({ l, im }) => {
            const nl = mkLayer(W, H, l.name);
            nl.on = l.on; nl.blend = l.blend; nl.opacity = l.opacity; nl.isImage = l.isImage;
            nl.t = { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1, ...l.t };
            nl.style = l.style || null;
            nl.ctx.fillStyle = '#000'; nl.ctx.fillRect(0, 0, W, H);
            nl.ctx.drawImage(im, 0, 0, W, H);
            return nl;
          });
          if (!s.layers.length) s.layers = [mkLayer(W, H, 'layer 1')];
          s.lcount = s.layers.length;
          s.activeIdx = 0;
          s.undo = []; s.stamp = null; s.sel = null; s.ants = []; s.selMask = null;
          if (s.float) s.float.getContext('2d').clearRect(0, 0, W, H);
          s.dirty = true;
          emitRef.current();
        });
      } catch (err) { console.error('load project failed', err); }
    };
    rd.readAsText(file);
  }

  // shared mesh builder: top relief + bottom slab + walls on every boundary edge
  // (outer perimeter AND trim-cut holes) → watertight solid
  function buildMeshGeo(m) {
    const a = compAlpha();
    const n = Math.max(16, Math.min(400, m.res));
    const amp = W * m.ext, base = -W * m.base, cut = m.trim ? m.cut : -1;
    const A = (x, y) => a[Math.min(H - 1, Math.round(y * (H / n))) * W + Math.min(W - 1, Math.round(x * (W / n)))];
    const pos = [], nrm = [], uv = [], idx = [];
    const vid = (x, y) => y * (n + 1) + x;
    for (let y = 0; y <= n; y++)
      for (let x = 0; x <= n; x++) {
        pos.push((x / n - 0.5) * W, (y / n - 0.5) * H, A(x, y) * amp);
        uv.push(x / n, 1 - y / n);
        const gx = (A(Math.min(n, x + 1), y) - A(Math.max(0, x - 1), y)) * amp * n / W;
        const gy = (A(x, Math.min(n, y + 1)) - A(x, Math.max(0, y - 1))) * amp * n / H;
        const il = 1 / Math.hypot(gx, gy, 1);
        nrm.push(-gx * il, -gy * il, il);
      }
    const bottom = new Map();
    const botV = (x, y) => {
      const k = vid(x, y);
      if (!bottom.has(k)) {
        bottom.set(k, pos.length / 3);
        pos.push((x / n - 0.5) * W, (y / n - 0.5) * H, base);
        uv.push(x / n, 1 - y / n);
        nrm.push(0, 0, -1);
      }
      return bottom.get(k);
    };
    const kept = Array(n * n).fill(false);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        kept[y * n + x] = Math.max(A(x, y), A(x + 1, y), A(x, y + 1), A(x + 1, y + 1)) > cut;
    const isK = (x, y) => x >= 0 && x < n && y >= 0 && y < n && kept[y * n + x];
    // wall verts get their own uv (constant dark texel) + outward normal
    // → no stretched edge texels running down the sides
    const wV = (src, nx, ny) => {
      pos.push(pos[src * 3], pos[src * 3 + 1], pos[src * 3 + 2]);
      uv.push(0.02, 0.02);
      nrm.push(nx, ny, 0);
      return pos.length / 3 - 1;
    };
    const wall = (tA, tB, bA, bB, nx, ny) => {
      const i1 = wV(tA, nx, ny), i2 = wV(tB, nx, ny), i3 = wV(bB, nx, ny), i4 = wV(bA, nx, ny);
      idx.push(i1, i2, i3, i1, i3, i4);
    };
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!kept[y * n + x]) continue;
        const t = vid(x, y), t1 = t + 1, t2 = t + n + 1, t3 = t + n + 2;
        idx.push(t, t1, t3, t, t3, t2); // top
        const b = botV(x, y), b1 = botV(x + 1, y), b2 = botV(x, y + 1), b3 = botV(x + 1, y + 1);
        idx.push(b, b3, b1, b, b2, b3); // bottom (faces down)
        // walls wherever a neighbor is missing (outer rim or trimmed hole edge)
        if (!isK(x, y - 1)) wall(t, t1, b, b1, 0, -1);
        if (!isK(x, y + 1)) wall(t2, t3, b2, b3, 0, 1);
        if (!isK(x - 1, y)) wall(t, t2, b, b2, -1, 0);
        if (!isK(x + 1, y)) wall(t1, t3, b1, b3, 1, 0);
      }
    return { pos, nrm, uv, idx, n };
  }

  // 2d render baked to a texture, but background pixels (alpha < cut) go transparent
  // → the texture adapts to the form instead of carrying the flat bg
  function texCanvas() {
    const m = pref.current.mesh, s = st.current;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cc = c.getContext('2d');
    cc.drawImage(displayRef.current, 0, 0);
    if (m.trim && s.lastAlpha) {
      const id = cc.getImageData(0, 0, W, H), a = s.lastAlpha;
      for (let i = 0; i < a.length; i++) if (a[i] < m.cut) id.data[i * 4 + 3] = 0;
      cc.putImageData(id, 0, 0);
    }
    return c;
  }

  function exportGLB() {
    const m = pref.current.mesh;
    const g = buildMeshGeo(m);
    const P = new Float32Array(g.pos), N = new Float32Array(g.nrm),
      T = new Float32Array(g.uv), I = new Uint32Array(g.idx);
    // glTF uv origin is top-left (obj uses bottom-left) → flip v
    for (let i = 1; i < T.length; i += 2) T[i] = 1 - T[i];
    texCanvas().toBlob(async (pngBlob) => {
      const png = new Uint8Array(await pngBlob.arrayBuffer());
      const pad = (b) => (4 - (b.byteLength % 4)) % 4;
      const chunks = [P.buffer, N.buffer, T.buffer, I.buffer, png.buffer];
      const offs = [];
      let binLen = 0;
      for (const c of chunks) { offs.push(binLen); binLen += c.byteLength + pad(c); }
      const bvs = chunks.map((c, i) => ({ buffer: 0, byteOffset: offs[i], byteLength: c.byteLength, ...(i < 4 ? { target: i === 3 ? 34963 : 34962 } : {}) }));
      const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3)
        for (let k = 0; k < 3; k++) { if (P[i + k] < bmin[k]) bmin[k] = P[i + k]; if (P[i + k] > bmax[k]) bmax[k] = P[i + k]; }
      const json = {
        asset: { version: '2.0', generator: 'sulawesi-grotto' },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: m.metal, roughnessFactor: m.rough }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true }],
        textures: [{ source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
        images: [{ bufferView: 4, mimeType: 'image/png' }],
        bufferViews: bvs,
        accessors: [
          { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: bmin, max: bmax },
          { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' },
          { bufferView: 2, componentType: 5126, count: T.length / 2, type: 'VEC2' },
          { bufferView: 3, componentType: 5125, count: I.length, type: 'SCALAR' },
        ],
        buffers: [{ byteLength: binLen }],
      };
      let jstr = JSON.stringify(json);
      while (jstr.length % 4) jstr += ' ';
      const jb = new TextEncoder().encode(jstr);
      const total = 12 + 8 + jb.byteLength + 8 + binLen;
      const glb = new ArrayBuffer(total);
      const dv = new DataView(glb);
      let o = 0;
      const wr = (u32) => { dv.setUint32(o, u32, true); o += 4; };
      wr(0x46546c67); wr(2); wr(total);         // magic, version, length
      wr(jb.byteLength); wr(0x4e4f534a);         // JSON chunk
      new Uint8Array(glb, o).set(jb); o += jb.byteLength;
      wr(binLen); wr(0x004e4942);                // BIN chunk
      const ba = new Uint8Array(glb, o);
      chunks.forEach((c, i) => ba.set(new Uint8Array(c), offs[i]));
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      a2.download = `grotto_${Date.now()}.glb`;
      a2.click();
      URL.revokeObjectURL(a2.href);
    }, 'image/png');
  }

  function exportOBJ() {
    const m = pref.current.mesh;
    const g = buildMeshGeo(m);
    const name = `grotto_${Date.now()}`;
    const L = [`# sulawesi grotto — solid relief mesh`, `mtllib ${name}.mtl`, 'usemtl grotto'];
    for (let i = 0; i < g.pos.length; i += 3) L.push(`v ${g.pos[i].toFixed(3)} ${g.pos[i + 1].toFixed(3)} ${g.pos[i + 2].toFixed(3)}`);
    for (let i = 0; i < g.uv.length; i += 2) L.push(`vt ${g.uv[i].toFixed(4)} ${g.uv[i + 1].toFixed(4)}`);
    if (m.smooth) for (let i = 0; i < g.nrm.length; i += 3) L.push(`vn ${g.nrm[i].toFixed(4)} ${g.nrm[i + 1].toFixed(4)} ${g.nrm[i + 2].toFixed(4)}`);
    else L.push('s off');
    const f = (i) => (m.smooth ? `${i + 1}/${i + 1}/${i + 1}` : `${i + 1}/${i + 1}`);
    for (let i = 0; i < g.idx.length; i += 3) L.push(`f ${f(g.idx[i])} ${f(g.idx[i + 1])} ${f(g.idx[i + 2])}`);
    const dl = (blob, fname) => {
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = fname;
      a2.click();
      URL.revokeObjectURL(a2.href);
    };
    dl(new Blob([L.join('\n')], { type: 'text/plain' }), `${name}.obj`);
    dl(new Blob([`newmtl grotto\nKd 1 1 1\nmap_Kd ${name}_tex.png\n`], { type: 'text/plain' }), `${name}.mtl`);
    displayRef.current.toBlob((b) => dl(b, `${name}_tex.png`));
  }

  function exportPNG() {
    displayRef.current.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `grotto_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function exportTile() {
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const cc = c.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
      cc.drawImage(displayRef.current, x * W, y * H);
    c.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `grotto_tile_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  useEffect(() => {
    apiRef.current = {
      undo, clear, generate, exportPNG, exportTile, loadImage, clearImage,
      addLayer, removeLayer, mergeDown, selectLayer, toggleLayer,
      setLayerBlend, setLayerOpacity, historyTo,
      exportHeight, exportNormal, exportOBJ, exportGLB, saveProject, loadProject,
      commitStamp, discardStamp, redrawFloat,
      // live layer style: when active layer has fx, effect panels edit its style
      setLayerParam: (sec, key, val) => {
        const l = st.current.layers[st.current.activeIdx];
        if (!l?.style) return;
        if (sec === 'curve') l.style.curve = val;
        else l.style[sec][key] = val;
        st.current.dirty = true;
        emit();
      },
      toggleFx: (i) => {
        const s = st.current, l = s.layers[i];
        if (!l) return;
        if (l.style) l.style = null;
        else {
          const p = pref.current;
          // snapshot the current effect settings onto this layer
          l.style = {
            emb: { ...p.emb }, lev: { ...p.lev }, surf: { ...p.surf },
            col: { ...p.col }, curve: p.curve.map((c) => ({ ...c })),
          };
        }
        s.dirty = true; emit();
      },
      captureLayer: () => {
        const l = st.current.layers[st.current.activeIdx];
        if (!l) return null;
        const sc = Math.min(1, 256 / Math.max(l.c.width, l.c.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(l.c.width * sc));
        c.height = Math.max(1, Math.round(l.c.height * sc));
        c.getContext('2d').drawImage(l.c, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      },
      hasImage: () => !!st.current.img,
      markDirty: () => (st.current.dirty = true),
      renderVersion: () => st.current.version || 0,
      mapSources: () => {
        const s = st.current;
        if (!s.alphaC || s.alphaC.width !== W) {
          s.alphaC = document.createElement('canvas');
          s.alphaC.width = W; s.alphaC.height = H;
        }
        const ac = s.alphaC.getContext('2d');
        const id = ac.createImageData(W, H);
        for (let i = 0; i < W * H; i++) {
          const o = i * 4, v = (s.lastAlpha?.[i] ?? 0) * 255;
          id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
        }
        ac.putImageData(id, 0, 0);
        return { alpha: s.alphaC, alphaData: { data: s.lastAlpha, w: W, h: H }, color: displayRef.current };
      },
    };
  });

  return (
    <div className="canvasArea">
      <canvas
        ref={displayRef}
        className="mainCanvas"
        style={{
          aspectRatio: `${W} / ${H}`,
          cursor: st.current.spaceHeld ? 'grab' : params.tool === 'move' ? 'move' : 'crosshair',
          transform: view.z > 1 ? `translate(${view.ox}px, ${view.oy}px) scale(${view.z})` : undefined,
          transformOrigin: '0 0',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f && f.type.startsWith('image/')) loadImage(f);
        }}
      />
    </div>
  );
}
