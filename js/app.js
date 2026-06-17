/* ══════════════════════════════════════════════════════════════════════════
   MÓDULO CORE: GESTIÓN DE ESTADO, FIREBASE, RED NMEA Y EVENTOS DE INTERFAZ
   ══════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { calculateTactics, drawTacticalMap, initTouchLock } from "./tactico.js";

// Configuración de la persistencia remota
const firebaseConfig = {
  apiKey: "AIzaSyCH9QilfBI6lorKexzFASfF_wHqtrVLPHU",
  authDomain: "evolution-tamborilero.firebaseapp.com",
  projectId: "evolution-tamborilero",
  storageBucket: "evolution-tamborilero.firebasestorage.app",
  messagingSenderId: "647006792385",
  appId: "1:647006792385:web:9cf86bb9eca722b4dbc240"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

/* ── ESTADO DEL SISTEMA ── */
const S = { bsp:0, tws:0, twa:0, awa:0, aws:0, cog:0, sog:0, lat:42.2345, lon:-8.7234, live:false };
const CFG = { thresh:85, minSpeed:2.0, speedSource:'SOG', motorMode:false, eslora:12 };

const REGATA = {
  pin: null, comite: null, barlovento: null,
  chrono: 300, chronoActive: false,
  distLine: null, ttl: null, action: '—'
};

const BUFFER_SIZE = 6;
const buffers = { bsp:[], tws:[], twa:[] };

function addWithDamping(type, value) {
  buffers[type].push(value);
  if (buffers[type].length > BUFFER_SIZE) buffers[type].shift();
  return buffers[type].reduce((a,b)=>a+b, 0) / buffers[type].length;
}

const TWS_B = [5,8,10,12,14,16,18,20,25,30];
const TWA_B = [30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180];

let polar = {};
let history = [];   
let ws = null;
let chronoInterval = null;

const nearest = (arr,v) => arr.reduce((a,b) => Math.abs(b-v)<Math.abs(a-v)?b:a);
const pKey = (tws,twa) => `${nearest(TWS_B,tws)}_${nearest(TWA_B,twa)}`;
const vmg = (speed,twa) => speed * Math.cos(twa * Math.PI/180);
const fmt = (v,d=1) => (typeof v==='number'&&!isNaN(v)) ? v.toFixed(d) : '—';
const activeSpeed = () => CFG.speedSource === 'BSP' ? S.bsp : S.sog;

function setFbStatus(text, cls='') {
  const el = document.getElementById('fb-signal');
  if(el) { el.textContent = text; el.className = cls; }
}

/* ── FIREBASE: OPERACIONES POLAR ── */
let _polarSaveTimer = null;
function schedulePolarSave() {
  clearTimeout(_polarSaveTimer);
  _polarSaveTimer = setTimeout(flushPolarSave, 2500);
}

async function flushPolarSave() {
  try {
    await setDoc(doc(db, "polar_data", "current_polar"), polar);
    setFbStatus("Nube: Guardado", "synced");
  } catch(e) {
    console.error("Error guardando polar:", e);
    setFbStatus("Nube: Error al guardar", "error");
  }
}

async function loadPolarFirebase() {
  setFbStatus("Nube: Leyendo...");
  const timeout = new Promise((_,reject) => setTimeout(() => reject(new Error("timeout")), 5000));
  try {
    const snap = await Promise.race([ getDoc(doc(db, "polar_data", "current_polar")), timeout ]);
    polar = snap.exists() ? snap.data() : {};
    setFbStatus("Nube: OK", "synced");
  } catch(e) {
    console.warn("Firebase offline, modo local:", e);
    polar = {};
    setFbStatus("Nube: Offline (local)", "synced");
  }
  renderPolar();
  updateStats();
}

/* ── FIREBASE: HISTORIAL ── */
async function saveHistoryEntry(entry) {
  try { await addDoc(collection(db, "historial"), entry); } catch(e) { console.warn("No se pudo guardar historial:", e); }
}

async function loadHistoryFirebase() {
  try {
    const q = query(collection(db, "historial"), orderBy("timestamp", "desc"), limit(500));
    const snap = await getDocs(q); 
    history = snap.docs.map(d => d.data()); 
    renderHistory();
  } catch(e) { console.warn("No se pudo cargar historial:", e); history = []; }
}

function getTargetCeñidaAngle() {
  const currentTwsBucket = nearest(TWS_B, S.tws);
  let bestVmg = 0;
  let targetTwa = 45;
  for (const twa of TWA_B) {
    if (twa > 90) continue;
    const k = `${currentTwsBucket}_${twa}`;
    const r = polar[k]?.valor;
    if (r) {
      const v = vmg(r, twa);
      if (v > bestVmg) { bestVmg = v; targetTwa = twa; }
    }
  }
  return targetTwa;
}

function getVmgTargets() {
  let beatVmg = 0, beatAngle = null;
  let runVmg  = 0, gybeAngle = null;
  const currentTwsBucket = nearest(TWS_B, S.tws);

  for (const twa of TWA_B) {
    const k = `${currentTwsBucket}_${twa}`;
    const record = polar[k]; if (!record || !record.valor) continue;
    const v = vmg(record.valor, twa);
    if (twa <= 90) { if (v > beatVmg) { beatVmg = v; beatAngle = twa; } } 
    else { if (Math.abs(v) > runVmg) { runVmg = Math.abs(v); gybeAngle = twa; } }
  }
  return {
    beatVmg: beatVmg > 0 ? beatVmg : null, beatAngle: beatAngle !== null ? beatAngle + "°" : "—",
    runVmg:  runVmg > 0 ? runVmg : null, gybeAngle: gybeAngle !== null ? gybeAngle + "°" : "—"
  };
}

function renderPolar() {
  const curKey = pKey(S.tws, S.twa);
  let gMax = 0; for (const k in polar) { if (polar[k]?.valor > gMax) gMax = polar[k].valor; }
  let h = '<thead><tr><th>TWA / TWS</th>';
  for (const tw of TWS_B) h += `<th class="th-tws">${tw} kn</th>`;
  h += '</tr></thead><tbody>';
  for (const twa of TWA_B) {
    h += `<tr><th>${twa}°</th>`;
    for (const tws of TWS_B) {
      const k = `${tws}_${twa}`; const isCur = (k === curKey && S.live); const record = polar[k];
      let cls = 'c-empty', txt = '·';
      if (record?.valor) {
        txt = record.valor.toFixed(1);
        if (record.tipo === 'SOG') { cls = 'c-sog'; txt += '*'; } 
        else { const r = record.valor / gMax; cls = r >= 0.99 ? 'c-record' : r >= 0.90 ? 'c-near' : ''; }
      }
      if (isCur) cls = 'c-cur'; h += `<td class="${cls}">${txt}</td>`;
    }
    h += '</tr>';
  }
  document.getElementById('ptable').innerHTML = h + '</tbody>';
}

function updatePolar() {
  if (CFG.motorMode) return; const speed = activeSpeed(); if (speed < CFG.minSpeed) return;
  const k = pKey(S.tws, S.twa); const existing = polar[k]; const source = CFG.speedSource; let changed = false;
  if (!existing?.valor) { changed = true; } 
  else if (existing.tipo === 'SOG' && source === 'BSP') { changed = true; } 
  else if (existing.tipo === source && speed > existing.valor) { changed = true; }
  if (changed) { polar[k] = { valor: parseFloat(speed.toFixed(2)), tipo: source }; schedulePolarSave(); }
}

function calcPerf() {
  const k = pKey(S.tws, S.twa); const speed = activeSpeed();
  return (polar[k]?.valor > 0) ? Math.min(100, (speed / polar[k].valor) * 100) : null;
}

function updateDash() {
  const speed = activeSpeed(); const curVmg = vmg(speed, S.twa); const k = pKey(S.tws, S.twa);
  const record = polar[k]; const bestBsp = record?.valor ?? null; const perf = calcPerf(); const targets = getVmgTargets();

  document.getElementById('v-vmg').innerHTML   = fmt(curVmg)   + '<span class="unit">kn</span>';
  document.getElementById('v-bsp').innerHTML   = fmt(S.bsp)    + '<span class="unit">kn</span>';
  document.getElementById('v-tws').innerHTML   = fmt(S.tws)    + '<span class="unit">kn</span>';
  document.getElementById('v-twa').innerHTML   = fmt(S.twa, 0) + '<span class="unit">°</span>';
  document.getElementById('v-awa').innerHTML   = fmt(S.awa, 0) + '<span class="unit">°</span>';
  document.getElementById('v-aws').innerHTML   = fmt(S.aws)    + '<span class="unit">kn</span>';
  document.getElementById('v-sog').innerHTML   = fmt(S.sog)    + '<span class="unit">kn</span>';
  document.getElementById('v-cog').innerHTML   = fmt(S.cog, 0) + '<span class="unit">°</span>';

  document.getElementById('v-beat-vmg').innerHTML   = targets.beatVmg   ? fmt(targets.beatVmg)  + '<span class="unit">kn</span>' : '—';
  document.getElementById('v-beat-angle').textContent = targets.beatAngle;
  document.getElementById('v-run-vmg').innerHTML    = targets.runVmg    ? fmt(targets.runVmg)   + '<span class="unit">kn</span>' : '—';
  document.getElementById('v-gybe-angle').textContent = targets.gybeAngle;
  document.getElementById('v-best').textContent = bestBsp ? fmt(bestBsp) + ' kn' + (record.tipo === 'SOG' ? ' (SOG*)' : '') : '—';

  if (CFG.motorMode) { 
    document.getElementById('v-cell').innerHTML = `<span style="color:var(--danger);font-style:italic">A motor — pausado</span>`; 
  } else { 
    document.getElementById('v-cell').textContent = S.live ? `TWS ${nearest(TWS_B, S.tws)} kn / TWA ${nearest(TWA_B, S.twa)}°` : '—'; 
  }

  const pEl = document.getElementById('v-perf'); const pFill = document.getElementById('perf-fill'); const pCap = document.getElementById('perf-cap'); const adv = document.getElementById('v-advice');
  if (CFG.motorMode) {
    pEl.textContent = '—'; pFill.style.width = '0%'; pCap.textContent = 'Captura suspendida — modo motor activo.';
    adv.textContent = 'A Motor'; adv.className = 'advice-text st-bad'; pEl.className = 'perf-number';
  } else if (perf !== null) {
    pEl.textContent = fmt(perf, 0) + '%'; pFill.style.width = perf + '%';
    const st = perf >= CFG.thresh ? 'good' : perf >= 70 ? 'mid' : 'bad';
    pEl.className = `perf-number st-${st}`; pFill.className = `perf-bar-fill st-${st}`; adv.className = `advice-text st-${st}`;
    if (st === 'good')     { pCap.textContent = 'Rendimiento óptimo respecto a la polar'; adv.textContent = 'Bien trimado'; } 
    else if (st === 'mid') { pCap.textContent = 'Margen de mejora detectado'; adv.textContent = 'Afinar trimado'; } 
    else                   { pCap.textContent = 'Rendimiento bajo — revisar velas'; adv.textContent = 'Revisar trimado'; }
  } else {
    pEl.textContent = '—'; pFill.style.width = '0%'; pEl.className = 'perf-number'; pCap.textContent = 'Acumulando datos...'; adv.textContent = 'Sin referencia'; adv.className = 'advice-text';
  }
}

function updateStratPanel() {
  document.getElementById('s-dist-line').textContent = REGATA.distLine !== null ? fmt(REGATA.distLine, 0) + ' m' : '—';
  if (REGATA.ttl !== null) {
    const mins = Math.floor(REGATA.ttl / 60); const secs = Math.floor(REGATA.ttl % 60);
    document.getElementById('s-ttl').textContent = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
  } else {
    document.getElementById('s-ttl').textContent = '—';
  }
  const actEl = document.getElementById('s-action'); actEl.textContent = REGATA.action;
  actEl.className = 'strat-metric-val';
  if (REGATA.action === 'GANAR TIEMPO') actEl.classList.add('action-ganar');
  if (REGATA.action === 'AHORRAR TIEMPO') actEl.classList.add('action-ahorrar');
}

let histTick = 0;
function recordHistory() {
  if (CFG.motorMode) return; const speed = activeSpeed(); const perf = calcPerf(); const now = new Date();
  const entry = {
    timestamp: now.toISOString(), t: now.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit'}) + ' ' + now.toTimeString().slice(0,8),
    tws: parseFloat(S.tws.toFixed(1)), twa: parseFloat(S.twa.toFixed(0)), spd: parseFloat(speed.toFixed(2)), vmg: parseFloat(vmg(speed, S.twa).toFixed(2)),
    perf: perf !== null ? parseFloat(perf.toFixed(1)) : null, src: CFG.speedSource
  };
  history.unshift(entry); if (history.length > 500) history.pop(); saveHistoryEntry(entry); 
}

function renderHistory() {
  const tbody = document.getElementById('hist-body'); 
  if (!history.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;font-style:italic">Sin registros aún</td></tr>'; return; }
  tbody.innerHTML = history.map(h => {
    let pc = '', pt = '—'; if (h.perf !== null && h.perf !== undefined) { pt = h.perf.toFixed(0) + '%'; pc = h.perf >= CFG.thresh ? 'c-ph-good' : h.perf >= 70 ? 'c-ph-mid' : 'c-ph-bad'; }
    return `<tr><td class="ts">${h.t}</td><td>${fmt(h.tws)} kn</td><td>${fmt(h.twa, 0)}°</td><td>${fmt(h.spd)}</td><td>${fmt(h.vmg)}</td><td class="${pc}">${pt}</td><td class="src">${h.src || '—'}</td></tr>`;
  }).join('');
}

function updateStats() {
  const total = Object.keys(polar).length; const maxCells = TWS_B.length * TWA_B.length;
  const sogCells = Object.values(polar).filter(r => r?.tipo === 'SOG').length; const bspCells = Object.values(polar).filter(r => r?.tipo === 'BSP').length;
  document.getElementById('stat-total').textContent = total; document.getElementById('stat-bsp').textContent = bspCells; document.getElementById('stat-sog').textContent = sogCells;
  document.getElementById('stat-hist').textContent = history.length; document.getElementById('stat-cover').textContent = Math.round((total/maxCells)*100) + '%';
}

/* ── PARSER NMEA INTEGRADO ── */
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

function process() {
  updatePolar();
  updateDash();
  calculateTactics(S, REGATA, activeSpeed);
  updateStratPanel();
  drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle);
  if (++histTick % 15 === 0) { recordHistory(); updateStats(); }
}

function connect(host, port) {
  if (ws) { ws.close(); ws = null; }
  document.getElementById('signal-label').textContent = 'conectando…';
  ws = new WebSocket(`ws://${host}:${port}`);
  ws.onopen = () => {
    S.live = true; document.getElementById('signal-pip').className = 'on';
    document.getElementById('signal-label').textContent = `${host}:${port}`;
    localStorage.setItem('nmea_host', host); localStorage.setItem('nmea_port', port);
  };
  ws.onmessage = e => { e.data.split('\n').forEach(parseNMEA); process(); };
  ws.onclose = ws.onerror = () => {
    S.live = false; document.getElementById('signal-pip').className = ''; document.getElementById('signal-label').textContent = 'sin señal';
  };
}

function updateChronoDisplay() {
  const m = Math.floor(Math.abs(REGATA.chrono) / 60);
  const s = Math.floor(Math.abs(REGATA.chrono) % 60);
  const sign = REGATA.chrono < 0 ? "-" : "";
  document.getElementById('chrono-val').textContent = `${sign}${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function startChrono() {
  if (chronoInterval) clearInterval(chronoInterval);
  REGATA.chronoActive = true;
  document.getElementById('strat-sync-btn').classList.add('active-btn');
  chronoInterval = setInterval(() => {
    REGATA.chrono--;
    updateChronoDisplay();
    calculateTactics(S, REGATA, activeSpeed);
    updateStratPanel();
    if (REGATA.chrono === 0) {
      try { const ac = new AudioContext(); const o = ac.createOscillator(); o.connect(ac.destination); o.start(); o.stop(0.4); } catch(e){}
    }
  }, 1000);
}

/* ── EVENTOS DE LA INTERFAZ USUARIO ── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active'); document.getElementById('panel-' + tab.dataset.p).classList.add('active');
    if (tab.dataset.p === 'strat')    setTimeout(() => drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle), 50);
    if (tab.dataset.p === 'polar')    renderPolar();
    if (tab.dataset.p === 'history')  loadHistoryFirebase();
    if (tab.dataset.p === 'settings') updateStats();
  });
});

document.getElementById('strat-sync-btn').addEventListener('click', () => {
  REGATA.chrono = Math.round(REGATA.chrono / 60) * 60;
  updateChronoDisplay();
  if(!REGATA.chronoActive) startChrono();
});

document.getElementById('strat-reset-btn').addEventListener('click', () => {
  clearInterval(chronoInterval); REGATA.chronoActive = false; chronoInterval = null;
  REGATA.chrono = 300; updateChronoDisplay();
  document.getElementById('strat-sync-btn').classList.remove('active-btn');
});

document.getElementById('btn-mark-comite').addEventListener('click', () => {
  REGATA.comite = { lat: S.lat, lon: S.lon }; calculateTactics(S, REGATA, activeSpeed); drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle);
});
document.getElementById('btn-mark-pin').addEventListener('click', () => {
  REGATA.pin = { lat: S.lat, lon: S.lon }; calculateTactics(S, REGATA, activeSpeed); drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle);
});
document.getElementById('btn-mark-barlo').addEventListener('click', () => {
  REGATA.barlovento = { lat: S.lat, lon: S.lon }; calculateTactics(S, REGATA, activeSpeed); drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle);
});

document.getElementById('motor-btn').addEventListener('click', function() {
  CFG.motorMode = !CFG.motorMode;
  if (CFG.motorMode) { this.classList.add('active'); this.innerHTML = 'Motor ON'; setFbStatus('Nube: Pausado (motor)'); } 
  else { this.classList.remove('active'); this.innerHTML = 'Motor'; setFbStatus('Nube: OK', 'synced'); }
  updateDash();
});

document.getElementById('night-btn').addEventListener('click', function() {
  document.body.classList.toggle('night-mode');
  const isNight = document.body.classList.contains('night-mode');
  this.innerHTML = isNight ? "Dia" : "Noche"; localStorage.setItem('night_mode', isNight);
  if(document.getElementById('panel-strat').classList.contains('active')) drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle);
});

document.getElementById('conn-btn').addEventListener('click', () => { document.getElementById('overlay').style.display = 'flex'; });
document.getElementById('m-conn').addEventListener('click', () => {
  const h = document.getElementById('m-host').value.trim() || '192.168.0.1'; const p = document.getElementById('m-port').value.trim() || '10110';
  document.getElementById('overlay').style.display = 'none'; connect(h, p);
});
document.getElementById('m-cancel').addEventListener('click', () => { document.getElementById('overlay').style.display = 'none'; });

document.getElementById('cfg-thresh').addEventListener('input', function() { CFG.thresh = +this.value; document.getElementById('thresh-v').textContent = this.value + '%'; });
document.getElementById('cfg-source').addEventListener('change', function() { CFG.speedSource = this.value; });
document.getElementById('cfg-minspeed').addEventListener('change', function() { CFG.minSpeed = +this.value; });

// Los listeners de mantenimiento permanecen totalmente funcionales con las variables locales
document.getElementById('clear-cell-btn').addEventListener('click', () => {
  const k = pKey(S.tws, S.twa); if (!polar[k]?.valor) { alert('La celda actual está vacía.'); return; }
  const label = `${nearest(TWS_B, S.tws)} kn / ${nearest(TWA_B, S.twa)}°`;
  if (confirm(`¿Borrar registro de la celda actual (${label})?`)) { delete polar[k]; schedulePolarSave(); renderPolar(); updateDash(); updateStats(); }
});

document.getElementById('clear-polar-btn').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODA la tabla polar?')) return; polar = {}; await flushPolarSave(); renderPolar(); updateDash(); updateStats();
});

document.getElementById('purge-sog-btn').addEventListener('click', async () => {
  const sogKeys = Object.keys(polar).filter(k => polar[k]?.tipo === 'SOG'); if (!sogKeys.length) { alert('No hay celdas SOG.'); return; }
  if (!confirm(`¿Purgar ${sogKeys.length} celdas SOG?`)) return; sogKeys.forEach(k => delete polar[k]); await flushPolarSave(); renderPolar(); updateDash(); updateStats();
});

window.addEventListener('resize', () => { 
  if(document.getElementById('panel-strat').classList.contains('active')) drawTacticalMap(S, REGATA, CFG, getTargetCeñidaAngle); 
});

/* ── INICIALIZACIÓN AUTOMÁTICA EN IPAD ── */
initTouchLock();
const savedHost = localStorage.getItem('nmea_host'); const savedPort = localStorage.getItem('nmea_port');
if (savedHost && savedPort) { document.getElementById('m-host').value = savedHost; document.getElementById('m-port').value = savedPort; setTimeout(() => connect(savedHost, savedPort), 800); }
if (localStorage.getItem('night_mode') === 'true') { document.body.classList.add('night-mode'); document.getElementById('night-btn').innerHTML = "Dia"; }

loadPolarFirebase(); loadHistoryFirebase(); updateChronoDisplay();