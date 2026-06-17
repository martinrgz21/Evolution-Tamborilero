export const REGATA = {
  pin: null, comite: null, barlovento: null,
  chrono: 300, chronoActive: false,
  distLine: null, ttl: null, action: '—'
};

export const TWS_B = [5,8,10,12,14,16,18,20,25,30];
export const TWA_B = [30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180];

export const nearest = (arr,v) => arr.reduce((a,b) => Math.abs(b-v)<Math.abs(a-v)?b:a);
export const pKey = (tws,twa) => `${nearest(TWS_B,tws)}_${nearest(TWA_B,twa)}`;
export const vmg = (speed,twa) => speed * Math.cos(twa * Math.PI/180);
export const fmt = (v,d=1) => (typeof v==='number'&&!isNaN(v)) ? v.toFixed(d) : '—';

function getMetersFromLatLon(targetLat, targetLon, baseLat, baseLon) {
  const R = 6378137;
  const dLat = (targetLat - baseLat) * Math.PI / 180;
  const dLon = (targetLon - baseLon) * Math.PI / 180;
  return {
    x: dLon * R * Math.cos(baseLat * Math.PI / 180),
    y: dLat * R
  };
}

function getTargetCeñidaAngle(polar, currentTws) {
  const twsBucket = nearest(TWS_B, currentTws);
  let bestVmg = 0, targetTwa = 45;
  for (const twa of TWA_B) {
    if (twa > 90) continue;
    const r = polar[`${twsBucket}_${twa}`]?.valor;
    if (r) {
      const v = vmg(r, twa);
      if (v > bestVmg) { bestVmg = v; targetTwa = twa; }
    }
  }
  return targetTwa;
}

export function calculateTactics(S, speedAct) {
  if (REGATA.pin) { const p = getMetersFromLatLon(REGATA.pin.lat, REGATA.pin.lon, S.lat, S.lon); REGATA.pin.x = p.x; REGATA.pin.y = p.y; }
  if (REGATA.comite) { const c = getMetersFromLatLon(REGATA.comite.lat, REGATA.comite.lon, S.lat, S.lon); REGATA.comite.x = c.x; REGATA.comite.y = c.y; }
  if (REGATA.barlovento) { const w = getMetersFromLatLon(REGATA.barlovento.lat, REGATA.barlovento.lon, S.lat, S.lon); REGATA.barlovento.x = w.x; REGATA.barlovento.y = w.y; }

  if (REGATA.pin && REGATA.comite) {
    const x1 = REGATA.pin.x, y1 = REGATA.pin.y;
    const x2 = REGATA.comite.x, y2 = REGATA.comite.y;
    REGATA.distLine = Math.abs((x2 - x1) * y1 - x1 * (y2 - y1)) / Math.sqrt((x2 - x1)**2 + (y2 - y1)**2);

    const anglePerp = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
    const vApproach = ((speedAct * 1852) / 3600) * Math.cos(((90 - S.cog) * Math.PI / 180) - anglePerp);

    if (vApproach > 0.1) {
      REGATA.ttl = REGATA.distLine / vApproach;
      REGATA.action = (REGATA.chrono - REGATA.ttl > 0) ? 'GANAR TIEMPO' : 'AHORRAR TIEMPO';
    } else {
      REGATA.ttl = null; REGATA.action = 'SIN APROXIMACIÓN';
    }
  }
}

export function drawTacticalMap(S, CFG, polar) {
  const canvas = document.getElementById('strat-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio; canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const cx = rect.width / 2, cy = rect.height / 2 + 50;
  let maxDist = 150; if (REGATA.distLine && REGATA.distLine > maxDist) maxDist = REGATA.distLine * 1.2;
  const scale = (rect.height * 0.6) / maxDist;

  ctx.clearRect(0, 0, rect.width, rect.height);
  const inkColor = getComputedStyle(document.body).getPropertyValue('--ink');
  const ruleColor = getComputedStyle(document.body).getPropertyValue('--rule');

  ctx.strokeStyle = ruleColor; ctx.lineWidth = 0.5;
  for(let r=50; r <= maxDist; r+=50) { ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, 2*Math.PI); ctx.stroke(); }

  const toPx = (mx, my) => ({ x: cx + (mx * scale), y: cy - (my * scale) });

  if (REGATA.pin && REGATA.comite) {
    const pPx = toPx(REGATA.pin.x, REGATA.pin.y), cPx = toPx(REGATA.comite.x, REGATA.comite.y);
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--navy'); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(pPx.x, pPx.y); ctx.lineTo(cPx.x, cPx.y); ctx.stroke();
    ctx.fillStyle = '#b22222'; ctx.beginPath(); ctx.arc(pPx.x, pPx.y, 6, 0, 2*Math.PI); ctx.fill();
    ctx.fillStyle = '#227046'; ctx.beginPath(); ctx.arc(cPx.x, cPx.y, 6, 0, 2*Math.PI); ctx.fill();
  }

  if (REGATA.barlovento) {
    const bPx = toPx(REGATA.barlovento.x, REGATA.barlovento.y);
    ctx.fillStyle = '#a37f4c'; ctx.beginPath(); ctx.arc(bPx.x, bPx.y, 7, 0, 2*Math.PI); ctx.fill();

    const twd = S.cog + S.twa, targetC = getTargetCeñidaAngle(polar, S.tws);
    const leRad = ((90 - (twd - targetC)) * Math.PI) / 180, lbRad = ((90 - (twd + targetC)) * Math.PI) / 180;

    ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--navy'); ctx.beginPath(); ctx.moveTo(bPx.x, bPx.y); ctx.lineTo(bPx.x - Math.cos(leRad)*300, bPx.y + Math.sin(leRad)*300); ctx.stroke();
    ctx.strokeStyle = '#a37f4c'; ctx.beginPath(); ctx.moveTo(bPx.x, bPx.y); ctx.lineTo(bPx.x - Math.cos(lbRad)*300, bPx.y + Math.sin(lbRad)*300); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save(); ctx.translate(cx, cy); ctx.rotate((S.cog * Math.PI) / 180);
  const lPx = CFG.eslora * scale, mPx = lPx * 0.32;
  ctx.fillStyle = inkColor; ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--surface'); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -lPx/2); ctx.quadraticCurveTo(mPx/2, -lPx/6, mPx/2, lPx/2); ctx.lineTo(-mPx/2, lPx/2); ctx.quadraticCurveTo(-mPx/2, -lPx/6, 0, -lPx/2);
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}