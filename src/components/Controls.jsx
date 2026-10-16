import { useRef } from 'react';
import CurveEditor from './CurveEditor.jsx';
import OrbitView from './OrbitView.jsx';

const CURVE_PRESETS = {
  ridge: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }],
  double: [{ x: 0, y: 0 }, { x: 0.25, y: 1 }, { x: 0.5, y: 0 }, { x: 0.75, y: 1 }, { x: 1, y: 0 }],
  slope: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  steps: [{ x: 0, y: 0 }, { x: 0.2, y: 0.8 }, { x: 0.4, y: 0.2 }, { x: 0.6, y: 1 }, { x: 0.8, y: 0.1 }, { x: 1, y: 0 }],
};

const BLEND_MODES = [
  ['lighter', 'add'], ['screen', 'screen'], ['multiply', 'multiply'], ['overlay', 'overlay'],
  ['difference', 'difference'], ['exclusion', 'exclusion'],
  ['darken', 'darken'], ['lighten', 'lighten'],
  ['hard-light', 'hard light'], ['soft-light', 'soft light'],
  ['color-dodge', 'color dodge'], ['color-burn', 'color burn'],
];

const MATERIALS = {
  raw:   { erosion: 0,    mottle: 0,    grain: 0,    cracks: 0,   corro: 0,   scales: 0,   chrome: 0,   vign: 0,   ao: 0 },
  rust:  { erosion: 0.45, mottle: 0.6,  grain: 0.35, cracks: 0.1, corro: 0.85, scales: 0,   chrome: 0,   vign: 0,   ao: 0.3 },
  earth: { erosion: 0.2,  mottle: 0.7,  grain: 0.25, cracks: 0,   corro: 0.25, scales: 0,   chrome: 0,   vign: 0.2, ao: 0.4 },
  rock:  { erosion: 0.3,  mottle: 0.45, grain: 0.5,  cracks: 0.7, corro: 0.1,  scales: 0,   chrome: 0,   vign: 0,   ao: 0.5 },
  relic: { erosion: 0.6,  mottle: 0.5,  grain: 0.4,  cracks: 0.5, corro: 0.5,  scales: 0.2, chrome: 0,   vign: 0.3, ao: 0.5 },
  biomech: { erosion: 0.1, mottle: 0.3, grain: 0.2,  cracks: 0.15, corro: 0.2, scales: 0.7, chrome: 0.5, vign: 0.4, ao: 0.6 },
  carved: { erosion: 0.15, mottle: 0.5, grain: 0.35, cracks: 0.3, corro: 0.15, scales: 0,   chrome: 0,   vign: 0.35, ao: 0.55 },
};

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.round(rnd(a, b));

const hslHex = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};

// dark-organic random palette: near-black bg, deep shadow, bright light, saturated pigment
const randomPalette = () => {
  const h = ri(0, 359);
  const bgHue = Math.random() < 0.6 ? ri(0, 50) : h;
  return {
    bg: hslHex(bgHue, ri(8, 28), ri(4, 11)),
    lo: hslHex(h, ri(30, 65), ri(10, 26)),
    hi: hslHex(h + ri(-40, 40), ri(45, 95), ri(60, 88)),
    pig: hslHex(ri(0, 359), ri(55, 95), ri(30, 55)),
  };
};

// module-level components — must NOT be recreated per render or inputs remount/lose state
const Panel = ({ title, hint, children, open = true }) => (
  <details className="panel" open={open}>
    <summary>{title}</summary>
    <div className="pbody">
      {hint && <p className="phint">{hint}</p>}
      {children}
    </div>
  </details>
);
const Sl = ({ label, value, min, max, step = 1, onChange, fmt }) => (
  <label className="sl">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))} />
    <em>{fmt ? fmt(value) : (step < 1 ? (+value).toFixed(step < 0.01 ? 3 : 2) : value)}</em>
  </label>
);
const Sel = ({ label, value, opts, onChange }) => (
  <label className="sl">
    <span>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
    </select>
  </label>
);
const Tg = ({ label, value, onChange }) => (
  <button className={`tg ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
    {value ? '■' : '□'} {label}
  </button>
);
const Btn = ({ children, ...rest }) => <button className="btn" {...rest}>{children}</button>;

export default function Controls({ params, set, apiRef, layers }) {
  // when the active layer has fx, the effect panels edit THAT layer's style
  const fxStyle = layers.list[layers.active]?.fx ? layers.style : null;
  const p = fxStyle
    ? { ...params, emb: fxStyle.emb, surf: fxStyle.surf, lev: fxStyle.lev, col: fxStyle.col, curve: fxStyle.curve }
    : params;
  const fileRef = useRef(null);

  const applyMat = (k) => {
    for (const key in MATERIALS[k]) set('surf', key, MATERIALS[k][key]);
    set('surf', 'seed', ri(0, 9999));
  };

  const randomize = () => {
    set('gen', 'seed', ri(0, 9999));
    set('gen', 'threshold', +rnd(0.4, 0.65).toFixed(2));
    set('gen', 'cells', ri(3, 10));
    set('emb', 'depth', +rnd(1.5, 6).toFixed(1));
    set('emb', 'size', ri(3, 14));
    set('emb', 'angle', ri(0, 359));
    set('emb', 'bumpAmt', +rnd(0, 0.7).toFixed(2));
    const keys = Object.keys(CURVE_PRESETS);
    set('curve', null, CURVE_PRESETS[keys[ri(0, keys.length - 1)]].map((q) => ({ ...q })));
  };

  return (
    <aside className="dock">

      <Panel title="Layers" hint="stack di forme — ogni layer può essere disegnato/generato separatamente">
        {layers.list[layers.active] && (<>
          <Sel label="blend" value={layers.list[layers.active].blend || 'lighter'}
            onChange={(v) => apiRef.current?.setLayerBlend(layers.active, v)} opts={BLEND_MODES} />
          <Sl label="opacity" value={layers.list[layers.active].opacity ?? 1} min={0} max={1} step={0.01}
            onChange={(v) => apiRef.current?.setLayerOpacity(layers.active, v)} />
        </>)}
        <div className="layers">
          {layers.list.map((l, i) => (
            <div key={l.id} className={`lrow ${i === layers.active ? 'act' : ''}`}
              onClick={() => apiRef.current?.selectLayer(i)}>
              <button className="eye" onClick={(e) => { e.stopPropagation(); apiRef.current?.toggleLayer(i); }}>
                {l.on ? '◉' : '○'}
              </button>
              <button className={`eye fx${l.fx ? ' fxon' : ''}`}
                title={l.fx ? 'layer fx: on — click to remove' : 'snapshot current emboss/surface/levels/colors onto this layer'}
                onClick={(e) => { e.stopPropagation(); apiRef.current?.toggleFx(i); }}>
                fx
              </button>
              <span>{l.name}{i === layers.active ? ' ◂' : ''}</span>
            </div>
          ))}
          <p className="hint">fx = effetti propri sul layer — con fx attivo i pannelli emboss/surface/levels/colors modificano quel layer</p>
          {fxStyle && <p className="hint" style={{ color: 'var(--acc)' }}>▸ editing layer fx: {layers.list[layers.active]?.name}</p>}
        </div>
        <div className="row wrap">
          <Btn onClick={() => apiRef.current?.addLayer()}>+ new</Btn>
          <Btn onClick={() => apiRef.current?.mergeDown()}>merge ↓</Btn>
          <Btn onClick={() => apiRef.current?.clear()}>wipe</Btn>
          <Btn onClick={() => apiRef.current?.removeLayer()}>del</Btn>
        </div>
      </Panel>

      <Panel title="History" open={false} hint="click su una voce per tornare a quello stato">
        <div className="layers hist">
          {(layers.hist || []).map((tag, i) => (
            <div key={i} className={`lrow ${i === layers.hist.length - 1 ? 'act' : ''}`}
              onClick={() => apiRef.current?.historyTo(i)}>
              <span>{i === layers.hist.length - 1 ? '▸ ' : ''}{tag}</span>
            </div>
          ))}
          {!(layers.hist || []).length && <p className="hint">nessuna azione ancora</p>}
        </div>
      </Panel>

      <Panel title="3D Preview" hint="trascina per orbitare · scroll = zoom">
        <OrbitView apiRef={apiRef} params={p} />
        <Sl label="extrusion" value={p.mesh.ext} min={0.02} max={0.8} step={0.01} onChange={(v) => set('mesh', 'ext', v)} />
        <Sl label="base thick" value={p.mesh.base} min={0.01} max={0.4} step={0.01} onChange={(v) => set('mesh', 'base', v)} />
        <Sl label="mesh res" value={p.mesh.res} min={32} max={400} onChange={(v) => set('mesh', 'res', v)} />
        <Sl label="cut bg" value={p.mesh.cut} min={0} max={0.5} step={0.01} onChange={(v) => set('mesh', 'cut', v)} />
        <Sl label="exposure" value={p.mesh.exposure} min={0.3} max={3} step={0.05} onChange={(v) => set('mesh', 'exposure', v)} />
        <Sl label="roughness" value={p.mesh.rough} min={0} max={1} step={0.01} onChange={(v) => set('mesh', 'rough', v)} />
        <Sl label="metal" value={p.mesh.metal} min={0} max={1} step={0.01} onChange={(v) => set('mesh', 'metal', v)} />
        <Tg label="smooth normals" value={p.mesh.smooth} onChange={(v) => set('mesh', 'smooth', v)} />
        <Tg label="trim bg (export)" value={p.mesh.trim} onChange={(v) => set('mesh', 'trim', v)} />
        <Btn onClick={() => apiRef.current?.exportGLB()}>export .glb (textured)</Btn>
        <Btn onClick={() => apiRef.current?.exportOBJ()}>export .obj + mtl</Btn>
      </Panel>

      <Panel title="Generate" hint="noise → threshold → forme (come magic wand su noise blur)">
        <div className="row">
          <Sl label="seed" value={p.gen.seed} min={0} max={9999} onChange={(v) => set('gen', 'seed', v)} />
          <Btn onClick={() => set('gen', 'seed', ri(0, 9999))}>⤨</Btn>
        </div>
        <Sl label="scale" value={p.gen.cells} min={2} max={24} onChange={(v) => set('gen', 'cells', v)} />
        <Sl label="octaves" value={p.gen.octaves} min={1} max={7} onChange={(v) => set('gen', 'octaves', v)} />
        <Sl label="threshold" value={p.gen.threshold} min={0.2} max={0.8} step={0.01} onChange={(v) => set('gen', 'threshold', v)} />
        <Sl label="edge soft" value={p.gen.soft} min={0} max={0.2} step={0.005} onChange={(v) => set('gen', 'soft', v)} />
        <Sl label="line blur" value={p.gen.lineBlur} min={0} max={12} step={0.5} onChange={(v) => set('gen', 'lineBlur', v)} />
        <Sel label="extract" value={p.gen.mode} onChange={(v) => set('gen', 'mode', v)}
          opts={[['outline', 'contour lines'], ['fill', 'filled blobs'], ['both', 'fill + contour'], ['roots', 'roots (creeping)']]} />
        {p.gen.mode === 'roots' && (
          <Sl label="roots count" value={p.gen.roots} min={2} max={80} onChange={(v) => set('gen', 'roots', v)} />)}
        <div className="row">
          <Btn onClick={() => apiRef.current?.generate(false)}>generate</Btn>
          <Btn onClick={() => apiRef.current?.generate(true)}>+ add</Btn>
        </div>
      </Panel>

      <Panel title="Bevel & Emboss" hint="il rilievo — depth/spessore/luce + fuse per fondere le forme">
        <Sel label="style" value={p.emb.mode} onChange={(v) => set('emb', 'mode', v)}
          opts={[['pillow', 'pillow ridge'], ['emboss', 'emboss'], ['chisel', 'chisel (facets)'],
            ['round', 'round dome'], ['incise', 'incise (carved in)']]} />
        {p.emb.mode === 'chisel' && (
          <Sl label="facets" value={p.emb.facet} min={2} max={16} onChange={(v) => set('emb', 'facet', v)} />)}
        <Sl label="depth" value={p.emb.depth} min={0} max={10} step={0.1} onChange={(v) => set('emb', 'depth', v)} />
        <Sl label="size" value={p.emb.size} min={1} max={40} onChange={(v) => set('emb', 'size', v)} />
        <Sl label="soften" value={p.emb.soften} min={0} max={24} step={0.5} onChange={(v) => set('emb', 'soften', v)} />
        <Sl label="light angle" value={p.emb.angle} min={0} max={360} fmt={(v) => v + '°'} onChange={(v) => set('emb', 'angle', v)} />
        <Sl label="inner" value={p.emb.innerGain} min={0} max={20} step={0.5} onChange={(v) => set('emb', 'innerGain', v)} />
        <Sl label="outer" value={p.emb.outerGain} min={0} max={10} step={0.5} onChange={(v) => set('emb', 'outerGain', v)} />
        <Sl label="fuse metaball" value={p.emb.fuse} min={0} max={1} step={0.01} onChange={(v) => set('emb', 'fuse', v)} />
        <Sl label="web membrane" value={p.emb.web} min={0} max={1} step={0.01} onChange={(v) => set('emb', 'web', v)} />
        <Tg label="light follows mouse" value={p.emb.lightFollow} onChange={(v) => set('emb', 'lightFollow', v)} />
      </Panel>

      <Panel title="Gloss Contour" hint="la curva che scolpisce le creste — stile Photoshop">
        <CurveEditor points={p.curve} onChange={(pts) => set('curve', null, pts)} />
        <div className="row wrap">
          <Btn onClick={() => {
            const n = ri(4, 7), xs = [];
            for (let i = 0; i < n - 2; i++) xs.push(Math.random());
            xs.sort();
            set('curve', null, [{ x: 0, y: Math.random() },
              ...xs.map((x) => ({ x, y: Math.random() })), { x: 1, y: Math.random() }]);
          }}>random</Btn>
          {Object.keys(CURVE_PRESETS).map((k) => (
            <Btn key={k} onClick={() => set('curve', null, CURVE_PRESETS[k].map((q) => ({ ...q })))}>{k}</Btn>
          ))}
        </div>
        <p className="hint">drag pts · click = add · right-click = del</p>
      </Panel>

      <Panel title="Bump texture" open={false} hint="grana che increspa il rilievo">
        <Sl label="amount" value={p.emb.bumpAmt} min={0} max={1.5} step={0.01} onChange={(v) => set('emb', 'bumpAmt', v)} />
        <div className="row">
          <Sl label="scale" value={p.emb.bumpScale} min={4} max={256} onChange={(v) => set('emb', 'bumpScale', v)} />
          <Btn onClick={() => set('emb', 'bumpSeed', ri(0, 9999))}>⤨</Btn>
        </div>
      </Panel>

      <Panel title="Material — artifact" open={false} hint="invecchia: erosione, patina, grana pietra, crepe">
        <div className="row wrap">
          {Object.keys(MATERIALS).map((k) => (
            <Btn key={k} onClick={() => applyMat(k)}>{k}</Btn>
          ))}
        </div>
        <Sl label="erosion" value={p.surf.erosion} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'erosion', v)} />
        <Sl label="patina" value={p.surf.mottle} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'mottle', v)} />
        <Sl label="grain" value={p.surf.grain} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'grain', v)} />
        <Sl label="cracks" value={p.surf.cracks} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'cracks', v)} />
        <Sl label="scales honeycomb" value={p.surf.scales} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'scales', v)} />
        <Sl label="chrome airbrush" value={p.surf.chrome} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'chrome', v)} />
        <Sl label="vignette fog" value={p.surf.vign} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'vign', v)} />
        <Sl label="ao cavity" value={p.surf.ao} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'ao', v)} />
        <Sl label="corrosion rust" value={p.surf.corro} min={0} max={1} step={0.01} onChange={(v) => set('surf', 'corro', v)} />
        <div className="row">
          <Sl label="seed" value={p.surf.seed} min={0} max={9999} onChange={(v) => set('surf', 'seed', v)} />
          <Btn onClick={() => set('surf', 'seed', ri(0, 9999))}>⤨</Btn>
        </div>
      </Panel>

      <Panel title="Color & Pigment" open={false} hint="tavolozza + pigmento che si deposita nelle cavità">
        <Tg label="color mode" value={p.col.enabled} onChange={(v) => set('col', 'enabled', v)} />
        <Btn onClick={() => { set('col', 'enabled', true); for (const [k, v] of Object.entries(randomPalette())) set('col', k, v); }}>
          random palette
        </Btn>
        {p.col.enabled && (<>
          <div className="colors">
            {[['bg', 'bg'], ['lo', 'shadow'], ['hi', 'light'], ['pig', 'pigment']].map(([k, lb]) => (
              <label key={k} className="cpick">
                <input type="color" value={p.col[k]} onChange={(e) => set('col', k, e.target.value)} />
                <span>{lb}</span>
              </label>
            ))}
          </div>
          <Sl label="pigment amt" value={p.col.pigAmt} min={0} max={1.5} step={0.01} onChange={(v) => set('col', 'pigAmt', v)} />
        </>)}
      </Panel>

      <Panel title="Image Blend" open={false} hint="incolla una foto nel rilievo · o trascinala sul canvas">
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files[0]) apiRef.current?.loadImage(e.target.files[0]); e.target.value = ''; }} />
        <div className="row">
          <Btn onClick={() => fileRef.current?.click()}>open image…</Btn>
          <Btn onClick={() => apiRef.current?.clearImage()}>✕</Btn>
        </div>
        <Sel label="blend" value={p.img.mode} onChange={(v) => set('img', 'mode', v)}
          opts={[['off', 'off'], ['carve', 'carve (relief)'], ['underlay', 'underlay'], ['inlay', 'inlay'], ['ghost', 'ghost (diff)']]} />
        <Sl label="amount" value={p.img.amount} min={0} max={1.5} step={0.01} onChange={(v) => set('img', 'amount', v)} />
        <p className="hint">wand tool (W) = prendi pezzi della foto e stira/stampa</p>
      </Panel>

      <Panel title="Levels & Dither" open={false} hint="contrasto, taglio bilevel, trame di stampa">
        <Sl label="gain" value={p.lev.gain} min={0.2} max={4} step={0.05} onChange={(v) => set('lev', 'gain', v)} />
        <Sl label="gamma" value={p.lev.gamma} min={0.2} max={4} step={0.05} onChange={(v) => set('lev', 'gamma', v)} />
        <Sl label="threshold" value={p.lev.threshold} min={0} max={1} step={0.01} onChange={(v) => set('lev', 'threshold', v)} />
        <Tg label="invert" value={p.lev.invert} onChange={(v) => set('lev', 'invert', v)} />
        <Sel label="dither" value={p.dith.mode} onChange={(v) => set('dith', 'mode', v)}
          opts={[['off', 'off'], ['bayer2', 'bayer 2×2'], ['bayer', 'bayer 4×4'], ['bayer8', 'bayer 8×8'],
            ['halftone', 'halftone dot'], ['lines', 'scanlines'], ['noise', 'white noise'],
            ['fs', 'floyd-steinberg'], ['atkinson', 'atkinson']]} />
        <Sl label="dith levels" value={p.dith.levels} min={2} max={8} onChange={(v) => set('dith', 'levels', v)} />
        <Sl label="dith pixel" value={p.dith.pixel} min={1} max={12} onChange={(v) => set('dith', 'pixel', v)} />
      </Panel>

      <Panel title="Document" open={false}>
        <Sl label="doc width" value={p.resW || p.res} min={256} max={3333} onChange={(v) => set(null, 'resW', v)} />
        <Sl label="doc height" value={p.resH || p.res} min={256} max={3333} onChange={(v) => set(null, 'resH', v)} />
        <Sel label="symmetry" value={p.symmetry} onChange={(v) => set(null, 'symmetry', v)}
          opts={[['none', 'none'], ['x', 'mirror x'], ['y', 'mirror y'], ['quad', 'quad'], ['k8', 'kaleido 8'],
            ['r3', 'radial 3'], ['r4', 'radial 4'], ['r5', 'radial 5'], ['r6', 'radial 6'], ['r8', 'radial 8'], ['r12', 'radial 12']]} />
        <div className="row">
          <Tg label="seamless tile" value={p.seamless} onChange={(v) => set(null, 'seamless', v)} />
          <Tg label="erase" value={p.brush.erase} onChange={(v) => set('brush', 'erase', v)} />
        </div>
      </Panel>

      <Panel title="Output" open={false}>
        <div className="row wrap">
          <Btn onClick={randomize}>randomize all</Btn>
          <Btn onClick={() => apiRef.current?.exportPNG()}>export png</Btn>
          <Btn onClick={() => apiRef.current?.exportTile()}>export tile 2×2</Btn>
        </div>
      </Panel>

    </aside>
  );
}
