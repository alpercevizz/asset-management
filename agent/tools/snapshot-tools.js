// ── Günlük Anlık Görüntü & Trend Modülü ─────────────────────────────────────
// Dashboard'daki "↑%12 bu ay" ifadesinin GERÇEK kaynağı. Trend uydurulmaz:
// bugünkü değer ile N gün önceki anlık görüntü karşılaştırılır. Karşılaştıracak
// geçmiş yoksa trend null döner → arayüz oranı GÖSTERMEZ (sıfır uydurmaz).
const { db } = require('../../db');

function dayKey(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/* Bugünün anlık görüntüsünü yaz (aynı gün tekrar çalışırsa üzerine yazar). */
async function writeSnapshot(stats, locationCount = 0, source = 'scheduler') {
  const row = {
    day: dayKey(),
    total: Number(stats?.total) || 0,
    online: Number(stats?.by_status?.online) || 0,
    offline: Number(stats?.by_status?.offline) || 0,
    depoda: Number(stats?.by_status?.depoda) || 0,
    locations: Number(locationCount) || 0,
    taken_at: new Date().toISOString(),
    source,
  };
  const k = db();
  const existing = await k('asset_daily_snapshot').where({ day: row.day }).first();
  if (existing) await k('asset_daily_snapshot').where({ day: row.day }).update(row);
  else await k('asset_daily_snapshot').insert(row);
  return row;
}

/* created_on'dan GERİYE DÖNÜK toplam varlık serisi üretir.
   Yalnız `total` doldurulabilir — durum kırılımının geçmişi yoktur, o alanlar
   0 bırakılır ve trend hesabında KULLANILMAZ (yanlış %100 düşüş üretirdi). */
async function backfillTotals(assets, days = 90) {
  const dates = (assets || [])
    .map(a => Date.parse(a.created_on || a.last_seen || ''))
    .filter(t => !Number.isNaN(t));
  if (dates.length < 2) return { skipped: true, count: 0 };

  const k = db();
  const existing = await k('asset_daily_snapshot').select('day');
  const have = new Set(existing.map(r => r.day));
  const rows = [];
  const today = new Date();

  for (let i = days; i >= 1; i--) {                 // bugün hariç (scheduler yazar)
    const d = new Date(today.getTime() - i * 86400000);
    const key = dayKey(d);
    if (have.has(key)) continue;                    // gerçek kaydın üstüne YAZMA
    const cut = new Date(d); cut.setHours(23, 59, 59, 999);
    const total = dates.filter(t => t <= cut.getTime()).length;
    if (!total) continue;                           // envanter henüz başlamamış
    rows.push({ day: key, total, online: 0, offline: 0, depoda: 0, locations: 0,
      taken_at: new Date().toISOString(), source: 'backfill' });
  }
  if (rows.length) {
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) await k('asset_daily_snapshot').insert(rows.slice(i, i + CHUNK));
  }
  return { skipped: false, count: rows.length };
}

/* N gün öncesine göre değişim.
   Dönüş: { total: {pct, dir, from}, online: {...}, ... } — veri yoksa alan null. */
async function getTrends(current, days = 30) {
  const cutoff = dayKey(new Date(Date.now() - days * 86400000));
  const past = await db()('asset_daily_snapshot')
    .where('day', '<=', cutoff).orderBy('day', 'desc').first();

  const out = { window_days: days, since: past ? past.day : null };
  const metrics = { total: 'total', online: 'online', offline: 'offline', depoda: 'depoda', locations: 'locations' };

  for (const [key, col] of Object.entries(metrics)) {
    const now = Number(current?.[key]) || 0;
    // backfill satırlarında durum kırılımı yok → o metrikte trend hesaplama
    const usable = past && (col === 'total' || past.source !== 'backfill');
    if (!usable) { out[key] = null; continue; }
    const before = Number(past[col]) || 0;
    if (before === 0) { out[key] = null; continue; }   // 0'dan artış % olarak anlamsız
    const pct = ((now - before) / before) * 100;
    out[key] = {
      pct: Math.abs(pct) < 0.5 ? 0 : Math.round(pct),
      dir: now > before ? 'up' : (now < before ? 'down' : 'flat'),
      from: before,
    };
  }
  return out;
}

/* Sparkline serisi — son N günün gerçek değerleri (eksik gün varsa atlanır). */
async function getSeries(metric = 'total', days = 30) {
  const from = dayKey(new Date(Date.now() - days * 86400000));
  const rows = await db()('asset_daily_snapshot').where('day', '>=', from).orderBy('day', 'asc');
  const col = ['total', 'online', 'offline', 'depoda', 'locations'].includes(metric) ? metric : 'total';
  return rows
    .filter(r => col === 'total' || r.source !== 'backfill')
    .map(r => ({ day: r.day, value: Number(r[col]) || 0 }));
}

module.exports = { writeSnapshot, backfillTotals, getTrends, getSeries, dayKey };
