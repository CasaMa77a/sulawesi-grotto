import { useEffect, useRef, useState } from 'react';
import { CHARSET, newFont, glyphFor, renderGlyphCell, renderText, makeRune, seedRng,
         FORGE_STYLES, forgeFont, forgeGlyph, fxGlyph } from '../font.js';

const Mini = ({ label, value, min, max, step = 1, onChange }) => (
  <label className="mini">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))} />
    <em>{typeof value === 'number' && step < 1 ? value.toFixed(2) : value}</em>
  </label>
);

// vector glyph editor — pen adds nodes, node drags/handles, alt+click deletes
export default function FontPanel({ params, set }) {
  const fonts = params.fonts || [];
  const fi = Math.min(params.fontSel || 0, Math.max(0, fonts.length - 1));
  const font = fonts[fi] || null;
  const [ch, setCh] = useState('A');
  const [tool, setTool] = useState('pen');   // pen | node
  const [sel, setSel] = useState(null);      // {pi, i} path index + point index | 'c'
  const [testStr, setTestStr] = useState('SIGIL');
  const [style, setStyle] = useState('gothic');
  const [chaos, setChaos] = useState(0.3);
  const [seed, setSeed] = useState(7);
  const [fx, setFx] = useState({ inflate: 0, rough: 0, spikes: 0, drip: 0, branch: 0, vein: 0 });
  const cvsRef = useRef(null);
  const dragRef = useRef(null);
  const fileRef = useRef(null);
  const VS = 520;

  const gl = font ? (font.glyphs[ch] || { paths: [] }) : null;
  const sc = VS * 0.62 / (font?.upm || 700);
  const ox = VS * 0.18, oy = VS * 0.72;         // origin: baseline-left on screen

  const toScreen = (p) => [ox + p.x * sc, oy - p.y * sc];
  const toGlyph = (sx, sy) => ({ x: (sx - ox) / sc, y: (oy - sy) / sc });

  function update(mut) {
    if (!font) return;
    const nf = fonts.map((f, i) => (i === fi ? mut({ ...f, glyphs: { ...f.glyphs } }) : f));
    set(null, 'fonts', nf);
  }
  const setGl = (ngl) => update((f) => { f.glyphs[ch] = ngl; return f; });

  // ---------- draw ----------
  useEffect(() => {
    const cv = cvsRef.current;
    if (!cv) return;
    const x = cv.getContext('2d');
    x.fillStyle = '#0c0c0c'; x.fillRect(0, 0, VS, VS);
    // grid
    x.strokeStyle = '#161616';
    for (let i = 0; i <= VS; i += 26) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, VS); x.moveTo(0, i); x.lineTo(VS, i); x.stroke(); }
    if (!font) {
      x.fillStyle = '#555'; x.font = '11px sans-serif'; x.textAlign = 'center';
      x.fillText('no font — create one →', VS / 2, VS / 2);
      return;
    }
    // guides
    const guide = (gy, col, lbl) => {
      const sy = oy - gy * sc;
      x.strokeStyle = col; x.beginPath(); x.moveTo(0, sy); x.lineTo(VS, sy); x.stroke();
      x.fillStyle = col; x.font = '8px monospace'; x.textAlign = 'left';
      x.fillText(lbl, 4, sy - 2);
    };
    guide(0, '#3a5c3a', 'base');
    guide(font.cap, '#5c3a3a', 'cap');
    guide(font.xH, '#3a3a5c', 'x-h');
    guide(-font.desc, '#443a20', 'desc');
    const gx = ox + font.glyphW * sc;   // advance width
    x.strokeStyle = '#5c5c3a'; x.setLineDash([4, 3]);
    x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, VS); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#5c5c3a'; x.fillText('adv', gx + 3, VS - 6);

    if (gl) {
      // filled preview
      x.save();
      x.globalAlpha = 0.85;
      const cl = { paths: gl.paths.filter((p) => p.closed) };
      const op = { paths: gl.paths.filter((p) => !p.closed) };
      x.lineJoin = 'round'; x.lineCap = 'round'; x.lineWidth = font.weight * sc;
      const trace = (paths) => {
        for (const p of paths) {
          if (!p.pts.length) continue;
          x.beginPath();
          x.moveTo(ox + p.pts[0].x * sc, oy - p.pts[0].y * sc);
          const n = p.pts.length + (p.closed ? 1 : 0);
          for (let i = 1; i < n; i++) {
            const a = p.pts[i - 1], b = p.pts[i % p.pts.length];
            if (a.c) x.quadraticCurveTo(ox + a.c.x * sc, oy - a.c.y * sc, ox + b.x * sc, oy - b.y * sc);
            else x.lineTo(ox + b.x * sc, oy - b.y * sc);
          }
          if (p.closed) x.closePath();
        }
      };
      if (font.mode === 'fill' && cl.paths.length) { trace(cl.paths); x.fillStyle = '#c8c2b0'; x.fill('evenodd'); }
      if (cl.paths.length && (font.mode === 'stroke')) { trace(cl.paths); x.strokeStyle = '#c8c2b0'; x.stroke(); }
      if (op.paths.length) { trace(op.paths); x.strokeStyle = '#c8c2b0'; x.stroke(); }
      x.restore();
      // nodes + handles
      gl.paths.forEach((p, pi) => {
        p.pts.forEach((pt, i) => {
          const [sx, sy] = toScreen(pt);
          const isSel = sel && sel.pi === pi && sel.i === i;
          if (pt.c) {  // control handle + link line
            const [hx, hy] = toScreen(pt.c);
            x.strokeStyle = '#777';
            x.beginPath(); x.moveTo(sx, sy); x.lineTo(hx, hy); x.stroke();
            x.fillStyle = isSel && sel.part === 'c' ? '#ffb050' : '#5070ff';
            x.fillRect(hx - 3, hy - 3, 6, 6);
          }
          x.fillStyle = isSel ? '#ffb050' : '#e8e2d6';
          x.beginPath(); x.arc(sx, sy, isSel ? 5 : 3.5, 0, 7); x.fill();
        });
      });
    }
    x.fillStyle = '#555'; x.font = '10px monospace'; x.textAlign = 'left';
    x.fillText(`glyph ${ch} · ${tool}`, 6, 14);
  });

  // ---------- pointer ----------
  function hitPt(sx, sy) {
    if (!gl) return null;
    for (let pi = 0; pi < gl.paths.length; pi++)
      for (let i = 0; i < gl.paths[pi].pts.length; i++) {
        const pt = gl.paths[pi].pts[i];
        const [ax, ay] = toScreen(pt);
        if (Math.hypot(ax - sx, ay - sy) < 9) return { pi, i, part: 'a' };
        if (pt.c) {
          const [hx, hy] = toScreen(pt.c);
          if (Math.hypot(hx - sx, hy - sy) < 8) return { pi, i, part: 'c' };
        }
      }
    return null;
  }

  function down(e) {
    if (!font) return;
    const r = cvsRef.current.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (VS / r.width), sy = (e.clientY - r.top) * (VS / r.height);
    cvsRef.current.setPointerCapture(e.pointerId);
    const hit = hitPt(sx, sy);
    if (e.altKey && hit) {         // delete point/handle
      const paths = gl.paths.map((p) => ({ ...p, pts: [...p.pts] }));
      if (hit.part === 'c') paths[hit.pi].pts[hit.i].c = null;
      else paths[hit.pi].pts.splice(hit.i, 1);
      setGl({ paths: paths.filter((p) => p.pts.length) });
      setSel(null);
      return;
    }
    if (tool === 'pen') {
      const paths = gl.paths.map((p) => ({ ...p, pts: [...p.pts] }));
      if (hit && hit.pi === paths.length - 1 && hit.i === 0 && paths[hit.pi].pts.length > 2) {
        paths[hit.pi].closed = true;   // click first pt → close path
        setGl({ paths });
        return;
      }
      const gp = toGlyph(sx, sy);
      if (!paths.length || paths[paths.length - 1].closed) paths.push({ closed: false, pts: [] });
      paths[paths.length - 1].pts.push({ x: gp.x, y: gp.y, c: null });
      setGl({ paths });
      setSel({ pi: paths.length - 1, i: paths[paths.length - 1].pts.length - 1, part: 'a' });
      return;
    }
    // node tool
    if (hit) {
      setSel(hit);
      dragRef.current = hit;
    } else setSel(null);
  }

  function move(e) {
    const d = dragRef.current;
    if (!d || !gl) return;
    const r = cvsRef.current.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (VS / r.width), sy = (e.clientY - r.top) * (VS / r.height);
    const gp = toGlyph(sx, sy);
    const paths = gl.paths.map((p) => ({ ...p, pts: p.pts.map((q) => ({ ...q })) }));
    if (d.part === 'c') paths[d.pi].pts[d.i].c = { x: gp.x, y: gp.y };
    else { paths[d.pi].pts[d.i].x = gp.x; paths[d.pi].pts[d.i].y = gp.y; }
    setGl({ paths });
  }

  const up = () => { dragRef.current = null; };

  // curve the selected segment (give it a control handle)
  function curveSeg() {
    if (!sel || !gl || !gl.paths[sel.pi]) return;
    const p = gl.paths[sel.pi], a = p.pts[sel.i];
    if (!a) return;
    const n = p.pts.length;
    const b = p.pts[(sel.i + 1) % n];
    if (!b || (!p.closed && sel.i === n - 1)) return;
    const paths = gl.paths.map((pp) => ({ ...pp, pts: pp.pts.map((q) => ({ ...q })) }));
    paths[sel.pi].pts[sel.i].c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + font.cap * 0.15 };
    setGl({ paths });
  }

  function saveFontFile() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(font)], { type: 'application/json' }));
    a.download = `${font.name.replace(/\W+/g, '_')}.gfont`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  function loadFontFile(f) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const nf = JSON.parse(rd.result);
        if (!nf.glyphs || !nf.upm) throw 0;
        nf.id = 'f' + Date.now().toString(36);
        set(null, 'fonts', [...fonts, nf]);
        set(null, 'fontSel', fonts.length);
      } catch { }
    };
    rd.readAsText(f);
  }
  function runeFill() {
    const rng = seedRng(Date.now() & 0xffff);
    update((f) => {
      for (const c of CHARSET) if (!f.glyphs[c]) f.glyphs[c] = makeRune(f, rng);
      return f;
    });
  }

  // guided generator — forge whole font / one glyph / mutate
  function forgeAll() {
    update((f) => { forgeFont(f, style, chaos, seed); return f; });
    setSel(null);
  }
  function forgeOne(mut = false) {
    const st = FORGE_STYLES[style];
    const s = seed + ch.charCodeAt(0) * 7919 + (mut ? Date.now() & 0xfff : 0);
    update((f) => { f.glyphs[ch] = forgeGlyph(f, ch, st, seedRng(s), chaos); return f; });
    setSel(null);
  }
  // apply organic vector fx to glyph(s) — destructive, regenerate to revert
  function applyFx(all) {
    const rng = seedRng(Date.now() & 0xffff);
    update((f) => {
      const targets = all ? Object.keys(f.glyphs) : [ch];
      for (const c of targets) if (f.glyphs[c]) f.glyphs[c] = fxGlyph(f, f.glyphs[c], fx, rng);
      return f;
    });
    setSel(null);
  }

  const prev = font && renderText(font, testStr, 46, { tracking: font.track, warp: params.text?.warp || 0 });

  return (
    <div className="fontmode">
      <div className="fgrid">
        <div className="fgrid-head">
          <button className="obtn" onClick={() => {
            const nf = newFont(`font ${fonts.length + 1}`);
            set(null, 'fonts', [...fonts, nf]); set(null, 'fontSel', fonts.length);
          }}>+ font</button>
          {font && <input className="bname" value={font.name}
            onChange={(e) => update((f) => { f.name = e.target.value; return f; })} />}
        </div>
        {fonts.length > 1 && (
          <div className="frow">
            {fonts.map((f, i) => (
              <button key={f.id} className={`obtn${i === fi ? ' on' : ''}`}
                onClick={() => set(null, 'fontSel', i)}>{f.name}</button>
            ))}
          </div>
        )}
        <div className="cells">
          {[...CHARSET].map((c) => {
            const gc = font ? renderGlyphCell(font, c, 34) : null;
            return (
              <button key={c} className={`cell${c === ch ? ' act' : ''}${font?.glyphs[c] ? ' has' : ''}`}
                title={c} onClick={() => { setCh(c); setSel(null); }}>
                {gc && <img src={gc.toDataURL()} alt="" />}
                {!gc && <span>{c}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <canvas ref={cvsRef} className="feditcv" width={VS} height={VS}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} />

      <div className="fctrl">
        <div className="frow">
          <button className={`obtn${tool === 'pen' ? ' on' : ''}`} onClick={() => setTool('pen')}>pen</button>
          <button className={`obtn${tool === 'node' ? ' on' : ''}`} onClick={() => setTool('node')}>node</button>
          <button className="obtn" onClick={() => { setGl({ paths: [...(gl?.paths || []), { closed: false, pts: [] }] }); setTool('pen'); }}>new path</button>
          <button className="obtn" onClick={curveSeg} disabled={!sel}>curve seg</button>
        </div>
        {font && (<>
          <div className="fsect">◈ forge</div>
          <select className="oselect fsel" value={style} onChange={(e) => setStyle(e.target.value)}>
            {Object.keys(FORGE_STYLES).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <Mini label="chaos" value={chaos} min={0} max={1} step={0.05} onChange={setChaos} />
          <Mini label="seed" value={seed} min={1} max={9999} onChange={setSeed} />
          <div className="frow">
            <button className="obtn fgo" onClick={forgeAll}>⚒ forge all</button>
            <button className="obtn" onClick={() => forgeOne(false)}>glyph</button>
            <button className="obtn" onClick={() => forgeOne(true)}>mutate</button>
          </div>
          <div className="fsect">organic fx</div>
          <Mini label="inflate" value={fx.inflate} min={-1} max={1} step={0.05} onChange={(v) => setFx({ ...fx, inflate: v })} />
          <Mini label="rough" value={fx.rough} min={0} max={1} step={0.05} onChange={(v) => setFx({ ...fx, rough: v })} />
          <Mini label="spikes" value={fx.spikes} min={0} max={1} step={0.05} onChange={(v) => setFx({ ...fx, spikes: v })} />
          <Mini label="drip" value={fx.drip} min={0} max={1} step={0.05} onChange={(v) => setFx({ ...fx, drip: v })} />
          <Mini label="branch" value={fx.branch} min={0} max={1} step={0.05} onChange={(v) => setFx({ ...fx, branch: v })} />
          <Mini label="vein" value={fx.vein} min={0} max={1} step={0.05} onChange={(v) => setFx({ ...fx, vein: v })} />
          <div className="frow">
            <button className="obtn" onClick={() => applyFx(false)}>fx glyph</button>
            <button className="obtn" onClick={() => applyFx(true)}>fx all</button>
          </div>
          <div className="fsect">metrics</div>
          <Mini label="weight" value={font.weight} min={8} max={200}
            onChange={(v) => update((f) => { f.weight = v; return f; })} />
          <Mini label="glyph w" value={font.glyphW} min={200} max={900}
            onChange={(v) => update((f) => { f.glyphW = v; return f; })} />
          <Mini label="tracking" value={font.track} min={-60} max={300}
            onChange={(v) => update((f) => { f.track = v; return f; })} />
          <Mini label="cap h" value={font.cap} min={300} max={700}
            onChange={(v) => update((f) => { f.cap = v; return f; })} />
          <div className="frow">
            <button className={`obtn${font.mode === 'fill' ? ' on' : ''}`}
              onClick={() => update((f) => { f.mode = 'fill'; return f; })}>fill</button>
            <button className={`obtn${font.mode === 'stroke' ? ' on' : ''}`}
              onClick={() => update((f) => { f.mode = 'stroke'; return f; })}>stroke</button>
          </div>
          <div className="frow">
            <button className="obtn" onClick={runeFill}>runes fill ∅</button>
            <button className="obtn" onClick={() => setGl({ paths: [] })}>clear glyph</button>
          </div>
          <div className="frow">
            <button className="obtn" onClick={saveFontFile}>save .gfont</button>
            <button className="obtn" onClick={() => fileRef.current.click()}>load</button>
            <button className="obtn" onClick={() => {
              if (fonts.length <= 1) { set(null, 'fonts', []); return; }
              set(null, 'fonts', fonts.filter((_, i) => i !== fi));
              set(null, 'fontSel', Math.max(0, fi - 1));
            }}>✕ font</button>
          </div>
          <input className="bname" value={testStr} onChange={(e) => setTestStr(e.target.value)} placeholder="test string" />
          {prev && <img className="ftest" src={prev.c.toDataURL()} alt="preview" />}
        </>)}
        <span className="ohint">
          pen: click = add node · click 1st = close<br />
          node: drag · alt+click = delete<br />
          curve seg then drag the ■ handle
        </span>
        <input ref={fileRef} type="file" accept=".gfont,.json" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files[0]) loadFontFile(e.target.files[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
