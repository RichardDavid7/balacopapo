import { BrowserWindow, screen } from 'electron';

export interface StreamPointerOverlayPayload {
  x: number;
  y: number;
  senderName: string;
  color: string;
}

const OVERLAY_HTML = `<!doctype html>
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
    width: 48px;
    height: 48px;
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
    background: rgba(15, 17, 23, 0.9);
    color: #fff;
    border: 1px solid var(--c);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
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
<script>
  window.__addPing = function(x, y, name, color) {
    const el = document.createElement('div');
    el.className = 'ping';
    el.style.left = (Math.max(0, Math.min(1, x)) * 100) + '%';
    el.style.top = (Math.max(0, Math.min(1, y)) * 100) + '%';
    el.style.setProperty('--c', color || '#7c3aed');

    const ring = document.createElement('div');
    ring.className = 'ring';
    const dot = document.createElement('div');
    dot.className = 'dot';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = String(name || '');

    el.appendChild(ring);
    el.appendChild(dot);
    if (label.textContent) el.appendChild(label);
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 3300);
  };
</script>
</body>
</html>`;

export class StreamPointerOverlayManager {
  private win: BrowserWindow | null = null;
  private ready = false;
  private pendingQueue: StreamPointerOverlayPayload[] = [];
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private activeDisplayId: string | null = null;

  setSharedDisplayId(displayId: string | null): void {
    this.activeDisplayId = displayId && displayId.trim() ? displayId.trim() : null;
  }

  private resolveTargetBounds(): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    if (this.activeDisplayId) {
      const match = displays.find((d) => String(d.id) === this.activeDisplayId);
      if (match) return match.bounds;
    }
    return screen.getPrimaryDisplay().bounds;
  }

  showPing(payload: StreamPointerOverlayPayload): void {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(payload.color) ? payload.color : '#7c3aed';
    const safePayload: StreamPointerOverlayPayload = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      senderName: String(payload.senderName || '').slice(0, 48),
      color: safeColor,
    };

    const bounds = this.resolveTargetBounds();

    if (!this.win || this.win.isDestroyed()) {
      this.ready = false;
      this.win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      this.win.setAlwaysOnTop(true, 'screen-saver');
      this.win.setIgnoreMouseEvents(true, { forward: true });
      this.win.on('closed', () => {
        this.win = null;
        this.ready = false;
      });
      this.win.webContents.once('did-finish-load', () => {
        this.ready = true;
        const queued = this.pendingQueue.splice(0);
        for (const item of queued) {
          this.dispatchToWindow(item);
        }
      });
      void this.win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
    } else {
      this.win.setBounds(bounds);
    }

    if (!this.ready) {
      this.pendingQueue.push(safePayload);
      return;
    }

    this.dispatchToWindow(safePayload);
  }

  private dispatchToWindow(payload: StreamPointerOverlayPayload): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.showInactive();
    this.win.setAlwaysOnTop(true, 'screen-saver');
    const js = `window.__addPing && window.__addPing(${payload.x}, ${payload.y}, ${JSON.stringify(payload.senderName)}, ${JSON.stringify(payload.color)});`;
    void this.win.webContents.executeJavaScript(js).catch(() => {});

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.win && !this.win.isDestroyed()) {
        this.win.hide();
      }
      this.hideTimer = null;
    }, 3600);
  }

  destroy(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
    this.ready = false;
    this.pendingQueue = [];
  }
}
