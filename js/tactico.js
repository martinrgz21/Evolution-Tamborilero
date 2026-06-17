/* ══════════════════════════════════════════════════════════════════════════
   MÓDULO TÁCTICO: RENDERIZADO GRÁFICO DEL CAMPO DE REGATAS Y CÁLCULOS
   ══════════════════════════════════════════════════════════════════════════ */

// Traduce distancias geográficas de Lat/Lon a metros cartesianos relativos (origen en el barco)
export function getMetersFromLatLon(targetLat, targetLon, baseLat, baseLon) {
  const R = 6378137; // Radio de la Tierra en metros
  const dLat = (targetLat - baseLat) * Math.PI / 180;
  const dLon = (targetLon - baseLon) * Math.PI / 180;
  const x = dLon * R * Math.cos(baseLat * Math.PI / 180);
  const y = dLat * R;
  return { x: x, y: y };
}

// Inicializa las directivas de bloqueo táctil estricto sobre el contenedor del mapa en iPad
export function initTouchLock() {
  const container = document.getElementById('map-container');
  if (!container) return;

  const preventDefaultBehavior = (e) => {
    if (e.neutralized) return;
    e.preventDefault();
  };

  // Bloquea scroll elástico nativo de iOS dentro de la ventana táctica
  container.addEventListener('touchstart', preventDefaultBehavior, { passive: false });
  container.addEventListener('touchmove', preventDefaultBehavior, { passive: false });
}

// Ejecuta las proyecciones trigonométricas y calcula la velocidad neta de aproximación a la línea (TTL)
export function calculateTactics(S, REGATA, activeSpeedFn) {
  if (REGATA.pin) { 
    const p = getMetersFromLatLon(REGATA.pin.lat, REGATA.pin.lon, S.lat, S.lon); 
    REGATA.pin.x = p.x; REGATA.pin.y = p.y; 
  }
  if (REGATA.comite) { 
    const c = getMetersFromLatLon(REGATA.comite.lat, REGATA.comite.lon, S.lat, S.lon); 
    REGATA.comite.x = c.x; REGATA.comite.y = c.y; 
  }
  if (REGATA.barlovento) { 
    const w = getMetersFromLatLon(REGATA.barlovento.lat, REGATA.barlovento.lon, S.lat, S.lon); 
    REGATA.barlovento.x = w.x; REGATA.barlovento.y = w.y; 
  }

  if (REGATA.pin && REGATA.comite) {
    const x0 = 0, y0 = 0; // Origen posicionado en el barco
    const x1 = REGATA.pin.x, y1 = REGATA.pin.y;
    const x2 = REGATA.comite.x, y2 = REGATA.comite.y;
    
    const numerador = Math.abs((x2 - x1) * (y1 - y0) - (x1 - x0) * (y2 - y1));
    const denominador = Math.sqrt((x2 - x1)**2 + (y2 - y1)**2);
    REGATA.distLine = denominador > 0 ? numerador / denominador : 0;

    const angleLinea = Math.atan2(y2 - y1, x2 - x1);
    const anglePerpendicular = angleLinea + Math.PI / 2;
    const cogRad = (90 - S.cog) * Math.PI / 180;
    const speedMps = (activeSpeedFn() * 1852) / 3600;
    
    const vApproach = speedMps * Math.cos(cogRad - anglePerpendicular);

    if (vApproach > 0.1) {
      REGATA.ttl = REGATA.distLine / vApproach;
      REGATA.action = (REGATA.chrono - REGATA.ttl > 0) ? 'GANAR TIEMPO' : 'AHORRAR TIEMPO';
    } else {
      REGATA.ttl = null; 
      REGATA.action = 'SIN APROXIMACIÓN';
    }
  } else {
    REGATA.distLine = null; REGATA.ttl = null; REGATA.action = '—';
  }
}

// Redibuja el canvas con escala matemática exacta sin alterar el comportamiento de la interfaz externa
export function drawTacticalMap(S, REGATA, CFG, targetCeñidaAngleFn) {
  const canvas = document.getElementById('strat-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const cx = rect.width / 2;
  const cy = rect.height / 2 + 50; 

  let maxDist = 150;
  if (REGATA.distLine && REGATA.distLine > maxDist) maxDist = REGATA.distLine * 1.2;
  const scale = (rect.height * 0.6) / maxDist;

  ctx.clearRect(0, 0, rect.width, rect.height);

  // Cuadrícula Náutica concéntrica cada 50m
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--rule');
  ctx.lineWidth = 0.5;
  for(let r=50; r <= maxDist; r+=50) {
    ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, 2*Math.PI); ctx.stroke();
  }

  const toPx = (mx, my) => ({ x: cx + (mx * scale), y: cy - (my * scale) });

  // Render de Línea de Salida
  if (REGATA.pin && REGATA.comite) {
    const pPx = toPx(REGATA.pin.x, REGATA.pin.y);
    const cPx = toPx(REGATA.comite.x, REGATA.comite.y);

    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--navy');
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pPx.x, pPx.y); ctx.lineTo(cPx.x, cPx.y); ctx.stroke();

    ctx.fillStyle = '#8b1a1a'; ctx.beginPath(); ctx.arc(pPx.x, pPx.y, 7, 0, 2*Math.PI); ctx.fill(); // Pin (Roja)
    ctx.fillStyle = '#2d5c3f'; ctx.beginPath(); ctx.arc(cPx.x, cPx.y, 7, 0, 2*Math.PI); ctx.fill(); // Comité (Verde)
  }

  // Render de Barlovento y Laylines Tácticas
  if (REGATA.barlovento) {
    const bPx = toPx(REGATA.barlovento.x, REGATA.barlovento.y);

    ctx.fillStyle = '#b8915a'; ctx.beginPath(); ctx.arc(bPx.x, bPx.y, 8, 0, 2*Math.PI); ctx.fill(); // Boya Amarilla

    const twd = S.cog + S.twa;
    const targetCeñida = targetCeñidaAngleFn();

    const laylineEstriborRad = ((90 - (twd - targetCeñida)) * Math.PI) / 180;
    const laylineBaborRad = ((90 - (twd + targetCeñida)) * Math.PI) / 180;

    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#2b4c7e'; // Estribor
    ctx.beginPath(); ctx.moveTo(bPx.x, bPx.y);
    ctx.lineTo(bPx.x - Math.cos(laylineEstriborRad)*300, bPx.y + Math.sin(laylineEstriborRad)*300);
    ctx.stroke();

    ctx.strokeStyle = '#b8915a'; // Babor
    ctx.beginPath(); ctx.moveTo(bPx.x, bPx.y);
    ctx.lineTo(bPx.x - Math.cos(laylineBaborRad)*300, bPx.y + Math.sin(laylineBaborRad)*300);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Renderizado a escala del Barco
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((S.cog * Math.PI) / 180);

  const esloraPx = CFG.eslora * scale;
  const mangaPx = esloraPx * 0.32;

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink');
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--surface');
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(0, -esloraPx/2);
  ctx.quadraticCurveTo(mangaPx/2, -esloraPx/6, mangaPx/2, esloraPx/2);
  ctx.lineTo(-mangaPx/2, esloraPx/2);
  ctx.quadraticCurveTo(-mangaPx/2, -esloraPx/6, 0, -esloraPx/2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}