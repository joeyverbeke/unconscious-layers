// A small debug panel any piece can mount, so the things that now sit between a
// blink and the screen can be switched off and looked at without editing code.
//
//   import { mountBlinkPanel } from './lib/blink/panel.js';
//   const stop = await startBlinkDetection({ video, onChange });
//   mountBlinkPanel(stop);          // b toggles it, hidden to begin with
//
// It is hidden by default and bound to `b`, because these are installations and
// nobody looking at the work should meet a control panel. Every piece gets the
// same one, which matters when a viewer is being misread and the question is
// which of three corrections is responsible.
//
// Deliberately free of imports, like the rest of this folder — it takes the
// handle that startBlinkDetection returned and reads everything from that.

const CSS = `
.blink-panel {
  position: fixed; right: 12px; bottom: 12px; z-index: 60;
  width: 250px; padding: 11px 12px;
  background: rgba(0,0,0,0.86); border: 1px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.85);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  backdrop-filter: blur(6px);
}
.blink-panel[hidden] { display: none; }
.blink-panel h4 {
  margin: 0 0 8px; font-size: 10px; font-weight: 400;
  letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.4);
}
.blink-panel label { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; color: rgba(255,255,255,0.55); }
.blink-panel label input { accent-color: #fff; margin: 0; }
.blink-panel dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 8px 0 0; }
.blink-panel dt { color: rgba(255,255,255,0.35); }
.blink-panel dd { margin: 0; font-variant-numeric: tabular-nums; }
.blink-panel .warn { color: rgba(255,170,150,0.95); }
.blink-panel .ok { color: rgba(150,230,170,0.9); }
`;

export function mountBlinkPanel(handle, { key = 'b', visible = false } = {}) {
  if (!handle?.settings) return null;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const panel = document.createElement('div');
  panel.className = 'blink-panel';
  panel.hidden = !visible;
  panel.innerHTML = `
    <h4>Blink</h4>
    <label><input type="checkbox" id="bp-normalize" checked> their own eyes</label>
    <label><input type="checkbox" id="bp-gates" checked> gates</label>
    <label><input type="checkbox" id="bp-both" checked> both eyes</label>
    <dl>
      <dt>closure</dt><dd id="bp-closure">—</dd>
      <dt>their open</dt><dd id="bp-rest">—</dd>
      <dt>their shut</dt><dd id="bp-shut">—</dd>
      <dt>eyes visible</dt><dd id="bp-visible">—</dd>
      <dt>blocked</dt><dd id="bp-blocked">—</dd>
    </dl>
  `;
  document.body.append(panel);

  const el = (id) => panel.querySelector(`#${id}`);
  el('bp-normalize').addEventListener('change', (e) => handle.setNormalize(e.target.checked));
  el('bp-gates').addEventListener('change', (e) => { handle.settings.gates = e.target.checked; });
  el('bp-both').addEventListener('change', (e) => { handle.settings.bothEyes = e.target.checked; });

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key === key || event.key === key.toUpperCase()) panel.hidden = !panel.hidden;
  });

  // Fed from the piece's own onFace, so the panel costs nothing when hidden.
  function update(detail) {
    if (panel.hidden || !detail) return;
    const { closure, value, face, levels, blocked } = detail;
    el('bp-closure').textContent = closure
      ? `L ${closure.left.toFixed(2)}  R ${closure.right.toFixed(2)} → ${value.toFixed(2)}`
      : '—';
    const rest = levels?.left;
    const restEl = el('bp-rest');
    restEl.textContent = rest ? `L ${rest.rest.toFixed(2)}  R ${levels.right.rest.toFixed(2)}` : '—';
    // A resting score well off zero is the sign of a face the model was not
    // built around, and the first thing to look at if someone is being misread.
    restEl.className = rest && (rest.rest > 0.18 || levels.right.rest > 0.18) ? 'warn' : '';
    el('bp-shut').textContent = rest?.ready
      ? `L ${levels.left.shut.toFixed(2)}  R ${levels.right.shut.toFixed(2)}`
      : 'learning';
    const visibleEl = el('bp-visible');
    visibleEl.textContent = face ? face.visible.toFixed(2) : 'no face';
    visibleEl.className = face && face.visible >= handle.settings.minVisible ? 'ok' : 'warn';
    el('bp-blocked').textContent =
      `${blocked.turned} turned · ${blocked.slow} slow`;
  }

  return { panel, update, toggle: () => { panel.hidden = !panel.hidden; } };
}
