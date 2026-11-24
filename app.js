/* Route 4. Plain JS, no libraries. */
(() => {
'use strict';
const C = window.ROUTE4;
const $ = (s, r = document) => r.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const store = { get(k, d) { try { const v = localStorage.getItem('r4:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem('r4:' + k, JSON.stringify(v)); } catch {} } };
const fmtDate = (iso, opts) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch {} }

/* ---------------- gate ---------------- */
const gate = $('#gate'), ticket = $('#ticket'), pw = $('#pw');
$('#hint').textContent = C.hint;
let li = 0; const line = $('#gateLine');
const rot = setInterval(() => { line.style.opacity = 0; setTimeout(() => { li = (li + 1) % C.gateLines.length; line.textContent = C.gateLines[li]; line.style.opacity = 1; }, 450); }, 3200);
fetch('data/map.json').then(r => r.json()).then(m => {
  const g = document.createElementNS(NS, 'svg'); g.setAttribute('viewBox', `0 0 ${m.w} ${m.h}`); g.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  m.states.forEach(st => svgEl('path', { d: st.d, fill: 'var(--land)', stroke: 'var(--land-line)', 'stroke-dasharray': '4 3' }, g));
  $('.gate-map').appendChild(g);
}).catch(() => {});
if (store.get('in', false)) { gate.hidden = true; clearInterval(rot); boot(false); }
ticket.addEventListener('submit', async e => {
  e.preventDefault();
  const v = pw.value.trim();
  if (!C.passwords.some(p => p.toLowerCase() === v.toLowerCase())) {
    $('#gateErr').hidden = false; ticket.classList.remove('shake'); void ticket.offsetWidth; ticket.classList.add('shake'); haptic(); return;
  }
  store.set('in', true); clearInterval(rot); haptic();
  ticket.classList.add('punched'); await sleep(RM ? 0 : 420);
  ticket.classList.add('leaving'); await sleep(RM ? 0 : 550);
  gate.hidden = true; boot(true);
});

/* ---------------- data + map ---------------- */
let MAP, YEAR, vb, svg, world, gRoutes, gPins, gVehicle, gDecal, pinEls = {}, k = 1, lastK = 0;
async function boot(fresh) {
  [MAP, YEAR] = await Promise.all([fetch('data/map.json').then(r => r.json()), fetch('data/year.json').then(r => r.json())]);
  $('#app').hidden = false;
  buildMap();
  const all = fullView();
  setView(fresh && !RM ? zoomOut(all, 1.6) : all);
  if (fresh && !RM) await camera(all, 1600);
  drawSeenRoutes();
}

const OURS = new Set(['New York', 'New Jersey', 'Delaware', 'Vermont', 'Virginia']);
const STATE_LABELS = [['NEW YORK', -75.6, 42.6], ['PENNSYLVANIA', -77.6, 40.9], ['NEW JERSEY', -74.62, 40.25], ['VERMONT', -72.75, 44.05], ['VIRGINIA', -78.9, 37.85], ['MASSACHUSETTS', -72.1, 42.38], ['MARYLAND', -76.95, 39.45], ['CONNECTICUT', -72.75, 41.62], ['NEW HAMPSHIRE', -71.65, 43.6], ['DELAWARE', -75.42, 38.98]];
function buildMap() {
  // The base map is painted ONCE onto two canvases (a sharp core and a soft surround). The camera only
  // moves the #world element with a CSS transform, so nothing is redrawn while it glides (smooth on iPhone).
  world = $('#world'); svg = $('#map');
  svg.setAttribute('viewBox', `0 0 ${MAP.w} ${MAP.h}`);
  paintBase();
  if (document.fonts && document.fonts.load) document.fonts.load('600 18px "Barlow Condensed"').then(paintBase).catch(() => {});
  gRoutes = svgEl('g', {}, svg);
  gDecal = svgEl('g', {}, svg);
  gPins = svgEl('g', {}, svg);
  gVehicle = svgEl('g', { class: 'vehicle', opacity: 0 }, svg);
  // pins for places that have chapters (or are vias)
  const used = new Set(); YEAR.chapters.forEach(c => { used.add(c.place); (c.via || []).forEach(v => used.add(v)); });
  for (const key of used) {
    const p = MAP.places[key]; if (!p) continue;
    const g = svgEl('g', { class: 'pin', tabindex: 0, role: 'button', 'aria-label': p.label }, gPins);
    svgEl('circle', { class: 'hit', r: 22 }, g);
    svgEl('circle', { class: 'dot', r: 6.5 }, g);
    const side = LABEL_SIDE[key] || 'r';
    const t = svgEl('text', { class: 'lbl' + (key === 'nyc' ? ' home' : ''), x: side === 'l' ? -11 : 11, y: side === 'b' ? 20 : side === 't' ? -12 : 4.5, 'text-anchor': side === 'l' ? 'end' : side === 'b' || side === 't' ? 'middle' : 'start' }, g);
    t.textContent = p.label;
    if (side === 'b' || side === 't') t.setAttribute('x', 0);
    g.addEventListener('click', () => openPlace(key));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlace(key); } });
    pinEls[key] = g;
  }
  buildVehicles();
  markSeen();
  window.addEventListener('resize', () => { lastK = 0; setView(sheetOpen ? vb : fullView()); });
}
const OUTER = { x: -620, y: -720, w: 2240, h: 2740, s: 0.75 }, CORE_S = 2.4;
function paintBase() {
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const draw = (cv, ox, oy, w, h, s, labels) => {
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    const c = cv.getContext('2d'); c.setTransform(s, 0, 0, s, -ox * s, -oy * s);
    c.fillStyle = v('--water'); c.fillRect(ox, oy, w, h);
    c.lineJoin = 'round';
    if (MAP.canada) { c.fillStyle = v('--land-far'); c.fill(new Path2D(MAP.canada)); }
    for (const st of MAP.states) { const p = new Path2D(st.d); c.strokeStyle = 'rgba(111,159,184,.55)'; c.lineWidth = 3; c.setLineDash([]); c.stroke(p); }
    for (const st of MAP.states) {
      const p = new Path2D(st.d); c.fillStyle = OURS.has(st.name) ? v('--land-ours') : v('--land'); c.fill(p);
      c.strokeStyle = v('--land-line'); c.lineWidth = 1; c.setLineDash([5, 4]); c.stroke(p);
    }
    if (!labels) return;
    c.setLineDash([]); c.fillStyle = 'rgba(150,134,98,.8)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const [t, lon, lat] of STATE_LABELS) {
      const p = proj(lon, lat); c.font = `600 ${t.length > 10 ? 14 : 17}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      try { c.letterSpacing = '6px'; } catch {}
      c.fillText(t, p[0], p[1]);
    }
  };
  draw($('#outer'), OUTER.x, OUTER.y, OUTER.w, OUTER.h, OUTER.s, false);
  draw($('#core'), 0, 0, MAP.w, MAP.h, CORE_S, true);
}
const LABEL_SIDE = { oldtappan: 'r', nyc: 'b', lbi: 'b', wilmington: 'l', farm: 'l', saratoga: 'r', lakegeorge: 'r', ithaca: 'l', burlington: 'l', waterbury: 'r', randolph: 'r', cville: 'r', turks: 'l' };

// inverse of the conic projection is not available client side; state labels use a tiny linear fit from known places
function proj(lon, lat) {
  const P = Object.values(MAP.places).filter(p => !p.fixed);
  // least squares x = a*lon + b*lat + c ; y = d*lon + e*lat + f
  if (!proj.m) {
    const A = P.map(p => [p.lon, p.lat, 1]);
    const solve = (vals) => { // normal equations 3x3
      const M = [[0,0,0],[0,0,0],[0,0,0]], v = [0,0,0];
      A.forEach((r, i) => { for (let a = 0; a < 3; a++) { v[a] += r[a] * vals[i]; for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; } });
      const det = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
      const D = det(M); return [0,1,2].map(c => det(M.map((row, r) => row.map((x, j) => j === c ? v[r] : x))) / D);
    };
    proj.m = [solve(P.map(p => p.x)), solve(P.map(p => p.y))];
  }
  const [X, Y] = proj.m; return [X[0]*lon + X[1]*lat + X[2], Y[0]*lon + Y[1]*lat + Y[2]];
}

/* ---------------- camera (animated viewBox) ---------------- */
function stageSize() { const r = $('#stage').getBoundingClientRect(); return [r.width || innerWidth, r.height || innerHeight]; }
function fit(b) { // expand box to the stage aspect ratio, leave room for chrome
  const [W, H] = stageSize(); const ar = W / H;
  let { x, y, w, h } = b; const cx = x + w / 2, cy = y + h / 2;
  if (w / h > ar) h = w / ar; else w = h * ar;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
function fullView() { return fit({ x: 40, y: 90, w: MAP.w + 20, h: MAP.h - 110 }); }
function zoomOut(b, f) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return { x: cx - b.w * f / 2, y: cy - b.h * f / 2, w: b.w * f, h: b.h * f }; }
function boxAround(pts, pad, minW = 260, forSheet = false) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let w = Math.max(x1 - x0, minW), h = Math.max(y1 - y0, minW);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // when the sheet covers the bottom on phones, shift the box so the target sits in the upper area
  const [W, H] = stageSize(); const phone = W < 900;
  const b = fit({ x: cx - w / 2 - pad, y: cy - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 });
  if (phone && (sheetOpen || forSheet)) b.y += b.h * 0.3;
  return b;
}
function setView(b) {
  vb = b;
  const [W] = stageSize(); const s = W / b.w; k = b.w / W;
  world.style.transform = `translate3d(${(-b.x * s).toFixed(2)}px,${(-b.y * s).toFixed(2)}px,0) scale(${s.toFixed(4)})`;
  if (Math.abs(k - lastK) > 0.004) { lastK = k; svg.style.setProperty('--k', k.toFixed(3)); } else return;
  for (const key in pinEls) { const p = MAP.places[key]; pinEls[key].setAttribute('transform', `translate(${p.x},${p.y}) scale(${k})`); }
  if (vehicle.pos) placeVehicle(vehicle.pos, vehicle.ang);
}
function camera(to, ms = 1100) {
  if (RM || !vb) { setView(to); return Promise.resolve(); }
  const from = { ...vb }; const t0 = performance.now();
  return new Promise(res => {
    const step = now => { const t = Math.min(1, (now - t0) / ms), e = easeInOut(t);
      setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
      t < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
}

/* ---------------- vehicles ---------------- */
const vehicle = { kind: null, pos: null, ang: 0 };
const VEH = {
  car: `<g><rect x="-15" y="-8" width="30" height="16" rx="5" fill="#1d2f57"/><rect x="-6" y="-6.5" width="10" height="13" rx="2.5" fill="#33497a"/><path d="M5 -6.5h3.5a3 3 0 0 1 3 3v7a3 3 0 0 1 -3 3H5z" fill="#9fb8d8"/><rect x="-13" y="-6" width="4" height="12" rx="1.5" fill="#9fb8d8" opacity=".7"/><circle cx="14" cy="-5" r="1.4" fill="#ffe9a3"/><circle cx="14" cy="5" r="1.4" fill="#ffe9a3"/></g>`,
  bus: `<g><rect x="-20" y="-7" width="40" height="14" rx="3" fill="#2e7d4f"/><rect x="-17" y="-5" width="31" height="10" rx="1.5" fill="#dfe9e2"/><rect x="15" y="-5.5" width="3.5" height="11" rx="1" fill="#9fb8d8"/><path d="M-17 0h31" stroke="#2e7d4f" stroke-width="1.2"/></g>`,
  train: `<g><rect x="-34" y="-5" width="20" height="10" rx="2" fill="#d9dde2"/><rect x="-12" y="-5" width="20" height="10" rx="2" fill="#d9dde2"/><path d="M10 -5h12a6 5 0 0 1 0 10H10z" fill="#d9dde2"/><path d="M-34 1.5h56" stroke="#c8372d" stroke-width="1.6"/><path d="M-34 -1.5h56" stroke="#2a5aa6" stroke-width="1.6"/></g>`,
  plane: `<g><path d="M20 0c0-2-2-3-5-3H3L-6 -16h-5l5 13h-9l-4 -5h-4l3 8 -3 8h4l4 -5h9l-5 13h5l9 -13h12c3 0 5 -1 5 -3z" fill="#1f2a36"/></g>`,
};
function buildVehicles() { gVehicle.innerHTML = ''; }
function setVehicle(kind) {
  if (vehicle.kind === kind) return;
  vehicle.kind = kind; gVehicle.innerHTML = VEH[kind] || VEH.car;
}
function placeVehicle([x, y], ang) {
  vehicle.pos = [x, y]; vehicle.ang = ang;
  const flip = ''; // top-down icons rotate freely
  gVehicle.setAttribute('transform', `translate(${x},${y}) rotate(${ang}) scale(${k * 1.15})${flip}`);
}

/* ---------------- routes ---------------- */
function legPath(a, b, mode, i) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const bend = mode === 'plane' ? .32 : mode === 'bus' ? -.14 : mode === 'train' ? .1 : .18 * (i % 2 ? 1 : -1);
  const cx = (a.x + b.x) / 2 - dy * bend, cy = (a.y + b.y) / 2 + dx * bend;
  return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, len: d };
}
const seenLegs = store.get('legs', []);
function drawSeenRoutes() { seenLegs.forEach(l => addRoute(l, false)); }
function addRoute(l, animate) {
  const a = MAP.places[l.from], b = MAP.places[l.to]; if (!a || !b) return null;
  const { d } = legPath(a, b, l.mode, l.i);
  const cas = svgEl('path', { d, class: 'route-casing' }, gRoutes);
  const p = svgEl('path', { d, class: 'route ' + l.mode }, gRoutes);
  if (l.mode === 'plane' || l.mode === 'bus') cas.remove();
  return p;
}

/* ---------------- tour ---------------- */
let touring = false, tourIdx = store.get('tourIdx', 0), sheetOpen = false, resumeNext = null;
const LABELS = { car: 'in Lucinda', bus: 'on the bus', train: 'on the Amtrak', plane: 'by plane' };
function stops() { // chapters -> stops. Every trip leaves from home (New York), so a quiet return leg is added between trips.
  const out = []; let prev = 'nyc', lastMode = 'car';
  YEAR.chapters.forEach((c, ci) => {
    const seq = c.via || [c.place];
    seq.forEach((pl, j) => {
      let mode = pl === prev ? null : (j === 0 ? (c.mode || 'car') : 'car');
      if (j === 0 && mode && mode !== 'none' && prev !== 'nyc' && pl !== 'nyc') {
        out.push({ ci, place: 'nyc', from: prev, mode: lastMode === 'none' ? 'car' : lastMode, show: false, quiet: true }); prev = 'nyc';
      }
      out.push({ ci, place: pl, from: prev, mode, show: j === seq.length - 1 });
      if (mode && j === 0) lastMode = mode; prev = pl;
    });
  });
  return out;
}
$('#btnPlay').addEventListener('click', () => { if (touring) { stopTour(); return; } startTour(); });
async function startTour() {
  touring = true; $('#app').classList.add('touring'); $('#playLabel').textContent = 'Pause';
  closeSheet(true);
  const S = stops();
  if (tourIdx >= S.length) { tourIdx = 0; resetRoutes(); }
  if (tourIdx === 0) { resetRoutes(); setVehicle('car'); placeVehicle([MAP.places.nyc.x, MAP.places.nyc.y], 0); gVehicle.setAttribute('opacity', 1); await caption('Start: New York, November 2025'); }
  while (touring && tourIdx < S.length) {
    const s = S[tourIdx];
    if (s.mode === 'none') { gVehicle.setAttribute('opacity', 0); const p = MAP.places[s.place]; vehicle.pos = [p.x, p.y]; }
    else if (s.mode) await drive(s, tourIdx);
    else { const p = MAP.places[s.place]; setVehicle(vehicle.kind || 'car'); placeVehicle([p.x, p.y], vehicle.ang); gVehicle.setAttribute('opacity', 1); }
    markSeen(s.place);
    tourIdx++; store.set('tourIdx', tourIdx);
    if (!touring) break;
    if (s.show) {
      await camera(boxAround([[MAP.places[s.place].x, MAP.places[s.place].y]], 90, 220, true), 700);
      const go = await openChapter(s.ci, true);
      if (!go) { stopTour(); return; }
    }
  }
  if (tourIdx >= S.length) finale();
}
function stopTour() { touring = false; $('#app').classList.remove('touring'); $('#playLabel').textContent = tourIdx > 0 && tourIdx < stops().length ? 'Keep driving' : 'Drive our year'; hideCaption(); }
function resetRoutes() { gRoutes.innerHTML = ''; seenLegs.length = 0; store.set('legs', []); store.set('seen', []); markSeen(); }
async function drive(s, i) {
  const a = MAP.places[s.from], b = MAP.places[s.place];
  const leg = { from: s.from, to: s.place, mode: s.mode, i };
  await camera(boxAround([[a.x, a.y], [b.x, b.y]], 110), 900);
  const c = YEAR.chapters[s.ci];
  if (s.show) c.photos.slice(0, 4).forEach(ph => { const im = new Image(); im.src = 'img/m' + ph.id.slice(1) + '.webp'; });
  caption(s.quiet ? 'Back home' : `${s.mode === 'car' ? 'Lucinda' : s.mode === 'bus' ? 'The bus' : s.mode === 'train' ? 'Amtrak' : 'Flight'} to ${b.label}${s.show ? ' · ' + fmtDate(c.dates[0], { month: 'short', year: 'numeric' }) : ''}`);
  const p = addRoute(leg); seenLegs.push(leg); store.set('legs', seenLegs);
  setVehicle(s.mode); gVehicle.setAttribute('opacity', 1);
  const L = p.getTotalLength();
  const solid = s.mode !== 'bus' && s.mode !== 'plane'; if (solid) p.style.strokeDasharray = `${L} ${L}`;
  const ms = RM ? 0 : (s.quiet ? 900 : Math.min(3200, 1100 + L * 4));
  const t0 = performance.now();
  await new Promise(res => {
    const step = now => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1, e = easeInOut(t), at = L * e;
      const pt = p.getPointAtLength(at), pt2 = p.getPointAtLength(Math.min(L, at + 1));
      const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI;
      placeVehicle([pt.x, pt.y], ang);
      if (s.mode !== 'bus' && s.mode !== 'plane') p.style.strokeDashoffset = L - at;
      else p.style.clipPath = '';
      t < 1 && touring ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
  p.style.strokeDasharray = ''; p.style.strokeDashoffset = '';
  hideCaption();
}
function markSeen(place) {
  const seen = new Set(store.get('seen', []));
  if (place) { seen.add(place); store.set('seen', [...seen]); }
  for (const kk in pinEls) { pinEls[kk].classList.toggle('been', seen.has(kk)); pinEls[kk].classList.toggle('here', kk === place); }
}
let capT; async function caption(t) { const c = $('#caption'); c.textContent = t; c.hidden = false; clearTimeout(capT); return sleep(RM ? 0 : 500); }
function hideCaption() { $('#caption').hidden = true; }
async function finale() {
  stopTour(); tourIdx = 0; store.set('tourIdx', 0);
  gVehicle.setAttribute('opacity', 0);
  await camera(fullView(), 1600);
  caption(C.finale && C.finale.line ? C.finale.line : 'Year four');
  $('#playLabel').textContent = 'Drive it again';
}

/* ---------------- postcard sheet ---------------- */
const sheet = $('#sheet');
function openPlace(key) {
  const list = YEAR.chapters.map((c, i) => [c, i]).filter(([c]) => c.place === key || (c.via || []).includes(key));
  if (!list.length) return;
  const p = MAP.places[key];
  camera(boxAround([[p.x, p.y]], 90, 220, true), 700);
  // a place can hold several chapters; show the first and let "Next" walk through that place's chapters
  let j = 0; const show = () => openChapter(list[j][1], false, list.length > 1 ? () => { j = (j + 1) % list.length; show(); } : null, list.length > 1 ? `${j + 1} of ${list.length} here` : '');
  show();
}
function openChapter(ci, inTour, onNext, countText) {
  const c = YEAR.chapters[ci]; const p = MAP.places[c.place];
  hideCaption();
  $('#sheetKicker').textContent = `${p.label} · ${fmtDate(c.dates[0], { month: 'long', year: 'numeric' })}`;
  $('#sheetTitle').textContent = c.title;
  $('#blurb').textContent = c.blurb || '';
  const d0 = new Date(c.dates[0] + 'T12:00:00');
  $('#postmark').innerHTML = '';
  ['ROUTE 4', d0.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + ' ' + d0.getDate(), String(d0.getFullYear())].forEach(t => { const s = document.createElement('div'); s.textContent = t; $('#postmark').appendChild(s); });
  const strip = $('#strip'); strip.innerHTML = ''; strip.scrollLeft = 0;
  c.photos.forEach((ph, i) => {
    const f = document.createElement('figure'); f.className = 'snap'; f.style.margin = 0;
    if (ph.video) {
      const v = document.createElement('video'); v.src = 'vid/' + ph.id + '.mp4'; v.poster = 'img/m' + ph.id.slice(1) + '.webp'; v.playsInline = true; v.preload = 'none'; v.loop = true; if (ph.w && ph.h) v.style.aspectRatio = ph.w + ' / ' + ph.h; v.setAttribute('playsinline', '');
      f.appendChild(v);
      const b = document.createElement('button'); b.className = 'play'; b.setAttribute('aria-label', 'Play video'); b.innerHTML = '<span>&#9654;</span>';
      b.addEventListener('click', () => { f.classList.add('playing'); v.controls = true; v.play().catch(() => {}); });
      f.appendChild(b);
    } else {
      const im = document.createElement('img'); im.alt = ''; im.decoding = 'async'; 
      im.src = 'img/m' + ph.id.slice(1) + '.webp';
      if (ph.w && ph.h) { im.width = ph.w; im.height = ph.h; im.style.aspectRatio = ph.w + ' / ' + ph.h; }
      im.addEventListener('click', () => lightbox(c, i));
      f.appendChild(im);
    }
    const w = document.createElement('figcaption'); w.className = 'when'; w.textContent = fmtDate(ph.date); f.appendChild(w);
    strip.appendChild(f);
  });
  const nb = $('#nextBtn');
  const S = stops(); const total = YEAR.chapters.length;
  $('#stopCount').textContent = inTour ? `Stop ${ci + 1} of ${total}` : (countText || '');
  nb.hidden = !inTour && !onNext;
  nb.textContent = inTour ? (ci === total - 1 ? 'Finish the drive' : 'Next stop') : 'Next here';
  sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add('open')); sheetOpen = true;
  sheet.scrollTop = 0;
  return new Promise(res => {
    resumeNext = res;
    nb.onclick = () => { if (inTour) { resumeNext = null; closeSheet(true); res(true); } else if (onNext) onNext(); };
  });
}
function closeSheet(silent) {
  sheet.classList.remove('open'); sheetOpen = false;
  sheet.querySelectorAll('video').forEach(v => v.pause());
  setTimeout(() => { if (!sheetOpen) sheet.hidden = true; }, 450);
  if (!silent && resumeNext) { const r = resumeNext; resumeNext = null; r(false); }
}
$('#sheetClose').addEventListener('click', () => { const was = resumeNext; resumeNext = null; closeSheet(true); if (was) was(false); });

/* ---------------- lightbox ---------------- */
function lightbox(c, start) {
  const lb = $('#lightbox'), tr = $('#lbTrack'); tr.innerHTML = '';
  c.photos.forEach(ph => {
    const s = document.createElement('div'); s.className = 'lb-slide';
    if (ph.video) { const v = document.createElement('video'); v.src = 'vid/' + ph.id + '.mp4'; v.poster = 'img/' + ph.id + '.webp'; v.controls = true; v.playsInline = true; v.preload = 'none'; s.appendChild(v); }
    else { const im = document.createElement('img'); im.src = 'img/' + ph.id + '.webp'; im.alt = ''; s.appendChild(im); }
    tr.appendChild(s);
  });
  lb.hidden = false; requestAnimationFrame(() => { tr.scrollLeft = start * tr.clientWidth; });
}
$('#lbClose').addEventListener('click', () => { $('#lightbox').hidden = true; $('#lbTrack').innerHTML = ''; });

/* ---------------- overlays ---------------- */
function openOv(id) { const o = $('#' + id); o.hidden = false; const b = o.querySelector('.ov-close'); b && b.focus(); }
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o || e.target.closest('.ov-close')) { o.hidden = true; if (o.id === 'odo') clearInterval(odoT); } });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').hidden) { $('#lbClose').click(); return; }
  const open = [...document.querySelectorAll('.overlay')].find(o => !o.hidden); if (open) { open.hidden = true; return; }
  if (sheetOpen) $('#sheetClose').click();
});

/* sticker machine: a shuffle bag, so every sticker comes out once before any repeats */
let STK = [];
fetch('data/stickers.json').then(r => r.ok ? r.json() : []).then(a => { STK = a; fillDome(); countStk(); }).catch(() => {});
const CAPS = ['#c8372d', '#2a5aa6', '#2e7d4f', '#e3a32b', '#1d2f57', '#d4456b'];
function fillDome() {
  const d = $('#dome'); d.innerHTML = '';
  for (let i = 0; i < 16; i++) { const c = document.createElement('span'); c.className = 'cap'; c.style.background = CAPS[i % CAPS.length]; c.style.left = (8 + (i * 37) % 150) + 'px'; c.style.top = (70 + ((i * 53) % 90)) + 'px'; c.style.transform = `rotate(${i * 47}deg)`; d.appendChild(c); }
}
function countStk() {
  const got = store.get('stk', []);
  $('#mCount').textContent = STK.length ? `${got.length} of ${STK.length} collected` : '';
  const col = $('#collection'); col.innerHTML = '';
  got.forEach(id => { const s = STK.find(x => x.id === id); if (!s) return; const im = document.createElement('img'); im.src = 'stk/' + s.file; im.alt = 'sticker'; im.loading = 'lazy'; col.appendChild(im); });
}
let spinning = false, knobDeg = 0;
$('#btnStickers').addEventListener('click', () => openOv('machine'));
$('#knob').addEventListener('click', async () => {
  if (spinning || !STK.length) return; spinning = true; haptic();
  knobDeg += 360; $('#knob').style.transform = `rotate(${knobDeg}deg)`;
  let bag = store.get('bag', []);
  if (!bag.length) { bag = STK.map(s => s.id).sort(() => Math.random() - .5); }
  const id = bag.pop(); store.set('bag', bag);
  await sleep(RM ? 0 : 800);
  const cap = document.createElement('span'); cap.className = 'cap'; cap.style.background = CAPS[Math.floor(Math.random() * CAPS.length)];
  cap.setAttribute('role', 'button'); cap.setAttribute('aria-label', 'Open the capsule'); cap.tabIndex = 0;
  $('#chute').innerHTML = ''; $('#chute').appendChild(cap);
  const open = () => {
    const s = STK.find(x => x.id === id); $('#chute').innerHTML = '';
    const got = store.get('stk', []); if (!got.includes(id)) { got.push(id); store.set('stk', got); }
    const r = document.createElement('div'); r.className = 'reveal'; const im = document.createElement('img'); im.src = 'stk/' + s.file; im.alt = 'A Bella sticker'; r.appendChild(im);
    r.addEventListener('click', () => { r.remove(); countStk(); });
    document.body.appendChild(r); haptic(); spinning = false;
  };
  cap.addEventListener('click', open); cap.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
});

/* odometer */
let odoT;
$('#btnOdo').addEventListener('click', () => { openOv('odo'); drawOdo(true); clearInterval(odoT); odoT = setInterval(() => drawOdo(false), 1000); });
function drawOdo(roll) {
  const start = new Date(YEAR.start); const ms = Date.now() - start;
  const days = Math.floor(ms / 864e5);
  const box = $('#odoDays'); const str = String(days).padStart(4, '0');
  if (roll || box.children.length !== str.length) {
    box.innerHTML = '';
    [...str].forEach((ch, i) => { const d = document.createElement('div'); d.className = 'odo-d'; const reel = document.createElement('div'); reel.className = 'reel';
      for (let n = 0; n <= 9; n++) { const x = document.createElement('div'); x.textContent = n; reel.appendChild(x); }
      d.appendChild(reel); box.appendChild(d);
      reel.style.transform = 'translateY(0)'; requestAnimationFrame(() => requestAnimationFrame(() => { reel.style.transitionDelay = (i * 120) + 'ms'; reel.style.transform = `translateY(-${(+ch) * 52}px)`; })); });
  }
  $('#odoHours').textContent = Math.floor(ms / 36e5).toLocaleString();
  $('#odoMinutes').textContent = Math.floor(ms / 6e4).toLocaleString();
  $('#odoSeconds').textContent = Math.floor(ms / 1e3).toLocaleString();
}

/* letter */
$('#btnLetter').addEventListener('click', () => {
  const env = $('#envelope'); env.classList.remove('open', 'read'); $('#letterHint').hidden = false; $('#letterHint').textContent = 'tap the seal';
  const L = C.letter, box = $('#letterText'); box.innerHTML = '';
  const h = document.createElement('h4'); h.textContent = L.greeting; box.appendChild(h);
  L.paragraphs.forEach(t => { const p = document.createElement('p'); p.textContent = t; box.appendChild(p); });
  const s = document.createElement('p'); s.className = 'sign'; s.innerHTML = ''; s.append(L.signoff, document.createElement('br'), L.name); box.appendChild(s);
  openOv('letter');
});
$('#seal').addEventListener('click', async () => {
  const env = $('#envelope'); haptic(); env.classList.add('open'); $('#letterHint').hidden = true;
  await sleep(RM ? 0 : 1700); env.classList.add('read'); $('#paper').focus();
});
$('#letter').addEventListener('click', e => { if (e.target.closest('.letter-close')) $('#letter').hidden = true; });
})();
