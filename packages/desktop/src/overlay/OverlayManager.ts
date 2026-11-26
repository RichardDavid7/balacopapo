import { BrowserWindow, screen } from 'electron';
import { OVERLAY_SHELL_HTML } from './overlayHtml';
import type { OverlayConfig, OverlayEvent } from './types';

const DEFAULT_CONFIG: OverlayConfig = {
  enabled: true,
  displayId: null,
  corner: 'top-left',
  opacity: 0.95,
};

/**
 * Standalone, isolated OS Overlay manager for Balacopapo Desktop.
 *
 * Owns a single transparent, frameless, click-through, always-on-top window
 * hosting independent widget layers (stream pointer pings, speaking indicators,
 * join/leave toasts). Automatically hides when no transient or persistent
 * items are visible so GPU/CPU usage drops to zero when idle.
 */
export class OverlayManager {
  private win: BrowserWindow | null = null;
  private ready = false;
  private config: OverlayConfig = { ...DEFAULT_CONFIG };
  private pendingEvents: OverlayEvent[] = [];
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private hasPersistentSpeakers = false;

  setConfig(partial: Partial<OverlayConfig>): void {
    this.config = { ...this.config, ...partial };
    if (!this.config.enabled) {
      if (this.win && !this.win.isDestroyed()) {
        this.win.hide();
      }
      return;
    }
    if (this.win && !this.win.isDestroyed() && this.ready) {
      this.applyConfigToWindow();
    }
  }

  setTargetDisplayId(displayId: string | null): void {
    this.config.displayId = displayId && displayId.trim() ? displayId.trim() : null;
    if (this.win && !this.win.isDestroyed()) {
      this.win.setBounds(this.resolveTargetBounds());
    }
  }

  dispatch(event: OverlayEvent): void {
    if (!this.config.enabled) return;

    const sanitized = this.sanitizeEvent(event);
    if (!sanitized) return;

    if (sanitized.kind === 'speaking_update') {
      this.hasPersistentSpeakers = sanitized.speakers.length > 0;
      if (!this.hasPersistentSpeakers && (!this.win || this.win.isDestroyed())) {
        return;
      }
    }

    this.ensureWindow();
    if (!this.ready) {
      this.pendingEvents.push(sanitized);
      return;
    }

    this.sendEventToWindow(sanitized);
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
    this.pendingEvents = [];
    this.hasPersistentSpeakers = false;
  }

  private resolveTargetBounds(): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    if (this.config.displayId) {
      const match = displays.find((d) => String(d.id) === this.config.displayId);
      if (match) return match.bounds;
    }
    return screen.getPrimaryDisplay().bounds;
  }

  private ensureWindow(): void {
    const bounds = this.resolveTargetBounds();
    if (this.win && !this.win.isDestroyed()) {
      this.win.setBounds(bounds);
      return;
    }

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
      this.applyConfigToWindow();
      const queued = this.pendingEvents.splice(0);
      for (const item of queued) {
        this.sendEventToWindow(item);
      }
    });
    void this.win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_SHELL_HTML)}`);
  }

  private applyConfigToWindow(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const js = `window.__overlaySetConfig && window.__overlaySetConfig(${JSON.stringify({
      corner: this.config.corner,
      opacity: this.config.opacity,
    })});`;
    void this.win.webContents.executeJavaScript(js).catch(() => {});
  }

  private sendEventToWindow(event: OverlayEvent): void {
    if (!this.win || this.win.isDestroyed()) return;

    const shouldBeVisible =
      event.kind === 'pointer_ping'
      || event.kind === 'toast'
      || this.hasPersistentSpeakers;

    if (shouldBeVisible) {
      this.win.showInactive();
      this.win.setAlwaysOnTop(true, 'screen-saver');
    }

    const js = `window.__overlayDispatch && window.__overlayDispatch(${JSON.stringify(event)});`;
    void this.win.webContents.executeJavaScript(js).catch(() => {});

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    if (!this.hasPersistentSpeakers) {
      if (event.kind === 'speaking_update') {
        this.win.hide();
      } else {
        this.hideTimer = setTimeout(() => {
          if (this.win && !this.win.isDestroyed() && !this.hasPersistentSpeakers) {
            this.win.hide();
          }
          this.hideTimer = null;
        }, 3600);
      }
    }
  }

  private sanitizeEvent(event: OverlayEvent): OverlayEvent | null {
    if (event.kind === 'pointer_ping') {
      const x = Number(event.x);
      const y = Number(event.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(event.color) ? event.color : '#7c3aed';
      return {
        kind: 'pointer_ping',
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        senderName: String(event.senderName || '').slice(0, 48),
        color: safeColor,
      };
    }
    if (event.kind === 'speaking_update') {
      const speakers = (Array.isArray(event.speakers) ? event.speakers : []).slice(0, 12).map((s) => ({
        id: String(s.id || '').slice(0, 64),
        name: String(s.name || '').slice(0, 48),
        avatarColor: s.avatarColor && /^#[0-9a-fA-F]{3,8}$/.test(s.avatarColor) ? s.avatarColor : '#34d399',
        muted: Boolean(s.muted),
        deafened: Boolean(s.deafened),
      }));
      return { kind: 'speaking_update', speakers };
    }
    if (event.kind === 'toast') {
      return {
        kind: 'toast',
        title: String(event.title || '').slice(0, 80),
        subtitle: event.subtitle ? String(event.subtitle).slice(0, 80) : undefined,
        tone: event.tone ?? 'info',
      };
    }
    return null;
  }
}
