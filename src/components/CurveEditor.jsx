import { useEffect, useRef } from 'react';
import { sampleCurve, clamp01 } from '../engine.js';

// Photoshop-style gloss contour editor. points: [{x,y}] normalized 0..1
export default function CurveEditor({ points, onChange, size = 232 }) {
  const ref = useRef(null);
  const drag = useRef(-1);

  useEffect(() => { draw(); });

  function draw() {
    const c = ref.current, ctx = c.getContext('2d');
    const s = size, dpr = window.devicePixelRatio || 1;
    if (c.width !== s * dpr) { c.width = s * dpr; c.height = s * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((s * i) / 4, 0); ctx.lineTo((s * i) / 4, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (s * i) / 4); ctx.lineTo(s, (s * i) / 4); ctx.stroke();
    }
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, y = sampleCurve(points, t);
      const px = t * s, py = (1 - y) * s;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (const p of points) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x * s - 2.5, (1 - p.y) * s - 2.5, 5, 5);
    }
  }

  function toNorm(e) {
    const r = ref.current.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)];
  }

  function nearest(x, y) {
    let best = -1, bd = 0.06;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function onDown(e) {
    e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    const [x, y] = toNorm(e);
    const i = nearest(x, y);
    if (i >= 0) { drag.current = i; return; }
    // add point
    const pts = [...points, { x, y }].sort((a, b) => a.x - b.x);
    drag.current = pts.findIndex((p) => p.x === x && p.y === y);
    onChange(pts);
  }

  function onMove(e) {
    if (drag.current < 0) return;
    const [x, y] = toNorm(e);
    const pts = points.map((p, i) =>
      i === drag.current ? { x: i === 0 || i === points.length - 1 ? p.x : x, y } : p
    );
    onChange(pts);
  }

  function onUp() { drag.current = -1; }

  function onContextMenu(e) {
    e.preventDefault();
    const [x, y] = toNorm(e);
    const i = nearest(x, y);
    if (i > 0 && i < points.length - 1) onChange(points.filter((_, k) => k !== i));
  }

  return (
    <canvas
      ref={ref}
      className="curveEditor"
      style={{ width: size, height: size }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onContextMenu={onContextMenu}
    />
  );
}
