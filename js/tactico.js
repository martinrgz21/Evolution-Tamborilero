/* ══════════════════════════════════════════════════════════════════════════
   MÓDULO TÁCTICO: RENDERIZADO GRÁFICO DEL CAMPO DE REGATAS Y CÁLCULOS
   ══════════════════════════════════════════════════════════════════════════ */

export function getMetersFromLatLon(targetLat, targetLon, baseLat, baseLon) {
  const R = 6378137;
  const dLat = (targetLat - baseLat) * Math.PI / 180;
  const dLon = (targetLon - baseLon) * Math.PI / 180;
  const x = dLon * R * Math.cos(baseLat * Math.PI / 180);
  const y = dLat * R;
  return { x: x, y: y };
}

// Bloquea por completo los gestos de Safari/Chrome en iPadOS impidiendo el deslizamiento de pantalla
export function initTouchLock() {
  const container = document.getElementById('map-container');
  if (!container) return;

  const interceptor = (e) => {
    if (e.cancelable) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Forzamos listeners no pasivos para anular el comportamiento nativo del navegador
  container.addEventListener('touchstart', interceptor, { passive: false });
  container.addEventListener('touchmove', interceptor, { passive: false });
  container.addEventListener('touchend', interceptor, { passive: false });
}

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
    const x0 = 0, y0 = 0;
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

export function drawTacticalMap(S, REGATA, CFG, targetCeñidaAngleFn) {
  const canvas = document.getElementById('strat-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.getBoundingClientRect();
  
  // Sincronización estricta de dimensiones de píxeles para pantallas Retina/iPad
  const desiredWidth = Math.floor(rect.width);
  const desiredHeight = Math.floor(rect.height);
  
  if (canvas.width !== desiredWidth * window.devicePixelRatio || canvas.height !== desiredHeight * window.devicePixelRatio) {
    canvas.width = desiredWidth * window.devicePixelRatio;
    canvas.height = desiredHeight * window.devicePixelRatio;
  }
  
  ctx.resetTransform();
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const cx = desiredWidth / 2;
  const cy = desiredHeight / 2 + 50; 

  let maxDist = 150;
  if (REGATA.distLine && REGATA.distLine > maxDist) maxDist = REGATA.distLine * 1.2;
  const scale = (desiredHeight * 0.6) / maxDist;

  ctx.clearRect(0, 0, desiredWidth, desiredHeight);

  // Anillos concéntricos de distancia cada 50 metros
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--rule') || '#dedad4';
  ctx.lineWidth = 0.5;
  for(let r=50; r <= maxDist; r+=50) {
    ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, 2*Math.PI); ctx.stroke();
  }

  const toPx = (mx, my) => ({ x: cx + (mx * scale), y: cy - (my * scale) });

  // Línea de salida
  if (REGATA.pin && REGATA.comite) {
    const pPx = toPx(REGATA.pin.x, REGATA.pin.y);
    const cPx = toPx(REGATA.comite.x, REGATA.comite.y);

    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--navy') || '#2b4c7e';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pPx.x, pPx.y); ctx.lineTo(cPx.x, cPx.y); ctx.stroke();

    ctx.fillStyle = '#8b1a1a'; ctx.beginPath(); ctx.arc(pPx.x, pPx.y, 7, 0, 2*Math.PI); ctx.fill();
    ctx.fillStyle = '#2d5c3f'; ctx.beginPath(); ctx.arc(cPx.x, cPx.y, 7, 0, 2*Math.PI); ctx.fill();
  }

  // Barlovento y Laylines
  if (REGATA.barlovento) {
    const bPx = toPx(REGATA.barlovento.x, REGATA.barlovento.y);
    ctx.fillStyle = '#b8915a'; ctx.beginPath(); ctx.arc(bPx.x, bPx.y, 8, 0, 2*Math.PI); ctx.fill();

    const twd = S.cog + S.twa;
    const targetCeñida = targetCeñidaAngleFn();

    const laylineEstriborRad = ((90 - (twd - targetCeñida)) * Math.PI) / 180;
    const laylineBaborRad = ((90 - (twd + targetCeñida)) * Math.PI) / 180;

    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#2b4c7e';
    ctx.beginPath(); ctx.moveTo(bPx.x, bPx.y);
    ctx.lineTo(bPx.x - Math.cos(laylineEstriborRad)*300, bPx.y + Math.sin(laylineEstriborRad)*300);
    ctx.stroke();

    ctx.strokeStyle = '#b8915a';
    ctx.beginPath(); ctx.moveTo(bPx.x, bPx.y);
    ctx.lineTo(bPx.x - Math.cos(laylineBaborRad)*300, bPx.y + Math.sin(laylineBaborRad)*300);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Representación del casco a escala real
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((S.cog * Math.PI) / 180);

  const esloraPx = CFG.eslora * scale;
  const mangaPx = esloraPx * 0.32;

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink') || '#1a1a1a';
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--surface') || '#ffffff';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(0, -esloraPx/2);
  ctx.quadraticCurveTo(mangaPx/2, -esloraPx/6, mangaPx/2, esloraPx/2);
  ctx.lineTo(-mangaPx/2, esloraPx/2);
  ctx.quadraticCurveTo(-mangaPx/2, -esloraPx/6, 0, -esloraPx/2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}