// Crash guard — catches errors, shows report overlay, lets user copy/download it
export function installCrashGuard() {
  let shown = false;

  const buildReport = (kind, err) => [
    "SULAWESI'S GROTTO — crash report",
    `time: ${new Date().toISOString()}`,
    `kind: ${kind}`,
    `ua: ${navigator.userAgent}`,
    '---',
    err && err.stack ? String(err.stack) : String(err),
  ].join('\n');

  const show = (kind, err) => {
    const text = buildReport(kind, err);
    console.error(text);
    if (shown) return;
    shown = true;
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;right:12px;bottom:36px;z-index:9999;max-width:420px;' +
      'background:#1a0d0d;border:1px solid #7a2020;color:#e8c9c9;' +
      "font:11px/1.5 Helvetica,Arial,sans-serif;padding:12px;box-shadow:4px 4px 0 rgba(0,0,0,.6)";
    const h = document.createElement('div');
    h.textContent = '◈ qualcosa è andato storto — mandami questo report';
    h.style.cssText = 'font-weight:700;margin-bottom:8px;color:#ff9b9b;letter-spacing:.08em';
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText =
      'white-space:pre-wrap;max-height:140px;overflow:auto;background:#120808;' +
      'padding:8px;font:9px/1.4 monospace;border:1px solid #3a1515;margin:0 0 8px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'flex:1;background:#2a1010;color:#e8c9c9;border:1px solid #5a2020;' +
        'font:inherit;padding:5px;cursor:pointer;text-transform:uppercase;letter-spacing:.08em';
      b.onmouseenter = () => (b.style.color = '#fff');
      b.onmouseleave = () => (b.style.color = '#e8c9c9');
      b.onclick = fn;
      return b;
    };
    row.append(
      mk('copy report', () => navigator.clipboard?.writeText(text)),
      mk('download .txt', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        a.download = `grotto-crash-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(a.href);
      }),
      mk('dismiss', () => { box.remove(); shown = false; }),
    );
    box.append(h, pre, row);
    document.body.appendChild(box);
  };

  window.addEventListener('error', (e) => show('uncaught error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => show('unhandled rejection', e.reason));
}
