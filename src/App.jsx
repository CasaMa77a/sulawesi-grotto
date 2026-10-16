import { useEffect, useRef, useState } from 'react';
import CanvasStage from './components/CanvasStage.jsx';
import Controls from './components/Controls.jsx';
import { MenuBar, Toolbar, OptionsBar, StatusBar, BrushEditor } from './components/Chrome.jsx';

const DEFAULTS = {
  res: 1024, resW: 1024, resH: 1024,
  seamless: true,
  symmetry: 'none',
  tool: 'brush',
  wand: { tol: 0.12, blur: 4, contig: true },
  stamp: { sx: 1, sy: 1, rot: 0, gain: 1, invert: false },
  brush: { size: 46, soft: 0.55, gain: 1, erase: false, type: 'soft', follow: true, angle: 45, jitter: 0.5 },
  brushLib: [],
  gen: { seed: 7, cells: 6, octaves: 4, threshold: 0.55, soft: 0.06, mode: 'outline', lineBlur: 2.5, roots: 18 },
  emb: { mode: 'pillow', depth: 3.2, size: 7, soften: 4, angle: 135, innerGain: 6, outerGain: 3, bumpAmt: 0.3, bumpScale: 90, bumpSeed: 3, fuse: 0, web: 0, facet: 6, lightFollow: false },
  col: { enabled: false, bg: '#0a0805', lo: '#2e2419', hi: '#e8e2d6', pig: '#c55a1e', pigAmt: 0.8 },
  img: { mode: 'off', amount: 0.8 },
  dith: { mode: 'off', levels: 2, pixel: 1 },
  lev: { gamma: 1, gain: 1.4, threshold: 0, invert: false },
  surf: { erosion: 0, mottle: 0, grain: 0, cracks: 0, seed: 11, scales: 0, chrome: 0, vign: 0, ao: 0, corro: 0 },
  curve: [{ x: 0, y: 0 }, { x: 0.25, y: 1 }, { x: 0.5, y: 0 }, { x: 0.75, y: 1 }, { x: 1, y: 0 }],
  mesh: { ext: 0.18, base: 0.05, res: 160, smooth: true, cut: 0.06, exposure: 1.3, rough: 0.4, metal: 0.3, trim: true },
};

export default function App() {
  const [params, setParams] = useState(DEFAULTS);
  const apiRef = useRef(null);
  const previewRef = useRef(null);
  const posRef = useRef(null);
  const [showTile, setShowTile] = useState(true);
  const [layers, setLayers] = useState({ list: [], active: 0, hist: [] });
  const [brushEditor, setBrushEditor] = useState(false);

  const set = (sec, key, val) => {
    // if the active layer has fx, the effect panels edit ITS style live (PS-like)
    if (layers.list[layers.active]?.fx &&
        (sec === 'emb' || sec === 'surf' || sec === 'lev' || sec === 'col' || sec === 'curve')) {
      apiRef.current?.setLayerParam(sec, key, val);
      return;
    }
    setParams((p) => {
      if (sec === null) return { ...p, [key]: val };
      if (sec === 'curve') return { ...p, curve: val };
      return { ...p, [sec]: { ...p[sec], [key]: val } };
    });
  };

  useEffect(() => { if (showTile) apiRef.current?.markDirty(); }, [showTile]);

  // dismiss web splash once mounted
  useEffect(() => {
    const el = document.getElementById('splash');
    if (!el) return;
    const t = setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 500); }, 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="app">
      <MenuBar apiRef={apiRef} showTile={showTile} onToggleTile={() => setShowTile(!showTile)} />
      <div className="workspace">
        <Toolbar tool={params.tool} setTool={(t) => set(null, 'tool', t)} />
        <div className="centerCol">
          <OptionsBar params={params} set={set} apiRef={apiRef} onBrushLib={() => setBrushEditor(true)} />
          <div className="canvasArea">
            <CanvasStage
              params={params} apiRef={apiRef}
              previewRef={showTile ? previewRef : { current: null }}
              posRef={posRef}
              onLayersChange={(list, active, hist, style) => setLayers({ list, active, hist, style })}
              onToolChange={(t) => set(null, 'tool', t)}
              onParam={set}
              onProject={(p2) => setParams((prev) => ({ ...prev, ...p2 }))}
            />
            {showTile && (
              <div className="tileBox">
                <canvas ref={previewRef} className="tilePreview" width={330} height={330} />
                <span>tile ×3</span>
              </div>
            )}
          </div>
        </div>
        <Controls params={params} set={set} apiRef={apiRef} layers={layers} />
      </div>
      <StatusBar posRef={posRef} params={params} layers={layers} />
      {brushEditor && (
        <BrushEditor params={params} set={set} apiRef={apiRef} onClose={() => setBrushEditor(false)} />
      )}
    </div>
  );
}
