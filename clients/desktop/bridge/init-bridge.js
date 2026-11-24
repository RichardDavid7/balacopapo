/**
 * Backspace Native — Bridge JS (Tauri v2 -> window.backspace)
 *
 * Injetado automaticamente via `initialization_script` em todas as páginas
 * carregadas pela WebView (launcher local e instância remota do Backspace).
 *
 * Contrato de referência: `backspace-repo/packages/desktop/src/preload.ts`.
 * Para adicionar 1 novo comando: adicione `#[tauri::command]` em `src-tauri/src/`
 * e exponha 1 linha abaixo.
 */
(function installBackspaceNativeBridge() {
  if (window.backspace && window.backspace.__nativeBridgeInstalled) {
    return;
  }

  function invoke(cmd, args) {
    const tauriCore = window.__TAURI__ && window.__TAURI__.core;
    if (tauriCore && typeof tauriCore.invoke === 'function') {
      return tauriCore.invoke(cmd, args || {});
    }
    const internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function') {
      return internals.invoke(cmd, args || {});
    }
    return Promise.reject(new Error(`[backspace-native] Tauri IPC indisponível para "${cmd}"`));
  }

  function listenEvent(eventName, callback) {
    if (typeof callback !== 'function') return () => {};
    const tauriEvent = window.__TAURI__ && window.__TAURI__.event;
    if (!tauriEvent || typeof tauriEvent.listen !== 'function') {
      return () => {};
    }
    let unlistenFn = null;
    let cancelled = false;
    tauriEvent
      .listen(eventName, (event) => {
        try {
          callback(event.payload);
        } catch (err) {
          console.error(`[backspace-native] listener "${eventName}" erro:`, err);
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      })
      .catch((err) => {
        console.warn(`[backspace-native] falha ao assinar "${eventName}":`, err);
      });

    return () => {
      cancelled = true;
      if (typeof unlistenFn === 'function') {
        unlistenFn();
      }
    };
  }

  function detectPlatform() {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (ua.includes('windows')) return 'win32';
    if (ua.includes('mac os') || ua.includes('macintosh')) return 'darwin';
    return 'linux';
  }

  const noopUnsub = () => {};

  const backspaceBridge = {
    __nativeBridgeInstalled: true,

    // Platform info (compatível com process.platform do Electron)
    platform: detectPlatform(),

    // Window controls
    minimize: () => {
      invoke('window_minimize').catch(() => {});
    },
    maximize: () => {
      invoke('window_toggle_maximize').catch(() => {});
    },
    close: () => {
      invoke('window_close_to_tray').catch(() => {});
    },

    // Notifications & badge
    showNotification: (title, body, options) => {
      invoke('show_notification', {
        title: String(title || 'Balacopapo'),
        body: String(body || ''),
        options: options || null,
      }).catch(() => {});
    },
    onNotificationClick: (callback) => listenEvent('notification-click', callback),
    setBadgeCount: (count) => {
      invoke('set_badge_count', { count: Number(count) || 0 }).catch(() => {});
    },

    // Auto-update (legacy event channels kept for backward compatibility)
    onUpdateAvailable: (callback) =>
      listenEvent('update-status-changed', (snapshot) => {
        if (snapshot && snapshot.status && snapshot.status.phase === 'available') {
          callback({ version: snapshot.status.version });
        }
      }),
    onUpdateDownloaded: (callback) =>
      listenEvent('update-status-changed', (snapshot) => {
        if (snapshot && snapshot.status && snapshot.status.phase === 'ready') {
          callback({ version: snapshot.status.version });
        }
      }),
    onUpdateError: (callback) =>
      listenEvent('update-status-changed', (snapshot) => {
        if (snapshot && snapshot.status && snapshot.status.phase === 'failed') {
          callback({
            message: snapshot.status.message || 'Update failed',
            releaseUrl: '',
          });
        }
      }),
    installUpdate: () => {
      invoke('install_update').catch(() => {});
    },
    checkForUpdates: () => {
      invoke('check_for_updates').catch(() => {});
    },
    getVersion: () => invoke('get_app_version'),

    // Auto-update (current snapshot surface)
    getUpdateStatus: () => invoke('get_update_status'),
    isSandboxed: () => invoke('is_sandboxed'),
    onUpdateStatusChanged: (callback) => listenEvent('update-status-changed', callback),
    dismissUpdate: (version) => {
      invoke('dismiss_update', { version: String(version || '') }).catch(() => {});
    },
    openReleasePage: () => {
      invoke('open_release_page').catch(() => {});
    },

    // Window focus
    onWindowFocusChange: (callback) => listenEvent('window-focus-changed', callback),

    // Deep linking & origin routing
    onDeepLink: (callback) => listenEvent('deep-link', callback),
    setConnectedOrigins: (origins) => {
      invoke('set_connected_origins', { origins: Array.isArray(origins) ? origins : [] }).catch(() => {});
    },
    onOpenInternalRoute: (callback) => listenEvent('open-internal-route', callback),

    // Screen share picker coordination (WebView native getDisplayMedia)
    onScreenShareSources: () => noopUnsub,
    selectScreenSource: () => {},
    getScreenSources: () => Promise.resolve([]),
    preselectScreenSource: () => Promise.resolve(false),
    getScreenSharePickerMode: () => Promise.resolve('native'),
    getSystemAudioCapability: () =>
      Promise.resolve({ supported: detectPlatform() === 'win32', method: 'native-display-media' }),
    startSystemAudio: () => Promise.resolve({ ok: false }),
    stopSystemAudio: () => Promise.resolve({ ok: true }),
    setScreenShareAudioPreference: () => {},

    // Instance URL management
    getInstanceUrl: () => invoke('get_instance_url'),
    setInstanceUrl: (url) => invoke('set_instance_url', { url: String(url || '') }),
    clearInstanceUrl: () => invoke('clear_instance_url'),

    // Language (relabels tray menu)
    setLanguage: (language) => {
      invoke('set_language', { language: String(language || 'en') }).catch(() => {});
    },

    // Auto-launch settings
    getAutoLaunchSettings: () => invoke('get_auto_launch_settings'),
    setAutoLaunchSettings: (settings) =>
      invoke('set_auto_launch_settings', { settings: settings || {} }),

    // Activity detection (Fase 2: src-tauri/src/activity.rs)
    onActivityDetected: (callback) => listenEvent('activity-detected', callback),
    getCurrentActivity: () => Promise.resolve(null),

    // Global keybinds (Fase 2: src-tauri/src/keybinds.rs)
    getKeybindPortalStatus: () => Promise.resolve({ supported: false, state: 'unavailable' }),
    retryKeybindPortal: () => {},
    onKeybindPortalStatus: () => noopUnsub,
    syncKeybinds: () => Promise.resolve({ ok: true }),
    onKeybindAction: (callback) => listenEvent('keybind-action', callback),
    onAccessibilityStatus: () => noopUnsub,
    onKeybindHookError: () => noopUnsub,
    checkAccessibility: () => Promise.resolve({ trusted: true }),

    // Recovery mode bridge
    rendererReady: () => {
      invoke('renderer_ready').catch(() => {});
    },
    getRecoveryState: () => invoke('get_recovery_state'),
    onRecoveryStateChanged: (callback) => listenEvent('recovery-state-changed', callback),
    recoveryAction: (action) => {
      invoke('recovery_action', { action: String(action || '') }).catch(() => {});
    },
  };

  // Extensões exclusivas do Balacopapo Desktop (Standby / futuro Motor de Voz Nativo + Overlay)
  const nativeExtensions = {
    app: 'balacopapo-desktop',
    engine: 'tauri-v2',
    deepLinkScheme: 'balacopapo',
    getStandbyMode: () => invoke('get_standby_mode'),
    setStandbyMode: (enabled) => invoke('set_standby_mode', { enabled: Boolean(enabled) }),
    hibernateNow: () => invoke('hibernate_now'),
  };

  try {
    const frozenBridge = Object.freeze(backspaceBridge);
    const frozenNative = Object.freeze(nativeExtensions);
    Object.defineProperty(window, 'backspace', {
      value: frozenBridge,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(window, 'balacopapo', {
      value: frozenBridge,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(window, 'backspaceNative', {
      value: frozenNative,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(window, 'balacopapoNative', {
      value: frozenNative,
      writable: false,
      configurable: false,
    });
  } catch (_) {
    window.backspace = backspaceBridge;
    window.balacopapo = backspaceBridge;
    window.backspaceNative = nativeExtensions;
    window.balacopapoNative = nativeExtensions;
  }
})();
