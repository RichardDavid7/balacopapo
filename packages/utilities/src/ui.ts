export const UI_HTML = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Balacopapo Utilidades</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{
  color-scheme:dark;
  --bg:#0e0c15;
  --surface:#161322;
  --surface-2:#1f1b30;
  --border:#2c2742;
  --text:#eeeaf8;
  --muted:#9e96ba;
  --accent:#7c5cff;
  --accent-hover:#9175ff;
  --ok:#22a06b;
  --warn:#c48a1a;
  --err:#d9485f;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,-apple-system,sans-serif;overflow:hidden}
.app{display:grid;grid-template-columns:220px 1fr;height:100vh}
.sidebar{background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:16px 12px;gap:6px}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 14px;border-bottom:1px solid var(--border);margin-bottom:6px}
.brand-icon{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#7c5cff,#b06cff);display:grid;place-items:center;font-size:18px;flex-shrink:0}
.brand h1{font-size:14px;margin:0;line-height:1.2}
.brand span{font-size:11px;color:var(--muted)}
.nav-btn{display:flex;align-items:center;gap:10px;width:100%;padding:9px 11px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;text-align:left;font-size:13px;font-weight:500;transition:.15s}
.nav-btn:hover{background:var(--surface-2);color:var(--text)}
.nav-btn.active{background:rgba(124,92,255,.18);color:#fff}
.sidebar-foot{margin-top:auto;padding:10px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);font-size:12px}
.status-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0}
.dot.running{background:var(--ok);box-shadow:0 0 8px var(--ok)}
.dot.starting{background:var(--warn)}
.dot.error{background:var(--err)}
.main{overflow-y:auto;padding:22px 26px}
.tab{display:none;max-width:780px}
.tab.active{display:block}
h2{margin:0 0 14px;font-size:18px;font-weight:600}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.row-between{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
label:first-child{margin-top:0}
input[type=text],input[type=password],input[type=number],select{
  width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--border);
  background:var(--bg);color:var(--text);font-size:13px;outline:none
}
input:focus,select:focus{border-color:var(--accent)}
button{padding:8px 14px;border-radius:8px;border:0;background:var(--accent);color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:.15s}
button:hover{background:var(--accent-hover)}
button.sec{background:var(--surface-2);border:1px solid var(--border);color:var(--text)}
button.sec:hover{background:#292440}
button.danger{background:rgba(217,72,95,.18);color:#ff8fa0;border:1px solid rgba(217,72,95,.35)}
button.danger:hover{background:rgba(217,72,95,.3)}
button.icon{padding:8px 11px;min-width:38px;font-size:15px}
button:disabled{opacity:.45;cursor:not-allowed}
.pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
.pill.ok{background:rgba(34,160,107,.16);color:#6ef0b4;border-color:rgba(34,160,107,.35)}
.pill.accent{background:rgba(124,92,255,.18);color:#c7b8ff;border-color:rgba(124,92,255,.35)}
.now-playing{display:grid;grid-template-columns:84px 1fr;gap:16px;align-items:center}
.cover{width:84px;height:84px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);overflow:hidden;display:grid;place-items:center;font-size:32px}
.cover img{width:100%;height:100%;object-fit:cover}
.track-title{font-size:16px;font-weight:600;margin:0 0 2px;word-break:break-word}
.track-sub{font-size:12px;color:var(--muted)}
.progress-wrap{margin-top:14px}
.progress-bar{height:7px;border-radius:99px;background:var(--surface-2);overflow:hidden;cursor:pointer}
.progress-fill{height:100%;background:linear-gradient(90deg,#7c5cff,#b48aff);width:0%;transition:width .3s linear}
.time-row{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:5px}
.controls{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;flex-wrap:wrap}
.vol-wrap{display:flex;align-items:center;gap:8px;min-width:170px}
input[type=range]{-webkit-appearance:none;appearance:none;height:6px;border-radius:99px;background:var(--surface-2);outline:none;flex:1}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid #fff}
.queue-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:8px;border:1px solid transparent}
.queue-item:hover{background:var(--surface-2);border-color:var(--border)}
.queue-num{width:22px;color:var(--muted);font-size:12px;text-align:center;flex-shrink:0}
.queue-meta{flex:1;min-width:0}
.queue-title{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.queue-sub{font-size:11px;color:var(--muted)}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ch-check{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);margin-top:6px;cursor:pointer}
.ch-check input{width:auto;margin:0}
.source-card{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:10px;background:var(--bg);border:1px solid var(--border);margin-top:8px}
.err-box{margin-top:10px;padding:9px 12px;border-radius:8px;background:rgba(217,72,95,.14);border:1px solid rgba(217,72,95,.35);color:#ff9ba9;font-size:12px;display:none}
.ok-box{margin-top:10px;padding:9px 12px;border-radius:8px;background:rgba(34,160,107,.14);border:1px solid rgba(34,160,107,.35);color:#7ef2bd;font-size:12px;display:none}
pre.logs{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;height:420px;overflow:auto;font:12px/1.5 Consolas,monospace;color:#bfb8d6;margin:0;white-space:pre-wrap}
.muted{color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-icon">🎵</div>
      <div><h1>Balacopapo</h1><span>Utilidades · Música</span></div>
    </div>
    <button class="nav-btn active" data-tab="player">🎧 Player &amp; Fila</button>
    <button class="nav-btn" data-tab="connect">🔌 Conexão &amp; Canais</button>
    <button class="nav-btn" data-tab="sources">📻 Fontes de Áudio</button>
    <button class="nav-btn" data-tab="logs">📋 Logs</button>

    <div class="sidebar-foot">
      <div class="status-row">
        <span id="dot" class="dot"></span>
        <b id="stateLabel">Parado</b>
      </div>
      <div id="spaceName" class="muted" style="margin-bottom:8px">Nenhum Espaço conectado</div>
      <button id="quickToggle" class="sec" style="width:100%;padding:6px 10px;font-size:12px">Conectar</button>
    </div>
  </aside>

  <main class="main">
    <!-- TAB: PLAYER -->
    <section id="tab-player" class="tab active">
      <div class="row-between" style="margin-bottom:14px">
        <h2 style="margin:0">Player &amp; Fila</h2>
        <div class="row">
          <select id="channelSelect" style="width:220px"></select>
        </div>
      </div>

      <div id="notConnectedBanner" class="card" style="display:none">
        <b>Bot ainda não conectado a um Espaço.</b>
        <p class="muted" style="margin:6px 0 12px">Configure a URL do seu Balacopapo e a chave de API do Espaço (escopo <code>music</code>) na aba <b>Conexão &amp; Canais</b>.</p>
        <button onclick="switchTab('connect')">Ir para Conexão &amp; Canais</button>
      </div>

      <div id="playerArea">
        <div class="card">
          <div class="now-playing">
            <div class="cover" id="cover">🎵</div>
            <div>
              <div class="row" style="margin-bottom:6px">
                <span id="voiceBadge" class="pill">Ocioso</span>
                <span id="sourceBadge" class="pill accent" style="display:none"></span>
              </div>
              <div class="track-title" id="trackTitle">Nenhuma faixa tocando</div>
              <div class="track-sub" id="trackArtist">Cole um link abaixo ou adicione pelo mini-player no Balacopapo</div>
            </div>
          </div>

          <div class="progress-wrap">
            <div class="progress-bar" id="progressBar" title="Clique para avançar/voltar">
              <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="time-row">
              <span id="timeElapsed">0:00</span>
              <span id="timeTotal">0:00</span>
            </div>
          </div>

          <div class="controls">
            <div class="row">
              <button class="icon" id="btnPlayPause" title="Pausar / Retomar">▶</button>
              <button class="sec icon" id="btnSkip" title="Pular faixa">⏭</button>
              <button class="sec icon" id="btnStop" title="Parar e limpar">⏹</button>
              <button class="sec" id="btnLoop" title="Modo de repetição">🔁 Off</button>
            </div>
            <div class="vol-wrap">
              <span>🔊</span>
              <input type="range" id="volSlider" min="0" max="100" value="80">
              <span id="volText" class="muted" style="width:34px;text-align:right">80%</span>
            </div>
          </div>
          <div id="playerErr" class="err-box"></div>
        </div>

        <div class="card">
          <label for="addUrl">Adicionar música (YouTube ou URL direta de áudio/rádio)</label>
          <div class="row" style="margin-top:6px">
            <input type="text" id="addUrl" placeholder="https://www.youtube.com/watch?v=... ou link direto .mp3/.ogg" style="flex:1">
            <button id="btnAdd">Adicionar à fila</button>
          </div>
        </div>

        <div class="card">
          <div class="row-between" style="margin-bottom:8px">
            <b>Fila (<span id="queueCount">0</span>)</b>
            <button class="sec" id="btnClearQueue" style="padding:5px 10px;font-size:12px">Limpar fila</button>
          </div>
          <div id="queueList" class="muted">A fila está vazia.</div>
        </div>
      </div>
    </section>

    <!-- TAB: CONEXÃO -->
    <section id="tab-connect" class="tab">
      <h2>Conexão &amp; Canais do Espaço</h2>
      <div class="card">
        <label for="baseUrl">URL da instância Balacopapo</label>
        <input type="text" id="baseUrl" placeholder="https://seu-balacopapo.com">

        <label for="apiKey">Chave de API do Espaço (Configurações do Espaço → API &amp; Apps, escopo "music")</label>
        <input type="password" id="apiKey" placeholder="bp_...">

        <div class="grid-2" style="margin-top:4px">
          <div>
            <label for="botName">Nome do bot na call</label>
            <input type="text" id="botName" placeholder="Balacopapo Música">
          </div>
          <div>
            <label for="cacheMaxMb">Limite do cache (MB)</label>
            <input type="number" id="cacheMaxMb" min="100" max="50000" value="2048">
          </div>
        </div>

        <div class="row" style="margin-top:14px">
          <button class="sec" id="btnTest">Testar conexão</button>
          <button id="btnSaveStart">Salvar e conectar</button>
          <button class="danger" id="btnStopBot">Parar bot</button>
        </div>

        <div id="connErr" class="err-box"></div>
        <div id="connOk" class="ok-box"></div>
      </div>

      <div class="card">
        <b>Canais de voz monitorados</b>
        <div class="muted" style="margin-top:2px">Se nenhum for marcado, o bot monitora todos os canais de voz do Espaço.</div>
        <div id="channelChecks" class="muted" style="margin-top:8px">Clique em "Testar conexão" ou conecte para listar os canais.</div>
      </div>

      <div class="card">
        <div class="row-between">
          <div>
            <b>Ferramentas &amp; Cache local</b>
            <div id="toolsInfo" class="muted" style="margin-top:4px">Verificando cache...</div>
          </div>
          <button class="sec" id="btnClearCache">Limpar cache</button>
        </div>
      </div>
    </section>

    <!-- TAB: FONTES -->
    <section id="tab-sources" class="tab">
      <h2>Fontes de Áudio &amp; Módulos</h2>
      <div class="card">
        <div class="source-card" style="margin-top:0">
          <div><b>YouTube (yt-dlp + cache local)</b><div class="muted">Baixa, guarda em cache LRU e pré-carrega a próxima faixa automaticamente.</div></div>
          <span class="pill ok">Ativo</span>
        </div>
        <div class="source-card">
          <div><b>URL Direta / Rádio Online</b><div class="muted">Streams HTTP/HTTPS (.mp3, .ogg, .flac, Icecast/Shoutcast) via ffmpeg.</div></div>
          <span class="pill ok">Ativo</span>
        </div>
        <div class="source-card">
          <div><b>Navidrome (Subsonic / OpenSubsonic)</b><div class="muted">Navegue e toque músicas e playlists direto do seu servidor Navidrome.</div></div>
          <span class="pill">Em breve</span>
        </div>
        <div class="source-card">
          <div><b>DLNA / UPnP (Rede Local)</b><div class="muted">Descobrir e tocar bibliotecas de mídia da rede local.</div></div>
          <span class="pill">Em breve</span>
        </div>
        <div class="source-card">
          <div><b>Ponte de Voz Balacopapo ↔ Discord</b><div class="muted">Conecta um canal de voz do Balacopapo a um canal do Discord em tempo real.</div></div>
          <span class="pill">Em breve</span>
        </div>
      </div>
    </section>

    <!-- TAB: LOGS -->
    <section id="tab-logs" class="tab">
      <div class="row-between" style="margin-bottom:14px">
        <h2 style="margin:0">Logs do Serviço</h2>
        <div class="row">
          <button class="sec" id="btnCopyLogs">Copiar</button>
          <button class="sec" id="btnClearLogs">Limpar</button>
        </div>
      </div>
      <pre id="logsBox" class="logs"></pre>
    </section>
  </main>
</div>

<script>
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60), r = s % 60; return m + ':' + String(r).padStart(2, '0'); };
const api = async (p, o) => { const r = await fetch(p, o); const j = await r.json(); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; };

let lastStatus = null;
let selectedChannelId = '';
let selectedChannelIdsConfig = [];
let availableChannels = [];
let volDebounce = null;
let draggingVol = false;

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('tab-' + name).classList.add('active');
}
document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

function showBox(id, msg) { const el = $(id); el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }

function renderChannelChecks() {
  if (!availableChannels.length) {
    $('channelChecks').textContent = 'Clique em "Testar conexão" ou conecte para listar os canais.';
    return;
  }
  $('channelChecks').innerHTML = availableChannels.map(c =>
    '<label class="ch-check"><input type="checkbox" value="' + esc(c.id) + '" ' +
    (selectedChannelIdsConfig.includes(c.id) ? 'checked' : '') + '> 🔊 ' + esc(c.name) + '</label>'
  ).join('');
  $('channelChecks').querySelectorAll('input').forEach(inp => {
    inp.onchange = () => {
      selectedChannelIdsConfig = [...$('channelChecks').querySelectorAll('input:checked')].map(i => i.value);
    };
  });
}

async function loadSettings() {
  const s = await api('/api/settings');
  $('baseUrl').value = s.baseUrl || '';
  $('botName').value = s.botName || 'Balacopapo Música';
  $('cacheMaxMb').value = s.cacheMaxMb || 2048;
  $('apiKey').placeholder = s.hasApiKey ? '(chave salva — deixe vazio para manter)' : 'bp_...';
  selectedChannelIdsConfig = s.channelIds || [];
  if (!s.baseUrl || !s.hasApiKey) switchTab('connect');
}

async function loadCache() {
  try {
    const c = await api('/api/cache');
    const mb = (c.bytes / (1024 * 1024)).toFixed(1);
    const t = lastStatus?.tools;
    const toolsTxt = t ? (' · yt-dlp e ffmpeg prontos') : '';
    $('toolsInfo').textContent = c.files + ' arquivo(s) em cache (' + mb + ' MB)' + toolsTxt;
  } catch {}
}

function activeChannelObj() {
  const chs = (lastStatus?.channels || []).filter(c => c.active);
  if (!chs.length) return null;
  return chs.find(c => c.id === selectedChannelId) || chs[0];
}

function renderStatus(s) {
  lastStatus = s;
  const labels = { stopped: 'Parado', starting: 'Iniciando…', running: 'Conectado', error: 'Erro' };
  $('dot').className = 'dot ' + s.state;
  $('stateLabel').textContent = labels[s.state] || s.state;
  $('spaceName').textContent = s.space ? ('Espaço: ' + s.space) : 'Nenhum Espaço conectado';
  $('quickToggle').textContent = s.state === 'running' ? 'Parar' : 'Conectar';
  if (s.error) showBox('connErr', s.error);

  if (s.channels?.length) {
    availableChannels = s.channels.map(c => ({ id: c.id, name: c.name }));
    renderChannelChecks();
  }

  const activeChs = (s.channels || []).filter(c => c.active);
  $('notConnectedBanner').style.display = activeChs.length ? 'none' : 'block';
  $('playerArea').style.display = activeChs.length ? 'block' : 'none';

  const sel = $('channelSelect');
  const prevVal = selectedChannelId;
  sel.innerHTML = activeChs.map(c => '<option value="' + esc(c.id) + '">🔊 ' + esc(c.name) + '</option>').join('');
  if (activeChs.some(c => c.id === prevVal)) sel.value = prevVal;
  else if (activeChs[0]) { selectedChannelId = activeChs[0].id; sel.value = selectedChannelId; }

  const ch = activeChannelObj();
  const p = ch?.player;
  if (p) {
    $('voiceBadge').textContent = p.connected ? (p.status === 'paused' ? 'Pausado na call' : 'Tocando na call') : 'Ocioso';
    $('voiceBadge').className = 'pill ' + (p.connected ? 'ok' : '');
    const src = p.currentTrack?.source;
    $('sourceBadge').style.display = src ? 'inline-flex' : 'none';
    $('sourceBadge').textContent = src ? src.toUpperCase() : '';

    $('trackTitle').textContent = p.title || 'Nenhuma faixa tocando';
    $('trackArtist').textContent = p.artist || (p.title ? (p.currentTrack?.requestedByName || '') : 'Cole um link abaixo ou adicione pelo mini-player no Balacopapo');
    $('cover').innerHTML = p.thumbnailUrl ? ('<img src="' + esc(p.thumbnailUrl) + '" alt="">') : '🎵';

    const pct = p.durationSec ? Math.min(100, (p.positionSec / p.durationSec) * 100) : 0;
    $('progressFill').style.width = pct + '%';
    $('timeElapsed').textContent = fmt(p.positionSec);
    $('timeTotal').textContent = p.durationSec ? fmt(p.durationSec) : '--:--';

    $('btnPlayPause').textContent = p.status === 'playing' ? '⏸' : '▶';
    const loopMap = { off: '🔁 Off', track: '🔂 Faixa', queue: '🔁 Fila' };
    $('btnLoop').textContent = loopMap[p.loopMode] || '🔁 Off';
    if (!draggingVol) {
      $('volSlider').value = p.volume;
      $('volText').textContent = p.volume + '%';
    }
    showBox('playerErr', p.lastError || '');

    const q = p.queue || [];
    $('queueCount').textContent = String(q.length);
    $('queueList').innerHTML = q.length ? q.map((t, i) =>
      '<div class="queue-item">' +
        '<div class="queue-num">' + (i + 1) + '</div>' +
        '<div class="queue-meta"><div class="queue-title">' + esc(t.title) + '</div>' +
        '<div class="queue-sub">' + esc(t.artist || t.source.toUpperCase()) + (t.durationSec ? ' · ' + fmt(t.durationSec) : '') + '</div></div>' +
        '<button class="sec" style="padding:4px 9px;font-size:12px" onclick="removeTrack(\'' + esc(t.id) + '\')">×</button>' +
      '</div>'
    ).join('') : '<span class="muted">A fila está vazia.</span>';
  }

  const lb = $('logsBox');
  const atBottom = lb.scrollHeight - lb.scrollTop - lb.clientHeight < 30;
  lb.textContent = (s.logs || []).join('\\n');
  if (atBottom) lb.scrollTop = lb.scrollHeight;
}

async function refresh() {
  try { renderStatus(await api('/api/status')); } catch {}
}

async function sendControl(action, value) {
  const ch = activeChannelObj();
  if (!ch) return;
  try {
    await api('/api/channels/' + encodeURIComponent(ch.id) + '/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value })
    });
    refresh();
  } catch (e) { showBox('playerErr', e.message); }
}
window.removeTrack = id => sendControl('queue_remove', id);

$('channelSelect').onchange = e => { selectedChannelId = e.target.value; refresh(); };
$('btnPlayPause').onclick = () => {
  const p = activeChannelObj()?.player;
  if (!p) return;
  sendControl(p.status === 'playing' ? 'pause' : 'resume');
};
$('btnSkip').onclick = () => sendControl('skip');
$('btnStop').onclick = () => sendControl('stop');
$('btnClearQueue').onclick = () => sendControl('queue_clear');
$('btnLoop').onclick = () => {
  const cur = activeChannelObj()?.player?.loopMode || 'off';
  const next = cur === 'off' ? 'track' : cur === 'track' ? 'queue' : 'off';
  sendControl('loop', next);
};
$('progressBar').onclick = e => {
  const p = activeChannelObj()?.player;
  if (!p?.durationSec) return;
  const r = e.currentTarget.getBoundingClientRect();
  const sec = Math.floor(((e.clientX - r.left) / r.width) * p.durationSec);
  sendControl('seek', sec);
};
$('volSlider').oninput = e => {
  draggingVol = true;
  const v = Number(e.target.value);
  $('volText').textContent = v + '%';
  clearTimeout(volDebounce);
  volDebounce = setTimeout(() => { draggingVol = false; sendControl('volume', v); }, 120);
};

async function addTrack() {
  const ch = activeChannelObj();
  const url = $('addUrl').value.trim();
  if (!ch || !url) return;
  showBox('playerErr', '');
  try {
    await api('/api/channels/' + encodeURIComponent(ch.id) + '/enqueue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    $('addUrl').value = '';
    refresh();
  } catch (e) { showBox('playerErr', e.message); }
}
$('btnAdd').onclick = addTrack;
$('addUrl').onkeydown = e => { if (e.key === 'Enter') addTrack(); };

function readForm() {
  return {
    baseUrl: $('baseUrl').value,
    apiKey: $('apiKey').value,
    botName: $('botName').value,
    cacheMaxMb: Number($('cacheMaxMb').value) || 2048,
    channelIds: selectedChannelIdsConfig,
  };
}

$('btnTest').onclick = async () => {
  showBox('connErr', ''); showBox('connOk', '');
  try {
    const info = await api('/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readForm()) });
    availableChannels = info.voiceChannels || [];
    renderChannelChecks();
    showBox('connOk', 'Conexão OK! Espaço "' + info.space.name + '" (' + availableChannels.length + ' canal(is) de voz).');
  } catch (e) { showBox('connErr', e.message); }
};

$('btnSaveStart').onclick = async () => {
  showBox('connErr', ''); showBox('connOk', '');
  try {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readForm()) });
    $('apiKey').value = '';
    await api('/api/start', { method: 'POST' });
    await loadSettings();
    await refresh();
    showBox('connOk', 'Conectado! Você já pode usar o Player.');
  } catch (e) { showBox('connErr', e.message); }
};

$('btnStopBot').onclick = async () => { await api('/api/stop', { method: 'POST' }); refresh(); };
$('quickToggle').onclick = async () => {
  if (lastStatus?.state === 'running') await api('/api/stop', { method: 'POST' });
  else {
    try { await api('/api/start', { method: 'POST' }); }
    catch { switchTab('connect'); }
  }
  refresh();
};
$('btnClearCache').onclick = async () => { await api('/api/cache/clear', { method: 'POST' }); loadCache(); };
$('btnClearLogs').onclick = async () => { await api('/api/logs/clear', { method: 'POST' }); refresh(); };
$('btnCopyLogs').onclick = () => navigator.clipboard?.writeText($('logsBox').textContent || '');

loadSettings().then(() => { refresh(); loadCache(); });
setInterval(refresh, 1500);
setInterval(loadCache, 10000);
</script>
</body>
</html>`;
