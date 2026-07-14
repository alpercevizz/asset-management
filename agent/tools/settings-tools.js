// ── Runtime Ayar Deposu Modülü ──────────────────────────────────────────────
// Bölüm bazlı ayarlar (thresholds/notify/appearance). Cache SENKRON okunur
// (init olmadan bile DEFAULTS döner → hiçbir yerde patlamaz). Yazma async (DB + cache).
// GÜVENLİK: sır/.env değerleri BURADA TUTULMAZ — yalnız operasyonel eşik/config.
const { db } = require('../../db');

// Varsayılanlar — kod'da kalır; DB'deki override üstüne biner.
const DEFAULTS = {
  thresholds: {
    low_ram_gb: 8,        // altı = yetersiz RAM
    low_disk_gb: 256,     // altı = yetersiz disk
    old_uptime_days: 30,  // üstü = yeniden başlatma önerilir
    offline_hours: 24,    // üstü = çevrimdışı
    stale_days: 7,        // üstü = kayıp/terk şüphesi
  },
  notify: {
    enabled: false,       // zamanlanmış bildirim (env NOTIFY_ENABLED override eder — aşağıya bak)
    interval_minutes: 30,
  },
  appearance: {
    theme: 'auto',        // auto | light | dark
    language: 'tr',
  },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) out[k] = deepMerge(base[k] || {}, over[k]);
    else if (over[k] !== undefined && over[k] !== null) out[k] = over[k];
  }
  return out;
}

// Cache her zaman DEFAULTS ile başlar → init edilmese bile güvenli.
let _cache = JSON.parse(JSON.stringify(DEFAULTS));

async function init() {
  try {
    const rows = await db()('settings').select('*');
    const merged = JSON.parse(JSON.stringify(DEFAULTS));
    for (const r of rows) {
      try { merged[r.key] = deepMerge(merged[r.key] || {}, JSON.parse(r.value)); } catch { /* bozuk satırı yoksay */ }
    }
    _cache = merged;
  } catch { /* tablo yoksa DEFAULTS'ta kal */ }
}

function getAll() { return JSON.parse(JSON.stringify(_cache)); }
function getSection(section) { return _cache[section] ? JSON.parse(JSON.stringify(_cache[section])) : {}; }
function getThresholds() { return _cache.thresholds || DEFAULTS.thresholds; }

// Bir bölümü kısmi güncelle (yalnız bilinen anahtarlar, tip doğrulamalı).
async function setSection(section, partial, actor = 'system') {
  if (!DEFAULTS[section]) throw new Error('Bilinmeyen ayar bölümü: ' + section);
  const clean = {};
  for (const [k, def] of Object.entries(DEFAULTS[section])) {
    if (partial[k] === undefined) continue;
    let v = partial[k];
    if (typeof def === 'number') { v = Number(v); if (!isFinite(v) || v < 0) throw new Error(`${section}.${k} geçersiz sayı`); }
    else if (typeof def === 'boolean') v = (v === true || v === 'true' || v === 1 || v === '1');
    else v = String(v);
    clean[k] = v;
  }
  const merged = deepMerge(_cache[section] || DEFAULTS[section], clean);
  _cache[section] = merged;
  const k = db();
  const now = new Date().toISOString();
  const existing = await k('settings').where({ key: section }).first();
  if (existing) await k('settings').where({ key: section }).update({ value: JSON.stringify(merged), updated_at: now, updated_by: actor });
  else await k('settings').insert({ key: section, value: JSON.stringify(merged), updated_at: now, updated_by: actor });
  return merged;
}

module.exports = { DEFAULTS, init, getAll, getSection, getThresholds, setSection };
