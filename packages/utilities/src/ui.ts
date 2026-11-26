export const UI_HTML = /* html */ `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Balacopapo Utilidades</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}
body{font:14px system-ui,sans-serif;background:#14121c;color:#e8e4f4;margin:0;padding:20px;max-width:640px;margin:auto}
h1{font-size:18px;margin:0 0 16px}
section{background:#1e1b2b;border-radius:10px;padding:14px;margin-bottom:14px}
label{display:block;margin:8px 0 4px;color:#a9a3c2;font-size:12px}
input{width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #3a3552;background:#14121c;color:inherit}
button{margin-top:10px;margin-right:6px;padding:8px 14px;border:0;border-radius:6px;background:#7c5cff;color:#fff;cursor:pointer}
button.sec{background:#3a3552}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;background:#3a3552;font-size:12px}
.pill.running{background:#1f7a4d}.pill.error{background:#a33}.pill.starting{background:#8a6d1a}
.ch{padding:8px 0;border-top:1px solid #2c2840}.muted{color:#a9a3c2;font-size:12px}
pre{max-height:150px;overflow:auto;font-size:11px;color:#a9a3c2;white-space:pre-wrap;margin:0}
</style></head><body>
<h1>🎵 Balacopapo Utilidades — Bot de Música <span id="state" class="pill">…</span></h1>
<section>
  <label>URL da instância</label><input id="baseUrl" placeholder="https://chat.exemplo.com">
  <label>Chave de API do Grupo (escopo "music")</label><input id="apiKey" type="password" placeholder="bp_...">
  <label>Nome do bot</label><input id="botName">
  <button id="save">Salvar e conectar</button><button class="sec" id="stop">Parar</button>
  <div id="err" class="muted" style="color:#f88;margin-top:8px"></div>
</section>
<section><b id="group">Grupo</b><div id="channels" class="muted">Não conectado.</div></section>
<section><pre id="logs"></pre></section>
<script>
const $=id=>document.getElementById(id);
const api=async(p,o)=>{const r=await fetch(p,o);const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j};
const fmt=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
async function loadSettings(){const s=await api('/api/settings');$('baseUrl').value=s.baseUrl;$('botName').value=s.botName;$('apiKey').placeholder=s.hasApiKey?'(salva — deixe vazio para manter)':'bp_...'}
async function refresh(){try{const s=await api('/api/status');
 $('state').textContent=s.state;$('state').className='pill '+s.state;$('err').textContent=s.error||'';
 $('group').textContent=s.group?('Grupo: '+s.group):'Grupo';
 $('channels').innerHTML=s.channels.length?s.channels.map(c=>{const p=c.player;
  return '<div class="ch"><b>🔊 '+c.name.replace(/</g,'&lt;')+'</b><br><span class="muted">'+(p&&p.title?((p.status==='paused'?'⏸ ':'▶ ')+p.title.replace(/</g,'&lt;')+' ('+fmt(p.positionSec)+(p.durationSec?' / '+fmt(p.durationSec):'')+') · fila: '+p.queueLength):'Ocioso')+(p&&p.lastError?'<br>⚠ '+p.lastError.replace(/</g,'&lt;'):'')+'</span></div>'}).join(''):'Não conectado.';
 $('logs').textContent=s.logs.join('\\n')}catch(e){}}
$('save').onclick=async()=>{$('err').textContent='';try{await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:$('baseUrl').value,apiKey:$('apiKey').value,botName:$('botName').value})});$('apiKey').value='';await api('/api/start',{method:'POST'});loadSettings()}catch(e){$('err').textContent=e.message}};
$('stop').onclick=()=>api('/api/stop',{method:'POST'});
loadSettings();refresh();setInterval(refresh,1500);
</script></body></html>`;
