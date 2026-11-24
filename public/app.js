/* Rush Coffee — HPP Counter (frontend, vanilla JS) */
'use strict';

const LOCAL = location.protocol === 'file:'; // dibuka langsung (klik 2x) -> simpan di browser
const LKEY = 'rush_hpp_data';
let S = null;            // state from server
let rev = 0;             // server revision this state is based on
let view = location.hash.slice(1) || 'dashboard';
let saveTimer = null, saving = false, dirty = false;
let sim = { changes: {}, targetProfit: 10000000, scale: 100 }; // simulation (not saved)

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// accepts 19000, 19.000 (ribuan), 1,5 (desimal), 1.5
const num = v => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let t = String(v ?? '').trim().replace(/\s|rp/gi, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t); return isFinite(n) ? n : 0;
};
const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const rp2 = n => 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const pct = n => (isFinite(n) ? n.toFixed(1) : '0.0') + '%';
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const roundUp = (n, step) => step > 0 ? Math.ceil(n / step) * step : Math.ceil(n);
const UNITS = ['gr', 'kg', 'ml', 'liter', 'pcs'];
const BASE = { gr: 'gr', kg: 'gr', ml: 'ml', liter: 'ml', pcs: 'pcs' };   // satuan yang dipakai di resep
const FACTOR = { kg: 1000, liter: 1000 };
const PACKS = ['pcs', 'pack', 'dus', 'karton', 'botol', 'kotak', 'sachet', 'bal', 'galon', 'kaleng', 'karung', 'kg', 'liter'];
const baseUnit = g => BASE[g?.unit] || g?.unit || '';
const totalBase = g => num(g.buyQty || 1) * num(g.purchaseQty) * (FACTOR[g.unit] || 1);  // total isi dalam satuan resep
const fmtQty = n => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
// migrasi data lama: yieldPct -> wastePct, tambah jumlah beli
function normalize(d) {
  (d.ingredients || []).forEach(g => {
    if (g.buyQty == null) g.buyQty = 1;
    if (g.packName == null) g.packName = 'pcs';
    if (g.wastePct == null) g.wastePct = 100 - num(g.yieldPct ?? 100);
    delete g.yieldPct;
  });
  // simulasi penjualan (disimpan)
  d.sales = d.sales || {};
  if (d.sales.daysOpen == null) d.sales.daysOpen = 30;
  if (d.settings && d.settings.targetMarginPct == null) d.settings.targetMarginPct = 60;
  (d.menus || []).forEach(m => { if (m.marginPct === undefined) m.marginPct = null; });
  if (d.sales.taxPct == null) d.sales.taxPct = 0;
  // harga online per menu (opsional). Data lama: pakai harga ojol otomatis = belum diisi
  (d.menus || []).forEach(m => { if (m.onlinePrice === undefined) m.onlinePrice = null; });
  delete d.sales.onlineMarkup;
  if (!Array.isArray(d.investments)) d.investments = [
    { id: 'v1', name: 'Booth kontainer', amount: 25000000 },
    { id: 'v2', name: 'Peralatan (blender, chiller, dispenser)', amount: 12000000 },
    { id: 'v3', name: 'Perlengkapan bar & alat kecil', amount: 3000000 },
    { id: 'v4', name: 'Branding, signage & seragam', amount: 3000000 },
    { id: 'v5', name: 'Modal kerja awal (stok pertama)', amount: 4000000 }];
  d.sales.items = d.sales.items || {};
  const tot = (d.menus || []).reduce((a, m) => a + num(m.mixPct), 0);
  const perDay = num(d.settings?.targetCupsPerMonth) / 30;
  (d.menus || []).forEach(m => {
    if (!d.sales.items[m.id]) {
      const share = tot > 0 ? num(m.mixPct) / tot : 1 / (d.menus.length || 1);
      d.sales.items[m.id] = { offline: Math.round(perDay * share * 0.8), online: Math.round(perDay * share * 0.2) };
    }
  });
  return d;
}
const CATS = ['Kopi', 'Susu', 'Pemanis', 'Sirup', 'Topping', 'Lainnya', 'Kemasan'];
// palet grafik (lolos uji buta warna): biru, amber, ungu, hijau + abu netral
const COL = { bahan: '#3A6FD8', kemasan: '#D4A000', overhead: '#B07CE8', profit: '#5D9C1F', loss: '#c62828', omzet: '#0647A9', tax: '#9aa7b8',
  komisi: '#D4A000', hpp: '#3A6FD8', opex: '#B07CE8' };

// ---------------- API ----------------
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('auth'); }
  return { status: r.status, body: j };
}
async function load() {
  if (LOCAL) {
    let d = null; try { d = JSON.parse(localStorage.getItem(LKEY)); } catch { }
    S = d || Object.assign(JSON.parse(JSON.stringify(window.RUSH_SEED)), { rev: 1, updatedAt: new Date().toISOString() });
    normalize(S); rev = S.rev; dirty = false; showApp(); render(); setSync('', 'Mode lokal · tersimpan di browser ini'); return;
  }
  const r = await api('GET', '/api/data');
  S = normalize(r.body); rev = S.rev; dirty = false;
  showApp(); render();
}
function queueSave() {
  dirty = true; setSync('saving', 'Menyimpan…');
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
}
async function save(force) {
  if (saving) { saveTimer = setTimeout(save, 400); return; }
  saving = true;
  if (LOCAL) {
    try { S.rev = ++rev; S.updatedAt = new Date().toISOString(); localStorage.setItem(LKEY, JSON.stringify(S)); dirty = false; setSync('', 'Tersimpan di browser ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })); }
    catch { setSync('err', 'Browser menolak penyimpanan'); }
    saving = false; return;
  }
  try {
    const { rev: _r, updatedAt, updatedBy, ...state } = S;
    const r = await api('PUT', '/api/data', { state, baseRev: rev, force: !!force });
    if (r.status === 200) { rev = r.body.rev; S.rev = rev; S.updatedAt = r.body.updatedAt; dirty = false; setSync('', 'Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })); }
    else if (r.status === 409) {
      saving = false;
      if (confirm('Data sudah diubah dari perangkat lain.\n\nOK = timpa dengan perubahan Anda\nCancel = muat data terbaru dari server')) return save(true);
      S = normalize(r.body.current); rev = S.rev; dirty = false; render(); setSync('', 'Dimuat ulang'); return;
    } else setSync('err', r.body.error || 'Gagal menyimpan');
  } catch (e) { if (e.message !== 'auth') setSync('err', 'Server tidak terjangkau'); }
  saving = false;
}
function setSync(cls, text) { $('#sync').className = 'sync ' + cls; $('#syncText').textContent = text; }
// poll for changes made on other devices
setInterval(async () => {
  if (LOCAL || !S || dirty || saving) return;
  try { const r = await fetch('/api/health').then(r => r.json()); if (r.rev !== rev) { await load(); toast('Data diperbarui dari perangkat lain'); } }
  catch { setSync('err', 'Server tidak terjangkau'); }
}, 15000);

// ---------------- calculations ----------------
const ingById = id => S.ingredients.find(i => i.id === id);
function unitCost(ing) {
  const q = totalBase(ing) * (1 - Math.min(99, num(ing.wastePct)) / 100);
  return q > 0 ? num(ing.price) / q : 0;
}
function totalInvestment() { return (S.investments || []).reduce((a, o) => a + num(o.amount), 0); }
function totalOverhead() { return S.overheads.reduce((a, o) => a + num(o.amount), 0); }
function overheadPerCup() { const t = num(S.settings.targetCupsPerMonth); return t > 0 ? totalOverhead() / t : 0; }
function calcMenu(m, priceOverride) {
  let bahan = 0, kemasan = 0;
  const lines = m.items.map(it => {
    const ing = ingById(it.ingredientId);
    const uc = ing ? unitCost(ing, priceOverride) : 0;
    let c = uc * num(it.qty);
    if (ing && priceOverride && priceOverride[ing.id]) c *= 1 + priceOverride[ing.id] / 100;
    if (ing && ing.category === 'Kemasan') kemasan += c; else bahan += c;
    return { ...it, ing, uc, cost: c };
  });
  const material = bahan + kemasan;
  const oh = S.settings.includeOverhead ? overheadPerCup() : 0;
  const hpp = material + oh;
  const price = num(m.price);
  const fcPct = S.settings.targetFoodCostPct || 35;
  return {
    lines, bahan, kemasan, material, oh, hpp, price,
    foodCost: price ? material / price * 100 : 0,
    hppPct: price ? hpp / price * 100 : 0,
    contrib: price - material,                 // margin kontribusi (sebelum overhead)
    profit: price - hpp,
    profitPct: price ? (price - hpp) / price * 100 : 0,
    suggested: roundUp(material / (fcPct / 100), num(S.settings.roundTo)),
    online: roundUp(price / (1 - num(S.settings.onlineCommissionPct) / 100), num(S.settings.roundTo)), // saran harga online
    ...onlineCalc(m, material, oh),
    ...pricing(m, hpp)
  };
}
// harga online opsional: diisi = menu tayang di ojol, kosong = belum tayang
// harga jual dari target untung (margin dari harga jual): harga = HPP ÷ (1 − untung%)
function pricing(m, hpp) {
  const own = m.marginPct == null || m.marginPct === '' ? null : num(m.marginPct);
  const t = Math.min(95, Math.max(0, own ?? num(S.settings.targetMarginPct)));
  const exact = hpp / (1 - t / 100);
  const step = num(S.settings.roundTo) || 500;
  const first = roundUp(exact, step);
  const options = Array.from({ length: 6 }, (_, i) => { const price = first + i * step; return { price, margin: price ? (price - hpp) / price * 100 : 0 }; });
  return { marginTarget: t, marginOwn: own != null, priceExact: exact, priceOptions: options, priceStep: step };
}
function onlineCalc(m, material, oh) {
  const op = m.onlinePrice == null || m.onlinePrice === '' ? null : num(m.onlinePrice);
  if (!op) return { isOnline: false, onlinePrice: null };
  const net = op * (1 - num(S.settings.onlineCommissionPct) / 100);
  return { isOnline: true, onlinePrice: op, onlineNet: net, onlineKomisi: op - net, onlineProfit: net - material - oh };
}
function mixWeights() {
  const tot = S.menus.reduce((a, m) => a + num(m.mixPct), 0);
  return S.menus.map(m => tot > 0 ? num(m.mixPct) / tot : 1 / (S.menus.length || 1));
}
function portfolio(override) {
  const w = mixWeights();
  let price = 0, material = 0, contrib = 0;
  S.menus.forEach((m, i) => { const c = calcMenu(m, override); price += w[i] * c.price; material += w[i] * c.material; contrib += w[i] * c.contrib; });
  const oh = totalOverhead();
  const cups = num(S.settings.targetCupsPerMonth);
  return { price, material, contrib, oh, foodCost: price ? material / price * 100 : 0,
    bep: contrib > 0 ? Math.ceil(oh / contrib) : Infinity,
    profitAtTarget: contrib * cups - oh, revenueAtTarget: price * cups };
}
function salesProjection() {
  const sl = S.sales, days = num(sl.daysOpen) || 30, k = num(sim.scale) / 100, comm = num(S.settings.onlineCommissionPct) / 100;
  const rows = S.menus.map(m => {
    if (!sl.items[m.id]) sl.items[m.id] = { offline: 0, online: 0 };
    const c = calcMenu(m), it = sl.items[m.id];
    const off = num(it.offline) * k, on = c.isOnline ? num(it.online) * k : 0;
    const pOn = c.isOnline ? c.onlinePrice : 0;
    const omzet = off * c.price + on * pOn, hpp = (off + on) * c.material, komisi = on * pOn * comm;
    return { m, c, off, on, cups: off + on, pOn, omzet, hpp, komisi, gross: omzet - hpp - komisi };
  });
  const sum = f => rows.reduce((a, r) => a + r[f], 0);
  const d = { cups: sum('cups'), omzet: sum('omzet'), hpp: sum('hpp'), komisi: sum('komisi'), gross: sum('gross') };
  const M = { cups: d.cups * days, omzet: d.omzet * days, hpp: d.hpp * days, komisi: d.komisi * days, gross: d.gross * days };
  M.overhead = totalOverhead(); M.tax = M.omzet * num(sl.taxPct) / 100;
  M.net = M.gross - M.overhead - M.tax;
  const grossPerCup = d.cups ? d.gross / d.cups : 0;
  const netPerCup = d.cups ? (d.gross - d.omzet * num(sl.taxPct) / 100) / d.cups : 0;
  const bepDay = netPerCup > 0 ? Math.ceil(M.overhead / days / netPerCup) : Infinity;
  const inv = totalInvestment();
  const payback = M.net > 0 && inv > 0 ? inv / M.net : Infinity;
  return { rows, d, M, days, bepDay, netDay: M.net / days, inv, payback, roi: inv > 0 ? M.net * 12 / inv * 100 : 0 };
}
function status(m) {
  const fc = m.foodCost, t = S.settings.targetFoodCostPct;
  if (m.profit < 0) return '<span class="pill bad">Rugi</span>';
  if (fc <= t) return '<span class="pill good">Sehat</span>';
  if (fc <= t + 10) return '<span class="pill warn">Tipis</span>';
  return '<span class="pill bad">Food cost tinggi</span>';
}

// ---------------- generic binding ----------------
function setPath(path, value) {
  const parts = path.split('.'); let o = S;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts.at(-1)] = value;
}
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.bind) {
    let v = el.type === 'checkbox' ? el.checked : el.dataset.type === 'num' ? (el.dataset.opt != null && el.value.trim() === '' ? null : num(el.value)) : el.value;
    setPath(el.dataset.bind, v); queueSave(); render(true);
  } else if (el.dataset.sim) {
    sim.changes[el.dataset.sim] = num(el.value); render(true);
  } else if (el.id === 'simProfit') { sim.targetProfit = num(el.value); render(true); }
  else if (el.id === 'ingSearch') { ingFilter = el.value; render(true); }
});
document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && e.target.dataset.bind) render(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  ACTIONS[a] && ACTIONS[a](id, b);
});

let ingFilter = '';
const ACTIONS = {
  addIng() { S.ingredients.push({ id: uid('i'), name: 'Bahan baru', category: 'Lainnya', buyQty: 1, packName: 'pcs', purchaseQty: 1000, unit: 'gr', price: 0, wastePct: 0, supplier: '' }); commit(); focusLast('ing-name'); },
  delIng(id) {
    const used = S.menus.filter(m => m.items.some(i => i.ingredientId === id)).map(m => m.name);
    if (used.length && !confirm('Bahan ini dipakai di: ' + used.join(', ') + '.\nHapus juga dari resep tersebut?')) return;
    S.ingredients = S.ingredients.filter(i => i.id !== id);
    S.menus.forEach(m => m.items = m.items.filter(i => i.ingredientId !== id)); commit();
  },
  addMenu() { S.menus.push({ id: uid('m'), name: 'Menu baru', size: '16 oz', category: '', price: 0, onlinePrice: null, mixPct: 0, items: [] }); commit(); setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50); },
  setPrice(id, b) { const m = S.menus.find(x => x.id === id); m.price = num(b.dataset.p); commit(); toast(`Harga booth ${m.name} → ${rp(m.price)}`); },
  setOnline(id, b) { const m = S.menus.find(x => x.id === id); m.onlinePrice = num(b.dataset.p); commit(); toast(`Harga online ${m.name} → ${rp(m.onlinePrice)}`); },
  dupMenu(id) { const m = S.menus.find(x => x.id === id); const c = JSON.parse(JSON.stringify(m)); c.id = uid('m'); c.name += ' (salinan)'; S.menus.splice(S.menus.indexOf(m) + 1, 0, c); commit(); },
  delMenu(id) { const m = S.menus.find(x => x.id === id); if (confirm(`Hapus menu "${m.name}"?`)) { S.menus = S.menus.filter(x => x.id !== id); commit(); } },
  addItem(id) { const m = S.menus.find(x => x.id === id); m.items.push({ ingredientId: S.ingredients[0]?.id || '', qty: 0 }); commit(); },
  delItem(id, b) { const m = S.menus.find(x => x.id === id); m.items.splice(+b.dataset.i, 1); commit(); },
  addInv() { S.investments.push({ id: uid('v'), name: 'Modal baru', amount: 0 }); commit(); focusLast('inv-name'); },
  delInv(id) { S.investments = S.investments.filter(o => o.id !== id); commit(); },
  addOh() { S.overheads.push({ id: uid('o'), name: 'Biaya baru', amount: 0 }); commit(); focusLast('oh-name'); },
  delOh(id) { S.overheads = S.overheads.filter(o => o.id !== id); commit(); },
  resetSim() { sim.changes = {}; render(); },
  exportJson() { const { rev, ...d } = S; download(`rush-hpp-backup-${today()}.json`, JSON.stringify(d, null, 2), 'application/json'); },
  importJson() { $('#importFile').click(); },
  exportCsv() {
    const rows = [['Menu', 'Ukuran', 'Harga Booth', 'Biaya Bahan', 'Biaya Kemasan', 'Overhead/cup', 'HPP', 'Food Cost %', 'Laba/cup', 'Laba %', 'Saran Harga', 'Harga Online (tayang)', 'Saran Harga Online', 'Target Untung %', 'Harga Pas', 'Bulat 500', 'Bulat 1000']];
    S.menus.forEach(m => { const c = calcMenu(m); rows.push([m.name, m.size, c.price, c.bahan.toFixed(0), c.kemasan.toFixed(0), c.oh.toFixed(0), c.hpp.toFixed(0), c.foodCost.toFixed(1), c.profit.toFixed(0), c.profitPct.toFixed(1), c.suggested, c.onlinePrice ?? 'belum tayang', c.online, c.marginTarget, Math.round(c.priceExact), roundUp(c.priceExact, 500), roundUp(c.priceExact, 1000)]); });
    rows.push([]); rows.push(['Bahan', 'Kategori', 'Supplier', 'Jumlah Beli', 'Kemasan', 'Isi per Kemasan', 'Satuan', 'Total Harga', 'Susut %', 'Total Isi', 'Biaya/Satuan', 'Satuan Resep']);
    S.ingredients.forEach(i => rows.push([i.name, i.category, i.supplier, i.buyQty, i.packName, i.purchaseQty, i.unit, i.price, i.wastePct, totalBase(i), unitCost(i).toFixed(2), baseUnit(i)]));
    download(`rush-hpp-${today()}.csv`, '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv');
  },
  async logout() { if (LOCAL) return; await fetch('/api/logout'); showLogin(); },
  print() { window.print(); }
};
function commit() { queueSave(); render(); }
function focusLast(cls) { setTimeout(() => { const els = document.querySelectorAll('.' + cls); const el = els[els.length - 1]; if (el) { el.focus(); el.select(); } }, 30); }
const today = () => new Date().toISOString().slice(0, 10);
function download(name, content, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }


// ---------------- charts (SVG/HTML, tanpa library) ----------------
const rpShort = n => { const a = Math.abs(n), sg = n < 0 ? '−' : '';
  if (a >= 1e9) return sg + (a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e6) return sg + (a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (a >= 1e3) return sg + Math.round(a / 1e3) + ' rb'; return sg + Math.round(a); };
function niceStep(range, n = 4) { const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

function chartWaterfall(M) {
  const max = Math.max(M.omzet, 1);
  let run = M.omzet;
  const steps = [{ l: 'Omzet', v: M.omzet, from: 0, to: M.omzet, col: COL.omzet }];
  [['HPP bahan & kemasan', M.hpp, COL.hpp], ['Komisi ojol', M.komisi, COL.komisi], ['Opex', M.overhead, COL.opex], ['Pajak', M.tax, COL.tax]].forEach(([l, v, col]) => {
    if (v <= 0 && l !== 'Opex') return; steps.push({ l, v: -v, from: run - v, to: run, col }); run -= v; });
  steps.push({ l: 'Laba bersih', v: M.net, from: Math.min(0, M.net), to: Math.max(0, M.net), col: M.net >= 0 ? COL.profit : COL.loss, total: true });
  const lo = Math.min(0, ...steps.map(x => x.from)), span = max - lo;
  const X = v => (v - lo) / span * 100;
  return `<div class="wf">${steps.map(x => `<div class="wf-row${x.total ? ' tot' : ''}" data-tip="${esc(x.l)}: ${rp(x.v)}${M.omzet ? ' (' + pct(Math.abs(x.v) / M.omzet * 100) + ' omzet)' : ''}">
    <div class="wf-l">${esc(x.l)}</div>
    <div class="wf-t">${lo < 0 ? `<span class="wf-zero" style="left:${X(0)}%"></span>` : ''}<i style="left:${X(x.from)}%;width:${Math.max(0.4, X(x.to) - X(x.from))}%;background:${x.col}"></i></div>
    <div class="wf-v">${x.v < 0 ? '−' : ''}${rp(Math.abs(x.v))}</div></div>`).join('')}</div>`;
}

function chartPayback(P) {
  const inv = P.inv, net = P.M.net;
  const N = isFinite(P.payback) ? Math.min(60, Math.max(12, Math.ceil(P.payback * 1.5))) : 24;
  const ys = Array.from({ length: N + 1 }, (_, i) => -inv + net * i);
  if (!inv) return '<p class="note">Isi <b>Modal awal</b> di menu Biaya &amp; Modal untuk melihat proyeksi balik modal.</p>';
  let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys); if (y1 - y0 < 1) y1 = y0 + 1;
  const step = niceStep(y1 - y0); y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
  const W = 600, H = 250, L = 64, R = 26, T = 14, B = 30;
  const x = i => L + i / N * (W - L - R), y = v => T + (y1 - v) / (y1 - y0) * (H - T - B);
  const ticks = []; for (let v = y0; v <= y1 + 1e-6; v += step) ticks.push(v);
  const xt = []; const xs = N <= 24 ? 3 : 6; for (let i = 0; i <= N; i += xs) xt.push(i);
  const path = ys.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const pb = isFinite(P.payback) && P.payback <= N ? P.payback : null;
  return `<svg class="lc" viewBox="0 0 ${W} ${H}" data-line='${JSON.stringify({ N, ys, L, R, W })}' role="img" aria-label="Kas kumulatif per bulan">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#5b6b82' : '#e2e8f1'}" stroke-width="${v === 0 ? 1.2 : 1}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${rpShort(v)}</text>`).join('')}
    ${xt.map(i => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${i === 0 ? 'Buka' : 'Bln ' + i}</text>`).join('')}
    <path d="${path}" fill="none" stroke="${COL.omzet}" stroke-width="2" stroke-linejoin="round"/>
    ${pb != null ? `<line x1="${x(pb)}" x2="${x(pb)}" y1="${T}" y2="${H - B}" stroke="${COL.profit}" stroke-dasharray="3 3"/>
      <circle cx="${x(pb)}" cy="${y(0)}" r="5" fill="${COL.profit}" stroke="#fff" stroke-width="2"/>
      <text x="${x(pb) + (x(pb) > W * .7 ? -8 : 8)}" y="${y(0) + 20}" text-anchor="${x(pb) > W * .7 ? 'end' : 'start'}" class="lbl">Balik modal ± bulan ke-${Math.ceil(pb)}</text>` : ''}
    <circle cx="${x(0)}" cy="${y(ys[0])}" r="4" fill="${COL.omzet}"/>
    <line class="cx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#0f1b2d" stroke-opacity=".35" style="display:none"/>
    <circle class="cd" r="5" fill="${COL.omzet}" stroke="#fff" stroke-width="2" style="display:none"/>
    <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
  </svg>
  <p class="note">Mulai dari −${rp(inv)} (modal), bertambah ${rp(net)} tiap bulan.${pb == null ? ' <b>Belum balik modal</b> dalam ' + N + ' bulan dengan proyeksi ini.' : ''}</p>`;
}

function chartRank(items, color) {
  items = items.filter(i => i.value !== 0).sort((a, b) => b.value - a.value);
  if (!items.length) return '<p class="note">Belum ada data.</p>';
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  return `<div class="rk">${items.map(i => `<div class="rk-row" data-tip="${esc(i.label)}: ${rp(i.value)} · ${esc(i.note)}">
    <div class="rk-l" title="${esc(i.label)}">${esc(i.label)}</div>
    <div class="rk-t"><i style="width:${Math.abs(i.value) / max * 100}%;background:${i.value < 0 ? COL.loss : color}"></i></div>
    <div class="rk-v">${rp(i.value)}<span class="muted"> · ${esc(i.note)}</span></div></div>`).join('')}</div>`;
}

// tooltip & crosshair
const tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; document.body.appendChild(tip);
function showTip(html, ev) { tip.innerHTML = html; tip.style.display = 'block';
  const w = tip.offsetWidth; tip.style.left = Math.min(ev.clientX + 14, innerWidth - w - 8) + 'px'; tip.style.top = (ev.clientY + 14) + 'px'; }
document.addEventListener('mousemove', ev => {
  const svg = ev.target.closest && ev.target.closest('svg[data-line]');
  if (svg && ev.target.classList.contains('hit')) {
    const c = JSON.parse(svg.dataset.line), pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(c.N, Math.round((p.x - c.L) / (c.W - c.L - c.R) * c.N)));
    const ln = svg.querySelector('.cx'), dt = svg.querySelector('.cd'), xx = c.L + i / c.N * (c.W - c.L - c.R);
    const yEl = svg.querySelectorAll('path')[0]; // posisi y dari path
    const seg = yEl.getAttribute('d').split(/[ML]/).filter(Boolean)[i].trim().split(' ');
    ln.setAttribute('x1', xx); ln.setAttribute('x2', xx); ln.style.display = ''; dt.setAttribute('cx', seg[0]); dt.setAttribute('cy', seg[1]); dt.style.display = '';
    return showTip(`<b>${i === 0 ? 'Saat buka' : 'Bulan ke-' + i}</b><br>Kas kumulatif ${rp(c.ys[i])}`, ev);
  }
  document.querySelectorAll('svg[data-line] .cx, svg[data-line] .cd').forEach(e => e.style.display = 'none');
  const t = ev.target.closest && ev.target.closest('[data-tip]');
  if (t) showTip(esc(t.dataset.tip).replace(/^([^:]+):/, '<b>$1</b>:'), ev); else tip.style.display = 'none';
});

// ---------------- render ----------------
function render(keepFocus) {
  // preserve focus & caret across re-render
  const a = document.activeElement; let key = null, sel = null, raw = null;
  if (keepFocus && a && a.dataset && (a.dataset.bind || a.dataset.sim || a.id)) {
    key = a.dataset.bind ? `[data-bind="${a.dataset.bind}"]` : a.dataset.sim ? `[data-sim="${a.dataset.sim}"]` : '#' + a.id;
    raw = a.type === 'checkbox' ? null : a.value;
    try { sel = [a.selectionStart, a.selectionEnd]; } catch { }
  }
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  $('#view').innerHTML = (VIEWS[view] || VIEWS.dashboard)();
  if (key) { const el = document.querySelector(key); if (el) { if (raw != null && el.tagName === 'INPUT') el.value = raw; el.focus(); try { if (sel && sel[0] != null) el.setSelectionRange(sel[0], sel[1]); } catch { } } }
}

const inp = (bind, val, type = 'text', cls = '', extra = '') => val == null ? `<input class="${cls}" data-bind="${bind}" type="text" ${type === 'num' ? 'inputmode="decimal" data-type="num" style="text-align:right"' : ''} value="" ${extra}>` :
  `<input class="${cls}" data-bind="${bind}" type="text" ${type === 'num' ? 'inputmode="decimal" data-type="num" style="text-align:right"' : ''} value="${esc(val)}" ${extra}>`;
const sel = (bind, val, opts) => `<select data-bind="${bind}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;

function stackBar(c, maxV) {
  const seg = (v, col) => v > 0 ? `<i style="width:${v / maxV * 100}%;background:${col}"></i>` : '';
  return seg(c.bahan, COL.bahan) + seg(c.kemasan, COL.kemasan) + seg(c.oh, COL.overhead) + seg(Math.max(0, c.profit), COL.profit);
}
const legend = () => `<div class="legend"><span><b style="background:${COL.bahan}"></b>Bahan</span><span><b style="background:${COL.kemasan}"></b>Kemasan</span>${S.settings.includeOverhead ? `<span><b style="background:${COL.overhead}"></b>Overhead</span>` : ''}<span><b style="background:${COL.profit}"></b>Laba</span></div>`;

const VIEWS = {
  dashboard() {
    const P = salesProjection(), { M, d } = P, F = portfolio();
    const rows = S.menus.map(m => ({ m, c: calcMenu(m) }));
    const maxV = Math.max(1, ...rows.map(r => Math.max(r.c.price, r.c.hpp)));
    const good = M.net >= 0, opexPct = M.omzet ? M.overhead / M.omzet * 100 : 0;
    return `
    <div class="row"><div><h1>Dashboard</h1>
      <p class="sub">${esc(S.settings.businessName)} · ${esc(S.settings.outlet)} — proyeksi dari <b>${fmtQty(Math.round(d.cups))} cup/hari</b>, ${fmtQty(P.days)} hari buka/bulan${num(sim.scale) !== 100 ? ` (skenario ${sim.scale}%)` : ''}.</p></div>
      <div class="sp"></div><button class="btn ghost sm" onclick="location.hash='sales'">Ubah proyeksi penjualan →</button></div>

    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><div class="l">Omzet / bulan</div><div class="v">${rp(M.omzet)}</div><div class="h">${rp(d.omzet)} / hari</div></div>
      <div class="kpi"><div class="l">Laba kotor / bulan</div><div class="v">${rp(M.gross)}</div><div class="h">Margin kotor ${pct(M.omzet ? M.gross / M.omzet * 100 : 0)} · setelah HPP &amp; komisi</div></div>
      <div class="kpi"><div class="l">Overhead / opex / bulan</div><div class="v">${rp(M.overhead)}</div><div class="h">${pct(opexPct)} dari omzet · ${rp(M.overhead / P.days)} / hari</div></div>
      <div class="kpi hero"><div class="l">Laba bersih / bulan</div><div class="v" style="${good ? '' : 'color:#ff9d9d'}">${rp(M.net)}</div><div class="h">${rp(P.netDay)} / hari · margin ${pct(M.omzet ? M.net / M.omzet * 100 : 0)}</div></div>
    </div>
    <div class="grid g4" style="margin-bottom:18px">
      <div class="kpi"><div class="l">ROI per tahun</div><div class="v" style="color:${P.roi >= 0 ? 'var(--good)' : 'var(--bad)'}">${pct(P.roi)}</div><div class="h">Modal ${rp(P.inv)}</div></div>
      <div class="kpi"><div class="l">Balik modal</div><div class="v">${isFinite(P.payback) ? fmtQty(Math.ceil(P.payback)) + ' bulan' : '—'}</div><div class="h">${isFinite(P.payback) ? '≈ ' + (P.payback / 12).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' tahun' : 'Laba bersih belum positif'}</div></div>
      <div class="kpi"><div class="l">Titik impas</div><div class="v">${isFinite(P.bepDay) ? fmtQty(P.bepDay) + ' cup/hari' : '—'}</div><div class="h">${isFinite(P.bepDay) ? (d.cups >= P.bepDay ? `<span class="pill good">Aman</span> proyeksi ${fmtQty(Math.round(d.cups))} cup/hari` : `<span class="pill bad">Kurang</span> proyeksi ${fmtQty(Math.round(d.cups))} cup/hari`) : ''}</div></div>
      <div class="kpi"><div class="l">Food cost rata-rata</div><div class="v">${pct(M.omzet ? M.hpp / M.omzet * 100 : 0)}</div><div class="h">Target ${S.settings.targetFoodCostPct}% · HPP ${rp(d.cups ? d.hpp / d.cups : 0)} / cup</div></div>
    </div>

    <div class="grid g2">
      <div class="card"><h2>Dari omzet ke laba bersih <span class="muted" style="font-weight:500">/ bulan</span></h2>${chartWaterfall(M)}
        ${M.omzet ? `<div class="sum" style="margin-top:14px"><div class="r"><span>Dari setiap Rp 100 omzet</span><span></span></div>
          <div class="r"><span>→ bahan &amp; kemasan</span><span>Rp ${Math.round(M.hpp / M.omzet * 100)}</span></div>
          <div class="r"><span>→ komisi ojol</span><span>Rp ${Math.round(M.komisi / M.omzet * 100)}</span></div>
          <div class="r"><span>→ opex</span><span>Rp ${Math.round(M.overhead / M.omzet * 100)}</span></div>
          ${M.tax ? `<div class="r"><span>→ pajak</span><span>Rp ${Math.round(M.tax / M.omzet * 100)}</span></div>` : ''}
          <div class="r t"><span>→ jadi laba bersih</span><span>Rp ${Math.round(M.net / M.omzet * 100)}</span></div></div>` : ''}</div>
      <div class="card"><h2>Proyeksi balik modal <span class="muted" style="font-weight:500">kas kumulatif</span></h2>${chartPayback(P)}</div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Laba kotor per menu <span class="muted" style="font-weight:500">/ bulan</span></h2>
        ${chartRank(P.rows.map(r => ({ label: r.m.name, value: r.gross * P.days, note: fmtQty(Math.round(r.cups)) + ' cup/hari' })), COL.bahan)}</div>
      <div class="card"><h2>Komposisi opex <span class="muted" style="font-weight:500">/ bulan</span></h2>
        ${chartRank(S.overheads.map(o => ({ label: o.name, value: num(o.amount), note: pct(M.overhead ? num(o.amount) / M.overhead * 100 : 0) })), COL.opex)}</div>
    </div>

    <div class="card"><div class="row"><h2 style="margin:0">HPP per menu</h2><div class="sp"></div><button class="btn ghost sm" data-act="exportCsv">Export CSV</button><button class="btn ghost sm" data-act="print">Cetak</button></div>
      <div class="tbl" style="margin-top:12px"><table>
        <tr><th>Menu</th><th class="n">Harga booth</th><th class="n">Harga online</th><th class="n">Bahan</th><th class="n">Kemasan</th>${S.settings.includeOverhead ? '<th class="n">Overhead</th>' : ''}<th class="n">HPP</th><th class="n">Food cost</th><th class="n">Laba / cup</th><th class="n">Saran harga</th><th>Status</th></tr>
        ${rows.map(({ m, c }) => `<tr><td><b>${esc(m.name)}</b> <span class="muted">${esc(m.size)}</span></td><td class="n">${rp(c.price)}</td><td class="n">${c.isOnline ? rp(c.onlinePrice) : '<span class="muted">belum tayang</span>'}</td><td class="n">${rp(c.bahan)}</td><td class="n">${rp(c.kemasan)}</td>${S.settings.includeOverhead ? `<td class="n">${rp(c.oh)}</td>` : ''}<td class="n"><b>${rp(c.hpp)}</b></td><td class="n">${pct(c.foodCost)}</td><td class="n" style="color:${c.profit < 0 ? 'var(--bad)' : 'inherit'}">${rp(c.profit)} <span class="muted">(${pct(c.profitPct)})</span></td><td class="n">${rp(c.suggested)}</td><td>${status(c)}</td></tr>`).join('')}
      </table></div></div>
    <div class="card chart"><h2>Struktur harga per cup (booth)</h2>${legend()}
      ${rows.map(({ m, c }) => `<div class="item"><div><b>${esc(m.name)}</b></div><div class="track">${stackBar(c, maxV)}</div><div class="n" style="text-align:right">${rp(c.price)}</div></div>`).join('')}
    </div>`;
  },

  menus() {
    const ingOpts = S.ingredients.map(i => [i.id, `${i.name} (${baseUnit(i)})`]);
    return `
    <div class="row"><div><h1>Menu &amp; Resep</h1><p class="sub">Atur takaran per cup — HPP terhitung otomatis.</p></div><div class="sp"></div><button class="btn y" data-act="addMenu">+ Tambah menu</button></div>
    ${S.menus.map((m, mi) => {
      const c = calcMenu(m); const maxV = Math.max(c.price, c.hpp, 1);
      return `<div class="card">
        <div class="menu-head">
          ${inp(`menus.${mi}.name`, m.name, 'text', 'title')}
          <div class="field" style="width:100px"><label>Ukuran</label>${inp(`menus.${mi}.size`, m.size)}</div>
          <div class="field" style="width:130px"><label>Kategori</label>${inp(`menus.${mi}.category`, m.category)}</div>
          <div class="field" style="width:130px"><label>Harga booth (Rp)</label>${inp(`menus.${mi}.price`, m.price, 'num')}</div>
          <div class="field" style="width:150px"><label>Harga online (opsional)</label>${inp(`menus.${mi}.onlinePrice`, m.onlinePrice, 'num', '', `data-opt placeholder="saran ${fmtQty(c.online)}"`)}</div>
          <div class="field" style="width:120px"><label>Target untung %</label>${inp(`menus.${mi}.marginPct`, m.marginPct, 'num', '', `data-opt placeholder="${fmtQty(num(S.settings.targetMarginPct))} (default)"`)}</div>
          <div class="field" style="width:110px"><label>Porsi penjualan %</label>${inp(`menus.${mi}.mixPct`, m.mixPct, 'num')}</div>
          <div class="sp"></div>
          <button class="btn ghost sm" data-act="dupMenu" data-id="${m.id}">Duplikat</button>
          <button class="x" title="Hapus menu" data-act="delMenu" data-id="${m.id}">×</button>
        </div>
        <div class="split">
          <div class="tbl"><table>
            <tr><th>Bahan</th><th class="n" style="width:110px">Takaran</th><th style="width:50px">Sat.</th><th class="n">Biaya/sat.</th><th class="n">Subtotal</th><th></th></tr>
            ${c.lines.map((l, li) => `<tr>
              <td>${sel(`menus.${mi}.items.${li}.ingredientId`, l.ingredientId, ingOpts)}</td>
              <td>${inp(`menus.${mi}.items.${li}.qty`, l.qty, 'num')}</td>
              <td class="muted">${esc(baseUnit(l.ing))}</td>
              <td class="n muted">${rp2(l.uc)}</td>
              <td class="n"><b>${rp(l.cost)}</b></td>
              <td><button class="x" data-act="delItem" data-id="${m.id}" data-i="${li}">×</button></td></tr>`).join('')}
          </table>
          <button class="btn ghost sm" style="margin-top:10px" data-act="addItem" data-id="${m.id}">+ Tambah bahan</button></div>
          <div class="sum">
            <div class="r"><span>Biaya bahan</span><span>${rp(c.bahan)}</span></div>
            <div class="r"><span>Biaya kemasan</span><span>${rp(c.kemasan)}</span></div>
            ${S.settings.includeOverhead ? `<div class="r"><span>Overhead / cup</span><span>${rp(c.oh)}</span></div>` : ''}
            <div class="r t"><span>HPP / cup</span><span>${rp(c.hpp)}</span></div>
            <div class="bar-h">${stackBar(c, maxV)}</div>${legend()}
            <div class="r" style="margin-top:8px"><span>Food cost (bahan+kemasan)</span><span>${pct(c.foodCost)} ${status(c)}</span></div>
            <div class="r"><span>Laba / cup</span><span style="color:${c.profit < 0 ? 'var(--bad)' : 'var(--good)'};font-weight:700">${rp(c.profit)} (${pct(c.profitPct)})</span></div>
            <div class="price-box">
              <div class="r"><span>Harga pas @ untung ${fmtQty(c.marginTarget)}%${c.marginOwn ? '' : ' <span class="muted">(default)</span>'}</span><span><b>${rp(c.priceExact)}</b></span></div>
              <div class="note" style="margin:6px 0 4px">Pembulatan ke atas (kelipatan Rp ${fmtQty(c.priceStep)}) — klik untuk pakai sebagai harga booth:</div>
              <div class="chips">${c.priceOptions.map((o, i) => `<button class="chip${o.price === c.price ? ' on' : ''}${i === 0 ? ' rec' : ''}" data-act="setPrice" data-id="${m.id}" data-p="${o.price}">
                <b>${rp(o.price)}</b><span>untung ${pct(o.margin)}</span><small>${rp(o.price - c.hpp)} / cup${i === 0 ? ' · terdekat' : ''}</small></button>`).join('')}</div>
            </div>
            <div style="border-top:1px dashed var(--line);margin-top:8px;padding-top:8px">
            ${c.isOnline ? `
              <div class="r"><span>Online <span class="pill good">Tayang</span></span><span><b>${rp(c.onlinePrice)}</b></span></div>
              <div class="r"><span>− Komisi ojol ${S.settings.onlineCommissionPct}%</span><span>${rp(c.onlineKomisi)}</span></div>
              <div class="r"><span>Laba / cup online</span><span style="color:${c.onlineProfit < 0 ? 'var(--bad)' : 'var(--good)'};font-weight:700">${rp(c.onlineProfit)}</span></div>`
            : `<div class="r"><span>Online <span class="pill" style="background:#eef1f5;color:var(--muted)">Belum tayang</span></span><span><span class="muted">saran ${rp(c.online)}</span> <button class="btn ghost sm" data-act="setOnline" data-id="${m.id}" data-p="${c.online}">Pakai</button></span></div>
              <p class="note" style="margin:4px 0 0">Isi “Harga online” jika menu ini sudah dijual di GoFood/GrabFood/ShopeeFood.</p>`}
            </div>
          </div>
        </div></div>`;
    }).join('')}
    ${S.menus.length ? '' : '<div class="card muted">Belum ada menu. Klik “Tambah menu”.</div>'}`;
  },

  ingredients() {
    const f = ingFilter.toLowerCase();
    const list = S.ingredients.map((g, i) => ({ g, i })).filter(({ g }) => !f || (g.name + g.category + g.supplier).toLowerCase().includes(f));
    return `
    <div class="row"><div><h1>Bahan Baku</h1><p class="sub">Masukkan harga beli terbaru — semua HPP menu ikut terupdate.</p></div><div class="sp"></div>
      <input id="ingSearch" placeholder="Cari bahan…" value="${esc(ingFilter)}" style="border:1px solid var(--line);border-radius:10px;padding:9px 12px">
      <button class="btn y" data-act="addIng">+ Tambah bahan</button></div>
    <div class="card tbl"><table class="ing">
      <tr><th rowspan="2">Nama bahan</th><th rowspan="2">Kategori</th><th rowspan="2">Supplier</th>
        <th colspan="2" class="grp">Yang dibeli</th><th colspan="2" class="grp">Isi per kemasan</th>
        <th rowspan="2" class="n">Total harga (Rp)</th><th rowspan="2" class="n" title="Bagian yang terbuang: mencair, tumpah, ampas. Kosongkan/0 jika tidak ada.">Susut %</th>
        <th rowspan="2" class="n">Total isi</th><th rowspan="2" class="n">Biaya / satuan</th><th rowspan="2" class="n">Dipakai</th><th rowspan="2"></th></tr>
      <tr><th class="n">Jumlah</th><th>Kemasan</th><th class="n">Isi</th><th>Satuan</th></tr>
      ${list.map(({ g, i }) => `<tr title="Beli ${fmtQty(num(g.buyQty))} ${esc(g.packName)} × ${fmtQty(num(g.purchaseQty))} ${esc(g.unit)} = ${fmtQty(totalBase(g))} ${baseUnit(g)} seharga ${rp(num(g.price))}">
        <td>${inp(`ingredients.${i}.name`, g.name, 'text', 'ing-name')}</td>
        <td style="width:110px">${sel(`ingredients.${i}.category`, g.category, CATS)}</td>
        <td style="width:100px">${inp(`ingredients.${i}.supplier`, g.supplier, 'text', '', 'placeholder="—"')}</td>
        <td style="width:70px">${inp(`ingredients.${i}.buyQty`, g.buyQty, 'num')}</td>
        <td style="width:95px">${sel(`ingredients.${i}.packName`, g.packName, PACKS.includes(g.packName) ? PACKS : [g.packName, ...PACKS])}</td>
        <td style="width:85px">${inp(`ingredients.${i}.purchaseQty`, g.purchaseQty, 'num')}</td>
        <td style="width:80px">${sel(`ingredients.${i}.unit`, g.unit, UNITS)}</td>
        <td style="width:120px">${inp(`ingredients.${i}.price`, g.price, 'num')}</td>
        <td style="width:70px">${inp(`ingredients.${i}.wastePct`, g.wastePct || '', 'num', '', 'placeholder="0"')}</td>
        <td class="n muted">${fmtQty(totalBase(g))} ${baseUnit(g)}</td>
        <td class="n"><b>${rp2(unitCost(g))}</b><span class="muted">/${baseUnit(g)}</span></td>
        <td class="n muted">${S.menus.filter(m => m.items.some(x => x.ingredientId === g.id)).length} menu</td>
        <td><button class="x" data-act="delIng" data-id="${g.id}">×</button></td></tr>`).join('')}
    </table>
    <div class="note" style="margin-top:12px;line-height:1.7">
      <b>Cara isi (ikuti nota belanja):</b><br>
      • Nescafe Classic: beli <b>1 pack</b>, isi <b>60 pcs</b> (sachet), total <b>60000</b> → Rp 1.000/pcs. Di resep tulis takaran dalam sachet (mis. 1).<br>
      • Susu UHT: beli <b>12 kotak</b>, isi <b>1 liter</b>, total <b>228000</b> → Rp 19/ml. Di resep tulis takaran dalam ml.<br>
      • <b>Susut %</b> = bagian yang terbuang (es mencair, tumpah). Untuk sachet/cup isi 0.<br>
      • Kg & liter otomatis dikonversi ke gr & ml untuk resep. Hati-hati: jika satuan diganti (mis. gr → pcs), cek ulang takaran di Menu &amp; Resep.
    </div></div>`;
  },

  overheads() {
    const t = totalOverhead(), cups = num(S.settings.targetCupsPerMonth);
    return `
    <div class="row"><div><h1>Biaya &amp; Modal</h1><p class="sub">Biaya operasional (opex) bulanan dan modal awal untuk menghitung ROI.</p></div><div class="sp"></div><button class="btn y" data-act="addOh">+ Tambah biaya</button></div>
    <h2>Biaya operasional / opex (per bulan)</h2>
    <div class="grid g2">
      <div class="card tbl"><table>
        <tr><th>Biaya</th><th class="n">Per bulan (Rp)</th><th class="n">Per cup</th><th></th></tr>
        ${S.overheads.map((o, i) => `<tr><td>${inp(`overheads.${i}.name`, o.name, 'text', 'oh-name')}</td><td style="width:170px">${inp(`overheads.${i}.amount`, o.amount, 'num')}</td><td class="n muted">${rp(cups ? num(o.amount) / cups : 0)}</td><td><button class="x" data-act="delOh" data-id="${o.id}">×</button></td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="n"><b>${rp(t)}</b></td><td class="n"><b>${rp(overheadPerCup())}</b></td><td></td></tr>
      </table></div>
      <div class="card">
        <h2>Basis pembebanan</h2>
        <div class="field"><label>Target penjualan (cup / bulan)</label>${inp('settings.targetCupsPerMonth', S.settings.targetCupsPerMonth, 'num')}</div>
        <p class="note">≈ ${Math.round(cups / 30).toLocaleString('id-ID')} cup per hari (30 hari buka).</p>
        <label class="row" style="margin-top:10px"><input type="checkbox" data-bind="settings.includeOverhead" ${S.settings.includeOverhead ? 'checked' : ''}> Masukkan overhead ke HPP per cup</label>
        <p class="note">Jika dimatikan, HPP hanya bahan + kemasan (HPP variabel) — cocok untuk menghitung food cost murni.</p>
        <div class="sum" style="margin-top:14px">
          <div class="r"><span>Total biaya tetap / hari</span><span>${rp(t / 30)}</span></div>
          <div class="r t"><span>Overhead / cup</span><span>${rp(overheadPerCup())}</span></div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:8px"><h2 style="margin:0">Modal awal / investasi (sekali keluar)</h2><div class="sp"></div><button class="btn ghost" data-act="addInv">+ Tambah modal</button></div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card tbl"><table>
        <tr><th>Item modal</th><th class="n">Nilai (Rp)</th><th></th></tr>
        ${S.investments.map((o, i) => `<tr><td>${inp(`investments.${i}.name`, o.name, 'text', 'inv-name')}</td><td style="width:170px">${inp(`investments.${i}.amount`, o.amount, 'num')}</td><td><button class="x" data-act="delInv" data-id="${o.id}">×</button></td></tr>`).join('')}
        <tr><td><b>Total modal</b></td><td class="n"><b>${rp(totalInvestment())}</b></td><td></td></tr>
      </table></div>
      <div class="card">${(() => { const P = salesProjection(); return `
        <h2>Pengembalian modal</h2>
        <div class="sum">
          <div class="r"><span>Total modal</span><span>${rp(P.inv)}</span></div>
          <div class="r"><span>Laba bersih / bulan (dari Proyeksi Penjualan)</span><span>${rp(P.M.net)}</span></div>
          <div class="r t"><span>Balik modal</span><span>${isFinite(P.payback) ? fmtQty(Math.ceil(P.payback)) + ' bulan' : '—'}</span></div>
          <div class="r"><span>ROI per tahun</span><span><b>${pct(P.roi)}</b></span></div>
        </div>
        <p class="note">ROI = laba bersih setahun ÷ total modal. Penyusutan alat sebaiknya tetap dicatat di opex agar laba tidak terlihat terlalu besar.</p>`; })()}</div>
    </div>`;
  },

  sim() {
    const base = portfolio(), next = portfolio(sim.changes);
    const need = next.contrib > 0 ? Math.ceil((next.oh + sim.targetProfit) / next.contrib) : Infinity;
    const used = S.ingredients.filter(g => S.menus.some(m => m.items.some(x => x.ingredientId === g.id)));
    return `
    <div class="row"><div><h1>Simulasi</h1><p class="sub">Uji dampak kenaikan harga bahan dan target laba — tidak mengubah data tersimpan.</p></div><div class="sp"></div><button class="btn ghost" data-act="resetSim">Reset simulasi</button></div>
    <div class="grid g2">
      <div class="card"><h2>Perubahan harga bahan</h2>
        <div class="tbl"><table><tr><th>Bahan</th><th class="n">Harga sekarang</th><th class="n" style="width:110px">Ubah %</th><th class="n">Harga baru</th></tr>
        ${used.map(g => { const ch = sim.changes[g.id] || 0; return `<tr><td>${esc(g.name)}</td><td class="n muted">${rp(g.price)}</td><td><input type="text" inputmode="decimal" style="text-align:right" data-sim="${g.id}" value="${ch || ''}" placeholder="0"></td><td class="n">${ch ? '<b>' + rp(g.price * (1 + ch / 100)) + '</b>' : '—'}</td></tr>`; }).join('')}
        </table></div></div>
      <div>
        <div class="card"><h2>Dampak per menu</h2><div class="tbl"><table>
          <tr><th>Menu</th><th class="n">HPP lama</th><th class="n">HPP baru</th><th class="n">Selisih</th><th class="n">Laba baru</th></tr>
          ${S.menus.map(m => { const a = calcMenu(m), b = calcMenu(m, sim.changes); const d = b.hpp - a.hpp; return `<tr><td>${esc(m.name)}</td><td class="n">${rp(a.hpp)}</td><td class="n"><b>${rp(b.hpp)}</b></td><td class="n" style="color:${d > 0 ? 'var(--bad)' : d < 0 ? 'var(--good)' : 'inherit'}">${d >= 0 ? '+' : ''}${rp(d)}</td><td class="n">${rp(b.profit)} <span class="muted">(${pct(b.profitPct)})</span></td></tr>`; }).join('')}
        </table></div>
        <div class="sum" style="margin-top:12px"><div class="r"><span>Proyeksi laba / bulan (lama → baru)</span><span>${rp(base.profitAtTarget)} → <b>${rp(next.profitAtTarget)}</b></span></div>
        <div class="r"><span>BEP (lama → baru)</span><span>${isFinite(base.bep) ? base.bep.toLocaleString('id-ID') : '—'} → <b>${isFinite(next.bep) ? next.bep.toLocaleString('id-ID') : '—'}</b> cup/bulan</span></div></div></div>
        <div class="card"><h2>Target laba bersih</h2>
          <div class="field"><label>Target laba / bulan (Rp)</label><input id="simProfit" type="text" inputmode="decimal" value="${sim.targetProfit}"></div>
          <div class="sum" style="margin-top:12px">
            <div class="r"><span>Margin kontribusi rata-rata / cup</span><span>${rp(next.contrib)}</span></div>
            <div class="r t"><span>Cup yang harus terjual</span><span>${isFinite(need) ? need.toLocaleString('id-ID') + ' / bulan' : '—'}</span></div>
            <div class="r"><span>Per hari (30 hari)</span><span><b>${isFinite(need) ? Math.ceil(need / 30).toLocaleString('id-ID') + ' cup' : '—'}</b></span></div>
            <div class="r"><span>Omzet yang dibutuhkan</span><span>${isFinite(need) ? rp(need * next.price) : '—'}</span></div>
          </div>
          <p class="note">Rata-rata tertimbang memakai “porsi penjualan %” tiap menu.</p></div>
      </div>
    </div>`;
  },

  sales() {
    const P = salesProjection(), { d, M } = P, sl = S.sales;
    const maxG = Math.max(1, ...P.rows.map(r => Math.abs(r.gross)));
    const seg = (v, col, label) => v > 0 && M.omzet > 0 ? `<i title="${label}: ${rp(v)}" style="width:${v / M.omzet * 100}%;background:${col}"></i>` : '';
    const good = M.net >= 0;
    return `
    <div class="row"><div><h1>Proyeksi Penjualan</h1><p class="sub">Isi perkiraan cup terjual per hari untuk tiap menu → lihat proyeksi pendapatan bersih.</p></div></div>
    <div class="grid g4" style="margin-bottom:18px">
      <div class="kpi hero"><div class="l">Laba bersih / bulan</div><div class="v" style="${good ? '' : 'color:#ff8a8a'}">${rp(M.net)}</div><div class="h">${rp(P.netDay)} / hari · ${rp(M.net * 12)} / tahun</div></div>
      <div class="kpi"><div class="l">Omzet / bulan</div><div class="v">${rp(M.omzet)}</div><div class="h">${rp(d.omzet)} / hari</div></div>
      <div class="kpi"><div class="l">Cup terjual</div><div class="v">${fmtQty(Math.round(d.cups))} / hari</div><div class="h">${fmtQty(Math.round(M.cups))} cup / bulan</div></div>
      <div class="kpi"><div class="l">Margin bersih</div><div class="v" style="color:${good ? 'var(--good)' : 'var(--bad)'}">${pct(M.omzet ? M.net / M.omzet * 100 : 0)}</div><div class="h">Impas di ± ${isFinite(P.bepDay) ? fmtQty(P.bepDay) : '—'} cup / hari</div></div>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Penjualan harian per menu</h2><div class="sp"></div>
        <div class="field" style="width:120px"><label>Hari buka / bulan</label>${inp('sales.daysOpen', sl.daysOpen, 'num')}</div>
        <div class="field" style="width:130px"><label>Skenario (% dari input)</label><input id="simScale" type="text" inputmode="decimal" value="${sim.scale}" style="text-align:right"></div>
      </div>
      <div class="tbl"><table>
        <tr><th>Menu</th><th class="n" style="width:105px">Cup / hari<br>di booth</th><th class="n" style="width:105px">Cup / hari<br>online</th><th class="n">Harga<br>booth / online</th><th class="n">Omzet / hari</th><th class="n">HPP bahan / hari</th><th class="n">Komisi ojol / hari</th><th class="n">Laba kotor / hari</th><th style="width:140px">Kontribusi</th></tr>
        ${P.rows.map(r => `<tr><td><b>${esc(r.m.name)}</b> <span class="muted">${esc(r.m.size)}</span></td>
          <td>${inp(`sales.items.${r.m.id}.offline`, sl.items[r.m.id].offline, 'num')}</td>
          <td>${r.c.isOnline ? inp(`sales.items.${r.m.id}.online`, sl.items[r.m.id].online, 'num') : '<span class="note" title="Isi harga online di Menu &amp; Resep untuk mengaktifkan">belum tayang</span>'}</td>
          <td class="n muted">${rp(r.c.price)}<br>${r.c.isOnline ? rp(r.pOn) : '—'}</td>
          <td class="n">${rp(r.omzet)}</td><td class="n">${rp(r.hpp)}</td><td class="n">${rp(r.komisi)}</td>
          <td class="n"><b style="color:${r.gross < 0 ? 'var(--bad)' : 'inherit'}">${rp(r.gross)}</b></td>
          <td><div class="track" style="height:10px;background:#eef3fb;border-radius:5px;overflow:hidden"><i style="display:block;height:100%;width:${Math.abs(r.gross) / maxG * 100}%;background:${r.gross < 0 ? COL.loss : COL.profit}"></i></div><span class="note">${pct(d.gross ? r.gross / d.gross * 100 : 0)}</span></td></tr>`).join('')}
        <tr><td><b>Total / hari</b></td><td class="n"><b>${fmtQty(Math.round(P.rows.reduce((a, r) => a + r.off, 0)))}</b></td><td class="n"><b>${fmtQty(Math.round(P.rows.reduce((a, r) => a + r.on, 0)))}</b></td><td></td>
          <td class="n"><b>${rp(d.omzet)}</b></td><td class="n"><b>${rp(d.hpp)}</b></td><td class="n"><b>${rp(d.komisi)}</b></td><td class="n"><b>${rp(d.gross)}</b></td><td></td></tr>
      </table></div>
      <p class="note" style="margin-top:10px">Kolom online hanya aktif untuk menu yang sudah diisi <b>Harga online</b> di Menu &amp; Resep. Komisi ojol ${S.settings.onlineCommissionPct}% (ubah di Pengaturan).</p>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Laba rugi per bulan (${fmtQty(P.days)} hari buka)</h2>
        <div class="sum">
          <div class="r"><span>Omzet (pendapatan kotor)</span><span><b>${rp(M.omzet)}</b></span></div>
          <div class="r"><span>− HPP bahan &amp; kemasan</span><span>${rp(M.hpp)}</span></div>
          <div class="r"><span>− Komisi ojol</span><span>${rp(M.komisi)}</span></div>
          <div class="r" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px"><span>= Laba kotor</span><span><b>${rp(M.gross)}</b></span></div>
          <div class="r"><span>− Biaya operasional (sewa, gaji, dll)</span><span>${rp(M.overhead)}</span></div>
          <div class="r"><span>− Pajak (${num(sl.taxPct)}% omzet)</span><span>${rp(M.tax)}</span></div>
          <div class="r t"><span>= Laba bersih</span><span style="color:${good ? 'var(--good)' : 'var(--bad)'}">${rp(M.net)}</span></div>
        </div>
        <div class="bar-h" style="height:16px;margin-top:14px">${seg(M.hpp, COL.bahan, 'HPP')}${seg(M.komisi, COL.kemasan, 'Komisi')}${seg(M.overhead, COL.overhead, 'Operasional')}${seg(M.tax, '#9aa7b8', 'Pajak')}${seg(Math.max(0, M.net), COL.profit, 'Laba bersih')}</div>
        <div class="legend"><span><b style="background:${COL.bahan}"></b>HPP</span><span><b style="background:${COL.kemasan}"></b>Komisi</span><span><b style="background:${COL.overhead}"></b>Operasional</span><span><b style="background:#9aa7b8"></b>Pajak</span><span><b style="background:${COL.profit}"></b>Laba bersih</span></div>
      </div>
      <div class="card"><h2>Asumsi</h2>
        <div class="grid" style="gap:12px">
          <div class="field"><label>Pajak dari omzet (%)</label>${inp('sales.taxPct', sl.taxPct, 'num')}</div>
          <p class="note" style="margin:0">Mis. PPh final UMKM 0,5% dari omzet. Isi 0 jika belum kena pajak.</p>
          <div class="sum"><div class="r"><span>Biaya operasional / bulan</span><span>${rp(M.overhead)}</span></div><div class="r"><span>Komisi ojol</span><span>${S.settings.onlineCommissionPct}%</span></div></div>
          <p class="note" style="margin:0">Biaya operasional diambil dari menu <b>Biaya Operasional</b> dan dihitung sekali per bulan, tidak dibagi per cup, jadi tidak terhitung dua kali. “Skenario” untuk uji cepat, mis. 70 = penjualan sepi, 130 = ramai (tidak disimpan).</p>
        </div>
      </div>
    </div>`;
  },

  settings() {
    const s = S.settings;
    return `
    <h1>Pengaturan</h1><p class="sub">Parameter perhitungan & pengelolaan data.</p>
    <div class="grid g2">
      <div class="card"><h2>Bisnis & perhitungan</h2><div class="grid" style="gap:12px">
        <div class="field"><label>Nama bisnis</label>${inp('settings.businessName', s.businessName)}</div>
        <div class="field"><label>Outlet</label>${inp('settings.outlet', s.outlet)}</div>
        <div class="field"><label>Target untung default (% dari harga jual)</label>${inp('settings.targetMarginPct', s.targetMarginPct, 'num')}</div>
        <div class="field"><label>Target food cost (%)</label>${inp('settings.targetFoodCostPct', s.targetFoodCostPct, 'num')}</div>
        <div class="field"><label>Komisi ojol / delivery (%)</label>${inp('settings.onlineCommissionPct', s.onlineCommissionPct, 'num')}</div>
        <div class="field"><label>Kelipatan pembulatan harga (Rp)</label>${inp('settings.roundTo', s.roundTo, 'num')}</div>
      </div></div>
      <div class="card"><h2>Data</h2>
        ${LOCAL ? '' : '<p class="note">Data tersimpan di server (folder <code>data\\</code>). Backup harian otomatis 30 hari terakhir di <code>data\\backups\\</code>.</p>'}
        <div class="row" style="margin:12px 0"><button class="btn" data-act="exportJson">Download backup (JSON)</button><button class="btn ghost" data-act="importJson">Import backup</button><button class="btn ghost" data-act="exportCsv">Export CSV</button></div>
        <input type="file" id="importFile" accept=".json" class="hidden">
        <p class="note">Revisi data: #${S.rev} · ${S.updatedAt ? new Date(S.updatedAt).toLocaleString('id-ID') : ''}</p>
        <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
        ${LOCAL ? '<p class="note"><b>Mode lokal:</b> data hanya tersimpan di browser & komputer ini. Rutin klik “Download backup”. Untuk dipakai bersama banyak perangkat, jalankan versi server (lihat README).</p>' : '<button class="btn ghost" data-act="logout">Keluar</button>'}
      </div>
    </div>`;
  }
};

// import handler
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(d.ingredients) || !Array.isArray(d.menus)) throw new Error('format');
    if (!confirm('Ganti seluruh data dengan isi file ini?')) return;
    normalize(d);
    S = { ...d, overheads: d.overheads || [], settings: d.settings || S.settings, rev };
    commit(); toast('Backup berhasil diimport');
  } catch { alert('File tidak valid.'); }
});

// ---------------- shell ----------------
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => { view = b.dataset.v; location.hash = view; render(); window.scrollTo(0, 0); });
window.onhashchange = () => { const v = location.hash.slice(1); if (v && v !== view && VIEWS[v]) { view = v; render(); } };
window.onbeforeunload = e => { if (dirty) { e.preventDefault(); return ''; } };

function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#lname').value = localStorage.getItem('hpp_name') || ''; setTimeout(() => ($('#lname').value ? $('#lpass') : $('#lname')).focus(), 50); }
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); }
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#lerr').textContent = '';
  const name = $('#lname').value.trim() || 'staff';
  try { localStorage.setItem('hpp_name', name); } catch { }
  const r = await api('POST', '/api/login', { name, password: $('#lpass').value });
  if (r.status === 200) { $('#lpass').value = ''; load(); } else $('#lerr').textContent = r.body.error || 'Gagal masuk';
};

// optional logo: drop public/logo.png onto the server to use the official master logo
const logo = new Image(); logo.onload = () => { $('#brand').innerHTML = '<img src="/logo.png" alt="Rush Coffee"><small>HPP</small>'; }; logo.src = '/logo.png';

load().catch(() => { });
