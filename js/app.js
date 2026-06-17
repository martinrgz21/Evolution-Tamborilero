import { drawTacticalMap, calculateTactics, REGATA, CONFIG_MAPA } from './tactico.js';

const S = { sog: 0, cog: 0, tws: 0, twa: 0, hdg: 0, bsp: 0, lat: 42.2345, lon: -8.7234 };
const CFG = { ip: '127.0.0.1', port: '8080', speedSource: 'SOG', eslora: 12 };
let polarData = null;
let ws = null;
let historyLog = [];
let lastLogTime = 0;

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById(`tab-${btn.dataset.tab}`);
    if (target) target.classList.add('active');
  });
});

async function loadPolar() {
  try {
    const r = await fetch('data/polar.json');
    if (!r.ok) throw new Error();
    polarData = await r.json();
    buildPolarTable();
  } catch (e) {
    console.warn("Aviso: Sin data/polar.json. Rendimiento al 0%, el resto sigue funcionando.");
    polarData = {}; 
  }
}

function buildPolarTable() {
  const headers = document.getElementById('polar-headers');
  const body = document.getElementById('polar-body');
  if (!headers || !body || !polarData) return;

  import('./tactico.js').then(m => {
    headers.innerHTML = '<th>TWA \\ TWS</th>' + m.TWS_B.map(s => `<th>${s}kn</th>`).join('');
    body.innerHTML = m.TWA_B.map(a => {
      return `<tr><td><strong>${a}°</strong></td>` + m.TWS_B.map(s => `<td id="p_${s}-${a}">—</td>`).join('') + `</tr>`;
    }).join('');
  });
}

function connectWebSocket() {
  if (ws) ws.close();
  const indicator = document.getElementById('net-status');
  indicator.className = 'status-indicator connecting';

  ws = new WebSocket(`ws://${CFG.ip}:${CFG.port}`);

  ws.onopen = () => { indicator.className = 'status-indicator connected'; };
  ws.onclose = () => { indicator.className = 'status-indicator disconnected'; };
  ws.onerror = () => { indicator.className = 'status-indicator disconnected'; };

  ws.onmessage = (event) => {
    const lines = event.data.split('\n');
    lines.forEach(line => parseNmea(line.trim()));
    updateUI();
  };
}

function parseNmea(line) {
  if (!line.startsWith('$')) return;
  const parts = line.split(',');
  const type = parts[0].substring(3);

  if (type === 'RMC') {
    S.sog = parseFloat(parts[7]) || 0;
    S.cog = parseFloat(parts[8]) || 0;
    if (parts[3] && parts[5]) {
      let l1 = parseFloat(parts[3].substring(0,2)) + parseFloat(parts[3].substring(2))/60;
      let l2 = parseFloat(parts[5].substring(0,3)) + parseFloat(parts[5].substring(3))/60;
      S.lat = parts[4] === 'S' ? -l1 : l1;
      S.lon = parts[6] === 'W' ? -l2 : l2;
    }
  } else if (type === 'MWV') {
    S.twa = parseFloat(parts[1]) || 0;
    S.tws = parseFloat(parts[3]) || 0;
  } else if (type === 'VHW') {
    S.bsp = parseFloat(parts[5]) || 0;
    S.hdg = parseFloat(parts[1]) || 0;
  }
}

function updateUI() {
  document.getElementById('val-sog').textContent = S.sog.toFixed(1);
  document.getElementById('val-cog').textContent = S.cog.toFixed(0);
  document.getElementById('val-tws').textContent = S.tws.toFixed(1);
  document.getElementById('val-twa').textContent = S.twa.toFixed(0);
  document.getElementById('val-hdg').textContent = S.hdg.toFixed(0);
  document.getElementById('val-bsp').textContent = S.bsp.toFixed(1);

  let perf = 0;
  const speedAct = CFG.speedSource === 'SOG' ? S.sog : S.bsp;
  
  import('./tactico.js').then(m => {
    if (polarData && Object.keys(polarData).length > 0) {
      const key = m.pKey(S.tws, S.twa);
      const target = polarData[key]?.valor || 0;

      const currentCell = document.getElementById(`p_${m.nearest(m.TWS_B, S.tws)}-${m.nearest(m.TWA_B, S.twa)}`);
      document.querySelectorAll('#table-polar td').forEach(td => td.classList.remove('highlight-cell'));
      if (currentCell) currentCell.classList.add('highlight-cell');

      if (target > 0) perf = (speedAct / target) * 100;
    }

    document.getElementById('val-perf').textContent = perf > 0 ? `${perf.toFixed(1)}%` : '—';
    const fill = document.getElementById('perf-fill');
    if (fill) fill.style.width = `${Math.min(perf, 120)}%`;

    calculateTactics(S, speedAct);
    drawTacticalMap(S, CFG, polarData);

    document.getElementById('strat-dist').textContent = m.fmt(REGATA.distLine, 0) + ' m';
    document.getElementById('strat-ttl').textContent = REGATA.ttl ? `${Math.floor(REGATA.ttl/60)}m ${Math.floor(REGATA.ttl%60)}s` : '—';
    document.getElementById('strat-action').textContent = REGATA.action;

    logHistory(perf);
  });
}

function logHistory(perf) {
  const now = Date.now();
  if (now - lastLogTime < 15000) return; 
  lastLogTime = now;

  const timeStr = new Date().toLocaleTimeString();
  const entry = { time: timeStr, sog: S.sog, cog: S.cog, tws: S.tws, twa: S.twa, perf: perf };
  historyLog.unshift(entry);
  if (historyLog.length > 50) historyLog.pop();

  renderHistoryTable();
}

function renderHistoryTable() {
  const tbody = document.getElementById('history-body');
  if (!tbody) return;
  tbody.innerHTML = historyLog.map(e => `
    <tr><td>${e.time}</td><td>${e.sog.toFixed(1)}</td><td>${e.cog.toFixed(0)}°</td><td>${e.tws.toFixed(1)}</td><td>${e.twa.toFixed(0)}°</td><td>${e.perf > 0 ? e.perf.toFixed(0)+'%' : '—'}</td></tr>
  `).join('');
}

setInterval(() => {
  if (!REGATA.chronoActive) return;
  if (REGATA.chrono > 0) {
    REGATA.chrono--;
    const min = String(Math.floor(REGATA.chrono / 60)).padStart(2, '0');
    const sec = String(REGATA.chrono % 60).padStart(2, '0');
    document.getElementById('chrono-display').textContent = `${min}:${sec}`;
  } else {
    REGATA.chronoActive = false;
  }
}, 1000);

function init() {
  loadPolar();

  document.getElementById('btn-save-net')?.addEventListener('click', () => {
    CFG.ip = document.getElementById('cfg-ip').value;
    CFG.port = document.getElementById('cfg-port').value;
    CFG.speedSource = document.getElementById('cfg-speed-source').value;
    connectWebSocket();
  });

  document.getElementById('btn-start-chrono')?.addEventListener('click', () => { REGATA.chronoActive = !REGATA.chronoActive; });
  document.getElementById('btn-sync-chrono')?.addEventListener('click', () => { REGATA.chrono = Math.ceil(REGATA.chrono / 60) * 60; });

  document.getElementById('btn-set-pin')?.addEventListener('click', () => { REGATA.pin = { lat: S.lat, lon: S.lon }; });
  document.getElementById('btn-set-comite')?.addEventListener('click', () => { REGATA.comite = { lat: S.lat, lon: S.lon }; });
  document.getElementById('btn-set-barlovento')?.addEventListener('click', () => { REGATA.barlovento = { lat: S.lat, lon: S.lon }; });

  const autocenterBtn = document.getElementById('btn-autocenter');
  if (autocenterBtn) {
    autocenterBtn.addEventListener('click', () => {
      import('./tactico.js').then((modulo) => {
        modulo.CONFIG_MAPA.autocenter = !modulo.CONFIG_MAPA.autocenter;
        if (modulo.CONFIG_MAPA.autocenter) {
          autocenterBtn.textContent = "Autocentrado: ON";
          autocenterBtn.style.background = "var(--surface)";
          autocenterBtn.style.color = "var(--navy)";
        } else {
          autocenterBtn.textContent = "Autocentrado: OFF";
          autocenterBtn.style.background = "transparent";
          autocenterBtn.style.color = "var(--ink-2)";
        }
      });
    });
  }

  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    historyLog = [];
    renderHistoryTable();
    alert('Historial borrado.');
  });

  document.getElementById('btn-clear-marks')?.addEventListener('click', () => {
    REGATA.pin = null;
    REGATA.comite = null;
    REGATA.barlovento = null;
    REGATA.distLine = null;
    REGATA.ttl = null;
    REGATA.action = '—';
    alert('Marcas eliminadas.');
  });
}

window.addEventListener('DOMContentLoaded', init);