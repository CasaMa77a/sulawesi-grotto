import { useEffect, useRef } from 'react';

// minimal WebGL displaced-mesh view — CPU displacement (no vertex texture fetch),
// orbits the relief as a real 3D plate
const VS = `
attribute vec3 aPos; attribute vec3 aN; attribute vec2 aUV;
uniform mat4 uMVP; uniform mat3 uRot;
varying vec3 vN; varying vec2 vUV; varying float vH;
void main(){
  vN = uRot * aN;
  vUV = aUV; vH = aPos.z;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FS = `
precision mediump float;
varying vec3 vN; varying vec2 vUV; varying float vH;
uniform sampler2D uC; uniform vec3 uLight; uniform float uCut; uniform float uAmp;
uniform float uExposure; uniform float uRough; uniform float uMetal;
void main(){
  if (vH < uCut) discard;
  vec3 base = texture2D(uC, vUV).rgb;
  base = pow(base, vec3(0.65)) * uExposure;
  vec3 n = normalize(vN);
  vec3 l = normalize(uLight);
  float dif = max(dot(n, l), 0.0);
  // roughness → specular exponent (rough = wide soft shine)
  float shin = mix(96.0, 6.0, uRough);
  float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), shin);
  vec3 specCol = mix(vec3(1.0), base, uMetal) * mix(0.4, 1.4, 1.0 - uRough);
  vec3 difCol = base * (1.0 - uMetal * 0.6);
  gl_FragColor = vec4(difCol * (0.4 + 0.75 * dif) + spec * specCol, 1.0);
}`;

const GRID = 96;

export default function OrbitView({ apiRef, params }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    cv.width = 280; cv.height = 280;
    const gl = cv.getContext('webgl', { antialias: true });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('orbit:', gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.error('orbit link:', gl.getProgramInfoLog(pr));

    const NV = GRID + 1;
    const pos = new Float32Array(NV * NV * 3);
    const nrm = new Float32Array(NV * NV * 3);
    const uvs = new Float32Array(NV * NV * 2);
    for (let y = 0; y <= GRID; y++)
      for (let x = 0; x <= GRID; x++) {
        const i = y * NV + x;
        uvs[i * 2] = x / GRID; uvs[i * 2 + 1] = y / GRID;
        pos[i * 3] = x / GRID * 2 - 1; pos[i * 3 + 1] = y / GRID * 2 - 1;
      }
    const idx = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const i = y * NV + x;
        idx.push(i, i + 1, i + NV, i + 1, i + NV + 1, i + NV);
      }
    const mkBuf = (data, usage) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      return b;
    };
    const bPos = mkBuf(pos, gl.DYNAMIC_DRAW);
    const bNrm = mkBuf(nrm, gl.DYNAMIC_DRAW);
    const bUV = mkBuf(uvs, gl.STATIC_DRAW);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    const bind = (name, buf, size) => {
      const a = gl.getAttribLocation(pr, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, size, gl.FLOAT, false, 0, 0);
    };
    const U = (n) => gl.getUniformLocation(pr, n);
    gl.uniform1i(U('uC'), 0);
    gl.uniform3f(U('uLight'), 0.5, -0.6, 0.8);
    gl.enable(gl.DEPTH_TEST);
    const cTex = gl.createTexture();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // CPU displacement + normals from alpha field
    const rebuild = () => {
      const src = apiRef.current?.mapSources?.();
      if (!src) return;
      const alpha = src.alphaData;
      if (alpha) {
        const { data, w, h } = alpha;
        const A = (x, y) => data[Math.min(h - 1, Math.max(0, Math.round(y / GRID * (h - 1)))) * w + Math.min(w - 1, Math.max(0, Math.round(x / GRID * (w - 1))))];
        for (let y = 0; y <= GRID; y++)
          for (let x = 0; x <= GRID; x++) {
            const i = y * NV + x;
            const hv = A(x, y);
            pos[i * 3 + 2] = hv;
            const gx = (A(Math.min(GRID, x + 1), y) - A(Math.max(0, x - 1), y)) * 8;
            const gy = (A(x, Math.min(GRID, y + 1)) - A(x, Math.max(0, y - 1))) * 8;
            const il = 1 / Math.hypot(gx, gy, 1);
            nrm[i * 3] = -gx * il; nrm[i * 3 + 1] = -gy * il; nrm[i * 3 + 2] = il;
          }
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
        gl.bindBuffer(gl.ARRAY_BUFFER, bNrm);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, nrm);
      }
      gl.bindTexture(gl.TEXTURE_2D, cTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.color);
    };

    let rx = -0.55, ry = 0.6, zoom = 0.72, drag = false, lx = 0, ly = 0, lastV = -1;
    const down = (e) => { drag = true; lx = e.clientX; ly = e.clientY; };
    const up = () => (drag = false);
    const move = (e) => {
      if (!drag) return;
      ry += (e.clientX - lx) * 0.01; rx += (e.clientY - ly) * 0.01;
      rx = Math.max(-1.5, Math.min(1.5, rx));
      lx = e.clientX; ly = e.clientY;
    };
    const wheel = (e) => { e.preventDefault(); zoom = Math.max(0.3, Math.min(1.6, zoom - e.deltaY * 0.001)); };
    cv.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    cv.addEventListener('wheel', wheel, { passive: false });

    let raf;
    const loop = () => {
      const amp = params?.mesh?.ext ?? 0.32;
      gl.uniform1f(U('uAmp'), amp);
      gl.uniform1f(U('uCut'), params?.mesh?.cut ?? 0.06);
      gl.uniform1f(U('uExposure'), params?.mesh?.exposure ?? 1.3);
      gl.uniform1f(U('uRough'), params?.mesh?.rough ?? 0.4);
      gl.uniform1f(U('uMetal'), params?.mesh?.metal ?? 0.3);
      const v = apiRef.current?.renderVersion?.() ?? -1;
      if (v !== lastV) { lastV = v; rebuild(); }
      const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
      const m = [cy, sx * sy, cx * sy, 0, cx, -sx, -sy, sx * cy, cx * cy];
      const s = zoom;
      // fit doc aspect: squash the longer axis so the plate keeps proportions
      const rw = params?.resW || params?.res || 1, rh = params?.resH || params?.res || 1;
      const ax = Math.min(1, rw / rh), ay = Math.min(1, rh / rw);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniformMatrix4fv(U('uMVP'), false, new Float32Array([
        m[0] * s * ax, -m[1] * s * ax, m[2] * s * ax, 0,
        m[3] * s * ay, -m[4] * s * ay, m[5] * s * ay, 0,
        m[6] * s * amp, -m[7] * s * amp, m[8] * s * amp, 0,
        0, 0, -0.6, 1,
      ]));
      gl.uniformMatrix3fv(U('uRot'), false, new Float32Array([
        m[0], -m[3], m[6], m[1], -m[4], m[7], m[2], -m[5], m[8],
      ]));
      gl.clearColor(0.07, 0.07, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // scale z by amp via positions — pos.z is 0..1, multiply in shader? simpler: bake amp into mvp z
      bind('aPos', bPos, 3); bind('aN', bNrm, 3); bind('aUV', bUV, 2);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cTex);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointermove', move);
      cv.removeEventListener('wheel', wheel);
    };
  }, []);

  return <canvas ref={ref} className="orbit" />;
}
