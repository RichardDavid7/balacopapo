(async function initLauncher() {
  const form = document.getElementById('connect-form');
  const urlInput = document.getElementById('instance-url');
  const standbyToggle = document.getElementById('standby-toggle');
  const errorMsg = document.getElementById('error-msg');
  const connectBtn = document.getElementById('connect-btn');
  const versionEl = document.getElementById('app-version');
  const checkUpdateBtn = document.getElementById('check-update-btn');
  const updateNote = document.getElementById('update-note');

  const api = window.backspace;
  const nativeApi = window.backspaceNative;

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }

  function clearError() {
    errorMsg.textContent = '';
    errorMsg.hidden = true;
  }

  if (api && typeof api.getVersion === 'function') {
    try {
      const version = await api.getVersion();
      if (version) versionEl.textContent = `v${version}`;
    } catch (_) {
      // keep fallback label
    }
  }

  if (api && typeof api.getInstanceUrl === 'function') {
    try {
      const saved = await api.getInstanceUrl();
      if (saved) urlInput.value = saved;
    } catch (_) {
      // ignore
    }
  }

  if (nativeApi && typeof nativeApi.getStandbyMode === 'function') {
    try {
      standbyToggle.checked = Boolean(await nativeApi.getStandbyMode());
    } catch (_) {
      // ignore
    }
  }

  standbyToggle.addEventListener('change', async () => {
    if (nativeApi && typeof nativeApi.setStandbyMode === 'function') {
      try {
        await nativeApi.setStandbyMode(standbyToggle.checked);
      } catch (_) {
        // ignore
      }
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    let raw = urlInput.value.trim();
    if (!raw) {
      showError('Informe o endereço da sua instância Balacopapo.');
      return;
    }

    if (!/^https?:\/\//i.test(raw)) {
      raw = `https://${raw}`;
    }

    let parsed;
    try {
      parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Protocolo inválido');
      }
    } catch (_) {
      showError('URL inválida. Exemplo: https://balacopapo.seudominio.com');
      return;
    }

    const normalized = parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname);
    connectBtn.disabled = true;
    connectBtn.textContent = 'Conectando...';

    try {
      await api.setInstanceUrl(normalized);
      window.location.href = normalized;
    } catch (err) {
      showError(`Não foi possível salvar a instância: ${String(err)}`);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Conectar';
    }
  });

  if (api && typeof api.onUpdateStatusChanged === 'function') {
    api.onUpdateStatusChanged((snapshot) => {
      if (!snapshot || !snapshot.status) return;
      const st = snapshot.status;
      updateNote.hidden = false;
      switch (st.phase) {
        case 'checking':
          updateNote.textContent = 'Verificando atualizações...';
          break;
        case 'available':
          updateNote.textContent = `Nova versão disponível: v${st.version}`;
          break;
        case 'downloading':
          updateNote.textContent = `Baixando v${st.version} (${Math.round(st.percent || 0)}%)...`;
          break;
        case 'ready':
          updateNote.textContent = `v${st.version} pronta! Reinicie para instalar.`;
          break;
        case 'up-to-date':
          updateNote.textContent = 'Você já está na versão mais recente.';
          break;
        case 'failed':
          updateNote.textContent = `Falha ao verificar: ${st.message || 'erro desconhecido'}`;
          break;
        default:
          updateNote.hidden = true;
      }
    });
  }

  checkUpdateBtn.addEventListener('click', () => {
    if (api && typeof api.checkForUpdates === 'function') {
      api.checkForUpdates();
    }
  });
})();
