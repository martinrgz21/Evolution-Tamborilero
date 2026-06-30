import { loadPolarFirebase, loadHistoryFirebase, schedulePolarSave, saveHistoryEntry, setFbStatus } from './firebase.js';
import { REGATA, TWS_B, TWA_B, nearest, pKey, vmg, fmt, calculateTactics, drawTacticalMap } from './tactico.js';

const S = { bsp:0, tws:0, twa:0, awa:0, aws:0, cog:0, sog:0, lat:42.2345, lon:-8.7234, live:false };
const CFG = { thresh:85, minSpeed:2.0, speedSource:'SOG', motorMode:false, eslora:12 };

let polar = {};
let history = [];
let ws = null;
let chronoInterval = null;
let histTick = 0;

const buffers = { bsp:[], tws:[], twa:[] };
function addWithDamping(type, value) {
  buffers[type].push(value);
  if (buffers[type].length > 6) buffers[type].shift();
  return buffers[type].reduce((a,b)=>a+b, 0) / buffers[type].length;
}

const activeSpeed = () => CFG.speedSource === 'BSP' ? S.bsp : S.sog;
const calcPerf = () => {
  const k = pKey(S.tws, S.twa);
  return (polar[k]?.valor > 0) ? Math.min(100, (activeSpeed() / polar[k].valor) * 100) : null;
};

function parseNMEA(line) {
  line = line.trim(); if (!line.startsWith('$')) return;
  const p = line.split(','); const t = p[0];
  if (t.endsWith('VHW')) {
    const v = parseFloat(p[5]); if (!isNaN(v)) S.bsp = addWithDamping('bsp', v);
  } else if (t.endsWith('MWV')) {
    const a = parseFloat(p[1]), r = p[2], sp = parseFloat(p[3]);
    if (r==='R' && !isNaN(a) && !isNaN(sp)) { S.awa=a; S.aws=sp; }
    if (r==='T' && !isNaN(a) && !isNaN(sp)) { S.twa = addWithDamping('twa', a); S.tws = addWithDamping('tws', sp); }
  } else if (t.endsWith('VTG')) {
    const sg=parseFloat(p[7]), cg=parseFloat(p[8]);
    if (!isNaN(sg)) S.sog=sg; if (!isNaN(cg)) S.cog=cg;
  } else if (t.endsWith('RMC')) {
    const sg=parseFloat(p[7]), cg=parseFloat(p[8]); if (!isNaN(sg)) S.sog=sg; if (!isNaN(cg)) S.cog=cg;
    if (p[2] === 'A') { 
      let latDeg = parseFloat(p[3].slice(0,2)), latMin = parseFloat(p[3].slice(2));
      let l = latDeg + (latMin/60); if (p[4] === 'S') l = -l; S.lat = l;
      let lonDeg = parseFloat(p[5].slice(0,3)), lonMin = parseFloat(p[5].slice(3));
      let o = lonDeg + (lonMin/60); if (p[6] === 'W') o = -o; S.lon = o;
    }
  }
}

function getVmgTargets() {
  let beatVmg = 0, beatAngle = null, runVmg = 0, gybeAngle = null;
  const currentTwsBucket = nearest(TWS_B, S.tws);
  for (const twa of TWA_B) {
    const k = `${currentTwsBucket}_${twa}`; const record = polar[k]; if (!record || !record.valor) continue;
    const v = vmg(record.valor, twa);
    if (twa <= 90) { if (v > beatVmg) { beatVmg = v; beatAngle = twa; } } 
    else { if (Math.abs(v) > runVmg) { runVmg = Math.abs(v); gybeAngle = twa; } }
  }
  return { beatVmg: beatVmg > 0 ? beatVmg : null, beatAngle: beatAngle !== null ? beatAngle + "°" : "—", runVmg: runVmg > 0 ? runVmg : null, gybeAngle: gybeAngle !== null ? gybeAngle + "°" : "—" };
}

function updateDash() {
  const speed = activeSpeed(); const perf = calcPerf(); const targets = getVmgTargets(); const k = pKey(S.tws, S.twa);
  document.getElementById('v-vmg').innerHTML = fmt(vmg(speed, S.twa)) + '<span class="unit">kn</span>';
  document.getElementById('v-bsp').innerHTML = fmt(S.bsp) + '<span class="unit">kn</span>';
  document.getElementById('v-tws').innerHTML = fmt(S.tws) + '<span class="unit">kn</span>';
  document.getElementById('v-twa').innerHTML = fmt(S.twa, 0) + '<span class="unit">°</span>';
  document.getElementById('v-sog').innerHTML = fmt(S.sog) + '<span class="unit">kn</span>';
  document.getElementById('v-cog').innerHTML = fmt(S.cog, 0) + '<span class="unit">°</span>';
  document.getElementById('v-awa').innerHTML = fmt(S.awa, 0) + '<span class="unit">°</span>';
  document.getElementById('v-aws').innerHTML = fmt(S.aws) + '<span class="unit">kn</span>';
  
  document.getElementById('v-beat-vmg').innerHTML = targets.beatVmg ? fmt(targets.beatVmg) + '<span class="unit">kn</span>' : '—';
  document.getElementById('v-beat-angle').textContent = targets.beatAngle;
  document.getElementById('v-run-vmg').innerHTML = targets.runVmg ? fmt(targets.runVmg) + '<span class="unit">kn</span>' : '—';
  document.getElementById('v-gybe-angle').textContent = targets.gybeAngle;
  document.getElementById('v-best').textContent = polar[k]?.valor ? fmt(polar[k].valor) + ' kn' : '—';

  const pEl = document.getElementById('v-perf'); const pFill = document.getElementById('perf-fill');
  if (perf !== null && !CFG.motorMode) {
    pEl.textContent = fmt(perf, 0) + '%'; pFill.style.width = perf + '%';
    const st = perf >= CFG.thresh ? 'good' : perf >= 70 ? 'mid' : 'bad';
    pEl.className = `perf-number st-${st}`; pFill.className = `perf-bar-fill st-${st}`;
  } else {
    pEl.textContent = '—'; pFill.style.width = '0%'; pEl.className = 'perf-number';
  }
}

function updateStratPanel() {
  document.getElementById('s-dist-line').textContent = REGATA.distLine !== null ? fmt(REGATA.distLine, 0) + ' m' : '—';
  if (REGATA.ttl !== null) {
    const m = Math.floor(REGATA.ttl / 60); const s = Math.floor(REGATA.ttl % 60);
    document.getElementById('s-ttl').textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  } else { document.getElementById('s-ttl').textContent = '—'; }
  const actEl = document.getElementById('s-action'); actEl.textContent = REGATA.action;
  actEl.className = 'strat-metric-val ' + (REGATA.action === 'GANAR TIEMPO' ? 'action-ganar' : REGATA.action === 'AHORRAR TIEMPO' ? 'action-ahorrar' : '');
}

function updateChronoDisplay() {
  const m = Math.floor(Math.abs(REGATA.chrono) / 60); const s = Math.floor(Math.abs(REGATA.chrono) % 60);
  document.getElementById('chrono-val').textContent = `${REGATA.chrono < 0 ? "-" : ""}${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function updatePolarTable() {
  const curKey = pKey(S.tws, S.twa); let h = '<thead><tr><th>TWA / TWS</th>';
  for (const tw of TWS_B) h += `<th>${tw} kn</th>`;
  h += '</tr></thead><tbody>';
  for (const twa of TWA_B) {
    h += `<tr><th>${twa}°</th>`;
    for (const tws of TWS_B) {
      const k = `${tws}_${twa}`; const isCur = (k === curKey && S.live);
      h += `<td class="${isCur ? 'c-cur' : polar[k]?.valor ? 'c-record' : 'c-empty'}">${polar[k]?.valor ? polar[k].valor.toFixed(1) : '·'}</td>`;
    }
    h += '</tr>';
  }
  const target = document.getElementById('ptable'); if(target) target.innerHTML = h + '</tbody>';
}

function updateStats() {
  document.getElementById('stat-total').textContent = Object.keys(polar).length;
}

function updatePolar() {
  if (CFG.motorMode || activeSpeed() < CFG.minSpeed || !S.live) return;
  const k = pKey(S.tws, S.twa); const speed = activeSpeed();
  if (!polar[k]?.valor || speed > polar[k].valor) {
    polar[k] = { valor: parseFloat(speed.toFixed(2)), tipo: CFG.speedSource };
    schedulePolarSave(polar);
  }
}

function process() {
  updatePolar(); updateDash();
  calculateTactics(S, activeSpeed()); updateStratPanel();
  drawTacticalMap(S, CFG, polar);
  if (++histTick % 15 === 0) {
    const entry = { timestamp: new Date().toISOString(), t: new Date().toLocaleTimeString(), tws: S.tws, twa: S.twa, spd: activeSpeed(), perf: calcPerf() };
    history.unshift(entry); saveHistoryEntry(entry);
  }
}

function connect(host, port) {
  if (ws) ws.close();
  ws = new WebSocket(`ws://${host}:${port}`);
  ws.onopen = () => { S.live = true; document.getElementById('signal-pip').className = 'on'; document.getElementById('signal-label').textContent = `${host}:${port}`; };
  ws.onmessage = e => { e.data.split('\n').forEach(parseNMEA); process(); };
  ws.onclose = () => { S.live = false; document.getElementById('signal-pip').className = ''; document.getElementById('signal-label').textContent = 'sin señal'; };
}

async function init() {
  polar = await loadPolarFirebase();
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active'); document.getElementById('panel-' + tab.dataset.p).classList.add('active');
      if (tab.dataset.p === 'strat') setTimeout(() => drawTacticalMap(S, CFG, polar), 50);
      if (tab.dataset.p === 'polar') updatePolarTable();
      if (tab.dataset.p === 'settings') updateStats();
    });
  });

  document.getElementById('strat-sync-btn').addEventListener('click', () => {
    REGATA.chrono = Math.round(REGATA.chrono / 60) * 60; updateChronoDisplay();
    if (!REGATA.chronoActive) {
      REGATA.chronoActive = true;
      chronoInterval = setInterval(() => { REGATA.chrono--; updateChronoDisplay(); calculateTactics(S, activeSpeed()); updateStratPanel(); }, 1000);
    }
  });

  document.getElementById('strat-reset-btn').addEventListener('click', () => { clearInterval(chronoInterval); REGATA.chronoActive = false; REGATA.chrono = 300; updateChronoDisplay(); });
  document.getElementById('btn-mark-comite').addEventListener('click', () => { REGATA.comite = { lat: S.lat, lon: S.lon }; process(); });
  document.getElementById('btn-mark-pin').addEventListener('click', () => { REGATA.pin = { lat: S.lat, lon: S.lon }; process(); });
  document.getElementById('btn-mark-barlo').addEventListener('click', () => { REGATA.barlovento = { lat: S.lat, lon: S.lon }; process(); });
  
  document.getElementById('night-btn').addEventListener('click', () => document.body.classList.toggle('night-mode'));
  document.getElementById('conn-btn').addEventListener('click', () => document.getElementById('overlay').style.display = 'flex');
  document.getElementById('m-conn').addEventListener('click', () => { connect(document.getElementById('m-host').value, document.getElementById('m-port').value); document.getElementById('overlay').style.display = 'none'; });
  document.getElementById('m-cancel').addEventListener('click', () => document.getElementById('overlay').style.display = 'none');
  
  connect('192.168.0.1', '10110');
}

init();