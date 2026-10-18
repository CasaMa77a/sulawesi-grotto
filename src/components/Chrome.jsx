import { useEffect, useRef, useState } from 'react';
import { floodSelect } from '../engine.js';

export function MenuBar({ apiRef, showTile, onToggleTile }) {
  const [open, setOpen] = useState(null);
  const fileRef = useRef(null);
  const projRef = useRef(null);
  const barRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (!barRef.current?.contains(e.target)) setOpen(null); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  const menus = {
    File: [
      ['Open Image…', () => fileRef.current?.click()],
      ['———'],
      ['Save Project… (.grotto)', () => apiRef.current?.saveProject()],
      ['Load Project…', () => projRef.current?.click()],
      ['———'],
      ['Export PNG', () => apiRef.current?.exportPNG()],
      ['Export Tile 2×2', () => apiRef.current?.exportTile()],
      ['Export Heightmap', () => apiRef.current?.exportHeight()],
      ['Export Normal Map', () => apiRef.current?.exportNormal()],
      ['Export 3D (.glb textured)', () => apiRef.current?.exportGLB()],
      ['Export 3D (.obj)', () => apiRef.current?.exportOBJ()],
    ],
    Edit: [
      ['Undo', () => apiRef.current?.undo(), 'ctrl+z'],
      ['Clear Layer', () => apiRef.current?.clear()],
      ['———'],
      ['Commit Stamp', () => apiRef.current?.commitStamp(), 'enter'],
      ['Discard Stamp', () => apiRef.current?.discardStamp(), 'esc'],
    ],
    View: [
      [showTile ? '✓ Tile Preview' : '   Tile Preview', onToggleTile],
    ],
  };

  return (
    <div className="menubar" ref={barRef}>
      <span className="appmark">▞ SULAWESI'S GROTTO</span>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files[0]) apiRef.current?.loadImage(e.target.files[0]); e.target.value = ''; }} />
      <input ref={projRef} type="file" accept=".grotto" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files[0]) apiRef.current?.loadProject(e.target.files[0]); e.target.value = ''; }} />
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="menu">
          <button
            className={open === name ? 'mbtn open' : 'mbtn'}
            onClick={() => setOpen(open === name ? null : name)}
            onMouseEnter={() => open && setOpen(name)}
          >{name}</button>
          {open === name && (
            <div className="dropdown">
              {items.map((it, i) =>
                it[0] === '———'
                  ? <div key={i} className="sep" />
                  : <button key={i} className="ditem" onClick={() => { setOpen(null); it[1](); }}>
                      <span>{it[0]}</span><em>{it[2] || ''}</em>
                    </button>
              )}
            </div>
          )}
        </div>
      ))}
      <span className="menuright">petroglyph engine · est. 45,500 bce</span>
    </div>
  );
}

const ToolIcon = ({ t }) => {
  const s = { width: 16, height: 16, display: 'block' };
  if (t === 'text') return (
    <svg {...s} viewBox="0 0 16 16"><path d="M2 3 L14 3 L14 5.5 L12.5 5.5 L12.5 4.5 L9.5 4.5 L9.5 12.5 L11 12.5 L11 14 L5 14 L5 12.5 L6.5 12.5 L6.5 4.5 L3.5 4.5 L3.5 5.5 L2 5.5 Z" fill="currentColor"/></svg>
  );
  if (t === 'liquify') return (
    <svg {...s} viewBox="0 0 16 16"><path d="M2 15 L3.5 9 L1.5 4 L4.5 7 L5.5 1 L7.5 8 L6.5 15 Z" fill="currentColor"/><path d="M9 15 L10 10 L9 4 L12 8 L13 2 L15 9 L14 15 Z" fill="currentColor"/></svg>
  );
  if (t === 'smudge') return (
    <svg {...s} viewBox="0 0 16 16"><path d="M3 13 C3 9 6 7 8 5 C10 3.5 12 3 13 3 C13 5 12 7 10.5 8.5 C9 10 7 12 6.5 13.5 C5 14 3.5 14 3 13 Z" fill="currentColor"/><path d="M10.5 8.5 C12 10 13.5 10.5 15 11" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
  );
  if (t === 'move') return (
    <svg {...s} viewBox="0 0 16 16"><path d="M2 2 L2 12 L5.5 10 L7 13.5 L8.5 12.8 L7 9.3 L10.5 8 Z" fill="currentColor"/></svg>
  );
  if (t === 'brush') return (
    <svg {...s} viewBox="0 0 16 16"><path d="M11 2 L14 5 L7 12 L4 9 Z" fill="currentColor"/><path d="M3 10 L6 13 C5 15 2 15 1 14 C2 13 2 12 3 10 Z" fill="currentColor"/></svg>
  );
  if (t === 'wand') return (
    <svg {...s} viewBox="0 0 16 16"><path d="M3 13 L10 6 L11 7 L4 14 Z" fill="currentColor"/><path d="M11 1 L12 3.5 L14.5 4 L12 5 L11 7.5 L10 5 L7.5 4 L10 3.5 Z" fill="currentColor"/><path d="M13.5 9 L14.2 10.4 L15.5 11 L14.2 11.6 L13.5 13 L12.8 11.6 L11.5 11 L12.8 10.4 Z" fill="currentColor"/></svg>
  );
  return (
    <svg {...s} viewBox="0 0 16 16"><path d="M6 3 L13 10 L9 14 L2 7 Z" fill="currentColor"/><path d="M9 14 L15 14 L15 15 L8 15 Z" fill="currentColor"/></svg>
  );
};

export function Toolbar({ tool, setTool, docMode, setDocMode }) {
  const tools = [
    ['move', 'Move — pick & drag layers (V)'],
    ['brush', 'Brush — draw relief strokes (B)'],
    ['eraser', 'Eraser — carve away (E)'],
    ['wand', 'Magic Wand — select image chunks (W)'],
    ['text', 'Type — stamp text / custom font (T)'],
    ['smudge', 'Smudge — drag relief like wet clay (S)'],
    ['liquify', 'Liquify — warp & taper into spikes (L)'],
  ];
  return (
    <div className="toolbar">
      {tools.map(([t, tip]) => (
        <button key={t} title={tip} className={`tbtn ${tool === t ? 'act' : ''}`}
          onClick={() => setTool(t)}>
          <ToolIcon t={t === 'eraser' ? 'eraser' : t} />
        </button>
      ))}
      <div className="tsep" />
      <button title="Drawing mode" className={`tbtn mode ${docMode === 'draw' ? 'act' : ''}`}
        onClick={() => setDocMode('draw')}>
        <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M4 11 L8 4 L12 11" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </button>
      <button title="Font mode — design glyphs on a vector grid" className={`tbtn mode font${docMode === 'font' ? ' act' : ''}`}
        onClick={() => setDocMode('font')}>
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 13 L8 2 L13 13 L10.5 13 L9.5 10 L6.5 10 L5.5 13 Z" fill="currentColor"/><rect x="7" y="8" width="2" height="1.2" fill="#000"/></svg>
      </button>
      <span className="thint">{docMode === 'font' ? 'FONT' : 'B·E·W'}</span>
    </div>
  );
}

const Mini = ({ label, value, min, max, step = 1, onChange }) => (
  <label className="mini">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))} />
    <em>{typeof value === 'number' && step < 1 ? value.toFixed(2) : value}</em>
  </label>
);

export function OptionsBar({ params, set, apiRef, onBrushLib }) {
  const tool = params.tool;
  return (
    <div className="optionsbar">
      {tool === 'move' ? (
        <span className="ohint">click content to pick layer · drag to move · corners scale · dot rotates</span>
      ) : tool === 'wand' ? (<>
        <Mini label="tolerance" value={params.wand.tol} min={0.02} max={0.5} step={0.01} onChange={(v) => set('wand', 'tol', v)} />
        <Mini label="pick blur" value={params.wand.blur} min={0} max={20} step={0.5} onChange={(v) => set('wand', 'blur', v)} />
        <Mini label="stretch x" value={params.stamp.sx} min={0.1} max={5} step={0.01} onChange={(v) => set('stamp', 'sx', v)} />
        <Mini label="stretch y" value={params.stamp.sy} min={0.1} max={5} step={0.01} onChange={(v) => set('stamp', 'sy', v)} />
        <Mini label="rot" value={params.stamp.rot} min={-180} max={180} onChange={(v) => set('stamp', 'rot', v)} />
        <Mini label="gain" value={params.stamp.gain} min={0.1} max={2} step={0.05} onChange={(v) => set('stamp', 'gain', v)} />
        <button className={`obtn ${params.stamp.invert ? 'on' : ''}`}
          onClick={() => set('stamp', 'invert', !params.stamp.invert)}>inv</button>
        <button className={`obtn ${params.wand.contig ? 'on' : ''}`}
          onClick={() => set('wand', 'contig', !params.wand.contig)}>contig</button>
        <button className="obtn" onClick={() => apiRef.current?.commitStamp()}>stamp ↓</button>
        <button className="obtn" onClick={() => apiRef.current?.discardStamp()}>✕</button>
        <span className="ohint">click=select · shift=add · alt=sub · drag=move</span>
      </>) : tool === 'text' ? (<>
        <input className="bname ttxt" placeholder="text…" value={params.text.str}
          onChange={(e) => set('text', 'str', e.target.value)} />
        <select className="oselect" value={params.text.src}
          onChange={(e) => set('text', 'src', e.target.value)}>
          <option value="custom">◈ active font</option>
          {(params.fonts || []).length > 0 &&
            <optgroup label="custom fonts">
              {params.fonts.map((f, i) => (
                <option key={f.id} value={`cf:${i}`}>◈ {f.name}</option>
              ))}
            </optgroup>}
          <optgroup label="system">
            {['Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Impact', 'serif', 'monospace'].map((f) => (
              <option key={f} value={`sys:${f}`}>{f}</option>
            ))}
          </optgroup>
        </select>
        <Mini label="size" value={params.text.size} min={16} max={700} onChange={(v) => set('text', 'size', v)} />
        {params.text.src === 'custom' || params.text.src.startsWith('cf:') ? (
          <Mini label="tracking" value={params.text.tracking} min={-80} max={400} onChange={(v) => set('text', 'tracking', v)} />
        ) : null}
        <Mini label="warp" value={params.text.warp} min={-1} max={1} step={0.05} onChange={(v) => set('text', 'warp', v)} />
        <button className="obtn" onClick={() => apiRef.current?.commitStamp()}>stamp ↓</button>
        <button className="obtn" onClick={() => apiRef.current?.discardStamp()}>✕</button>
        <span className="ohint">click canvas = place · corners scale · enter stamps</span>
      </>) : (<>
        <select className="oselect" value={params.brush.type} onChange={(e) => set('brush', 'type', e.target.value)}>
          <option value="soft">soft</option>
          <option value="chisel">chisel</option>
          <option value="shard">shard</option>
          <option value="drip">drip</option>
          <option value="taper">taper</option>
          <option value="hair">hair</option>
          <option value="vein">vein</option>
          <option value="spore">spore</option>
          <option value="rune">rune</option>
          <option value="teeth">teeth</option>
          <option value="spine">spine</option>
          <option value="ribs">ribs</option>
          {(params.brushLib || []).map((b) => (
            <option key={b.id} value={`cb:${b.id}`}>◈ {b.name}</option>
          ))}
        </select>
        <button className="obtn" onClick={onBrushLib}>lib</button>
        <Mini label="size" value={params.brush.size} min={2} max={200} onChange={(v) => set('brush', 'size', v)} />
        <Mini label="soft" value={params.brush.soft} min={0} max={1} step={0.01} onChange={(v) => set('brush', 'soft', v)} />
        <Mini label="gain" value={params.brush.gain} min={0.05} max={1} step={0.05} onChange={(v) => set('brush', 'gain', v)} />
        {['chisel', 'shard', 'hair', 'vein', 'teeth', 'spine', 'ribs'].includes(params.brush.type) && (<>
          <button className={`obtn${params.brush.follow ? ' on' : ''}`}
            onClick={() => set('brush', 'follow', !params.brush.follow)}>follow</button>
          {!params.brush.follow && (
            <Mini label="angle" value={params.brush.angle} min={0} max={180} onChange={(v) => set('brush', 'angle', v)} />)}
        </>)}
        {['drip', 'spore', 'vein'].includes(params.brush.type) && (
          <Mini label="jitter" value={params.brush.jitter} min={0} max={1} step={0.05} onChange={(v) => set('brush', 'jitter', v)} />)}
        <span className="ohint">{tool === 'eraser' ? 'carve away material' : 'draw to add relief · hold E = erase'}</span>
      </>)}
    </div>
  );
}

export function BrushEditor({ params, set, apiRef, onClose }) {
  const fileRef = useRef(null);
  const cvsRef = useRef(null);
  const lib = params.brushLib || [];
  const VS = 280;
  const [src, setSrc] = useState(null);            // {c, lum, mask, maskC, name}
  const [xf, setXf] = useState({ rot: 0, sc: 1, ox: 0, oy: 0 });
  const [tol, setTol] = useState(0.15);
  const [name, setName] = useState('');

  const loadURL = (url, nm) => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc));
      c.height = Math.max(1, Math.round(img.height * sc));
      const cc = c.getContext('2d');
      cc.drawImage(img, 0, 0, c.width, c.height);
      const d = cc.getImageData(0, 0, c.width, c.height);
      const lum = new Float32Array(c.width * c.height);
      for (let i = 0; i < lum.length; i++)
        lum[i] = ((d.data[i * 4] * 0.5 + d.data[i * 4 + 1] * 0.35 + d.data[i * 4 + 2] * 0.15) / 255) * (d.data[i * 4 + 3] / 255);
      setSrc({ c, lum, mask: null, maskC: null });
      if (nm && !name) setName(nm);
    };
    img.src = url;
  };

  // preview: source under transform + selection tint
  useEffect(() => {
    const cv = cvsRef.current;
    if (!cv) return;
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, VS, VS);
    x.strokeStyle = '#1e1e1e';
    for (let i = 0; i <= VS; i += 28) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, VS); x.moveTo(0, i); x.lineTo(VS, i); x.stroke(); }
    if (!src) {
      x.fillStyle = '#555'; x.font = '9px sans-serif'; x.textAlign = 'center';
      x.fillText('load an image or capture the active layer', VS / 2, VS / 2);
      return;
    }
    x.save();
    x.translate(VS / 2 + xf.ox, VS / 2 + xf.oy);
    x.rotate((xf.rot * Math.PI) / 180);
    x.scale(xf.sc, xf.sc);
    x.drawImage(src.c, -src.c.width / 2, -src.c.height / 2);
    if (src.maskC) { x.globalAlpha = 0.4; x.drawImage(src.maskC, -src.c.width / 2, -src.c.height / 2); x.globalAlpha = 1; }
    x.restore();
  }, [src, xf]);

  // wand pick inside the mini editor (transform-aware); shift = add
  function pick(e) {
    if (!src) return;
    const r = cvsRef.current.getBoundingClientRect();
    const px = (e.clientX - r.left) * (VS / r.width), py = (e.clientY - r.top) * (VS / r.height);
    const rad = (xf.rot * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    const dx = px - VS / 2 - xf.ox, dy = py - VS / 2 - xf.oy;
    const sx = ((dx * cs + dy * sn) / xf.sc + src.c.width / 2) | 0;
    const sy = ((-dx * sn + dy * cs) / xf.sc + src.c.height / 2) | 0;
    if (sx < 0 || sy < 0 || sx >= src.c.width || sy >= src.c.height) return;
    const sel = floodSelect(src.lum, src.c.width, src.c.height, sx, sy, tol);
    const mask = e.shiftKey && src.mask
      ? src.mask.map((v, i) => v | sel.mask[i])
      : sel.mask;
    const mc = document.createElement('canvas');
    mc.width = src.c.width; mc.height = src.c.height;
    const mx = mc.getContext('2d');
    const id = mx.createImageData(mc.width, mc.height);
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) { const o = i * 4; id.data[o] = 255; id.data[o + 1] = 40; id.data[o + 2] = 70; id.data[o + 3] = 255; }
    mx.putImageData(id, 0, 0);
    setSrc({ ...src, mask, maskC: mc });
  }

  function save() {
    if (!src) return;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const put = (img2, gco) => {
      x.save();
      x.translate(128 + (xf.ox * 256) / VS, 128 + (xf.oy * 256) / VS);
      x.rotate((xf.rot * Math.PI) / 180);
      x.scale(xf.sc, xf.sc);
      x.globalCompositeOperation = gco || 'source-over';
      x.drawImage(img2, -src.c.width / 2, -src.c.height / 2);
      x.restore();
    };
    put(src.c);
    if (src.maskC) put(src.maskC, 'destination-in');
    const id = 'b' + Date.now();
    set(null, 'brushLib', [...lib, { id, name: name || 'brush', url: c.toDataURL('image/png') }]);
    set('brush', 'type', `cb:${id}`);
  }

  const S = ({ label, k, min, max, step = 1 }) => (
    <Mini label={label} value={xf[k]} min={min} max={max} step={step}
      onChange={(v) => setXf({ ...xf, [k]: v })} />
  );

  return (
    <div className="bmodal" onClick={onClose}>
      <div className="bpanel big" onClick={(e) => e.stopPropagation()}>
        <div className="btitle">
          <span>brush editor</span>
          <button className="bx" onClick={onClose}>✕</button>
        </div>
        <div className="bedit">
          <canvas ref={cvsRef} className="beditcv" width={VS} height={VS}
            onPointerDown={pick} />
          <div className="bctrl">
            <div className="brow">
              <button className="obtn" onClick={() => fileRef.current.click()}>from image…</button>
              <button className="obtn" onClick={() => {
                const url = apiRef.current?.captureLayer();
                if (url) loadURL(url, 'layer brush');
              }}>capture layer</button>
            </div>
            <Mini label="wand tol" value={tol} min={0.02} max={0.6} step={0.01} onChange={setTol} />
            <S label="rotate" k="rot" min={-180} max={180} />
            <S label="scale" k="sc" min={0.2} max={3} step={0.05} />
            <S label="offset x" k="ox" min={-120} max={120} />
            <S label="offset y" k="oy" min={-120} max={120} />
            <button className="obtn" onClick={() => src && setSrc({ ...src, mask: null, maskC: null })}>clear selection</button>
            <div className="brow">
              <input className="bname" placeholder="brush name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="obtn" onClick={save}>save</button>
            </div>
            <span className="ohint">click = wand select · shift+click = add · light areas raise relief</span>
          </div>
        </div>
        <div className="blist">
          {lib.map((b) => (
            <div key={b.id} className="bitem">
              <img className="bthumb" src={b.url} alt="" />
              <input className="bname" value={b.name}
                onChange={(e) => set(null, 'brushLib', lib.map((x) => (x.id === b.id ? { ...x, name: e.target.value } : x)))} />
              <button className="obtn" onClick={() => { loadURL(b.url, b.name); }}>edit</button>
              <button className={`obtn${params.brush.type === `cb:${b.id}` ? ' on' : ''}`}
                onClick={() => set('brush', 'type', `cb:${b.id}`)}>use</button>
              <button className="obtn" onClick={() => {
                set(null, 'brushLib', lib.filter((x) => x.id !== b.id));
                if (params.brush.type === `cb:${b.id}`) set('brush', 'type', 'soft');
              }}>✕</button>
            </div>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            const u = URL.createObjectURL(f);
            loadURL(u, f.name.replace(/\.[^.]+$/, '') || 'brush');
          }} />
      </div>
    </div>
  );
}

export function StatusBar({ posRef, params, layers }) {
  return (
    <div className="statusbar">
      <span>doc {params.resW || params.res}×{params.resH || params.res}</span>
      <span>tool: {params.tool}</span>
      <span>layers: {layers.list.length}</span>
      <span className="spos" ref={posRef}>— , —</span>
      <span className="sright">{params.seamless ? 'seamless tile' : 'single'}</span>
    </div>
  );
}
