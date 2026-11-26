/**
 * Self-contained HTML/CSS/JS shell for the isolated OS click-through overlay.
 *
 * Hosts three independent DOM layers inside a single transparent BrowserWindow:
 *  - `#layer-pointers` — temporary stream pointer pings (x, y, senderName, color)
 *  - `#layer-speakers` — persistent speaking-participant badges (Phase D2)
 *  - `#layer-toasts`   — transient join/leave notifications (Phase D2)
 */
export const OVERLAY_SHELL_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
    pointer-events: none;
    user-select: none;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  #overlay-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  /* ── Layer 1: Stream Pointer Pings ── */
  .ping {
    position: fixed;
    transform: translate(-50%, -50%);
    pointer-events: none;
    animation: fadeout 3.2s ease-out forwards;
  }
  .ring {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 50px;
    height: 50px;
    border-radius: 999px;
    border: 3px solid var(--c);
    transform: translate(-50%, -50%) scale(0.35);
    animation: ripple 1.2s ease-out infinite;
    box-shadow: 0 0 12px rgba(0, 0, 0, 0.55);
  }
  .dot {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: var(--c);
    border: 2px solid #fff;
    transform: translate(-50%, -50%);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
  }
  .label {
    position: absolute;
    left: 50%;
    top: 22px;
    transform: translateX(-50%);
    background: rgba(15, 17, 23, 0.92);
    color: #fff;
    border: 1px solid var(--c);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.65);
  }

  /* ── Layer 2: Speaking Participants (Phase D2) ── */
  #layer-speakers {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    max-width: 240px;
  }
  #layer-speakers[data-corner="top-left"] { top: 0; left: 0; align-items: flex-start; }
  #layer-speakers[data-corner="top-right"] { top: 0; right: 0; align-items: flex-end; }
  #layer-speakers[data-corner="bottom-left"] { bottom: 0; left: 0; align-items: flex-start; }
  #layer-speakers[data-corner="bottom-right"] { bottom: 0; right: 0; align-items: flex-end; }
  .speaker-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(15, 17, 23, 0.84);
    border: 1px solid rgba(52, 211, 153, 0.55);
    color: #f3f4f6;
    border-radius: 999px;
    padding: 5px 12px 5px 7px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  }
  .speaker-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--c, #34d399);
    box-shadow: 0 0 8px var(--c, #34d399);
    flex-shrink: 0;
  }

  /* ── Layer 3: Transient Toasts (Phase D2) ── */
  #layer-toasts {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .toast-item {
    background: rgba(15, 17, 23, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f3f4f6;
    border-radius: 10px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
    animation: fadeout 3.2s ease-out forwards;
  }

  @keyframes ripple {
    0% { transform: translate(-50%, -50%) scale(0.35); opacity: 0.95; }
    100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
  }
  @keyframes fadeout {
    0%, 75% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
</head>
<body>
  <div id="overlay-root">
    <div id="layer-pointers"></div>
    <div id="layer-speakers" data-corner="top-left"></div>
    <div id="layer-toasts"></div>
  </div>
<script>
  window.__overlaySetConfig = function(cfg) {
    var root = document.getElementById('overlay-root');
    if (root && typeof cfg.opacity === 'number') {
      root.style.opacity = String(Math.max(0.2, Math.min(1, cfg.opacity)));
    }
    var speakers = document.getElementById('layer-speakers');
    if (speakers && cfg.corner) {
      speakers.setAttribute('data-corner', String(cfg.corner));
    }
  };

  window.__overlayDispatch = function(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.kind === 'pointer_ping') {
      var container = document.getElementById('layer-pointers');
      if (!container) return;
      var el = document.createElement('div');
      el.className = 'ping';
      el.style.left = (Math.max(0, Math.min(1, Number(ev.x) || 0)) * 100) + '%';
      el.style.top = (Math.max(0, Math.min(1, Number(ev.y) || 0)) * 100) + '%';
      el.style.setProperty('--c', ev.color || '#7c3aed');

      var ring = document.createElement('div');
      ring.className = 'ring';
      var dot = document.createElement('div');
      dot.className = 'dot';
      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = String(ev.senderName || '');

      el.appendChild(ring);
      el.appendChild(dot);
      if (label.textContent) el.appendChild(label);
      container.appendChild(el);
      setTimeout(function() { el.remove(); }, 3300);
      return;
    }

    if (ev.kind === 'speaking_update') {
      var layer = document.getElementById('layer-speakers');
      if (!layer) return;
      layer.textContent = '';
      var list = Array.isArray(ev.speakers) ? ev.speakers : [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var pill = document.createElement('div');
        pill.className = 'speaker-pill';
        var sdot = document.createElement('span');
        sdot.className = 'speaker-dot';
        sdot.style.setProperty('--c', s.avatarColor || '#34d399');
        var name = document.createElement('span');
        name.textContent = String(s.name || '');
        pill.appendChild(sdot);
        pill.appendChild(name);
        layer.appendChild(pill);
      }
      return;
    }

    if (ev.kind === 'toast') {
      var toasts = document.getElementById('layer-toasts');
      if (!toasts) return;
      var item = document.createElement('div');
      item.className = 'toast-item';
      item.textContent = ev.subtitle ? (String(ev.title || '') + ' · ' + String(ev.subtitle)) : String(ev.title || '');
      toasts.appendChild(item);
      setTimeout(function() { item.remove(); }, 3300);
    }
  };
</script>
</body>
</html>`;
